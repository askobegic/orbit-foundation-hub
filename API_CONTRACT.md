# CORE API Contract — `/v1`

**Status:** Frozen design specification, all open questions resolved (Priority 8.9 — see §22). **Implementation status note (added Priority 15 Phase A, verified against the actual codebase, not assumed):** this document's earlier status line claimed no `/v1` endpoint existed; that is no longer accurate — `src/routes/v1/**` contains 85+ implemented route files spanning nearly every section below (authentication, profiles, applications, capabilities, dashboard, premium, promotional trial, billing/products, rewards including the Universal Event Engine's `POST /v1/events`, advertising, share & invite, messaging, notifications, media, and admin). This document has **not** yet had a full section-by-section reconciliation pass against that implementation to confirm every endpoint matches this contract exactly — that is a distinct, dedicated undertaking (comparable in scope to the 8.6 Final CORE Architecture Audit) and is intentionally not done as part of this note. Treat each section below as the target design, verified against real code only where a section explicitly says so. This document is the complete, versioned public REST contract between CORE and every application built on top of it (BosniaFans, Svadba, Ticketaria, Muzika.ba, Gradovi.ba, Bosanci.info, and every future application) — the permanent reference the implementation phase (`CLAUDE.md` → Priority 8.11) builds against, and the thing every future application integrates with instead of touching CORE's database directly.

**Two exceptions, by explicit instruction:**
- **Priority 8.9:** the database schema, admin UI, and server functions backing §7's Application Visibility (`applications.visibility`/`launchDate`/`defaultLanguage`) were implemented ahead of the API itself.
- **Priority 8.10 (Unified Products & Purchases Architecture Review, plus a follow-up refinement):** `subscription_plans.productType` and the unified `/dashboard/purchases` Dashboard page were likewise implemented ahead of the API — see §12.

Neither introduces a `/v1` endpoint — both are the same internal TanStack Start server functions/admin pages every other module in this document already had before its own `/v1` design (Capabilities, Dashboard Widgets, Rewards, etc.). The relevant sections below describe the future `/v1` surface over that same, now-real, underlying data.

For business rules and why things work this way, see `PROJECT_KNOWLEDGE.md` (architecture is not repeated here — every section below links back to the section that owns the rule). For known defects, see `PROJECT_AUDIT.md`. For how to work in this repo, see `CLAUDE.md`.

This document does not replace or modify anything about how the application currently works. Today's TanStack Start server functions (`createServerFn`, called with a raw Supabase session JWT via `requireSupabaseAuth`) continue to run exactly as they do today, for the current single-deployment app. `/v1` is a new, additive, external-facing surface — see **Relationship to the current implementation** below for exactly how the two coexist.

---

## Table of contents

