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
| Architecture | 0 | 1 | 2 | 1 |
| Authentication | 1 | 2 | 3 | 2 |
| Dashboard | 0 | 1 | 6 | 4 |
| Admin Panel | 0 | 0 | 4 | 5 |
| Database | 2 | 0 | 1 | 2 |
| Routing | 0 | 0 | 0 | 2 |
| Components | 0 | 1 | 3 | 2 |
| Security (cross-cutting + payments) | 4 | 2 | 5 | 3 |
| Performance | 0 | 0 | 2 | 5 |
| Billing / Subscription Lifecycle | 0 | 1 | 0 | 0 |

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
- **Status:** Open
- **Files:** `.env.example` vs. `src/integrations/supabase/client.server.ts:33-34`, `src/integrations/supabase/auth-middleware.ts:36-37`, `src/routes/api/public/webhooks/paypal.ts:12,17-19`, `src/lib/n8n.server.ts:14`
- **Description:** `.env.example` documents `VITE_SUPABASE_*` variables that no in-scope code reads (the client hardcodes URL/anon key in `src/integrations/supabase/client.ts:4-5` instead), while omitting server-only variables the app actually requires (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `PAYPAL_ENV`, `PAYPAL_WEBHOOK_ID`, `N8N_WEBHOOK_URL`). `RESEND_API_KEY` is listed but unused anywhere under `src/`.
- **Risk:** A fresh deployment following `.env.example` is missing required secrets and will fail at runtime.
- **Recommendation:** Reconcile `.env.example` with actual `process.env.*` usage.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

**A-3 — `server.ts`'s "catastrophic SSR error" detection depends on parsing an internal framework error shape**
- **Status:** Open
- **Files:** `src/server.ts:21-45`
- **Description:** `isH3SwallowedErrorBody` detects h3-swallowed errors by checking for `{"unhandled":true,"message":"HTTPError"}` — an internal implementation detail of the currently-pinned h3/Nitro version.
- **Risk:** If that shape changes on a dependency bump, the fallback silently stops working (raw JSON error is returned to the client instead of the friendly error page), with no test to catch it.
- **Recommendation:** Add a regression test pinned to the current h3/Nitro version, or find a more stable signal if the framework supports one.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

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
- **Status:** Open
- **Files:** `src/context/AuthContext.tsx:28-83`
- **Description:** The initial SELECT (28–34), UPDATE (50–55), and INSERT (68–80) all destructure only `data`, never `error`. If the SELECT fails transiently, `existing` is `undefined` and the code falls into the INSERT branch for a user who already has a row — that insert fails on the primary key (also unchecked), and the function returns `null`.
- **Risk:** Downstream, `ProtectedRoute.tsx:21` and dashboard code then treat an existing, real user as having no/incomplete profile and can misroute them to onboarding.
- **Recommendation:** Check `error` at each step; distinguish "no row found" from a genuine query failure before deciding to insert.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

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
- **Status:** Open
- **Files:** `src/components/dashboard/NotificationBell.tsx:45,51`; dead correct query at `src/components/dashboard/DashboardPage.tsx:124-136`
- **Description:** The bell derives its unread count from only the 5 most-recently-fetched notifications. A correct `count: "exact", head: true` query already exists in `DashboardPage.tsx` but is never referenced again after being declared (dead code — see **CO-5**) and isn't wired to `NotificationBell`.
- **Risk:** A user with more than 5 unread notifications never sees an accurate badge count; the unused query also wastes a network request every dashboard load (see **PE-5**).
- **Recommendation:** Wire the exact-count query into the badge (as a prop or by having `NotificationBell` run its own head-count query); delete the dead query if unused elsewhere.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

