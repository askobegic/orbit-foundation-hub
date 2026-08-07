# PROJECT_KNOWLEDGE

This document describes how the platform is **designed to work** — its business model, architecture, and the rules that govern it. It is the business and architecture knowledge of the project, not an implementation manual. For line-level implementation detail (folder structure, exact RLS policies, function names, env vars, build/deploy steps), see the [Technical Appendix](#technical-appendix) at the end of this document — nothing has been removed from the previous version of this file, only reorganized.

For development rules (how to work in this repo), see `CLAUDE.md`. For known defects and their status, see `PROJECT_AUDIT.md`.

---

## Platform Vision

The platform is a single ecosystem of branded consumer applications (`Bosanci.pro`, `Muzika.ba`, `Svadba.ba`, `Gradovi.ba`, `Ticketaria.io`, and future additions) that share one identity, one account system, and one billing engine. A person creates an account once and that account works, unmodified, across every application on the platform. Applications differ in branding, audience, and business features — they do not differ in who the user is, how they log in, what their profile contains, or how they pay.

This repository is the implementation of the **Core**: the shared identity, data, billing, and administration layer that every application is built on top of.

## Core Philosophy

**The Core is not an application.** It has no branding, no end-user business features, and no audience of its own beyond the people who use the applications built on it. Its only job is to provide shared services — reliably, consistently, and once — so that applications don't have to reinvent identity, billing, permissions, or communication.

Concretely, this means:
- The Core owns data; applications consume it.
- The Core enforces rules (via RLS and server-side checks); applications display outcomes.
- The Core changes rarely and carefully, because everything depends on it; applications can change often.
- If a piece of functionality would be useful to more than one application, it belongs in the Core — not copied into each application that needs it.

## Single Source of Truth

The Core is the single source of truth for every application on the platform. There is exactly one user database, one authentication system, one profile system, one subscription/billing engine, one permission system, and one notification system. Applications must never create their own copies of any of these.

Specifically, applications must never duplicate:
- **Authentication** — no per-app login/session systems.
- **Users / Accounts** — no per-app user tables.
- **Profiles** — no per-app copies of name, bio, avatar, etc.
- **Roles / Permissions** — no per-app admin or role systems.
- **Billing / Subscription Engine** — no per-app entitlement or payment records that shadow the Core's.
- **Notifications / Communication Center** — no per-app notification systems.
- **Admin functionality** — no per-app admin panels for shared data.

There is one user, one account, one authentication, one profile, and one shared database, used by every application. Where an application needs something application-specific (e.g. its own business data, its own UI), that data lives in the application's own domain, keyed against the Core's shared `user_id`/`app_id` — it is never a fork of Core data.

**Premium is a single, ecosystem-wide entitlement** — `hasAnyActivePremium(userId)` is the one and only "is this user Premium" check, and it is never scoped to a specific application (see Premium Model below; this supersedes the earlier per-`(user, application)` `is_user_premium()` design — that function has been removed from both the codebase and the database). `premium_profiles` (contact details/social links) remains one row per user, not per application — a user has one set of profile fields, but *whether those fields are publicly visible at all, and whether contact actions on them are usable*, is still gated per application via `user_app_settings` (see Premium Model → Public Profile Visibility & Contact Actions).

## Core Responsibilities

The Core owns, end-to-end:
- **Authentication** — who a person is, and how they prove it.
- **Profiles** — the shared identity record every application displays and reads.
- **Roles and Permissions** — who has elevated access, and to what.
- **Subscription Engine and Billing** — what a person has paid for, and for how long.
- **Notifications and the Communication Center** — how the platform (or an admin) reaches a user.
- **Admin** — the one place shared platform data is managed.
- **The applications registry** — what applications exist, their branding metadata, and their pricing plans.

## Application Responsibilities

An application is a branded product built on top of the Core. It is responsible for:
- Its own branding, look, and business features.
- Presenting Core-owned data (profile, entitlement, notifications) to its users.
- Its own application-specific data, scoped to its own `app_id`.

An application is explicitly **not** responsible for, and must not implement, anything listed under Core Responsibilities above. An application that needs to know "is this user premium," "is this user an admin," or "what is this user's name" asks the Core — it does not maintain its own answer to those questions.

## User Model

A person has exactly one identity on the platform: one `auth.users` record (Supabase Auth) and one corresponding `profiles` row, shared across every application. There is no concept of a "per-application user" — a `profiles.id` is the same identity everywhere the person uses the platform.

## Authentication

Authentication is a Core service. A user signs in once (via Google OAuth today) and that session is what every application relies on. The Core issues and validates the session; applications never independently verify identity. See the Technical Appendix for the specific client/server auth flow currently implemented.

**Multi-brand Google Sign-In.** Every application shows its own Google sign-in — its own consent-screen name/logo — while still authenticating into the one shared Supabase project, one `auth.users` table, and one `profiles` table. This works by registering one Google Cloud OAuth Client per application and adding all of their Client IDs to Supabase Auth's Google provider configuration; `signInWithIdToken` accepts a token from any of them, resolving to the same shared identity regardless of which application's Client ID produced it. Each application's Client ID is stored in the Core's Applications Registry (`applications.google_client_id`, not secret — see Technical Appendix); the Google Client Secret is never stored in the database, only in Supabase's own Auth provider configuration.

**Google authentication must use `signInWithIdToken()` exclusively — `signInWithOAuth()` is forbidden for Google, permanently.** This is a hard architectural constraint, not a style preference:
- Supabase's Google provider configuration holds exactly one Client Secret, but Supabase's "Client IDs" list is a global list shared across all of them — there is no per-application secret.
- `signInWithIdToken()` verifies the Google-issued ID token's signature (against Google's public keys) and checks its `aud` claim against the configured Client ID list. The Client Secret is never part of this verification — it plays no role in the ID token flow at all.
- `signInWithOAuth()` (the redirect/authorization-code flow) is different: Supabase's Auth server authenticates itself to Google's token endpoint using **Client ID + Client Secret together** to exchange the authorization code. With one shared secret and seven different applications' Google Clients (each with its own real secret), this exchange can only ever be correct for one application — every other application's redirect-based sign-in would silently authenticate incorrectly (or fail) if this flow were ever enabled for Google.
- `AuthContext.tsx` carries a `signInWithGoogle()` method for historical reasons; it is intentionally disabled and throws immediately if called, rather than being removed outright, specifically so the constraint stays visible and self-explanatory in code rather than silently absent. It must never be wired up to any UI.

**Application Resolver.** A Core-owned resolver determines which application the current request belongs to, and supplies that application's branding (name, logo, favicon, colors, Google Client ID) to every surface that needs it — login, onboarding, dashboard, public profile. Nothing in the Core hardcodes a specific application's name or branding. See the Technical Appendix for the resolution order.

**Core as a centralized Identity Provider.** Core runs on its own domain (`core.logid.pro`), separate from every application it authenticates for (`bosniafans.com`, `svadba.ba`, etc. — each fully independent, its own deployment, its own domain). Because of this, Core cannot determine which application a login belongs to from its own hostname — the hostname is always Core's, never the calling application's. Instead, an application identifies itself explicitly when it sends a user into the shared `/login` flow, via `?app=<slug>` (the application's own `slug`) — a "who is asking" signal, looked up once against the Applications Registry, with absolute priority over every other resolution path and no dependency on cookies or prior sessions (see the Technical Appendix for the exact mechanism and the still-supported hostname-based path, used when an application is visited on its own domain directly, e.g. Core's own admin/dashboard access at `core.logid.pro`). Deliberately not named `client_id`: that's an established OAuth/OIDC term for something else (an OAuth client identifier), and reusing it here would be confusing — `client_id` is still accepted as a deprecated fallback alias for `app`, but every current call site, and every future one, uses `app`. A login that specifies an explicit `app` completes by minting a CORE-issued `/v1` session (§ CORE Premium/API layer) for that application and redirecting back to that application's own registered domain with the token — Core never redirects a login to anywhere other than the domain the target application itself has registered. Adding a new application able to authenticate through Core requires only a new Applications Registry row; no code changes anywhere in this flow.

