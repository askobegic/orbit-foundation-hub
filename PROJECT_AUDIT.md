# Project Audit — orbit-foundation-hub

**Scope:** Full repository (164 tracked files) — TanStack Start (React 19 SSR) + Supabase (Postgres/Auth/Storage) + Stripe/PayPal payments.
**Method:** Read-only static review of every source file, every SQL migration, and all config. No code was modified during the audit itself.
**Purpose:** Build a complete, accurate picture of the current implementation — architecture, data flow, and defects — before new features are planned on top of it.

## Remediation log

| Finding | Status | Date | Notes |
|---|---|---|---|
| SE-1 — `.env` tracked in git | ✅ Resolved | 2026-07-26 | `.env`/`.env.local`/`.env.*.local` added to `.gitignore`; `.env` untracked via `git rm --cached` (local file preserved, content unchanged). No secret was ever committed (verified via full `git log -p`), so no credential rotation was required. |

## Severity definitions

| Severity | Meaning |
|---|---|
| **Critical** | Exploitable remotely/by any user, or causes data loss/corruption or broken core revenue flows (payments) |
| **High** | Serious correctness or security bug that manifests under normal use |
| **Medium** | Real bug, but limited blast radius or requires specific conditions |
| **Low** | Code smell, minor edge case, or small UX/perf inefficiency |

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
| Security (cross-cutting + payments) | 3 | 2 | 3 | 3 |
| Performance | 0 | 0 | 2 | 5 |

Several issues are cross-cutting (e.g. the profile self-escalation bug is a Database/RLS root cause with an Authentication code path and a Security consequence). Each is written up **once**, in the section that owns its root cause, with short cross-reference pointers elsewhere.

---

## 1. Architecture

**Stack:** TanStack Start (file-based routes in `src/routes/`, SSR via `src/server.ts`/`src/start.ts`, generated `src/routeTree.gen.ts`), React 19, TanStack Router + React Query, Supabase (Postgres + Auth + Storage), Stripe Checkout + PayPal for payments, i18next for localization (en/de/bs), Tailwind v4, shadcn/ui components. Deployed as a single Node/edge-style server entry (`src/server.ts`) wrapping the TanStack Start server handler, with an `errorMiddleware` (`src/start.ts`) and a Supabase-auth-attaching middleware (`src/integrations/supabase/auth-attacher.ts`) applied globally.

Server-only logic lives in `*.server.ts`/`*.functions.ts` files under `src/lib/` (admin, GDPR, trial, n8n, Stripe helpers) and is invoked from route components via TanStack Start server functions. Two public, unauthenticated webhook routes (`src/routes/api/public/webhooks/{stripe,paypal}.ts`) handle payment provider callbacks directly against `supabaseAdmin` (service-role client), bypassing RLS by design.

### High
- **A-1. `errorMiddleware` swallows structured errors/status codes into a generic HTML 500**
  - **File:** `src/start.ts`, lines 6–19
  - **Root cause:** The middleware only re-throws errors that are plain objects with a `.statusCode` property. A thrown `Response` (e.g. `new Response("Forbidden", { status: 403 })` from `assertAdmin`, `src/lib/admin.server.ts:14`) has `.status`, not `.statusCode`, so it does **not** match and gets replaced with a generic HTML error page. The same happens to ordinary domain `Error`s thrown by `trial.functions.ts`/`gdpr.functions.ts`. Server-function callers (React Query / `useServerFn`) expecting a structured JSON error or a real HTTP status instead receive an opaque 500 + HTML body.
  - **Recommendation:** Also pass through thrown `Response` instances (check `error instanceof Response` or the presence of `.status`), and/or scope this middleware to page-render requests only, not server-function RPC calls.

### Medium
- **A-2. `.env.example` is out of sync with variables actually read by server code**
  - **File:** `.env.example` vs. `src/integrations/supabase/client.server.ts:33-34`, `src/integrations/supabase/auth-middleware.ts:36-37`, `src/routes/api/public/webhooks/paypal.ts:12,17-19`, `src/lib/n8n.server.ts:14`
  - **Root cause:** `.env.example` documents `VITE_SUPABASE_*` variables that no in-scope code reads (the client hardcodes URL/anon key in `src/integrations/supabase/client.ts:4-5` instead), while omitting server-only variables the app actually requires (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `PAYPAL_ENV`, `PAYPAL_WEBHOOK_ID`, `N8N_WEBHOOK_URL`). `RESEND_API_KEY` is listed but unused anywhere under `src/`.
  - **Recommendation:** Reconcile `.env.example` with actual `process.env.*` usage; a fresh deployment following the example file is currently missing required secrets.
- **A-3. `server.ts`'s "catastrophic SSR error" detection depends on parsing an internal framework error shape**
  - **File:** `src/server.ts`, lines 21–45
  - **Root cause:** `isH3SwallowedErrorBody` detects h3-swallowed errors by checking for `{"unhandled":true,"message":"HTTPError"}` — an internal implementation detail of the h3/Nitro version currently pinned. If that shape changes on a dependency bump, this silently stops working (falls through to returning the raw JSON error to the client instead of the friendly error page), with no test or type coupling to catch it.
  - **Recommendation:** Add a regression test pinned to the current h3/Nitro version, or find a more stable signal (e.g. a custom header) if the framework supports one.

### Low
- **A-4. `errorMiddleware` and `server.ts`'s fallback both render `renderErrorPage()` independently**
  - **File:** `src/start.ts:14-17`, `src/server.ts:31-35,53-58`
  - **Root cause:** Two separate layers implement near-identical "catch everything, log it, render a static error page" logic with slightly different detection heuristics. Not a functional bug, but duplicated error-handling logic that's easy to let drift out of sync (as it already has for the `statusCode` vs `.status` handling in A-1).
  - **Recommendation:** Consolidate into one shared error-rendering path if feasible.

---

## 2. Authentication

**Flow:** `src/context/AuthContext.tsx` wraps the app, calling `supabase.auth.getSession()` and subscribing to `onAuthStateChange` to populate `session`/`profile`/`loading`. `loadOrCreateProfile` selects (or lazily creates) a `profiles` row per authenticated user. `src/components/auth/ProtectedRoute.tsx` gates dashboard/admin routes on `loading`/`user` state client-side; `src/routes/auth.callback.tsx` handles the OAuth/magic-link redirect back into the app; `src/routes/onboarding.tsx` collects first-time profile data. Server-side, `src/integrations/supabase/auth-attacher.ts` + `auth-middleware.ts` attach the verified user to server-function context, and `src/lib/admin.server.ts`'s `assertAdmin()` re-verifies admin role from the `user_roles` table (not from `profiles.user_type`) on every privileged server call — this part is sound.