**DA-3 — "Settings" quick-link tile routes back to `/dashboard` instead of `/dashboard/settings`**
- **Status:** Open
- **Files:** `src/components/dashboard/DashboardPage.tsx:512` (compare sidebar entry at line 569, which correctly uses `/dashboard/settings`)
- **Description:** Apparent copy/paste from the "Home" entry above it in the same Quick Links array.
- **Risk:** Clicking "Settings" from Quick Links just reloads the dashboard instead of navigating to settings.
- **Recommendation:** Change the `to` value to `/dashboard/settings`.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

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
- **Status:** Open
- **Files:** `src/routes/dashboard.settings.tsx:90-117`
- **Description:** The function optimistically updates state via `setAppSettings((prev) => prev.map(...))`, then immediately reads `appSettings.find(...)` from the outer closure — which still holds the pre-update value.
- **Risk:** Two quick successive toggles on the same app (e.g. "visible in directory" then "can be contacted") can cause the second write's fallback values to silently revert the first toggle in the database.
- **Recommendation:** Derive the write payload from the functional updater's `prev` argument (or a ref), not from the outer closure variable.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

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
- **Status:** Open
- **Files:** `src/routes/payment.success.tsx:19-22,36-46`
- **Description:** `search.app_id` is optional in `validateSearch`. When absent, the success check becomes "does this user have any active subscription" rather than "did this checkout activate."
- **Risk:** A user with a pre-existing subscription for App A who lands on this page for an unrelated/failed App B checkout will see "success" despite nothing new being purchased.
- **Recommendation:** Require `app_id` (and ideally a server-verified transaction/session id) to render success; correlate against the specific subscription/payment row created for that transaction.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

### Low

**DA-8 — `activateTrial` failure permanently blocks retry for the browser session, error swallowed silently**
- **Status:** Open
- **Files:** `src/components/dashboard/DashboardPage.tsx:93-107`
- **Description:** `triedTrialRef.current = true` is set synchronously (line 98) before `activateTrial()` resolves/rejects, and failures are swallowed by an empty `.catch(() => {})` (line 106).
- **Risk:** A transient failure (network blip) leaves the ref `true` for the component's lifetime, so an eligible user never gets the trial activated that session, with no error surfaced anywhere.
- **Recommendation:** Only set the ref on success (or a definitive "not eligible" response); log/surface failures instead of swallowing them.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

**DA-9 — Hardcoded, non-localized delete-confirmation phrase**
- **Status:** Open
- **Files:** `src/routes/dashboard.settings.tsx:179,349`
- **Description:** Account deletion requires typing the literal Bosnian word `"OBRIŠI"` regardless of active UI language, while everything else in the dialog is translated via `t()`.
- **Risk:** Confusing for EN/DE users in an otherwise fully localized dialog.
- **Recommendation:** Localize the required confirmation token per language, or clearly state that the literal word is required irrespective of language.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

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

**Flow:** `src/routes/admin.tsx` (`AdminGate`) is the parent layout for all `/admin/*` child routes and blocks the `<Outlet/>` for non-admins — confirmed via `routeTree.gen.ts` that every admin page (`admin.applications`, `admin.communication`, `admin.payments`, `admin.users`, `admin.verification`) is a child of it. Every mutating server function in `src/lib/admin.functions.ts` independently calls `assertAdmin()` (`src/lib/admin.server.ts`) which checks the `user_roles` table server-side. **This layered gating is correctly implemented** — no IDOR/auth-bypass was found on admin routes.

### Medium

**AD-1 — Three divergent definitions of "active premium subscription" across `admin.functions.ts`**
- **Status:** Open
- **Files:** `src/lib/admin.functions.ts:239-247` (`adminOverviewStats`), `:303-307` (`adminSendNotification`), `:362-367` (`adminListVerificationRequests`)
- **Description:** Only `adminOverviewStats` checks `status="active"` AND `expires_at > now()` AND `started_at <= now()`. `adminSendNotification` and `adminListVerificationRequests` both check only `status="active"`, with no expiry check.
- **Risk:** If a cron/webhook hasn't yet flipped a lapsed subscription's `status` to `"expired"`, the other two functions still treat it as active — broadcasting "premium-only" notifications to, and surfacing as verification candidates, users whose subscription has actually lapsed.
- **Classification:** Architecture Deviation — three separate app-level implementations of what should be one Core-owned "is this user's subscription active" answer, per `PROJECT_KNOWLEDGE.md` → Single Source of Truth. Severity intentionally left at Medium (correctness/consistency issue, not an exploitable defect).
- **Recommendation:** Extract one shared "is currently active premium" predicate and use it in all three places.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