**Localization (Priority 8.9).** Any Core-owned text resolved from more than one stored locale (plan features, notification copy, and anything else shaped like a `_bs`/`_en`/`_de` column triplet) resolves to a single string, server-side, in one fixed order: **(1)** the caller's `Accept-Language` header, **(2)** the signed-in user's own `profiles.language` (skipped when there's no signed-in user), **(3)** the calling application's `applications.default_language` (nullable — contributes nothing when unset), **(4)** English, unconditionally, as the final fallback. This is a Core-wide rule, applied identically everywhere it's relevant — no surface invents its own resolution order. See `API_CONTRACT.md` → Cross-cutting conventions → Localization for the exact mechanism as it applies to the `/v1` API.

## Identity Lock

The identity provider (Google today) is the trusted source for a user's first name, last name, and profile photo. These are imported once, at first login, and become permanently locked the moment onboarding completes: no in-app "change name" or "change photo" feature exists for a standard user. If the provider supplied no photo, the user may upload exactly one, which then locks the same way. Locked fields render as plain identity information, never as editable form fields — including during onboarding itself, since the point of the lock is that the user never free-types their own name.

Future identity corrections (e.g. a user's legal name changes, or a locked value was wrong) are handled only through an administrator-controlled review process — not built yet, but the Core's Identity Service (see Technical Appendix) is the designated seam for it when it is.

**Email follows the opposite rule from name/photo (Priority 8.7).** `profiles.email` is not locked — it always resyncs from the auth identity (`auth.users.email`) on every login, rather than being imported once and frozen. This is deliberate: name/photo lock because the point is the user never free-types their own identity; email instead needs to keep tracking the live authentication identity, since it's the one identity field a provider can itself change (e.g. the user updates their email with Google) and the Core should never silently diverge from that. There is no admin override for it either — no in-app editing path exists anywhere, so the auth identity is the only source that can ever change it.

## Profiles

Every user has exactly one profile, owned by the Core, visible (in appropriate form) across every application. A profile carries identity fields (name, avatar, bio, username), locale preference, account status flags (`is_active`, `is_verified`), and account type (`user_type`). Applications read this profile; they do not maintain their own. First name, last name, and avatar are additionally subject to Identity Lock (above) once onboarding completes.

Premium contact details (phone, website, social links) live in a separate, still Core-owned, extended profile record — see Premium Model below.

## Roles

Platform-level roles (`admin`, `moderator`, `user`) are Core-owned and stored independently of the profile record, specifically so that a role can never be granted by editing profile data. A user can hold more than one role. Roles are platform-wide, not per-application — there is no such thing as "admin of one application only."

Operationally, the platform runs with a single administrator. There is no in-app role assignment, grant, or revoke interface, and none is planned as a Core feature — if a second administrator is ever needed, that role is granted manually via direct database access by the project owner. See `CLAUDE.md` → Single Administrator Rule.

## Permissions

Permission checks are enforced by the Core, on the server, every time — never inferred from client-supplied state and never trusted from a cached client value. A role grants a permission only when the server independently re-verifies it against the Core's role data at the moment of the privileged action.

## Premium Model — Global Premium Visibility & Contact System

**Premium is a single, ecosystem-wide entitlement (resolved 2026-07-30/31, superseding the original per-application design below).** A user purchases Premium once, through any application's pricing page, and that Premium status applies to the entire platform immediately — `BosniaFans`, `Muzika.ba`, `Svadba.ba`, `Gradovi.ba`, `Ticketaria.io`, and every future application. There is no such thing as "Premium on App A but Standard on App B." Applications never implement their own Premium check — they only ever ask the Core, via `hasAnyActivePremium()` (CORE Premium Service, below).

**What stays per-application:** the *billing record* of which plan was purchased under which application (`subscriptions.app_id`, `subscription_plans` pricing) remains scoped per `(user, application)` — pricing, currency, and duration can still legitimately differ by application, and admin tooling still grants/revokes a specific subscription row. What no longer varies per application is the resulting *permission* — once any one of those subscription rows is active, the user is Premium everywhere, full stop.

**Profile editing is never Premium-gated.** Every user — Standard or Premium — can edit every field of their own profile (bio, professions, phone, WhatsApp, Viber, email, website, and every social link) at any time. Premium affects only what's exposed *publicly* and who may *contact* the profile owner — never what can be entered privately in the dashboard.

### Public Profile Visibility

The public profile (`/u/:username`) is one shared page reused across every application (resolved via the Application Resolver — see Authentication below), not a per-application page.

- **Standard users expose only: profile photo, full name, city, country.** Nothing else — no `@username`, no tier pill, no professions, no contact information. This is the complete, exhaustive list; see Standard Card below.
- **Premium users expose all of their entered profile information** — professions and every Contact Action the owner has filled in (see Contact Actions below) — subject to each field's own existing `_public` visibility flag where one exists (phone/WhatsApp/email/website), and subject to the page-level `is_visible` gate below.
- **Viewing a public profile is never a Premium feature.** Any visitor — authenticated or anonymous, Standard or Premium — may open and browse any Premium owner's complete public profile. Only *contacting* that owner is Premium-gated (see Contact Actions below).

### `is_visible` — per-application profile presence

`user_app_settings.is_visible` (one row per `(user, application)`, user-controlled from `/dashboard/settings`) answers exactly one question: **does this user have a public profile on this application at all?** It is not a Premium/Standard downgrade switch and never changes which card variant renders.

- If `is_visible = true` for the application currently being browsed (resolved via the Application Resolver), the profile renders normally — Standard or Premium, whichever the owner's global Premium status says.
- If `is_visible = false` for that application, the application must behave exactly as if no public profile exists there: `src/routes/u.$username.tsx` renders its existing not-found state (the same one shown for a nonexistent username), never a downgraded Standard card. This is enforced once, at the route level, before `ProfileCard` ever renders — `ProfileCard` itself does not read `is_visible` for this purpose at all.
- Missing row (never toggled) defaults to visible (`true`), matching the row every user is seeded with at onboarding.

### Contact Actions

Contacting a profile owner is a Premium-only privilege, covering every current and future contact method uniformly: **Call, WhatsApp, Viber, Email, Website, Facebook, Instagram, TikTok, YouTube, LinkedIn, X, and Send Message (internal messaging).** There is exactly one gating rule for all of them, applied identically — no per-method exception.

**Eligibility (`canContact`) — all three must hold:**
1. The profile owner has global Premium (`hasAnyActivePremium(owner.id)`).
2. The visitor has global Premium (`hasAnyActivePremium(visitor.id)`) — an unauthenticated or Standard visitor never qualifies.
3. The owner has not turned off contact for the application currently being browsed (`user_app_settings.is_contactable`, below).

**It does not matter which application either side's Premium was purchased under, or which application granted it** — Premium is ecosystem-wide, so a member who bought Premium on `Muzika.ba` may contact a member who bought Premium on `Svadba.ba`, evaluated live at the moment of the click (never cached).

**Rendering rule — browsable but not actionable:** every Contact Action the owner has entered (and, where applicable, marked `_public`) is always visible to any visitor as long as `is_contactable` is true for the application being browsed — a Standard visitor can see that a channel exists. What differs is the *label*:
- If `canContact` is true: the real value (the actual phone number, email address, website URL, or social link) and the method's normal icon.
- If `canContact` is false: a generic locked label naming only the method (e.g. "WhatsApp", "Website") with a lock icon — no part of the real value is ever revealed to an ineligible visitor.

Clicking always attempts the same gated action: if `canContact` is true, it performs the action (opens `wa.me`/`viber:`/`tel:`/`mailto:`/the external link, or — for Send Message — shows the messaging-foundation notice below); if false, it opens the upgrade dialog instead of navigating anywhere:

> **Premium feature**
> Only Premium members can contact Premium members. Upgrade your account to continue.
> `[Upgrade]` `[Close]`

"Upgrade" routes to `/pricing`; "Close" dismisses with no further action.

### `is_contactable` — per-application contact toggle

`user_app_settings.is_contactable` (same table/row as `is_visible`, independently toggleable) answers: **does this user accept contact on this application?** Unlike `is_visible`, this doesn't hide the whole profile — it hides only the Contact Actions block entirely (all methods at once, not individually) when false for the application currently being browsed. Missing row defaults to `true`, matching the onboarding-seeded default.

### "Public profile on"

Replaces the earlier "Premium on" concept. Since Premium is no longer application-scoped, "which applications is this person Premium on" is no longer a meaningful question — the badge row instead answers **"on which applications does this person have a visible public profile,"** via `getVisibleApplications(userId)` (CORE Premium Service, below), sourced from `is_visible = true` rows, not from `subscriptions`.

- Only rendered on the Premium Card (Standard owners never show this row, matching Standard Card's exhaustive content list below).
- Ordered by `applications.sort_order`, same fallback logo/initial-tile treatment as elsewhere in this codebase.
- Each badge is clickable: if the *target* application also has `is_visible = true` for this owner, it links to that application's own `/u/:username` (this is the same shared route/component, just served from that application's domain); otherwise it links to the target application's homepage. This is the same click-through rule stated once, not re-derived per caller.

### CORE Premium Service

The single, shared place Premium status is ever checked from (`src/lib/premium.ts`) — components must never issue their own ad hoc RPC/subscription queries. Two methods:
- `hasAnyActivePremium(userId)` — TRUE if the user holds an active Premium subscription on *any* CORE application, **or** an active Promotional Trial (Priority 8.5 — see Promotional Trial above). The one and only "is this user Premium" check, used for the Profile Card's tier, Contact Actions eligibility, and every dashboard Premium badge.
- `getVisibleApplications(userId)` — the applications where the user currently has `is_visible = true`, ordered by `applications.sort_order`. Backs "Public profile on" above.

Both are backed by dedicated SQL functions (`has_any_active_premium`, `get_visible_application_ids`) using the exact same "active" predicate (`status = 'active' AND expires_at > now()`) that every other subscription-status check in this codebase uses (see `src/lib/subscription.ts`) — `has_any_active_premium` applies that predicate to `subscriptions` and, independently (`OR`), to `promotional_trials`.

**Removed:** `isUserPremium(userId, appId)` and its backing `is_user_premium(_user_id, _app_id)` SQL function no longer exist — the per-application Premium check they implemented has no meaning under the Global Premium model and had zero remaining call sites. `get_premium_application_ids()` (the SQL function that backed the old "Premium on" list) is left in place, unused, rather than dropped, since nothing requested its removal.

**Premium Status Resolver (`src/lib/premium.server.ts`, Priority 8.7)** — the server-only, bulk-capable sibling to the client-callable `hasAnyActivePremium()` above. Every admin/bulk consumer (`adminListUsers`, `adminOverviewStats`, `adminSendNotification`, `adminListVerificationRequests` in `admin.functions.ts`, and any future `/v1` API endpoint) must resolve Premium status through `resolvePremiumStatusBulk(supabaseAdmin, userIds?)` / `resolvePremiumStatus(supabaseAdmin, userId)` instead of re-querying `subscriptions` directly — the exact "two places compute the same answer differently" pattern `CLAUDE.md` calls a defect (see `PROJECT_AUDIT.md` → `A-5`). Unlike the boolean `hasAnyActivePremium()`, this exposes the complete state — `{ active, source: "subscription" | "trial" | null, expiresAt }` — since a bulk/admin consumer (and a future API client) needs to know not just whether someone is Premium but why and until when. Two queries total regardless of how many users are resolved (one against `subscriptions`, one against `promotional_trials`), never N+1. When a user has both an active subscription and an active trial, the subscription is reported as the source, since it's the paid entitlement (see Promotional Trial below for why the two can never conflict).

## Profile Card & Messaging System

A CORE shared UI component (`ProfileCard`), rendered at the public profile route (`/u/:username`) and reused, unmodified, by every application — BosniaFans, Muzika.ba, Svadba.ba, Gradovi.ba, Bosanci.info, and every future application. Layout, structure, and behavior are identical everywhere; only per-request branding (the current application's cover image/logo, resolved via the Application Resolver) and the profile owner's own Premium data vary. No application may fork this component or introduce an application-specific layout variant — a variant request is a signal to extend the shared component, not to branch it.

**Reference design:** an approved visual reference (Desktop/Mobile × Standard/Premium) is the binding source for exact layout, spacing, and copy. Where this specification could not be resolved from that reference alone, it says so explicitly rather than inventing a detail.

### Which card renders

A profile owner's card is the **Premium Card** if and only if `hasAnyActivePremium(profile.id)` is true (CORE Premium Service, see Premium Model above) — not a stored flag, not re-derived inline. Otherwise, the **Standard Card** renders. This is a property of the profile owner alone; it does not depend on which application's domain the visitor is browsing from.

### Standard Card — content (exhaustive)

Cover image, avatar, full name, city/country, "Share Profile", "Invite a Friend". Nothing else. Explicitly excluded: `@username`, any tier pill, "Public profile on" badges, professions, bio, any Contact Action, advertising, explanatory copy about Premium. Excluded elements are absent entirely — never rendered disabled or greyed out. See Premium Model → Public Profile Visibility for the business rule this implements.

### Premium Card — content (exhaustive)

Cover image, avatar (with a small badge indicator), a "Premium Member" pill, name, `@username`, location, main profession, additional professions, a "Public profile on" row, and the full Contact Actions block (Call, WhatsApp, Viber, Email, Website, Facebook, Instagram, TikTok, YouTube, LinkedIn, X, "Send Message" — see Premium Model → Contact Actions for the eligibility/locked-label rule that governs every one of them identically), "Share Profile", "Invite a Friend".

**"Public profile on"** and **Contact Actions** are both fully specified under Premium Model above (`"Public profile on"`, `Contact Actions`, `is_visible`, `is_contactable`) — not restated here, so there is exactly one description of each rule in this document.

### Text Messaging (Priority 7 — implemented)

One-on-one, text-only conversations, built on the foundation Priority 6 added (`src/types/messaging.ts`; `src/lib/conversation.functions.ts` and `src/lib/message.functions.ts`, renamed from the earlier `.service.ts` foundation files to match this repository's `*.functions.ts` server-function convention).

**Conversations**
- One-on-one only. No group conversations — a permanent design constraint, documented the same way the Single Administrator Rule is: re-state this in any future proposal rather than treating it as a gap to eventually fill.
- At most one conversation per unordered pair of users, canonically ordered (`user_a_id` always the lexicographically smaller uuid) so `UNIQUE(user_a_id, user_b_id)` alone enforces this. It comes into existence the moment either party sends a first message — no separate "conversation request" object, no approval/pending state: if `getOrCreateConversation` succeeds, the first message goes directly into the inbox.
- **No per-conversation application identity.** A conversation is not "owned" by whichever application it started from — Premium is ecosystem-wide (see Premium Model above), so the Inbox is a single, Core-wide list regardless of which application's domain a visitor is currently browsing from. The UI simply inherits whichever application is currently resolved (`useApplication()`) for branding, the same as every other Core-shared page — no `app_id` column exists on `conversations`, and no per-conversation "started from" badge is shown.

**Who can initiate — eligibility checked once, at creation, never again**
- A conversation may only be created if the initiator has global Premium, the recipient has global Premium, **and** the recipient's `is_contactable` is true for whichever application is current at that moment (`getOrCreateConversation` in `conversation.functions.ts` re-verifies all three server-side, regardless of what the client already checked via the Profile Card's `canContact`).
- **`messaging` is a Capability (Priority 8.7)** — `getOrCreateConversation` also checks `getApplicationCapabilities()` against the initiator's current application, exactly like every other module's Capability gating (see Capabilities below), rejecting creation if disabled. Checked at the same point as the Premium/`is_contactable` checks above, so it follows the identical "checked once, at creation, never re-checked afterward" rule — disabling `messaging` for an application later does not affect a conversation that already exists. The Sidebar's Messages nav item, the `/dashboard/messages` inbox page, and the Profile Card's "Send Message" action are all gated the same way (via the `messaging` Dashboard Widget / a direct capability check), matching the treatment Rewards/Advertising already had.
- **Once a conversation exists, this check never runs again.** Sending a further message only requires being a participant in that conversation — not re-verified Premium, not re-verified `is_contactable`, not re-verified the `messaging` capability. A conversation keeps working even if one side's global Premium later lapses, or the application later disables messaging; this is a deliberate simplification (message-sending eligibility is participant-only, not re-derived per message), not an oversight.
- The system's one asymmetry: a Standard recipient who received a first message gains full read/reply ability in that one thread — this grants no ability to start any other conversation, since only Premium members can create new ones.
- Only entry point: the Profile Card's "Send Message" button (gated by the existing Contact Actions rule). No standalone "start a conversation" UI exists.

**Hiding a conversation (user-level only)**
- A user may hide a conversation from their own inbox (`hideConversation`, setting `hidden_by_a_at`/`hidden_by_b_at` — whichever column matches their side of the pair — to the current time). This affects only that user's own `getConversations` result; the other participant is unaffected.
- Automatically restored the moment a new message arrives — `getConversations` filters a hidden conversation out only while `last_message_at <= hidden_at`; a newer message moves `last_message_at` past that timestamp and the conversation reappears with no separate "unhide" action or column reset.
- Messages are never deleted by hiding — this only affects inbox visibility for the user who hid it.

**Inbox**
- One row per conversation: the other participant's name/avatar (from `profiles_public`), last message preview, relative timestamp, an unread-count badge for that thread. No online/offline indicator — presence is a new technical capability this codebase doesn't have (only `postgres_changes` change-feed subscriptions, as `NotificationBell` already uses) and wasn't approved for this phase.
- Sort order: most-recently-active conversation first (`last_message_at DESC`), the same convention already used throughout this codebase.
- Unread count per conversation and per-message read state are both computed live from `messages.read_at` (`sender_id != viewer AND read_at IS NULL`) — never a separately stored/cached counter, to avoid the exact kind of drift-prone duplicate state `profiles.user_type` turned out to be.

**Chat**
- Plain text only, immutable once sent — **no edit or delete of individual messages**.
- Each message shows a sender-distinguished bubble, a timestamp, and (on the sender's own outgoing messages) a sent/read indicator derived purely from `read_at` — a successful insert already means delivered, so there's no separate "delivered" state to track.
- "Read" triggers the moment the recipient opens the thread (`markConversationRead`, called on mount and on every realtime message event while the thread is open) — resolves the "open thread vs. actively viewing" question the earlier specification left open, in favor of the simpler option.
- 2,000-character cap per message, enforced both client-side (`ChatComposer`) and via a database `CHECK` constraint — the same two-layer pattern already established for URL validation (`PROJECT_AUDIT.md` → `CO-1`).

**Explicitly not supported** (a permanent constraint, not a phase-one gap): images, video, audio, voice messages, GIFs, stickers, reactions, file attachments, voice/video calls, group conversations, message editing/deletion, blocking, rate limiting. Text only, exactly as scoped for this phase.

**Blocking is not implemented.** No `blocked_users` table exists — deferred entirely, not even as unused schema, per an explicit decision to keep this phase's scope minimal.

### Notifications (message-related)

Reuses the existing, single, shared `notifications` table and the existing `NotificationBell` realtime pattern (the Core's one notification system, per Single Source of Truth) — there is no separate, parallel messaging-notification system. `sendMessage` inserts a `notifications` row for the recipient exactly the way Premium activation already inserts one alongside a `subscriptions` write (see Billing); `app_id` is left `null` (no per-conversation application identity to attach it to — see above). The unread badge count is the same existing `is_read = false` computation `NotificationBell` already performs — a message notification is just another row in the same table, not a second counter. `PROJECT_AUDIT.md` → `DA-2` already tracks a cap/count bug in this exact shared mechanism; message-notification volume makes that bug more visible, not new — it should still be fixed as its own item, not worked around here.

### Share Profile / Invite a Friend

Two related but distinct features, both reusing the same underlying copy-link/native-share mechanics (Web Share API where available, falling back to copy+toast) rather than each implementing it separately:
- **"Share Profile"** (Profile Card's compact button, `handleShareProfile` in `ProfileCard.tsx`) — always the individual `/u/:username` URL (see Profiles). Unaffected by the templates below; sharing a specific profile is a different concern from application-level marketing copy.
- **The Dashboard's Share & Invite widget** (`ShareAndInvite.tsx`) — two halves, each configurable per application (`share_invite_templates`, admin-editable from `/admin/applications`'s "Share & Invite" section, same Field/Card conventions as the rest of that page):
  - **Share is application-focused, not personal.** `share_title`/`share_description`/`share_url` are fixed admin-authored marketing copy shown identically regardless of which user is sharing — never derived from the sharing user's own profile. Every field is nullable; a blank field falls back to a locale-aware i18n default (`share.defaultShareTitle`/`share.defaultShareDescription`) or, for the URL, the current application's own domain — there is no server-side hardcoded English fallback, keeping the substitution entirely client-side.
  - **Invite is personal.** `invite_template` is admin-authored free text containing the literal placeholders `{user_name}` and `{invite_link}`, substituted client-side: `{user_name}` is the inviting user's own public display name (first + last name, the same derivation `ProfileCard.tsx` uses for its own display name, falling back to `@username`), `{invite_link}` is the existing `?ref=<username>` referral link unchanged from Priority 8.3 (`referral.ts`/`linkReferral`) — this is genuinely wired to the reward system now, not a placeholder feature, so the older "referral program coming soon" notice was removed as stale copy.
  - `getShareInviteConfig(appId)` (`src/lib/share-invite.functions.ts`) is the one place this resolves from; a single row per application (`share_invite_templates`, `app_id UNIQUE`), not a global-default-plus-override pair like `ad_config`/`ad_application_settings` — Share is inherently application-specific (a Share URL only ever makes sense for one application), so there's no meaningful platform-wide default to fall back to beyond the client's own i18n strings.

## Subscription Engine

The Core owns the subscription engine: what a user has purchased, for which application, at what price, for how long. Every application defines its own pricing plans (duration, price, currency) within the Core's shared `subscription_plans`/`subscriptions` model — pricing and duration are application-specific, but the engine that tracks and enforces entitlement is one shared system, not one per application.

A subscription always belongs to a specific `(user, application)` pair. See the Technical Appendix for the current schema and known correctness issues in how subscriptions are created/renewed (`PROJECT_AUDIT.md` → `DB-2`).

## Products & Purchases (Priority 8.10)

**Architecture review conclusion:** the Subscription Engine above already *is* a Products & Purchases system in substance, not just in spirit. This platform has no recurring/auto-renewing billing anywhere — every "subscription" purchase is already, mechanically, a fixed-duration, one-time payment (a Stripe/PayPal Payment Link, not a Stripe Subscription object); `subscription_plans` is already an admin-priced, purchasable catalog item; `subscriptions` already is the resulting purchase/entitlement record; `payments` already is the provider transaction ledger (amount, currency, status, Stripe/PayPal transaction id). Evolving the terminology to Products & Purchases needed exactly **one new column**, not a redesign, not a table rename, and not a second billing/purchase system:

- **`subscription_plans.product_type`** (`subscription` | `promotion` | `one_time`, default `subscription`) — an admin-facing classification of what kind of purchasable item a plan represents. A **Product** is any row in this table, regardless of type: "Premium Member," "Premium Business," "Featured Business" (BosniaFans), "Premium Vendor," "Featured Vendor" (Svadba), "Premium Artist" (Muzika) are all just differently-named, differently-priced Products, configured the same way, through the same admin form, on the same per-application `/admin/applications` page (now with a "Products" heading in place of the previous unlabeled plan list).
- **Every Product still creates a normal `subscriptions` row and still grants the same one global Premium entitlement when active, via `has_any_active_premium()`, regardless of `product_type` or display name.** This is a deliberate, explicit scope boundary, not an oversight: introducing genuinely *distinct* per-product entitlements (e.g., a "Featured Business" purchase unlocking something a "Premium Member" purchase does not — a featured listing badge, a different visibility tier) would be a new business rule requiring its own explicit approval, exactly like `reward_catalog`'s `featured_slot` fulfillment type already documented as "remains open, unimplemented — deliberately" (see Rewards & Loyalty above). This review evolves *terminology and admin ergonomics*, not *what Premium means* — the Global Premium Visibility & Contact System (Premium Model, above) is unchanged and was not reopened.
- **Tables deliberately not renamed.** `subscription_plans`, `subscriptions`, and `payments` keep their existing names at the database level — a rename is a cheap Postgres operation in isolation, but every payment-webhook, admin function, and dashboard call site referencing these names by string would need touching for zero functional gain, directly against "avoid unnecessary breaking changes." "Products" and "Purchases" are the *conceptual* names used in the Admin UI, the Dashboard, and `API_CONTRACT.md` — not new tables.
- **`payments` already is the reference/transaction-history ledger this concept needs.** CORE never stores invoices — Stripe and PayPal remain the systems of record for those — `payments` only ever stores what it already stored: provider, transaction id, amount, currency, status. Nothing new was added to it.

**Purchases (Dashboard, user-facing).** `/dashboard/purchases` (`dashboard.purchases.tsx`, replacing the earlier `/dashboard/subscriptions` page and absorbing the Dashboard's separate "Payment History" widget's "View all" destination, which previously pointed nowhere) is the one Dashboard section showing a user's complete purchase/payment history across every application and across every purchase source — active and expired Products (from `subscriptions`, joined with `subscription_plans`/`applications`) and the **full** payment/transaction ledger (from `payments` — amount, currency, provider, transaction id, status). No new query pattern — this is the same queries the old subscriptions page and the Dashboard payment-history widget already ran, now presented together on one page instead of split across two disconnected views.

**Follow-up refinement: the payment-history half of this page also includes Advertising campaign purchases, by explicit instruction.** A successful campaign purchase is still a purchase — a user should have one complete payment history, not two, regardless of whether a given payment was for a Product or an Advertising campaign. The query that previously excluded `payments.campaign_id IS NOT NULL` now includes it, additionally joining `ad_campaigns.title` so a campaign payment is labeled distinctly ("Advertising Campaign: <title>") rather than showing as an unexplained charge. **This widens only the read-only history view — it does not touch Advertising's architecture.** `/dashboard/advertising` (self-serve campaign creation/management) and `/admin/advertising` (placements, pricing, moderation, trusted advertisers) remain entirely separate, global, and untouched; Advertising is still not a Product, still has no admin surface merged into `/admin/applications`, and still uses the exact same billing primitives it always did (`payments.campaign_id`, no second payment system). Only the *history a user can see about themselves* was widened, not who manages what.

See `API_CONTRACT.md` → Billing, Products & Purchases for the `/v1` contract surface (`GET /v1/products`, `GET /v1/me/purchases` — now including Advertising campaign payments in its `payments` array) built on this same, unchanged underlying data.

## Promotional Trial (Priority 8.5)

**There is no automatic Trial.** Registration always creates a Standard account — nothing in this codebase activates a Trial as a side effect of signing up, logging in, or loading the dashboard. This replaces the earlier model (a 7-day trial auto-granted the first time a user with no subscription loaded the Dashboard), which is now considered a defect, not a variant: an unconditional "give every new user X days" behavior is exactly what this architecture forbids going forward.

- **Promotional Trial is the only Trial model**, and it is granted, never self-activated. A Trial exists only because an explicitly defined business rule created it — `trial_sources` (an admin-extensible registry, same shape as `capability_definitions`/`reward_fulfillment_types`) is that fixed set of rules: `admin_grant` (implemented), `promotional_invitation` and `reward_redemption` (seeded vocabulary — no caller yet, exactly like `reward_action_rules`' `advertising_purchase` was seeded before Advertising existed to call it). A future source is added by registering its key here and calling the same `grantPromotionalTrial()` (`src/lib/trial.server.ts`) every other source will call — never by adding a new table, column, or bespoke grant path.
- **Administrator-controlled today.** `/admin/trials` grants a Trial to any user (preset or custom duration, bounded by `trial_policy.max_duration_days`), ends one immediately, revokes one, and shows full Trial history — every action audited via `writeAuditLog()`, with an optional reason.
- **A user cannot have multiple active Trials** — enforced at the database (a partial unique index on `promotional_trials(user_id) WHERE status = 'active'`), not only in application code, so even a race between two concurrent grant attempts can't produce two active trials for the same user.
- **Trial never extends automatically.** Granting a new trial while one is already active is rejected outright (`already_has_active_trial`) — a longer trial requires ending/revoking the current one first and granting a fresh one, an explicit administrative decision every time, never an automatic top-up.
- **Promotional Trial and Premium subscription never conflict, because they're independent sources of the same access, not the same record.** A Trial is its own table (`promotional_trials`), never a `subscriptions` row — the old model's fatal flaw was representing a trial as a subscription with a magic `stripe_payment_id = 'trial_7days'` sentinel, which meant a trial and a real purchase could collide on the same `UNIQUE(user_id, app_id)` slot. `has_any_active_premium()` (the one shared "is this user Premium" check — see Premium Model) now checks both sources independently (`OR`, not a merge): an active subscription, an active Promotional Trial, or both — either is sufficient, and having both is harmless. When a Trial ends (naturally via `expires_at`, or via an admin's End/Revoke), the user's access is decided by that same check against whatever remains — back to Standard unless an active paid subscription still exists. Time-based expiry only, exactly like `subscriptions`: neither table has or needs a cron job to flip a status column when `expires_at` passes.
- **Configuration-First**: the offered quick-select durations and the maximum any single trial may run (`trial_policy`, key/value like `ad_config`/`reward_config`) are admin-editable data, not TypeScript constants — changing them, or adding a duration option, never needs a deployment.

## Billing

Billing (payment processing, payment records, invoices) is a Core service backed by Stripe and PayPal. Payment webhooks are the Core's responsibility — they verify the payment provider's signature, verify what was actually paid against what plan was referenced, and are the only place a subscription is granted as a result of a real payment (never the redirect/success page). Applications never process payments themselves or maintain their own payment records.

The `(user_id, app_id, plan_id)` reference threaded through Stripe's `client_reference_id` and PayPal's `custom_id` is generated server-side and HMAC-signed (`createPaymentReference`, `src/lib/payment-reference.server.ts` — `PAYMENT_REF_SECRET`) rather than built as a plain string on the client: the `user_id` comes from the authenticated session, never client input, and both webhooks verify the signature (`verifyPaymentReference`, the single shared verifier for both providers) before granting anything. See `PROJECT_AUDIT.md` → `SE-7`.

## Notifications

Notifications are a Core service. A notification belongs to a user, is optionally scoped to an application, and is delivered/read through one shared notification system (storage, UI, and realtime delivery) — not a per-application inbox.

## Communication Center

Outbound platform communication (broadcast messages to all users, to premium users, or to a single user) originates from one place: the Core's admin Communication Center. This is the only mechanism by which the platform reaches users in bulk; applications do not send their own broadcast notifications.

## Shared Components

Shared UI building blocks (design system primitives, layout, form controls) that are useful across more than one surface belong in the Core's shared component library rather than being reimplemented per feature or per application. What's currently reusable vs. feature-specific in this repository's UI is documented in the Technical Appendix.

## Shared Database

There is one database for the entire platform (one Supabase project, one Postgres schema). Every application reads and writes through this same database, scoped by `app_id` where data is application-specific, and governed by Row-Level Security as the enforcement boundary for who can read or write what. There is no per-application database or schema fork.

## Admin

Administration is a Core-only surface. There is one admin panel, covering applications, users, payments, communication, and verification — not a separate admin panel per application. Admin access is a platform-wide role (see Roles), re-verified server-side on every privileged action, independent of any client-side gating.

## API

Applications integrate with the Core exclusively through the Core's API surface: authenticated server functions for privileged operations, and public webhook routes for payment-provider callbacks. This is the only sanctioned integration point — an application does not reach into the Core's database directly outside of what RLS and the Core's API expose.

## Future Scalability

The platform is designed so that adding a new application means adding a new row to the Core's `applications` registry (and its pricing plans) — not adding new identity, auth, billing, or permission code. A new application should be able to onboard onto the Core by:
- Registering itself in the applications registry (branding, domain, visibility).
- Defining its own subscription plans, scoped to its own `app_id`.
- Reading the shared user/profile/entitlement data the Core already provides.

Any design that would require a new application to bring its own auth, its own user table, or its own billing logic is, by definition, not following this architecture and should be treated as a deviation to resolve, not a pattern to repeat.

## Application Visibility (Priority 8.9)

Every application has exactly **one** visibility state — `draft`, `coming_soon`, `active`, or `archived` (`applications.visibility`) — replacing the earlier `status` (`active`/`coming_soon`/`archived`) and `is_enabled` (boolean) pair, two independently-settable flags that could contradict each other (a row could be `status = 'active'` and `is_enabled = false` simultaneously, with no single field answering "is this application visible"). Lifecycle management is independent of development status: an application under active development can sit in `draft` indefinitely, get a public teaser as `coming_soon`, launch by moving to `active`, and eventually retire to `archived` — all without ever being deleted (soft lifecycle, the same convention every Priority 8 registry follows).

- **`draft`** — hidden from every normal user; visible only to administrators (the admin panel's own application picker, e.g. `/admin/advertising`'s or `/admin/rewards`'s application selector, always shows every visibility value, since an admin must be able to configure a not-yet-launched application's capabilities/pricing/plans before it goes live).
- **`coming_soon`** — visible on the Dashboard's "My Applications," clearly marked, not enterable (rendered disabled/grayscale, same treatment the earlier `is_enabled = false` state already had).
- **`active`** — fully visible and accessible, the normal case.
- **`archived`** — hidden from normal users, same as `draft`, but never deleted — existing subscriptions/payments/audit history referencing it continue to resolve its name normally.

**`launch_date` is informational only.** It exists to display an optional release date next to a `coming_soon` application and to allow a future countdown/announcement UI — it is never read by any activation logic anywhere in this codebase (no cron infrastructure exists here, matching the same standing convention Rewards/Advertising/Promotional Trial already follow). **Moving an application from `coming_soon` to `active` is always a separate, explicit administrator action** (`adminSetApplicationVisibility`, `/admin/applications`'s "Update visibility" control) — nothing in this codebase ever flips visibility automatically based on `launch_date` or any other signal, matching the "no automatic activation" rule Priority 8.5 already established for Promotional Trial.

**Enforcement boundary, deliberately scoped:** visibility filtering happens at the query/business-logic layer (the Dashboard's own applications query, and the future `/v1 GET /v1/applications` — `API_CONTRACT.md` → Applications), not by narrowing the `applications` table's RLS `SELECT` policy — see RLS policies → Applications below for why (the Application Resolver must still be able to resolve a `draft` application's branding when hit directly on its own real domain, so an admin can preview/configure it before launch).

**No application name is ever hardcoded** in any visibility-aware surface — the Dashboard's "My Applications" widget and the future Applications API both render whatever the registry currently contains, filtered generically by `visibility`, with zero code changes required when a new application is added (`Future Scalability`, above).

## Capabilities (Priority 8 — Final CORE Architecture)

**CORE never branches on which application is calling it by name.** No code path anywhere in this repository may read as "if BosniaFans" / "if Ticketaria" — the mechanism that makes this enforceable rather than aspirational is **capabilities**: a controlled, admin-extensible vocabulary of feature keys (`messaging`, `advertising`, `rewards`, `featured_business`, `featured_event`, `business_directory`, `events`, `discover`, `community`, and any future key an admin registers), each independently enabled or disabled per application.

**Mandatory features are not capabilities (Priority 8.7).** `premium` was originally seeded as a capability key but was never actually gated by anything (Billing/Premium is a mandatory Core Responsibility, not an optional module — see Core Responsibilities above) — it has been **archived** in `capability_definitions` (soft-lifecycle, not deleted) rather than left as a togglable-looking entry that silently did nothing. `messaging`, by contrast, is a genuinely optional module and is now genuinely enforced (see Text Messaging above). The rule going forward: a feature only belongs in this vocabulary if some module actually checks it — a capability nobody reads is a defect, not a placeholder.

- `capability_definitions` is the vocabulary itself — `key` (stable, e.g. `advertising`), `label`, `displayOrder`, and a soft lifecycle (`enabled`/`archived`, never a hard delete once a capability may be referenced elsewhere). New capabilities are added by an admin inserting a row here — **never by a deployment**, which is the concrete mechanism behind "administrator can change business rules without code changes."
- `application_capabilities` is the per-application on/off switch — one row per `(app, capability)` pair. An application's enabled set is publicly readable (the calling application itself, and cross-application UI, both need it without an admin session) but only admin-writable.
- **A capability being disabled for an application must disable that feature completely and consistently** — dashboard widget, navigation entry, the ability to create new records, the API's own responses, and any background processing all have to agree. This is each *consuming* module's own responsibility (the capability flag is the single source of truth every one of those surfaces reads from), not something `capability_definitions`/`application_capabilities` themselves enforce structurally — there is no automatic mechanism that hides a dashboard widget just because a database row changed; every module that has a capability-gated surface must actually check it. This is a correctness obligation on every future module, called out here so it isn't missed silently as new modules are added.
- A definition being **archived** always wins over an application's own `enabled=true` row — archiving a capability platform-wide takes precedence over any per-application setting.

**CORE Capabilities Service** (`src/lib/capabilities.functions.ts`): `getApplicationCapabilities(appId)` is the one and only place an enabled-capability set is ever read from — components/modules must never query `application_capabilities` directly. Admin-only: `adminListCapabilityDefinitions`, `adminUpsertCapabilityDefinition`, `adminSetApplicationCapability`, `adminListApplicationCapabilities` — all configurable through `/admin/capabilities` (Priority 8.7); no SQL is required for normal administration.

## Dashboard Widget Modularity (Priority 8.2)

The CORE Dashboard (`/dashboard`) is composed of independent, admin-toggleable widgets rather than a fixed set of sections every application always sees identically. Same registry + per-application-override shape as Capabilities, deliberately reused rather than inventing a second pattern for the same underlying problem ("is X visible for this application, globally or by override"):

- `dashboard_widgets` — the widget registry (`key`, `label`, `displayOrder`, soft-lifecycle `enabled`/`archived`), seeded with the six sections that already exist on the dashboard today: `trial_banner`, `my_applications`, `active_subscription`, `payment_history`, `quick_links`, `share_and_invite`. The identity/profile header and the trust-badge footer are not widgets — they're permanent chrome, not optional sections.
- `dashboard_widget_settings` — per-application override (`widget_key`, `app_id`, `enabled`); a missing row means "use the registry's global default," exactly like `application_capabilities`.
- **`requiresCapability`** (nullable, on the registry row): a widget can declare that it only makes sense when a given capability is enabled for the application — this is the dependency-validation hook a dashboard widget plugs into, so disabling that capability hides its widget automatically, with no separate check to remember. First consumer: the `rewards` widget added in Priority 8.3, gated on the `rewards` capability.
- `getDashboardWidgets(appId)` (`src/lib/dashboard-widgets.functions.ts`) is the one place this is ever resolved — `DashboardPage.tsx` fetches it once (keyed on the currently-resolved application via `useApplication()`) and conditionally renders each section, and the Rewards/Advertising/Messaging nav/quick-link entries, from that single result, rather than each surface deciding independently whether to render. A seventh widget, `messaging`, was added in Priority 8.7 (`requiresCapability: "messaging"`), gating the Sidebar's Messages nav item the same way `rewards`/`advertising` already were.
- **Admin UI (Priority 8.7):** `adminListDashboardWidgets`, `adminUpsertDashboardWidget`, `adminSetDashboardWidgetAppSetting`, `adminListDashboardWidgetSettings` are all configurable through `/admin/dashboard-widgets` — no SQL required for normal administration.

## Rewards & Loyalty (Priority 8.3)

Entirely action-driven: applications and CORE flows never report point values, only that an **action** happened (`invite_registration`, `premium_purchase`, `premium_renewal`, `premium_referral_verified`, `advertising_purchase`, or an application-reported action like `business_approved`/`vendor_approved`/`event_created`/`place_approved`/`review_approved`). CORE alone resolves every business rule — points, cooldowns, limits — from configuration. There is no switch statement or per-action branch anywhere in the implementation; an action CORE doesn't recognize (typo, or a not-yet-configured application action) still gets a ledger row for full auditability, it just carries `0` points.

- **`reward_action_rules`** — the sole lookup table for what an action is worth: `action` (unique key), `points`, `cooldown_seconds`, `max_per_user` (nullable), plus soft lifecycle/`display_order`. `grantRewardAction()` (`src/lib/rewards.server.ts`) is the only function that reads it and the only place points are ever decided.
- **Ledger, not a mutable balance.** `reward_ledger` is append-only and every row's `points` is non-negative — Lifetime Points is `SUM(points)` and only ever grows, matching "Lifetime Points never decrease." The redeemable Reward Points balance is `SUM(reward_ledger.points) − SUM(reward_redemptions.points_spent)`, which can decrease — redemption spends against this derived balance, never against the ledger itself.
- **Levels** (`reward_levels`: `key`, `label`, `min_lifetime_points`) — Member, Bronze, Silver, Gold, Platinum, Ambassador, Legend by default, purely data — a user's level is whichever enabled/non-archived row has the highest `min_lifetime_points` at or below their Lifetime Points.
- **Achievements** (`reward_achievements`) auto-trigger off a `trigger_action` + `trigger_count` (e.g. "First Invite" triggers once `invite_registration` has happened `1` time) — resolved generically by counting matching `reward_ledger` rows, not by hardcoding which achievement means what.
- **Premium Referral verification** is the one two-step flow in this module: `recordPremiumReferralIfApplicable()` records a pending referral the moment a referred user's Premium first activates (Stripe/PayPal webhooks), with a `verification_due_at` computed from the admin-configurable `reward_config.referral_verification_days` (default 30). `promotePendingReferralVerifications(referrerId)` — called lazily whenever that referrer next loads their own Rewards Dashboard, matching this codebase's existing precedent of `TrialBanner`'s reactive-on-load activation rather than a scheduled job (no cron infrastructure exists here) — checks whether the referred user's Premium is *still* active once the period has elapsed and, if so, marks the referral verified and grants `premium_referral_verified` to the referrer. **Known, deliberate simplification:** this checks "is Premium active at the moment the period elapses," not "was Premium continuously active for the whole period" — true continuous-activity tracking would need subscription status history this codebase doesn't keep.
- **Referral linking** (`linkReferral`, `src/lib/rewards.functions.ts`) is deliberately service-role-only, not a client-editable profile field: `profiles.referred_by_user_id` is not in the `authenticated` column grant (see Profiles RLS below), because letting a user set their own referrer directly would let them fabricate a referral for reward fraud. The `?ref=<username>` link is captured client-side (`src/lib/referral.ts`, first-touch only, localStorage) and consumed once at onboarding completion, which calls `linkReferral` — first-write-only, self-referral rejected.
- **Every catalog reward requires two independent, non-substitutable conditions**: `reward_catalog.points_cost` (Reward Points) AND `verified_referrals_required` (a threshold check against the referrer's verified-referral count, never consumed/deducted on redemption — `reward_redemptions.verified_referrals_at_redemption` is an audit snapshot only). Defaults: 1/3/6/12 Month Premium, Advertising Credit, Featured Business, Featured Event — all admin-editable via `reward_catalog`, no deployment required to change a price or add a reward.
- **Fulfillment abstraction — Rewards records, it never fulfills.** `reward_catalog.grant_type` names a **fulfillment type** resolved against `reward_fulfillment_types`, an admin-extensible registry (same shape as `capability_definitions`) rather than a hardcoded literal union — a later module registers its own type there without a CORE deployment, and Rewards never needs to know what that type *means*. `redeemReward` validates eligibility, deducts points immediately (via the `reward_redemptions` insert), and records `grant_result: { status: "pending_fulfillment", grantType, grantValue }` — full stop. It does not extend Premium, credit Advertising, or create a Featured slot; turning `pending_fulfillment` into an actual granted benefit is entirely the responsibility of whichever module owns that `grant_type`, built whenever that module is built. **Priority 8.4 is the first concrete proof of this boundary**: Advertising owns `advertising_credit` and implements its fulfillment (`adminFulfillAdvertisingCreditRedemption`, see Advertising below) without Rewards' code changing at all. `featured_slot` fulfillment and a Premium-duration fulfillment path (including which application a redeemed duration should attach to, given `subscriptions` still has `UNIQUE(user_id, app_id)` while Premium itself is ecosystem-wide) remain open, unimplemented — deliberately, not overlooked. This is a durable architectural boundary, not a temporary gap: it's what keeps Rewards from ever needing to know about Advertising or any future module.
- **Catalog items can require a capability** (`reward_catalog.requires_capability`, nullable FK to `capability_definitions.key`) — same dependency-validation mechanism as `dashboard_widgets.requires_capability`. `getRewardsMe` filters the returned catalog to items whose required capability (if any) is enabled for the caller's current application; `redeemReward` re-checks the same condition server-side before allowing the redemption (fails closed if the reward requires a capability but no application context was provided). With no application context at all, nothing is filtered — matching the same "no application context = don't hide anything" fallback `DashboardPage.tsx`'s `isWidgetEnabled` uses.
- Reward-granting call sites: `invite_registration` (onboarding, via `linkReferral`), `premium_purchase`/`premium_renewal` (Stripe/PayPal webhooks — first purchase vs. renewal is distinguished by whether a `subscriptions` row already existed for that `(user, app)` pair *before* the webhook's upsert, not by a separate flag), `advertising_purchase` (Stripe/PayPal webhooks, campaign checkout — see Advertising below). The application-reported actions (`business_approved`, etc.) still have no caller — seeded in `reward_action_rules` ahead of whichever application features eventually report them, matching this table's "seed the vocabulary, not hardcode who uses it" design.
- **Admin UI (Priority 8.7):** every registry in this module — action rules, levels, achievements, the redemption catalog, fulfillment types, and `reward_config` (including the referral-verification-period setting) — is configurable through `/admin/rewards`, following the same Card-based pattern as `/admin/advertising`. `adminUpsertRewardLevel`/`adminListRewardLevels`, `adminUpsertRewardAchievement`/`adminListRewardAchievements`, and `adminListRewardConfig` were added in this pass — the other functions (`adminUpsertRewardActionRule`, `adminUpsertRewardFulfillmentType`, `adminUpsertRewardCatalogItem`, `adminSetRewardConfig`) already existed but had no page making them reachable. No SQL is required for normal administration of this module anymore.

## Universal Event Engine (Priority 12)

Extends Rewards & Loyalty into a generic pipeline every current and future application can report activity through — **entirely additive, not a replacement**. Everything in the section above (`reward_action_rules`, the ten CORE-internal actions, `grantRewardAction()`, Levels, Achievements, the Catalog, Referral verification) is unchanged and keeps deciding points for CORE-internal grants exactly as before. This engine is a second, parallel path for *application-reported* activity (a photo upload, a like, a comment) that CORE never hardcodes — an application only ever reports that an event happened; CORE alone decides whether it's worth anything. Moderation (forbidden words/domains, rate limits) was explicitly scoped **out** of this priority — it will become its own separate, reusable CORE module later, not part of Rewards.

- **Event Registry** (`event_definitions`) — the vocabulary of event keys (`photo_uploaded`, `photo_liked`, `comment_received`, `premium_purchased`, ...), admin-extensible, soft-lifecycle, same shape as `capability_definitions`. `event_key` is **permanent and immutable** once created — never renamed or repurposed for a different meaning, exactly like `reward_action_rules.action`. A breaking change to what an event means requires archiving the old key and creating a new one, never redefining an existing key in place; `version` auto-increments on every edit as an observability counter only (not a compatibility-resolution mechanism) — `writeAuditLog`'s full old/new diff is the real change history.
- **Application Mapping** (`application_events`) — per-(application, event) on/off, fails closed exactly like `application_capabilities`: no row means the event is not live for that application. Enabling an event here doesn't by itself grant anything — a rule (below) must also exist and be enabled.
- **Reward Rule Engine** (`event_rules`, one row per `(app_id, event_key)`) — `points`, `lifetime_points` (see below), `cooldown_seconds`, `max_executions`, `daily_limit`/`weekly_limit`/`monthly_limit`, `priority`, `repeatable`, soft lifecycle. No code change is ever needed to configure what an application-reported event is worth.
- **Rule Conditions** (`event_rule_conditions`, zero or more per rule, all must pass) — a small, code-implemented, growing set of predicates evaluated in `events.server.ts`: `not_self` (actor ≠ recipient), `first_occurrence` (only the first reward per recipient+resource, distinct from `max_executions`' overall cap), `min_account_age_days`, `recipient_premium`, `recipient_verified`, `recipient_profile_complete`, `content_public` (trusts the calling application's own `metadata.isPublic` — CORE never stores application content, it lives in each application's own separate database), `referral_verified` (checks `premium_referrals.verified_at`), `payment_successful` (checks a real `payments` row via the event's `resourceId`, so a purchase-driven event can't be claimed without CORE's own billing engine having recorded it), and `metadata_threshold` (a generic numeric check against an application-reported metadata field). Which conditions apply to a rule, and their parameters, are fully admin-configurable without a deployment — the same tradeoff as `reward_fulfillment_types`: the vocabulary of predicate *types* is code, using them is data.
- **Event Processing** (`recordEvent()`, `src/lib/events.server.ts`) — the one pipeline every application-reported event goes through: `application_events` (is this event live for this app?) → `event_rules` (is there a configured reward, and does it pass cooldown/caps?) → `event_rule_conditions` (do all predicates pass?) → `reward_ledger` insert (**always**, even a 0-point outcome, for full auditability — the same "an action CORE doesn't recognize still gets a row" precedent as `grantRewardAction`) → achievement check (reused unchanged from Rewards — an event-driven grant can complete the same achievements a CORE-internal action can, since both write the same ledger). Exposed publicly via `POST /v1/events` (`API_CONTRACT.md` §13) — applications only ever call this; they never calculate points themselves.
- **Global Points, per-application breakdown.** There remains exactly one global Reward Points balance and one global Lifetime Points total per user (unchanged) — `pointsByApp` (`getRewardsMe`) is a read-only aggregation over the ledger's existing `source_app_id` column, not a second balance concept; shown on `/dashboard/rewards` whenever a user has activity in more than one context.
- **Lifetime Points independent from Reward Points** (Priority 12 decision) — `reward_ledger.lifetime_points` is its own column, backfilled equal to `points` for every pre-existing row (so this changes nothing about any user's historical Lifetime Points). Reward (spendable) Points still derive from `points` alone; Lifetime Points now derives from `lifetime_points` alone. An admin/rule can deliberately diverge the two (e.g. a rule that grants spendable points without moving the user's level, or vice versa) — every existing call site defaults `lifetime_points = points`, reproducing today's behavior exactly unless a caller deliberately opts out.
- **Event source/origin tracking** (`reward_ledger.origin`, `CHECK` constraint) — `core` (every CORE-internal call site: webhooks, onboarding, admin grants — the default, and the accurate historical value for every pre-Priority-12 row), `api` (the `/v1/events` pipeline — the normal application-reported path today), `manual_admin` (the one origin permitted to carry negative `points`/`lifetime_points`, enforced by `reward_ledger_points_nonneg_check` at the database level — every other origin keeps the non-negative guarantee untouched). `application` and `n8n` are reserved, forward-looking values with no real call site yet (a possible future non-REST integration path, and a possible future reverse-direction n8n integration respectively) — included now so the `CHECK` constraint doesn't need a later migration once those paths exist.
- **Actor vs. recipient** (`reward_ledger.actor_user_id`, backfilled to `user_id` for every pre-existing row) — who performed the action vs. who is rewarded, needed for conditions like `not_self` (e.g. liking your own photo doesn't reward you) and events like `comment_received` (the content owner is rewarded, not the commenter).
- **Extensible metadata** (`reward_ledger.metadata`, jsonb) — additive alongside the existing `resource_type`/`resource_id`/`source_app_id` columns, which are unchanged. Lets an application attach event-specific data (e.g. `durationSeconds` for a `metadata_threshold` condition) without a CORE schema change.
- **Idempotency** (`reward_ledger.dedupe_key`, partial unique index on `(source_app_id, action, dedupe_key) WHERE dedupe_key IS NOT NULL`) — an application-supplied key makes a retried event submission safe to resend; every pre-existing/CORE-internal row has `dedupe_key IS NULL`, and Postgres never treats two NULLs as colliding.
- **Anti-abuse protection is a review queue, never an automatic block.** `event_abuse_flags` (service-role only — not even the flagged user may read their own flags) is written whenever a cooldown/cap (`max_executions`/`daily_limit`/`weekly_limit`/`monthly_limit`) is violated — the submission is still rejected at 0 points as normal, the flag exists purely so an admin can review a pattern of repeated cap violations for signs of actual abuse (bot activity, farming). Duplicate detection is handled structurally by `dedupe_key`, not by this queue.
- **Manual reward adjustments** (`adminAdjustRewardPoints`, `src/lib/rewards.functions.ts`) — the one path an administrator can move a user's balance (positive or negative) with no underlying event having happened, e.g. correcting fraud or a configuration error. Writes a `reward_ledger` row with `origin: "manual_admin"`; unlike every other admin mutation in this codebase, `reason` is **mandatory**, not optional, and always audited via `writeAuditLog`. Surfaced in the existing Manage User modal (`/admin/users`), alongside Grant/Revoke Premium.
- **Analytics** (`adminGetEventAnalytics`) — most-rewarded events and top earners, globally or scoped to one application, over a configurable time window. Cross-user aggregation (`GROUP BY` over `reward_ledger`) isn't expressible through PostgREST's query builder, so this is backed by two `service_role`-only Postgres functions (`event_analytics_by_event`, `event_analytics_top_earners`) called exclusively from `assertAdmin()`-gated server code — never exposed to `anon`/`authenticated` directly, unlike the per-user Premium-check functions (Priority 6) which are safe for any caller because they only ever answer about the caller's own or a public profile's status.
- **Admin UI:** a dedicated `/admin/events` page (not folded into `/admin/rewards`, matching the existing precedent of `/admin/capabilities` and `/admin/dashboard-widgets` each having their own page) covers the Event Registry, Application Mapping, Reward Rule Engine (including per-rule condition management), and Analytics.
- **Future Scalability.** Every piece here is admin-configurable data, not code: a new application registers, an admin enables the events it needs and configures their rules, and CORE requires zero code changes regardless of whether the platform has 5 applications or 500. Nothing in this engine ever branches on which application is calling by name.

## Advertising (Priority 8.4)

Placements, pricing, and moderation are all configuration; campaign checkout reuses CORE's existing billing engine rather than introducing a second one. Administration and campaign management remain their own separate, global module — not a Product, not merged into `/admin/applications` — unaffected by Products & Purchases (above); only the user-facing `/dashboard/purchases` read-only history was widened to also list a user's own campaign payments, since a successful campaign purchase is still a purchase.

- **Placements** (`ad_placements`) — an admin-extensible registry (`hero_banner`, `sidebar_banner`, `profile_footer` seeded), same soft-lifecycle shape as every other Priority 8 registry.
- **Pricing is a replaceable strategy, not a hardcoded model.** `ad_pricing_strategies` is the vocabulary (only `fixed_duration` has a resolver implemented this phase — CPM/CPC/credit-ledger/usage-based billing were explicitly scoped out, not silently deferred). `ad_placement_prices` is the actual price list: `app_id` nullable (`NULL` = global default), `placement_key`, `duration_days`, `price`/`currency`, plus `stripe_payment_link`/`paypal_payment_link` (see Checkout below). When both a global and an app-specific row exist for the same `duration_days`, the app-specific one wins — `resolvePlacementPrices()` (`src/lib/advertising.server.ts`) is the one place this merge happens.
- **Moderation mode and advertiser eligibility are both configurable, not hardcoded**, each with a global default (`ad_config`) and an optional per-application override (`ad_application_settings`) — resolved by `resolveModerationMode()`/`resolveEligibilityRule()`, the single centralized resolvers every consumer reads from (no per-call-site branching on what a mode means):
  - **Moderation:** `manual` (default — a purchased campaign starts `pending` and needs admin approval), `auto` (starts `active` immediately), `trusted_only` (`active` only if the buyer is a trusted advertiser, else `pending`).
  - **Eligibility:** `anyone` (default), `premium_only`, `verified_only`, `trusted_only` — checked once, at draft-campaign creation. `business_accounts_only` is a known, deliberate vocabulary gap: CORE has no "business account" concept yet, so it isn't offered as a selectable value at the database CHECK-constraint level (picking an unimplemented mode would otherwise silently behave like "anyone").
  - **Trusted advertisers** (`ad_trusted_advertisers`) is a plain admin-managed allow-list, same shape as `user_roles` (existence = trusted, no soft lifecycle needed on a binary flag) — **per-application**, not global: `(user_id, app_id)` is the primary key, so trust granted for one application says nothing about any other. `isTrustedAdvertiser(userId, appId)` is the one place this is ever checked.
- **Draft campaigns expire, they don't accumulate forever.** A campaign created via `createDraftCampaign` but never paid for is cancelled automatically once `ad_config.draft_expiry_hours` (default 48, admin-editable via `adminSetAdDraftExpiryHours`) has elapsed. Enforced lazily by `expireStaleDraftCampaigns(userId)`, called at the top of `getMyCampaigns` — matching this codebase's established no-cron, reactive-on-load pattern (same as Rewards & Loyalty's referral-verification promotion) rather than a scheduled job. Cancelled, never deleted, consistent with this codebase's "never hard-delete a record that might be referenced elsewhere" convention.
- **Editing an approved campaign's creative or destination re-enters moderation whenever moderation is currently required for that application.** `updateCampaignCreative` doesn't track "was this approved" as a separate bit — it re-runs `resolveInitialCampaignStatus` (the exact same resolver `activateCampaignFromPurchase` uses) on every edit to a non-`draft`, non-terminal campaign, so the answer is always freshly derived from the application's current moderation mode, never a stale decision baked in at approval time. A `draft` campaign (not yet paid) is simply updated in place, since there's no moderation state to protect yet; `ended`/`cancelled` campaigns can no longer be edited at all.
- **Checkout reuses subscriptions' exact billing model — no parallel payment system.** This codebase has no dynamic Checkout Session creation anywhere; subscriptions are sold via static, admin-configured Stripe/PayPal Payment Links with a signed reference appended as a URL param (see `pricing.tsx`/`payments.functions.ts`). Campaign checkout does the same: each `ad_placement_prices` row carries its own `stripe_payment_link`/`paypal_payment_link`, set by an admin exactly like a subscription plan's. `payments.campaign_id` (nullable, alongside the existing nullable `subscription_id`) records which kind of purchase a payment was — one shared `payments` table, not a second one.
- **A campaign is created as `draft` *before* checkout, not after.** Static Payment Links have no channel to carry campaign creative (title/banner/link) through the payment provider, so `createDraftCampaign` stores the creative first; `createCampaignCheckoutReference` signs a reference carrying only `(user, app, campaign_id)` (a distinct, HMAC-signed shape from the subscription reference — see `payment-reference.server.ts` — so the two can never be confused). The Stripe/PayPal webhooks verify the signature, re-derive the expected price and any available credit discount fully server-side (never trusting the client or the reference for price/discount), and activate that same draft row — `resolveModerationMode`'s result at that moment decides whether it goes `pending` or straight to `active`. A redelivered webhook event is a no-op (the campaign is no longer `draft`).
- **Advertising Credit is a discount mechanism only, not the primary billing model** (explicitly scoped this way): `ad_account_credits` is an append-only, signed-amount ledger (positive = a fulfilled Rewards redemption, negative = credit spent on a campaign purchase) — balance = `SUM(amount)`. At checkout, the full available balance (up to the price) is auto-applied as a discount; nothing about the discount is trusted from the client — the webhook recomputes the same balance and verifies the actually-paid amount against it.
- **This is the concrete fulfillment side of Rewards & Loyalty's fulfillment abstraction** (see Rewards & Loyalty above): `adminFulfillAdvertisingCreditRedemption` is the Advertising-owned function that turns a `pending_fulfillment` `advertising_credit` redemption into a real `ad_account_credits` credit. Rewards itself never calls this — an admin does, today; a fully automatic version is a reasonable future improvement, not built now since this codebase has no trigger/cron infrastructure.
- **Ad serving is a dedicated public function, not a public table.** `getActivePlacementAd`/`getActivePlacementCreative` return only the fields needed to render a creative (never the owner, moderation history, or pricing) — `ad_campaigns` itself is not publicly readable, matching the existing `has_any_active_premium()` precedent of never exposing a trust-sensitive table directly to `anon`.
- **Banner upload uses the replaceable media-storage adapter** (`src/lib/media-storage.ts`, `MediaStorageProvider` interface) rather than calling Supabase Storage directly — today's only implementation still targets the existing `core` bucket (Tier 1) under a new `advertising/<user_id>/...` prefix, per the Phase 8.2 instruction that the still-undecided Tier-2 provider must never block CORE architecture. Swapping the backing provider later is a change to this one file.
- **Dashboard/nav visibility** follows the same `advertising` capability + `advertising` dashboard-widget pattern as Rewards' `rewards` widget (Dashboard Widget Modularity) — disabling the capability removes the nav entry, the quick link, and the ability to browse placements or create a campaign, all from the same one flag.

## Configuration-First Principle (Priority 8)

**If a business rule may reasonably change in the future, it is not hardcoded.** Concretely: pricing, placements, limits, reward values, referral requirements, verification periods, trial durations, upload restrictions, validation rules, display order, and capabilities all live in admin-editable database tables, never in a TypeScript constant or an environment variable — a value only belongs in code/env when it genuinely cannot differ by application, by time, or by admin decision (e.g. `SUPABASE_URL`). The `duration_months` default of `12` (`admin.functions.ts`, both webhook handlers) predates this principle and is a known, tracked exception — see `PROJECT_AUDIT.md`, not silently fixed as a side effect of unrelated work. `TRIAL_DAYS = 7` (`trial.functions.ts`) was the same kind of exception; it no longer exists at all as of Priority 8.5 — Trial duration is now `trial_policy`-configured data, and the surrounding automatic-activation behavior it powered was removed outright, not merely made configurable.

**Soft lifecycle** is the standing convention for every new configuration entity introduced from Priority 8 onward: `enabled` (is this currently active) and, where the entity might be superseded rather than merely toggled, `archived` (permanently retired, never resurrected) plus a `displayOrder` — never a hard `DELETE`, so historical references (a redemption against a since-retired reward, a campaign against a since-removed placement) never dangle. `capability_definitions` is the reference implementation this pattern follows.

## Audit Strategy (Priority 8)

Every configuration change is auditable: who, when, the previous value, the new value, and an optional reason — this was already substantially true (`writeAuditLog()`/`audit_logs` already captured who/when/old/new for every admin action), extended with an optional `reason` column so any config-mutating endpoint can record why, not just what changed. This applies uniformly to every configurable module (Applications, Premium/Billing, Capabilities, Dashboard Widgets, Rewards & Loyalty, Advertising, Promotional Trials) through the same one shared `writeAuditLog()` call, never a per-module bespoke audit mechanism.

## Media Strategy (Priority 8)

Two tiers. **Tier 1 — stays in the existing `core` Supabase Storage bucket, unchanged**: application logos, application covers, default/system assets — CORE-owned/admin-uploaded branding content, all currently on the same working bucket, and never routed through `MediaStorageProvider` (there is no future provider swap to insulate against for CORE-owned assets). **Tier 2 — moves outside Supabase (planned, provider not yet chosen)**: avatars, profile covers, business/event images, documents — genuinely new user-generated-content infrastructure this codebase doesn't have yet. Campaign banners (Priority 8.4) and avatars (Priority 8.7) are both Tier-2-*shaped* content (user-generated, not CORE-curated) temporarily running on Tier-1 infrastructure via the replaceable `MediaStorageProvider` adapter (`src/lib/media-storage.ts`, see Advertising above) — swapping the backing provider later touches only that one file, never upload call sites. Every avatar upload call site (`AvatarUpload.tsx`, `onboarding.tsx`) now goes through `getMediaStorageProvider()` via a shared `avatarPath(userId, fileName)` helper, rather than calling `supabase.storage` directly — a provider swap for avatars now migrates automatically alongside campaign banners instead of stranding two independent call sites on the old bucket. Upload endpoints (`POST /v1/me/avatar`, the Advertising module's banner upload) are specified to have the same shape regardless of which tier backs them — the storage provider is an implementation detail the API hides, per the same "hide the internal structure" principle as everything else in this document.

---

# Technical Appendix

Everything below is implementation-level detail: exact files, exact schema, exact function names. It describes the current implementation of the architecture above. Nothing in this appendix has been removed from the prior version of this document — it has only been moved here to keep the sections above focused on architecture and business rules rather than implementation.

## Overview

This repository is a React + TypeScript web platform built with Vite, Tailwind CSS, TanStack React Router, TanStack React Query, and Supabase. It is generated and maintained through Lovable Cloud conventions.

The app provides:
- authenticated user onboarding and dashboard
- premium subscription management
- admin panel for application, user, payment, notification, and verification management
- Stripe and PayPal payment webhook handling
- Supabase database and storage integration
- server-side functions using TanStack Start

## Folder structure

- `/src`
  - `routes/`: page routes built with `@tanstack/react-router`
    - auth routes: `index.tsx`, `login.tsx`, `auth.callback.tsx`, `onboarding.tsx`
    - dashboard routes: `dashboard.index.tsx`, `dashboard.notifications.tsx`, `dashboard.profile.tsx`, `dashboard.security.tsx`, `dashboard.settings.tsx`, `dashboard.subscriptions.tsx`, `dashboard.help.tsx`, `dashboard.messages.tsx`, `dashboard.messages.$conversationId.tsx`
    - admin routes: `admin.tsx`, `admin.applications.tsx`, `admin.communication.tsx`, `admin.payments.tsx`, `admin.users.tsx`, `admin.verification.tsx`
    - payment and pricing: `pricing.tsx`, `payment.success.tsx`
    - public user pages: `profile.$username.tsx`, `u.$username.tsx`, `u.$username.share.tsx`
    - API webhook routes: `api/public/webhooks/stripe.ts`, `api/public/webhooks/paypal.ts`
    - root route shell: `__root.tsx`
  - `components/`: reusable UI and page components
    - `auth/ProtectedRoute.tsx`
    - `dashboard/`: dashboard layout and widgets
    - `dev/ApplicationSelector.tsx`: dev-only Application Selector, rendered by `ApplicationProvider` when no application resolves
    - `ui/`: UI primitives and shared controls
  - `context/`
    - `AuthContext.tsx`: auth state, session, and profile management
    - `LanguageContext.tsx`: i18n language management and sync
    - `ApplicationContext.tsx`: resolved current-application branding (Application Resolver), applied app-wide
  - `integrations/`
    - `supabase/client.ts`: browser Supabase client
    - `supabase/client.server.ts`: service-role Supabase client for server operations
    - `supabase/auth-middleware.ts`: server auth middleware for authenticated server functions
    - `supabase/auth-attacher.ts`: client middleware attaching Supabase bearer token to serverFn calls
  - `lib/`
    - `admin.functions.ts`: server functions for admin operations
    - `admin.server.ts`: admin helpers, audit logging, expiry math
    - `application-resolver.functions.ts`: Application Resolver server function (hostname → application branding)
    - `identity.ts`: Core Identity Service — provider-agnostic identity import/validation/lock-state helpers
    - `notifications.functions.ts`: notification server functions
    - `trial.functions.ts`: trial activation server function
    - `gdpr.functions.ts`: user export and delete operations
    - `n8n.server.ts`: webhook event forwarding helper
    - `stripe.ts`: Stripe helper stub
    - `i18n.ts`: translation setup
    - `utils.ts`, `username.ts`, `error-page.ts`, `error-capture.ts`
  - `start.ts`: TanStack Start request and function middleware registration
  - `server.ts`: Vite server entry wrapper for SSR and error normalization
  - `router.tsx`: TanStack router creation with generated route tree
  - `routeTree.gen.ts`: auto-generated route tree from page routes
- `/supabase`
  - `config.toml`
  - `migrations/`: database schema, RLS policies, triggers, objects, and storage policies
- `vite.config.ts`: Vite/Lovable configuration
- `bunfig.toml`: package installation rules
- `package.json`: dependencies and scripts
- `README.md`: Lovable project boilerplate

## Authentication flow (implementation)

### Client auth

- `src/integrations/supabase/client.ts` initializes the Supabase browser client.
- `src/context/AuthContext.tsx` manages:
  - current Supabase session
  - authenticated user object
  - linked user profile from `profiles` table
  - sign-in flows and sign-out
  - profile update and refresh logic
- Sign-in method: Google, via `supabase.auth.signInWithIdToken` — `src/routes/login.tsx` loads Google Identity Services with the current application's own Google Client ID (from the Application Resolver) and hands the resulting ID token to Supabase. Two outcomes, depending on whether the login was reached via an explicit `?app=<slug>` (see Application Resolver below; `?client_id=<slug>` is accepted as a deprecated alias):
  - **No `app`** (Core's own domain, visited directly — e.g. the administrator signing in to reach `/admin`): unchanged, direct `signInWithIdToken()` establishes a same-origin Supabase session, then redirects to `/dashboard` or `/onboarding`.
  - **Explicit `app`** (an application redirected the user here): the ID token is sent to the existing, unmodified `POST /v1/auth/session` (`API_CONTRACT.md` §5) instead, along with the resolved application's id; the resulting CORE-minted `{accessToken, refreshToken, expiresIn}` is handed back to that application via a redirect to its own registered `domain`, with the tokens in the URL fragment (`#access_token=...&refresh_token=...&expires_in=...&token_type=bearer` — the standard OAuth2 Implicit Grant delivery shape). No same-origin Supabase session is created for this path; Core's own domain is never the durable session — the calling application's own token pair is.
  - `AuthContext.tsx`'s `signInWithGoogle()` (a `signInWithOAuth`-based method) is intentionally disabled — it throws immediately if called, rather than performing a redirect sign-in — see "Google authentication must use `signInWithIdToken()` exclusively" above. `AuthContext.tsx` also exposes phone-OTP methods (`signInWithPhone`/`verifyOtp`); no route currently calls them either, and they are unrelated to the Google constraint.
- Identity import at first login/profile-creation uses the Core Identity Service (`src/lib/identity.ts`), not inline metadata parsing — see Identity Lock below.
- Auth state changes are handled by `supabase.auth.onAuthStateChange`.
- `ProtectedRoute` redirects unauthenticated users to `/login` and incomplete profiles to `/onboarding`.

### Application Resolver (implementation)

- `src/lib/application-resolver.functions.ts` exports `resolveApplication`, a `createServerFn` that resolves the current application.
- Resolution order:
  1. **Explicit `app`** (an application's `slug`, sent as `?app=<slug>` on `/login`, read by `src/context/ApplicationContext.tsx` and passed straight through; `?client_id=<slug>` is accepted as a deprecated fallback alias — see the resolver's file-level comment for why it isn't the primary name) — a single `applications` lookup by `slug`, absolute priority, no cookie involved *for identification itself*, identical behavior in every environment. An `app` that doesn't resolve to a real row returns `null` (fails closed) rather than falling through to hostname — a wrong or stale identifier must never silently resolve to a different application. This is what lets Core (`core.logid.pro`) resolve the correct calling application even though the hostname is always Core's own. (In development only, a successful explicit resolution is also remembered in a cookie — see step 3.)
  2. **Exact match on `applications.domain`** — used only when no explicit `app` was given; unchanged, and what makes visiting any application's own domain directly (including Core's own) resolve correctly with no query parameter at all.
  3. **Development-only convenience**: the cookie written in step 1 (or by the dev-only Application Selector, which resolves through the same step 1 path) is read back so a picked application keeps resolving across a whole session without repeating `?app=` on every page. Gated behind `import.meta.env.DEV`, a Vite build-time constant — a production build has this entire mechanism (both the cookie write in step 1 and the cookie read here) dead-code-eliminated (confirmed by inspecting the compiled server output directly, not assumed), so it is structurally incapable of influencing a production resolution, not merely unlikely to.
  4. If nothing resolves, `resolveApplication` returns `null`. No application is ever privileged as a "default" — there is no environment variable or fallback naming a specific application.
- `src/context/ApplicationContext.tsx` calls it via `useQuery`/`useServerFn` (the same client-fetch pattern `AuthContext`/`LanguageContext` already use) and exposes `useApplication()`. On resolution, it also applies `document.title` and the favicon link tag app-wide, so branding does not need to be reproduced per page.
- When resolution returns `null` (no domain match, no explicit `app`, and — in development only — no stored cookie: local development, previews, or an unregistered host; never a real configured production domain), `ApplicationProvider` renders `src/components/dev/ApplicationSelector.tsx` in place of the app instead of guessing an application. It lists every application straight from the registry; picking one calls `resolveApplication` again with that slug as `app` (the same explicit-identification path every real login uses), which — in development only — sets the `app_override` cookie server-side (`setCookie`, 30 days) so the choice persists across the whole session for local testing convenience — this path does not exist in a production build (see above).
- Known limitation: this is a client-side fetch, not a route loader — the very first server-rendered HTML (before hydration) shows a neutral placeholder (`__root.tsx`'s static `head()`), then swaps to the resolved application's branding immediately after. Perfect first-paint SSR branding (via a route `loader`) was deliberately not built for this first cut, to avoid introducing a first-of-its-kind loader-driven data pattern into a codebase where every other page fetches its data via `useQuery` — worth revisiting if first-paint branding becomes a priority.

### Core Identity Service (implementation)

- `src/lib/identity.ts` — provider-agnostic; the public API (`extractIdentityFromAuthUser`, `hasImportedAvatar`, `isIdentityLocked`) never names a specific provider. Internally, a `PROVIDER_EXTRACTORS` map dispatches by `user.app_metadata.provider`; Google is the only registered entry today (`extractFromOidcMetadata`). Adding Apple/Microsoft/etc. later means adding another map entry, not changing any call site.
- Used by `AuthContext.tsx`'s `loadOrCreateProfile` (profile creation and the fill-empty-fields-only patch) and by `onboarding.tsx` (display + the one-time-upload decision), replacing what was previously near-duplicated inline metadata parsing in both places.
- Does not include a privileged-operations module (`identity.functions.ts`) yet — there is no real functionality that belongs there today (see Identity Lock: Core's exemption from the lock is already handled by the database trigger, not by an application-layer server function). That file is the designated location for the future administrator-controlled identity-change workflow once it's built, following the existing `trial.functions.ts`/`gdpr.functions.ts` convention.

### Auth callback

- `src/routes/auth.callback.tsx` handles OAuth callback code exchange and session retrieval.
- It redirects users to `/dashboard` if profile is complete, otherwise `/onboarding`.

### Profile onboarding

- `src/routes/onboarding.tsx` collects missing profile data and avatar upload.
- On completion, it updates `profiles.profile_complete` and seeds `user_app_settings`.
- It also notifies external workflows via `notifyNewUserRegistered` server function.

### Server auth

- `src/integrations/supabase/auth-middleware.ts` is a TanStack Start server middleware.
- It validates the bearer token from serverFn calls and constructs a Supabase client scoped to the authenticated user.
- `src/integrations/supabase/auth-attacher.ts` attaches the `Authorization: Bearer <token>` header from client session to serverFn requests.

## Database tables

The database schema is defined in `/supabase/migrations`.

### Core tables

- `profiles`
  - user metadata and state
  - fields: `id`, `email`, `first_name`, `last_name`, `avatar_url`, `city`, `country`, `username`, `bio`, `language`, `user_type`, `is_verified`, `is_active`, `profile_complete`, `identity_locked_at`, timestamps
  - `user_type`: legacy column, still present in the schema but **no longer written or read anywhere in the codebase** as of the Global Premium Visibility & Contact System — Premium status is derived exclusively from `hasAnyActivePremium()` (live, from `subscriptions`). Kept as-is pending an explicit decision on whether to drop it (a schema change, not made unilaterally); see `PROJECT_AUDIT.md`.
  - `identity_locked_at`: set automatically by the `enforce_identity_lock` trigger the moment `profile_complete` first becomes `true`; never client-writable. See Identity Lock above and RLS/triggers below.
- `premium_profiles`
  - extended premium contact details and social links (`user_id` unique, no `app_id` — one shared contact record per user; visibility/usability of that record is gated per application at the application layer, see Premium Model → Public Profile Contact Gating)
- `applications`
  - platform/app definitions and visual metadata: `id`, `name`, `slug`, `domain`, `logo_url`, `favicon_url`, `cover_image_url`, `primary_color`, `secondary_color`, `google_client_id`, localized short descriptions, `visibility`, `launch_date`, `default_language`, `sort_order`
  - `google_client_id`: this application's own Google Cloud OAuth Client ID, consumed by the Application Resolver. Not secret (publicly readable, same as the rest of this table) — the Google Client Secret is never stored in the database, only in Supabase Auth's own Google provider configuration.
  - `visibility`/`launch_date`/`default_language`: Priority 8.9 — see Application Visibility above and Authentication → Localization above. `visibility` replaced the earlier `status`/`is_enabled` pair outright (both columns dropped in the same migration, after backfilling `visibility` from their combined prior values) — this is one of the few places in this codebase where an existing column was actually dropped rather than left in place unused, since keeping either alongside `visibility` would have directly contradicted "one visibility state."
- `subscription_plans` (conceptually "Products" as of Priority 8.10 — see Products & Purchases above; table name unchanged)
  - `app_id`-scoped: prices, currency, plan duration, Stripe/PayPal payment links, localized feature lists, `product_type` (`subscription`/`promotion`/`one_time`, Priority 8.10 — admin-facing classification only, does not change checkout/entitlement logic)
- `subscriptions`
  - user subscriptions: `user_id`, `app_id`, `plan_id`, status, payment identifiers, amount, expiry; `UNIQUE(user_id, app_id)`
- `payments`
  - payment records for Stripe and PayPal, linked to `user_id`, `app_id`, and either `subscription_id` (a Product purchase) or `campaign_id` (an Advertising campaign purchase, Priority 8.4) — the two are mutually exclusive per row, both surfaced together in `/dashboard/purchases`' payment history; `stripe_payment_id` and `paypal_payment_id` are both unique; `stripe_payment_intent_id` (nullable) is captured at fulfillment time so a later Stripe refund event can be matched back to this row
- `notifications`
  - localized notifications per user and app (`app_id` nullable)
- `audit_logs`
  - admin action history and audit trail
- `user_roles`
  - user role assignments (`app_role` enum: `admin`, `moderator`, `user`) and admin checks via `has_role()`/`private.has_role()`
- `user_app_settings`
  - per-user, per-app visible/contactable preferences; `UNIQUE(user_id, app_id)`
- `conversations` (Priority 7)
  - one-on-one messaging threads: `id`, `user_a_id`, `user_b_id` (canonically ordered, `UNIQUE(user_a_id, user_b_id)`), `hidden_by_a_at`/`hidden_by_b_at` (nullable, per-user "hide from my inbox"), `last_message_at`, `created_at`. No `app_id` — see Premium Model → Text Messaging for why a conversation has no per-application identity.
- `messages` (Priority 7)
  - `id`, `conversation_id`, `sender_id`, `body` (`CHECK` 1–2000 chars), `created_at`, `read_at` (nullable, set once by the recipient — messages are otherwise immutable, no edit/delete).
- `capability_definitions` (Priority 8.1)
  - the capability vocabulary: `id`, `key` (unique, e.g. `advertising`), `label`, `description`, `display_order`, `enabled`, `archived` (soft lifecycle — see Capabilities above).
- `application_capabilities` (Priority 8.1)
  - per-`(app, capability)` on/off switch: `id`, `app_id`, `capability_key`, `enabled`; `UNIQUE(app_id, capability_key)`.
- `dashboard_widgets` (Priority 8.2)
  - the dashboard widget registry: `id`, `key`, `label`, `description`, `requires_capability` (nullable FK to `capability_definitions.key`), `display_order`, `enabled`, `archived`.
- `dashboard_widget_settings` (Priority 8.2)
  - per-`(app, widget)` on/off switch: `id`, `widget_key`, `app_id`, `enabled`; `UNIQUE(widget_key, app_id)`.
- `reward_action_rules` (Priority 8.3)
  - the point-value lookup: `id`, `action` (unique), `label`, `points`, `cooldown_seconds`, `max_per_user` (nullable), `display_order`, `enabled`, `archived`.
- `reward_levels` (Priority 8.3)
  - `id`, `key` (unique, e.g. `gold`), `label`, `min_lifetime_points`, `display_order`, `enabled`, `archived`.
- `reward_achievements` (Priority 8.3)
  - `id`, `key` (unique), `label`, `description`, `trigger_action` (nullable FK to `reward_action_rules.action`), `trigger_count`, `display_order`, `enabled`, `archived`.
- `reward_fulfillment_types` (Priority 8.3)
  - the fulfillment-type vocabulary: `id`, `key` (unique, e.g. `advertising_credit`), `label`, `description`, `display_order`, `enabled`, `archived` — same shape as `capability_definitions`. Seeded with `premium_duration`, `advertising_credit`, `featured_slot`.
- `reward_catalog` (Priority 8.3)
  - redeemable rewards: `id`, `key` (unique), `label`, `description`, `points_cost`, `verified_referrals_required`, `grant_type` (FK to `reward_fulfillment_types.key` — the fulfillment type Rewards records but never itself acts on), `grant_value` (jsonb), `requires_capability` (nullable FK to `capability_definitions.key` — hides the reward when disabled for the caller's application), `display_order`, `enabled`, `archived`.
- `reward_config` (Priority 8.3)
  - free-form admin-editable settings, keyed by `key` (e.g. `referral_verification_days`), `value` (jsonb), `description`.
- `reward_ledger` (Priority 8.3; extended Priority 12 Phase 1)
  - append-only points log: `id`, `user_id`, `action` (not FK'd — deliberately, so an unrecognized action still logs at 0 points), `points`, `resource_type`/`resource_id` (nullable), `source_app_id` (nullable FK to `applications`), `created_at`, plus (Priority 12) `lifetime_points` (independent from `points`, backfilled equal to it), `origin` (`CHECK`: `core`/`application`/`api`/`n8n`/`manual_admin`/`system`), `actor_user_id` (nullable FK to `profiles`, backfilled to `user_id`), `metadata` (jsonb), `dedupe_key` (nullable, partial-unique per `(source_app_id, action, dedupe_key)`). `points`/`lifetime_points` remain non-negative except when `origin = 'manual_admin'` (`reward_ledger_points_nonneg_check`).
- `event_definitions` (Priority 12 Phase 1)
  - the event-key vocabulary: `id`, `event_key` (unique, immutable in practice), `display_name`, `description`, `category`, `icon`, `is_system`, `version` (auto-incremented on edit, observability only), `display_order`, `enabled`, `archived`.
- `application_events` (Priority 12 Phase 1)
  - per-`(app, event)` on/off switch, fails closed: `id`, `app_id`, `event_key` (FK to `event_definitions.event_key`), `enabled`; `UNIQUE(app_id, event_key)`.
- `event_rules` (Priority 12 Phase 1)
  - the reward configuration for one `(app, event)` pair: `id`, `app_id`, `event_key`, `points`, `lifetime_points`, `cooldown_seconds`, `max_executions`/`daily_limit`/`weekly_limit`/`monthly_limit` (all nullable), `priority`, `repeatable`, `display_order`, `enabled`, `archived`; `UNIQUE(app_id, event_key)`.
- `event_rule_conditions` (Priority 12 Phase 1)
  - zero or more predicates per rule, all must pass: `id`, `rule_id` (FK to `event_rules`, `ON DELETE CASCADE`), `condition_type`, `params` (jsonb), `display_order`. No soft-lifecycle columns — a condition is a parameter attached to a rule, not an independently-referenced registry.
- `event_abuse_flags` (Priority 12 Phase 1)
  - admin-review queue, never an automatic block: `id`, `user_id`, `event_key`, `app_id` (nullable, `ON DELETE SET NULL`), `reason`, `metadata` (jsonb), `reviewed`, `reviewed_by`/`reviewed_at` (nullable).
- `user_achievements` (Priority 8.3)
  - `id`, `user_id`, `achievement_key` (FK to `reward_achievements.key`), `earned_at`; `UNIQUE(user_id, achievement_key)`.
- `premium_referrals` (Priority 8.3)
  - `id`, `referrer_id`, `referred_user_id` (`UNIQUE`, one referral record per referred user), `subscription_id` (nullable), `verification_due_at`, `verified_at` (nullable).
- `reward_redemptions` (Priority 8.3)
  - `id`, `user_id`, `catalog_key` (FK to `reward_catalog.key`), `points_spent`, `verified_referrals_at_redemption` (audit snapshot, not a deduction), `grant_result` (jsonb — `{status, grantType, grantValue}`), `created_at`.
- `profiles.referred_by_user_id` (Priority 8.3)
  - nullable FK to `profiles.id`, set at most once, only by `linkReferral` (service-role) — not in the `authenticated` column grant (see Profiles RLS below).
- `ad_placements` (Priority 8.4)
  - the placement registry: `id`, `key` (unique, e.g. `hero_banner`), `label`, `description`, `display_order`, `enabled`, `archived`.
- `ad_pricing_strategies` (Priority 8.4)
  - the pricing-strategy vocabulary: `id`, `key` (unique — only `fixed_duration` has a resolver implemented), `label`, `description`, `display_order`, `enabled`, `archived`.
- `ad_placement_prices` (Priority 8.4)
  - the price list: `id`, `app_id` (nullable — `NULL` = global default), `placement_key` (FK), `pricing_strategy` (FK, default `fixed_duration`), `duration_days`, `price`, `currency`, `stripe_payment_link`/`paypal_payment_link` (nullable — admin-configured per row, exactly like `subscription_plans`), `display_order`, `enabled`, `archived`.
- `ad_config` (Priority 8.4)
  - global defaults, free-form key/value (jsonb) — seeded `moderation_mode` (`"manual"`), `eligibility_rule` (`"anyone"`), `draft_expiry_hours` (`48`).
- `ad_application_settings` (Priority 8.4)
  - per-application override: `id`, `app_id` (`UNIQUE`), `moderation_mode`/`eligibility_rule` (both nullable — `NULL` means "use the `ad_config` global default").
- `ad_trusted_advertisers` (Priority 8.4)
  - plain allow-list, same shape as `user_roles`, but **per-application**: `(user_id, app_id)` composite PK, `granted_by`, `granted_at`.
- `ad_campaigns` (Priority 8.4)
  - `id`, `user_id`, `app_id`, `placement_key`, `placement_price_id` (nullable — a snapshot of which price was purchased, kept even if the price list changes later), `title`, `image_url`, `link_url` (`CHECK` requires `NULL` or `http(s)://`), `starts_at`/`expires_at` (both `NULL` until activated), `status` (`draft`→`pending`/`active`→`rejected`/`ended`/`cancelled`), `moderation_note`.
- `ad_account_credits` (Priority 8.4)
  - append-only, signed-amount ledger: `id`, `user_id`, `amount` (positive = credited, negative = spent), `currency`, `source` (`reward_redemption`/`campaign_purchase`/`admin_adjustment`), `source_id`, `created_at`. Balance = `SUM(amount)`.
- `payments.campaign_id` (Priority 8.4)
  - nullable FK to `ad_campaigns.id`, alongside the existing nullable `subscription_id` — one shared `payments` table records both kinds of purchase, not a parallel `ad_payments` table.
- `share_invite_templates`
  - per-application Share & Invite copy: `id`, `app_id` (`UNIQUE`), `share_title`, `share_description`, `share_url`, `invite_template` (all nullable — see Share Profile / Invite a Friend above for the fallback behavior when unset).
- `trial_sources` (Priority 8.5)
  - the trial-source vocabulary: `id`, `key` (unique — `admin_grant`, `promotional_invitation`, `reward_redemption`), `label`, `description`, `display_order`, `enabled`, `archived` — same shape as `capability_definitions`.
- `trial_policy` (Priority 8.5)
  - global settings, free-form key/value (jsonb) — seeded `preset_days` (`[1, 3, 7, 14]`) and `max_duration_days` (`90`).
- `promotional_trials` (Priority 8.5)
  - `id`, `user_id`, `status` (`active`/`ended`/`revoked`), `source` (FK to `trial_sources.key`), `source_reference` (nullable), `granted_by` (nullable FK to `profiles.id` — null for a non-admin-driven source), `starts_at`, `expires_at`, `ended_at` (nullable — set on End/Revoke), `reason` (nullable, admin-supplied). A partial unique index on `(user_id) WHERE status = 'active'` enforces "no multiple active Trials" at the database, not only in application code.

### Storage

- Single shared bucket, `core` (public), holds every upload — there is no per-purpose bucket. Purpose is distinguished by top-level folder prefix within it: `avatars/<user_id>/...` (user avatars), `applications/<slug>/...` (application logos/favicons), and (Priority 8.4) `advertising/<user_id>/...` (campaign banners, via the `MediaStorageProvider` adapter). URLs are permanent public URLs (`getPublicUrl`), not signed/expiring.

### Seed data

- `applications` is seeded with sample apps such as `Bosanci.pro`, `Muzika.ba`, `Svadba.ba`, `Gradovi.ba`, `Ticketaria.io`.

## RLS policies

Row-level security is enabled for tables and storage policies.

### Profiles

- `authenticated` users may `SELECT` their own profile and `INSERT` their own profile row.
- `UPDATE` is column-restricted: `authenticated` only has column-level `UPDATE` privilege on `first_name`, `last_name`, `avatar_url`, `city`, `country`, `username`, `bio`, `language`, `email`, `profile_complete` — `id`, `user_type`, `is_verified`, `is_active`, `identity_locked_at`, and (Priority 8.3) `referred_by_user_id` are writable only by `service_role`. `referred_by_user_id` is excluded deliberately, not by oversight: a client-writable referrer would let a user fabricate a Premium Referral for reward fraud (see Rewards & Loyalty above) — it can only be set once, via the `linkReferral` server function.
- **Identity Lock enforcement** (`first_name`/`last_name`/`avatar_url`) is a `BEFORE UPDATE` trigger (`enforce_identity_lock`), not a column-grant revoke like the columns above — deliberately, since these three columns are legitimately `authenticated`-writable up until the lock engages, unlike `user_type`/`is_verified`/`is_active`, which never are. The trigger compares `OLD`/`NEW` per update: it auto-sets `identity_locked_at` the instant `profile_complete` first becomes `true`, then rejects any further change to those three columns from non-`service_role` callers. `service_role` (Core) is exempt at every point, with no migration ever needed to "unlock" a user — a future admin-identity-change workflow uses the same exemption. An RLS predicate was deliberately not used for this: RLS cannot compare `OLD` vs `NEW` in one expression without an awkward self-join, and cannot derive/set a value at all, so it would still have needed a trigger for the auto-lock timestamp regardless.
- Admins (`private.has_role(..., 'admin')`) may `SELECT` all profiles.
- Public, unauthenticated access goes through the `profiles_public` view (masked columns only), not the base table.
- Profiles are auto-created client-side on first sign-in (`AuthContext.loadOrCreateProfile`), not via a database trigger — the `authenticated`-role `INSERT` policy on `profiles` (own row only) exists to support exactly this. A user created directly through the Supabase Admin API (not through the app's sign-in flow) has no `profiles` row until they first authenticate through the app.

### Premium profiles

- Authenticated users may manage only their own premium profile.
- `website`, `facebook_url`, `instagram_url`, `tiktok_url`, `youtube_url`, `linkedin_url`, and `x_url` each have a `CHECK` constraint requiring `NULL` or an `http(s)://` prefix, rejecting other URL schemes at the database level.
- Public access goes through the `premium_profiles_public` view, which masks each contact field behind its own `_public` boolean flag.

### Applications

- Publicly readable at the RLS level (unchanged) — visibility filtering (Priority 8.9, see Application Visibility above) is enforced at the query/business-logic layer, not by narrowing this base policy. This is a deliberate boundary, not an oversight: the Application Resolver (`resolveApplication()`) must still be able to resolve a `draft` application's branding when hit directly on its own configured domain — an administrator setting up and testing a new application's login/branding page before flipping it to `active` — which a stricter RLS policy would silently break. What "hidden from normal users" actually means in practice is documented per-surface: `DashboardPage.tsx`'s own applications query explicitly excludes `draft`/`archived` (`.in("visibility", ["coming_soon", "active"])`), and the future `/v1 GET /v1/applications` (`API_CONTRACT.md` → Applications) does the same for any non-admin caller.
- Admins may manage all application records, including `visibility`, `launch_date`, and `default_language`.

### Subscription plans

- Publicly readable only when `is_active = true`; `anon` reads a restricted column set (payment links excluded).
- Admins may manage all plans. **Soft lifecycle only (Priority 8.7)** — `adminArchivePlan` (was `adminDeletePlan`) sets `is_active = false` instead of issuing a hard `DELETE`, matching the `enabled`/`archived` convention every other Priority 8 registry follows; a plan referenced by an existing subscription can no longer fail on a raw FK constraint violation, since nothing is ever actually deleted.

### Subscriptions

- Authenticated users can view their own subscriptions.
- Admins may view and manage all subscriptions.
- No direct public read policy; `has_any_active_premium(_user_id)` (the CORE Premium Service's global check) is the public-facing surface.

### Payments

- Authenticated users can view their own payments.
- Admins may view and manage all payments.

### Notifications

- Authenticated users can view their own notifications.
- Authenticated users can update their own notifications.
- Admins may manage all notifications.

### User roles

- Authenticated users can view their own roles.
- Admins can view all roles.

### User app settings

- Authenticated users can manage their own settings.
- Only rows with `is_visible = true` are publicly readable.

### Conversations & messages (Priority 7)

- `conversations`: `SELECT`/`UPDATE` restricted to participants (`auth.uid() IN (user_a_id, user_b_id)`). `INSERT` mirrors the same participant check as a backstop only — the real eligibility check (global Premium on both sides, recipient `is_contactable`) happens server-side in `getOrCreateConversation` before the insert is attempted, per this repository's rule that permission checks are enforced by the Core, on the server, every time.
- `messages`: `SELECT` for participants of the parent conversation (via an `EXISTS` against `conversations`). `INSERT` requires `sender_id = auth.uid()` and participant status. `UPDATE` (marking read) is column-restricted to `read_at` only (`GRANT UPDATE (read_at)`, mirroring the `profiles` column-grant pattern — see `PROJECT_AUDIT.md` → `DB-1`) and RLS-restricted to the **recipient**, never the sender — a message's `body`/`sender_id`/`conversation_id` can never be altered by any authenticated caller.

### Audit logs

- Only `service_role` can access audit logs; no public/authenticated read policy is defined.
- `reason` (Priority 8.1): nullable, optional on every `writeAuditLog()` call — not required, since not every audited change has (or needs) an explanation.

### Capabilities (Priority 8.1)

- `capability_definitions`: publicly readable (`anon`, `authenticated`); writable only by `service_role`.
- `application_capabilities`: publicly readable; writable only by `service_role`. Deliberately not admin-only-*readable* — the calling application and cross-application UI both need to read this without a privileged session, matching the existing pattern for other public-but-not-publicly-writable tables (`applications`, `subscription_plans`).

### Dashboard widgets (Priority 8.2)

- `dashboard_widgets`/`dashboard_widget_settings`: same shape as Capabilities immediately above — publicly readable, writable only by `service_role`.

### Rewards & Loyalty (Priority 8.3)

- `reward_action_rules`, `reward_levels`, `reward_achievements`, `reward_catalog`, `reward_config`, `reward_fulfillment_types`: registry/configuration tables, same shape as Capabilities/Dashboard Widgets — publicly readable, writable only by `service_role`.
- `reward_ledger`, `user_achievements`, `reward_redemptions`: `authenticated` may `SELECT` only their own rows (`user_id = auth.uid()`); all writes are `service_role`-only (no client-side insert path — every write goes through `grantRewardAction()`/`redeemReward`).
- `premium_referrals`: the referrer may `SELECT` their own referrals (`referrer_id = auth.uid()`); writes are `service_role`-only.

### Universal Event Engine (Priority 12)

- `event_definitions`, `application_events`, `event_rules`, `event_rule_conditions`: registry/mapping tables, same shape as Capabilities — publicly readable, writable only by `service_role`.
- `event_abuse_flags`: no `anon`/`authenticated` policy at all — `service_role` only, not even the flagged user may read their own flags (matches `audit_logs`' precedent).

### Advertising (Priority 8.4)

- `ad_placements`, `ad_pricing_strategies`, `ad_placement_prices`: registry/price-list tables — publicly readable (checkout UI needs to display prices without an admin session), writable only by `service_role`.
- `ad_config`, `ad_application_settings`: not publicly readable at all — both are only ever consulted server-side (checkout/moderation logic), matching `audit_logs`' `service_role`-only precedent.
- `ad_trusted_advertisers`: `authenticated` may `SELECT` only their own row; writes are `service_role`-only.
- `ad_campaigns`: the owner may `SELECT` only their own rows (`user_id = auth.uid()`); not publicly readable at all — ad serving goes through `getActivePlacementAd` (service_role), not a direct table read.
- `ad_account_credits`: `authenticated` may `SELECT` only their own rows; writes are `service_role`-only.

### Share & Invite templates

- `share_invite_templates`: publicly readable (`anon`, `authenticated` — the Dashboard widget needs it without an admin session); writable only by `service_role`.

### Promotional Trials (Priority 8.5)

- `trial_sources`, `trial_policy`: registry/config tables, same shape as Capabilities/Rewards — publicly readable, writable only by `service_role`.
- `promotional_trials`: `authenticated` may `SELECT` only their own rows (`user_id = auth.uid()`); all writes are `service_role`-only — there is no client-side insert path, matching `ad_campaigns`/`reward_redemptions`' pattern.

### Storage

- All objects live in the one `core` bucket; RLS is scoped by top-level folder prefix (`storage.foldername(name)[1]`), not by bucket id.
- `avatars/<user_id>/...`: publicly readable; only the owning user (via `foldername[2] = auth.uid()`) may insert/update/delete their own folder.
- `applications/<slug>/...`: publicly readable; only admins may write.
- `advertising/<user_id>/...` (Priority 8.4): publicly readable; only the owning user may insert/update/delete their own folder — same shape as `avatars/`.

## Server functions

The app uses TanStack Start server functions in `/src/lib`.

### Admin server functions

Defined in `src/lib/admin.functions.ts`:
- `adminUpsertPlan` (creates/edits a Product — `product_type` field added Priority 8.10)
- `adminArchivePlan` (was `adminDeletePlan` — soft-lifecycle `is_active = false`, not a hard `DELETE`, Priority 8.7)
- `adminGrantPremium`
- `adminRevokePremium`
- `adminListUsers` (paginated: `page`/`pageSize`; filterable by `search`, `premiumFilter` ("premium"/"standard", resolved live via `resolvePremiumStatusBulk()` — `subscriptions` OR `promotional_trials`, not `profiles.user_type`), `is_verified`, `is_active`; each returned row carries a computed `is_premium` boolean)
- `adminUpdateUser` (edits `city`/`country`/`bio`/`username` only — `first_name`/`last_name`/`avatar_url` are excluded under Identity Lock, and `email` is excluded as of Priority 8.7 since it now always resyncs from the auth identity instead of being admin-editable, see Identity Lock above)
- `adminSetUserActive` (suspend/reactivate — sets `profiles.is_active`; an admin cannot suspend their own account through this function)
- `adminDeleteUser` (admin-initiated deletion; shares its cascade-delete implementation — `deleteUserAccountCascade` in `admin.server.ts` — with the self-service GDPR deletion in `gdpr.functions.ts`, rather than duplicating it; an admin cannot delete their own account through this function)
- `adminListAuditLogs`
- `getMyIsAdmin`
- `adminOverviewStats`
- `adminSendNotification`
- `adminListPayments`
- `adminListVerificationRequests`
- `adminSetVerified`
- `adminCreateApplication` (new applications always start `visibility: "draft"`, the column's own DB default)
- `adminSetApplicationVisibility` (was `adminSetAppEnabled`, Priority 8.9 — the one dedicated action that moves an application between `draft`/`coming_soon`/`active`/`archived`, kept separate from `adminUpdateAppSettings` below, matching the same pattern `adminSetVerified`/`adminSetUserActive` already follow)
- `adminUpdateAppSettings` (covers identity/branding fields — `name`, `slug`, `domain`, `primary_color`, `secondary_color`, `cover_image_url`, `sort_order`, `google_client_id`, `launch_date`, `default_language` — in addition to logo/favicon/descriptions; deliberately excludes `visibility` itself)

These functions use `requireSupabaseAuth` middleware, validate inputs with Zod, then either enforce admin status or execute service-role operations.

### Notification and support functions

Defined in `src/lib/notifications.functions.ts`:
- `notifyNewUserRegistered`
- `updateUserSettings`
- `markAllNotificationsRead`
- `markNotificationRead`
- `sendSupportRequest`

### Promotional Trial functions (Priority 8.5)

Core logic in `src/lib/trial.server.ts` (plain server-only helper, not a `createServerFn`): `grantPromotionalTrial({ userId, days, source, grantedBy?, sourceReference?, reason? })` — the one place a Trial is ever created. Validates `days` against `trial_policy.max_duration_days`, rejects a grant if the user already has an active Trial (`already_has_active_trial`), and relies on `promotional_trials`' partial unique index as the actual race-safe guarantee (a `23505` unique-violation on insert is caught and reported the same way as the pre-check). Called today only from `adminGrantPromotionalTrial` below; a future `promotional_invitation`/`reward_redemption` source calls this same function with a different `source` key, never a copy of its logic.

Public surface in `src/lib/trial.functions.ts`:
- `getMyActiveTrial()` — authenticated; the caller's own current (or most recent) Trial, read-only. Powers `TrialBanner.tsx`; never activates anything.
- `getTrialPolicy()` — the current preset durations and maximum duration, for the admin grant form.
- `adminGrantPromotionalTrial({ userId, days, reason? })`, `adminEndTrial({ trialId, reason? })`, `adminRevokeTrial({ trialId, reason? })`, `adminListTrialHistory({ userId? })`, `adminListTrialSources()`, `adminSetTrialPolicy({ presetDays?, maxDurationDays?, reason? })` — each audited via `writeAuditLog()`. `adminEndTrial`/`adminRevokeTrial` are mechanically identical (both set a terminal status + `ended_at`) but kept as two distinct actions because they carry different administrative meaning — see Promotional Trial above.

### GDPR functions

Defined in `src/lib/gdpr.functions.ts`:
- `exportUserData`
- `deleteMyAccount`

### Messaging functions (Priority 7)

Defined in `src/lib/conversation.functions.ts`:
- `getOrCreateConversation` — the only place eligibility (global Premium both sides + recipient `is_contactable`) is checked; idempotent for an existing pair.
- `getConversations` — Inbox list: other participant (via `profiles_public`), last message, live-computed unread count, filtered by the caller's own hide state.
- `hideConversation` — sets the caller's own `hidden_by_a_at`/`hidden_by_b_at`.

Defined in `src/lib/message.functions.ts`:
- `getMessages` — paginated thread history (newest-first cursor via `before`).
- `sendMessage` — inserts the message, bumps `conversations.last_message_at`, inserts a `notifications` row for the recipient.
- `markConversationRead` — bulk-sets `read_at` for the caller's unread received messages in one conversation.

Both files were renamed from the Priority 6 foundation's `conversation.service.ts`/`message.service.ts` to match this repository's `*.functions.ts` convention — every export in both is a `createServerFn`, none are plain client-side helpers.

### Capabilities functions (Priority 8.1)

Defined in `src/lib/capabilities.functions.ts`:
- `getApplicationCapabilities` — public; the one and only place an enabled-capability set is read from. Excludes any capability whose *definition* is disabled/archived platform-wide, even if the per-application row says `enabled=true`.
- `adminListCapabilityDefinitions`, `adminUpsertCapabilityDefinition` — the vocabulary itself; registering a new capability is a data write here, never a deployment.
- `adminSetApplicationCapability` — the per-application on/off switch, audited with the previous and new `enabled` value.
- `adminListApplicationCapabilities` — every non-archived definition joined with one application's current settings, for admin UI.

### Dashboard widget functions (Priority 8.2)

Defined in `src/lib/dashboard-widgets.functions.ts`:
- `getDashboardWidgets` — public; the enabled widget keys for one application, in display order. Cross-references `getApplicationCapabilities` for any widget with a `requiresCapability` set.
- `adminListDashboardWidgets`, `adminUpsertDashboardWidget` — the registry itself.
- `adminSetDashboardWidgetAppSetting` — the per-application on/off switch, audited with the previous and new `enabled` value.
- `adminListDashboardWidgetSettings` — every non-archived widget joined with one application's current settings, for admin UI.

`DashboardPage.tsx` consumes `getDashboardWidgets` once, keyed on the application resolved via `useApplication()`, and conditionally renders each of the seven seeded sections (the original six plus `messaging`, Priority 8.7) from that one result.

### Rewards & Loyalty functions (Priority 8.3)

Core business logic in `src/lib/rewards.server.ts` (plain server-only helpers, not `createServerFn`s — called from `rewards.functions.ts` and directly from the Stripe/PayPal webhooks and onboarding's completion flow):
- `grantRewardAction({ userId, action, resourceType?, resourceId?, sourceAppId? })` — the only place points are ever decided; looks up `reward_action_rules`, checks `max_per_user`/`cooldown_seconds`, always writes a `reward_ledger` row (even at `0` points for an unconfigured action), then triggers achievement checks.
- `recordPremiumReferralIfApplicable({ userId, subscriptionId })` — called from the Stripe/PayPal webhooks; records a pending `premium_referrals` row if the newly-Premium user was referred and doesn't already have one.
- `promotePendingReferralVerifications(referrerId)` — lazily checked at the top of `getRewardsMe`; promotes any of this referrer's pending referrals whose verification period has elapsed and whose referred user's Premium is still active, granting `premium_referral_verified`.

Public surface in `src/lib/rewards.functions.ts`:
- `getRewardsMe({ appId? })` — the one aggregated Rewards Dashboard call: reward/lifetime points, current level, achievements, verified-referral count, the catalog (filtered by `requires_capability` when `appId` is given, annotated with per-item `canRedeem`), and redemption history. Runs `promotePendingReferralVerifications` as a side effect first.
- `redeemReward({ catalogKey, appId? })` — validates the catalog item, its capability gate (if any — fails closed without `appId`), and both eligibility conditions (points balance AND verified-referral count), then records the redemption via a service-role write (`reward_redemptions` grants `authenticated` `SELECT` only) — see Rewards & Loyalty above for why fulfillment itself is deferred.
- `linkReferral({ referrerUsername })` — service-role-only; sets `profiles.referred_by_user_id` once and grants `invite_registration` to the referrer. Called once from `onboarding.tsx` after profile completion, consuming the `?ref=` value captured by `src/lib/referral.ts`.
- Admin CRUD, same pattern as Capabilities/Dashboard Widgets: `adminUpsertRewardActionRule`/`adminListRewardActionRules`, `adminUpsertRewardLevel`/`adminListRewardLevels` (Priority 8.7), `adminUpsertRewardAchievement`/`adminListRewardAchievements` (Priority 8.7), `adminUpsertRewardFulfillmentType`/`adminListRewardFulfillmentTypes`, `adminUpsertRewardCatalogItem`/`adminListRewardCatalog`, `adminSetRewardConfig`/`adminListRewardConfig` (getter added Priority 8.7) — each audited via `writeAuditLog()`, all reachable from `/admin/rewards` (Priority 8.7).
- `adminAdjustRewardPoints({ userId, points, lifetimePoints?, reason })` (Priority 12 Phase 4) — the manual-adjustment path described above; `reason` is required by its Zod schema, not optional like every other admin mutation here.

### Universal Event Engine functions (Priority 12)

Event ingestion pipeline in `src/lib/events.server.ts` (plain server-only helper, same split as `rewards.server.ts`):
- `recordEvent({ appId, eventKey, actorUserId?, recipientUserId, resourceType?, resourceId?, metadata?, dedupeKey?, origin })` — resolves `application_events` → `event_rules` → `event_rule_conditions` → a `reward_ledger` insert, reusing `rewards.server.ts`'s `checkAchievements()` unchanged. The ten condition-type evaluators (`not_self`, `first_occurrence`, `min_account_age_days`, `recipient_premium`, `recipient_verified`, `recipient_profile_complete`, `content_public`, `referral_verified`, `payment_successful`, `metadata_threshold`) live in this file as a `Record<string, evaluator>` map.

Public surface in `src/routes/v1/events/index.ts`: `POST /v1/events` — the only way an application reports an event; `appId`/`actorUserId` come from the caller's own JWT (`azp`/`sub`) only, `recipientUserId` defaults to the caller but can be set explicitly for events like `comment_received`.

Admin CRUD in `src/lib/events.functions.ts`, same registry+mapping shape as Capabilities:
- `adminUpsertEventDefinition`/`adminListEventDefinitions` — Event Registry; auto-increments `version` on update.
- `adminSetApplicationEvent`/`adminListApplicationEvents` — per-application on/off mapping.
- `adminUpsertEventRule`/`adminListEventRules` — the Reward Rule Engine, one row per `(app_id, event_key)`.
- `adminUpsertEventRuleCondition`/`adminListEventRuleConditions`/`adminDeleteEventRuleCondition` — condition management (real delete, not soft-lifecycle — conditions are parameters attached to a rule, not an independently-referenced registry).
- `adminGetEventAnalytics({ appId?, sinceDays })` — most-rewarded events and top earners, backed by the `service_role`-only `event_analytics_by_event`/`event_analytics_top_earners` Postgres functions.

All reachable from `/admin/events`.

### Advertising functions (Priority 8.4)

Core business logic in `src/lib/advertising.server.ts` (plain server-only helpers, called from `advertising.functions.ts` and directly from the Stripe/PayPal webhooks):
- `resolveModerationMode(appId)` / `resolveEligibilityRule(appId)` — the two centralized config resolvers (per-application override in `ad_application_settings`, falling back to the `ad_config` global default).
- `checkAdvertiserEligibility(userId, appId)` — evaluates the resolved eligibility rule against `hasAnyActivePremium()`, `profiles.is_verified`, or `ad_trusted_advertisers`, whichever the rule names.
- `resolveInitialCampaignStatus(userId, appId)` — the resolved moderation mode decides `pending` vs. `active` at the moment a campaign is activated; a later admin change to the mode never retroactively changes campaigns already created.
- `resolvePlacementPrices(appId, placementKey)` / `resolvePlacementPriceById(id)` — the global-vs-per-application price merge described in Advertising above.
- `getAdAccountCreditBalance(userId)` — `SUM(ad_account_credits.amount)`.
- `activateCampaignFromPurchase({ campaignId, userId, appId, paidAmount, paidCurrency })` — called only from the Stripe/PayPal webhooks; re-derives the expected price and available credit discount fully server-side, verifies the actually-paid amount, and activates the `draft` campaign row (idempotent against a redelivered webhook event).
- `expireStaleDraftCampaigns(userId)` — lazily cancels this user's own `draft` campaigns older than `ad_config.draft_expiry_hours`; called from `getMyCampaigns`.
- `isTrustedAdvertiser(userId, appId)` — per-application, not global (see Advertising above).
- `getActivePlacementCreative(appId, placementKey)` — the ad-serving query, returning only what's needed to render a creative.

Public surface in `src/lib/advertising.functions.ts`:
- `getAdPlacementsForApp({ appId })` — public; placements + resolved prices, empty if the `advertising` capability is disabled for that application.
- `getActivePlacementAd({ appId, placementKey })` — public ad serving, capability-gated the same way.
- `getMyAdvertisingSummary({ appId })` — authenticated; eligibility + current credit balance, for the checkout UI.
- `createDraftCampaign({ appId, placementPriceId, title, imageUrl?, linkUrl? })` — authenticated; validates capability + eligibility + that the price belongs to the application + URL schemes (`isSafeProfileUrl`), then inserts the campaign as `draft` (service-role write — `ad_campaigns` grants `authenticated` `SELECT` only, matching `reward_redemptions`' pattern; every write goes through a server-validated path, never a direct client-authenticated insert). Creative content is captured here, before checkout, because static Stripe/PayPal Payment Links have no metadata channel to carry it through the payment provider.
- `createCampaignCheckoutReference({ campaignId })` — authenticated; signs the campaign reference (`signCampaignReference`) and returns the resolved price's Payment Links plus informational (never trusted) expected-amount/credit figures for the checkout page to display.
- `updateCampaignCreative({ campaignId, title?, imageUrl?, linkUrl? })` — authenticated, owner-only; re-runs `resolveInitialCampaignStatus` for any non-`draft`, non-terminal campaign so an edit can never silently bypass moderation (see Advertising above). Service-role write, same reasoning as `createDraftCampaign` — campaign `status` is never authenticated-writable directly.
- `getMyCampaigns()` — authenticated; the caller's own campaigns, running `expireStaleDraftCampaigns` as a side effect first.
- Admin: `adminUpsertAdPlacement`/`adminListAdPlacements`, `adminUpsertAdPlacementPrice`/`adminListAdPlacementPrices`, `adminSetAdConfig`, `adminSetAdDraftExpiryHours`, `adminSetAdApplicationSettings`, `adminSetTrustedAdvertiser`/`adminListTrustedAdvertisers` (both `appId`-scoped), `adminListCampaigns`/`adminModerateCampaign` (the moderation queue), `adminListPendingAdvertisingCreditRedemptions`/`adminFulfillAdvertisingCreditRedemption` (the Rewards fulfillment bridge) — each audited via `writeAuditLog()`.

`src/lib/media-storage.ts` — the replaceable upload adapter (`MediaStorageProvider` interface, `getMediaStorageProvider()`); today's only implementation targets the existing `core` Supabase Storage bucket. `src/lib/payment-reference.server.ts` gained `signCampaignReference`/`verifyCampaignReference`, a distinct HMAC-signed shape (leading `"campaign"` tag) from the subscription reference — the two can never be confused by either webhook, and the original `signPaymentReference`/`verifyPaymentReference` are untouched.

### Share & Invite template functions

Defined in `src/lib/share-invite.functions.ts`:
- `getShareInviteConfig({ appId })` — public; whatever is configured for that application (each field nullable), or `null` per field if nothing has been set. No server-side hardcoded English fallback — `ShareAndInvite.tsx` fills any gap with an i18n default.
- `adminUpsertShareInviteTemplate({ appId, shareTitle, shareDescription, shareUrl, inviteTemplate, reason? })` — upserts the single per-application row (`onConflict: "app_id"`), audited via `writeAuditLog()`. Edited from `/admin/applications`'s "Share & Invite" section (scoped to whichever application is currently selected there), not a separate admin page.

### Server helpers

- `src/lib/admin.server.ts`
  - `assertAdmin()`: verifies admin role using `user_roles`
  - `writeAuditLog()`: inserts audit log records via service-role client
  - `addMonthsIso()`: calculates subscription expiry dates
  - `deleteUserAccountCascade()`: cascade-deletes a user's data + auth record; shared by self-service GDPR deletion and admin-initiated deletion
- `src/lib/n8n.server.ts`
  - `sendN8nEvent()`: sends webhook events to an external n8n endpoint

## API architecture

### Page routes

- Pages are defined with `createFileRoute()` in `src/routes/*.tsx`.
- `src/router.tsx` builds the router from the generated `routeTree.gen.ts`.
- `src/routes/__root.tsx` is the root shell and renders nested route output via `<Outlet />`.

### Server-side runtime

- `src/start.ts` configures TanStack Start middleware:
  - `attachSupabaseAuth`: attaches authenticated Supabase bearer token to server function RPCs.
  - error middleware: catches exceptions and renders HTML error page.
- `src/server.ts` is the Vite SSR entrypoint that imports the bundled TanStack server entry and normalizes catastrophic SSR responses.

### Server functions and middleware

- Client code calls server functions via `useServerFn` from `@tanstack/react-start`.
- `attachSupabaseAuth` ensures each serverFn call includes the current Supabase access token.
- `requireSupabaseAuth` validates tokens on the server, creates a user-scoped Supabase client, and exposes `userId` in context.

### Public API endpoints

- `src/routes/api/public/webhooks/stripe.ts`
- `src/routes/api/public/webhooks/paypal.ts`

These are raw server handlers for payment webhook POST events.

## Dashboard architecture

### Dashboard shell

- `src/routes/dashboard.index.tsx` renders `DashboardPage` inside `ProtectedRoute`.
- `DashboardPage` is the main dashboard UI in `src/components/dashboard/DashboardPage.tsx`.

### Dashboard queries

The dashboard loads:
- active applications
- active user subscriptions and subscription plans
- all user subscriptions
- recent payments
- unread notification count

### Dashboard features

- user profile summary and premium status
- trial banner and trial activation logic
- recent activity cards and app navigation
- language switcher
- notification bell and realtime updates via Supabase Realtime on `notifications`

### User pages

- Profile editor: `dashboard.profile.tsx`
- Security: `dashboard.security.tsx`
- Settings: `dashboard.settings.tsx`
- Notifications: `dashboard.notifications.tsx`
- Subscriptions list: `dashboard.subscriptions.tsx`
- Help: `dashboard.help.tsx`
- Messages Inbox: `dashboard.messages.tsx`; Chat thread: `dashboard.messages.$conversationId.tsx` (`src/components/messaging/`: `ConversationListItem`, `MessageBubble`, `ChatComposer`)
- Public profile card: `u.$username.tsx` (see Profile Card & Messaging System below)

## Profile Card & Messaging System (implementation)

See the architecture-level section of the same name above for the business rules this implements.

### Component classification & reuse

- `ProfileCard` (`src/components/profile/ProfileCard.tsx`) is a standalone, self-contained shared component — implemented Priority 6, extended for the Global Premium Visibility & Contact System. Props: `profile` (`ProfileRow`), `premiumProfile` (`PremiumProfileRow | null`), `viewerId` (`string | null`), optional `className`. Nothing else is passed in: Premium status/eligibility, the "Public profile on" list, per-application `is_visible`/`is_contactable`, and the current application's branding are all resolved internally (via the CORE Premium Service, a direct `user_app_settings` query, and the Application Resolver), not pre-computed by the caller — any future surface can render it with just those four inputs.
- `src/routes/u.$username.tsx` fetches `profile`/`premiumProfile` and renders `<ProfileCard />`; it owns page chrome (nav, not-found state, footer) plus the `is_visible` presence gate (see Premium Model → `is_visible`) — not card content.
- Branding inputs (cover/logo) come from the existing Application Resolver (`useApplication()`) — `ApplicationBranding` (`src/lib/application-resolver.functions.ts`) was extended with `cover_image_url` (the column already existed on `applications`; it simply wasn't surfaced to the client before) so the card can show the current application's own cover photo, falling back to a gradient when unset.
- Uses existing shared primitives only — `Badge`, `Button`, `Dialog`, `Tooltip`, `Skeleton` (`src/components/ui/`) — rather than hand-rolled markup, closing the "design tokens actually in use" split flagged in the earlier version of this section for this component specifically (other, older pages still use hand-rolled markup and were not retrofitted). A small local `ContactActionButton` helper (module-level in `ProfileCard.tsx`) renders every Contact Action's locked-vs-real-value label uniformly (see Premium Model → Contact Actions) rather than repeating the conditional per method.
- **Priority 6.1 (completed):** the page chrome around the card — `u.$username.tsx`'s navbar and footer — and `ProfileCard`'s native-share dialog title were still hardcoding the literal string `Core`/`Core Platform` after the Priority 6 rewrite, inconsistent with `login.tsx`/`onboarding.tsx`, which already resolve branding from `useApplication()`. Both now read `application.logo_url`/`application.name` (same fallback tile pattern `login.tsx` uses when no logo is set) instead.
- **Global Premium Visibility & Contact System (completed):** superseded Priority 6's per-application Premium/contact design (documented above under Premium Model). `dashboard.profile.tsx`'s Premium-only editing lock was removed (every user can edit every field); `DashboardPage.tsx`'s per-app Premium/Standard tile badge was replaced with one global value from `hasAnyActivePremium()`; `is_user_premium(uuid, uuid)` was dropped from the database (see Technical Appendix → Database tables); the top "Share" button duplicate in the card's cover area was removed, leaving only the "Share Profile" action.

### Responsive layout

Desktop / Tablet / Mobile, matching this codebase's existing breakpoint convention (Tailwind `sm:`/`lg:`, e.g. `sm:grid-cols-2 lg:grid-cols-3` already used in `pricing.tsx`):
- **Desktop** (`lg:` and above): fixed-width card (existing pattern: `max-w-[460px]`, centered), single column; the "Public profile on" row is a horizontal strip of icon tiles.
- **Tablet** (`sm:` to `lg:`): the same single-column card and content, width-constrained the same way. The reference design shows only Desktop and Mobile explicitly — Tablet is treated as the same card scaling between the two documented breakpoints, consistent with how every other page in this codebase handles the tablet range, not a third distinct layout. Flagged in Open Questions if a dedicated tablet mockup is actually wanted.
- **Mobile** (below `sm:`): full-width card; an app header bar with a `•••` overflow menu (per the mockup) replaces the desktop nav; a bottom tab bar (Home/Messages/Profile/Menu) appears below it — the tab bar is a separate, app-shell-level component, not part of `ProfileCard` itself.
- **Landscape** (mobile, rotated): not shown in the reference design; defaults to the Mobile layout reflowed by normal responsive behavior, with no dedicated landscape variant. Flagged in Open Questions.

### States

- **Hover** (pointer devices): the existing convention already used throughout this codebase — a subtle background/border shift on interactive elements (`hover:bg-gray-50`, `hover:border-gray-300`-style utilities), no new hover language.
- **Touch** (mobile): the existing convention — active/pressed opacity or background shift; see Accessibility for minimum touch target.
- **Loading / Skeleton**: placeholders using the existing `src/components/ui/skeleton.tsx` primitive, already used elsewhere (e.g. the Dashboard's application-list skeletons) — cover/avatar/text-line placeholders shaped like the real content, not a spinner.
- **Empty state**: "profile not found" reuses the existing `u.$username.tsx` not-found card unchanged (simple centered message + link home, no icon).
- **Error state**: unrecoverable errors reuse the existing root-level `ErrorComponent` (`__root.tsx`); a recoverable data-fetch failure (e.g. a transient network error loading the profile) falls back to the same not-found-style card with a retry action — exact copy to be finalized at implementation time.

### Design tokens actually in use

This codebase ships a full shadcn/ui primitive library (`src/components/ui/button.tsx`, `badge.tsx`, `dialog.tsx`, `card.tsx`, `tooltip.tsx`, `skeleton.tsx`, etc.) driven by CSS-variable tokens in `src/styles.css` (`--primary`, `--secondary`, `--destructive`, `--radius`, etc.) — but the consumer-facing pages actually built so far (`dashboard`, `pricing`, `u.$username`, `onboarding`, `login`) do not use these primitives; they hand-roll styled elements with hardcoded hex colors and Tailwind utilities directly. **This split predates this specification** and is called out here rather than silently resolved one way or the other — see Open Questions.

The palette actually in use today, which the Profile Card should match (and which the reference design's own colors already align with):
- Primary blue `#1D6BF3` (hover `#155ac9`/`#1858cf`) — primary actions, links, active nav state.
- Purple/indigo gradient `#6366F1` → `#8B5CF6` — premium/upgrade accents, avatar-fallback gradients.
- Premium gold `#F59E0B` → red `#EF4444` gradient — the "Premium"/Crown badge; plain `bg-amber-100 text-amber-700` for smaller premium tags.
- WhatsApp green — Tailwind `green-500`/`600`/`700`.
- Backgrounds — `#F7F8FA` (dashboard shell) or the soft gradient `#EEF2FF → #F0F9FF → #F0FDF4` (public-facing pages: login, onboarding, public profile).
- Neutral scale — Tailwind default `gray-50` through `gray-900`.
- Radius — `rounded-lg`/`rounded-xl` (buttons, inputs, list tiles), `rounded-2xl` (cards, modals), `rounded-full` (avatars, pills, icon buttons).
- Modal chrome — the same pattern used identically everywhere in this codebase: `fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4` backdrop, `rounded-2xl bg-white p-6 shadow-lg` panel.
- Typography — `text-xs`/`sm`/`base`/`lg`/`xl`/`2xl`/`3xl`, weights `font-medium`/`semibold`/`bold`; no type scale beyond Tailwind's defaults.
- Icons — `lucide-react` exclusively.
- Spacing — Tailwind's default scale (`p-3`/`p-4`/`p-6`, `gap-2`/`gap-3`/`gap-4`); no custom spacing tokens.

### Accessibility

- Keyboard navigation: every interactive element (buttons, links, modal actions) reachable via Tab in visual order; the modal traps focus while open and returns focus to the triggering element on close, matching `admin.users.tsx`'s existing modal behavior.
- Screen reader: icon-only buttons (WhatsApp/Viber, share) carry `aria-label`s, the same convention `NotificationBell` already uses.
- Focus state: a visible focus ring on all interactive elements — the shadcn primitives already have this via `focus-visible:ring` utilities; hand-rolled buttons on feature pages should adopt the same treatment (currently inconsistent — another instance of the palette/component split above).
- Contrast: body text and interactive labels meet WCAG AA against their backgrounds — already broadly true of the existing color combinations in use; no new contrast requirement introduced.
- Touch target: minimum 44×44px hit area for icon buttons and contact actions on mobile — not currently a formalized rule elsewhere in this codebase; introduced here as an explicit baseline for this component.

### Translation namespaces & keys

Per the Localization rule, every string is looked up through the existing `react-i18next` setup — no hardcoded copy. The keys below fit into namespaces that **already exist** in `src/locales/{bs,en,de}.json`; no new namespace is introduced except `message.*`/`contact.*`, which have no existing home.

`profile.*` (existing — reuse, don't rename):
- Already exist (added in Priority 3): `profile.shareProfile`, `profile.premium`, `profile.sendMessage`, `profile.viber`, `profile.whatsapp`, `profile.messagingSoon`, `profile.premiumOnlyTitle`, `profile.premiumOnlyFeature`, `profile.premiumOnlyBoth` (the latter's copy was updated for the Global Premium Visibility & Contact System — see Premium Model → Contact Actions for current wording).
- Already exist (added for the Global Premium Visibility & Contact System): `profile.publicOn` (replaces `profile.premiumOn`'s role — the old key is left defined but unused, not deleted), `profile.premiumMember`, `profile.standardMember` (the Premium Card's tier pill; the Standard Card has no pill at all, so this key backs only the Premium case), `profile.call` (the new Call contact action).
- Already exist: `profile.primaryProfession`, `profile.secondaryProfessions` — map the "main profession"/"additional professions" card fields onto these existing keys rather than adding differently-named duplicates.

`share.*` (existing — reuse, don't rename): `share.shareProfile`, `share.share`, `share.copyLink`, `share.linkCopied`, `share.inviteFriend`, `share.invite`, `share.inviteDescription`, `share.yourInviteLink`, `share.referralComingSoon` — all already exist, used as-is.

`notifications.*` (existing, **plural** — the request's own examples use singular `notification.*`; this codebase's existing convention is plural, matching `dashboard.notifications`/`nav.notifications` and the `notifications` namespace already in the locale files, so new message-related keys should extend the existing plural namespace rather than introduce a second, singular one):
- Already exist: `notifications.title`, `notifications.markAllRead`, `notifications.allMarkedRead`, `notifications.empty`, `notifications.viewAll`.
- Proposed, not yet added: `notifications.newMessage`; a dedicated unread-count string may not even be needed, since the existing numeric badge has no string content today (see Notifications above).

`message.*` (new, still proposed — messaging itself is Priority 7+, not built): `message.inbox`, `message.sent`, `message.received`, `message.new`, `message.reply`, `message.read`, `message.unread` — add to all three locale files together when messaging is actually built, never partially.

**`contact.*` was never introduced.** The upgrade-dialog copy the Global Premium Visibility & Contact System actually shipped reused the existing `profile.premiumOnlyTitle`/`profile.premiumOnlyFeature`/`profile.premiumOnlyBoth` keys (updating `premiumOnlyBoth`'s text) instead of adding a new namespace — consistent with "reuse, don't rename" above. `dashboard.upgrade`/`common.close` back the dialog's two buttons, exactly as originally proposed.

All three locale files must be updated together for any new key — never one language at a time — per this repository's established localization workflow.

## Admin architecture

### Admin protection

- `src/routes/admin.tsx` wraps admin pages with `ProtectedRoute` and an `AdminGate` that blocks the `<Outlet/>` for non-admins.
- Client-side admin check reads `user_roles` and redirects non-admins to `/dashboard`.
- Server functions enforce admin role using `assertAdmin()` and service-role operations.

### Admin panels

- `/admin`: admin overview and quick links
- `/admin/applications`: manage apps and Products (`subscription_plans`, Priority 8.10 — Subscription/Promotion/One-Time)
- `/admin/users`: search/filter/paginate users, edit profile fields, suspend/reactivate/delete accounts, approve/revoke verification, grant/revoke premium, view audit logs
- `/admin/communication`: broadcast notifications to users
- `/admin/payments`: payments history via server function
- `/admin/verification`: approve or revoke verified user status
- `/admin/advertising`: placements, pricing, moderation/eligibility config, trusted advertisers, moderation queue, advertising-credit fulfillment
- `/admin/trials`: grant/end/revoke Promotional Trials, view history, edit trial policy
- `/admin/capabilities` (Priority 8.7): register capability definitions, enable/disable per application
- `/admin/dashboard-widgets` (Priority 8.7): register widget definitions (including `requiresCapability`), enable/disable per application
- `/admin/rewards` (Priority 8.7): action rules, levels, achievements, redemption catalog, fulfillment types, configuration

### Admin data flow

- Admin pages use `useServerFn` with admin server functions for privileged operations.
- Some admin pages also query Supabase directly for read-only data such as applications.

## Subscription system (implementation)

### Pricing and plans (Products, Priority 8.10)

- Plans/Products are stored in `subscription_plans` and belong to applications; `product_type` (`subscription`/`promotion`/`one_time`) classifies each one for admin organization — checkout/entitlement logic is identical regardless of type.
- `pricing.tsx` lists active plans by app; on clicking "Pay with Stripe/PayPal" it calls `createPaymentReference` (server function) to obtain a signed reference, then redirects to the plan's stored payment link with that reference attached.
- Both Stripe (`client_reference_id`) and PayPal (`custom_id`) use the same signed format: `userId__appId__planId__hmac` (see Billing above).

### Promotional Trial (Priority 8.5)

- No auto-activation anywhere — `DashboardPage.tsx` no longer calls anything on load to grant a trial. `TrialBanner.tsx` only ever reads (`getMyActiveTrial`).
- `/admin/trials` is the only way a Trial is created: `adminGrantPromotionalTrial` → `grantPromotionalTrial()` (`trial.server.ts`) → an insert into `promotional_trials`, entirely separate from `subscriptions`.
- `has_any_active_premium()` checks `promotional_trials` independently of `subscriptions` — see Promotional Trial in the architecture section above for why this matters.

### Subscription persistence

- Successful payment webhooks and admin grant operations `upsert` `subscriptions` on `(user_id, app_id)` — one row per user per app, refreshed in place on renewal, resubscribe-after-cancel, or repeat admin grant rather than inserted anew.
- Admin revoke operations, and a Stripe refund, update the existing row's `status`/`expires_at`.
- Subscriptions store expiry, payment ids, amount, currency, and status.

### Purchases UI (Priority 8.10 — was "Subscription UI")

- `/dashboard/purchases` (`dashboard.purchases.tsx`, replacing the earlier `/dashboard/subscriptions`) shows the complete purchase history: current/expired Products (subscriptions joined with plans/applications) and the full payment/transaction ledger (provider, transaction id, status) — including Advertising campaign payments, labeled distinctly via `ad_campaigns.title`.
- `payment.success.tsx` polls for active subscription after checkout.

## Notification system (implementation)

### Notification storage

- `notifications` table stores localized titles and messages for BS/EN/DE.
- `type` is one of `info`, `success`, `warning`, or `error`.
- `is_read` indicates read status.

### User notifications

- `dashboard.notifications.tsx` loads user notifications and allows marking items read.
- `NotificationBell` shows an unread count and subscribes to realtime changes on the `notifications` table.
- Server functions:
  - `markAllNotificationsRead`
  - `markNotificationRead`

### Admin notification sending

- `admin.communication.tsx` sends notifications to all users, premium users, or a single user.
- `adminSendNotification` server function inserts notification rows based on target audience.

## Payment flow (implementation)

### Stripe

- Payment intent flow is implemented via Stripe Checkout links stored on plans.
- Webhook endpoint at `/api/public/webhooks/stripe` validates `stripe-signature` with `STRIPE_WEBHOOK_SECRET`.
- On `checkout.session.completed`, the webhook first tries `verifyCampaignReference` (Priority 8.4) against `client_reference_id`; if that matches, it branches into campaign activation (`activateCampaignFromPurchase`, idempotency by existing `stripe_payment_id`, inserts `payments` with `campaign_id` set, grants `advertising_purchase`) and returns early — the subscription flow below it is otherwise completely unchanged. Campaign refunds are handled in the `charge.refunded` branch below the same way subscriptions are (via `payments.campaign_id`).
- On `checkout.session.completed` (subscription path), webhook:
  - requires `session.payment_status === "paid"`, rejecting sessions with unconfirmed payment
  - verifies `client_reference_id`'s HMAC signature (`verifyPaymentReference`); rejects if missing, malformed, or tampered
  - requires a resolvable `plan_id` segment (rejects if missing or unresolvable)
  - verifies plan amount and currency
  - checks for an existing `payments` row by `stripe_payment_id` first (idempotency guard against redelivered events)
  - upserts `subscriptions` on `(user_id, app_id)`
  - inserts `payments`, capturing `stripe_payment_intent_id` for later refund matching
  - inserts a notification
  - writes an audit log
  - emits n8n events
- On `charge.refunded`, webhook:
  - matches the refund to its `payments` row via `stripe_payment_intent_id`
  - marks that row `status = 'refunded'`
  - cancels the associated subscription (`status = 'cancelled'`, `expires_at = now()`)
  - writes an audit log
  - `charge.dispute.created` is not handled (no `'disputed'` payment status exists yet)
  - **No `profiles.user_type` write on either path** (Global Premium Visibility & Contact System) — cancelling the subscription above is sufficient; `hasAnyActivePremium()` reflects the change immediately since it reads `subscriptions` live.

### PayPal

- Webhook endpoint at `/api/public/webhooks/paypal` verifies signature against PayPal.
- On `PAYMENT.CAPTURE.COMPLETED`, the webhook first tries `verifyCampaignReference` (Priority 8.4) against `custom_id`, branching into the same campaign-activation path as Stripe above and returning early if it matches.
- On `PAYMENT.CAPTURE.COMPLETED` (subscription path), webhook:
  - verifies `custom_id`'s HMAC signature (`verifyPaymentReference`, the same verifier Stripe uses); rejects if missing, malformed, or tampered
  - requires a resolvable `plan_id` segment (rejects if missing or unresolvable)
  - verifies plan amount and currency
  - checks for an existing `payments` row by `paypal_payment_id` first (idempotency guard against redelivered events)
  - upserts `subscriptions` on `(user_id, app_id)`
  - inserts `payments`
  - inserts a notification
  - writes an audit log
  - emits n8n events
  - **No `profiles.user_type` write** — same as Stripe above.
- No refund/chargeback handling exists for PayPal yet.

### Admin payments

- Admin payments page uses `adminListPayments` server function to retrieve recent payment records.

## Environment variables used

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `N8N_WEBHOOK_URL`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `PAYPAL_CLIENT_ID`
- `PAYPAL_CLIENT_SECRET`
- `PAYPAL_WEBHOOK_ID`
- `PAYPAL_ENV` (defaults to `sandbox`)
- `PAYMENT_REF_SECRET` (signs the Stripe/PayPal payment reference — see Billing above)

> Note: each application's Google Client ID is stored in `applications.google_client_id` and resolved per-request by the Application Resolver, not hard-coded in `src/routes/login.tsx`.

## Build process

- Uses `npm` scripts from `package.json`:
  - `npm run dev`: start development Vite server
  - `npm run build`: build production app
  - `npm run build:dev`: development build mode
  - `npm run preview`: preview production build
  - `npm run lint`: ESLint
  - `npm run format`: Prettier
- `vite.config.ts` uses `@lovable.dev/vite-tanstack-config`.
- The TanStack Start server entry is configured to `src/server.ts`.
- Build output is produced by Vite/Nitro with TanStack Start integration.

## Deployment process

- The app is designed for deployment via Vite/TanStack Start server output.
- `src/server.ts` is the SSR server entrypoint.
- Server functions and API route handlers are bundled by TanStack Start.
- Supabase is used as backend DB, auth, storage, and RLS engine.
- Payment webhooks are exposed as public API routes.

The exact deployment target is not explicitly defined in repository files, but the Vite config and Lovable setup suggest deployment to a cloud environment supported by TanStack Start / Nitro.
