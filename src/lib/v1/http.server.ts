// Priority 8.11: /v1 API implementation -- shared response envelope, error
// format, cursor pagination, and validation helpers. Every /v1 route handler
// uses exactly these, never its own variant (API_CONTRACT.md -> Cross-cutting
// conventions, §4).
import type { ZodType, ZodTypeDef } from "zod";

export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "CAPABILITY_DISABLED"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 422,
  CONFLICT: 409,
  CAPABILITY_DISABLED: 403,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

export type ApiErrorDetail = { field: string; issue: string };

// The one error type every /v1 handler throws instead of a plain Error --
// caught once, at the top of each handler (via withRoute below), and turned
// into the exact §4.5 error envelope. A plain (non-ApiError) throw is
// treated as INTERNAL_ERROR and never leaks its message to the caller.
export class ApiError extends Error {
  code: ApiErrorCode;
  details?: ApiErrorDetail[];
  constructor(code: ApiErrorCode, message: string, details?: ApiErrorDetail[]) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export function apiData(data: unknown, status = 200): Response {
  return Response.json({ data }, { status });
}

export type CursorMeta = { nextCursor: string | null; hasMore: boolean };

export function apiList(data: unknown[], meta: CursorMeta, status = 200): Response {
  return Response.json({ data, meta }, { status });
}

export function apiError(err: unknown): Response {
  if (err instanceof ApiError) {
    return Response.json(
      {
        error: {
          code: err.code,
          message: err.message,
          ...(err.details ? { details: err.details } : {}),
        },
      },
      { status: STATUS_BY_CODE[err.code] },
    );
  }
  console.error("[v1] unhandled error", err);
  return Response.json(
    { error: { code: "INTERNAL_ERROR" as const, message: "An unexpected error occurred." } },
    { status: 500 },
  );
}

// Wraps a handler so every thrown error (ApiError or otherwise) is turned
// into the one consistent error envelope -- no /v1 route needs its own
// try/catch.
export function withRoute(
  handler: (args: { request: Request; params: Record<string, string> }) => Promise<Response>,
) {
  return async (args: { request: Request; params: Record<string, string> }): Promise<Response> => {
    try {
      return await handler(args);
    } catch (err) {
      return apiError(err);
    }
  };
}

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export function parseBody<T>(schema: ZodType<T, ZodTypeDef, unknown>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const details: ApiErrorDetail[] = result.error.issues.map((i) => ({
      field: i.path.join(".") || "(root)",
      issue: i.code,
    }));
    throw new ApiError(
      "VALIDATION_ERROR",
      result.error.issues[0]?.message ?? "Validation failed",
      details,
    );
  }
  return result.data;
}

export function parseQuery<T>(schema: ZodType<T, ZodTypeDef, unknown>, url: URL): T {
  return parseBody(schema, Object.fromEntries(url.searchParams.entries()));
}

// Cursor pagination (API_CONTRACT.md §4.2) -- an opaque, server-generated
// token, never a raw offset. Every list endpoint encodes/decodes through
// these two functions, never its own scheme.
export function encodeCursor(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function decodeCursor<T>(cursor: string | null | undefined): T | null {
  if (!cursor) return null;
  try {
    return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

export function parseLimit(url: URL, fallback = 20, max = 100): number {
  const raw = url.searchParams.get("limit");
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.trunc(n), max);
}

// One shared "field name doesn't exist" guard for §4.4 sorting -- an
// unrecognized ?sort= value is ignored (falls back to the endpoint's
// documented default), never rejected, per §4.3's forward-compatibility
// rule applied consistently to sorting too.
export function parseSort<K extends string>(
  url: URL,
  allowed: readonly K[],
  fallback: { field: K; desc: boolean },
): { field: K; desc: boolean } {
  const raw = url.searchParams.get("sort");
  if (!raw) return fallback;
  const desc = raw.startsWith("-");
  const field = (desc ? raw.slice(1) : raw) as K;
  if (!allowed.includes(field)) return fallback;
  return { field, desc };
}