### Critical
- **AU-1. Any authenticated user can self-grant `premium`/`admin` status and a fake "Verified" badge**
  - **File:** `src/context/AuthContext.tsx`, lines 167–178 (`updateProfile`); root cause in `supabase/migrations/20260724110804_f95931a7-2e9e-417c-8a33-e9aedac500de.sql`, line 31 (full detail in **Database §DB-1**)
  - **Root cause:** `updateProfile(data: ProfileUpdate)` forwards the caller-supplied object *unfiltered* to `supabase.from("profiles").update(data).eq("id", session.user.id)`. `ProfileUpdate = Partial<ProfileRow>` includes every column, including `user_type` and `is_verified`. Because the RLS policy on `profiles` only checks row ownership and has no `WITH CHECK`/column restriction (§DB-1), a call like `updateProfile({ user_type: "premium", is_verified: true })` from the browser console succeeds. Confirmed real consumers: `src/components/dashboard/DashboardPage.tsx:239,244` gates premium UI on `profile.user_type === "premium"`, and `src/routes/u.$username.tsx:168` renders a public "verified" checkmark straight off `profile.is_verified`.
  - **Recommendation:** Restrict `ProfileUpdate` to a client-editable allowlist (name, bio, avatar, city, country, language, contact prefs) enforced both in the TS type and via a Postgres `WITH CHECK`/trigger that only `service_role` can alter `user_type`/`is_verified`/`is_active`.

### High
- **AU-2. Auth callback race: a slow `SIGNED_IN` handler can bounce a just-authenticated user to `/login`**
  - **File:** `src/routes/auth.callback.tsx`, lines 66–87
  - **Root cause:** The `onAuthStateChange` handler is `async` (awaits a `profiles` select) before redirecting to `/dashboard` or `/onboarding`. A parallel `setTimeout(..., 5000)` unconditionally redirects to `/login`. If `SIGNED_IN` fires near the 5s mark, the in-flight profile fetch may still be pending when the timeout fires first, sending a successfully authenticated user back to the login screen. `subscription.unsubscribe()` doesn't cancel the already-in-flight promise.
  - **Recommendation:** Track a `settled` flag (or `AbortController`) and clear the timeout as soon as `SIGNED_IN` handling begins, not only once it resolves.
- **AU-3. Onboarding form silently wipes user input when the language switcher is used**
  - **File:** `src/routes/onboarding.tsx`, lines 47–76 (effect deps at line 76 include `language`)
  - **Root cause:** The profile-initialization effect calls every `setXxx` (name, city, country, bio, avatar, etc.) from `profile`/`user` metadata and depends on `language` from `useLanguage()`. The page also renders `<LanguageSwitcher />`. Switching language at any point mid-onboarding re-runs the whole effect and **overwrites everything the user has already typed**, including step-2 fields and the uploaded avatar reference.
  - **Recommendation:** Remove `language` from the effect's dependency array; key initialization only on `user?.id`/mount.

### Medium
- **AU-4. StrictMode dev-mode remount permanently kills the auth-state listener**
  - **File:** `src/context/AuthContext.tsx`, lines 89–120
  - **Root cause:** `initialized.current` is set `true` on first effect run to dedupe subscriptions, but is never reset in the cleanup function. Under React 18 StrictMode's mount→cleanup→remount dev cycle: the cleanup unsubscribes, but the ref is still `true` on remount, so the guard skips resubscribing — the listener is silently dead for the rest of the dev session (sign-out/token-refresh events stop updating state until a hard reload).
  - **Recommendation:** Reset `initialized.current = false` in the effect's cleanup, or drop the guard entirely (subscribe/unsubscribe is idempotent).
- **AU-5. Duplicate/racing profile-load between `getSession()` and `onAuthStateChange`'s `INITIAL_SESSION` event**
  - **File:** `src/context/AuthContext.tsx`, lines 95–117
  - **Root cause:** Supabase v2 fires `INITIAL_SESSION` through `onAuthStateChange` immediately on subscribe, in addition to the explicit `getSession().then()` call just above. Both independently call `loadOrCreateProfile` and set state with no ordering guard, so whichever resolves last wins — a transient stale/incorrect session or profile can be shown if they resolve out of order. `loadOrCreateProfile` (SELECT + conditional UPDATE + SELECT) also runs twice on load and again on every `TOKEN_REFRESHED`.
  - **Recommendation:** Drive state from `onAuthStateChange` alone (it already fires `INITIAL_SESSION`), or use a generation counter/ref to discard out-of-order resolutions.
- **AU-6. `loadOrCreateProfile` never checks Supabase error results**
  - **File:** `src/context/AuthContext.tsx`, lines 28–83
  - **Root cause:** The initial SELECT (28–34), UPDATE (50–55), and INSERT (68–80) all destructure only `data`, never `error`. If the SELECT fails transiently, `existing` is `undefined` and the code falls into the INSERT branch for a user who already has a row — that insert fails on the primary key (also unchecked), and the function returns `null`. Downstream, `ProtectedRoute.tsx:21` and dashboard code then treat an existing, real user as having no/incomplete profile and can misroute them to onboarding.
  - **Recommendation:** Check `error` at each step; distinguish "no row found" from a genuine query failure before deciding to insert.

### Low
- **AU-7. `LanguageContext` syncs the profile's language only once per page load, not per signed-in user**
  - **File:** `src/context/LanguageContext.tsx`, lines 28, 40–49
  - **Root cause:** `syncedFromProfile` is a `useRef(false)` flipped `true` on the first profile load and never reset. On a shared session where user A logs out and user B logs in without a full page reload, user B's stored language preference is never applied.
  - **Recommendation:** Reset the ref (or key it off `user?.id`) whenever the signed-in user changes.
