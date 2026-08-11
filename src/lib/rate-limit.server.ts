// Priority 11 security audit: no rate limiting existed anywhere in this
// codebase (confirmed -- no library installed, no hand-rolled equivalent).
// This is a minimal, fixed-window, in-memory limiter -- correct for this
// app's actual deployment target (a single Node process, per
// DEPLOYMENT.md; a multi-instance deployment would need a shared store
// instead, out of scope here). Applied only to the specific endpoints
// where the audit found a concrete gap: token issuance (auth/session,
// auth/refresh) and the two public payment webhooks, not blanket-applied
// to every /v1 route.
//
// Priority 15 Phase C reuses this exact file/interface for its own two
// rate-limited endpoints (POST /v1/events, reward redemption) rather than
// introducing a second, Postgres-backed mechanism -- this in-memory
// limiter is already the deliberate, documented architectural choice for
// this single-Node-process deployment.
import { ApiError } from "@/lib/v1/http.server";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

// Bound memory growth: opportunistically sweep expired buckets whenever
// the map gets large, rather than running a separate timer.
function sweepExpired(now: number): void {
  if (buckets.size < 5000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

// Fixed-window (not sliding), which can allow a short burst across a
// window boundary -- an accepted tradeoff for a dependency-free,
// allocation-cheap implementation guarding against sustained abuse, not a
// precise quota system.
function checkAndConsume(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  sweepExpired(now);
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  existing.count += 1;
  return existing.count <= max;
}

// For /v1 routes: throws the shared ApiError so withRoute's existing
// error-envelope conversion handles the response.
export function enforceRateLimit(key: string, max: number, windowMs: number): void {
  if (!checkAndConsume(key, max, windowMs)) {
    throw new ApiError("RATE_LIMITED", "Too many requests. Please try again later.");
  }
}

// For non-/v1 routes (the public webhooks), which build their own plain
// Response objects rather than using the /v1 ApiError envelope.
export function isRateLimited(key: string, max: number, windowMs: number): boolean {
  return !checkAndConsume(key, max, windowMs);
}