**AD-2 — `PlanForm` doesn't resync its local state after a save**
- **Status:** Open
- **Files:** `src/routes/admin.applications.tsx:224-235` (contrast `AppSettings` in the same file, lines 383-390, which does resync correctly)
- **Description:** State is seeded once from `initial` with no resync effect. After a save triggers `qc.invalidateQueries(["admin-plans", activeAppId])` and a refetch, the same-keyed `PlanForm` instance keeps its stale local state.
- **Risk:** Can silently diverge from what's actually persisted (e.g. after a concurrent edit in another admin tab). The "new plan" form also never resets after a successful create.
- **Recommendation:** Add a `useEffect` keyed on `initial.id`/`updated_at` to resync local state; reset the "new plan" form on successful create.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

**AD-3 — Admin user search fires a full query on every keystroke**
- **Status:** Open
- **Files:** `src/routes/admin.users.tsx:44,50-53`
- **Description:** `search` state is included directly in the `useQuery` key (`["admin-users", search]`) with no debounce.
- **Risk:** `adminListUsers` (an `ilike` scan) re-runs on every keystroke. See also **PE-2**.
- **Recommendation:** Debounce the search value (~300ms) before it feeds the query key.
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
- **Status:** Open
- **Files:** `src/lib/admin.functions.ts` (e.g. lines 45, 105, 112, 133, 157, 327, 389, 414, 450)
- **Description:** Nearly every insert/update payload is cast `as never` to satisfy Supabase's currently-placeholder generated types (see `src/types/database.ts` header comment).
- **Risk:** None of these write paths get real compile-time verification against the actual schema — a column rename/typo wouldn't be caught until runtime.
- **Recommendation:** Once real generated table types are wired up, remove the `as never` casts.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

**AD-9 — `planInputSchema.currency` accepts any string, not a constrained set**
- **Status:** Open
- **Files:** `src/lib/admin.functions.ts:28`
- **Description:** `currency: z.string().default("EUR")` has no enum/allowlist.
- **Risk:** Permits malformed currency codes into `subscription_plans.currency`.
- **Recommendation:** Constrain to `z.enum([...])` of actually-supported currencies.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

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
- **Status:** Open
- **Files:** `src/types/database.ts:6` vs. `supabase/migrations/20260724110804_...sql:19`
- **Description:** `export type UserType = "standard" | "premium" | "admin";` but the DB constraint is `CHECK (user_type IN ('standard','premium','admin','super_admin'))`.
- **Risk:** A row with `user_type = 'super_admin'` is unrepresented in the app's type system, so any `=== "admin"` comparison silently misses `super_admin` rows.
- **Recommendation:** Add `"super_admin"` to the `UserType` union, or remove it from the DB constraint if it's not actually meant to be used.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

### Low

**DB-4 — `is_user_premium()` is not scoped per application, despite a per-app subscription/pricing model**
- **Status:** Open
- **Files:** `supabase/migrations/20260725070421_432f3b63-9cdc-48d8-8393-c21afa2d58fd.sql:129-142`; consumed at `src/routes/u.$username.tsx:63`
- **Description:** The function returns `true` if the user has any active subscription to any app — it does not filter by `app_id` even though `subscriptions.app_id` exists. `premium_profiles` (the bio-link/contact-details table) has no `app_id` column at all — one global row per user.
- **Risk:** A subscription to any single app currently unlocks the global "Premium" badge/contact-sharing on the shared bio-link page everywhere.
- **Classification:** Architecture Deviation — `PROJECT_KNOWLEDGE.md` → Premium Model states premium belongs to an application, not globally. The current schema/function implement a global concept instead. Severity intentionally left at Low per prior approval; this is tracked as an architecture-consistency gap to close deliberately, not an exploitable defect.
- **Recommendation:** Scope `is_user_premium()` (and, longer-term, `premium_profiles`) by `app_id` to match the stated Premium Model, or explicitly revise the Premium Model documentation if a global perk is intended after all.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

