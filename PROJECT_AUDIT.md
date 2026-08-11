# Project Audit — orbit-foundation-hub

**Scope:** Full repository (164 tracked files) — TanStack Start (React 19 SSR) + Supabase (Postgres/Auth/Storage) + Stripe/PayPal payments.
**Method:** Read-only static review of every source file, every SQL migration, and all config.
**Purpose:** Track the technical quality of the project — every known issue, its status, and its resolution — so the platform's condition is always visible before new features are built on top of it.

## How to read a finding

Every finding has a stable **ID** (e.g. `AU-1`) that never changes once assigned, even if the finding is resolved or reclassified. Each entry carries: **Status** (Open / Resolved / Deferred / Partially Resolved), **Files** affected, **Description** (what's wrong, mechanically), **Risk** (why it matters), **Recommendation**, **Resolution** (filled in once fixed), **Commit** (the commit that resolved it), and **Date** (logged / resolved). Findings are grouped by topic area, then by severity within each area. Severity levels are never changed without explicit approval — a finding's risk framing can be sharpened in prose, but its Critical/High/Medium/Low bucket is only moved on request. **Deferred** means the finding is confirmed real and intentionally not fixed yet — it carries a **Deferral rationale** explaining why, and stays Open-equivalent for planning purposes (not resolved, not abandoned). **Partially Resolved** means the finding covered more than one code path and only some of them have been fixed — the Resolution notes state exactly what's done and what remains, so it's never ambiguous which part is still open.

## Remediation log

| Finding | Status | Date | Notes |
|---|---|---|---|
| SE-1 — `.env` tracked in git | ✅ Resolved | 2026-07-26 | `.env`/`.env.local`/`.env.*.local` added to `.gitignore`; `.env` untracked via `git rm --cached` (local file preserved, content unchanged). No secret was ever committed, so no credential rotation was required. Commit `310c563`. |

## Severity definitions

| Severity | Meaning |
|---|---|
| **Critical** | Exploitable remotely/by any user, or causes data loss/corruption or broken core revenue flows (payments) |
| **High** | Serious correctness or security bug that manifests under normal use |
| **Medium** | Real bug, but limited blast radius or requires specific conditions |
| **Low** | Code smell, minor edge case, or small UX/perf inefficiency |

A separate, non-severity tag, **Architecture Deviation**, marks findings where the code doesn't match a stated architecture rule in `PROJECT_KNOWLEDGE.md` (e.g. the Single Source of Truth / Premium-per-application rules). This tag is informational — it does not raise or lower a finding's severity bucket.

## Summary

| Area | Critical | High | Medium | Low |
|---|---|---|---|---|
| Architecture | 0 | 1 | 4 | 2 |
| Authentication | 1 | 3 | 4 | 2 |
| Dashboard | 0 | 1 | 6 | 4 |
| Admin Panel | 1 | 0 | 8 | 5 |
| Database | 2 | 0 | 1 | 5 |
| Routing | 0 | 1 | 0 | 3 |
| Components | 0 | 1 | 4 | 2 |
| Security (cross-cutting + payments) | 4 | 2 | 5 | 4 |
| Performance | 0 | 0 | 2 | 5 |
| Billing / Subscription Lifecycle | 0 | 1 | 0 | 0 |
| Messaging | 0 | 0 | 1 | 2 |
| Priority 11 — Security Audit (v1 API / live RLS) | 4 | 7 | 9 | 3 |

Several issues are cross-cutting (e.g. the profile self-escalation bug is a Database/RLS root cause with an Authentication code path and a Security consequence). Each is written up **once**, in the section that owns its root cause, with short cross-reference entries elsewhere.

---

## 1. Architecture

**Stack:** TanStack Start (file-based routes in `src/routes/`, SSR via `src/server.ts`/`src/start.ts`, generated `src/routeTree.gen.ts`), React 19, TanStack Router + React Query, Supabase (Postgres + Auth + Storage), Stripe Checkout + PayPal for payments, i18next for localization (en/de/bs), Tailwind v4, shadcn/ui components. Deployed as a single Node/edge-style server entry (`src/server.ts`) wrapping the TanStack Start server handler, with an `errorMiddleware` (`src/start.ts`) and a Supabase-auth-attaching middleware (`src/integrations/supabase/auth-attacher.ts`) applied globally.

Server-only logic lives in `*.server.ts`/`*.functions.ts` files under `src/lib/` (admin, GDPR, trial, n8n, Stripe helpers) and is invoked from route components via TanStack Start server functions. Two public, unauthenticated webhook routes (`src/routes/api/public/webhooks/{stripe,paypal}.ts`) handle payment provider callbacks directly against `supabaseAdmin` (service-role client), bypassing RLS by design.

### High

**A-1 — `errorMiddleware` swallows structured errors/status codes into a generic HTML 500**
- **Status:** ✅ Resolved (2026-07-28)
- **Files:** `src/start.ts:6-22`
- **Description:** The middleware only re-threw errors that are plain objects with a `.statusCode` property. A thrown `Response` (e.g. `new Response("Forbidden", { status: 403 })` from `assertAdmin`, `src/lib/admin.server.ts:14`) has `.status`, not `.statusCode`, so it did not match and got replaced with a generic HTML error page. Ordinary domain `Error`s thrown by `trial.functions.ts`/`gdpr.functions.ts` still fall through to the same generic page — expected, since a plain `Error` carries no status to preserve.
- **Risk:** Server-function callers (React Query / `useServerFn`) expecting a structured JSON error or a real HTTP status instead received an opaque 500 + HTML body — admin-authorization failures were indistinguishable from unexpected crashes.
- **Recommendation:** Also pass through thrown `Response` instances (check `error instanceof Response` or the presence of `.status`), and/or scope this middleware to page-render requests only, not server-function RPC calls.
- **Resolution:** Added an `error instanceof Response` check ahead of the existing `.statusCode` check; a thrown `Response` (any status) is now re-thrown unchanged instead of being replaced. The pre-existing `.statusCode` branch and the generic-500 fallback for unrecognized errors are both untouched — verified by direct trace of all three paths (a `Response` now passes through unchanged; a plain-object `.statusCode` error takes the same branch it always did; a plain `Error` still falls through to the generic HTML 500). The audit's alternative option (scoping the middleware to page-render requests only) was not taken — the single added condition fully closes the described gap without widening the change. No automated test run — this repository has no test suite (see `CLAUDE.md` → Testing Rules) and no build tooling is available in this environment; verified by static trace only.
- **Commit:** —
- **Date:** Logged 2026-07-26, resolved 2026-07-28

### Medium

**A-2 — `.env.example` is out of sync with variables actually read by server code**
- **Status:** ✅ Resolved (2026-07-28)
- **Files:** `.env.example`
- **Description:** `.env.example` documented `VITE_SUPABASE_*` variables that no in-scope code reads (the client hardcodes URL/anon key in `src/integrations/supabase/client.ts:4-5` instead), while omitting server-only variables the app actually requires (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `PAYPAL_ENV`, `PAYPAL_WEBHOOK_ID`, `N8N_WEBHOOK_URL`). `RESEND_API_KEY` was listed but unused anywhere under `src/`.
- **Risk:** A fresh deployment following `.env.example` is missing required secrets and will fail at runtime.
- **Recommendation:** Reconcile `.env.example` with actual `process.env.*` usage.
- **Resolution:** Added the five confirmed-missing server-side variables (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_ENV`, `N8N_WEBHOOK_URL`) grouped under their relevant existing/new section headers; removed `RESEND_API_KEY` (reconfirmed zero references anywhere under `src/`). Verified line-by-line against every `process.env.*` read in `src/` — all are now present. Deliberately left `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY`/`VITE_SUPABASE_PROJECT_ID` untouched despite being unread by in-scope application code: the file's own comment marks that block as owned by the Lovable Cloud platform integration, not this repository's source, and removing them can't be verified safe from source alone.
- **Commit:** —
- **Date:** Logged 2026-07-26, resolved 2026-07-28

**A-3 — `server.ts`'s "catastrophic SSR error" detection depends on parsing an internal framework error shape**
- **Status:** Open
- **Files:** `src/server.ts:21-45`
- **Description:** `isH3SwallowedErrorBody` detects h3-swallowed errors by checking for `{"unhandled":true,"message":"HTTPError"}` — an internal implementation detail of the currently-pinned h3/Nitro version.
- **Risk:** If that shape changes on a dependency bump, the fallback silently stops working (raw JSON error is returned to the client instead of the friendly error page), with no test to catch it.
- **Recommendation:** Add a regression test pinned to the current h3/Nitro version, or find a more stable signal if the framework supports one.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

**A-5 — No shared "Premium source + expiry" resolver, so bulk/admin consumers re-derive Premium status ad hoc**
- **Status:** ✅ Resolved (2026-08-03)
- **Files:** `src/lib/premium.server.ts` (new); consumed by `src/lib/admin.functions.ts` (`adminListUsers`, `adminOverviewStats`, `adminSendNotification`, `adminListVerificationRequests`)
- **Description:** Found during the Priority 8.6 architecture audit: `hasAnyActivePremium()` (`src/lib/premium.ts`) is the correct single-user, client-callable check, but it has no bulk/server-only sibling — any admin surface needing "which of these N users are Premium, and via what" had nothing to call, so each one re-queried `subscriptions` directly and missed Promotional Trials entirely (tracked separately as **AD-13**, the concrete call-site consequence). A future `/v1` API endpoint reporting "am I premium, until when, via what" would have had the same problem.
- **Classification:** Architecture Deviation — the "two places compute the same answer differently" pattern `CLAUDE.md` calls out, one step removed from **AD-1**/**AD-10** (which fixed the single-user path but never the bulk/admin path).
- **Recommendation:** Add one shared, bulk-capable resolver exposing `{ active, source: "subscription" | "trial", expiresAt }`, and route every admin/bulk consumer through it instead of querying `subscriptions` directly.
- **Resolution:** New `src/lib/premium.server.ts` exports `resolvePremiumStatusBulk(supabaseAdmin, userIds?)` (two queries total, not N+1 — one against `subscriptions`, one against `promotional_trials`, both optionally scoped to a `userIds` list) and `resolvePremiumStatus(supabaseAdmin, userId)`. When a user has both an active subscription and an active trial, the subscription is reported as `source` (the paid entitlement takes precedence for display purposes; both remain valid per `PROJECT_KNOWLEDGE.md` → Promotional Trial's trial/premium-never-conflict rule). All four call sites in `admin.functions.ts` now resolve through it: `adminListUsers`'s premium filter and per-page badge, `adminOverviewStats`'s Active Premium stat (replacing an unrelated `MIN_MS`/`amount_paid > 0` heuristic that was itself a second, incorrect re-derivation), `adminSendNotification`'s "Premium users" broadcast target, and `adminListVerificationRequests`'s candidate list.
- **Commit:** —
- **Date:** Logged 2026-08-02, resolved 2026-08-03

**A-6 — `capability_definitions` conflated always-on base features with genuinely optional modules**
- **Status:** ✅ Resolved (2026-08-03)
- **Files:** `supabase/migrations/20260804100000_core_audit_resolution.sql`; `src/lib/conversation.functions.ts`, `src/components/dashboard/DashboardPage.tsx`, `src/routes/dashboard.messages.tsx`, `src/components/profile/ProfileCard.tsx`
- **Description:** Found during the Priority 8.6 audit: `premium` and `messaging` were both seeded as capability keys, but neither was ever actually checked anywhere (`getApplicationCapabilities()` was called only from Advertising/Dashboard-Widgets/Rewards code) — meaning disabling either did nothing, while genuinely optional capabilities like `rewards`/`advertising` behaved correctly. A future `/v1` endpoint listing "this app's enabled capabilities" would have included two keys that never do anything, and an admin toggling `messaging` off would see no effect (a silent no-op, not an error).
- **Risk:** Confusing/misleading vocabulary for whoever configures capabilities, and a structurally-inert entry that looks configurable but isn't.
- **Recommendation:** Archive `premium` (Billing is a mandatory Core responsibility per `PROJECT_KNOWLEDGE.md`, never meant to be togglable) rather than deleting it (soft-lifecycle convention), and make `messaging` a genuinely enforced capability instead of removing it, since messaging *is* a legitimate optional module.
- **Resolution:** `premium` archived (`archived = true`) in `capability_definitions` — an archived definition always wins over any per-application override (see `PROJECT_KNOWLEDGE.md` → Capabilities), so it can never resurface as togglable. `messaging` is now genuinely enforced end to end (see **MSG-2**): a new `messaging` `dashboard_widgets` row gates the Messages nav item exactly like `rewards`/`advertising`; `getOrCreateConversation` rejects new conversations when the capability is disabled for the initiator's current application; `/dashboard/messages` shows an "unavailable" state instead of the inbox when disabled; `ProfileCard`'s Send Message action is hidden entirely (not just locked) when disabled.
- **Commit:** —
- **Date:** Logged 2026-08-02, resolved 2026-08-03

### Low

**A-4 — `errorMiddleware` and `server.ts`'s fallback both render `renderErrorPage()` independently**
- **Status:** Open
- **Files:** `src/start.ts:14-17`, `src/server.ts:31-35,53-58`
- **Description:** Two separate layers implement near-identical "catch everything, log it, render a static error page" logic with slightly different detection heuristics.
- **Risk:** Duplicated error-handling logic that's easy to let drift out of sync, as it already has for the `statusCode` vs `.status` handling in A-1.
- **Recommendation:** Consolidate into one shared error-rendering path if feasible.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

**A-7 — Naming inconsistencies introduced across Phases 8.3–8.5**
- **Status:** 🚫 Deferred (2026-08-03)
- **Files:** `supabase/migrations/20260802120000_promotional_trials.sql` (`promotional_trials`/`trial_sources`/`trial_policy`); `src/lib/rewards.functions.ts` (`getRewardsMe`); `src/lib/advertising.functions.ts`/`src/lib/advertising.server.ts` (`ad_config` visibility)
- **Description:** Found during the Priority 8.6 audit, self-reported: **(1)** `promotional_trials` doesn't share a prefix with its own module's `trial_sources`/`trial_policy` tables, unlike `reward_*`/`ad_*` which are internally consistent. **(2)** `getRewardsMe` reverses the `getMyX` ordering used everywhere else (`getMyCampaigns`, `getMyActiveTrial`, `getMyAdvertisingSummary`). **(3)** `ad_config` is service-role-only readable while the structurally identical `reward_config`/`trial_policy` are publicly readable, with no functional reason for the difference.
- **Risk:** No functional bug in any of the three — purely a naming/consistency smell that makes the codebase slightly harder to navigate by pattern-matching.
- **Recommendation:** Rename for consistency in a future pass; not worth a migration/rename churn on its own.
- **Deferral rationale:** Explicitly out of scope for Priority 8.7 by owner instruction ("do not implement" R-12) — renaming a live table/function used across multiple modules is exactly the kind of change that should be batched deliberately, not done as a drive-by alongside unrelated fixes.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-08-03

---

## 2. Authentication

**Flow:** `src/context/AuthContext.tsx` wraps the app, calling `supabase.auth.getSession()` and subscribing to `onAuthStateChange` to populate `session`/`profile`/`loading`. `loadOrCreateProfile` selects (or lazily creates) a `profiles` row per authenticated user. `src/components/auth/ProtectedRoute.tsx` gates dashboard/admin routes on `loading`/`user` state client-side; `src/routes/auth.callback.tsx` handles the OAuth/magic-link redirect back into the app; `src/routes/onboarding.tsx` collects first-time profile data. Server-side, `src/integrations/supabase/auth-attacher.ts` + `auth-middleware.ts` attach the verified user to server-function context, and `src/lib/admin.server.ts`'s `assertAdmin()` re-verifies admin role from the `user_roles` table (not from `profiles.user_type`) on every privileged server call — this part is sound.

### Critical

**AU-1 — Any authenticated user can self-grant `premium`/`admin` status and a fake "Verified" badge**
- **Status:** ✅ Resolved (2026-07-26)
- **Files:** `src/context/AuthContext.tsx:167-178` (`updateProfile`); `src/types/database.ts` (`ProfileUpdate`); root cause in `supabase/migrations/20260724110804_f95931a7-2e9e-417c-8a33-e9aedac500de.sql:31` (see **DB-1**)
- **Description:** `updateProfile(data: ProfileUpdate)` forwards the caller-supplied object unfiltered to `supabase.from("profiles").update(data).eq("id", session.user.id)`. `ProfileUpdate = Partial<ProfileRow>` includes every column, including `user_type` and `is_verified`. Because the RLS policy on `profiles` only checks row ownership and has no `WITH CHECK`/column restriction, a call like `updateProfile({ user_type: "premium", is_verified: true })` from the browser console succeeds.
- **Risk:** Confirmed real consumers: `src/components/dashboard/DashboardPage.tsx:239,244` gates premium UI on `profile.user_type === "premium"`, and `src/routes/u.$username.tsx:168` renders a public "verified" checkmark straight off `profile.is_verified` — a user can bypass the paid-subscription flow and the admin verification workflow entirely, and spoof a public trust signal.
- **Recommendation:** Restrict `ProfileUpdate` to a client-editable allowlist (name, bio, avatar, city, country, language, contact prefs) enforced both in the TS type and via a Postgres `WITH CHECK`/trigger that only `service_role` can alter `user_type`/`is_verified`/`is_active`.
- **Resolution:** `ProfileUpdate` (`src/types/database.ts`) narrowed from `Partial<ProfileRow>` to an explicit `Pick` allowlist (`first_name`, `last_name`, `avatar_url`, `city`, `country`, `username`, `bio`, `language`, `email`, `profile_complete`) — a compile-time safety net. The real enforcement boundary is database-level; see **DB-1**'s resolution for the column-level-grant mechanism, which is what actually stops this exploit regardless of what the TS layer allows. No changes were needed to `AuthContext.tsx` itself — all existing call sites already only used fields inside the new allowlist.
- **Commit:** `bd356da`
- **Date:** Logged 2026-07-26, resolved 2026-07-26

### High

**AU-2 — Auth callback race: a slow `SIGNED_IN` handler can bounce a just-authenticated user to `/login`**
- **Status:** ✅ Resolved (2026-07-28)
- **Files:** `src/routes/auth.callback.tsx:65-89`
- **Description:** The `onAuthStateChange` handler is `async` (awaits a `profiles` select) before redirecting to `/dashboard` or `/onboarding`. A parallel `setTimeout(..., 5000)` unconditionally redirects to `/login`. `subscription.unsubscribe()` doesn't cancel the already-in-flight promise.
- **Risk:** If `SIGNED_IN` fires near the 5s mark, the in-flight profile fetch may still be pending when the timeout fires first, sending a successfully authenticated user back to the login screen.
- **Recommendation:** Track a `settled` flag (or `AbortController`) and clear the timeout as soon as `SIGNED_IN` handling begins, not only once it resolves.
- **Resolution:** The `setTimeout` id is now captured in a `timeoutId` variable, and `clearTimeout(timeoutId)` is called as the first, synchronous statement inside the `SIGNED_IN` branch — before the `await` for the profile fetch. Once real sign-in processing begins, the 5s login-fallback can no longer fire afterward, regardless of how long the profile fetch takes. Verified by trace of all three scenarios: early `SIGNED_IN` (timeout cleared, correct redirect, timeout never fires), `SIGNED_IN` never firing (timeout behavior unchanged), and `SIGNED_IN` at the ~5s boundary (now deterministically resolved in favor of the real sign-in outcome). No other control flow changed.
- **Commit:** —
- **Date:** Logged 2026-07-26, resolved 2026-07-28

**AU-3 — Onboarding form silently wipes user input when the language switcher is used**
- **Status:** ✅ Resolved (2026-07-28)
- **Files:** `src/routes/onboarding.tsx:47-76`
- **Description:** The profile-initialization effect calls every `setXxx` (name, city, country, bio, avatar, etc.) from `profile`/`user` metadata and depended on `language` from `useLanguage()`, even though `language` is only used inside the effect as a fallback default for one field. The page also renders `<LanguageSwitcher />`.
- **Risk:** Switching language at any point mid-onboarding re-runs the whole effect and overwrites everything the user has already typed, including step-2 fields and the uploaded avatar reference.
- **Recommendation:** Remove `language` from the effect's dependency array; key initialization only on `user?.id`/mount.
- **Resolution:** `language` removed from the effect's dependency array (`[loading, user, profile, navigate, language]` → `[loading, user, profile, navigate]`). The effect still runs on mount and whenever `user`/`profile` genuinely change; a language switch no longer re-triggers it, so typed fields and the uploaded avatar are preserved. One accepted, minor side effect: the `lang` radio-group no longer re-syncs to a language switch made via the switcher mid-onboarding — consistent with every other field no longer being wiped, not a new inconsistency (`lang`'s own `useState` initializer still captures `language` correctly on first render).
- **Commit:** —
- **Date:** Logged 2026-07-26, resolved 2026-07-28

### Medium

**AU-4 — StrictMode dev-mode remount permanently kills the auth-state listener**
- **Status:** Open
- **Files:** `src/context/AuthContext.tsx:89-120`
- **Description:** `initialized.current` is set `true` on first effect run to dedupe subscriptions, but is never reset in the cleanup function. Under React 18 StrictMode's mount→cleanup→remount dev cycle, the cleanup unsubscribes, but the ref is still `true` on remount, so the guard skips resubscribing.
- **Risk:** The auth-state listener is silently dead for the rest of the dev session — sign-out/token-refresh events stop updating state until a hard reload.
- **Recommendation:** Reset `initialized.current = false` in the effect's cleanup, or drop the guard entirely (subscribe/unsubscribe is idempotent).
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

**AU-5 — Duplicate/racing profile-load between `getSession()` and `onAuthStateChange`'s `INITIAL_SESSION` event**
- **Status:** Open
- **Files:** `src/context/AuthContext.tsx:95-117`
- **Description:** Supabase v2 fires `INITIAL_SESSION` through `onAuthStateChange` immediately on subscribe, in addition to the explicit `getSession().then()` call just above. Both independently call `loadOrCreateProfile` and set state with no ordering guard.
- **Risk:** Whichever resolves last wins — a transient stale/incorrect session or profile can be shown if they resolve out of order. `loadOrCreateProfile` also runs twice on load and again on every `TOKEN_REFRESHED`.
- **Recommendation:** Drive state from `onAuthStateChange` alone (it already fires `INITIAL_SESSION`), or use a generation counter/ref to discard out-of-order resolutions.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

**AU-6 — `loadOrCreateProfile` never checks Supabase error results**
- **Status:** 🕓 Should Fix After First Production Application (2026-07-28)
- **Files:** `src/context/AuthContext.tsx:28-83`
- **Description:** The initial SELECT (28–34), UPDATE (50–55), and INSERT (68–80) all destructure only `data`, never `error`. If the SELECT fails transiently, `existing` is `undefined` and the code falls into the INSERT branch for a user who already has a row — that insert fails on the primary key (also unchecked), and the function returns `null`.
- **Risk:** Downstream, `ProtectedRoute.tsx:21` and dashboard code then treat an existing, real user as having no/incomplete profile and can misroute them to onboarding.
- **Recommendation:** Check `error` at each step; distinguish "no row found" from a genuine query failure before deciding to insert.
- **Deferral rationale:** Classified as Should Fix After First Production Application. Defensive hardening for transient infrastructure failures. No data corruption. No production blocker.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

**AU-9 — `profiles.email` could silently diverge from the real Google-auth identity**
- **Status:** ✅ Resolved (2026-08-03)
- **Files:** `src/context/AuthContext.tsx` (`loadOrCreateProfile`); `src/lib/admin.functions.ts` (`userUpdateSchema`); `src/routes/admin.users.tsx`
- **Description:** Found during the Priority 8.6 audit: unlike `first_name`/`last_name`/`avatar_url` (covered by Identity Lock), `email` had nothing reconciling it against `auth.users.email` after first sign-in, and `admin.users.tsx`'s edit modal let an admin overwrite it directly — a second, independently-editable copy of what should be one identity fact. Not exploitable today (auth is Google-OAuth-only, so `auth.users.email` itself can't be spoofed), but a real Single-Source-of-Truth gap that matters once a public API treats `profiles.email` as authoritative.
- **Classification:** Architecture Deviation — auth identity is supposed to be the single source of truth for identity fields (`PROJECT_KNOWLEDGE.md` → Single Source of Truth).
- **Recommendation:** Always resync `profiles.email` from the auth identity on login (self-healing, no schema change needed), and remove the one admin override path so nothing else can make it diverge again.
- **Resolution:** `loadOrCreateProfile`'s patch logic changed from "fill in only if empty" (`if (!existing.email && u.email)`) to "always resync when different" (`if (u.email && existing.email !== u.email)`) — deliberately the opposite rule from Identity Lock's name/photo fields (which fill once and then lock), since email needs to track the live auth identity, not freeze the first-seen value. `admin.users.tsx`'s edit modal no longer exposes an editable Email field (now read-only display); `admin.functions.ts`'s `userUpdateSchema` had the `email` field removed entirely, so no admin server call can write it anymore. No dashboard-facing form (`dashboard.profile.tsx`, `dashboard.settings.tsx`) ever exposed an editable `profiles.email` field either (confirmed via grep), so the admin modal was the only override path to close.
- **Commit:** —
- **Date:** Logged 2026-08-02, resolved 2026-08-03

**AU-10 — Application resolution could silently fall back to a stale, unrelated application via the `app_override` cookie in production, causing a real Google Sign-In failure**
- **Status:** ✅ Resolved (2026-08-06)
- **Files:** `src/lib/application-resolver.functions.ts`; `src/context/ApplicationContext.tsx`; `src/routes/login.tsx`
- **Description:** Discovered live in production, deploying Core to `logid.pro` ahead of the `core.logid.pro` domain split: `resolveApplication`'s hostname-match step could return nothing (no `applications` row for the domain being visited), at which point resolution silently fell through to whatever application slug happened to be stored in the `app_override` cookie from earlier dev/testing use — no error, no warning. On the live domain this resolved to BosniaFans' application row (the only other one with an active Google Client ID in the browser's cookie history), so the Google Sign-In button initialized with BosniaFans' Google Client ID while Supabase's Google provider was configured to accept only Core's own Client ID, producing `AuthApiError: Unacceptable audience in id_token` on every login attempt.
- **Risk:** A cookie set for local/dev testing convenience could determine which application's branding and Google Client ID a real production visitor saw, with no way to detect this from the UI (the login button still rendered and appeared to work) — both a broken-login incident and, more generally, a non-deterministic production resolution path that violated "a correctly configured production domain must always resolve deterministically."
- **Classification:** Architecture gap, surfaced while designing Core's move to a centralized-Identity-Provider domain model (`core.logid.pro`, separate from every application it authenticates for) — see `PROJECT_KNOWLEDGE.md` → Authentication → "Core as a centralized Identity Provider."
- **Recommendation:** Give applications an explicit, stateless way to identify themselves to Core when initiating login, independent of Core's own hostname; make the cookie-based dev override structurally incapable of affecting a production build, not just unlikely to.
- **Resolution:** Added `?app=<slug>` as an explicit application-identification parameter on `/login`, resolved via a single `applications` lookup by `slug` with absolute priority over hostname and no dependency on cookies or prior sessions for identification itself; an `app` that fails to resolve now fails closed (returns no application) rather than falling through to any fallback. (Named `app`, not the initially-implemented `client_id` — that's an established OAuth/OIDC term for something else, an OAuth client identifier, and reusing it here was confusing; `client_id` is still accepted as a deprecated fallback alias, but every call site and every doc now uses `app`.) The pre-existing `app_override` cookie mechanism is unchanged in shape but now gated behind `import.meta.env.DEV`, a Vite build-time constant — confirmed, by inspecting the compiled production server bundle directly, that the entire cookie mechanism (both the write, when an explicit `app` resolves, and the read, as a fallback) is dead-code-eliminated from a production build, not merely conditionally skipped at runtime. A login reached via explicit `app` now completes through the existing, unmodified `POST /v1/auth/session` and redirects the user back to that application's own registered `domain` with the resulting CORE token pair in the URL fragment (standard OAuth2 Implicit Grant shape) — the redirect target is always read from the resolved application's own database row, never from client-supplied input, so this introduces no open-redirect surface. A same-origin login (no explicit `app` — Core's own admin/dashboard access) is completely unchanged.
- **Commit:** —
- **Date:** Logged and resolved 2026-08-06

### Low

**AU-7 — `LanguageContext` syncs the profile's language only once per page load, not per signed-in user**
- **Status:** Open
- **Files:** `src/context/LanguageContext.tsx:28,40-49`
- **Description:** `syncedFromProfile` is a `useRef(false)` flipped `true` on the first profile load and never reset.
- **Risk:** On a shared session where user A logs out and user B logs in without a full page reload, user B's stored language preference is never applied.
- **Recommendation:** Reset the ref (or key it off `user?.id`) whenever the signed-in user changes.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

**AU-8 — `AuthContext` value object is unmemoized, causing excess re-renders across every consumer**
- **Status:** Open
- **Files:** `src/context/AuthContext.tsx:122-179`
- **Description:** The context `value` (including all async method closures) is rebuilt inline on every `AuthProvider` render with no `useMemo`.
- **Risk:** Every component calling `useAuth()` re-renders whenever `AuthProvider` re-renders, regardless of whether `session`/`profile`/`loading` actually changed. Directly compounds **PE-3**.
- **Recommendation:** Wrap `value` in `useMemo` keyed on `session`, `profile`, `loading`; wrap methods in `useCallback`.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

---

## 3. Dashboard

**Flow:** `src/components/dashboard/DashboardPage.tsx` is the main authenticated shell (sidebar + quick links + trial/notification widgets), with sub-pages under `src/routes/dashboard.*.tsx` (profile, settings, security, subscriptions, notifications, help). Supporting widgets: `NotificationBell.tsx` (badge + realtime toast), `TrialBanner.tsx`, `ShareAndInvite.tsx` (clipboard/native-share links).

### High

**DA-1 — Clipboard API used with no availability/error handling (5 call sites)**
- **Status:** Open
- **Files:** `src/components/dashboard/ShareAndInvite.tsx:49-61,71,87-90,96-99`
- **Description:** `navigator.clipboard.writeText(...)` is called unconditionally — no check that `navigator.clipboard` exists (undefined in non-secure/HTTP contexts, older WebViews, or when Permissions Policy denies `clipboard-write`) and no `try/catch` around the call.
- **Risk:** `copied`/`inviteCopied` UI state can flip to "copied" even when the write actually failed, since it isn't gated on the promise resolving — broken core feature with no error feedback.
- **Recommendation:** Feature-detect `navigator.clipboard?.writeText`, wrap in try/catch, only set "copied" state on confirmed success, and show an error/fallback UI otherwise.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

### Medium

**DA-2 — Notification bell's unread badge is capped at 5 and disconnected from the correct count**
- **Status:** ✅ Resolved (2026-08-11, Priority 15 Phase D — fixed while already touching this file for MSG-3, per the commitment noted in `PROJECT_KNOWLEDGE.md` → Missions, Challenges & Streaks)
- **Files:** `src/components/dashboard/NotificationBell.tsx`
- **Description:** The bell derives its unread count from only the 5 most-recently-fetched notifications. A correct `count: "exact", head: true` query already exists in `DashboardPage.tsx` but is never referenced again after being declared (dead code — see **CO-5**) and isn't wired to `NotificationBell`.
- **Risk:** A user with more than 5 unread notifications never sees an accurate badge count; the unused query also wastes a network request every dashboard load (see **PE-5**).
- **Resolution:** `NotificationBell.tsx` now runs its own `count: "exact", head: true` query (the same pattern `DashboardPage.tsx`'s dead query already used) for the badge, invalidated by the same realtime subscription and mark-read handlers that already refresh the notification list. **Deliberately not touched:** the dead query in `DashboardPage.tsx` itself (**CO-5**/**PE-5**) — a separate file/finding this fix didn't need to depend on; left open, not silently folded in.
- **Commit:** (Priority 15 Phase D — see `CLAUDE.md` → Priority 15 for the commit hash)
- **Date:** 2026-08-11

**DA-3 — "Settings" quick-link tile routes back to `/dashboard` instead of `/dashboard/settings`**
- **Status:** ✅ Resolved (2026-07-28)
- **Files:** `src/components/dashboard/DashboardPage.tsx` (Quick Links array; compare the sidebar entry in the same file, which already correctly used `/dashboard/settings`)
- **Description:** Apparent copy/paste from the "Home" entry above it in the same Quick Links array.
- **Risk:** Clicking "Settings" from Quick Links just reloads the dashboard instead of navigating to settings.
- **Recommendation:** Change the `to` value to `/dashboard/settings`.
- **Resolution:** Changed the Quick Links entry's `to` value from `/dashboard` to `/dashboard/settings`. Single-line change, no other code touched.
- **Commit:** —
- **Date:** Logged 2026-07-26, resolved 2026-07-28

**DA-4 — Sidebar highlights three unrelated nav items simultaneously**
- **Status:** Open
- **Files:** `src/components/dashboard/DashboardPage.tsx`, `Sidebar` function, lines 564-573, 588-593
- **Description:** Home/Applications/Payments sidebar entries all set `to="/dashboard"`, combined with `activeProps`/`activeOptions={{ exact: true }}`. TanStack Router applies "active" styling to every `<Link>` whose `to` matches the current route.
- **Risk:** All three sidebar entries appear active on the dashboard at once — looks like placeholder routes (`/dashboard/applications`, `/dashboard/payments`) that were never built out.
- **Recommendation:** Give Applications/Payments their own routes, or stop applying `activeProps` to unbuilt placeholder links.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

**DA-5 — `updateAppSetting` computes its payload from a stale closure over `appSettings`**
- **Status:** ✅ Resolved (2026-07-30)
- **Files:** `src/routes/dashboard.settings.tsx:90-122`
- **Description:** The function optimistically updates state via `setAppSettings((prev) => prev.map(...))`, then immediately reads `appSettings.find(...)` from the outer closure — which still holds the pre-update value.
- **Risk:** Two quick successive toggles on the same app (e.g. "visible in directory" then "can be contacted") can cause the second write's fallback values to silently revert the first toggle in the database.
- **Recommendation:** Derive the write payload from the functional updater's `prev` argument (or a ref), not from the outer closure variable.
- **Resolution:** Reopened and fixed during the User Settings completion pass — the write payload is now computed inside the `setAppSettings((prev) => ...)` updater itself (captured into a local variable from the freshly-merged `next` array), not from the outer closure. No longer deferred: fixing it cost nothing extra while already rewriting adjacent code in the same file for the notification-preferences bug below, so there was no reason to leave a known, already-diagnosed bug in place.
- **Commit:** —
- **Date:** Logged 2026-07-26, resolved 2026-07-30

**DA-6 — `payment.success.tsx` never stops polling and has no failure/timeout state**
- **Status:** Open
- **Files:** `src/routes/payment.success.tsx:32-53`
- **Description:** A `useQuery` with `refetchInterval: 3000` is combined with a second, independent `setInterval` that bumps an `attempts` counter every 3s — and `attempts` is part of the query key, so each tick creates a new cache entry instead of refetching the same one. Neither mechanism stops once `activated` becomes true.
- **Risk:** Unbounded query-cache growth and doubled network traffic for as long as the tab is open; if the webhook never lands (failed/cancelled payment, processing error), the user is stuck on an infinite spinner with no retry link or support fallback. See also **PE-1**.
- **Recommendation:** Use `refetchInterval` alone (drop the manual counter/queryKey mutation), stop refetching once `activated` is true, and add a timeout branch with a "still processing / contact support" state.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

**DA-7 — Payment success is confirmed by "any active subscription," not the specific transaction**
- **Status:** 🕓 Should Fix After First Production Application (2026-07-28)
- **Files:** `src/routes/payment.success.tsx:19-22,36-46`
- **Description:** `search.app_id` is optional in `validateSearch`. When absent, the success check becomes "does this user have any active subscription" rather than "did this checkout activate."
- **Risk:** A user with a pre-existing subscription for App A who lands on this page for an unrelated/failed App B checkout will see "success" despite nothing new being purchased.
- **Recommendation:** Require `app_id` (and ideally a server-verified transaction/session id) to render success; correlate against the specific subscription/payment row created for that transaction.
- **Deferral rationale:** Classified as Should Fix After First Production Application. Requires a specific edge-case navigation path. Does not affect entitlement correctness. Not a production blocker.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

### Low

**DA-8 — `activateTrial` failure permanently blocks retry for the browser session, error swallowed silently**
- **Status:** ✅ Resolved (2026-08-03)
- **Files:** `src/components/dashboard/DashboardPage.tsx:93-107` (as of the original finding)
- **Description:** `triedTrialRef.current = true` is set synchronously (line 98) before `activateTrial()` resolves/rejects, and failures are swallowed by an empty `.catch(() => {})` (line 106).
- **Risk:** A transient failure (network blip) leaves the ref `true` for the component's lifetime, so an eligible user never gets the trial activated that session, with no error surfaced anywhere.
- **Recommendation:** Only set the ref on success (or a definitive "not eligible" response); log/surface failures instead of swallowing them.
- **Resolution:** Not fixed in place — resolved by architectural removal (Priority 8.5, Promotional Trial Policy). The entire automatic-activation mechanism this finding describes (`activateTrialIfEligible`, `triedTrialRef`, the client-side effect in `DashboardPage.tsx`) no longer exists: registration always creates a Standard account, and a Trial is only ever created explicitly via `/admin/trials` (`adminGrantPromotionalTrial`). There is nothing left for a client-side retry bug to affect.
- **Commit:** —
- **Date:** 2026-07-26 (opened) / 2026-08-03 (resolved)

**DA-9 — Hardcoded, non-localized delete-confirmation phrase**
- **Status:** ✅ Resolved (2026-07-30)
- **Files:** `src/routes/dashboard.settings.tsx`; `src/locales/{bs,en,de}.json`
- **Description:** Account deletion requires typing the literal Bosnian word `"OBRIŠI"` regardless of active UI language, while everything else in the dialog is translated via `t()`. Confirmed live: EN/DE locale strings literally read "Type OBRIŠI to confirm" / "Geben Sie OBRIŠI ein" — telling English/German users to type a Bosnian word.
- **Risk:** Confusing for EN/DE users in an otherwise fully localized dialog.
- **Recommendation:** Localize the required confirmation token per language, or clearly state that the literal word is required irrespective of language.
- **Resolution:** Added a new `privacy.deleteConfirmWord` key per locale (`OBRIŠI` / `DELETE` / `LÖSCHEN`); `typeToConfirm` and `deleteMismatch` now interpolate `{{word}}` instead of hardcoding the Bosnian literal. The input placeholder, the disabled-state check, and `handleDelete`'s comparison all read the same localized word, so the confirmation phrase now matches the active language everywhere it appears.
- **Commit:** —
- **Date:** Logged 2026-07-26, resolved 2026-07-30

**DA-10 — `ShareAndInvite` builds profile/invite URLs without `encodeURIComponent`**
- **Status:** Open
- **Files:** `src/components/dashboard/ShareAndInvite.tsx:41-45`
- **Description:** `username` is currently always machine-generated and URL-safe (see `src/lib/username.ts`), but the component performs no defensive encoding when building `profileUrl`/`inviteUrl`.
- **Risk:** Not exploitable today, but a future editable-username feature would silently reintroduce broken/unsafe URLs.
- **Recommendation:** Wrap `username` in `encodeURIComponent(...)` regardless of upstream guarantees.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

**DA-11 — `NotificationBell` tears down and re-subscribes its realtime channel on every language change**
- **Status:** Open
- **Files:** `src/components/dashboard/NotificationBell.tsx:54-85` (effect deps `[user?.id, qc, lang]` at line 85)
- **Description:** `lang` is only used inside the toast-formatting closure but is included in the effect's dependency array.
- **Risk:** Switching languages needlessly tears down and recreates the Supabase realtime subscription — a small window where events could be missed — even though `user.id` hasn't changed. See also **PE-6**.
- **Recommendation:** Read `lang` via a ref instead of a dependency, so only `user?.id` drives resubscription.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

---

## 4. Admin Panel

**Flow:** `src/routes/admin.tsx` (`AdminGate`) is the parent layout for all `/admin/*` child routes and blocks the `<Outlet/>` for non-admins — confirmed via `routeTree.gen.ts` that every admin page (`admin.applications`, `admin.communication`, `admin.payments`, `admin.users`, `admin.verification`, `admin.advertising`, `admin.trials`, `admin.capabilities`, `admin.dashboard-widgets`, `admin.rewards`) is a child of it. Every mutating server function in `src/lib/admin.functions.ts` independently calls `assertAdmin()` (`src/lib/admin.server.ts`) which checks the `user_roles` table server-side. **This layered gating is correctly implemented** — no IDOR/auth-bypass was found on admin routes.

### Critical

**AD-11 — Capabilities, Dashboard Widgets, and most of Rewards & Loyalty had zero admin UI — configurable only via direct SQL**
- **Status:** ✅ Resolved (2026-08-03)
- **Files:** `src/routes/admin.capabilities.tsx` (new), `src/routes/admin.dashboard-widgets.tsx` (new), `src/routes/admin.rewards.tsx` (new), `src/routes/admin.tsx` (hub wiring); `src/lib/rewards.functions.ts` (`adminUpsertRewardLevel`/`adminListRewardLevels`, `adminUpsertRewardAchievement`/`adminListRewardAchievements`, `adminListRewardConfig`, all new)
- **Description:** Found during the Priority 8.6 audit: `adminListCapabilityDefinitions`/`adminUpsertCapabilityDefinition`/`adminSetApplicationCapability` (Phase 8.1) and `adminListDashboardWidgets`/`adminUpsertDashboardWidget`/`adminSetDashboardWidgetAppSetting` (Phase 8.2) were never imported by any route file — confirmed by grep across the whole `src/routes/` tree, zero matches. `application_capabilities` therefore defaulted to no rows for every application, and since `dashboard_widgets`' `rewards`/`advertising` entries both declare `requires_capability`, `getDashboardWidgets()` hid both widgets for every application until someone manually inserted a row via direct Supabase access. The same gap existed one level deeper in Rewards: `adminUpsertRewardActionRule`/`adminUpsertRewardFulfillmentType`/`adminUpsertRewardCatalogItem`/`adminSetRewardConfig` all existed and worked, but no `admin.rewards.tsx` page made any of them reachable, and `reward_levels`/`reward_achievements` had no admin server function at all — not even the backend half existed.
- **Risk:** Two Core Development Priorities marked ✅ Completed (Capabilities, Dashboard Widget Modularity), plus half of two more (Rewards & Loyalty, Advertising), were non-operational in practice — every application's Rewards/Advertising widgets stayed invisible to end users, and no administrator could configure any of it without raw database access. Not a security defect — an operational completeness gap large enough to block using what had already been built.
- **Recommendation:** Build the missing admin UI for all of the above before or alongside `/v1` API design.
- **Resolution:** Three new admin pages, following the exact Card-based pattern already established by `/admin/advertising`: **`/admin/capabilities`** (register/enable/archive capability definitions; toggle a capability per application). **`/admin/dashboard-widgets`** (register/enable widget definitions including `requiresCapability`; toggle a widget per application). **`/admin/rewards`** (action rules, levels, achievements, redemption catalog, fulfillment types, and configuration — including the referral-verification-period setting `rewards.server.ts` reads). The two missing backend halves (`reward_levels`, `reward_achievements`) were added to `rewards.functions.ts` first, following the identical `assertAdmin()` + `writeAuditLog()` + upsert-by-id pattern every other registry CRUD function in this repo already uses — no new pattern introduced. All three pages wired into the `/admin` hub's card grid. No SQL is required for normal administration of any of these systems anymore.
- **Commit:** —
- **Date:** Logged 2026-08-02, resolved 2026-08-03

### Medium

**AD-1 — Three divergent definitions of "active premium subscription" across `admin.functions.ts`**
- **Status:** ✅ Resolved (2026-07-28)
- **Files:** `src/lib/admin.functions.ts` (`adminOverviewStats`, `adminSendNotification`, `adminListVerificationRequests`)
- **Description:** Only `adminOverviewStats` checked `status="active"` AND `expires_at > now()` AND `started_at <= now()`. `adminSendNotification` and `adminListVerificationRequests` both checked only `status="active"`, with no expiry check.
- **Risk:** If a cron/webhook hasn't yet flipped a lapsed subscription's `status` to `"expired"`, the other two functions still treat it as active — broadcasting "premium-only" notifications to, and surfacing as verification candidates, users whose subscription has actually lapsed.
- **Classification:** Architecture Deviation — three separate app-level implementations of what should be one Core-owned "is this user's subscription active" answer, per `PROJECT_KNOWLEDGE.md` → Single Source of Truth. Severity intentionally left at Medium (correctness/consistency issue, not an exploitable defect).
- **Recommendation:** Extract one shared "is currently active premium" predicate and use it in all three places.
- **Resolution:** `adminSendNotification` and `adminListVerificationRequests` now select `expires_at` alongside `user_id`/`status` and filter results through `isSubscriptionActiveNow` (`src/lib/subscription.ts`) — the same shared predicate already established for the dashboard in Priority 2 (Dashboard Consistency), reused here rather than duplicated. `adminOverviewStats` was deliberately left unchanged: it already applied the correct, stricter condition (it was the one place that wasn't broken), and it filters at the DB-query level for aggregate-count performance rather than fetching rows to filter in-process — rewriting it to route through the shared function would trade a reasonable stats-query pattern for no correctness gain. All three now agree on what "currently active" means; the only remaining difference (`adminOverviewStats`'s additional `started_at <= now()` guard) is an intentional, stats-specific refinement, not a divergence in the core definition.
- **Commit:** —
- **Date:** Logged 2026-07-26, resolved 2026-07-28

**AD-2 — `PlanForm` doesn't resync its local state after a save**
- **Status:** 🚫 Deferred (2026-07-28)
- **Files:** `src/routes/admin.applications.tsx:224-235` (contrast `AppSettings` in the same file, lines 383-390, which does resync correctly)
- **Description:** State is seeded once from `initial` with no resync effect. After a save triggers `qc.invalidateQueries(["admin-plans", activeAppId])` and a refetch, the same-keyed `PlanForm` instance keeps its stale local state.
- **Risk:** Can silently diverge from what's actually persisted (e.g. after a concurrent edit in another admin tab). The "new plan" form also never resets after a successful create.
- **Recommendation:** Add a `useEffect` keyed on `initial.id`/`updated_at` to resync local state; reset the "new plan" form on successful create.
- **Deferral rationale:** The described risk assumes a second, concurrently-editing administrator — but the platform's Single Administrator Rule (`CLAUDE.md`) means there is, by design, never more than one administrator. The only realistic trigger is the same person with two browser tabs open, a narrow, self-inflicted scenario with no data-integrity consequence (a save just re-persists the values shown). Reassessed as a minor UI-polish item, not a production risk, under the current single-admin architecture — deferred rather than fixed.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

**AD-3 — Admin user search fires a full query on every keystroke**
- **Status:** 🚫 Deferred (2026-07-28)
- **Files:** `src/routes/admin.users.tsx:44,50-53`
- **Description:** `search` state is included directly in the `useQuery` key (`["admin-users", search]`) with no debounce.
- **Risk:** `adminListUsers` (an `ilike` scan) re-runs on every keystroke. See also **PE-2**.
- **Recommendation:** Debounce the search value (~300ms) before it feeds the query key.
- **Deferral rationale:** The load source is a single administrator's own keystrokes, bounded by the Single Administrator Rule (`CLAUDE.md`) — this can never become a multi-user hot path. No incorrect results, only a theoretical, unbounded-by-real-usage efficiency nicety. Reassessed as performance-only with negligible business value under the current single-admin architecture — deferred rather than fixed.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

**AD-4 — `payments.invoice_url` stores a raw Stripe object ID, not a browsable URL**
- **Status:** 🚫 Deferred (2026-07-27)
- **Files:** `src/routes/api/public/webhooks/stripe.ts:142`; rendered at `src/routes/admin.payments.tsx:73-74`
- **Description:** An un-expanded Stripe Checkout `Session.invoice` field is just the Invoice object's ID (e.g. `in_1Nx...`), not a URL. Stored verbatim under a column named `invoice_url`.
- **Risk:** Renders as a broken link in the admin payments list.
- **Recommendation:** Expand the invoice (`expand: ["invoice"]`) and store `invoice.hosted_invoice_url`, or drop the field.
- **Deferral rationale:** Purely cosmetic (admin-only broken link, no security/financial impact) — deliberately not fixed as part of the Stripe integrity pass. The audit's original recommendation would add an extra outbound Stripe API call inside the payment-fulfillment webhook, which is the wrong place to add new latency/failure surface for a cosmetic fix. If picked up later, prefer fetching the invoice URL lazily and on-demand from the admin payments page itself, not inside the webhook.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

**AD-12 — `applications.domain` isn't case-normalized at write time**
- **Status:** ✅ Resolved (2026-08-03)
- **Files:** `src/lib/admin.functions.ts` (`domainSchema`, shared by `appCreateSchema`/`appSettingsSchema`); `supabase/migrations/20260804100000_core_audit_resolution.sql` (data fix for already-stored rows)
- **Description:** Found during the Priority 8.6 audit: the Application Resolver lowercases the incoming `Host` header at read time (`extractHostname()`), but nothing normalized what an admin typed when creating/editing an application's `domain`. A domain entered with any uppercase would silently and permanently break brand resolution for that application — the single mechanism the entire multi-brand architecture depends on.
- **Risk:** A typo an admin wouldn't notice (case is usually invisible in casual reading) permanently breaks an application's domain resolution until someone finds and fixes the stored value.
- **Recommendation:** Normalize to lowercase in the same Zod schema that validates the admin's create/update payload, and backfill any already-stored mixed-case value.
- **Resolution:** A shared `domainSchema` (`z.string().trim().toLowerCase()...`) now backs both `appCreateSchema.domain` and `appSettingsSchema.domain`, so every future write is normalized before it reaches the database regardless of what the admin typed. The accompanying migration additionally backfills any already-stored mixed-case `domain` to lowercase (`UPDATE ... SET domain = lower(domain) WHERE domain <> lower(domain)`) — a pure data-consistency fix, no application relying on an already-correct lowercase domain is affected.
- **Commit:** —
- **Date:** Logged 2026-08-02, resolved 2026-08-03

**AD-13 — Four admin surfaces didn't count Promotional Trial as Premium**
- **Status:** ✅ Resolved (2026-08-03)
- **Files:** `src/lib/admin.functions.ts` (`adminListUsers`, `adminOverviewStats`, `adminSendNotification`, `adminListVerificationRequests`)
- **Description:** Found during the Priority 8.6 audit: all four functions queried `subscriptions` directly for "is this user Premium" and never joined `promotional_trials`, so a user who was Premium only via a Trial was invisible to admin filtering, the dashboard's Active Premium stat, "Premium-only" broadcasts, and verification-request eligibility. Priority 8.5 updated the one shared SQL function (`has_any_active_premium()`) but never revisited these four call sites — the same "two places compute the same answer differently" pattern as **AD-1**.
- **Classification:** Architecture Deviation — see **A-5** for the root-cause fix (no shared bulk resolver existed).
- **Recommendation:** Route all four through the same shared resolver `has_any_active_premium()` uses.
- **Resolution:** All four now resolve Premium status through `resolvePremiumStatusBulk()`/`resolvePremiumStatus()` (**A-5**'s new `src/lib/premium.server.ts`), which correctly ORs `subscriptions` and `promotional_trials` exactly like the shared SQL function. `adminOverviewStats`'s Active Premium stat also had its own separate bug fixed in the same pass: it was computing "active" via a `MIN_MS = 28 days` heuristic combined with `amount_paid > 0` (a leftover proxy from before Promotional Trials existed as a separate table) instead of an actual active-subscription check — replaced with the resolver's count, so the stat's definition now matches `hasAnyActivePremium()` exactly.
- **Commit:** —
- **Date:** Logged 2026-08-02, resolved 2026-08-03

**AD-14 — `adminDeletePlan` performed a real hard `DELETE` on subscription plans, the only one found in the audit**
- **Status:** ✅ Resolved (2026-08-03)
- **Files:** `src/lib/admin.functions.ts` (`adminArchivePlan`, was `adminDeletePlan`); `src/routes/admin.applications.tsx`
- **Description:** Found during the Priority 8.6 audit: `subscription_plans` already has an `is_active` column for exactly this purpose, yet the admin UI wired a `Trash2` button straight to `DELETE FROM subscription_plans` — inconsistent with the soft-lifecycle convention every other registry table in this repo follows. A plan referenced by any subscription would fail with a raw, unhandled Postgres FK error surfaced directly to the admin.
- **Recommendation:** Replace the hard delete with `UPDATE ... SET is_active = false`, matching the convention `enabled`/`archived` tables already use.
- **Resolution:** `adminDeletePlan` renamed to `adminArchivePlan`; its body changed from `.delete()` to `.update({ is_active: false })`, action renamed `"plan.archive"`, and it now returns the updated row instead of a bare `{ ok: true }`. `admin.applications.tsx`'s delete button was replaced with an archive button (`Archive` icon, `disabled` once already archived) — no FK error is reachable anymore since nothing is ever actually deleted.
- **Commit:** —
- **Date:** Logged 2026-08-02, resolved 2026-08-03

### Low

**AD-5 — Redundant duplicate admin-check calls on every admin sub-page**
- **Status:** Open
- **Files:** `src/routes/admin.applications.tsx:38-42`, `src/routes/admin.users.tsx:38-42`
- **Description:** Both pages independently call `getMyIsAdmin` and re-gate rendering, even though the parent `AdminGate` already verified admin status.
- **Risk:** Not a security issue (belt-and-suspenders), just an extra round trip and loading flash on every admin navigation.
- **Recommendation:** Rely on the parent route's verified state (e.g. via route context) instead of re-fetching per child page.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

**AD-6 — Debug `console.log` of user id/role on every admin check**
- **Status:** Open
- **Files:** `src/lib/admin.functions.ts:222`
- **Description:** `console.log("[getMyIsAdmin]", { userId, role })` runs on essentially every page load that checks admin UI visibility.
- **Risk:** Per-request log noise in production.
- **Recommendation:** Remove or gate behind a debug flag.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

**AD-7 — `addMonthsIso` has a month-end rollover bug affecting every subscription's expiry date**
- **Status:** ✅ Resolved (2026-07-27)
- **Files:** `src/lib/admin.server.ts:36-43`; consumed at `stripe.ts:159`, `paypal.ts:150`, `admin.functions.ts:93-108`
- **Description:** Uses `Date.prototype.setMonth`, which overflows into the following month when the target month has fewer days than the current day-of-month (e.g. Jan 31 + 1 month → Mar 3, not Feb 28/29).
- **Risk:** Every subscription's `expires_at` computed from a purchase near month-end can be inconsistent.
- **Recommendation:** Clamp the day-of-month after `setMonth`, or use a date library with explicit end-of-month handling.
- **Resolution:** `addMonthsIso` now sets the date to the 1st before changing the month (avoiding overflow during the month change itself), computes the target month's actual last day via `new Date(year, month + 1, 0).getDate()`, and clamps the original day-of-month to that value before setting it. A day that fits in the target month (the common case) is unaffected; a day that doesn't (e.g. the 31st against a 28/29/30-day target month) is clamped to that month's last day instead of overflowing into the next one. Self-contained change to the one pure function — no callers needed to change.
- **Commit:** —
- **Date:** Logged 2026-07-26, resolved 2026-07-27

**AD-8 — Pervasive `as never` casts on admin write payloads defeat compile-time schema checking**
- **Status:** ✅ Resolved (2026-07-31)
- **Files:** `src/lib/admin.functions.ts` (all 12 prior occurrences), `src/lib/admin.server.ts`, `src/lib/notifications.functions.ts`, `src/lib/trial.functions.ts`, `src/routes/api/public/webhooks/{stripe,paypal}.ts`, `src/routes/admin.users.tsx`
- **Description:** Nearly every insert/update payload was cast `as never` to satisfy Supabase's stale/incomplete generated types (`src/integrations/supabase/types.ts`) — a snapshot from before several live migrations, missing `has_any_active_premium`/`get_premium_application_ids`/`get_visible_application_ids` entirely and still typing the already-dropped single-argument `is_user_premium`.
- **Risk:** None of these write paths got real compile-time verification against the actual schema — a column rename/typo wouldn't have been caught until runtime.
- **Recommendation:** Regenerate the real generated table types, then remove the `as never` casts.
- **Resolution:** `src/integrations/supabase/types.ts` regenerated via `supabase gen types typescript` against the live (fully migration-synced, see **DB-6**) database. Of the 41 `as never` occurrences repo-wide, 39 were removed cleanly (verified individually: each file was stripped and re-typechecked before the removal was kept) and 2 remain, both deliberately: `src/lib/admin.server.ts`'s `writeAuditLog` narrows genuinely-`unknown` caller data to the DB's `Json` type (an honest `as Json`, not `as never`) since arbitrary caller data can't be verified as JSON-serializable at compile time; `src/routes/api/public/webhooks/stripe.ts`'s pinned Stripe API version string predates the installed SDK's typed literal, an unrelated pre-existing issue this cast happened to also mask — see **SE-18**, left as a documented cast rather than silently changing a payment-webhook's pinned API version as a side effect of this cleanup.
- **Commit:** —
- **Date:** Logged 2026-07-26, resolved 2026-07-31

**AD-9 — `planInputSchema.currency` accepts any string, not a constrained set**
- **Status:** Open
- **Files:** `src/lib/admin.functions.ts:28`
- **Description:** `currency: z.string().default("EUR")` has no enum/allowlist.
- **Risk:** Permits malformed currency codes into `subscription_plans.currency`.
- **Recommendation:** Constrain to `z.enum([...])` of actually-supported currencies.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

**AD-10 — `profiles.user_type`'s Premium flag drifted permanently after `adminRevokePremium` (never reset it), and duplicated what `hasAnyActivePremium()` already answers correctly**
- **Status:** ✅ Resolved (2026-07-31)
- **Files:** `src/lib/admin.functions.ts` (`adminGrantPremium`, `adminRevokePremium`, `adminListUsers`), `src/routes/api/public/webhooks/{stripe,paypal}.ts`, `src/routes/admin.users.tsx`
- **Description:** Discovered during the Global Premium Visibility & Contact System's documentation/architecture pass: `adminGrantPremium` set `profiles.user_type = "premium"`, but `adminRevokePremium` only cancelled the `subscriptions` row — it never reset `user_type` back to `"standard"`. `admin.users.tsx` displayed `user_type` directly (list badge, filter dropdown, detail modal), so a revoked user's admin-panel badge stayed stuck on "premium" indefinitely. Both Stripe and PayPal webhooks also wrote `user_type` on fulfillment, and Stripe's refund handler separately tried (correctly, but redundantly) to revert it.
- **Risk:** Admin-facing display bug (a revoked user still shown/filterable as "Premium"), plus a second, independently-maintained representation of Premium status that could silently diverge from the real, live-computed answer.
- **Classification:** Architecture Deviation — a stored duplicate of what the CORE Premium Service (`hasAnyActivePremium()`) already answers authoritatively, contradicting Single Source of Truth.
- **Recommendation:** Stop writing `user_type` for Premium purposes anywhere; derive admin-panel Premium display/filtering from `subscriptions` directly, the same predicate `hasAnyActivePremium()` uses.
- **Resolution:** Removed the `user_type` write from `adminGrantPremium`, both webhooks' fulfillment paths, and Stripe's refund-revert block entirely (nothing left to revert once nothing writes it). `adminListUsers` now resolves a `premiumFilter` ("premium"/"standard") against `subscriptions` directly and returns each row with a computed `is_premium` boolean; `admin.users.tsx`'s badge, filter dropdown, and detail modal all consume `is_premium` instead of `user_type`. The filter dropdown's "Admin"/"Super admin" options were also dropped — they filtered against `user_type` values no code has ever written (see **DB-3**), so they always returned zero rows; removing them alongside the rest of this same column's filter logic was in scope, not a separate change. `profiles.user_type` itself is left in the schema, unused, pending an explicit decision on whether to drop it (see `PROJECT_KNOWLEDGE.md` → Database tables).
- **Commit:** —
- **Date:** 2026-07-31

**AD-15 — `adminUpsertAdPlacementPrice` never exposes `stripe_payment_link`/`paypal_payment_link` for editing**
- **Status:** Open
- **Files:** `src/lib/advertising.functions.ts` (`placementPriceSchema`, `adminUpsertAdPlacementPrice`)
- **Description:** Discovered while implementing `PATCH /v1/admin/advertising/prices/{id}` (Priority 8.11): `ad_placement_prices.stripe_payment_link`/`.paypal_payment_link` are real, populated columns (every other Payment-Link-bearing row in this codebase, e.g. `subscription_plans`, sets them at creation), but `placementPriceSchema` never accepts them, so an admin can create/edit a price row with every other field except its own checkout links through the existing Admin panel surface.
- **Risk:** Low — an admin can still set these two columns directly via SQL/database access, and the `/v1` admin endpoint now documented in `API_CONTRACT.md` §14 does expose them correctly. But the pre-existing in-app Admin panel path for Advertising pricing remains incomplete for this one surface.
- **Recommendation:** Add `stripePaymentLink`/`paypalPaymentLink` to `placementPriceSchema` and thread them through to the `ad_placement_prices` upsert, matching the shape `/v1/admin/advertising/prices` already uses.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-08-05

---

## 5. Database (Supabase / Postgres / RLS)

**Structure:** 17 sequential migrations (`supabase/migrations/*.sql`) build out `profiles`, `premium_profiles`, `subscriptions`, `subscription_plans`, `payments`, `notifications`, `user_roles`, `audit_logs`, and related tables/views, with Row-Level Security policies throughout. The final migration (`20260725070421_...sql`) correctly hardens several earlier over-permissive public-read policies by introducing masking views (`profiles_public`, `premium_profiles_public`) and a scoped `is_user_premium()` function — this later hardening pass is sound and was verified to fully supersede the earlier exposure (see **DB-5**).

### Critical

**DB-1 — `profiles` UPDATE policy has no `WITH CHECK`, letting any user rewrite their own trust-sensitive columns**
- **Status:** ✅ Resolved (2026-07-26)
- **Files:** `supabase/migrations/20260724110804_f95931a7-2e9e-417c-8a33-e9aedac500de.sql:31`; `supabase/migrations/20260726120000_protect_profile_privileged_columns.sql` (fix)
- **Description:** `CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);` — Postgres RLS uses the `USING` clause as the implicit `WITH CHECK` for `UPDATE` when none is given. Since `id` can't change, the check always passes, and `GRANT UPDATE ON public.profiles TO authenticated` covers every column, including `user_type`, `is_verified`, `is_active`. No later migration adds a restrictive check or column-level grant.
- **Risk:** This is the database-level root cause of **AU-1** (client-side exploit path) and feeds directly into the public "verified" badge shown at `src/routes/u.$username.tsx:168` and the `profiles_public` view, which republishes `user_type`/`is_verified` to anonymous visitors.
- **Recommendation:** Add a `WITH CHECK`/`BEFORE UPDATE` trigger that reverts `user_type`/`is_verified`/`is_active` unless the caller is `service_role`, or move those columns to a separate table only `service_role` can write.
- **Resolution:** Implemented via **column-level privileges** rather than the originally-recommended trigger (a trigger, a separate-table split, and a `SECURITY DEFINER` RPC were all evaluated and compared on security/maintainability/PostgREST-compatibility/future-development-impact before deciding — see commit history for the full comparison). `REVOKE UPDATE ON public.profiles FROM authenticated` followed by `GRANT UPDATE (first_name, last_name, avatar_url, city, country, username, bio, language, email, profile_complete) ON public.profiles TO authenticated` — `id`, `user_type`, `is_verified`, and `is_active` are deliberately not granted, so only `service_role` (unaffected — it holds a separate table-level `GRANT ALL`) can write them. Chosen over a trigger specifically because it's enforced by Postgres before RLS/triggers even run, needs no custom logic, and is **fail-closed for future columns** (a new column is unwritable by `authenticated` until explicitly granted, vs. a trigger which is fail-open until someone remembers to extend it). The RLS policy's `WITH CHECK (auth.uid() = id)` was also made explicit (behaviorally unchanged) in the same migration.
- **Commit:** `bd356da`
- **Date:** Logged 2026-07-26, resolved 2026-07-26

**DB-2 — `subscriptions.UNIQUE(user_id, app_id)` combined with insert-only webhook/trial logic breaks renewals and trial→paid conversion**
- **Status:** ✅ Resolved (2026-07-26)
- **Files:** `supabase/migrations/20260724110804_f95931a7-2e9e-417c-8a33-e9aedac500de.sql:140`; consumed via plain `.insert()` (never `upsert`) at `src/routes/api/public/webhooks/stripe.ts:113-131`, `src/routes/api/public/webhooks/paypal.ts:139-154`, `src/lib/trial.functions.ts:46-59`, and `src/lib/admin.functions.ts` (`adminGrantPremium`, found during the fix — not in the original file list, same root cause)
- **Description:** The constraint is unconditional on `(user_id, app_id)` regardless of `status`/expiry, and every code path that grants access does a plain `INSERT`.
- **Risk:** **(a)** A user who activates the free trial occupies that unique slot; when they later actually pay, the webhook's `INSERT` violates the constraint, the error is caught but only surfaced as a `500`, and the customer is charged with no subscription/payment/notification/audit-log/n8n event ever created. **(b)** Any renewal or repeat purchase for an app the user has ever subscribed to (even one expired months ago) fails identically. **(c)** `trial.functions.ts`'s bulk multi-row insert across all active apps fails atomically if the user has so much as one leftover row for any single app, blocking trial activation for apps they've never touched. **(d)** `adminGrantPremium` failed identically when an admin tried to (re-)grant premium to a user who already had any row — including a cancelled one — for that app.
- **Recommendation:** Replace `insert` with `upsert(..., { onConflict: "user_id,app_id" })` that extends/replaces the existing row, or drop the `(user_id, app_id)` uniqueness in favor of idempotency keyed on `stripe_payment_id`/`paypal_payment_id`.
- **Resolution:** All four write paths switched from `.insert()` to `.upsert(..., { onConflict: "user_id,app_id" })`, preserving the "at most one row per (user, app)" invariant while allowing that row to be refreshed on renewal, resubscribe-after-cancel, or repeat admin grant. **Stripe and PayPal webhooks additionally gained an explicit idempotency guard** — a `payments` lookup by `stripe_payment_id`/`paypal_payment_id` before any write — added specifically because switching to `upsert` removed an accidental protection the old `UNIQUE` violation used to provide against duplicate webhook redelivery double-inserting into `payments`; without it, a redelivered event would have silently created a second payment record on every retry. `trial.functions.ts` needed no additional guard (its own pre-existing `pastTrial` check already provides idempotency). `adminGrantPremium` needed no idempotency guard either — it's a direct admin action, not a retrying external webhook, and it never writes to `payments` at all (`amount_paid: 0`, no provider payment id), so there is nothing for a duplicate-row check to key against. Known remaining gaps, intentionally out of scope for this fix and not yet tracked as separate findings: `payments.paypal_payment_id` still has no `UNIQUE` DB constraint (unlike `stripe_payment_id`), so PayPal's idempotency guard is an application-level existence check, not a database-enforced guarantee; a renewal's new `expires_at` is computed from "now," not from the existing period's remaining time, so renewing before expiry does not add to the remaining time.
- **Commit:** `b0b07a3`
- **Date:** Logged 2026-07-26, resolved 2026-07-26

### Medium

**DB-3 — `UserType` TypeScript union doesn't include the DB's `super_admin` value**
- **Status:** ⚪ Closed — no production impact (2026-07-28)
- **Files:** `src/types/database.ts:6` vs. `supabase/migrations/20260724110804_...sql:19`
- **Description:** `export type UserType = "standard" | "premium" | "admin";` but the DB constraint is `CHECK (user_type IN ('standard','premium','admin','super_admin'))`.
- **Risk:** A row with `user_type = 'super_admin'` is unrepresented in the app's type system, so any `=== "admin"` comparison silently misses `super_admin` rows.
- **Recommendation:** Add `"super_admin"` to the `UserType` union, or remove it from the DB constraint if it's not actually meant to be used.
- **Closure rationale:** Re-verified directly against the full codebase: nothing anywhere compares `user_type === "admin"` or `"super_admin"` — admin authorization runs entirely through `user_roles`/`has_role()`/`assertAdmin()`, never through `profiles.user_type`. The only `user_type` comparison in the app is `=== "premium"` (a display badge in `admin.users.tsx`), which this gap doesn't affect. The risk this finding describes has no call site to actually occur at. Closed as having no realized or realizable production impact under the current architecture, not fixed.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

### Low

**DB-4 — `is_user_premium()` is not scoped per application, despite a per-app subscription/pricing model**
- **Status:** ✅ Resolved
- **Files:** `supabase/migrations/20260729130400_scope_is_user_premium_by_app.sql` (was `20260725070421_432f3b63-9cdc-48d8-8393-c21afa2d58fd.sql:129-142`); consumed at `src/routes/u.$username.tsx`
- **Description:** The function returned `true` if the user had any active subscription to any app — it did not filter by `app_id` even though `subscriptions.app_id` exists. `premium_profiles` (the bio-link/contact-details table) still has no `app_id` column — one global contact-details row per user, but that is now a deliberate, documented choice (a single set of contact details, gated per-application at the application layer), not the bug.
- **Risk:** A subscription to any single app previously unlocked the global "Premium" badge/contact-sharing on the shared bio-link page everywhere.
- **Classification:** Architecture Deviation — `PROJECT_KNOWLEDGE.md` → Premium Model states premium belongs to an application, not globally. The current schema/function implemented a global concept instead.
- **Resolution:** `is_user_premium(uuid)` replaced outright with `is_user_premium(_user_id uuid, _app_id uuid)` (single call site, no overload needed), matching the already-correct per-app `subscriptions` schema and the already-correct `adminGrantPremium`/`adminRevokePremium`/`/dashboard/subscriptions` behavior. `src/routes/u.$username.tsx` rewritten to: (1) list only the applications where the profile owner has an active Premium subscription ("Premium on: ..."), computed per application rather than from one global flag; (2) gate contact functions (internal message, WhatsApp, Viber) on Premium being active for **both** the profile owner and the visitor, **for the specific application currently being browsed** (resolved via the existing Application Resolver / `useApplication()`), showing an upgrade modal otherwise; phone/email/website remain gated on the owner's per-app Premium status only. Verified live via a disposable-user end-to-end test: single-app premium, multi-app premium, a standard (non-premium) visitor correctly blocked, and a real authenticated (non-service-role) session producing identical results to anon.
- **Update (2026-07-31):** superseded by a deliberate business-rule reversal, not a regression of this fix — the platform owner decided Premium should be a single, ecosystem-wide entitlement (the Global Premium Visibility & Contact System). `is_user_premium(_user_id, _app_id)` was removed outright (both the TS wrapper and its backing SQL function, via `supabase/migrations/20260730100000_global_premium_visibility_model.sql`), replaced by the already-existing `has_any_active_premium(_user_id)` as the one and only Premium check. See `PROJECT_KNOWLEDGE.md` → Premium Model for the current architecture; this entry is left intact as the historical record of the per-app design and its reasoning.
- **Commit:** —
- **Date:** 2026-07-30; superseded 2026-07-31

**DB-6 — Two migrations existed locally but were never applied to the live database (recurrence of the SE-16/SE-17 pattern)**
- **Status:** ✅ Resolved (2026-07-31)
- **Files:** `supabase/migrations/20260729130500_admin_application_assets_policy.sql`, `supabase/migrations/20260730100000_global_premium_visibility_model.sql`
- **Description:** `supabase migration list --linked` showed both migrations present locally with no matching remote-applied timestamp — the same root cause already documented for SE-16/SE-17 (bulk `migration repair --status applied` bookkeeping trusted without per-migration verification). Discovered while regenerating `src/integrations/supabase/types.ts`: the freshly generated types were missing `get_visible_application_ids` and still showed `is_user_premium(uuid, uuid)` as live, proving the Global Premium migration had never actually run.
- **Risk:** Code written against `get_visible_application_ids` (`src/lib/premium.ts`'s `getVisibleApplications`) would have failed at runtime against the live database — the function didn't exist there. `is_user_premium(uuid, uuid)` also remained live and callable despite being dead code, an unnecessary attack-surface/confusion leftover.
- **Recommendation:** Push both migrations; going forward, verify `supabase migration list --linked` shows a matching remote timestamp immediately after writing any new migration, not only when a symptom surfaces later.
- **Resolution:** `20260729130500` was additionally not idempotent (`CREATE POLICY` with no `DROP POLICY IF EXISTS` guard, unlike the rest of this repository's storage-policy migrations) and failed on first push attempt; added the missing `DROP POLICY IF EXISTS` guards (matching the convention already used elsewhere, e.g. `20260729130200`), then both migrations pushed successfully via `supabase db push --linked`. `supabase migration list --linked` reconfirmed afterward: all 32 local migrations now show a matching remote-applied timestamp.
- **Commit:** —
- **Date:** 2026-07-31

**DB-7 — `ApplicationRow.primary_color`/`secondary_color` are typed as required `string`, but the database schema allows `NULL`**
- **Status:** Open
- **Files:** `src/types/database.ts` (`ApplicationRow`); schema: `supabase/migrations/20260724110804_...sql:89` (`primary_color text DEFAULT '#1D6BF3'` — no `NOT NULL`)
- **Description:** Discovered while regenerating `src/integrations/supabase/types.ts` and removing an `as never` cast in `src/lib/premium.ts`'s `getVisibleApplications`: the freshly generated (accurate) types show `primary_color`/`secondary_color` as `string | null`, which is not assignable to `ApplicationRow`'s hand-written `string`. The column has a `DEFAULT`, not a `NOT NULL` constraint, so an explicit `NULL` write is possible even though it never happens in practice today (every write path supplies a value).
- **Risk:** Low today (no code path currently writes `NULL` to either column), but `ApplicationRow` overstates the real guarantee — any future write path that omits these fields, or explicitly nulls them, would produce a value the type system claims can't exist.
- **Recommendation:** Either widen `ApplicationRow.primary_color`/`secondary_color` to `string | null` and update the handful of consumers that assume non-null (most already have a `?? "#1D6BF3"`-style fallback), or add a `NOT NULL` constraint to match the type's promise — a decision for whoever owns the Applications Registry design, not made unilaterally here.
- **Resolution:** Worked around locally with a documented `as unknown as ApplicationRow[]` cast in `getVisibleApplications` (same effective behavior as the pre-existing, less-precise cast it replaced) — not a fix, just preserved the status quo without silently forcing a mismatched type through.
- **Commit:** —
- **Date:** 2026-07-31

**DB-5 — Stale `GRANT SELECT ... TO anon` left over from superseded early migrations**
- **Status:** Open
- **Files:** `supabase/migrations/20260724110804_...sql:30`, `20260724114742_...sql`
- **Description:** These early, over-permissive read policies were correctly dropped/replaced by `20260725070421_...sql`'s masking views, and RLS now blocks all rows for `anon` on the base tables. The original `GRANT SELECT ... TO anon` statements on the base tables are still technically in effect at the grant level, relying entirely on "no permissive policy remains" rather than the grant itself being revoked.
- **Risk:** No live exposure today (confirmed) — hygiene/defense-in-depth gap only.
- **Recommendation:** Revoke the now-redundant grants for defense-in-depth and schema clarity.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

**DB-9 — `subscription_plans.duration_months` is a closed enum (`1|3|6|12`)**
- **Status:** 🚫 Deferred (2026-08-03)
- **Files:** `src/lib/admin.functions.ts` (`planInputSchema`/`durationMonths`)
- **Description:** Found during the Priority 8.6 audit: stricter than the already-tracked `duration_months = 12` default exception — adding a 2-month or 18-month plan requires a code deploy, not an admin action, contrary to the Configuration-First philosophy the rest of Phase 8 follows.
- **Risk:** Low — no incorrect behavior today, just an admin-facing rigidity.
- **Recommendation:** Widen to a validated positive integer instead of a fixed enum, once there's an actual need for a non-standard duration.
- **Deferral rationale:** Explicitly out of scope for Priority 8.7 by owner instruction ("do not implement" R-5) — no non-standard-duration plan is needed today, and widening this now would be speculative.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-08-03

---

## 6. Routing

**Structure:** File-based routing under `src/routes/`, compiled into `src/routeTree.gen.ts` by `@tanstack/router-plugin`. Public routes (`index`, `login`, `pricing`, `u.$username*`), authenticated routes (`dashboard.*`, gated by `ProtectedRoute`), and admin routes (`admin.*`, gated by the `AdminGate` parent in `admin.tsx`) are cleanly separated. Two server-only API routes exist under `src/routes/api/public/webhooks/`.

### High

**RT-5 — `getAdPlacementsForApp` uses the browser Supabase client server-side, crashing both `/v1/advertising/placements` endpoints under Node SSR**
- **Status:** Open
- **Files:** `src/lib/advertising.functions.ts` (`getAdPlacementsForApp`), `src/integrations/supabase/client.ts`, `src/routes/v1/advertising/placements/index.ts`, `src/routes/v1/advertising/placements/$placementKey/active-ad.ts`
- **Description:** Found while running the built `node-server` bundle against the real production database for Priority 13's D2 verification. `getAdPlacementsForApp` dynamically imports `@/integrations/supabase/client` (the *browser* client) inside its server-function handler, instead of the server/admin client every other read-only function in this file uses. `client.ts` calls `createClient()` at module scope with `auth.persistSession: true` and `storage: typeof window !== 'undefined' ? window.localStorage : undefined` — which resolves to `undefined` outside a browser — and the Supabase JS SDK is known to throw when session persistence is requested with no usable storage adapter. Both `GET /v1/advertising/placements` and `GET /v1/advertising/placements/{placementKey}/active-ad` (bundled in the same module, so both fail even though only the first directly touches the browser client) returned `INTERNAL_ERROR` for every request against real data, while an unrelated `/v1/capabilities` call succeeded normally in the same test run. Predates Priority 13 entirely (Phase 8.4) — not introduced by it. Every one of Priority 13's own new functions was individually verified correct via direct database queries during the same session, working around this pre-existing endpoint failure rather than through it.
- **Risk:** Any real integrating application calling either endpoint gets a 500 instead of placement/ad data. Not confirmed whether this reproduces on the actual deployed `core.logid.pro` server (its build/runtime wasn't checked as part of this finding) or is specific to a locally-built `node-server` bundle.
- **Recommendation:** Change `getAdPlacementsForApp` to use the server/admin client (`await import("@/integrations/supabase/client.server")`), matching the pattern already used by every other function in `advertising.functions.ts`.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-08-09

### Low

**RT-1 — Dead, duplicate public-profile route with misleading SEO metadata**
- **Status:** Open
- **Files:** `src/routes/profile.$username.tsx`
- **Description:** Declares `head()` meta tags claiming a real per-user profile page (`@${username} — Core Platform`, description referencing the actual username), but the component body is a static "coming soon" placeholder that fetches no data. Duplicates the real implementation at `src/routes/u.$username.tsx` and isn't linked from anywhere in the app.
- **Risk:** Any crawler or stray link hitting `/profile/:username` gets misleading metadata for empty content.
- **Recommendation:** Remove the route, or make it redirect to `/u/$username` the way `u.$username.share.tsx` redirects to `u.$username.tsx`.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

**RT-2 — Empty error-boundary effect, likely missing telemetry**
- **Status:** Open
- **Files:** `src/routes/__root.tsx:40-45`
- **Description:** `ErrorComponent`'s `useEffect(() => { }, [error])` re-runs on every new caught error but does nothing.
- **Risk:** Root-level render errors are never logged/reported anywhere — very likely a stub for error reporting that was never filled in.
- **Recommendation:** Wire the effect to actual error telemetry, or remove the dead effect.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

**RT-3 — `Link to="/pricing"` missing required `search` prop fails `tsc --noEmit`**
- **Status:** Open
- **Files:** `src/components/dashboard/DashboardPage.tsx:489`, `src/components/dashboard/TrialBanner.tsx:48,67`, `src/routes/dashboard.subscriptions.tsx:73`
- **Description:** `/pricing`'s route declares a required `search.app` param (see the working call site at `DashboardPage.tsx:423-424`, which passes `search={{ app: app.slug }}`), but these four call sites link to `/pricing` with no `search` prop at all. `tsc --noEmit` fails on all four with `TS2741: Property 'search' is missing`. Predates Priority 8.3 (Rewards & Loyalty) — noticed incidentally while typechecking that phase's changes, not introduced by them.
- **Risk:** Currently a type-check-only failure (Vite's dev/build transform doesn't appear to enforce it, so the app still runs), but it means `npx tsc --noEmit` cannot be used as a clean gate for this repo until fixed, and any of these links may pass `undefined` for `app` at runtime depending on how `/pricing` handles a missing param.
- **Recommendation:** Either pass an explicit `search` (e.g. omit `app` deliberately via `search={{}}` if `/pricing` treats it as optional) at all four call sites, or make `search.app` optional on the `/pricing` route if "no specific app" is a legitimate, supported entry point.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-08-01

**RT-4 — Public profile page's `head()` metadata is hardcoded "Core Platform" regardless of the serving application**
- **Status:** 🚫 Deferred (2026-08-03)
- **Files:** `src/routes/u.$username.tsx` (`head()`)
- **Description:** Found during the Priority 8.6 audit: `head()` runs outside component context and so can't call `useApplication()` the way the component body does (the mechanism Priority 6.1 used to fix the *visible* branding). Every social-preview unfurl (WhatsApp/Facebook/iMessage) of a profile link shows generic "Core Platform" branding regardless of which application actually served the page.
- **Risk:** Cosmetic/branding-only — no functional or security impact, but undermines the multi-brand positioning for exactly the moment (a shared link preview) where an application's identity matters most.
- **Recommendation:** Resolve the application server-side before `head()` runs (e.g. via a route loader keyed on the request's `Host` header) so `head()` can read branding without needing component context.
- **Deferral rationale:** Explicitly out of scope for Priority 8.7 by owner instruction ("do not implement" R-8) — resolving branding before `head()` runs needs a server-side loader change to this route, a large enough shift in this route's data-flow to warrant its own scoped approval rather than a drive-by fix.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-08-03

**Note (strength):** Admin route authorization is correctly layered — client-side `AdminGate` blocks the `<Outlet/>` and every admin server function independently re-verifies via `assertAdmin()`. No IDOR was found on `$username`/`$id`-parameterized routes; public profile pages correctly gate private contact fields behind both owner opt-in flags and viewer/owner state, and never render email addresses.

---

## 7. Components

**Structure:** Feature components under `src/components/{dashboard,profile}/`, generic UI primitives (shadcn/ui) under `src/components/ui/`, plus two hand-written UI components (`CountrySelect.tsx`, `LanguageSwitcher.tsx`) and `InstallPrompt.tsx` for PWA install prompts.

### High

**CO-1 — Stored XSS via `javascript:`/`data:` URI in profile website & social links**
- **Status:** ✅ Resolved (2026-07-26)
- **Files:** Input (unvalidated): `src/components/profile/SocialLinksSection.tsx:36-43`, `src/components/profile/ToggleField.tsx:43`; save path (no server validation): `src/routes/dashboard.profile.tsx:171-192`; sink (unsanitized render): `src/routes/u.$username.tsx:217,297-304`
- **Description:** HTML5 `type="url"` inputs accept `javascript:alert(1)` as a syntactically valid URL — it does not restrict scheme to http/https — and nothing in the save path or the render path checks the scheme.
- **Risk:** Any user who reaches premium status (a normal paid feature, not a privileged one) can store a `javascript:` URI as their public website or social link; any visitor to their public profile who clicks it executes attacker-controlled script in their own browser session. See also **SE-6**.
- **Recommendation:** Validate/normalize on save (require `http://`/`https://` via `new URL()` + protocol allowlist, reject `javascript:`/`data:`/`vbscript:`), and defensively re-check protocol at the render sink before using a stored value as an `href`.
- **Resolution:** Fixed at all three layers. **(1) Frontend:** `src/lib/url.ts` adds `isSafeProfileUrl()` (native `URL` parser, allows only `http:`/`https:` protocols); `dashboard.profile.tsx`'s `handleSavePremium` now rejects the save (before any network call) if `website` or any social link fails this check. **(2) Backend/database:** new migration `20260726130000_restrict_premium_profile_url_schemes.sql` adds a `NOT VALID` `CHECK` constraint on all 7 URL columns in `premium_profiles`, enforced for every future write regardless of caller, while leaving any pre-existing row untouched (so existing data stays compatible). **(3) Render sink:** `u.$username.tsx` now also gates both the website link and `SocialRow`'s social links on `isSafeProfileUrl`, so even a value that predates the fix can never be rendered as a clickable `href`. Known limitation: rows already containing an unsafe URL are not retroactively cleaned up (`NOT VALID` intentionally skips existing rows) — they're simply never rendered as links; a follow-up data-cleanup migration would be needed to fully validate the constraint and null out any bad legacy values.
- **Commit:** 4f3867c
- **Date:** Logged 2026-07-26, resolved 2026-07-26

### Medium

**CO-2 — `AvatarUpload` derives the storage-path extension from the unsanitized filename, not the validated MIME type**
- **Status:** Open
- **Files:** `src/components/profile/AvatarUpload.tsx:30-31`
- **Description:** `file.type` is correctly checked against an allowlist earlier (line 24), but the extension used to build the storage key (`${userId}/avatar.${ext}`) comes straight from the user-controlled filename.
- **Risk:** Unvalidated input flows into a storage key; blast radius limited by the `${userId}/` prefix, but still an input-validation gap.
- **Recommendation:** Derive the extension from the validated `file.type` via a small map (`image/png → png`, etc.) instead of trusting `file.name`.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

**CO-3 — `AvatarUpload` has no re-entrancy guard, and the file input isn't reset after use**
- **Status:** Open
- **Files:** `src/components/profile/AvatarUpload.tsx:50-61,73-82`
- **Description:** The avatar-image trigger button is never `disabled` during upload (only the text button below it is), and the hidden `<input type="file">` never has `.value` cleared after use.
- **Risk:** A user can reopen the file picker and start a second upload while the first is still in flight (no cancellation, shared `uploading` state can desync); selecting the exact same file twice in a row (e.g. retrying after a failure) doesn't fire `onChange` at all.
- **Recommendation:** Disable both trigger buttons while `uploading`; clear `e.target.value` after each selection is processed.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

**CO-4 — PWA manifest icon entry claims a size that doesn't match the actual asset**
- **Status:** Open
- **Files:** `public/manifest.webmanifest:12`
- **Description:** `{"src": "/icon-512.png", "sizes": "192x192", ...}` — `public/` contains only `icon-512.png`, no dedicated 192×192 asset.
- **Risk:** Platforms that match `sizes` against actual image dimensions for home-screen/splash generation will mis-scale or reject this entry.
- **Recommendation:** Generate a real 192×192 PNG for that entry, or remove the false `sizes` claim and keep only the accurate 512×512 entries.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

**CO-5 — ESLint and TypeScript both disable unused-variable checking, hiding dead code**
- **Status:** Open
- **Files:** `eslint.config.js:36`; `tsconfig.json:19-20`
- **Description:** `"@typescript-eslint/no-unused-vars": "off"` and `noUnusedLocals`/`noUnusedParameters: false` are both disabled.
- **Risk:** Dead code like the unused `notificationsQuery` in `DashboardPage.tsx` (**DA-2**) compiles and lints clean instead of surfacing as a warning — this is not theoretical, it directly hid that real bug.
- **Recommendation:** Re-enable `noUnusedLocals`/`noUnusedParameters` (or at least the ESLint rule); use a `_`-prefix convention for intentionally-unused parameters.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

**CO-8 — Avatar upload (Tier 2 content per `PROJECT_KNOWLEDGE.md`) bypassed the `MediaStorageProvider` adapter**
- **Status:** ⚠️ Partially Resolved (2026-08-03)
- **Files:** `src/lib/media-storage.ts` (`avatarPath`, new); `src/components/profile/AvatarUpload.tsx`, `src/routes/onboarding.tsx`
- **Description:** Found during the Priority 8.6 audit: `AvatarUpload.tsx` and `onboarding.tsx` both called `supabase.storage` directly instead of going through the adapter Advertising banners already use, independently reimplementing the same unsafe-extension-from-filename logic tracked at **CO-2**. When a Tier-2 storage provider is eventually chosen, swapping the adapter would migrate campaign banners but silently strand both avatar call sites on the old bucket.
- **Risk:** A future storage-provider swap requires remembering to also update these two call sites by hand instead of it happening automatically through the adapter.
- **Recommendation:** Route both avatar upload call sites through `getMediaStorageProvider()`, consolidating the path-building logic into one shared function.
- **Resolution:** New `avatarPath(userId, fileName)` in `media-storage.ts` (preserving the exact pre-existing path shape and extension-derivation logic, deliberately unchanged) is now the single function both `AvatarUpload.tsx` and `onboarding.tsx` call, and both upload through `getMediaStorageProvider().upload(...)` instead of `supabase.storage` directly — a provider swap now only touches this one file for avatars, same as it already does for campaign banners. **Not resolved as part of this fix, and intentionally left open:** the underlying unsafe-extension-from-filename bug itself (still deriving the extension from `file.name` rather than the validated `file.type`) — that remains tracked at **CO-2**, since fixing the bug's logic was out of scope for this pass, which only addressed the adapter-bypass/duplication half of the finding. `admin.applications.tsx`'s logo/favicon/cover uploads were confirmed out of scope and left untouched — Tier 1 branding content per `PROJECT_KNOWLEDGE.md` → Media Strategy, not a Tier-2 violation.
- **Commit:** —
- **Date:** Logged 2026-08-02, resolved 2026-08-03

### Low

**CO-6 — `ProfessionTagInput` duplicate detection is case-sensitive and doesn't cap tag length**
- **Status:** Open
- **Files:** `src/components/profile/ProfessionTagInput.tsx:17`
- **Description:** The trimmed value is compared with a strict, case-sensitive string match (`value.includes(v)`); no per-tag length cap exists either.
- **Risk:** "Doctor" and "doctor" are treated as distinct tags and can both be added up to `max`.
- **Recommendation:** Normalize (lowercase, collapse whitespace) before the duplicate check; cap individual tag length.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

**CO-7 — `ShareAndInvite` builds URLs without `encodeURIComponent`**
- **Status:** Open
- **Files:** see **DA-10** (same file/finding, listed there in full)
- **Description:** Cross-reference only.
- **Risk:** See DA-10.
- **Recommendation:** See DA-10.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

---

## 8. Security (cross-cutting)

This section aggregates the highest-impact, trust-boundary-crossing issues found across the codebase — several are detailed fully in their owning section above and only cross-referenced here; the payment-webhook-specific findings are new to this section.

### Critical

**SE-1 — `.env` is tracked in git with no `.gitignore` entry**
- **Status:** ✅ Resolved (2026-07-26)
- **Files:** `.env`, `.gitignore` (repo root)
- **Description:** `git ls-files` confirmed `.env` is tracked, with 2 commits actively modifying it. `.gitignore` had no `.env` entry at all — only `*.local`, `.dev.vars`, etc. — so nothing prevented it from being committed.
- **Risk:** The tracked, un-ignored `.env.example` documents real server secrets that belong in `.env` (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PAYPAL_CLIENT_SECRET`, `RESEND_API_KEY`). The moment any of those is populated locally and committed, it becomes a permanent leak in git history. The currently-committed values were Supabase's public "publishable"/anon key and project ref (not high-value secrets by themselves).
- **Recommendation:** Add `.env`/`.env*.local` to `.gitignore`, `git rm --cached .env`, rotate any credential that was ever committed, keep only `.env.example` tracked.
- **Resolution:** `.env`, `.env.local`, and `.env.*.local` added to `.gitignore`; `.env` removed from git tracking with `git rm --cached .env` (local file untouched, content byte-identical). Confirmed via full `git log -p -- .env` that only the public `SUPABASE_PROJECT_ID`/`SUPABASE_URL`/publishable key were ever committed — no service-role key, Stripe/PayPal secret, or other high-value credential was ever exposed, so no rotation was necessary. `.env.example` remains the tracked template, unchanged. Residual watch item: this repo's `.env` has historically been auto-written by Lovable Cloud's sync bot; if a future sync recommits the file, the `.gitignore` entry should be re-verified.
- **Commit:** `310c563`
- **Date:** Logged 2026-07-26, resolved 2026-07-26

**SE-2 — Stripe amount/plan validation is entirely skipped when `plan_id` is omitted from the payment reference**
- **Status:** ✅ Resolved (2026-07-27)
- **Files:** `src/routes/api/public/webhooks/stripe.ts:6-18,59-111`
- **Description:** `parseRef` returns `plan_id: null` if the `client_reference_id` string (built client-side in `src/routes/pricing.tsx:80-92`) has fewer than 3 `__`-separated segments. The amount-match guard is entirely skipped when `plan_id` is absent, and `planMonths` silently defaults to `12`.
- **Risk:** Any user can pay through the cheapest available plan's public link while manually editing the URL to submit a 2-segment reference (omitting `planId`), and receive 12 months of premium at the cheapest plan's price — a direct revenue-integrity bypass.
- **Recommendation:** Require `plan_id` to be present and resolvable; reject (or fall back to validating against the minimum-duration/lowest-price plan) rather than defaulting to the most generous duration with no price check.
- **Resolution:** Closed more completely than originally scoped, after tracing the actual code rather than assuming the audit's title covered the full bug surface: the root cause wasn't just "`plan_id` omitted," it was "whenever `planPrice` stays `null`," which also happens when `plan_id` is present but doesn't resolve to a real row. Two additions: **(1)** reject immediately if `ref.plan_id` is missing (`ignored: "missing_plan_id"`); **(2)** reject if `ref.plan_id` doesn't match any row in `subscription_plans` (`ignored: "plan_not_found"`) — previously this silently fell through to the same unvalidated 12-month default as the omitted case. Both are pure additions; nothing existing was removed or restructured. Verified via `pricing.tsx` that every real checkout link already includes a resolvable `plan_id`, so only tampered/malformed references are affected.
- **Commit:** —
- **Date:** Logged 2026-07-26, resolved 2026-07-27

**SE-3 — `subscriptions` UNIQUE constraint breaks the payment fulfillment flow itself**
- **Status:** ✅ Resolved (2026-07-26)
- **Files:** see **DB-2** (same finding, full detail there)
- **Description:** Cross-reference. Included here because the practical security/business consequence is that paying customers can be charged with no entitlement ever recorded, silently, with only a generic `500` in server logs.
- **Risk:** See DB-2.
- **Recommendation:** See DB-2.
- **Resolution:** See **DB-2** — fixed via `upsert(..., { onConflict: "user_id,app_id" })` across all four write paths, with an idempotency guard added to both webhooks.
- **Commit:** `b0b07a3`
- **Date:** Logged 2026-07-26, resolved 2026-07-26

**SE-14 — PayPal amount/plan validation is skipped when `plan_id` is omitted or unresolvable — the same bypass as `SE-2`, unpatched**
- **Status:** ✅ Resolved (2026-07-27)
- **Files:** `src/routes/api/public/webhooks/paypal.ts:77-115`
- **Description:** Identical pattern to `SE-2`, confirmed by direct re-read during the PayPal Integrity Audit — not fixed when `stripe.ts` was patched. The plan lookup and its `is_active`/app-match check only run `if (ref.plan_id)`; if `plan_id` is absent *or* doesn't resolve to a real row in `subscription_plans`, `planPrice` stays `null`, the amount check (`if (planPrice !== null)`) is skipped entirely, and `months` defaults to `12` with zero validation of what was actually captured.
- **Risk:** A user can hand-edit `custom`'s third segment (drop it, or corrupt it) to receive 12 months of premium for whatever amount was actually paid, with no cross-check against any specific plan's price — same direct revenue-integrity bypass as `SE-2`.
- **Recommendation:** Apply the same fix already implemented for `SE-2`: reject if `ref.plan_id` is missing (`ignored: "missing_plan_id"`), and reject if it doesn't resolve to a real, active, app-matching plan (`ignored: "plan_not_found"`) — mirroring the two rejections added to `stripe.ts`.
- **Resolution:** Same two additions as `SE-2`, mirrored exactly: reject immediately if `ref.plan_id` is missing (`ignored: "missing_plan_id"`), and reject if it doesn't resolve to a real row in `subscription_plans` (`ignored: "plan_not_found"`) instead of silently falling through to the unvalidated 12-month default. Pure additions, same bare-block minimal-diff style used for the Stripe fix.
- **Commit:** —
- **Date:** Logged 2026-07-27, resolved 2026-07-27

### High

**SE-4 — Stripe webhook grants entitlement without checking `session.payment_status`**
- **Status:** ✅ Resolved (2026-07-27)
- **Files:** `src/routes/api/public/webhooks/stripe.ts:45-57`
- **Description:** The handler only checks `event.type === "checkout.session.completed"` and never checks `session.payment_status === "paid"`. Per Stripe's documented behavior, `checkout.session.completed` fires even when `payment_status` is `"unpaid"` for delayed/asynchronous payment methods.
- **Risk:** A session completing with unconfirmed payment still activates a subscription and flips `profiles.user_type` to `"premium"`.
- **Recommendation:** Check `session.payment_status === "paid"` before fulfillment; also handle `checkout.session.async_payment_succeeded`/`async_payment_failed`.
- **Resolution:** Added a `session.payment_status !== "paid"` check immediately after obtaining the session, before any other processing; a non-`paid` session is rejected (`ignored: "not_paid"`). Scoped minimally to closing the described vulnerability — did **not** add handling for `checkout.session.async_payment_succeeded`/`async_payment_failed`, since that's a distinct, additive capability (fulfilling delayed-payment-method purchases once they do succeed later), not required to close this specific gap. **Known limitation, intentionally not addressed here:** if the connected Stripe account has any delayed/asynchronous payment method enabled, a customer using one will now correctly not be granted access immediately, but also won't be granted access later either, since the success event for that path isn't handled. Worth a follow-up if such payment methods are actually enabled on the account.
- **Commit:** —
- **Date:** Logged 2026-07-26, resolved 2026-07-27

**SE-5 — PayPal integration field-name mismatch: the client sends `custom`, the webhook reads `custom_id`**
- **Status:** Open — blocked on empirical verification, not deferred by choice
- **Files:** `src/routes/pricing.tsx:90` vs. `src/routes/api/public/webhooks/paypal.ts:71-77`
- **Description:** The frontend tags the outgoing PayPal link with a `custom` query parameter; the webhook handler reads `resource.custom_id` from the `PAYMENT.CAPTURE.COMPLETED` payload.
- **Risk:** If these fields don't actually match for the configured PayPal product, `resource.custom_id` is always `undefined` and the handler silently no-ops for every real PayPal payment — money taken, nothing activated, no error surfaced anywhere.
- **Recommendation:** Confirm the exact field PayPal echoes back for the configured product; make the query-param name and the webhook-read field match.
- **Verification note (2026-07-27):** Whether this is even a real mismatch (vs. two representations of the same thing) can't be determined from source code alone — it depends on which PayPal product `paypal_payment_link` actually is and what that product echoes back. Requires a real PayPal Sandbox transaction and inspection of the actual webhook payload before any code change is justified. No further code changes to this file until that empirical evidence exists.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

**SE-6 — Stored XSS via `javascript:` profile links**
- **Status:** ✅ Resolved (2026-07-26)
- **Files:** see **CO-1** (same finding, full detail there)
- **Description:** Cross-reference.
- **Risk:** See CO-1.
- **Recommendation:** See CO-1.
- **Resolution:** See **CO-1** — fixed at input, database, and render layers.
- **Commit:** 4f3867c
- **Date:** Logged 2026-07-26, resolved 2026-07-26

### Medium

**SE-7 — Client-built payment correlation IDs are unsigned and user-tamperable**
- **Status:** ✅ Resolved (2026-07-30)
- **Files:** `src/lib/payment-reference.server.ts` (new), `src/lib/payments.functions.ts` (new), `src/routes/pricing.tsx`, `src/routes/api/public/webhooks/stripe.ts`, `src/routes/api/public/webhooks/paypal.ts`
- **Description:** `client_reference_id`/`custom` were built entirely client-side as `${user.id}__${activeAppId}__${plan.id}` and appended as a plain query string to a static payment link.
- **Risk:** Nothing stopped a user from copying the link and editing these values before completing checkout — in particular the `user_id` segment, letting a payer assign the resulting entitlement to a different account entirely while still paying an amount that matches some real plan (so **SE-2**/**SE-14**'s amount/plan check alone couldn't catch it).
- **Recommendation:** Always verify amount/plan against the payment provider's authoritative transaction data server-side; never trust the reference string alone to determine what to grant.
- **Resolution:** The reference is now generated server-side and HMAC-signed (`PAYMENT_REF_SECRET`, `src/lib/payment-reference.server.ts`): `createPaymentReference` (new `createServerFn`) takes the authenticated session's `user_id` from `context.userId` (never client input), validates the requested plan belongs to the requested application and is active, then returns `${user_id}__${app_id}__${plan_id}__${hmac}`. `pricing.tsx`'s buy buttons now call this server function before redirecting, instead of building the string inline. Both webhooks were changed to call one shared `verifyPaymentReference()` (replacing the previous separate, unsigned `parseRef`/`parseCustom` — consolidating two near-duplicate parsers into one verified one) which recomputes and timing-safe-compares the HMAC, rejecting anything malformed, unsigned, or tampered before any of the existing amount/plan checks even run. Verified live via a disposable-user, real-webhook-call test: a tampered reference (single flipped signature character) is rejected with no payment or entitlement created, while a genuine signed reference activates normally, renews correctly, and rejects redelivered events (see Priority 4 payment-flow test run, 2026-07-30). `PAYMENT_REF_SECRET` added to `.env.example`.
- **Commit:** —
- **Date:** Logged 2026-07-26, resolved 2026-07-30

**SE-8 — GDPR account deletion: unchecked delete errors and no storage cleanup**
- **Status:** ✅ Resolved (2026-07-28)
- **Files:** `src/lib/gdpr.functions.ts`
- **Description:** The per-table delete loop never inspected `{ error }`; a failed delete on any table was silently ignored and the flow proceeded to `auth.admin.deleteUser(userId)`. Avatar files in the `avatars` storage bucket were also never removed.
- **Risk:** Orphaned personal data and avatar files can remain after erasure is reported as successful (`{ ok: true }`).
- **Recommendation:** Check/aggregate errors from each delete and fail loudly rather than proceeding unconditionally; add a `storage.remove()` pass over the user's avatar objects.
- **Resolution:** The per-table delete loop now captures and aggregates `{ error }` per table; if any table failed, the function throws before reaching the `profiles` delete or `auth.admin.deleteUser` — a partial per-table failure now blocks the destructive, hard-to-reverse final step instead of silently proceeding past it. The `profiles` delete's own error is now checked and thrown too. A best-effort avatar cleanup was added (`storage.list(userId)` then `storage.remove(...)` over whatever is found, covering leftover files from prior extension changes, not just the current one) — deliberately non-fatal: a storage-cleanup failure is logged but doesn't block the higher-priority DB/auth erasure, consistent with the same secondary-write-failure-is-logged-not-fatal pattern already established in `SE-9`. `exportUserData` and the deletion sequence/order were not touched — same steps, now failure-aware.
- **Commit:** —
- **Date:** Logged 2026-07-26, resolved 2026-07-28

**SE-9 — Webhook handlers don't check errors on `payments`/`profiles`/`notifications` writes, or on `writeAuditLog`'s own insert**
- **Status:** ✅ Resolved (2026-07-28)
- **Files:** `src/routes/api/public/webhooks/stripe.ts`; `src/routes/api/public/webhooks/paypal.ts`; `src/lib/admin.server.ts`
- **Description:** Unlike the `subscriptions` write (whose error is checked), every subsequent write in the same handler discarded its `{ error }` result.
- **Risk:** A failure in any of them leaves an active subscription with no matching payment record, no user notification, and no audit trail — with zero logging or alerting.
- **Recommendation:** Check and log/alert on the result of each write; consider wrapping the post-payment side-effect sequence to report which steps failed.
- **Resolution:** All 9 previously-unchecked writes now capture `{ error }` and `console.error` it when present — `writeAuditLog`'s own `audit_logs` insert (fixes it once for every caller, including `admin.functions.ts`); Stripe's refund-branch `payments`/`subscriptions`/`profiles` updates and fulfillment-branch `payments`/`profiles`/`notifications` writes; PayPal's `profiles`/`notifications` writes. Logging only, by deliberate scope decision — no response code, retry, or idempotency behavior changed in any branch, since the entitlement-granting write had already succeeded by the point each of these runs; turning them into hard failures would risk the provider retrying an already-fulfilled event. Verified by trace: every success-path return value and status code is unchanged; a failing secondary write now logs via `console.error` instead of being silently discarded.
- **Commit:** —
- **Date:** Logged 2026-07-26, resolved 2026-07-28

**SE-13 — Stripe amount/currency check doesn't verify the specific Payment Link used, only that the paid amount matches some plan's price**
- **Status:** 🚫 Deferred (2026-07-27)
- **Files:** `src/routes/api/public/webhooks/stripe.ts:65-122`; `src/routes/pricing.tsx:80-86`; `subscription_plans.stripe_payment_link`
- **Description:** When `plan_id` is present, the webhook validates that the paid amount matches that plan's price/currency, that the plan belongs to the referenced app, and that it's active — but it never verifies that the Checkout Session's actual `payment_link` corresponds to the referenced plan's own `stripe_payment_link`. Stripe exposes `session.payment_link` (the Payment Link ID) on the Checkout Session object without needing to expand it.
- **Risk:** If two plans for the same app are ever priced identically (e.g. during a promotion, or by coincidence), a user can complete checkout via the cheaper/shorter plan's real link, then hand-edit `client_reference_id`'s `plan_id` segment to reference the other, same-priced plan — and receive that plan's duration instead of the one actually paid for.
- **Recommendation:** Cross-check `session.payment_link` against the referenced plan's own payment link. Not a one-line fix: `session.payment_link` returns a Payment Link ID (e.g. `plink_...`), while `subscription_plans.stripe_payment_link` currently stores the full checkout URL — the ID would need to be stored/derived separately before it can be compared.
- **Deferral rationale:** Medium severity and narrow (requires two identically-priced plans to exist plus deliberate tampering), while the real fix needs a schema change (new column to store the Payment Link ID) and an admin UI change (capture it on plan creation) in addition to the webhook cross-check — disproportionate scope for this pass compared to the Critical/High items already closed.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

**SE-16 — `payments.stripe_payment_intent_id` was missing live despite an existing migration file for it**
- **Status:** ✅ Resolved (2026-07-30)
- **Files:** `supabase/migrations/20260729130450_restore_missing_stripe_payment_intent_id.sql` (new; was `20260727100000_add_stripe_payment_intent_id.sql`)
- **Description:** Discovered while live-testing the Priority 4 payment flow: the Stripe webhook's `payments` insert failed every time with `PGRST204 "Could not find the 'stripe_payment_intent_id' column of 'payments' in the schema cache"`. Direct query confirmed the column genuinely didn't exist. `supabase migration list` showed `20260727100000_add_stripe_payment_intent_id.sql` as applied remotely — the same false-positive-bookkeeping root cause as every other missing-object discovery this session (an earlier bulk `migration repair --status applied` marked it applied without it ever actually running).
- **Risk:** Every real Stripe payment silently failed to record a `payments` row (logged as an error per **SE-9**, but not fatal — subscription activation still succeeded). More importantly, the entire **BL-1** Stripe refund-matching query (`.eq("stripe_payment_intent_id", ...)`) could never match anything, so a refund would never actually revoke the subscription it should have.
- **Recommendation:** Re-run the original `ALTER TABLE ... ADD COLUMN` against the live database.
- **Resolution:** New migration re-adds the column (`IF NOT EXISTS`-guarded). Verified live: the column now exists, the Stripe fulfillment webhook's `payments` insert succeeds, and — since this was blocking it — the full refund flow (`charge.refunded` → `payments.status='refunded'` → subscription cancelled → `is_user_premium()` flips to `false`) was also tested end-to-end for the first time and confirmed working.
- **Commit:** —
- **Date:** 2026-07-30

**SE-17 — `payments_paypal_payment_id_key` UNIQUE constraint was missing live despite an existing migration file for it (SE-15 regressed)**
- **Status:** ✅ Resolved (2026-07-30)
- **Files:** `supabase/migrations/20260729130460_restore_missing_paypal_payment_id_unique.sql` (new; was `20260727090000_unique_paypal_payment_id.sql`)
- **Description:** Discovered while live-testing PayPal's idempotency guard for Priority 4: two `payments` inserts using the same `paypal_payment_id` both succeeded with no error, when SE-15's own resolution says this constraint should reject the second one. `supabase migration list` showed `20260727090000_unique_paypal_payment_id.sql` as applied remotely — again, never actually run. Same root cause and discovery pattern as **SE-16**, found back-to-back while testing the same feature.
- **Risk:** Exactly the risk SE-15 already described (TOCTOU race on redelivered PayPal webhook events could produce duplicate `payments` ledger rows), fully live despite SE-15 being logged as resolved.
- **Recommendation:** Re-run the original `ALTER TABLE ... ADD CONSTRAINT` against the live database.
- **Resolution:** New migration re-adds the constraint, guarded via a `pg_constraint` existence check (`ADD CONSTRAINT IF NOT EXISTS` has no direct Postgres syntax for this constraint type). Verified live: a second insert with a duplicate `paypal_payment_id` now fails with `23505` as expected.
- **Commit:** —
- **Date:** 2026-07-30

**SE-15 — PayPal idempotency guard has a TOCTOU race: `payments.paypal_payment_id` has no database-level `UNIQUE` constraint**
- **Status:** ✅ Resolved (2026-07-27)
- **Files:** `src/routes/api/public/webhooks/paypal.ts:181-196`; `supabase/migrations/20260727090000_unique_paypal_payment_id.sql`
- **Description:** The idempotency guard added alongside the `DB-2` fix checks for an existing `payments` row by `paypal_payment_id` before inserting — an application-level check-then-insert, not database-enforced. Verified directly against every migration file (not assumed): `payments.stripe_payment_id` has `UNIQUE` (`...110804_...sql:153`), giving Stripe's equivalent guard an atomic, database-level backstop even under a race; `payments.paypal_payment_id` (`...110804_...sql:154`) does not, and no later migration adds one.
- **Risk:** Two near-simultaneous redeliveries of the same PayPal webhook event could both pass the existence check before either has inserted, producing two `payments` rows for the same capture. `subscriptions.UNIQUE(user_id, app_id)` still prevents a duplicate subscription row or double-granting access, so the blast radius is a duplicate ledger entry (inflates `adminOverviewStats`'s revenue sum), not an entitlement bypass.
- **Recommendation:** Add a `UNIQUE` constraint on `payments.paypal_payment_id`, mirroring `stripe_payment_id`, so the existing guard gets the same atomic, database-enforced backstop Stripe already has.
- **Resolution:** Added `payments_paypal_payment_id_key UNIQUE (paypal_payment_id)` (migration `20260727090000_...sql`) — NULLs are unaffected by design (every Stripe payment row has `paypal_payment_id = NULL`), so this only constrains actual PayPal capture IDs against each other. Paired with the required minimal code adjustment: the `payments` insert in `paypal.ts` now checks its own error and short-circuits (`duplicate: true`) if the constraint rejects it, instead of silently continuing on to flip `profiles.user_type`, send a notification, write an audit log entry, and fire n8n events for a payment that was never actually recorded a second time. **Known limitation, disclosed rather than silently assumed away:** Postgres doesn't support `NOT VALID` for `UNIQUE` constraints (only `CHECK`/`FOREIGN KEY`), so this migration scans the existing table and will fail to apply if any duplicate non-null `paypal_payment_id` already exists in production — this could not be verified against the live database from this environment.
- **Commit:** —
- **Date:** Logged 2026-07-27, resolved 2026-07-27

### Low

**SE-10 — Server-side error-capture buffer is a shared global across concurrent requests**
- **Status:** Open
- **Files:** `src/lib/error-capture.ts:1-9,65-81`
- **Description:** `lastCapturedError` is a module-level variable with a 5-second TTL meant to let `server.ts` recover the real error after h3 swallows it into a generic 500 (see **A-1**/**A-3**).
- **Risk:** In a Node SSR server handling concurrent requests, this is a shared singleton — Request A's captured error could theoretically be consumed while rendering Request B's error page within the same window.
- **Recommendation:** Scope error capture per-request (e.g. `AsyncLocalStorage`) instead of a module-level global.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

**SE-11 — Sensitive error data may be over-logged**
- **Status:** Open
- **Files:** `src/lib/error-capture.ts:18-63`
- **Description:** `console.error` is globally monkey-patched to expand any `Error`-like argument into its full message, stack, and up to 5 levels of `.cause` chain before logging.
- **Risk:** Any error whose message/cause chain contains sensitive values is fully unredacted in the log pipeline everywhere `console.error(err)` is called.
- **Recommendation:** Redact known-sensitive substrings/fields before logging, or gate full-cause-chain expansion behind a non-production flag.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

**SE-12 — PayPal OAuth token fetched fresh on every webhook event, fails closed under rate limiting**
- **Status:** Open
- **Files:** `src/routes/api/public/webhooks/paypal.ts:23-32`
- **Description:** `verifyPayPalSignature` requests a new OAuth token on every single delivery instead of caching it until near expiry.
- **Risk:** Under load this risks PayPal API rate limiting, which causes the signature check to fail closed — legitimate payments could be rejected purely due to throttling, not an actual signature problem. See also **PE-7**.
- **Recommendation:** Cache the OAuth token in memory for its reported `expires_in` duration.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

**SE-18 — Pinned Stripe API version string doesn't match the installed SDK's typed literal**
- **Status:** Open
- **Files:** `src/routes/api/public/webhooks/stripe.ts` (`new Stripe(secret, { apiVersion: "2024-11-20.acacia" })`)
- **Description:** Discovered while removing `as never` casts for **AD-8**: with accurate types in place, `"2024-11-20.acacia"` is not assignable to the installed `stripe` package's expected literal (`"2026-06-24.dahlia"`) — the cast had been silently masking this. Stripe's API generally tolerates an older pinned version on requests even from a newer SDK, so this is a type/SDK mismatch, not necessarily a live functional failure — but it wasn't verified either way, and shouldn't be changed as an incidental side effect of an unrelated cleanup.
- **Risk:** Unknown without verification — could be purely cosmetic (older pinned version still fully supported), or could mean the webhook is silently missing behavior/fields introduced between the two API versions.
- **Recommendation:** Decide deliberately whether to bump the pinned `apiVersion` to match the installed SDK (checking Stripe's changelog between the two versions for any breaking payload/webhook-shape changes first) or pin the SDK itself to a version matching the intended API version — either way, a decision for whoever owns the payment integration, not a side effect of type cleanup.
- **Resolution:** Left as a documented `as never` cast (the one deliberately-kept exception noted in **AD-8**'s resolution) rather than silently changed.
- **Commit:** —
- **Date:** 2026-07-31

---

## 9. Performance

### Medium

**PE-1 — `payment.success.tsx` polls with two overlapping mechanisms, creating unbounded query-cache growth**
- **Status:** Open
- **Files:** see **DA-6** (same finding, full detail there)
- **Description:** Cross-reference — `attempts` counter both drives `refetchInterval` and mutates the React Query key.
- **Risk:** See DA-6.
- **Recommendation:** See DA-6.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

**PE-2 — Admin user search issues a full server query per keystroke**
- **Status:** Open
- **Files:** see **AD-3** (same finding, full detail there)
- **Description:** Cross-reference — no debounce on `["admin-users", search]`.
- **Risk:** See AD-3.
- **Recommendation:** See AD-3.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

### Low

**PE-3 — Unmemoized `AuthContext` value causes broad, unnecessary re-renders app-wide**
- **Status:** Open
- **Files:** see **AU-8**; also compounds `src/routes/payment.success.tsx:55-57`
- **Description:** Cross-reference to AU-8. `payment.success.tsx`'s `refreshProfile`-dependent effect re-fires more often than intended because `refreshProfile`'s reference changes every render.
- **Risk:** See AU-8.
- **Recommendation:** See AU-8.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

**PE-4 — `router.tsx` disables preload caching entirely**
- **Status:** Open
- **Files:** `src/router.tsx:12`
- **Description:** `defaultPreloadStaleTime: 0` means every route preload (e.g. on link hover) is treated as immediately stale and refetched again on actual navigation.
- **Risk:** Defeats the purpose of preloading for any route relying on default caching behavior.
- **Recommendation:** Set a small positive `defaultPreloadStaleTime` (e.g. a few seconds) unless every route has a specific reason to always refetch on navigation.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

**PE-5 — Dead `notificationsQuery` fires an unnecessary Supabase query on every dashboard load**
- **Status:** Open
- **Files:** see **DA-2** / **CO-5**
- **Description:** Cross-reference — declared, never consumed, hidden by disabled unused-variable checks.
- **Risk:** See DA-2.
- **Recommendation:** See DA-2.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

**PE-6 — `NotificationBell` unnecessarily resubscribes its realtime channel on language change**
- **Status:** Open
- **Files:** see **DA-11**
- **Description:** Cross-reference.
- **Risk:** See DA-11.
- **Recommendation:** See DA-11.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

**PE-7 — PayPal OAuth token not cached, adds a network round trip to every webhook delivery**
- **Status:** Open
- **Files:** see **SE-12**
- **Description:** Cross-reference.
- **Risk:** See SE-12.
- **Recommendation:** See SE-12.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

---

## 10. Billing / Subscription Lifecycle

**Scope:** Findings about the lifecycle of a subscription after it's granted — renewal, expiry, cancellation, and refund handling — as distinct from the provider-specific integrity of the Stripe/PayPal webhook integrations themselves (tracked under Security). Surfaced during the `DB-2` root-cause analysis; tracked here rather than folded into the Stripe/PayPal-specific writeups in Security, since it's a lifecycle gap common to both providers, not a defect in either integration's own logic.

### High

**BL-1 — No refund or chargeback handling anywhere in the codebase**
- **Status:** 🟡 Partially Resolved (2026-07-27) — Stripe refund phase done; Stripe disputes and the entire PayPal side remain open
- **Files:** `src/routes/api/public/webhooks/stripe.ts:41-123`; `src/routes/api/public/webhooks/paypal.ts:67-69`; `payments.status` CHECK constraint (`supabase/migrations/20260724110804_...sql`); `supabase/migrations/20260727100000_add_stripe_payment_intent_id.sql`
- **Description:** Both webhook handlers only process one event type each (`checkout.session.completed` / `PAYMENT.CAPTURE.COMPLETED`) and return early for anything else. Neither Stripe's `charge.refunded`/`charge.dispute.created` nor PayPal's `PAYMENT.CAPTURE.REFUNDED`/`REVERSED` is handled anywhere. `payments.status` supports a `'refunded'` value in its schema `CHECK` constraint, but no code path in the repository ever writes it — confirmed via a full-codebase search, not assumed.
- **Risk:** A refunded or charged-back customer keeps full, permanent premium access with no record anywhere that a refund occurred, and no automatic revocation of entitlement.
- **Recommendation:** Subscribe to and handle refund/dispute event types in both webhook handlers; on refund, mark the corresponding `payments` row `status='refunded'` and revoke/expire the associated subscription. See also `SE-2`/`SE-4`/`SE-13` for related Stripe-specific integrity gaps in the same webhook.
- **Resolution:** Split into phases rather than fixed in one pass. **Phase 1 (done, this commit): Stripe refunds only.** `stripe.ts` now handles `charge.refunded` — matches the refund back to its `payments` row via a newly-added `stripe_payment_intent_id` column (populated at fulfillment time; refund events carry `payment_intent`, not the Checkout Session id already stored in `stripe_payment_id`, so the existing identifier couldn't be reused for matching), marks that row `status='refunded'`, cancels the associated subscription (`status='cancelled'`, `expires_at=now()`, mirroring the existing `adminRevokePremium` pattern), and reverts `profiles.user_type` to `'standard'` — but only after checking the user has no *other* currently-active subscription, respecting the existing global (not per-app) premium flag rather than trying to fix that separately. **Explicitly not done, by deliberate scope decision:** `charge.dispute.created` is not handled — `payments.status` has no `'disputed'` value, and mapping a dispute to `'refunded'` would conflate two different outcomes (a dispute can still be won) with no path back to restored access; left for a later phase that introduces a proper disputed state. **The entire PayPal side is untouched** — held pending `SE-5`'s empirical sandbox verification, so the PayPal refund-matching logic isn't built on unverified field-mapping assumptions. No backfill: only payments fulfilled after this migration can be automatically matched to a future refund.
  **Deployment requirement:** the Stripe Dashboard's webhook endpoint must be configured to send the `charge.refunded` event for this to take effect — this cannot be verified or configured from this environment. (The full list of required webhook events across both providers belongs in future deployment documentation, e.g. `DEPLOYMENT.md`/`WEBHOOK_SETUP.md` — not duplicated here.)
- **Commit:** —
- **Date:** Logged 2026-07-26, resolved (Phase 1 / Stripe) 2026-07-27

---

## 11. Messaging (Priority 7)

**Scope:** The one-on-one messaging system (`conversations`/`messages` tables, `conversation.functions.ts`/`message.functions.ts`). Verified against the actual implementation, not assumed, as part of a pre-commit edge-case review: self-conversation prevention, concurrent conversation creation, hide/auto-restore, notification-vs-realtime interaction, and Inbox ordering were all traced through the real code. Four of six checked scenarios were already correct by design; two were real gaps and were fixed in the same pass (self-messaging UI guard in `ProfileCard.tsx`; a race-condition-safe re-fetch on `23505` unique-violation in `getOrCreateConversation`). This entry records the one gap deliberately left open.

### Medium

**MSG-2 — `messaging` capability was seeded but had zero enforcement**
- **Status:** ✅ Resolved (2026-08-03)
- **Files:** `src/lib/conversation.functions.ts` (`getOrCreateConversation`), `src/components/dashboard/DashboardPage.tsx` (Sidebar nav), `src/routes/dashboard.messages.tsx`, `src/components/profile/ProfileCard.tsx`; `supabase/migrations/20260804100000_core_audit_resolution.sql` (`messaging` `dashboard_widgets` row)
- **Description:** Found during the Priority 8.6 audit: `getApplicationCapabilities()` was called only from Advertising/Dashboard-Widgets/Rewards code, never from any messaging code path — confirmed by grep. The sidebar rendered the Messages nav item unconditionally, unlike the adjacent Rewards/Advertising items which were correctly gated. Disabling `messaging` for an application did nothing.
- **Classification:** Architecture Deviation — see **A-6** for the companion fix (the capability vocabulary itself conflated this with the always-on `premium` entry).
- **Recommendation:** Gate messaging the same way Rewards/Advertising are gated: nav, pages, server functions, and UI actions.
- **Resolution:** A new `messaging` `dashboard_widgets` row (`requires_capability: 'messaging'`) drives `DashboardPage.tsx`'s Sidebar exactly like the existing `rewards`/`advertising` items. `getOrCreateConversation` now checks the capability against the initiator's current application — placed alongside the existing Premium/`is_contactable` checks, after the existing-conversation short-circuit, so it only gates *new* conversations, matching the pre-existing rule that eligibility is "checked once, at creation, never re-checked afterward" (an existing conversation keeps working even if messaging is later disabled for that application). `/dashboard/messages` shows an "unavailable" state instead of the inbox when the capability is disabled for the current application (a direct-URL visit can't bypass the nav gating). `ProfileCard`'s Send Message action is hidden entirely (not just locked, since there's nothing to upgrade into) when disabled.
- **Commit:** —
- **Date:** Logged 2026-08-02, resolved 2026-08-03

### Low

**MSG-1 — `sendMessage` has no idempotency guard against a duplicate call for the same logical message**
- **Status:** Open — recorded as a future enhancement, not a defect requiring immediate action
- **Files:** `src/lib/message.functions.ts` (`sendMessage`)
- **Description:** Each call unconditionally inserts a new `messages` row and a new `notifications` row. `ChatComposer`'s `sending` state guard only prevents a same-instance double-click; it does not protect against a genuine network-level retry (e.g., a client timeout after the server has already completed and committed the request), which would produce two message rows and two notifications for what the user experienced as a single send.
- **Risk:** Low — narrow window (requires an actual transport-level retry, not a UI double-click, which is already guarded), and the result is a duplicated message/notification, not a data-integrity or security issue. Not tied to realtime timing — `NotificationBell`'s realtime subscription never writes anything, so it cannot itself cause duplication (verified during the same review).
- **Recommendation:** Add a client-generated idempotency key (e.g., a UUID generated once per compose action, checked against a short dedupe window or a `UNIQUE` constraint) before this feature sees meaningful production volume.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-31

**MSG-3 — No deep link from a "new message" notification to its conversation**
- **Status:** ✅ Resolved (2026-08-11, Priority 15 Phase D)
- **Files:** `supabase/migrations/20260811140000_communication_and_support.sql`; `src/components/dashboard/NotificationBell.tsx`; `src/lib/admin.functions.ts`; `src/lib/entitlements.server.ts`; `src/lib/support.functions.ts`
- **Description:** Found during the Priority 8.6 audit: `notifications` has no `conversation_id`/target column, so clicking a "new message" notification does nothing but mark it read — it doesn't take the user to the conversation.
- **Risk:** UX gap only — no data-integrity or security impact.
- **Deferral rationale (historical):** Explicitly out of scope for Priority 8.7 by owner instruction ("do not implement" R-13) — resolving the open design question ("generalize to every notification type, or stay messaging-specific") required its own scoped decision, made in Priority 15 Phase D.
- **Resolution:** Generalized, not messaging-specific — `notifications.target_path` (nullable, CHECK-constrained to `^/dashboard/...` only, no external URL ever accepted, the same validate-before-storage rule as `CO-1`). `NotificationBell.tsx` now navigates to `target_path` and marks the notification read on click, for any notification type that sets it (currently: Admin → User Communication broadcasts, "Benefit granted", "Admin reply" on a support ticket). The one-on-one messaging module itself was not touched in this pass — a "new message" notification can adopt `target_path` the same way in a future, separate change.
- **Commit:** (Priority 15 Phase D — see `CLAUDE.md` → Priority 15 for the commit hash)
- **Date:** 2026-08-11

---

## 12. Priority 11 — Complete Security Audit & Hardening

**Scope:** A dedicated security pass covering everything built since the audit above was last updated (2026-08-05) — principally the entire `/v1` REST API (~90 endpoint files: auth/session/refresh/logout, CORE-minted JWTs, opaque rotating refresh tokens, and every `/v1/admin/*`/`/v1/me/*`/public endpoint), plus a fresh **live** check of RLS/grant state against every migration that claims to define it (this repo has a documented, recurring history — DB-6, SE-16, SE-17 — of a migration being tracked as "applied" without ever actually having run against the live database; this pass exists specifically to catch further recurrences of that pattern). Six parallel read-only audits covered: auth core/JWT/sessions, `/v1/admin/*` authorization, `/v1/me/*` and public API authorization, webhooks/payments/n8n, uploads/secrets/CORS/headers/logging, and live RLS/cross-app isolation (verified via direct `pg_policies`/`information_schema` queries against the linked database, not just migration-file inspection). Every Critical/High finding below was independently re-verified against the live database or the actual source before being fixed — none were taken on an audit agent's word alone.

### Critical

**PR11-1 — `profiles_public`/`premium_profiles_public` views granted full CRUD (not just SELECT) to `anon`/`authenticated`, completely bypassing `profiles`/`premium_profiles` RLS**
- **Status:** ✅ Resolved (2026-08-07)
- **Files:** `supabase/migrations/20260807100000_priority11_security_hardening.sql`
- **Description:** Confirmed live via `information_schema.role_table_grants`: both views (owned by the migration runner, not `security_invoker`) held `INSERT, UPDATE, DELETE, TRUNCATE` for `anon` and `authenticated`, in addition to `SELECT`. Since DML through a non-`security_invoker` view runs with the *owner's* privileges, this completely bypassed the base tables' RLS. `20260729130300` (which recreated these views) only ever `GRANT SELECT`ed — it never had occasion to `REVOKE` anything broader, because this Supabase project's baseline default-privilege configuration already grants new relations broad access to `anon`/`authenticated`/`service_role`, and a *view* has no RLS of its own to close that gap the way a table's RLS normally would.
- **Risk:** Any anonymous caller could rewrite or delete **any** user's name/photo/bio/verified-badge/tier (`profiles_public`) or phone/WhatsApp/email/website/social links (`premium_profiles_public`) via a direct PostgREST call — no authentication required.
- **Resolution:** `REVOKE INSERT, UPDATE, DELETE, TRUNCATE` on both views from `anon, authenticated`; both also set `security_invoker = on` as defense-in-depth so even a future stray grant on the base tables can't be reached through them. Verified live post-fix: only `SELECT`/`REFERENCES`/`TRIGGER` remain.
- **Commit:** 353ec37
- **Date:** 2026-08-07

**PR11-2 — `profiles.user_type`/`is_verified`/`is_active` self-escalation (AU-1/DB-1) was live again, and the original fix never covered the INSERT path**
- **Status:** ✅ Resolved (2026-08-07)
- **Files:** `supabase/migrations/20260807100000_priority11_security_hardening.sql`, `supabase/migrations/20260807100100_profiles_insert_column_lockdown.sql`
- **Description:** Live inspection showed `authenticated` held unrestricted column-level `UPDATE`/`INSERT` on `user_type`/`is_verified`/`is_active`/`id`, and the `"Users can update own profile"` policy's `WITH CHECK` was `null` — i.e. `20260726120000` (DB-1's fix, logged Resolved on 2026-07-26) never actually executed against the live database, the same "tracked applied, never ran" pattern as DB-6/SE-16/SE-17. Separately, and never covered by the original fix even when it did run: `INSERT` was never restricted, only `UPDATE` — since all three columns have safe defaults (`user_type='standard'`, `is_verified=false`, `is_active=true`), a user's one-time initial profile INSERT (their own `id`, enforced by the existing INSERT policy) could set `user_type='premium'`/`is_verified=true` directly, before the UPDATE lock ever comes into play.
- **Risk:** Any authenticated user could grant themselves Premium and a fake Verified badge, via `UPDATE` (regressed) or a crafted first `INSERT` (never fixed).
- **Resolution:** Re-asserted DB-1's exact original fix (column-level `REVOKE`/`GRANT` on `UPDATE`, explicit `WITH CHECK`) in a new migration (existing migrations are never edited/re-applied — see Migration Rules), then extended the identical allowlist approach to `INSERT`. Verified live post-fix: neither `UPDATE` nor `INSERT` grants remain on `user_type`/`is_verified`/`is_active` for `authenticated`.
- **Commit:** 353ec37
- **Date:** 2026-08-07

**PR11-3 — Undocumented live RLS policy let any authenticated user self-grant unlimited free Premium for any application**
- **Status:** ✅ Resolved (2026-08-07)
- **Files:** `supabase/migrations/20260807100000_priority11_security_hardening.sql`
- **Description:** A policy named `"Users insert own subscriptions"` (`INSERT`, `WITH CHECK (auth.uid() = user_id)`, no other constraint) existed live on `subscriptions` with no corresponding `CREATE POLICY` anywhere in any of this repo's 50 migration files — unexplained live drift, not a missing-migration gap. It placed no restriction on `status`/`expires_at`/`app_id`/`plan_id`.
- **Risk:** `POST /rest/v1/subscriptions` with the caller's own JWT and `{"status":"active","expires_at":"2099-01-01",...}` granted free, unlimited, self-service Premium for any application, entirely bypassing every payment webhook.
- **Resolution:** `DROP POLICY` — every legitimate entitlement write already goes through `service_role` (webhooks, admin grant/revoke, promotional trials), which bypasses RLS entirely and is unaffected. Verified live post-fix: only the pre-existing `SELECT`-own policy remains.
- **Commit:** 353ec37
- **Date:** 2026-08-07

**PR11-4 — Avatar/campaign-banner uploads had no server-side MIME/size enforcement independent of application code**
- **Status:** ✅ Resolved (2026-08-07)
- **Files:** `supabase/migrations/20260807100000_priority11_security_hardening.sql` (bucket `file_size_limit`/`allowed_mime_types`); `src/routes/v1/admin/media/branding.ts`, `src/lib/media-storage.ts`, `src/components/profile/AvatarUpload.tsx`, `src/routes/onboarding.tsx`, `src/routes/dashboard.advertising.tsx`, `src/routes/v1/media/avatar.ts`, `src/routes/v1/media/advertising-banner.ts` (extension-from-MIME-type fix, see PR11-6)
- **Description:** `AvatarUpload.tsx` uploads directly via the browser Supabase client, never through the `/v1/media/avatar` server route. The only enforcement for that path was the storage RLS `INSERT` policy, which checks only the folder prefix (`avatars/<user_id>/...`) — never content-type or size. The `core` bucket itself had no `file_size_limit`/`allowed_mime_types` set.
- **Risk:** Any authenticated user could upload an arbitrarily large file of any self-declared `Content-Type` (including `text/html` or `image/svg+xml` with embedded `<script>`) directly via the Storage REST API and get back a public URL that executes it.
- **Resolution:** Set `file_size_limit = 5MB` and `allowed_mime_types = [image/jpeg, image/png, image/webp, image/x-icon, image/vnd.microsoft.icon]` on the `core` bucket — enforced by Supabase Storage itself for every upload path (client-direct and server-route alike), regardless of what any calling code does or doesn't check. `image/svg+xml` deliberately excluded (see PR11-6). Verified live post-fix.
- **Commit:** 353ec37
- **Date:** 2026-08-07

### High

**PR11-5 — `conversations` INSERT policy had no eligibility check, letting any authenticated user bypass the messaging paywall via a direct REST call**
- **Status:** ✅ Resolved (2026-08-07)
- **Files:** `supabase/migrations/20260807100000_priority11_security_hardening.sql`; `src/lib/conversation.functions.ts`
- **Description:** `getOrCreateConversation` verifies the `messaging` capability, both-sides-Premium, and recipient `is_contactable` in application code, but performed its actual `INSERT` through the caller's own session. The live RLS `INSERT` policy only checked `auth.uid() = user_a_id OR auth.uid() = user_b_id` — none of those business rules. The `/v1/conversations` equivalent already wrote via `service_role` and was unaffected.
- **Risk:** `POST /rest/v1/conversations` with the caller's own JWT created a conversation with anyone, Premium or not, contactable or not, entirely bypassing the paywall.
- **Resolution:** Dropped the policy (matching `ad_campaigns`' existing "writes only via `service_role`, after server-validated checks" pattern); `getOrCreateConversation` now performs its existing-check, insert, and race-refetch through `service_role` instead of the caller's session. Application behavior is unchanged — the eligibility checks already ran server-side, only the final write's privilege level changed.
- **Commit:** 353ec37
- **Date:** 2026-08-07

**PR11-6 — Admin branding upload accepted `image/svg+xml` (stored XSS on the public storage domain) and derived the storage extension from the unsanitized client filename**
- **Status:** ✅ Resolved (2026-08-07)
- **Files:** `src/routes/v1/admin/media/branding.ts`, `src/lib/media-storage.ts` (+ its 5 call sites, see PR11-4)
- **Description:** SVG is an active-content format (`<script>`, event handlers); the admin logo/favicon/cover upload endpoint accepted it and served it back publicly with `contentType: file.type` as supplied by the caller. Separately (mirrors the already-tracked **CO-2**, but confirmed here as a genuine second occurrence in the `/v1` server route and `avatarPath`/`campaignBannerPath`), the storage extension was taken from `file.name.split(".").pop()` rather than the validated MIME type, letting a crafted filename inject an arbitrary trailing path segment into the storage key.
- **Risk:** The single administrator (this platform's only privileged account) uploading a crafted "logo" could plant a script that executes when the storage URL is opened directly — low-probability given the Single Administrator Rule, but a real stored-script vector on a public domain, and the same unsafe-extension pattern existed on the user-facing avatar/banner paths too (any authenticated user, not just the admin).
- **Resolution:** `image/svg+xml` removed from every upload allowlist (`branding.ts`). Extension is now derived from a small MIME-type → extension map in all five upload call sites (`branding.ts`, `avatar.ts`, `advertising-banner.ts`, and the two client-side callers via `media-storage.ts`'s `avatarPath`/`campaignBannerPath`, which now take `fileType` instead of `fileName`) — never from the client-supplied filename. Closes **CO-2** as a byproduct.
- **Commit:** 353ec37
- **Date:** 2026-08-07

**PR11-7 — `/v1` refresh-token rotation had a TOCTOU race (two concurrent refreshes of one token could both succeed) and reused-token detection didn't revoke the live descendant chain**
- **Status:** ✅ Resolved (2026-08-07)
- **Files:** `src/lib/v1/refresh-token.server.ts`
- **Description:** `rotateRefreshToken` checked `revoked_at IS NULL` in application code, then inserted a child row, then updated the parent to revoked — two concurrent calls presenting the same still-valid token could both pass the check before either `UPDATE` landed, both minting a valid child from one parent (an ordinary client-retry race, not just an attacker). Separately, presenting an already-rotated token was rejected, but its still-live descendant was never revoked — the standard "stolen token replay" signal (OAuth Security BCP) had no consequence for the legitimate holder's active session.
- **Risk:** A network-retry race could produce two simultaneously-valid sessions from one refresh token; a detected token-reuse event (real signal of compromise) didn't force re-authentication for anyone.
- **Resolution:** Rotation is now a single atomic conditional `UPDATE ... WHERE id = :id AND revoked_at IS NULL`, checked for whether it actually affected a row; the losing side's freshly-minted child is immediately revoked rather than left valid and unlinked. Presenting an already-rotated token now walks `replaced_by` to the live end of the chain and revokes it too.
- **Commit:** 353ec37
- **Date:** 2026-08-07

**PR11-8 — `/v1/profiles/{username}` served a suspended user's full profile (including live contact details for an eligible viewer), and an anonymous caller's `appId` was never validated, silently defaulting a user's visibility setting to "visible"**
- **Status:** ✅ Resolved (2026-08-07)
- **Files:** `src/routes/v1/profiles/$username.ts`
- **Description:** The handler never checked `is_active`, unlike the existing `u.$username.tsx` page it's supposed to mirror (which correctly 404s a suspended user) — directly contradicting the admin suspend action's intent. Separately, an anonymous caller's `appId` came straight from a query param with no existence check; since a bogus `appId` guarantees no matching `user_app_settings` row, the visibility gate silently defaulted to `true` regardless of what the profile owner actually configured on any real application.
- **Risk:** `GET /v1/profiles/{suspendedUser}` returned 200 with full data (and, for an eligible viewer, live phone/email/WhatsApp) for a user an admin had suspended. `GET /v1/profiles/{hiddenUser}?appId=<garbage-uuid>` bypassed that user's own "hide my profile" setting.
- **Resolution:** Added `.eq("is_active", true)` to the profile lookup, matching `u.$username.tsx` exactly. An anonymous caller's `appId` is now validated against `applications` before use; a nonexistent one is rejected rather than silently falling through to a visible-by-default outcome. An authenticated caller's `appId` (from their verified JWT) is unaffected — it was already trustworthy.
- **Commit:** 353ec37
- **Date:** 2026-08-07

**PR11-9 — No security headers (`Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`) set anywhere**
- **Status:** ⚠️ Partially Resolved / attempted, not verified effective (2026-08-07)
- **Files:** `src/server.ts`; `DEPLOYMENT.md`
- **Description:** Confirmed absent at every layer (app code, and no `nitro.config`/hosting config exists in this repo to set them either) — including on `/login`, which handles Google OAuth and had no clickjacking protection.
- **Risk:** `/login` was framable by a third-party page for a clickjacking attack against the sign-in flow; no baseline hardening against MIME-sniffing or unintended cross-origin framing anywhere.
- **Resolution attempted:** Added a `withSecurityHeaders()` wrapper in `src/server.ts`'s single top-level `fetch()` choke-point, setting all four headers on every response. **Empirically verified NOT to reach the client** for this app's actual response path: TanStack Start's streamed SSR responses commit HTTP headers to the underlying Node socket before this application-level wrapper ever runs (confirmed by tracing the compiled Nitro/h3 output — `writeHead()` is guarded by `if (!nodeRes.headersSent)`, and headers were already sent by the time this wrapper's Response reaches it), and this project's Vite config wrapper (`@lovable.dev/vite-tanstack-config`) deliberately does not expose Nitro's `routeRules`/header-injection surface (confirmed by reading its own type definitions) as a way to set headers earlier in the pipeline. The code is left in place as harmless defense-in-depth (correct in principle, and may take effect for non-streamed response types or if the config surface changes later), but **should not be considered an enforced control today**.
- **Recommendation:** Set these four headers at the reverse-proxy/hosting layer instead (see `DEPLOYMENT.md` → §7, new note) — the correct fix for this hosting setup, not an application-code problem.
- **Commit:** 353ec37
- **Date:** 2026-08-07

**PR11-10 — No rate limiting anywhere in the codebase (confirmed: no library installed, no hand-rolled equivalent existed)**
- **Status:** ⚠️ Partially Resolved (2026-08-07) — highest-risk endpoints only
- **Files:** `src/lib/rate-limit.server.ts` (new); `src/routes/v1/auth/session.ts`, `src/routes/v1/auth/refresh.ts`, `src/routes/api/public/webhooks/stripe.ts`, `src/routes/api/public/webhooks/paypal.ts`
- **Description:** `ApiErrorCode` already defined a `RATE_LIMITED` code that was never thrown anywhere. No endpoint — token issuance, either payment webhook, or any `/v1/me/*` mutation (messaging send, referral capture, reward redemption) — had any request-volume protection. The PayPal webhook specifically makes two outbound HTTPS calls to PayPal on *every* delivery, valid or not, before any rejection — a flood of garbage POSTs forces real PayPal API calls per request.
- **Risk:** Unmetered brute-force/DoS potential against token issuance and both webhook endpoints; PayPal's specific pattern additionally risks real API throttling from a garbage-request flood.
- **Resolution:** New minimal, dependency-free, in-memory fixed-window limiter (correct for this app's actual single-Node-process deployment target; a multi-instance deployment would need a shared store instead). Applied to `/v1/auth/session` (20/5min/IP), `/v1/auth/refresh` (30/5min/IP), and both webhook endpoints (60/min/IP, rejected before any expensive work). **Not applied to the remaining ~85 `/v1` endpoints** (messaging send, referral, export, reward redemption, etc.) — a deliberate scope decision, not an oversight; see PR11-20.
- **Commit:** 353ec37
- **Date:** 2026-08-07

**PR11-11 — No CORS handling anywhere, despite `/v1` being explicitly designed for cross-origin browser use by other applications**
- **Status:** ✅ Resolved (2026-08-09, Priority 14)
- **Files:** `src/lib/v1/cors.server.ts` (new), `src/server.ts`
- **Description:** `/v1` is meant to be called by other applications' frontends on other domains (BosniaFans, future apps), but no route sets any `Access-Control-*` header. The *absence* of CORS headers is fail-safe from a security standpoint (a browser blocks the cross-origin read by default) — this is a functionality gap, not an exploitable hole, which is why it's High rather than Critical.
- **Risk:** Browser-based cross-origin `fetch()`/`XHR` calls to `/v1/*` from another application's own frontend domain will be blocked by the browser's same-origin policy today, unless every consuming application only ever calls `/v1` server-to-server.
- **Resolution:** Allowed-origins policy explicitly decided (project owner, 2026-08-09): derived dynamically from `applications.domain` (60s in-memory cache) — never a hardcoded list, so a new application becomes CORS-allowed the moment its domain is configured, no code change or redeploy. Applied at the single global response choke-point in `server.ts` (same pattern already used for security headers), scoped strictly to `/v1/*` — same-origin SSR/HTML routes are untouched. Preflight `OPTIONS` intercepted before the file-based router (no route defines its own `OPTIONS` handler). Never a wildcard origin; `Access-Control-Allow-Origin` always echoes the exact validated `Origin`, paired with `Access-Control-Allow-Credentials: true` and `Vary: Origin` (required since the allow-origin value is per-request). An unrecognized origin never blocks the server from processing the request (CORS is a browser-enforced read-side control, not a server access gate) — it only withholds the header, which is what keeps the browser blocking that page's JS from reading the response. Verified end-to-end against real production data: allowed-origin preflight/actual requests get full CORS headers; disallowed-origin requests get `Vary: Origin` only; requests with no `Origin` header (server-to-server) are unaffected; non-`/v1` routes are unaffected.
- **Commit:** 353ec37
- **Date:** 2026-08-09

### Medium

**PR11-12 — `/v1/auth/session` didn't check application `visibility`, letting a `draft`/`archived` application's Google Client ID still mint CORE sessions**
- **Status:** ✅ Resolved (2026-08-07)
- **Files:** `src/routes/v1/auth/session.ts`
- **Description:** Only checked that `appId` resolves to *some* row, never its `visibility`. `archived` (retired, per `PROJECT_KNOWLEDGE.md` → Application Visibility) applications could still authenticate users.
- **Resolution:** Rejects `visibility === "archived"`. Deliberately does **not** reject `draft`/`coming_soon` — `draft` also covers Core's own permanently-hidden-from-the-dashboard-but-fully-functional application row (see AU-10's resolution), and `coming_soon` applications legitimately need to authenticate for pre-launch testing.
- **Commit:** 353ec37
- **Date:** 2026-08-07

**PR11-13 — `/v1/me/rewards/redeem` has a TOCTOU race allowing over-redemption of Reward Points**
- **Status:** Resolved
- **Files:** `src/routes/v1/me/rewards/redeem.ts`, `src/lib/rewards.functions.ts`, `src/lib/rewards.server.ts`, `supabase/migrations/20260811130000_entitlements_and_reward_hardening.sql`
- **Description:** Balance is computed in application code (sum of `reward_ledger` minus `reward_redemptions`), checked against `item.points_cost`, then a redemption row is inserted — no DB constraint, row lock, or atomic RPC ties the check to the write. Also found while fixing this: `/v1/me/rewards/redeem.ts` and `redeemReward` (`rewards.functions.ts`) each had their own hand-written copy of this same non-atomic logic.
- **Risk:** Two concurrent redemption requests can both read the same starting balance and both pass the check, letting a user redeem more points than they actually have.
- **Resolution:** `redeem_reward_atomic()` (`service_role`-only Postgres function, transaction-scoped per-user advisory lock via `pg_advisory_xact_lock`) performs the balance re-check and the insert as one atomic statement. Both call sites were also consolidated into one shared plain function, `redeemCatalogReward()` (`rewards.server.ts`), eliminating the duplicate logic rather than patching it twice.
- **Commit:** (Priority 15 Phase C — see `CLAUDE.md` → Priority 15 for the commit hash)
- **Date:** 2026-08-11

**PR11-14 — Stripe webhook redelivery race can produce duplicate reward points, notifications, and n8n events (not duplicate entitlement or charges)**
- **Status:** Open
- **Files:** `src/routes/api/public/webhooks/stripe.ts`
- **Description:** Unlike the PayPal handler (which returns early with `duplicate: true` if its `payments` insert fails), Stripe's fulfillment path only logs a failed `payments` insert and continues to notification/audit/reward/n8n regardless. Two near-simultaneous redeliveries of the same event can both pass the pre-check before either inserts, so the second `payments` insert fails on the UNIQUE constraint but the side-effects downstream of it still run a second time.
- **Risk:** Duplicate reward-point grants, duplicate user notifications, duplicate outbound n8n events on a genuine webhook-redelivery race. No double entitlement and no double charge (the `subscriptions` upsert is idempotent).
- **Recommendation:** Mirror PayPal's guard — check the `payments` insert error and return `{ received: true, duplicate: true }` before the notification/audit/reward/n8n block.
- **Resolution:** —
- **Commit:** 353ec37
- **Date:** 2026-08-07

**PR11-15 — `has_any_active_premium`/`get_premium_application_ids`/`get_visible_application_ids` accept an arbitrary `_user_id` with no caller-identity check**
- **Status:** ⚪ Reviewed — confirmed intentional, not a defect
- **Files:** `src/lib/premium.ts` (client-callable RPC wrappers)
- **Description:** All three are `SECURITY DEFINER` functions callable by `anon`/`authenticated` for any `_user_id`, initially flagged as a potential information-disclosure gap. Traced against actual usage: a user's Premium status (and, per `u.$username.tsx`, which specific applications they're Premium on) is **already a deliberately public fact** — the public profile page's "Premium" badge and "Premium on: ..." list are rendered for anonymous visitors by design (Global Premium Visibility & Contact System, `PROJECT_KNOWLEDGE.md` → Premium Model). Restricting these RPCs to the target user/an admin would break that existing, intentional feature.
- **Resolution:** No change — confirmed correct as-is after tracing real call sites, not assumed.
- **Commit:** 353ec37
- **Date:** 2026-08-07

**PR11-16 — Avatar/banner MIME type is validated via the client-declared `Content-Type` header, not content-sniffed**
- **Status:** 🟡 Partially mitigated (2026-08-07)
- **Files:** `src/routes/v1/media/avatar.ts`, `src/routes/v1/media/advertising-banner.ts`, `src/routes/v1/admin/media/branding.ts`
- **Description:** `file.type` is attacker-controllable (the caller sets it on the multipart form part); none of the three upload endpoints sniff actual file bytes.
- **Risk:** A caller could declare `Content-Type: image/png` while uploading non-image bytes. Residual risk after PR11-4/PR11-6: the bucket-level `allowed_mime_types` now blocks anything outside a narrow image allowlist regardless of what's declared, and `image/svg+xml` (the actual script-execution vector) is excluded — so a mismatched-but-declared-safe file can no longer execute as script, only be mis-typed.
- **Recommendation:** Sniff magic bytes (or a small library) instead of trusting `file.type`, if stricter content-integrity guarantees are needed later.
- **Resolution:** Not fully fixed — the higher-severity execution vector (PR11-4/PR11-6) is closed; header-spoofing within the safe-type allowlist remains possible.
- **Commit:** 353ec37
- **Date:** 2026-08-07

**PR11-17 — Several live defense-in-depth gaps found via direct Postgres/Supabase-advisor inspection**
- **Status:** Open — explained, not fixed (narrow/no realistic exploit path)
- **Files:** N/A (database configuration)
- **Description:** **(a)** `premium_profiles`' `ALL` policy has no explicit `WITH CHECK` (relies on the USING→WITH CHECK implicit fallback for UPDATE — the exact anti-pattern DB-1 was about, though here the fallback happens to enforce the same condition, so not currently exploitable). **(b)** `rls_auto_enable()` (an event-trigger function) has default `PUBLIC EXECUTE`, callable via RPC by `anon`/`authenticated`, but errors out immediately outside a real DDL event — unnecessary surface, not exploitable. **(c)** `enforce_identity_lock()` has a mutable `search_path` (missing `SET search_path`) — standard hardening item, low risk since it's a trigger, not directly callable. **(d)** Supabase Auth's leaked-password protection is disabled (a dashboard setting, not code).
- **Recommendation:** Add an explicit `WITH CHECK` to `premium_profiles`' policy for consistency with `user_app_settings`' own `ALL` policy; `REVOKE EXECUTE ON FUNCTION rls_auto_enable() FROM anon, authenticated`; add `SET search_path = public` to `enforce_identity_lock()`; enable leaked-password protection in the Supabase Auth dashboard.
- **Resolution:** —
- **Commit:** 353ec37
- **Date:** 2026-08-07

**PR11-18 — Google ID token exchange has no nonce; refresh tokens are delivered via URL fragment with no absolute session lifetime cap**
- **Status:** Open — explained, largely architectural/deliberate
- **Files:** `src/routes/login.tsx`, `src/routes/v1/auth/session.ts`, `src/lib/v1/refresh-token.server.ts`
- **Description:** **(a)** Neither Google Identity Services' `initialize()` nor `signInWithIdToken` is passed a nonce — a captured-but-unexpired (~1hr) Google ID token is replayable to mint additional CORE session pairs; requires the ID token to leak first (XSS/logging/MITM), not remotely exploitable on its own. **(b)** The cross-app login handoff (`login.tsx`) delivers the refresh token via URL fragment (the documented, deliberate OAuth2 Implicit Grant shape for this platform's centralized-IdP architecture — see AU-10) — lands in browser history/autocomplete/any script reading `window.location.href` on the receiving app. **(c)** `rotateRefreshToken` resets `expires_at` to `now + 30 days` on every rotation with no tracked maximum age from original issuance — a continuously-refreshed session can persist indefinitely.
- **Recommendation:** Add a nonce to the Google ID token exchange as cheap defense-in-depth; consider a one-time-use code exchanged server-side instead of shipping the refresh token itself through the fragment, if the fragment-exposure risk is judged worth the added complexity; decide deliberately whether to cap total session-chain age.
- **Resolution:** — (deliberately not changed without explicit direction — (b) in particular is an existing, approved architectural decision, not an oversight)
- **Commit:** 353ec37
- **Date:** 2026-08-07

**PR11-19 — Several `/v1/admin/*` endpoints have minor data-hygiene gaps**
- **Status:** Open — explained, not fixed
- **Files:** `src/routes/v1/admin/verification/$userId.ts`, `src/routes/v1/admin/users/$userId/index.ts`, and several `$appId`/`$userId`-scoped upsert endpoints (capabilities, dashboard-widgets, share-invite, advertising-settings, trusted-advertisers, premium/grant)
- **Description:** `verification/$userId.ts`'s `POST` returns a false-success response for a nonexistent `userId` (0 rows affected, no error). `users/$userId/index.ts`'s `username` field has no format/uniqueness validation (mirrors the pre-existing, non-`/v1` `adminUpdateUser`'s identical gap — not a `/v1`-introduced regression). Several upsert endpoints write rows keyed by a client-supplied ID without first confirming the referenced row exists, risking either a raw FK-constraint error or an orphaned row on a typo'd ID.
- **Risk:** Low — none let the single administrator affect anything beyond what they're already authorized to touch; the concern is response-shape/data-hygiene, not access control. (Confirmed structurally: classic cross-tenant IDOR doesn't apply the way it would in a multi-admin panel, given this platform's Single Administrator Rule.)
- **Recommendation:** Add a `maybeSingle()` existence check before each affected upsert/update, matching the pattern most sibling endpoints already use.
- **Resolution:** —
- **Commit:** 353ec37
- **Date:** 2026-08-07

### Low

**PR11-20 — No rate limiting across the remaining ~85 `/v1` endpoints (messaging send, referral, export, etc.)**
- **Status:** ⚠️ Partially Resolved (2026-08-11, Priority 15 Phase C) — 2 more endpoints covered, ~83 remain open
- **Files:** `src/routes/v1/events/index.ts`, `src/lib/rewards.functions.ts`, `src/routes/v1/me/rewards/redeem.ts`; all other `/v1/me/*`/`/v1/conversations/*` mutation endpoints not listed in PR11-10 remain unprotected
- **Description:** Only the 4 highest-risk endpoints (token issuance, both webhooks) were rate-limited. Messaging send, referral-link capture, data export still have no request-volume protection.
- **Risk:** Spam/abuse potential (messaging spam, referral-link farming), not an entitlement-bypass or data-exposure risk.
- **Resolution:** `POST /v1/events` (120/min per application+user) and reward redemption (10/min per user) now call the existing `enforceRateLimit()` (`src/lib/rate-limit.server.ts`) — extended, not duplicated. Messaging send, referral-link capture, and data export remain open; comprehensive coverage across the remaining dozens of routes with individually-tuned thresholds is still a larger scope decision than either this pass or Priority 15 warrants taking on unilaterally.
- **Commit:** (Priority 15 Phase C — see `CLAUDE.md` → Priority 15 for the commit hash)
- **Date:** 2026-08-11

**PR11-21 — Minor code-quality items found during the audit**
- **Status:** Open
- **Files:** `src/routes/api/public/webhooks/paypal.ts` (stale/contradictory comment about the `paypal_payment_id` UNIQUE constraint — the constraint does exist, one of two comments describing it is outdated); `src/routes/v1/me/advertising/campaigns/index.ts` and `src/routes/v1/me/notifications/index.ts` (query-string filters read without the shared Zod `parseQuery` helper other endpoints use — not exploitable, PostgREST parameterizes filter values, just inconsistent with the established convention); `src/routes/v1/me/index.ts` (`avatarUrl` field accepts any external URL, not just the platform's own storage domain — self-affecting only).
- **Resolution:** —
- **Commit:** 353ec37
- **Date:** 2026-08-07

**PR11-22 — `/v1/applications` (and likely other `/v1` GET endpoints) returned HTTP 500 in local testing — confirmed pre-existing, unrelated to this security pass**
- **Status:** Open — functional bug, not a security finding; flagged for separate follow-up
- **Files:** `src/routes/v1/applications/index.ts` (or a shared dependency — `optionalUserContext`/`resolveLocale`/`admin.server.ts`)
- **Description:** Discovered incidentally while boot-testing Priority 11's changes. Reproduced against a clean checkout of the immediately-prior commit (`git stash` isolation test) with the exact same result, confirming this predates every change in this pass and isn't a regression from it. Root cause not investigated further — out of scope for a security-focused pass.
- **Risk:** Functional, not security — but blocks any real use of at least this endpoint today.
- **Recommendation:** Investigate and fix in a dedicated pass (capture the actual server-side stack trace, which this environment's process-output capture could not reliably surface).
- **Resolution:** —
- **Commit:** 353ec37
- **Date:** 2026-08-07

---

## Strengths worth preserving

- **Admin authorization is correctly layered**: client-side `AdminGate` (`admin.tsx`) plus independent server-side `assertAdmin()` on every mutating admin server function — not a client-only check.
- **Public profile pages correctly gate private contact info** behind both the owner's `*_public` flags and viewer/owner state, and never render email addresses to anonymous visitors.
- **The final migration's RLS hardening pass** (`20260725070421_...sql`) correctly replaced earlier over-permissive public-read policies with masking views and a scoped premium-check function — a good pattern to follow for any future public-data exposure.
- **No open-redirect vectors** were found in `login.tsx`/`auth.callback.tsx`/`index.tsx` — post-auth destinations are hardcoded, never derived from a query parameter.
- **Webhook signature verification itself** (Stripe's `constructEventAsync`, PayPal's OAuth-based verification call) is implemented, not skipped — the issues found are in what happens *after* a validly-signed event is accepted (SE-2, SE-4, SE-5), not in the verification step itself.