1. [Design principles](#1-design-principles)
2. [Relationship to the current implementation](#2-relationship-to-the-current-implementation)
3. [Authentication & application identity](#3-authentication--application-identity)
4. [Cross-cutting conventions](#4-cross-cutting-conventions)
5. [Authentication endpoints](#5-authentication-endpoints)
6. [Profiles](#6-profiles)
7. [Applications](#7-applications)
8. [Capabilities](#8-capabilities)
9. [Dashboard](#9-dashboard)
10. [Premium](#10-premium)
11. [Promotional Trial](#11-promotional-trial)
12. [Billing, Products & Purchases](#12-billing-products--purchases)
13. [Rewards & Loyalty](#13-rewards--loyalty)
14. [Advertising](#14-advertising)
15. [Share & Invite](#15-share--invite)
16. [Messaging](#16-messaging)
17. [Notifications](#17-notifications)
18. [Media uploads](#18-media-uploads)
19. [Admin — cross-cutting](#19-admin--cross-cutting)
20. [Out of scope for v1](#20-out-of-scope-for-v1)
21. [Forward versioning notes](#21-forward-versioning-notes)
22. [API readiness review](#22-api-readiness-review)

---

## 1. Design principles

These rules apply to every endpoint in this document without exception. An endpoint that can't be made to follow one of these is a design defect to fix here, not an exception to grant.

1. **The API never exposes internal database structure.** No response ever contains a raw table row, a Postgres column name that doesn't already read as a public field name (`created_at` is fine; `stripe_payment_intent_id` is not), or a foreign-key id the caller has no way to have discovered legitimately. Every response is an explicitly shaped model owned by this contract, not `SELECT *`.
2. **The API never exposes Supabase-specific concepts.** No endpoint response contains a Supabase JWT, a Supabase error shape (`PGRST...` codes), a storage bucket name, an RLS policy name, or a Postgres error message. Supabase is CORE's current backing implementation, not part of the contract.
3. **The API is application-agnostic.** No endpoint branches on which application is calling by name or slug. Every application-specific behavior is expressed through **Capabilities** (§8) or **Applications** registry data (§7) — never an `if (appSlug === "bosniafans")` anywhere in the implementation. This mirrors the existing rule in `PROJECT_KNOWLEDGE.md` → Capabilities and is now a contractual guarantee for external callers, not just an internal code-review rule.
4. **Everything configurable stays configurable through the API.** Every admin-editable value described in `PROJECT_KNOWLEDGE.md` (capabilities, dashboard widgets, reward rules, ad pricing, trial policy, share/invite templates) has a corresponding admin endpoint here — none of it is a value an application is expected to hardcode locally.
5. **Premium is resolved once, consistently, everywhere.** Every endpoint that needs to know "is this user Premium" calls the same resolver internally (`hasAnyActivePremium` for a single user, `resolvePremiumStatusBulk` for many — `PROJECT_KNOWLEDGE.md` → CORE Premium Service, `PROJECT_AUDIT.md` → `A-5`). No endpoint in this contract re-derives Premium from `subscriptions` on its own.
6. **Promotional Trial is never a separate business rule.** Every endpoint that exposes or reasons about entitlement uses the same Premium resolver above, which already ORs Trial into it (`PROJECT_KNOWLEDGE.md` → Promotional Trial). No endpoint here has a parallel "or is this user in a trial" check.
7. **Advertising has one payment system.** Campaign checkout in this contract reuses the exact same billing primitives as Product checkout (§12) — there is no second checkout flow.
8. **Messaging respects the `messaging` capability everywhere it appears** — creating a conversation, listing the inbox is unaffected (existing conversations always remain readable, per `PROJECT_KNOWLEDGE.md` → Text Messaging), but every entry point that could start a *new* conversation checks it, matching the existing "checked once, at creation" rule.
9. **One consistent shape for response envelopes, pagination, filtering, sorting, errors, and validation** — see §4. An endpoint never invents its own variant of any of these.

---

## 2. Relationship to the current implementation

Nothing about the existing app changes as a result of this document.

| | Today (unchanged) | `/v1` (this document, not yet built) |
|---|---|---|
| Caller | The app's own React frontend, same deployment | Any application's own backend, a separate deployment |
| Transport | TanStack Start `createServerFn` RPC calls | Plain HTTPS REST/JSON |
| User identity | Raw Supabase session JWT, verified by `requireSupabaseAuth` against Supabase directly | One unified CORE-minted JWT (§3), verified against CORE's own published JWKS — never a raw Supabase token, and never a second, separate token type for the calling application |
| Application identity | Implicit — there's only one deployment; the Application Resolver (`PROJECT_KNOWLEDGE.md` → Authentication) infers it from the request's `Host` header | Carried as a claim inside the same unified JWT once a user is signed in (§3); an explicit `appId` is passed by hand only where no JWT exists yet (session creation, or a handful of genuinely anonymous public-browsing endpoints, §3.3) |
| Backing store | Supabase Postgres, read directly via RLS-scoped Supabase clients | The same Supabase Postgres, but never touched directly by a caller — every read/write goes through a `/v1` handler that enforces the same rules RLS enforces today |

Google Sign-In itself is unchanged (`signInWithIdToken()` only, per `PROJECT_KNOWLEDGE.md` → Authentication) — `/v1`'s session endpoint (§5) is a new *wrapper* around that existing flow, not a replacement for it. A user's identity is still exactly one `auth.users` row / one `profiles` row, decided the same way it is today.

---

## 3. Authentication & application identity

**Decided, Priority 8.9:** one unified CORE-issued JWT, sent as `Authorization: Bearer <token>`, for both the user's identity and the calling application's identity together. **There is no separate application-specific token or credential anywhere in this contract** — the App Token concept proposed in the original 8.8 draft of this document is withdrawn and replaced by what's below.

### 3.1 The unified JWT

- Obtained via `POST /v1/auth/session` (§5), after the calling application has already completed Google Sign-In in its own frontend (via CORE's shared Google Sign-In component/redirect, exactly as today) and holds a Google ID token.
- A short-lived (**15 minutes**), RS256-signed JWT minted by CORE. Claims: `sub` (the CORE `profiles.id`, stable and shared across every application), `azp` ("authorized party" — the id of the application this token was issued for, established once at session creation, never re-derived or client-editable afterward), `iat`, `exp`, `jti`. **No name, email, role, or Premium status is embedded as a claim** — every one of those is looked up fresh, server-side, on the request that needs it (matching the existing Permissions rule in `PROJECT_KNOWLEDGE.md`: "never inferred from client-supplied state and never trusted from a cached client value" — a JWT claim is exactly that kind of cached value, and Premium/role status can change mid-session).
- Verified by any relying party (CORE's own `/v1` handlers, or in principle an application's own backend) against `GET /v1/.well-known/jwks.json` — a public, unauthenticated, cacheable JWKS document. This is what makes the JWT useful to an application running its own separate backend/deployment: it can verify a user's identity (and, via `azp`, that the token really was issued for *it*) without calling back to CORE for every request.
- Refreshed via `POST /v1/auth/refresh` using a long-lived, opaque, single-use, rotating refresh token (never a JWT itself) returned alongside the access token. Refresh tokens are stored hashed, server-side, and can be individually revoked (`POST /v1/auth/logout`). The refreshed access token carries the same `azp` as the one it replaces — a refresh can never move a session to a different application.
- Sent as `Authorization: Bearer <access_token>` — the only header this contract uses for authentication, for every caller, user and application alike.

### 3.2 "Current application" without a JWT

A JWT only exists once a user has signed in. Two situations still need to know which application is asking before that's possible:

- **`POST /v1/auth/session` itself** — the request body names the application directly (`appId`, §5), since this call is what establishes the `azp` claim in the first place. There's nothing else for it to come from.
- **Genuinely anonymous, public browsing endpoints** (viewing a public profile while logged out, browsing ad placements, reading a Share & Invite config) — these accept an explicit `?appId=` query parameter instead. This is a deliberate, narrow trade-off: without a distinct application credential, there is no cryptographic way to *prove* which application is asking, so this contract doesn't pretend to — an application's id is already public information anyway (`GET /v1/applications` lists every one of them), and every value gated behind it here is itself public, non-sensitive configuration (branding, which capabilities are on, ad creatives, share copy). **Nothing privileged or user-owned is ever decided this way** — see §3.3.

### 3.3 The security boundary: what `azp` protects vs. what an explicit `appId` doesn't

For **any authenticated, user-context action** where "which application" affects a real permission or eligibility decision — creating a conversation (§16), buying a Product or an ad placement (§12/§14), reading/writing per-application `is_visible`/`is_contactable` from the *calling* application's own perspective — the application is **always** the signed-in caller's own JWT `azp` claim, **never** a client-supplied parameter. This is unspoofable (it's inside a signed token) and is the actual replacement for what the withdrawn App Token used to guarantee.

For **anonymous, public, non-sensitive** reads (§3.2's second bullet), an explicit `?appId=` is accepted because there is no signed-in caller to carry an `azp` at all, and the data behind it is already public. Each endpoint in §6–§18 states explicitly which rule it follows — there is no ambiguity per-endpoint, only the one global rule stated here.

Admin endpoints (§19) require `Authorization` (a User JWT whose holder currently has the `admin` role, re-verified server-side on every call — never cached, matching `PROJECT_KNOWLEDGE.md` → Permissions) and ignore `azp` entirely, since the admin panel is a Core-only surface, not scoped to any one application (`PROJECT_KNOWLEDGE.md` → Admin) — an admin operates across every application by explicit, path/body-supplied `appId`, the same as they already do in today's admin panel.

---

## 4. Cross-cutting conventions

### 4.1 Response envelope

Every successful response, regardless of endpoint, is one of exactly two shapes:

```json
{ "data": { /* single resource */ } }
```

```json
{
  "data": [ /* array of resources */ ],
  "meta": { "nextCursor": "eyJpZCI6IjEyMyJ9", "hasMore": true }
}
```

`meta` is present only on list endpoints, and only ever carries pagination info (§4.2) — never business data. A single-resource response never has a `meta` key.

### 4.2 Pagination — cursor-based, uniformly

Every list endpoint in this contract is paginated the same way:

- Request: `?limit=20&cursor=<opaque-string>` — `limit` defaults to 20, max 100. `cursor` is omitted on the first page.
- Response: `meta.nextCursor` (a new opaque string, or `null` if there are no more results) and `meta.hasMore` (boolean).
- The cursor is an **opaque, server-generated token** (never a raw offset or a raw id the caller could construct or reason about) — this is deliberately a change from some of today's internal admin list functions (which use plain `page`/`pageSize` offset pagination, e.g. `adminListUsers`). Offset pagination is not carried into this external contract: it degrades under concurrent inserts and invites clients to depend on positional semantics the API doesn't want to guarantee long-term. See §22 for the one place this is flagged for explicit confirmation.

### 4.3 Filtering

Every filterable endpoint accepts filters as flat, documented query-string keys (`?status=active&search=jasmin`) — never a nested `filter[x]=y` scheme, never a free-form query language. An unrecognized query key is silently ignored, not rejected — this keeps the contract forward-compatible (a client sending a filter a newer server version understands, against an older server, degrades to "unfiltered" rather than erroring). Each endpoint below documents its own exact filter keys; there is no global filter vocabulary beyond that.

### 4.4 Sorting

Every sortable endpoint accepts one `?sort=` query parameter. A field name sorts ascending; a leading `-` sorts descending (`?sort=-createdAt`). Only one sort key at a time — multi-key sort is not offered in v1 (see §21). An endpoint's default sort (used when `sort` is omitted) is documented per endpoint.

### 4.5 Error format

Every error response, regardless of endpoint or status code, has exactly this shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "city must not be empty",
    "details": [
      { "field": "city", "issue": "too_small" }
    ]
  }
}
```

`details` is present only for `VALIDATION_ERROR`; every other error code omits it. The fixed vocabulary of `code` values and their HTTP status:

| `code` | HTTP status | Meaning |
|---|---|---|
| `UNAUTHORIZED` | 401 | Missing/expired/invalid `Authorization` |
| `FORBIDDEN` | 403 | Authenticated, but not permitted (not admin, not a conversation participant, etc.) |
| `NOT_FOUND` | 404 | Resource doesn't exist, or exists but the caller has no right to know that (see §4.6) |
| `VALIDATION_ERROR` | 422 | Request body/query failed schema validation (including an `appId` that doesn't resolve to a registered, visible application, §3.2) |
| `CONFLICT` | 409 | State conflict (e.g. granting a Trial to a user who already has an active one) |
| `CAPABILITY_DISABLED` | 403 | The action requires a capability that's disabled for the calling application |
| `RATE_LIMITED` | 429 | Too many requests (see §21 — not enforced everywhere yet) |
| `INTERNAL_ERROR` | 500 | Unexpected server failure — message is always a generic string, never a raw exception/stack |

### 4.6 `NOT_FOUND` vs `FORBIDDEN` — deliberate, uniform choice

Where revealing *that* a resource exists would itself leak information (e.g. someone else's private conversation, a redemption that isn't the caller's), the API returns `NOT_FOUND`, not `FORBIDDEN` — this matches the existing internal convention (`conversation.functions.ts` already does exactly this: "Conversation not found" rather than "not your conversation"). Where the resource's existence is already public knowledge (e.g. an admin-only endpoint hit by a signed-in non-admin), `FORBIDDEN` is used instead, since there's nothing left to protect by hiding it.

### 4.7 Validation strategy

Every request body and query string is validated against a versioned schema before any business logic runs (mirroring today's internal `zod`-validated `inputValidator` pattern, one-for-one). Validation is always fail-closed and always server-side — a client-side check is a UX nicety only and is never trusted, matching `PROJECT_KNOWLEDGE.md` → Permissions ("never inferred from client-supplied state"). A request that fails validation never reaches business logic, never partially applies, and always returns the full set of field errors in one response (not one-at-a-time).

### 4.8 Casing, dates, money

- Every JSON key in every request/response body is `camelCase` — never a raw `snake_case` database column name (see Design Principle 1).
- Every timestamp is ISO 8601 UTC (`2026-08-03T14:00:00.000Z`).
- Every monetary amount is a decimal number in the resource's stated `currency` (ISO 4217, e.g. `"EUR"`) — never a minor-unit integer (cents), matching how `subscriptions.amount_paid`/`payments.amount`/`ad_placement_prices.price` are already stored today.

### 4.9 Localization — one resolution order, applied everywhere

**Decided, Priority 8.9.** Every endpoint in this contract that returns human-language text resolved from more than one stored locale (plan `features`, notification `title`/`message`, anything else shaped like today's `_bs`/`_en`/`_de` column triplets) resolves it, server-side, in exactly this order — the first step that produces a value wins, no endpoint invents its own variant:

1. **The request's `Accept-Language` header**, standard HTTP content negotiation — the first language in the caller's list that CORE actually has content for.
2. **The signed-in user's own `profiles.language`** (only reachable when `Authorization` is present — anonymous requests skip straight to step 3).
3. **The calling application's `defaultLanguage`** (§7 — nullable; an application with none configured contributes nothing at this step). Resolved from the request's `azp` claim when authenticated, or its explicit `?appId=` when anonymous, following the same rule as everywhere else in §3.
4. **English**, unconditionally, as the final fallback — always resolves to something, never a `null`/empty string.

This is resolved once per request, server-side, and the response always contains a single, already-resolved string per field (`"title": "New message"`) — never the raw `_bs`/`_en`/`_de` triplet (see Design Principle 1: that triplet is internal storage shape, not a contract concept). A calling application that wants a specific language regardless of the signed-in user's stored preference sends its own `Accept-Language` — that's what step 1 is for, and it deliberately outranks the stored profile preference so a caller is never stuck fighting a user's saved setting for a single request.

---

## 5. Authentication endpoints

### `POST /v1/auth/session`
Exchanges a Google ID token (obtained by the calling application's own frontend via CORE's shared Google Sign-In flow) for a CORE session. Internally, this is the exact same `signInWithIdToken()` verification Supabase already performs today — this endpoint does not introduce a second identity-verification path, only wraps the result in a CORE-minted token pair. The `appId` supplied here becomes the resulting access token's `azp` claim (§3.1) for the lifetime of this session — there is no later call that changes it.

- **Auth:** none (this *is* the login endpoint).
- **Capability:** none.
- **Request body:**
  ```json
  { "googleIdToken": "eyJhbGciOi...", "appId": "a1..." }
  ```
- **Response 200:**
  ```json
  {
    "data": {
      "accessToken": "eyJhbGciOi...",
      "refreshToken": "b3JiaXQtcmVmcmVzaC10b2tlbi1vcGFxdWU",
      "expiresIn": 900,
      "user": { "id": "5b2f...", "isNewUser": false }
    }
  }
  ```
  `isNewUser` tells the calling application whether to route to onboarding — mirrors the existing `profile.profile_complete` check in `onboarding.tsx`/`ProtectedRoute.tsx`.
- **Errors:** `VALIDATION_ERROR` (malformed/expired Google ID token, or `appId` doesn't resolve to a registered, non-archived application), `INTERNAL_ERROR`.
- **Permissions:** none beyond naming a valid application.

### `POST /v1/auth/refresh`
- **Auth:** none (the refresh token itself is the credential).
- **Request body:** `{ "refreshToken": "..." }`
- **Response 200:** same shape as `/v1/auth/session`'s `data` (a new access token **and** a new, rotated refresh token — the old refresh token is invalidated the moment it's used, single-use only). The new access token carries the same `azp` the original session was issued for (§3.1) — a refresh can never move a session to a different application.
- **Errors:** `UNAUTHORIZED` (refresh token invalid, expired, or already used).

### `POST /v1/auth/logout`
Revokes the caller's current refresh token (and, optionally, every refresh token for this user — see request body).
- **Auth:** user (`Authorization`).
- **Request body:** `{ "everywhere": false }` — `true` revokes every session for this user, not just the current one.
- **Response 200:** `{ "data": { "ok": true } }`

### `GET /v1/.well-known/jwks.json`
Public JWKS document for verifying CORE-minted access tokens.
- **Auth:** none — must be fetchable by any relying party before it has established anything else.
- **Response 200:** standard JWKS (`{ "keys": [...] }`), cacheable per its own `Cache-Control` header.

---

## 6. Profiles

Business rules: `PROJECT_KNOWLEDGE.md` → Profiles, Identity Lock, Premium Model → Public Profile Visibility. Schema reference: `ProfileRow`/`ProfileUpdate` (`src/types/database.ts`), `PremiumProfileRow`.

### `GET /v1/me`
- **Auth:** user. **Capability:** none.
- **Response 200:**
  ```json
  {
    "data": {
      "id": "5b2f...",
      "email": "jasmin@example.com",
      "firstName": "Jasmin",
      "lastName": "Hodžić",
      "avatarUrl": "https://.../avatars/5b2f.../avatar.jpg",
      "username": "jasminh",
      "city": "Sarajevo",
      "country": "BA",
      "bio": "...",
      "language": "bs",
      "isVerified": false,
      "isActive": true,
      "profileComplete": true,
      "identityLocked": true,
      "notifyEmail": true,
      "notifyInApp": true,
      "notifyMarketing": false,
      "createdAt": "2026-01-04T10:00:00.000Z"
    }
  }
  ```
  `identityLocked` is a derived boolean (`identity_locked_at IS NOT NULL`), never the raw timestamp — the caller only ever needs to know whether name/photo are locked, not when. **Deliberately absent:** `userType`/role fields (see Design Principle 1 — internal-only concept), raw Supabase ids.
- **Errors:** `UNAUTHORIZED`.

### `PATCH /v1/me`
Edits the caller's own profile. **Identity Lock is enforced server-side** — `firstName`/`lastName`/`avatarUrl` are accepted in the request schema only until `identityLocked` becomes true, after which any attempt to change them is rejected with `VALIDATION_ERROR`, never silently ignored. `email` is never accepted here at all (§6 note below) — it isn't a client-editable field, full stop.
- **Auth:** user. **Capability:** none.
- **Request body** (all optional, only provided fields change):
  ```json
  { "city": "Mostar", "country": "BA", "bio": "Updated bio", "username": "newhandle", "language": "en", "notifyEmail": false }
  ```
- **Response 200:** the full updated resource, same shape as `GET /v1/me`.
- **Errors:** `VALIDATION_ERROR` (including "identity is locked" as a field-level issue on `firstName`/`lastName`/`avatarUrl`, and "email is not editable" if `email` is present in the body at all), `UNAUTHORIZED`.

**Why no `email` field here:** `profiles.email` always resyncs from the authenticated identity itself, never from a client-supplied value (`PROJECT_KNOWLEDGE.md` → Identity Lock, `PROJECT_AUDIT.md` → `AU-9`). It is returned by `GET /v1/me` for display, but there is no endpoint, anywhere in this contract including Admin (§19), that accepts a client-supplied `email`.

### `GET /v1/me/premium-profile`
The extended contact-details/social-links record (`premium_profiles`) — editable regardless of Premium status (`PROJECT_KNOWLEDGE.md`: "Profile editing is never Premium-gated").
- **Auth:** user. **Capability:** none.
- **Response 200:**
  ```json
  {
    "data": {
      "phone": "+387...", "phonePublic": true,
      "whatsapp": "+387...", "whatsappPublic": true,
      "contactEmail": "contact@...", "contactEmailPublic": false,
      "website": "https://...", "websitePublic": true,
      "primaryProfession": "Photographer",
      "secondaryProfessions": ["Videographer"],
      "facebookUrl": null, "instagramUrl": "https://instagram.com/...",
      "tiktokUrl": null, "youtubeUrl": null, "linkedinUrl": null, "xUrl": null
    }
  }
  ```

### `PATCH /v1/me/premium-profile`
- **Auth:** user. **Capability:** none.
- **Request body:** any subset of the fields above.
- **Validation:** `website` and every `*Url` field are scheme-validated server-side (`http`/`https` only — rejects `javascript:`/`data:`/`vbscript:`, matching `PROJECT_AUDIT.md` → `CO-1`) before being persisted, regardless of what the calling application already checked client-side.
- **Response 200:** the full updated resource.
- **Errors:** `VALIDATION_ERROR` (including unsafe URL scheme).

### `GET /v1/me/app-settings`
Per-application `is_visible`/`is_contactable` — one row per application the user has ever had a setting for (missing rows default to visible/contactable, matching today's behavior).
- **Auth:** user. **Capability:** none.
- **Response 200:**
  ```json
  { "data": [ { "appId": "a1...", "appName": "BosniaFans", "isVisible": true, "isContactable": true } ] }
  ```

### `PATCH /v1/me/app-settings/{appId}`
- **Auth:** user. **Capability:** none. `appId` here is a path parameter naming *another* application's settings the user controls about themselves — this is legitimately client-supplied (it isn't "which application is calling," it's "which application's visibility am I toggling"), same as today's `dashboard.settings.tsx`.
- **Request body:** `{ "isVisible": true, "isContactable": false }` (either or both).
- **Response 200:** the updated row (shape as in the list above).

### `GET /v1/profiles/{username}`
The public profile bundle — the `/v1` equivalent of what `u.$username.tsx` assembles today (profile + premium fields + visible-applications list), scoped to "the calling application" for `is_visible`/`is_contactable`/`canContact` purposes: the caller's own JWT `azp` when `Authorization` is present, otherwise an explicit `?appId=` query parameter (§3.2/§3.3 — this is exactly the anonymous-browsing case that rule exists for).
- **Auth:** optional (`Authorization` may be present to resolve `canContact` against a signed-in viewer; absent for anonymous browsing — viewing a public profile is never gated, per `PROJECT_KNOWLEDGE.md` → Public Profile Visibility — but `?appId=` becomes required in that case). **Capability:** none.
- **Response 200 (Standard owner):**
  ```json
  {
    "data": {
      "username": "jasminh", "tier": "standard",
      "firstName": "Jasmin", "lastName": "Hodžić",
      "avatarUrl": "https://...", "city": "Sarajevo", "country": "BA",
      "memberSince": "2026-01-04T10:00:00.000Z"
    }
  }
  ```
- **Response 200 (Premium owner, viewer eligible to contact):**
  ```json
  {
    "data": {
      "username": "jasminh", "tier": "premium",
      "firstName": "Jasmin", "lastName": "Hodžić", "avatarUrl": "https://...",
      "city": "Sarajevo", "country": "BA", "isVerified": true,
      "primaryProfession": "Photographer", "secondaryProfessions": ["Videographer"],
      "visibleOnApplications": [ { "appId": "a2...", "appName": "Svadba", "slug": "svadba" } ],
      "canContact": true,
      "contactActions": {
        "call": "+387...", "whatsapp": "+387...", "viber": "+387...",
        "email": "contact@...", "website": "https://...",
        "socials": { "instagram": "https://instagram.com/..." },
        "sendMessage": true
      }
    }
  }
  ```
  When `canContact` is `false`, `contactActions` is still present but every value is `null` except a `locked: true` flag per method — the API never sends the real contact value to an ineligible caller, exactly matching today's client-side rule but now enforced where it actually matters (server-side, since an external caller can't be trusted to hide a value it was never supposed to receive).
- **Errors:** `NOT_FOUND` (username doesn't exist, **or** the owner has `is_visible = false` for the calling application — both return the identical `NOT_FOUND`, matching `PROJECT_KNOWLEDGE.md`'s explicit "renders its existing not-found state, never a downgraded card" rule and Design Principle/§4.6's information-hiding convention).

### `POST /v1/me/export` — GDPR
- **Auth:** user. **Capability:** none.
- **Response 200:** `{ "data": { "exportedAt": "...", "profile": {...}, "premiumProfile": {...}, "subscriptions": [...], "payments": [...], "notifications": [...], "appSettings": [...] } }` — same aggregate `exportUserData` already produces today, reshaped to camelCase.

### `DELETE /v1/me` — GDPR
Cascading self-deletion (`deleteUserAccountCascade`), irreversible.
- **Auth:** user. **Capability:** none.
- **Response 200:** `{ "data": { "ok": true } }`
- **Errors:** `INTERNAL_ERROR` (partial cascade failure — matches today's "account deletion incomplete" guard, which never leaves the account half-deleted silently).

---

## 7. Applications

Business rules: `PROJECT_KNOWLEDGE.md` → Future Scalability, Authentication → Application Resolver, Applications → Application Visibility. Schema reference: `ApplicationRow` (`visibility`/`launchDate`/`defaultLanguage`, Priority 8.9).

### 7.1 Application Visibility — one state, four values

**Decided, Priority 8.9.** Every application has exactly one `visibility` value, replacing the earlier `status`/`isEnabled` pair (two independently-settable flags that could contradict each other — see `PROJECT_AUDIT.md` for the migration that retired both). No endpoint in this contract ever reasons about an application's visibility any other way.

| Value | Who sees it | Behavior |
|---|---|---|
| `draft` | Administrators only | Excluded from every applications listing/lookup a normal user can reach. Never returned by `GET /v1/applications` or `GET /v1/dashboard/...` for a non-admin caller. |
| `coming_soon` | Everyone | Listed, clearly marked, `enterable: false` — the calling application is expected to render it disabled, with `launchDate` if set. |
| `active` | Everyone | Listed, fully accessible. |
| `archived` | Administrators only (via `GET /v1/admin/applications`) | Excluded from every normal-user-facing listing, same as `draft` — but never deleted; existing subscriptions/payments/history referencing it continue to resolve its name normally, since retiring an application is not the same as erasing its past. |

**`launchDate` is informational only.** It is never read by any activation logic anywhere in this contract — moving an application from `coming_soon` to `active` is always the explicit `PUT /v1/admin/applications/{appId}/visibility` call below, regardless of whether `launchDate` has passed, is in the future, or is unset entirely. No endpoint schedules, counts down to, or auto-triggers anything from it.

**No application name is ever hardcoded anywhere in this contract** (Design Principle 3) — every endpoint below is driven entirely by registry data; adding a new application requires zero endpoint changes, matching `PROJECT_KNOWLEDGE.md` → Future Scalability.

### `GET /v1/applications`
The public registry, **automatically filtered to what the requesting caller is allowed to see** — this is the one and only applications-listing endpoint in this contract; there is no separate "current app" lookup, since "current application" for an authenticated caller already comes from the JWT's `azp` claim (§3) wherever it actually matters.

- **Auth:** optional. **Capability:** none.
- **Visibility filtering (automatic, not a caller-supplied filter):**
  - Anonymous, or an authenticated non-admin: only `coming_soon` and `active` applications are ever returned. `draft`/`archived` rows do not exist as far as this response is concerned — same `NOT_FOUND`-not-`FORBIDDEN` information-hiding rule as §4.6 applies if a `draft`/`archived` app's id is looked up directly (§7.2 below).
  - Admin (`Authorization` from a user currently holding the `admin` role, re-verified server-side): every visibility value is returned, matching how the existing `/admin/applications` panel already needs to see everything.
- **Query:** `?sort=sortOrder` (default, only supported sort).
- **Response 200:**
  ```json
  {
    "data": [
      {
        "id": "a1...", "name": "BosniaFans", "slug": "bosniafans",
        "logoUrl": "https://...", "faviconUrl": "https://...", "coverImageUrl": "https://...",
        "primaryColor": "#1D6BF3", "secondaryColor": "#6366F1",
        "visibility": "active", "launchDate": null,
        "shortDescription": "..."
      },
      {
        "id": "a3...", "name": "Ticketaria", "slug": "ticketaria",
        "logoUrl": "https://...", "faviconUrl": null, "coverImageUrl": null,
        "primaryColor": "#0EA5E9", "secondaryColor": "#8B5CF6",
        "visibility": "coming_soon", "launchDate": "2026-11-01T00:00:00.000Z",
        "shortDescription": "Tickets for events and concerts."
      }
    ]
  }
  ```
  `shortDescription` is already resolved to the caller's own locale (§4.9) — never the raw `_bs`/`_en`/`_de` triplet. `googleClientId` is deliberately never included here (branding-consumer concern, not a listing concern — see §7.2).

### `GET /v1/applications/{idOrSlug}`
One application's full public branding, by id or slug — the `/v1` equivalent of `resolveApplication()`'s result shape (minus the `Host`-header-based resolution itself, which was a single-deployment concept; an external application always already knows its own id).
- **Auth:** optional. **Capability:** none.
- **Response 200:** the same shape as the list above, plus `googleClientId` (needed by the calling application's own Google Sign-In integration) and `defaultLanguage`.
- **Errors:** `NOT_FOUND` — both for a genuinely nonexistent id/slug, and for a `draft`/`archived` application looked up by a non-admin caller (§4.6 — indistinguishable on purpose).

### `POST /v1/admin/applications`
Registers a new application — created `visibility: "draft"` by default (`PROJECT_KNOWLEDGE.md` → Applications Management: "no hard delete," soft-lifecycle visibility is the only lifecycle mechanism).
- **Auth:** admin. **Request body:** `{ "name": "Ticketaria", "slug": "ticketaria", "domain": "ticketaria.io", "primaryColor": "#...", "secondaryColor": "#...", "googleClientId": "..." }` (`domain` normalized to lowercase server-side regardless of input casing — `PROJECT_AUDIT.md` → `AD-12`). `visibility` is never accepted here — every new application starts `draft`, moved forward only by the dedicated endpoint below.
- **Response 201:** the created resource, `visibility: "draft"`.

### `PATCH /v1/admin/applications/{appId}`
Edits branding/settings (name, slug, domain, colors, cover/logo/favicon URLs, sort order, descriptions, Google Client ID, `launchDate`, `defaultLanguage`). **`visibility` is deliberately not part of this endpoint** — see below.
- **Auth:** admin. **Request body:** any subset of the editable fields, e.g. `{ "launchDate": "2026-11-01T00:00:00.000Z", "defaultLanguage": "en" }`.
- **Response 200:** the updated resource.

### `PUT /v1/admin/applications/{appId}/visibility`
The **one explicit action** that changes an application's visibility state — kept deliberately separate from the general settings `PATCH` above, matching this codebase's existing pattern of state-machine transitions (`adminSetVerified`, `adminSetUserActive`) being distinct, dedicated actions rather than bundled into a generic edit. This is the only place in the entire contract that can move an application between `draft`/`coming_soon`/`active`/`archived` — nothing else, including `launchDate` passing, ever does.
- **Auth:** admin.
- **Request body:** `{ "visibility": "active", "reason": "Launch day" }` (`reason` optional, audited if present).
- **Response 200:** `{ "data": { "id": "...", "visibility": "active" } }`
- **Errors:** `VALIDATION_ERROR` (not one of the four allowed values).

---

## 8. Capabilities

Business rules: `PROJECT_KNOWLEDGE.md` → Capabilities. Schema reference: `capability_definitions`/`application_capabilities` (`src/lib/capabilities.functions.ts`).

### `GET /v1/capabilities`
The enabled capability keys for the calling application — the `/v1` equivalent of `getApplicationCapabilities()`. "Calling application" here follows §3.3: the JWT's `azp` when `Authorization` is present, otherwise a required `?appId=`.
- **Auth:** optional. **Capability:** none (this endpoint is what everything else's capability gating is built on).
- **Response 200:** `{ "data": ["rewards", "advertising", "messaging"] }` — a flat array of keys, nothing more (never definition metadata — an application only ever needs to know "is X on," not the full registry).

### `GET /v1/admin/capabilities`
Every capability definition (including archived, for administration).
- **Auth:** admin.
- **Response 200:** `{ "data": [ { "id": "...", "key": "rewards", "label": "Rewards & Loyalty", "description": "...", "displayOrder": 3, "enabled": true, "archived": false } ] }`

### `POST /v1/admin/capabilities`
Registers a new capability key — the concrete mechanism behind "administrator can extend the vocabulary without a deployment."
- **Auth:** admin. **Request body:** `{ "key": "live_streaming", "label": "Live Streaming", "description": "...", "displayOrder": 10, "reason": "..." }` (`reason` optional, audited if present).
- **Response 201:** the created definition.

### `PATCH /v1/admin/capabilities/{key}`
- **Auth:** admin. **Request body:** any subset of `{ "label", "description", "displayOrder", "enabled", "archived", "reason" }`.
- **Response 200:** the updated definition. Setting `archived: true` here takes precedence over every application's own `enabled: true` row for this key, immediately (`PROJECT_KNOWLEDGE.md`: "archived always wins").

### `GET /v1/admin/applications/{appId}/capabilities`
Every non-archived definition, joined with this application's current on/off setting.
- **Auth:** admin. **Response 200:** `{ "data": [ { "key": "rewards", "label": "...", "enabled": true } ] }`

### `PUT /v1/admin/applications/{appId}/capabilities/{key}`
- **Auth:** admin. **Request body:** `{ "enabled": true, "reason": "..." }`
- **Response 200:** `{ "data": { "key": "rewards", "enabled": true } }`

---

## 9. Dashboard

Business rules: `PROJECT_KNOWLEDGE.md` → Dashboard Widget Modularity. Schema reference: `dashboard_widgets`/`dashboard_widget_settings`.

### `GET /v1/dashboard/widgets`
The enabled widget keys for the calling application, already filtered by the dependency-validation rule (a widget with `requiresCapability` set is excluded unless that capability is also enabled) — the `/v1` equivalent of `getDashboardWidgets()`.
- **Auth:** user (a dashboard is inherently per-user, even though the result today doesn't vary by user — kept consistent with every other `/me`-adjacent read). **Capability:** none.
- **Response 200:** `{ "data": ["trial_banner", "my_applications", "active_subscription", "payment_history", "quick_links", "share_and_invite", "rewards", "advertising", "messaging"] }`

**The `my_applications` widget's content is `GET /v1/applications` (§7), nothing separate.** There is no dedicated "dashboard applications" endpoint — a calling application renders this widget by calling §7's listing endpoint and following its own automatic visibility filtering (§7.1): `draft`/`archived` never appear; `coming_soon` renders visible-but-disabled with `launchDate` shown if set; `active` renders normally, fully accessible. A future application is listed with zero endpoint or client code changes required — adding a row to the registry is the entire mechanism (`PROJECT_KNOWLEDGE.md` → Future Scalability).

### `GET /v1/admin/dashboard-widgets`
- **Auth:** admin. **Response 200:** `{ "data": [ { "id": "...", "key": "rewards", "label": "Rewards", "requiresCapability": "rewards", "displayOrder": 7, "enabled": true, "archived": false } ] }`

### `POST /v1/admin/dashboard-widgets`
- **Auth:** admin. **Request body:** `{ "key": "leaderboard", "label": "Leaderboard", "requiresCapability": null, "displayOrder": 8, "reason": "..." }`
- **Response 201:** the created definition.

### `PATCH /v1/admin/dashboard-widgets/{key}`
- **Auth:** admin. **Request body:** any subset of `{ "label", "description", "requiresCapability", "displayOrder", "enabled", "archived", "reason" }`.

### `GET /v1/admin/applications/{appId}/dashboard-widgets`
### `PUT /v1/admin/applications/{appId}/dashboard-widgets/{key}`
Same shape as the Capabilities per-application pair in §8.

---

## 10. Premium

Business rules: `PROJECT_KNOWLEDGE.md` → Premium Model, CORE Premium Service. This section is a thin, read-only surface over the shared resolver — **no endpoint here computes Premium status independently** (Design Principle 5).

### `GET /v1/me/premium`
- **Auth:** user. **Capability:** none.
- **Response 200:**
  ```json
  { "data": { "active": true, "source": "subscription", "expiresAt": "2026-09-01T00:00:00.000Z" } }
  ```
  `source` is `"subscription"`, `"trial"`, or `null` (never active). Identical shape to `resolvePremiumStatus()`'s internal return (`PROJECT_AUDIT.md` → `A-5`) — the API is a direct pass-through of the one resolver, not a reinterpretation of it.

### `GET /v1/me/visible-applications`
- **Auth:** user. **Capability:** none.
- **Response 200:** `{ "data": [ { "appId": "a2...", "appName": "Svadba", "slug": "svadba" } ] }` — backs "Public profile on" for the caller's own profile-editing UI.

---

## 11. Promotional Trial

Business rules: `PROJECT_KNOWLEDGE.md` → Promotional Trial. **There is no self-service trial-activation endpoint anywhere in this contract** — a Trial is only ever created by an explicit, admin-side grant (or, in the future, another registered `trial_sources` business rule), never by a user calling an endpoint themselves. This is a contractual guarantee, not just today's implementation detail: adding a self-serve "start my trial" endpoint later would itself be the automatic-trial anti-pattern `PROJECT_KNOWLEDGE.md` explicitly forbids.

### `GET /v1/me/trial`
The caller's own current or most recent Trial, read-only.
- **Auth:** user. **Capability:** none.
- **Response 200:** `{ "data": { "id": "...", "status": "active", "source": "admin_grant", "startsAt": "...", "expiresAt": "...", "endedAt": null } }` or `{ "data": null }` if the user has never had one.

### `GET /v1/trial-policy`
Current quick-select presets and the maximum allowed duration — public, display-only (backs the admin grant form and any future self-serve entry point's UI, not a self-serve grant itself).
- **Auth:** none. **Response 200:** `{ "data": { "presetDays": [1, 3, 7, 14], "maxDurationDays": 90 } }`

### `POST /v1/admin/trials/grant`
- **Auth:** admin. **Request body:** `{ "userId": "...", "days": 7, "reason": "..." }`
- **Response 201:** `{ "data": { "id": "...", "expiresAt": "..." } }`
- **Errors:** `CONFLICT` (`code` detail `already_has_active_trial`), `VALIDATION_ERROR` (`invalid_duration` — outside policy range).

### `POST /v1/admin/trials/{trialId}/end` / `POST /v1/admin/trials/{trialId}/revoke`
Mechanically identical, kept as two distinct endpoints because they carry different administrative meaning (`PROJECT_KNOWLEDGE.md`: "end" is a legitimate trial being cut short, "revoke" is a correction).
- **Auth:** admin. **Request body:** `{ "reason": "..." }` (optional). **Response 200:** the updated trial resource.

### `GET /v1/admin/trials`
- **Auth:** admin. **Query:** `?userId=` (optional filter), `?sort=-createdAt` (default).
- **Response 200:** paginated trial history, each row including the target user's and granting admin's display name.

### `GET /v1/admin/trial-sources`
- **Auth:** admin. **Response 200:** `{ "data": [ { "key": "admin_grant", "label": "Admin Grant", "enabled": true }, { "key": "promotional_invitation", "label": "...", "enabled": false }, { "key": "reward_redemption", "label": "...", "enabled": false } ] }`

### `PUT /v1/admin/trial-policy`
- **Auth:** admin. **Request body:** `{ "presetDays": [1, 3, 7, 14, 30], "maxDurationDays": 90, "reason": "..." }` (either field, or both).

---

## 12. Billing, Products & Purchases

Business rules: `PROJECT_KNOWLEDGE.md` → Subscription Engine, Products & Purchases, Billing. Schema reference: `SubscriptionPlanRow` (a **Product**) / `SubscriptionRow` / `PaymentRow` — **unchanged tables** (Priority 8.10's architecture review concluded the existing Subscription Engine already is a Products & Purchases system in substance; only `subscription_plans.productType` was added, and only the `/v1` resource names below evolved to match — see PROJECT_KNOWLEDGE.md for the full reasoning).

**A Product is any row a calling application can purchase for its own users** — a Premium subscription, a promotional offer, or a one-time purchase, distinguished only by `productType` (`subscription` | `promotion` | `one_time`), never by a different endpoint shape or a different entitlement mechanism. Every Product still grants the same one global Premium entitlement when purchased and active (`PROJECT_KNOWLEDGE.md` → Premium Model) — `productType` is a merchandising/admin-organization label, not a different permission.

**Advertising is not a Product, and its administration/campaign-management endpoints (§14) remain entirely separate — but a successful campaign purchase is still a purchase.** `GET /v1/products`, `POST /v1/payments/reference`, and the admin Product-registry endpoints below are all Product-only (`subscription_plans`-backed) and never touch Advertising. **`GET /v1/me/purchases` is the one exception, by explicit instruction:** its `payments` array is the caller's *complete* payment history and includes Advertising campaign payments alongside Product payments — see that endpoint below for the exact shape. This widens one read-only history endpoint only; it does not make Advertising a Product, and does not add a second way to browse, create, or moderate a campaign — §14 is unchanged.

**Payment provider webhooks (Stripe/PayPal) are explicitly out of scope for this document.** They are not part of the application-facing `/v1` contract — they're inbound callbacks from Stripe/PayPal themselves, already implemented as public, unversioned routes (`src/routes/api/public/webhooks/{stripe,paypal}.ts`) and remain exactly that. No application ever calls them, and no application-facing endpoint here changes their signature-verification/amount-verification behavior.

### `GET /v1/products`
Active Products for the calling application (only applications visible to the requesting caller per §7.1 have purchasable Products exposed here — a `draft`/`archived` application's Products are never listed to a non-admin, consistent with `NOT_FOUND` on the application itself).
- **Auth:** optional. **Query:** the calling application follows §3.3 (`azp` when signed in, otherwise a required `?appId=`) — `?productType=` optionally filters to one type; omitted returns every active type.
- **Response 200:** `{ "data": [ { "id": "...", "name": "3 Months", "productType": "subscription", "durationMonths": 3, "price": 14.99, "currency": "EUR", "features": ["...", "..."] } ] }` — `features` is already resolved to the caller's own locale server-side (§4.9, not three parallel `features_bs/en/de` arrays) — payment links are deliberately never included here (this section's checkout endpoints exist precisely so a raw payment link is never handed to a client to construct itself).

### `POST /v1/payments/reference`
Signs a `(user, app, product)` checkout reference — the `/v1` equivalent of `createPaymentReference`.
- **Auth:** user.
- **Request body:** `{ "productId": "..." }` (`appId` is never accepted — always the calling application, from the caller's own JWT `azp` claim, §3.3, closing the exact spoofing surface `PROJECT_AUDIT.md` → `SE-7` was originally about).
- **Response 200:** `{ "data": { "reference": "...", "stripePaymentLink": "https://...", "paypalPaymentLink": "https://..." } }` — the Product's own configured Payment Links, with the signed reference already appended as the correct URL parameter for each provider, so the calling application never has to know the parameter name/shape itself.
- **Errors:** `VALIDATION_ERROR` (Product doesn't belong to the calling application, or is inactive).

### `GET /v1/me/purchases`
**The one unified purchase-history endpoint** — the `/v1` equivalent of the Dashboard's `/dashboard/purchases` page: every Product the caller has ever purchased, across every application, merged with the caller's **complete** payment/transaction history — Product payments **and** Advertising campaign payments together (explicit instruction: "the user must have one complete purchase/payment history in one place"). This is the one endpoint in this section where Advertising appears — see §12's intro for why that's a deliberate, narrow exception rather than Advertising becoming a Product.
- **Auth:** user. **Query:** `?status=active` (filters the `products` array only; default returns all).
- **Response 200:**
  ```json
  {
    "data": {
      "products": [
        {
          "id": "...", "appId": "...", "appName": "BosniaFans",
          "productName": "Premium Member", "productType": "subscription",
          "status": "active", "startedAt": "...", "expiresAt": "..."
        }
      ],
      "payments": [
        {
          "id": "...", "appId": "...", "appName": "BosniaFans",
          "source": "product",
          "amount": 14.99, "currency": "EUR", "provider": "stripe",
          "transactionId": "pi_3P...", "status": "success", "createdAt": "..."
        },
        {
          "id": "...", "appId": "...", "appName": "BosniaFans",
          "source": "advertising", "campaignId": "...", "campaignTitle": "Hero Banner — August",
          "amount": 49.00, "currency": "EUR", "provider": "stripe",
          "transactionId": "pi_3Q...", "status": "success", "createdAt": "..."
        }
      ]
    }
  }
  ```
  `products[].status` is the *effective* status (accounting for time-based expiry even if the stored value hasn't flipped yet, matching `effectiveSubscriptionStatus()`), never the raw column — this array is Product-only, unaffected by the 8.12 change. `payments[]` is the complete, unfiltered transaction list: `source` is `"product"` or `"advertising"` (the `/v1` surfacing of `payments.subscription_id` vs. `payments.campaign_id` — mutually exclusive per row); `campaignId`/`campaignTitle` are present only when `source: "advertising"`. `provider` is `"stripe"`, `"paypal"`, or `null` for an admin-granted Product (which has no payment record at all — an admin grant is not a transaction, so there is nothing to show there, matching "CORE only stores references and transaction history," never a fabricated one). `transactionId` is the provider's own id (`stripe_payment_id`/`paypal_payment_id`) — never `stripe_payment_intent_id` or any other purely internal reconciliation field (Design Principle 1). **Invoices are never returned here or anywhere in this contract** — Stripe and PayPal remain the systems of record for those; this endpoint is reference/history only.

### `GET /v1/admin/products` / `POST /v1/admin/products` / `PATCH /v1/admin/products/{productId}`
Standard registry CRUD, scoped to one application (`appId` in the request body/query). **Auth:** admin. Request/response mirror `SubscriptionPlanRow` in camelCase, including `productType`, `stripePaymentLink`/`paypalPaymentLink` (admin-only fields, never returned by the public `GET /v1/products` above).

### `POST /v1/admin/products/{productId}/archive`
Soft-lifecycle only — sets `isActive: false`, never a hard delete (`PROJECT_AUDIT.md` → `AD-14`).
- **Auth:** admin. **Response 200:** the updated Product, `isActive: false`.

### `POST /v1/admin/premium/grant`
- **Auth:** admin. **Request body:** `{ "userId": "...", "appId": "...", "productId": "...", "durationMonths": 12, "reason": "..." }`
- **Response 201:** `{ "data": { "purchaseId": "...", "expiresAt": "..." } }`

### `POST /v1/admin/premium/{purchaseId}/revoke`
- **Auth:** admin. **Request body:** `{ "reason": "..." }` (optional). **Response 200:** the cancelled purchase resource.

### `GET /v1/admin/payments`
- **Auth:** admin. **Query:** `?status=success`, `?sort=-createdAt` (default). **Response 200:** paginated payment history across every user (never raw `stripe_payment_intent_id`/`paypal_payment_id` — those remain purely internal reconciliation fields, per Design Principle 1; only `id`, `amount`, `currency`, `status`, `paymentMethod`, `createdAt`, and the owning user's display name are returned).

### `GET /v1/admin/stats`
Overview stats for the admin dashboard home.
- **Auth:** admin. **Response 200:** `{ "data": { "totalUsers": 4213, "activePremium": 812, "revenueThisMonth": 3456.00, "newUsersThisWeek": 58 } }` — `activePremium` via the shared resolver (§1, Design Principle 5), not a re-derived count.

---

## 13. Rewards & Loyalty

Business rules: `PROJECT_KNOWLEDGE.md` → Rewards & Loyalty. Schema reference: `reward_action_rules`/`reward_ledger`/`reward_levels`/`reward_achievements`/`reward_catalog`/`reward_fulfillment_types`/`reward_config`.

### `GET /v1/me/rewards`
The aggregated Rewards Dashboard payload — the `/v1` equivalent of `getRewardsMe`.
- **Auth:** user. **Capability:** `rewards` required — `CAPABILITY_DISABLED` if off for the calling application.
- **Response 200:**
  ```json
  {
    "data": {
      "rewardPoints": 340, "lifetimePoints": 890,
      "level": { "key": "silver", "label": "Silver" },
      "verifiedReferrals": 2,
      "achievements": [ { "key": "first_invite", "label": "First Invite", "earnedAt": "..." } ],
      "catalog": [ { "key": "1mo_premium", "label": "1 Month Premium", "pointsCost": 500, "verifiedReferralsRequired": 0, "canRedeem": false } ],
      "redeemHistory": [ { "catalogKey": "...", "pointsSpent": 500, "status": "pending_fulfillment", "redeemedAt": "..." } ]
    }
  }
  ```
  Catalog entries whose `requiresCapability` is disabled for the calling application are already filtered out server-side, per the existing dependency-validation rule — never returned with a "locked" flag for the client to hide itself.

### `POST /v1/me/rewards/redeem`
- **Auth:** user. **Capability:** `rewards` required.
- **Request body:** `{ "catalogKey": "1mo_premium" }`
- **Response 201:** `{ "data": { "redemptionId": "...", "pointsSpent": 500, "status": "pending_fulfillment" } }`
- **Errors:** `VALIDATION_ERROR` (`not_enough_points`, `not_enough_verified_referrals`, `reward_unavailable` — including a capability-gated reward whose capability is off), `CAPABILITY_DISABLED`.
- **Fulfillment note:** this endpoint only ever records the redemption as `pending_fulfillment` — it never itself extends Premium, credits Advertising, or grants a Featured slot (`PROJECT_KNOWLEDGE.md`: "Rewards records, it never fulfills"). Turning a `pending_fulfillment` redemption into a real benefit is the owning module's own admin endpoint (e.g. §14's Advertising Credit fulfillment) — there is no generic "fulfill any redemption" endpoint in this contract, by design.

### `POST /v1/me/referral`
Links the caller to whoever referred them — the `/v1` equivalent of `linkReferral`, called once by the calling application right after onboarding completes.
- **Auth:** user. **Request body:** `{ "referrerUsername": "jasminh" }`
- **Response 200:** `{ "data": { "linked": true } }` or `{ "data": { "linked": false, "reason": "already_linked" } }` (also `referrer_not_found`, `self_referral` — never an error status for these, since they're expected, non-exceptional outcomes the calling application needs to branch on).

### Admin registry endpoints
All under `/v1/admin/rewards/...`, all standard soft-lifecycle registry CRUD (list + create + patch, matching the shape already established in §8/§9):

- `GET /v1/admin/rewards/action-rules` / `POST .../action-rules` / `PATCH .../action-rules/{action}` — `{ action, label, points, cooldownSeconds, maxPerUser, displayOrder, enabled, archived }`.
- `GET /v1/admin/rewards/levels` / `POST .../levels` / `PATCH .../levels/{key}` — `{ key, label, minLifetimePoints, displayOrder, enabled, archived }`.
- `GET /v1/admin/rewards/achievements` / `POST .../achievements` / `PATCH .../achievements/{key}` — `{ key, label, description, triggerAction, triggerCount, displayOrder, enabled, archived }`.
- `GET /v1/admin/rewards/catalog` / `POST .../catalog` / `PATCH .../catalog/{key}` — `{ key, label, description, pointsCost, verifiedReferralsRequired, grantType, grantValue, requiresCapability, displayOrder, enabled, archived }`.
- `GET /v1/admin/rewards/fulfillment-types` / `POST .../fulfillment-types` / `PATCH .../fulfillment-types/{key}` — `{ key, label, description, displayOrder, enabled, archived }`.
- `GET /v1/admin/rewards/config` / `PUT /v1/admin/rewards/config/{key}` — `{ key, value }` (e.g. `key: "referral_verification_days"`).
- `POST /v1/admin/rewards/adjust` (Priority 12 Phase 4) — `{ userId, points, lifetimePoints, reason }`. Writes a `reward_ledger` row directly (`origin: "manual_admin"`, the one origin permitted to carry negative `points`/`lifetimePoints`). Unlike every other endpoint in this contract, `reason` is **required**, not optional — this is the one action that can move a user's balance with no underlying event having actually happened.

Every mutating endpoint above accepts an optional `reason` field, audited via the same shared audit mechanism as every other admin action (`PROJECT_KNOWLEDGE.md` → Audit Strategy).

### Universal Event Engine (Priority 12)

Extends Rewards & Loyalty rather than replacing it — `reward_action_rules`/`reward_ledger` remain the sole path for CORE-internal actions (webhooks, onboarding, admin grants). Schema reference: `event_definitions`/`application_events`/`event_rules`/`event_rule_conditions`/`event_abuse_flags`. Business rules and the full condition-type list: `PROJECT_KNOWLEDGE.md` → Rewards & Loyalty / Universal Event Engine. **Verified implemented:** `POST /v1/events` (`src/routes/v1/events/index.ts`) is real and live.

**Global vs. Application scope (Priority 15 Phase A).** `event_rules.app_id` is nullable: `null` is a **global** rule, available to every application that has the event enabled via its own `application_events` row; a specific application id is an **application-scoped** rule that always overrides the global rule for the same `eventKey` when both exist. Precedence: application-specific row wins if present, else the global row, else the event has no configured reward (unchanged `"rule_not_configured"` outcome). This is the same "global row (`app_id` null) or per-application override" convention already used by `ad_placement_prices` — not a new pattern. `application_events` itself is unaffected: an application must still explicitly enable an event before any rule, global or app-specific, is ever evaluated.

### `POST /v1/events`
The one endpoint every application calls to report an event — the calling application never calculates points itself; CORE resolves the reward (if any) from the admin-configured Event Registry, Application Mapping, and Reward Rule Engine.
- **Auth:** user. `azp` (the calling application) and `sub` (the acting user) are taken from the caller's own JWT only, never from the request body.
- **Request body:** `{ "eventKey": "photo_liked", "recipientUserId": "...", "resourceType": "photo", "resourceId": "...", "metadata": {}, "dedupeKey": "..." }` — `recipientUserId` defaults to the caller (the common case where actor and recipient are the same person); set it explicitly for events like `comment_received` where the reward belongs to the content owner, not the caller. `dedupeKey` makes a retried submission idempotent (unique per app + event).
- **Response 200:** `{ "data": { "granted": true, "points": 5, "lifetimePoints": 5, "reason": null } }` — `granted: false` is not an error; it's the expected outcome when the event isn't configured for this application, a cooldown/limit is active, or a rule condition didn't pass (`reason` explains which).
- **Errors:** `UNAUTHORIZED`, `VALIDATION_ERROR`.
- Every submission is recorded in `reward_ledger` regardless of outcome (0 points when unconfigured/rejected), for full auditability — the same precedent as an unrecognized CORE-internal action.

### Admin registry endpoints (Universal Event Engine)

Same soft-lifecycle registry CRUD shape as the Admin registry endpoints above. **Implementation status (corrected Priority 15 Phase A, verified via a full listing of `src/routes/v1/**`):** unlike most other modules' admin registries (Capabilities, Dashboard Widgets, Rewards, Trials — each of which does have real `/v1/admin/*` routes), these four endpoint groups do **not** exist as `/v1` REST routes today. Admin management of the Event Registry, Application Mapping, and Reward Rule Engine happens entirely through the internal admin panel (`/admin/events`, backed by `src/lib/events.functions.ts` TanStack server functions) — the design below remains the target `/v1` shape for a future pass, not a description of what exists now:

- `GET /v1/admin/events/definitions` / `POST .../definitions` / `PATCH .../definitions/{eventKey}` — `{ eventKey, displayName, description, category, icon, displayOrder, enabled, archived }`. `version` auto-increments on every update (observability only).
- `GET /v1/admin/events/application-mapping?appId=...` / `PUT .../application-mapping` — `{ appId, eventKey, enabled }`. Fails closed: no row means the event is not live for that application.
- `GET /v1/admin/events/rules?appId=...` / `POST .../rules` / `PATCH .../rules/{id}` — `{ appId, eventKey, points, lifetimePoints, cooldownSeconds, maxExecutions, dailyLimit, weeklyLimit, monthlyLimit, priority, repeatable, displayOrder, enabled, archived }`. **`appId` is nullable (Priority 15 Phase A)** — omitted/`null` targets the GLOBAL rule for `eventKey`; a specific id targets that application's own rule. See "Global vs. Application scope" above for precedence.
- `GET /v1/admin/events/rules/{ruleId}/conditions` / `POST .../conditions` / `DELETE .../conditions/{id}` — `{ conditionType, params, displayOrder }`.

### Missions, Challenges & Streaks (Priority 15 Phase B)

Consume the same standardized activity events as the Universal Event Engine above — applications never implement Mission/Challenge/Streak logic themselves, and no new application-facing endpoint exists: applications continue calling `POST /v1/events` exclusively. Schema reference: `engagement_definitions`/`engagement_conditions`/`user_engagement_completions` (Missions and Challenges share this one engine, distinguished by a `kind` column, per the "no duplicate progress engines" requirement) and `streak_definitions`/`streak_milestones`/`user_streaks`/`user_streak_milestones` (mechanically different — consecutive-day continuity, not count-vs-target — so a separate table set). Both reuse the Phase A Global/Application scope convention exactly (`app_id` nullable, `NULL` = global). Business rules: `PROJECT_KNOWLEDGE.md` → Missions, Challenges & Streaks.

**Implementation status:** admin management (`/admin/engagement`) and the user-facing read (`getMyEngagement`) exist today only as internal TanStack server functions (`src/lib/engagement.functions.ts`), not as public `/v1` REST routes — the same status as the Universal Event Engine's admin endpoints above. No application currently needs to read another user's Mission/Challenge/Streak state, so `GET /v1/me/missions`, `GET /v1/me/challenges`, `GET /v1/me/streaks` remain design-only until a concrete need exists (§21's guidance: applications only submit events, CORE determines engagement state).

- A qualifying occurrence for progress/streak purposes is a `reward_ledger` row with `points > 0` for the relevant `eventKey` — the exact filter `recordEvent()`'s own cooldown/limit counters already use, not a new definition of "qualifying."
- Mission/Challenge completion is idempotent via a `UNIQUE(user_id, definition_id)` constraint on `user_engagement_completions` (upsert-with-`ignoreDuplicates`, the same pattern `user_achievements` already uses) — a completed definition never awards its reward twice.
- Streak day-advancement is atomic via `advance_user_streak()`, a `service_role`-only Postgres function (`SELECT ... FOR UPDATE` inside one transaction) — the same "PostgREST can't express this atomically" precedent Priority 12 Phase 5's analytics functions already established.
- Streak day-boundaries use a single platform-wide configured IANA timezone (`engagement_config.streak_timezone`, admin-editable, seeded `Europe/Sarajevo`) — CORE has no per-user timezone concept; this was an explicit Phase B decision, not a default guess.
- Reward shape mirrors two existing patterns depending on what's configured: `reward_points`/`reward_lifetime_points` (the common case, mirrors `event_rules.points`/`lifetime_points`) or an optional `reward_grant_type`/`reward_grant_value` (mirrors `reward_catalog.grant_type`/`grant_value`, resolved against the existing `reward_fulfillment_types` registry) for a future non-points reward — as of Phase C this now actually fulfills (see Entitlements below), not merely records `pending_fulfillment` forever.

### Entitlements (Priority 15 Phase C)

The generic layer for duration/access benefits (Premium, VIP, feature access) — a third, independent source for `has_any_active_premium()`/`resolvePremiumStatus()` alongside `subscriptions` and `promotional_trials` (neither touched or replaced; `promotional_trials` was explicitly not generalized into this layer — see `PROJECT_KNOWLEDGE.md` → Entitlements for the full decision). Schema: `entitlements`/`entitlement_sources`; reuses the existing `reward_fulfillment_types` registry as its benefit vocabulary (no second registry) plus a new `grants_premium` column on it.

**Implementation status:** admin Grant/Extend/Revoke lives in the existing Manage User modal (`/admin/users`, `src/lib/entitlements.functions.ts`), not as public `/v1` REST routes — same status as every other Priority 15 admin surface documented above.

- `grantEntitlement()`/`extendEntitlement()`/`revokeEntitlement()` (`src/lib/entitlements.server.ts`) are the only three mutating operations. At most one active entitlement per `(user, benefitType, scope)` — a duplicate grant attempt is rejected (`already_has_active_entitlement`), directing the caller to Extend instead, the same policy `promotional_trials` already enforces.
- `fulfillGrant()` is the one dispatcher every non-points reward path (Mission/Challenge/Streak completion, `reward_catalog` redemption) calls to resolve a configured `grantType` — `advertising_credit` routes to the existing `ad_account_credits` ledger, `premium_duration`/`vip`/`feature_access` route to `grantEntitlement()`, anything else stays `pending_fulfillment`.
- Redemption TOCTOU fixed: `redeem_reward_atomic()` (`service_role`-only Postgres function, transaction-scoped per-user advisory lock) replaces the previous non-atomic balance-check-then-insert in `redeemReward` (`PROJECT_AUDIT.md` → `PR11-13`).
- Minimal rate limiting is now enforced on the two most abuse-exposed Priority 15 surfaces: `POST /v1/events` (120/min per application+user, `429 RATE_LIMITED`) and reward redemption (10/min per user) — via the existing `enforceRateLimit()` (`src/lib/rate-limit.server.ts`, Priority 11 security audit's in-memory limiter, already protecting `auth/session`/`auth/refresh`/both payment webhooks), not a new mechanism. §4.5's `RATE_LIMITED` code is no longer purely theoretical for these two endpoints; the other ~80 `/v1` endpoints (`PROJECT_AUDIT.md` → `PR11-20`) remain unprotected, outside Priority 15's scope.

---

## 14. Advertising

Business rules: `PROJECT_KNOWLEDGE.md` → Advertising, and → Universal Advertising Placement & Delivery Foundation (Priority 13, Phase D1). Schema reference: `ad_placements`/`ad_placement_prices`/`ad_campaigns`/`ad_account_credits`/`ad_trusted_advertisers`/`ad_config`/`ad_application_settings`/`ad_application_placements`.

### `GET /v1/advertising/placements`
Placements + resolved prices available for the calling application — empty if `advertising` is disabled (same dependency-validation rule as everywhere else, not a `CAPABILITY_DISABLED` error, since "no placements" is itself a valid empty-list answer for a browsing endpoint). Calling application per §3.3 (`azp` when signed in, otherwise a required `?appId=`).
- **Auth:** optional. **Response 200:** `{ "data": [ { "key": "hero_banner", "label": "Hero Banner", "prices": [ { "id": "...", "durationDays": 30, "price": 49.00, "currency": "EUR" } ] } ] }`

### `GET /v1/advertising/placements/{placementKey}/active-ad`
The currently eligible creative for a placement, if any — public ad-serving, deliberately minimal fields (never owner, moderation history, or price). Calling application per §3.3. **(Phase D1)** now also considers Priority 13 campaign targets whose destination channel represents the calling application and names this exact placement, in addition to the original single-placement campaign — whichever is more recent wins, same recency rule as before, not a new ranking scheme. Delivery is additionally gated on an `ad_application_placements` mapping existing and being enabled for `(appId, placementKey)` — `purchasable` on that mapping has no effect on this endpoint, it governs new sales only (`POST /v1/me/advertising/campaigns`), never whether an already-active campaign/target keeps delivering.
- **Auth:** optional. **Query:** `?appId=` required when anonymous; **`?device=desktop|mobile`** (Phase D1, optional — omitted entirely preserves the exact pre-D1 behavior for every existing caller; when supplied, no creative is returned if the resolved placement doesn't support that device). **Response 200:** `{ "data": { "campaignId": "...", "title": "...", "imageUrl": "...", "linkUrl": "..." } }` or `{ "data": null }` — response shape unchanged.

### `GET /v1/me/advertising/summary`
Eligibility + available Advertising Credit, for the checkout UI to show before the user commits.
- **Auth:** user. **Capability:** `advertising` required. **Response 200:** `{ "data": { "eligible": true, "eligibilityRule": "anyone", "creditBalance": 25.00 } }`

### `POST /v1/me/advertising/campaigns`
Creates a `draft` campaign — **before** payment, since static Payment Links can't carry creative content (`PROJECT_KNOWLEDGE.md` → Advertising).
- **Auth:** user. **Capability:** `advertising` required.
- **Request body:** `{ "placementPriceId": "...", "title": "...", "imageUrl": "https://...", "linkUrl": "https://..." }` (`imageUrl` obtained from §18's upload endpoint first).
- **Response 201:** the created campaign, `status: "draft"`.
- **Errors:** `CAPABILITY_DISABLED`, `FORBIDDEN` (`not_eligible` — the resolved eligibility rule rejects this user), `VALIDATION_ERROR` (invalid price for this application, unsafe URL).

### `PATCH /v1/me/advertising/campaigns/{campaignId}`
Edits creative/destination. Editing a non-draft, non-terminal campaign **always re-runs moderation** from the application's current mode (`PROJECT_KNOWLEDGE.md`: "an edit can never silently bypass moderation") — the response's `status` may therefore change as a side effect of this call, which is expected, not a bug to work around client-side.
- **Auth:** user (must own the campaign). **Request body:** any subset of `{ "title", "imageUrl", "linkUrl" }`.
- **Response 200:** the updated campaign.
- **Errors:** `NOT_FOUND` (not the caller's campaign), `VALIDATION_ERROR` (`campaign_ended` — `ended`/`cancelled` campaigns can no longer be edited).

### `POST /v1/me/advertising/campaigns/{campaignId}/checkout-reference`
- **Auth:** user (must own the campaign, must be `draft`).
- **Response 200:** `{ "data": { "reference": "...", "expectedAmount": 24.00, "currency": "EUR", "creditApplied": 25.00, "stripePaymentLink": "...", "paypalPaymentLink": "..." } }` — figures shown here are for display only; the webhook re-derives everything server-side at fulfillment (never trusted from this response).

### `GET /v1/me/advertising/campaigns`
- **Auth:** user. **Query:** `?status=active` (filter), `?sort=-createdAt` (default). Stale `draft` campaigns past the configured expiry are lazily cancelled as a side effect of this call, exactly as today (`expireStaleDraftCampaigns`) — not a separate endpoint.
- **Response 200:** paginated list of the caller's own campaigns.

### Admin endpoints
- `GET /v1/admin/advertising/placements` / `POST .../placements` / `PATCH .../placements/{key}` — registry CRUD.
- `GET /v1/admin/advertising/prices?appId=` (optional filter, omit for all; `?appId=null` for global-only) / `POST .../prices` / `PATCH .../prices/{id}` — `{ appId, placementKey, durationDays, price, currency, stripePaymentLink, paypalPaymentLink, displayOrder, enabled, archived }`.
- `PUT /v1/admin/advertising/config` — global defaults: `{ "moderationMode": "manual", "eligibilityRule": "anyone", "draftExpiryHours": 48 }` (any subset).
- `PUT /v1/admin/applications/{appId}/advertising-settings` — per-application override: `{ "moderationMode": "auto", "eligibilityRule": null }` (either field `null` clears the override back to the global default).
- `GET /v1/admin/applications/{appId}/trusted-advertisers` / `PUT .../trusted-advertisers/{userId}` (`{ "trusted": true, "reason": "..." }`) / — trust is strictly per-application, never global (`PROJECT_KNOWLEDGE.md`).
- `GET /v1/admin/advertising/campaigns?status=pending` — moderation queue.
- `POST /v1/admin/advertising/campaigns/{campaignId}/moderate` — `{ "approve": true, "note": "..." }`.
- `GET /v1/admin/advertising/credit-redemptions?status=pending`
- `POST /v1/admin/advertising/credit-redemptions/{redemptionId}/fulfill` — the concrete implementation of Rewards' fulfillment abstraction for `grantType: "advertising_credit"` (§13) — turns a `pending_fulfillment` redemption into a real, spendable credit. **Response 200:** `{ "data": { "amount": 25.00, "currency": "EUR" } }`.

---

## 15. Share & Invite

Business rules: `PROJECT_KNOWLEDGE.md` → Share Profile / Invite a Friend.

### `GET /v1/share-invite`
Whatever the admin has configured for the calling application — any `null` field is a deliberate absence for the calling application to fill with its own locale-aware default (no server-side hardcoded English fallback, matching today's behavior exactly). Calling application per §3.3 (`azp` when signed in, otherwise a required `?appId=`).
- **Auth:** optional. **Response 200:** `{ "data": { "shareTitle": "...", "shareDescription": "...", "shareUrl": "...", "inviteTemplate": "Join {user_name} on ... {invite_link}" } }`

### `PUT /v1/admin/applications/{appId}/share-invite`
- **Auth:** admin. **Request body:** any subset of `{ "shareTitle", "shareDescription", "shareUrl", "inviteTemplate" }` (each nullable — `null` clears it back to "use the client's own default").
- **Response 200:** the updated config.

---

## 16. Messaging

Business rules: `PROJECT_KNOWLEDGE.md` → Text Messaging. **Every rule stated there (one-on-one only, no groups, no editing/deletion, no attachments, 2000-character cap, `messaging` capability enforcement) is a permanent constraint of this contract, not a v1 limitation** — see §20/§21 for what would actually require a new API version if ever revisited.

### `POST /v1/conversations`
Get-or-create — the `/v1` equivalent of `getOrCreateConversation`. Eligibility (both sides globally Premium, recipient `is_contactable` for the calling application, `messaging` capability enabled for the calling application) is checked **only** if no conversation between this pair already exists (`PROJECT_KNOWLEDGE.md`: "checked once, at creation, never again").
- **Auth:** user. **Capability:** `messaging` required **only for a genuinely new conversation** — reopening an existing one never re-checks it.
- **Request body:** `{ "recipientUserId": "..." }` (the recipient's application context is always the calling application, from the caller's own JWT `azp` claim — never a client-supplied `appId`, same rule as §12's payment reference).

- **Response 200/201:** `{ "data": { "id": "...", "createdAt": "..." } }` (200 if it already existed, 201 if genuinely new — both bodies identical in shape).
- **Errors:** `VALIDATION_ERROR` (`cannot_message_self`), `FORBIDDEN` (`both_users_must_be_premium`, `recipient_not_contactable`), `CAPABILITY_DISABLED`.

### `GET /v1/conversations`
The caller's inbox — hidden conversations excluded unless a newer message has arrived since they were hidden (auto-restore, matching today's exact rule).
- **Auth:** user. **Query:** `?sort=-lastMessageAt` (default, only supported sort).
- **Response 200:** `{ "data": [ { "id": "...", "otherUser": { "id": "...", "firstName": "...", "avatarUrl": "..." }, "lastMessage": { "body": "...", "senderId": "...", "createdAt": "..." }, "unreadCount": 2 } ] }`

### `POST /v1/conversations/{conversationId}/hide`
- **Auth:** user (must be a participant). **Response 200:** `{ "data": { "ok": true } }`
- **Errors:** `NOT_FOUND` (not a participant — §4.6).

### `GET /v1/conversations/{conversationId}/messages`
- **Auth:** user (must be a participant — enforced server-side the same way RLS enforces it today, never trusted from the client). **Query:** `?cursor=` (standard cursor pagination, §4.2 — cursor here is a message timestamp boundary internally, opaque externally), newest-first internally, returned oldest-first per page (matching today's `getMessages` reversal).
- **Response 200:** `{ "data": [ { "id": "...", "senderId": "...", "body": "...", "createdAt": "...", "readAt": null } ], "meta": { "nextCursor": "...", "hasMore": true } }`

### `POST /v1/conversations/{conversationId}/messages`
- **Auth:** user (must be a participant). **Request body:** `{ "body": "Hey, saw your profile!" }` (max 2000 characters, enforced server-side regardless of what the calling application already checked).
- **Response 201:** the created message.
- **Side effects (unchanged from today, not separately callable):** bumps the conversation's `lastMessageAt`; inserts a notification for the recipient (§17) — there is no separate "notify" endpoint a caller needs to invoke itself.

### `POST /v1/conversations/{conversationId}/read`
Marks every unread received message in this conversation as read.
- **Auth:** user (must be a participant). **Response 200:** `{ "data": { "ok": true } }`

---

## 17. Notifications

Business rules: `PROJECT_KNOWLEDGE.md` → Notifications, Communication Center.

### `GET /v1/me/notifications`
- **Auth:** user. **Query:** `?isRead=false` (filter), `?sort=-createdAt` (default).
- **Response 200:** `{ "data": [ { "id": "...", "type": "info", "title": "New message", "message": "You have a new message.", "isRead": false, "createdAt": "..." } ] }` — `title`/`message` already resolved to the caller's own locale server-side (never three parallel `_bs/_en/_de` fields — see §21).

### `POST /v1/me/notifications/read-all`
- **Auth:** user. **Response 200:** `{ "data": { "ok": true } }`

### `POST /v1/me/notifications/{notificationId}/read`
- **Auth:** user (must own the notification). **Response 200:** `{ "data": { "ok": true } }`

### `POST /v1/admin/notifications/broadcast`
The one and only bulk-communication mechanism (`PROJECT_KNOWLEDGE.md` → Communication Center — "applications do not send their own broadcast notifications").
- **Auth:** admin.
- **Request body:** `{ "target": "premium", "appId": null, "type": "success", "title": { "bs": "...", "en": "...", "de": "..." }, "message": { "bs": "...", "en": "...", "de": "..." } }` — `target` is `"all" | "premium" | "user"` (`userId` required when `target: "user"`); `premium` resolves via the shared resolver (§1, Design Principle 5), reaching Trial-only Premium users too (`PROJECT_AUDIT.md` → `AD-13`'s fix, carried into this contract).
- **Response 200:** `{ "data": { "sent": 812 } }`
- **Priority 15 Phase D:** the request body gains two optional fields, `category` (`"information" | "reward" | "premium" | "offer" | "warning" | "system"` — a richer, admin-facing classification, deliberately separate from `type` above, which stays UI severity only) and `targetPath` (a deep link, internal `/dashboard/...` paths only — `PROJECT_AUDIT.md` → `MSG-3`, resolved). `GET /v1/me/notifications`'s response gains the same two fields, both nullable.

### User → Admin Support (Priority 15 Phase D)

A simple support ticket system — explicitly not the Messaging module (§16): different lifecycle (subject/priority/status/replies vs. peer eligibility), genuinely new schema (`support_tickets`/`support_messages`), not a repurposing. Business rules: `PROJECT_KNOWLEDGE.md` → Admin ↔ User Communication & Support.

**Implementation status:** exists today only as internal TanStack server functions (`src/lib/support.functions.ts`, user-facing UI on the existing `/dashboard/help` page, admin UI at `/admin/support`), not as public `/v1` REST routes — same status as every other Priority 15 admin/user surface documented above.

- A ticket has `subject`, `category` (free text, optional), `priority` (`low`/`normal`/`high`, admin-only settable), `status` (`open`/`in_progress`/`closed`), and `appId` (which application the user was using, informational).
- A user sees and replies only to their own tickets; replying to a `closed` ticket reopens it to `in_progress`. An admin reply moves an `open` ticket to `in_progress` and triggers an "Admin reply" notification (§17, `targetPath: "/dashboard/help"`) unless marked an internal note (`isInternalNote: true`), which is never visible to the user.
- All writes are server-validated (ownership or admin role) before reaching the database — never a direct client-authenticated insert, the same pattern already established for Messaging (`PROJECT_AUDIT.md` → `PR11-5`).

---

## 18. Media uploads

Business rules: `PROJECT_KNOWLEDGE.md` → Media Strategy. Every upload endpoint here is backed by the same replaceable `MediaStorageProvider` adapter internally — this contract exposes exactly two purpose-scoped endpoints (matching the two Tier-2 call sites that exist today) plus one Tier-1 admin endpoint, never a generic "upload anything anywhere" endpoint (which would itself leak storage-path structure to the caller, violating Design Principle 1).

### `POST /v1/media/avatar`
- **Auth:** user. **Request:** `multipart/form-data`, field `file` (JPEG/PNG/WEBP, max 5MB — enforced server-side regardless of client-side checks).
- **Response 200:** `{ "data": { "url": "https://.../avatars/5b2f.../avatar.jpg" } }` — re-uploading replaces the existing file at the same path (never accumulates), matching today's fixed-filename behavior. This URL is then passed to `PATCH /v1/me` as `avatarUrl` — **subject to Identity Lock** (§6): once locked, this endpoint still accepts the upload (harmless), but the resulting URL will be rejected by `PATCH /v1/me` if the caller tries to apply it.

### `POST /v1/media/advertising-banner`
- **Auth:** user. **Capability:** `advertising` required. **Request:** `multipart/form-data`, field `file`.
- **Response 200:** `{ "data": { "url": "https://.../advertising/5b2f.../<timestamp>.jpg" } }` — a new URL per upload (banners aren't replaced in place, matching today's timestamped-filename behavior), to be passed to `POST /v1/me/advertising/campaigns` as `imageUrl`.

### `POST /v1/admin/media/branding`
Tier 1 content (application logo/favicon/cover) — admin-only, never routed through the same Tier-2 adapter (`PROJECT_KNOWLEDGE.md` → Media Strategy: Tier 1 assets never go through `MediaStorageProvider`).
- **Auth:** admin. **Request:** `multipart/form-data`, fields `file`, `purpose` (`"logo" | "favicon" | "cover"`), `appId`.
- **Response 200:** `{ "data": { "url": "https://..." } }` — the calling admin UI then applies it via `PATCH /v1/admin/applications/{appId}`.

---

## 19. Admin — cross-cutting

Endpoints that don't belong to any one module above. Every endpoint in this entire document that requires `Auth: admin` follows the identical rule: `Authorization` must carry a valid, unexpired CORE-minted JWT, **and** the server re-verifies the `admin` role against the Core's role data on every single call (never cached in the token itself, never trusted from a prior check — `PROJECT_KNOWLEDGE.md` → Permissions, Roles). The token's `azp` claim (§3) is present but ignored on every `/v1/admin/*` endpoint — admin is a Core-wide surface, not scoped to whichever application the admin happened to sign in through.

### `GET /v1/admin/users`
- **Auth:** admin. **Query:** `?search=jasmin` (matches email/username/first/last name), `?premium=true` (resolved via the shared resolver, §1 Design Principle 5 — includes Trial-only Premium users), `?isVerified=true`, `?isActive=true`, `?sort=-createdAt` (default).
- **Response 200:** paginated list, each row including a resolved `isPremium` boolean (never the raw internal concept it derives from).

### `PATCH /v1/admin/users/{userId}`
Edits `city`/`country`/`bio`/`username` only — `firstName`/`lastName`/`avatarUrl` (Identity Lock) and `email` (§6 — always auth-identity-derived) are never accepted here, matching `PATCH /v1/me`'s own restrictions exactly (an admin has no more editing power over these fields than the user does, by design).
- **Auth:** admin. **Response 200:** the updated user resource.

### `POST /v1/admin/users/{userId}/suspend` / `POST /v1/admin/users/{userId}/reactivate`
- **Auth:** admin (cannot target the caller's own account — `FORBIDDEN`). **Response 200:** `{ "data": { "id": "...", "isActive": false } }`

### `DELETE /v1/admin/users/{userId}`
Admin-initiated cascading deletion — shares its implementation with `DELETE /v1/me`, never a duplicated deletion path.
- **Auth:** admin (cannot target the caller's own account — use `DELETE /v1/me` instead). **Response 200:** `{ "data": { "ok": true } }`

### `GET /v1/admin/verification-requests`
Premium (subscription or Trial), not-yet-verified users.
- **Auth:** admin. **Response 200:** paginated list.

### `POST /v1/admin/verification/{userId}`
- **Auth:** admin. **Request body:** `{ "verified": true }`. **Response 200:** `{ "data": { "id": "...", "isVerified": true } }`

### `GET /v1/admin/audit-logs`
- **Auth:** admin. **Query:** `?entityType=subscription`, `?sort=-createdAt` (default, only supported sort).
- **Response 200:** `{ "data": [ { "id": "...", "userId": "...", "action": "premium.grant", "entityType": "subscription", "entityId": "...", "oldData": null, "newData": {...}, "reason": "...", "createdAt": "..." } ] }` — `oldData`/`newData` are already-recorded JSON snapshots, passed through as-is (never re-shaped, since their whole purpose is to be a faithful historical record).

---

## 20. Out of scope for v1

Every item below is a **permanent** exclusion per existing, explicit business rules (`PROJECT_KNOWLEDGE.md`), not a "not built yet" gap this contract quietly assumes will be added in `v1.1`. Re-introducing any of these is an architecture decision for the project owner, not something an implementer should infer is implied by "the API needs to be complete":

- Group conversations, message editing/deletion, attachments/media in chat, blocking, typing indicators, online presence, rate limiting on messages (Text Messaging).
- Self-service Trial activation of any kind (Promotional Trial).
- A second payment/checkout system for Advertising or anything else (Billing).
- Multi-administrator role management, role grant/revoke endpoints of any kind (Single Administrator Rule, `CLAUDE.md`).
- Per-application user tables, auth systems, or profile stores of any kind (Single Source of Truth) — an application deployment calls `/v1`, it never gets its own copy of any Core entity.
- CPM/CPC/credit-ledger/usage-based advertising pricing strategies (only `fixed_duration` exists).
- Automatic/algorithmic fulfillment of `featured_slot` or Premium-duration reward redemptions (still deliberately unimplemented even internally — see §13).

---

## 21. Forward versioning notes

Not urgent, not blocking implementation of v1 — flagged here so a `/v2` doesn't have to rediscover them from scratch. The two open questions carried in this section since §8.8's first draft (localization mechanism, App Token vs. unified JWT) were resolved by Priority 8.9 — see §3 and §4.9 — and are removed from this list accordingly.

- **Multi-key sorting.** §4.4 deliberately limits sorting to one key. If a real need for compound sort emerges, it's an additive change (a new accepted `sort` value shape), not a breaking one.
- **Rate limiting.** `RATE_LIMITED` is defined in the error vocabulary (§4.5) but this document does not specify limits per endpoint — today's implementation has no rate limiting anywhere. Needs a policy decision, likely differing meaningfully between the Auth endpoints (§5, highest abuse risk) and everything else.
- **Reward fulfillment for `featured_slot`/Premium-duration.** §13's redemption endpoint already accounts for this (it only ever produces `pending_fulfillment`), but the *fulfillment-completion* endpoint for these two grant types doesn't exist in this contract at all yet (only Advertising Credit's does, §14) — this is not an oversight, it mirrors `PROJECT_KNOWLEDGE.md`'s own "remain open, unimplemented — deliberately." Adding them later is purely additive (new endpoints under whichever module ends up owning `featured_slot`), not a change to anything specified here.
- **Advertising pricing strategies.** `ad_pricing_strategies` is designed as an open vocabulary internally, but §14's endpoints only ever describe `fixed_duration` shapes (`durationDays`/`price`). A CPM/CPC strategy would need its own request/response shape addition — additive, not breaking, but worth flagging now rather than assuming `POST /v1/admin/advertising/prices`'s current shape silently generalizes.
- **JWT lifecycle specifics.** §3 now specifies the mechanism decisively (one unified RS256 JWT, `sub`/`azp`/`iat`/`exp`/`jti` claims, JWKS-verified, 15-minute access tokens, single-use rotating refresh tokens) — the mechanism itself is a closed decision, not open. What remains genuinely unspecified and safe to default sensibly at implementation time, not requiring further architectural sign-off: JWKS key-rotation cadence, and refresh-token absolute lifetime (vs. its single-use rotation, which *is* specified). Neither changes the shape of any endpoint in this document.
- **Application-impersonation trade-off (§3.2/§3.3).** Anonymous, public-browsing endpoints trust a client-supplied `?appId=` with no credential behind it. This is a deliberate, documented trade-off (the data behind it is already public), not an oversight — but if a future need arises to make even public per-application data provably tamper-proof per request (e.g. billing-adjacent public data), that would need a new, narrower mechanism scoped to just that endpoint, not a reintroduction of the withdrawn App Token concept wholesale.

---

## 22. API readiness review

Classified strictly as **Ready** (the design is complete and internally consistent enough to implement as specified) or **Requires adjustment before implementation** (a real open question remains that implementation would otherwise have to decide unilaterally).

| Module | Classification | Notes |
|---|---|---|
| Cross-cutting conventions (§4) | **Ready** | Envelope, pagination, filtering, sorting, errors, validation, and localization (§4.9, decided Priority 8.9) are each specified once and applied uniformly with no exceptions found. |
| Authentication & Application Identity (§3, §5) | **Ready** | Decided, Priority 8.9: one unified CORE-issued JWT (`Authorization: Bearer`) carrying both user (`sub`) and application (`azp`) identity together — no separate application-specific token. Remaining lifecycle specifics (JWKS rotation cadence, refresh-token absolute lifetime) are implementation defaults, not open architecture questions — see §21. |
| Profiles (§6) | **Ready** | Maps directly onto existing, stable `ProfileRow`/`PremiumProfileRow`/Identity Lock/RLS behavior. |
| Applications (§7) | **Ready** | Decided, Priority 8.9: one `visibility` state (`draft`/`coming_soon`/`active`/`archived`, migrated onto `applications.visibility`, replacing the retired `status`/`isEnabled` pair), `launchDate` (informational only, never auto-activating), `defaultLanguage` (§4.9 step 3) — all implemented in the database, admin UI, and server functions in this same pass (not just specified). |
| Capabilities (§8) | **Ready** | Direct mapping onto an already-built, already-admin-UI'd system (Priority 8.1/8.7). |
| Dashboard (§9) | **Ready** | Same as Capabilities — already-built, already-admin-UI'd (Priority 8.2/8.7); `my_applications`' visibility-driven rendering specified in §9, implemented in `DashboardPage.tsx` this same pass. |
| Premium (§10) | **Ready** | A thin pass-through of the already-built shared resolver (Priority 8.7). |
| Promotional Trial (§11) | **Ready** | Maps directly onto the already-built, already-admin-UI'd Priority 8.5 system. |
| Billing, Products & Purchases (§12) | **Ready** | Decided, Priority 8.10: "Product" (`GET /v1/products`) and "Purchase" (`GET /v1/me/purchases`, unifying entitlement + complete payment history — Product and Advertising campaign payments alike) are the `/v1` names for the existing, unchanged `subscription_plans`/`subscriptions`/`payments` model — one new `productType` column, no table renamed, no new payment system, `has_any_active_premium()` unchanged. Webhooks explicitly and correctly out of scope. |
| Rewards & Loyalty (§13) | **Ready**, with the fulfillment gap for `featured_slot`/Premium-duration noted in §21 as a known, pre-existing, deliberate gap — not something this contract needed to invent an answer for. |
| Advertising (§14) | **Ready** for everything implemented today (`fixed_duration` pricing); the open pricing-strategy question is forward-looking only (§21), not a blocker for implementing what's specified. |
| Share & Invite (§15) | **Ready** | Small, stable, already-built (Priority 7). |
| Messaging (§16) | **Ready** | Maps directly onto the already-built conversation/message model, including the newly-added `messaging` capability enforcement (Priority 8.7). |
| Notifications (§17) | **Ready** | Localization resolution decided (§4.9) — the open question this row carried in the 8.8 draft is closed. |
| Media uploads (§18) | **Ready** | Direct mapping onto the existing `MediaStorageProvider` adapter and its two Tier-2 call sites, plus one new Tier-1 admin endpoint. |
| Admin — cross-cutting (§19) | **Ready** | Every endpoint mirrors an already-implemented, already-audited admin server function. |

**Overall verdict: every module is Ready.** The two items flagged as open after Priority 8.8 (authentication/application-identity mechanism, localization resolution) were both explicitly decided in Priority 8.9 and are reflected throughout this document — Authentication (§3), Localization (§4.9), and Application Visibility (§7.1) in particular were substantially rewritten from the 8.8 draft, not merely annotated. Nothing in this document requires further architectural sign-off before implementation begins; the residual items in §21 are additive, forward-looking notes for a future version, not blockers for v1.