**DB-5 — Stale `GRANT SELECT ... TO anon` left over from superseded early migrations**
- **Status:** Open
- **Files:** `supabase/migrations/20260724110804_...sql:30`, `20260724114742_...sql`
- **Description:** These early, over-permissive read policies were correctly dropped/replaced by `20260725070421_...sql`'s masking views, and RLS now blocks all rows for `anon` on the base tables. The original `GRANT SELECT ... TO anon` statements on the base tables are still technically in effect at the grant level, relying entirely on "no permissive policy remains" rather than the grant itself being revoked.
- **Risk:** No live exposure today (confirmed) — hygiene/defense-in-depth gap only.
- **Recommendation:** Revoke the now-redundant grants for defense-in-depth and schema clarity.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

---

## 6. Routing

**Structure:** File-based routing under `src/routes/`, compiled into `src/routeTree.gen.ts` by `@tanstack/router-plugin`. Public routes (`index`, `login`, `pricing`, `u.$username*`), authenticated routes (`dashboard.*`, gated by `ProtectedRoute`), and admin routes (`admin.*`, gated by the `AdminGate` parent in `admin.tsx`) are cleanly separated. Two server-only API routes exist under `src/routes/api/public/webhooks/`.

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
- **Status:** Open
- **Files:** `src/routes/pricing.tsx:80-92`
- **Description:** `client_reference_id`/`custom` are built entirely client-side as `${user.id}__${activeAppId}__${plan.id}` and appended as a plain query string to a static payment link.
- **Risk:** Nothing stops a user from copying the link and editing these values before completing checkout. Exploitability beyond **SE-2** depends on whether the webhook cross-checks the actual amount paid, which it only does when `plan_id` is present.
- **Recommendation:** Always verify amount/plan against the payment provider's authoritative transaction data server-side; never trust the reference string alone to determine what to grant.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

**SE-8 — GDPR account deletion: unchecked delete errors and no storage cleanup**
- **Status:** Open
- **Files:** `src/lib/gdpr.functions.ts:51-64`
- **Description:** The per-table delete loop never inspects `{ error }`; a failed delete on any table is silently ignored and the flow proceeds to `auth.admin.deleteUser(userId)`. Avatar files in the `avatars` storage bucket are also never removed.
- **Risk:** Orphaned personal data and avatar files can remain after erasure is reported as successful (`{ ok: true }`).
- **Recommendation:** Check/aggregate errors from each delete and fail loudly rather than proceeding unconditionally; add a `storage.remove()` pass over the user's avatar objects.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

**SE-9 — Webhook handlers don't check errors on `payments`/`profiles`/`notifications` writes, or on `writeAuditLog`'s own insert**
- **Status:** Open
- **Files:** `src/routes/api/public/webhooks/stripe.ts:133,145-160`; `src/routes/api/public/webhooks/paypal.ts:156,167-182`; `src/lib/admin.server.ts:25-33`
- **Description:** Unlike the `subscriptions` insert (whose error is checked), every subsequent write in the same handler discards its `{ error }` result.
- **Risk:** A failure in any of them leaves an active subscription with no matching payment record, no user notification, and no audit trail — with zero logging or alerting.
- **Recommendation:** Check and log/alert on the result of each write; consider wrapping the post-payment side-effect sequence to report which steps failed.
- **Resolution:** —
- **Commit:** —
- **Date:** 2026-07-26

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

## Strengths worth preserving

- **Admin authorization is correctly layered**: client-side `AdminGate` (`admin.tsx`) plus independent server-side `assertAdmin()` on every mutating admin server function — not a client-only check.
- **Public profile pages correctly gate private contact info** behind both the owner's `*_public` flags and viewer/owner state, and never render email addresses to anonymous visitors.
- **The final migration's RLS hardening pass** (`20260725070421_...sql`) correctly replaced earlier over-permissive public-read policies with masking views and a scoped premium-check function — a good pattern to follow for any future public-data exposure.
- **No open-redirect vectors** were found in `login.tsx`/`auth.callback.tsx`/`index.tsx` — post-auth destinations are hardcoded, never derived from a query parameter.
- **Webhook signature verification itself** (Stripe's `constructEventAsync`, PayPal's OAuth-based verification call) is implemented, not skipped — the issues found are in what happens *after* a validly-signed event is accepted (SE-2, SE-4, SE-5), not in the verification step itself.