- **AU-8. `AuthContext` value object is unmemoized, causing excess re-renders across every consumer**
  - **File:** `src/context/AuthContext.tsx`, lines 122–179
  - **Root cause:** The context `value` (including all async method closures) is rebuilt inline on every `AuthProvider` render with no `useMemo`, so every component calling `useAuth()` re-renders whenever `AuthProvider` re-renders, regardless of whether `session`/`profile`/`loading` actually changed. This directly compounds **Performance §PE-2** (`payment.success.tsx`'s `refreshProfile` effect re-firing).
  - **Recommendation:** Wrap `value` in `useMemo` keyed on `session`, `profile`, `loading`; wrap methods in `useCallback`.

---

## 3. Dashboard

**Flow:** `src/components/dashboard/DashboardPage.tsx` is the main authenticated shell (sidebar + quick links + trial/notification widgets), with sub-pages under `src/routes/dashboard.*.tsx` (profile, settings, security, subscriptions, notifications, help). Supporting widgets: `NotificationBell.tsx` (badge + realtime toast), `TrialBanner.tsx`, `ShareAndInvite.tsx` (clipboard/native-share links), `TrialBanner`/trial activation logic embedded in `DashboardPage.tsx`.

### High
- **DA-1. Clipboard API used with no availability/error handling (5 call sites)**
  - **File:** `src/components/dashboard/ShareAndInvite.tsx`, lines 49–61 (`copyProfile`, `copyInvite`), 71 (`nativeShare` fallback), 87–90, 96–99 (Instagram/TikTok handlers)
  - **Root cause:** `navigator.clipboard.writeText(...)` is called unconditionally — no check that `navigator.clipboard` exists (undefined in non-secure/HTTP contexts, older WebViews, or when Permissions Policy denies `clipboard-write`) and no `try/catch` around the call. `copied`/`inviteCopied` UI state can flip to "copied" even when the write actually failed, since it isn't gated on the promise resolving.
  - **Recommendation:** Feature-detect `navigator.clipboard?.writeText`, wrap in try/catch, only set "copied" state on confirmed success, and show an error/fallback UI otherwise.

### Medium
- **DA-2. Notification bell's unread badge is capped at 5 and disconnected from the correct count**
  - **File:** `src/components/dashboard/NotificationBell.tsx`, lines 45 (`.limit(5)`), 51 (badge count derived from that capped list); dead correct query at `src/components/dashboard/DashboardPage.tsx:124-136`
  - **Root cause:** The bell derives its unread count from only the 5 most-recently-fetched notifications, so a user with e.g. 12 unread never sees more than 5 in the badge. A correct `count: "exact", head: true` query already exists in `DashboardPage.tsx` but is never referenced again after being declared (dead code — see **Components §CO-6** for why this went unnoticed) and isn't wired to `NotificationBell`.
  - **Recommendation:** Wire the exact-count query into the badge (as a prop or by having `NotificationBell` run its own head-count query); delete the dead query if unused elsewhere.
- **DA-3. "Settings" quick-link tile routes back to `/dashboard` instead of `/dashboard/settings`**
  - **File:** `src/components/dashboard/DashboardPage.tsx`, line 512 (Quick Links array, compare sidebar entry at line 569 which correctly uses `/dashboard/settings`)
  - **Root cause:** Apparent copy/paste from the "Home" entry above it in the same array.
  - **Recommendation:** Change the `to` value to `/dashboard/settings`.
- **DA-4. Sidebar highlights three unrelated nav items simultaneously**
  - **File:** `src/components/dashboard/DashboardPage.tsx`, `Sidebar` function, lines 564–573 (Home/Applications/Payments all set `to="/dashboard"`) combined with `activeProps`/`activeOptions={{ exact: true }}` at lines 588–593
  - **Root cause:** TanStack Router applies "active" styling to every `<Link>` whose `to` matches the current route; three sidebar entries share the same `to`, so all three appear active on the dashboard at once — looks like placeholder routes (`/dashboard/applications`, `/dashboard/payments`) that were never built out.
  - **Recommendation:** Give Applications/Payments their own routes, or stop applying `activeProps` to unbuilt placeholder links.
- **DA-5. `updateAppSetting` computes its payload from a stale closure over `appSettings`**
  - **File:** `src/routes/dashboard.settings.tsx`, lines 90–117
  - **Root cause:** The function optimistically updates state via `setAppSettings((prev) => prev.map(...))`, then immediately reads `appSettings.find(...)` from the *outer* closure — which still holds the pre-update value. Two quick successive toggles on the same app (e.g. "visible in directory" then "can be contacted") can cause the second write's fallback values to silently revert the first toggle in the database.
  - **Recommendation:** Derive the write payload from the functional updater's `prev` argument (or a ref), not from the outer closure variable.
- **DA-6. `payment.success.tsx` never stops polling and has no failure/timeout state** *(see also Performance §PE-1)*
  - **File:** `src/routes/payment.success.tsx`, lines 32–53
  - **Root cause:** A `useQuery` with `refetchInterval: 3000` is combined with a **second**, independent `setInterval` that bumps an `attempts` counter every 3s — and `attempts` is part of the query key, so each tick creates a *new* cache entry instead of refetching the same one (unbounded cache growth + doubled network traffic). Neither mechanism stops once `activated` becomes true, and there's no max-attempts/timeout branch: if the webhook never lands (failed/cancelled payment, processing error), the user is stuck on an infinite spinner with no retry link or support fallback.
  - **Recommendation:** Use `refetchInterval` alone (drop the manual counter/queryKey mutation), stop refetching once `activated` is true, and add a timeout branch with a "still processing / contact support" state.
- **DA-7. Payment success is confirmed by "any active subscription," not the specific transaction**
  - **File:** `src/routes/payment.success.tsx`, lines 19–22 (`app_id` optional in `validateSearch`), 36–46
  - **Root cause:** When `search.app_id` is absent, the success check becomes "does this user have *any* active subscription" rather than "did *this* checkout activate." A user with a pre-existing subscription for App A who lands on this page for an unrelated/failed App B checkout will see "success" despite nothing new being purchased.
  - **Recommendation:** Require `app_id` (and ideally a server-verified transaction/session id) to render success; correlate against the specific subscription/payment row created for that transaction.

### Low
- **DA-8. `activateTrial` failure permanently blocks retry for the browser session, error swallowed silently**
  - **File:** `src/components/dashboard/DashboardPage.tsx`, lines 93–107 (ref set at line 98 before the awaited result is known; `.catch(() => {})` at line 106)
  - **Root cause:** `triedTrialRef.current = true` is set synchronously before `activateTrial()` resolves/rejects. A transient failure (network blip) leaves the ref `true` for the component's lifetime, so an eligible user never gets the trial activated that session, with no error surfaced anywhere.
  - **Recommendation:** Only set the ref on success (or a definitive "not eligible" response); log/surface failures instead of swallowing them.
- **DA-9. Hardcoded, non-localized delete-confirmation phrase**
  - **File:** `src/routes/dashboard.settings.tsx`, lines 179, 349
  - **Root cause:** Account deletion requires typing the literal Bosnian word `"OBRIŠI"` regardless of active UI language, while everything else in the dialog is translated via `t()`.
  - **Recommendation:** Localize the required confirmation token per language, or clearly state that the literal word is required irrespective of language.
- **DA-10. `ShareAndInvite` builds profile/invite URLs without `encodeURIComponent`**
  - **File:** `src/components/dashboard/ShareAndInvite.tsx`, lines 41–45
  - **Root cause:** `username` is currently always machine-generated and URL-safe (see `src/lib/username.ts`), so this isn't exploitable today, but the component itself performs no defensive encoding when building `profileUrl`/`inviteUrl` — a future editable-username feature would silently reintroduce broken/unsafe URLs.
  - **Recommendation:** Wrap `username` in `encodeURIComponent(...)` regardless of upstream guarantees.
- **DA-11. `NotificationBell` tears down and re-subscribes its realtime channel on every language change**
  - **File:** `src/components/dashboard/NotificationBell.tsx`, lines 54–85 (effect deps `[user?.id, qc, lang]` at line 85)
  - **Root cause:** `lang` is only used inside the toast-formatting closure but is included in the effect's dependency array, so switching languages needlessly tears down and recreates the Supabase realtime subscription (small window where events could be missed) even though `user.id` hasn't changed.
  - **Recommendation:** Read `lang` via a ref instead of a dependency, so only `user?.id` drives resubscription.

---

## 4. Admin Panel

**Flow:** `src/routes/admin.tsx` (`AdminGate`) is the parent layout for all `/admin/*` child routes and blocks the `<Outlet/>` for non-admins — confirmed via `routeTree.gen.ts` that every admin page (`admin.applications`, `admin.communication`, `admin.payments`, `admin.users`, `admin.verification`) is a child of it. Every mutating server function in `src/lib/admin.functions.ts` independently calls `assertAdmin()` (`src/lib/admin.server.ts`) which checks the `user_roles` table server-side. **This layered gating is correctly implemented** — no IDOR/auth-bypass was found on admin routes.

### Medium
- **AD-1. Three divergent definitions of "active premium subscription" across `admin.functions.ts`**
  - **File:** `src/lib/admin.functions.ts`, lines 239–247 (`adminOverviewStats`, checks `status="active"` AND `expires_at > now()` AND `started_at <= now()`) vs. 303–307 (`adminSendNotification`, only `status="active"`) vs. 362–367 (`adminListVerificationRequests`, only `status="active"`)
  - **Root cause:** Only the stats function checks expiry. If a cron/webhook hasn't yet flipped a lapsed subscription's `status` to `"expired"`, the other two functions still treat it as active — broadcasting "premium-only" notifications to, and surfacing as verification candidates, users whose subscription has actually lapsed.
  - **Recommendation:** Extract one shared "is currently active premium" predicate and use it in all three places.
- **AD-2. `PlanForm` doesn't resync its local state after a save**
  - **File:** `src/routes/admin.applications.tsx`, lines 224–235 (state seeded once from `initial`, no resync effect — contrast `AppSettings` in the same file, lines 383–390, which does resync correctly)
  - **Root cause:** After a save triggers `qc.invalidateQueries(["admin-plans", activeAppId])` and a refetch, the same-keyed `PlanForm` instance keeps its stale local state instead of picking up the refetched value, so it can silently diverge from what's actually persisted (e.g. after a concurrent edit in another admin tab). The "new plan" form also never resets after a successful create.
  - **Recommendation:** Add a `useEffect` keyed on `initial.id`/`updated_at` to resync local state; reset the "new plan" form on successful create.
- **AD-3. Admin user search fires a full query on every keystroke**
  - **File:** `src/routes/admin.users.tsx`, lines 44, 50–53
  - **Root cause:** `search` state is included directly in the `useQuery` key (`["admin-users", search]`) with no debounce, so `adminListUsers` (an `ilike` scan) re-runs on every keystroke.
  - **Recommendation:** Debounce the search value (~300ms) before it feeds the query key.
- **AD-4. `payments.invoice_url` stores a raw Stripe object ID, not a browsable URL**
  - **File:** `src/routes/api/public/webhooks/stripe.ts`, line 142 (`invoice_url: session.invoice ? String(session.invoice) : null`); rendered at `src/routes/admin.payments.tsx`, lines 73–74 (`<a href={p.invoice_url}>Open</a>`)
  - **Root cause:** An un-expanded Stripe Checkout `Session.invoice` field is just the Invoice object's ID (e.g. `in_1Nx...`), not a URL. Stored verbatim under a column named `invoice_url`, it renders as a broken link in the admin payments list.
  - **Recommendation:** Expand the invoice (`expand: ["invoice"]`) and store `invoice.hosted_invoice_url`, or drop the field.

### Low
- **AD-5. Redundant duplicate admin-check calls on every admin sub-page**
  - **File:** `src/routes/admin.applications.tsx`, lines 38–42; `src/routes/admin.users.tsx`, lines 38–42
  - **Root cause:** Both pages independently call `getMyIsAdmin` and re-gate rendering, even though the parent `AdminGate` already verified admin status. Not a security issue (belt-and-suspenders), just an extra round trip and loading flash on every admin navigation.
  - **Recommendation:** Rely on the parent route's verified state (e.g. via route context) instead of re-fetching per child page.
- **AD-6. Debug `console.log` of user id/role on every admin check**
  - **File:** `src/lib/admin.functions.ts`, line 222
  - **Root cause:** `console.log("[getMyIsAdmin]", { userId, role })` runs on essentially every page load that checks admin UI visibility, producing per-request log noise in production.
  - **Recommendation:** Remove or gate behind a debug flag.
- **AD-7. `addMonthsIso` has a month-end rollover bug affecting every subscription's expiry date**
  - **File:** `src/lib/admin.server.ts`, lines 36–39
  - **Root cause:** Uses `Date.prototype.setMonth`, which overflows into the following month when the target month has fewer days than the current day-of-month (e.g. Jan 31 + 1 month → Mar 3, not Feb 28/29). Affects every subscription's `expires_at` computed in `stripe.ts:124`, `paypal.ts:150`, and `admin.functions.ts:93`.
  - **Recommendation:** Clamp the day-of-month after `setMonth`, or use a date library with explicit end-of-month handling.
- **AD-8. Pervasive `as never` casts on admin write payloads defeat compile-time schema checking**
  - **File:** `src/lib/admin.functions.ts`, e.g. lines 45, 105, 112, 133, 157, 327, 389, 414, 450
  - **Root cause:** Nearly every insert/update payload is cast `as never` to satisfy Supabase's currently-placeholder generated types (see `src/types/database.ts` header comment), so none of these write paths get real compile-time verification against the actual schema — a column rename/typo wouldn't be caught until runtime.
  - **Recommendation:** Once real generated table types are wired up, remove the `as never` casts.
- **AD-9. `planInputSchema.currency` accepts any string, not a constrained set**
  - **File:** `src/lib/admin.functions.ts`, line 28 (`currency: z.string().default("EUR")`)
  - **Root cause:** No enum/allowlist, permitting malformed currency codes into `subscription_plans.currency`.
  - **Recommendation:** Constrain to `z.enum([...])` of actually-supported currencies.

---

## 5. Database (Supabase / Postgres / RLS)

**Structure:** 17 sequential migrations (`supabase/migrations/*.sql`) build out `profiles`, `premium_profiles`, `subscriptions`, `subscription_plans`, `payments`, `notifications`, `user_roles`, `audit_logs`, and related tables/views, with Row-Level Security policies throughout. The final migration (`20260725070421_...sql`) correctly hardens several earlier over-permissive public-read policies by introducing masking views (`profiles_public`, `premium_profiles_public`) and a scoped `is_user_premium()` function — this later hardening pass is sound and was verified to fully supersede the earlier exposure (informational note below).

### Critical
- **DB-1. `profiles` UPDATE policy has no `WITH CHECK`, letting any user rewrite their own trust-sensitive columns**
  - **File:** `supabase/migrations/20260724110804_f95931a7-2e9e-417c-8a33-e9aedac500de.sql`, line 31: `CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);`
  - **Root cause:** Postgres RLS uses the `USING` clause as the implicit `WITH CHECK` for `UPDATE` when none is given. Since `id` can't change, the check always passes, and `GRANT UPDATE ON public.profiles TO authenticated` covers every column — including `user_type`, `is_verified`, `is_active`. No later migration adds a restrictive check or column-level grant. This is the database-level root cause of **Authentication §AU-1** (client-side exploit path) and feeds directly into the public "verified" badge shown at `src/routes/u.$username.tsx:168` and the `profiles_public` view (`20260725070421_...sql:92-98`), which republishes `user_type`/`is_verified` to anonymous visitors.
  - **Recommendation:** Add a `WITH CHECK`/`BEFORE UPDATE` trigger that reverts `user_type`/`is_verified`/`is_active` unless the caller is `service_role`, or move those columns to a separate table only `service_role` can write.

- **DB-2. `subscriptions.UNIQUE(user_id, app_id)` combined with insert-only webhook/trial logic breaks renewals and trial→paid conversion**
  - **File:** `supabase/migrations/20260724110804_f95931a7-2e9e-417c-8a33-e9aedac500de.sql`, line 140 (`UNIQUE(user_id, app_id)`); consumed via plain `.insert()` (never `upsert`) at `src/routes/api/public/webhooks/stripe.ts:113-131`, `src/routes/api/public/webhooks/paypal.ts:139-154`, `src/lib/trial.functions.ts:46-59`
  - **Root cause:** The constraint is unconditional on `(user_id, app_id)` regardless of `status`/expiry, and every code path that grants access does a plain `INSERT`. Consequences: **(a)** a user who activates the free trial occupies that unique slot; when they later actually pay, the webhook's `INSERT` violates the constraint, the error is caught but only surfaced as a `500`, and the customer is charged with **no subscription/payment/notification/audit-log/n8n event ever created**. **(b)** Any renewal or repeat purchase for an app the user has ever subscribed to (even one expired months ago) fails identically. **(c)** `trial.functions.ts` does one bulk multi-row insert across all active apps; if the user has so much as one leftover row for *any single app*, the whole atomic insert fails, blocking trial activation for apps they've never touched.
  - **Recommendation:** Replace `insert` with `upsert(..., { onConflict: "user_id,app_id" })` that extends/replaces the existing row, or drop the `(user_id, app_id)` uniqueness in favor of idempotency keyed on `stripe_payment_id`/`paypal_payment_id`, deriving "current" status from the latest row per app.

### Medium
- **DB-3. `UserType` TypeScript union doesn't include the DB's `super_admin` value**
  - **File:** `src/types/database.ts`, line 6 (`"standard" | "premium" | "admin"`) vs. `supabase/migrations/20260724110804_...sql`, line 19 (`CHECK (user_type IN ('standard','premium','admin','super_admin'))`)
  - **Root cause:** A row with `user_type = 'super_admin'` — a value the database explicitly allows — is unrepresented in the app's type system, so any `=== "admin"` comparison silently misses `super_admin` rows.
  - **Recommendation:** Add `"super_admin"` to the `UserType` union, or remove it from the DB constraint if it's not actually meant to be used.

### Low
- **DB-4. `is_user_premium()` is not scoped per app despite a per-app subscription/pricing model**
  - **File:** `supabase/migrations/20260725070421_432f3b63-9cdc-48d8-8393-c21afa2d58fd.sql`, lines 129–142; consumed at `src/routes/u.$username.tsx:63`
  - **Root cause:** The function returns `true` if the user has *any* active subscription to *any* app, even though `subscription_plans`/`subscriptions` are explicitly per-`app_id` with per-app pricing, and `premium_profiles` has no `app_id` at all (one global row per user). This means the cheapest available app's subscription unlocks the global "Premium" badge/contact-sharing on the shared bio-link page. May be intentional (a cross-app perk) but is undocumented and worth confirming.
  - **Recommendation:** If premium is meant to be per-app, scope the function/UI by `app_id`; otherwise document the cross-app-perk design decision.
- **DB-5. Stale `GRANT SELECT ... TO anon` left over from superseded early migrations**
  - **File:** `supabase/migrations/20260724110804_...sql:30` and `20260724114742_...sql` (original public-read policies on `profiles`/`premium_profiles`/`subscriptions`)
  - **Root cause:** These early, over-permissive read policies were correctly dropped/replaced by `20260725070421_...sql`'s masking views, and RLS now blocks all rows for `anon` on the base tables (confirmed: no live exposure). However, the original `GRANT SELECT ... TO anon` statements on the base tables are still technically in effect at the grant level, relying entirely on "no permissive policy remains" rather than the grant itself being revoked.
  - **Recommendation:** No urgent action — RLS currently blocks access — but revoke the now-redundant grants for defense-in-depth and schema clarity.

---

## 6. Routing

**Structure:** File-based routing under `src/routes/`, compiled into `src/routeTree.gen.ts` by `@tanstack/router-plugin`. Public routes (`index`, `login`, `pricing`, `u.$username*`), authenticated routes (`dashboard.*`, gated by `ProtectedRoute`), and admin routes (`admin.*`, gated by the `AdminGate` parent in `admin.tsx`, verified in **Admin Panel** above) are cleanly separated. Two server-only API routes exist under `src/routes/api/public/webhooks/`.

### Low
- **RT-1. Dead, duplicate public-profile route with misleading SEO metadata**
  - **File:** `src/routes/profile.$username.tsx` (entire file)
  - **Root cause:** Declares `head()` meta tags claiming a real per-user profile page (`@${username} — Core Platform`, description referencing the actual username), but the component body is a static "coming soon" placeholder that fetches no data. It duplicates the real implementation at `src/routes/u.$username.tsx` and isn't linked from anywhere in the app. Any crawler or stray link hitting `/profile/:username` gets misleading metadata for empty content.
  - **Recommendation:** Remove the route, or make it redirect to `/u/$username` the way `u.$username.share.tsx` redirects to `u.$username.tsx`.
- **RT-2. Empty error-boundary effect — likely missing telemetry**
  - **File:** `src/routes/__root.tsx`, lines 40–45
  - **Root cause:** `ErrorComponent`'s `useEffect(() => { }, [error])` re-runs on every new caught error but does nothing — very likely a stub for error reporting that was never filled in, so root-level render errors are never logged/reported anywhere.
  - **Recommendation:** Wire the effect to actual error telemetry, or remove the dead effect.

**Note (strength):** Admin route authorization is correctly layered — client-side `AdminGate` blocks the `<Outlet/>` and every admin server function independently re-verifies via `assertAdmin()`. No IDOR was found on `$username`/`$id`-parameterized routes; public profile pages correctly gate private contact fields behind both owner opt-in flags and viewer/owner state, and never render email addresses.

---

## 7. Components

**Structure:** Feature components under `src/components/{dashboard,profile}/`, generic UI primitives (shadcn/ui) under `src/components/ui/`, plus two hand-written UI components (`CountrySelect.tsx`, `LanguageSwitcher.tsx`) and `InstallPrompt.tsx` for PWA install prompts.

### High
- **CO-1. Stored XSS via `javascript:`/`data:` URI in profile website & social links**
  - **Files:** Input, unvalidated: `src/components/profile/SocialLinksSection.tsx:36-43` (`type="url"` input, no scheme validation), `src/components/profile/ToggleField.tsx:43`; save path, no server validation: `src/routes/dashboard.profile.tsx:171-192` (`handleSavePremium` sends `website`/`facebook_url`/etc. straight to `supabase.from("premium_profiles").update/insert()` after only `.trim()`); sink, unsanitized render: `src/routes/u.$username.tsx:217` (`<a href={premium.website}>`) and lines 297–304 (`SocialRow`, `<a href={url!}>`)
  - **Root cause:** HTML5 `type="url"` inputs accept `javascript:alert(1)` as a syntactically valid URL — it does not restrict scheme to http/https — and nothing else in the save path or the render path checks the scheme. Any user who reaches premium status (a normal paid feature, not a privileged one) can store a `javascript:` URI as their public website or social link; any visitor to their public profile (`/u/:username`, no login required) who clicks it executes attacker-controlled script in their own browser session.
  - **Recommendation:** Validate/normalize on save (require `http://`/`https://` via `new URL()` + protocol allowlist, reject `javascript:`/`data:`/`vbscript:`), and defensively re-check protocol at the render sink before using a stored value as an `href`.

### Medium
- **CO-2. `AvatarUpload` derives the storage-path extension from the unsanitized filename, not the validated MIME type**
  - **File:** `src/components/profile/AvatarUpload.tsx`, lines 30–31 (`const ext = file.name.split(".").pop() || "jpg";`)
  - **Root cause:** `file.type` is correctly checked against an allowlist earlier (line 24), but the extension used to build the storage key (`${userId}/avatar.${ext}`) comes straight from the user-controlled filename, independent of that validated MIME type. A crafted filename can inject unexpected characters/extensions into the storage key (blast radius limited by the `${userId}/` prefix, but still unvalidated input in a storage path).
  - **Recommendation:** Derive the extension from the validated `file.type` via a small map (`image/png → png`, etc.) instead of trusting `file.name`.
- **CO-3. `AvatarUpload` has no re-entrancy guard, and the file input isn't reset after use**
  - **File:** `src/components/profile/AvatarUpload.tsx`, lines 50–61 (avatar-image trigger button never `disabled` during upload — only the text button below it is), lines 73–82 (hidden `<input type="file">` never has `.value` cleared)
  - **Root cause:** A user can reopen the file picker and start a second upload while the first is still in flight (no cancellation, shared `uploading` state can desync from which upload actually finished last). Separately, since the input's `value` is never cleared, selecting the exact same file twice in a row (e.g. retrying after a failure) doesn't fire `onChange` at all.
  - **Recommendation:** Disable both trigger buttons while `uploading`; clear `e.target.value` after each selection is processed.
- **CO-4. PWA manifest icon entry claims a size that doesn't match the actual asset**
  - **File:** `public/manifest.webmanifest`, line 12 (`{"src": "/icon-512.png", "sizes": "192x192", ...}`)
  - **Root cause:** `public/` contains only `icon-512.png` — no dedicated 192×192 asset — yet the manifest declares the 512px file as `192x192`. Platforms that match `sizes` against actual image dimensions for home-screen/splash generation will mis-scale or reject this entry.
  - **Recommendation:** Generate a real 192×192 PNG for that entry, or remove the false `sizes` claim and keep only the accurate 512×512 entries.
- **CO-5. ESLint and TypeScript both disable unused-variable checking, hiding dead code**
  - **File:** `eslint.config.js`, line 36 (`"@typescript-eslint/no-unused-vars": "off"`); `tsconfig.json`, lines 19–20 (`noUnusedLocals`/`noUnusedParameters: false`)
  - **Root cause:** With both the linter rule and compiler flag off, dead code like the unused `notificationsQuery` in `DashboardPage.tsx` (**Dashboard §DA-2**) compiles and lints clean instead of surfacing as a warning — this is not theoretical, it directly hid that real bug.
  - **Recommendation:** Re-enable `noUnusedLocals`/`noUnusedParameters` (or at least the ESLint rule) and clean up the resulting warnings; use a `_`-prefix convention for intentionally-unused parameters.

### Low
- **CO-6. `ProfessionTagInput` duplicate detection is case-sensitive and doesn't cap tag length**
  - **File:** `src/components/profile/ProfessionTagInput.tsx`, line 17 (`value.includes(v)`)
  - **Root cause:** The trimmed value is compared with a strict, case-sensitive string match, so "Doctor" and "doctor" are treated as distinct tags and can both be added up to `max`; no per-tag length cap exists either.
  - **Recommendation:** Normalize (lowercase, collapse whitespace) before the duplicate check; cap individual tag length.
- **CO-7. `ShareAndInvite` builds URLs without `encodeURIComponent`** — see **Dashboard §DA-10** (same file, listed there in full).

---

## 8. Security (cross-cutting)

This section aggregates the highest-impact, trust-boundary-crossing issues found across the codebase — several are detailed fully in their owning section above and only summarized here with a pointer; the payment-webhook-specific findings are new to this section.

### Critical
- **SE-1. `.env` is tracked in git with no `.gitignore` entry — ✅ RESOLVED (2026-07-26)**
  - **File:** `.env` (repo root), `.gitignore` (repo root)
  - **Root cause:** `git ls-files` confirms `.env` is tracked, with 2 commits actively modifying it (most recently 2026-07-25). `.gitignore` has no `.env` entry at all — only `*.local`, `.dev.vars`, etc. — so nothing prevents it from being committed. The currently-committed values are Supabase's public "publishable"/anon key and project ref (not high-value secrets by themselves), but the tracked, un-ignored `.env.example` documents real server secrets that belong in `.env` (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PAYPAL_CLIENT_SECRET`, `RESEND_API_KEY`). The moment any of those is populated locally and committed — one `git add .`/`git commit -a` away — it becomes a permanent leak in git history.
  - **Recommendation:** Add `.env`/`.env*.local` to `.gitignore`, `git rm --cached .env`, rotate any credential that was ever committed (including the project ref referenced in earlier commit history), and keep only `.env.example` tracked.
  - **Resolution:** `.env`, `.env.local`, and `.env.*.local` added to `.gitignore`; `.env` removed from git tracking with `git rm --cached .env` (local file untouched, content byte-identical). Confirmed via full `git log -p -- .env` that only the public `SUPABASE_PROJECT_ID`/`SUPABASE_URL`/publishable key were ever committed across both historical revisions — no service-role key, Stripe/PayPal secret, or other high-value credential was ever exposed, so no rotation was necessary. `.env.example` remains the tracked template, unchanged. Residual risk: this repo's `.env` has historically been auto-written by Lovable Cloud's sync bot (`gpt-engineer-app[bot]`); if Lovable's next sync recommits the file, the `.gitignore` entry will need to be re-verified.

- **SE-2. Stripe amount/plan validation is entirely skipped when `plan_id` is omitted from the payment reference**
  - **File:** `src/routes/api/public/webhooks/stripe.ts`, lines 6–18 (`parseRef`), 54–77, 83–111 (amount/currency verification gated on `if (ref.plan_id)` / `if (planPrice !== null)`)
  - **Root cause:** `parseRef` returns `plan_id: null` if the `client_reference_id` string (built client-side in `src/routes/pricing.tsx:80-92` and appended to a public, static Stripe Payment Link) has fewer than 3 `__`-separated segments. The amount-match guard — whose own comment says it exists specifically to "prevent a user from paying via a cheap plan link while pointing `client_reference_id` at a longer/more expensive plan" — is entirely skipped when `plan_id` is absent, and `planMonths` silently defaults to `12`. Any user can therefore pay through the cheapest available plan's public link while manually editing the URL to submit a 2-segment reference (`userid__appid`, omitting `planid`), and receive 12 months of premium at the cheapest plan's price.
  - **Recommendation:** Require `plan_id` to be present and resolvable; reject (or fall back to validating against the minimum-duration/lowest-price plan) rather than defaulting to the most generous duration with no price check.

- **SE-3. `subscriptions` UNIQUE constraint breaks the payment fulfillment flow itself** — see **Database §DB-2**. Included here because the practical security/business consequence is that paying customers can be charged with no entitlement ever recorded, silently, with only a generic `500` in server logs.

### High
- **SE-4. Stripe webhook grants entitlement without checking `session.payment_status`**
  - **File:** `src/routes/api/public/webhooks/stripe.ts`, lines 41–45
  - **Root cause:** The handler only checks `event.type === "checkout.session.completed"` and never checks `session.payment_status === "paid"`. Per Stripe's documented behavior, `checkout.session.completed` fires even when `payment_status` is `"unpaid"` for delayed/asynchronous payment methods (bank debits, vouchers) — the correct funds-confirmed signal is `checkout.session.async_payment_succeeded`. As written, a session completing with unconfirmed payment still activates a subscription and flips `profiles.user_type` to `"premium"`.
  - **Recommendation:** Check `session.payment_status === "paid"` before fulfillment; also handle `checkout.session.async_payment_succeeded`/`async_payment_failed`.
- **SE-5. PayPal integration field-name mismatch: the client sends `custom`, the webhook reads `custom_id`**
  - **File:** `src/routes/pricing.tsx`, line 90 (`custom: `${user.id}_${activeAppId}_${plan.id}``) vs. `src/routes/api/public/webhooks/paypal.ts`, lines 71–77 (reads `resource.custom_id`)
  - **Root cause:** The frontend tags the outgoing PayPal link with a `custom` query parameter; the webhook handler reads `resource.custom_id` from the `PAYMENT.CAPTURE.COMPLETED` payload. Depending on the exact PayPal product behind the configured payment link, these may not be the same field, in which case `resource.custom_id` is always `undefined`, the handler's `ref.user_id`/`ref.app_id` are always `null`, and it silently no-ops for every real PayPal payment — money taken, nothing activated, no error surfaced anywhere.
  - **Recommendation:** Confirm the exact field PayPal echoes back for the configured product; make the query-param name and the webhook-read field match.
- **SE-6. Stored XSS via `javascript:` profile links** — see **Components §CO-1** (full detail there).

### Medium
- **SE-7. Client-built payment correlation IDs are unsigned and user-tamperable**
  - **File:** `src/routes/pricing.tsx`, lines 80–92 (`buildStripeUrl`/`buildPayPalUrl`)
  - **Root cause:** `client_reference_id`/`custom` are built entirely client-side as `${user.id}__${activeAppId}__${plan.id}` and appended as a plain query string to a static payment link. Nothing stops a user from copying the link and editing these values (different `plan.id`/`app_id`, or another user's `user_id`) before completing checkout. Whether this is exploitable beyond **SE-2** depends on whether the webhook cross-checks the actual amount paid against the referenced plan — which, per SE-2, it only does when `plan_id` is present.
  - **Recommendation:** Always verify amount/plan against the payment provider's authoritative transaction data server-side; never trust the reference string alone to determine what to grant.
- **SE-8. GDPR account deletion: unchecked delete errors and no storage cleanup**
  - **File:** `src/lib/gdpr.functions.ts`, lines 51–64
  - **Root cause:** The per-table delete loop (`for (const t of userIdTables) { await supabaseAdmin.from(t).delete()... }`) never inspects `{ error }`; a failed delete on any table is silently ignored and the flow proceeds to `auth.admin.deleteUser(userId)`, potentially leaving orphaned personal data after erasure is reported as successful (`{ ok: true }`). Avatar files in the `avatars` storage bucket under `<user_id>/...` are also never removed, leaving photos permanently in Storage with no owning row.
  - **Recommendation:** Check/aggregate errors from each delete and fail loudly rather than proceeding unconditionally; add a `storage.remove()` pass over the user's avatar objects.
- **SE-9. Webhook handlers don't check errors on `payments`/`profiles`/`notifications` writes, or on `writeAuditLog`'s own insert**
  - **File:** `src/routes/api/public/webhooks/stripe.ts:133,145-160`; `src/routes/api/public/webhooks/paypal.ts:156,167-182`; `src/lib/admin.server.ts:25-33` (`writeAuditLog`)
  - **Root cause:** Unlike the `subscriptions` insert (whose error *is* checked), every subsequent write in the same handler discards its `{ error }` result. A failure in any of them (unique-constraint collision, transient error) leaves an active subscription with no matching payment record, no user notification, and no audit trail — with zero logging or alerting.
  - **Recommendation:** Check and log/alert on the result of each write; consider wrapping the post-payment side-effect sequence to report which steps failed.

### Low
- **SE-10. Server-side error-capture buffer is a shared global across concurrent requests**
  - **File:** `src/lib/error-capture.ts`, lines 1–9, 65–81
  - **Root cause:** `lastCapturedError` is a module-level variable with a 5-second TTL meant to let `server.ts` recover the real error after h3 swallows it into a generic 500 (see **Architecture §A-1/A-3**). In a Node SSR server handling concurrent requests, this is a shared singleton — Request A's captured error can be consumed while rendering Request B's error page within the same 5s window, potentially leaking one user's stack trace/error details into another user's response.
  - **Recommendation:** Scope error capture per-request (e.g. `AsyncLocalStorage`) instead of a module-level global.
- **SE-11. Sensitive error data may be over-logged**
  - **File:** `src/lib/error-capture.ts`, lines 18–63
  - **Root cause:** `console.error` is globally monkey-patched to expand any `Error`-like argument into its full message, stack, and up to 5 levels of `.cause` chain before logging. Any error whose message/cause chain contains sensitive values (DB error text with parameters, partial auth-header content embedded in a thrown error) is now fully unredacted in the log pipeline everywhere `console.error(err)` is called.
  - **Recommendation:** Redact known-sensitive substrings/fields before logging, or gate full-cause-chain expansion behind a non-production flag.
- **SE-12. PayPal OAuth token fetched fresh on every webhook event, fails closed under rate limiting**
  - **File:** `src/routes/api/public/webhooks/paypal.ts`, lines 23–32
  - **Root cause:** `verifyPayPalSignature` requests a new OAuth token on every single delivery instead of caching it until near expiry. Under load this risks PayPal API rate limiting, which causes the signature check to fail closed (`return false` → "Invalid signature") — i.e. legitimate payments could be rejected purely due to throttling, not an actual signature problem.
  - **Recommendation:** Cache the OAuth token in memory for its reported `expires_in` duration.

---

## 9. Performance

### Medium
- **PE-1. `payment.success.tsx` polls with two overlapping mechanisms, creating unbounded query-cache growth** — see **Dashboard §DA-6** for full detail (same root cause: `attempts` counter both drives `refetchInterval` and mutates the React Query key).
- **PE-2. Admin user search issues a full server query per keystroke** — see **Admin Panel §AD-3** (no debounce on `["admin-users", search]`).

### Low
- **PE-3. Unmemoized `AuthContext` value causes broad, unnecessary re-renders app-wide** — see **Authentication §AU-8**. Directly compounds `payment.success.tsx`'s `refreshProfile`-dependent effect (`src/routes/payment.success.tsx:55-57`), which re-fires more often than intended because `refreshProfile`'s reference changes every render.
- **PE-4. `router.tsx` disables preload caching entirely**
  - **File:** `src/router.tsx`, line 12 (`defaultPreloadStaleTime: 0`)
  - **Root cause:** With a preload stale time of `0`, every route preload (e.g. on link hover) is treated as immediately stale and refetched again on actual navigation, defeating the purpose of preloading for any route relying on default caching behavior.
  - **Recommendation:** Set a small positive `defaultPreloadStaleTime` (e.g. a few seconds) unless every route has a specific reason to always refetch on navigation.
- **PE-5. Dead `notificationsQuery` fires an unnecessary Supabase query on every dashboard load** — see **Dashboard §DA-2** / **Components §CO-5** (declared, never consumed, hidden by disabled unused-variable checks).
- **PE-6. `NotificationBell` unnecessarily resubscribes its realtime channel on language change** — see **Dashboard §DA-11**.
- **PE-7. PayPal OAuth token not cached, adds a network round trip to every webhook delivery** — see **Security §SE-12**.

---

## Strengths worth preserving

- **Admin authorization is correctly layered**: client-side `AdminGate` (`admin.tsx`) plus independent server-side `assertAdmin()` on every mutating admin server function — not a client-only check.
- **Public profile pages correctly gate private contact info** behind both the owner's `*_public` flags and viewer/owner state, and never render email addresses to anonymous visitors.
- **The final migration's RLS hardening pass** (`20260725070421_...sql`) correctly replaced earlier over-permissive public-read policies with masking views and a scoped premium-check function — a good pattern to follow for any future public-data exposure.
- **No open-redirect vectors** were found in `login.tsx`/`auth.callback.tsx`/`index.tsx` — post-auth destinations are hardcoded, never derived from a query parameter.
- **Webhook signature verification itself** (Stripe's `constructEventAsync`, PayPal's OAuth-based verification call) is implemented, not skipped — the issues found are in what happens *after* a validly-signed event is accepted (SE-2, SE-4, SE-5), not in the verification step itself.
