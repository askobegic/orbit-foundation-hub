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

**Application Resolver.** A Core-owned resolver determines which application the current request belongs to, from the request hostname, and supplies that application's branding (name, logo, favicon, colors, Google Client ID) to every surface that needs it — login, onboarding, dashboard, public profile. Nothing in the Core hardcodes a specific application's name or branding. See the Technical Appendix for the resolution/fallback order.

## Identity Lock

The identity provider (Google today) is the trusted source for a user's first name, last name, and profile photo. These are imported once, at first login, and become permanently locked the moment onboarding completes: no in-app "change name" or "change photo" feature exists for a standard user. If the provider supplied no photo, the user may upload exactly one, which then locks the same way. Locked fields render as plain identity information, never as editable form fields — including during onboarding itself, since the point of the lock is that the user never free-types their own name.

Future identity corrections (e.g. a user's legal name changes, or a locked value was wrong) are handled only through an administrator-controlled review process — not built yet, but the Core's Identity Service (see Technical Appendix) is the designated seam for it when it is.

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
- `hasAnyActivePremium(userId)` — TRUE if the user holds an active Premium subscription on *any* CORE application. The one and only "is this user Premium" check, used for the Profile Card's tier, Contact Actions eligibility, and every dashboard Premium badge.
- `getVisibleApplications(userId)` — the applications where the user currently has `is_visible = true`, ordered by `applications.sort_order`. Backs "Public profile on" above.

Both are backed by dedicated SQL functions (`has_any_active_premium`, `get_visible_application_ids`) using the exact same "active" predicate (`status = 'active' AND expires_at > now()`) that every other subscription-status check in this codebase uses (see `src/lib/subscription.ts`).

**Removed:** `isUserPremium(userId, appId)` and its backing `is_user_premium(_user_id, _app_id)` SQL function no longer exist — the per-application Premium check they implemented has no meaning under the Global Premium model and had zero remaining call sites. `get_premium_application_ids()` (the SQL function that backed the old "Premium on" list) is left in place, unused, rather than dropped, since nothing requested its removal.

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
- **Once a conversation exists, this check never runs again.** Sending a further message only requires being a participant in that conversation — not re-verified Premium, not re-verified `is_contactable`. A conversation keeps working even if one side's global Premium later lapses; this is a deliberate simplification (message-sending eligibility is participant-only, not re-derived per message), not an oversight.
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

Both already exist and are reused as-is, not rebuilt:
- "Share Profile" → the existing `/u/:username` URL (see Profiles) plus the existing copy-link/native-share behavior already implemented (`ShareAndInvite.tsx`'s `copyProfile`/`nativeShare`, using the Web Share API where available, falling back to copy+toast).
- "Invite a Friend" → the existing `ShareAndInvite.tsx` invite flow (`?ref=<username>` link, copy/native-share, an explicit "referral program coming soon" notice already present in its own copy) — the Profile Card's compact button opens this same existing flow, not a second implementation of it.

## Subscription Engine

The Core owns the subscription engine: what a user has purchased, for which application, at what price, for how long. Every application defines its own pricing plans (duration, price, currency) within the Core's shared `subscription_plans`/`subscriptions` model — pricing and duration are application-specific, but the engine that tracks and enforces entitlement is one shared system, not one per application.

A subscription always belongs to a specific `(user, application)` pair. See the Technical Appendix for the current schema and known correctness issues in how subscriptions are created/renewed (`PROJECT_AUDIT.md` → `DB-2`).

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
- Registering itself in the applications registry (branding, domain, status).
- Defining its own subscription plans, scoped to its own `app_id`.
- Reading the shared user/profile/entitlement data the Core already provides.

Any design that would require a new application to bring its own auth, its own user table, or its own billing logic is, by definition, not following this architecture and should be treated as a deviation to resolve, not a pattern to repeat.

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
- Sign-in method: Google, via `supabase.auth.signInWithIdToken` — `src/routes/login.tsx` loads Google Identity Services with the current application's own Google Client ID (from the Application Resolver) and hands the resulting ID token to Supabase. `AuthContext.tsx`'s `signInWithGoogle()` (a `signInWithOAuth`-based method) is intentionally disabled — it throws immediately if called, rather than performing a redirect sign-in — see "Google authentication must use `signInWithIdToken()` exclusively" above. `AuthContext.tsx` also exposes phone-OTP methods (`signInWithPhone`/`verifyOtp`); no route currently calls them either, and they are unrelated to the Google constraint.
- Identity import at first login/profile-creation uses the Core Identity Service (`src/lib/identity.ts`), not inline metadata parsing — see Identity Lock below.
- Auth state changes are handled by `supabase.auth.onAuthStateChange`.
- `ProtectedRoute` redirects unauthenticated users to `/login` and incomplete profiles to `/onboarding`.

### Application Resolver (implementation)

- `src/lib/application-resolver.functions.ts` exports `resolveApplication`, a `createServerFn` that reads the request's `Host` header (via `getRequest()`) and resolves the current application.
- Resolution order: exact match on `applications.domain` (production; always wins) → an explicit override slug, either passed in directly or read back from the `app_override` cookie set the first time it was chosen. No application is ever privileged as a "default" — there is no environment variable or fallback naming a specific application. If neither resolves, `resolveApplication` returns `null`.
- `src/context/ApplicationContext.tsx` calls it via `useQuery`/`useServerFn` (the same client-fetch pattern `AuthContext`/`LanguageContext` already use) and exposes `useApplication()`. On resolution, it also applies `document.title` and the favicon link tag app-wide, so branding does not need to be reproduced per page.
- When resolution returns `null` (no domain match and no stored override — local development, previews, or an unregistered host; never a real configured production domain), `ApplicationProvider` renders `src/components/dev/ApplicationSelector.tsx` in place of the app instead of guessing an application. It lists every `status = 'active'` application straight from the registry; picking one calls `resolveApplication` again with that slug as `overrideSlug`, which sets the `app_override` cookie server-side (`setCookie`, 30 days) so the choice persists across the whole session (login → onboarding → dashboard) without repeating the selection on every page load.
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
  - platform/app definitions and visual metadata: `id`, `name`, `slug`, `domain`, `logo_url`, `favicon_url`, `cover_image_url`, `primary_color`, `secondary_color`, `google_client_id`, localized short descriptions, `status`, `sort_order`
  - `google_client_id`: this application's own Google Cloud OAuth Client ID, consumed by the Application Resolver. Not secret (publicly readable, same as the rest of this table) — the Google Client Secret is never stored in the database, only in Supabase Auth's own Google provider configuration.
- `subscription_plans`
  - `app_id`-scoped: prices, currency, plan duration, Stripe/PayPal payment links, localized feature lists
- `subscriptions`
  - user subscriptions: `user_id`, `app_id`, `plan_id`, status, payment identifiers, amount, expiry; `UNIQUE(user_id, app_id)`
- `payments`
  - payment records for Stripe and PayPal, linked to `user_id`, `app_id`, `subscription_id`; `stripe_payment_id` and `paypal_payment_id` are both unique; `stripe_payment_intent_id` (nullable) is captured at fulfillment time so a later Stripe refund event can be matched back to this row
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

### Storage

- Single shared bucket, `core` (public), holds every upload — there is no per-purpose bucket. Purpose is distinguished by top-level folder prefix within it: `avatars/<user_id>/...` (user avatars) and `applications/<slug>/...` (application logos/favicons). URLs are permanent public URLs (`getPublicUrl`), not signed/expiring.

### Seed data

- `applications` is seeded with sample apps such as `Bosanci.pro`, `Muzika.ba`, `Svadba.ba`, `Gradovi.ba`, `Ticketaria.io`.

## RLS policies

Row-level security is enabled for tables and storage policies.

### Profiles

- `authenticated` users may `SELECT` their own profile and `INSERT` their own profile row.
- `UPDATE` is column-restricted: `authenticated` only has column-level `UPDATE` privilege on `first_name`, `last_name`, `avatar_url`, `city`, `country`, `username`, `bio`, `language`, `email`, `profile_complete` — `id`, `user_type`, `is_verified`, `is_active`, and `identity_locked_at` are writable only by `service_role`.
- **Identity Lock enforcement** (`first_name`/`last_name`/`avatar_url`) is a `BEFORE UPDATE` trigger (`enforce_identity_lock`), not a column-grant revoke like the columns above — deliberately, since these three columns are legitimately `authenticated`-writable up until the lock engages, unlike `user_type`/`is_verified`/`is_active`, which never are. The trigger compares `OLD`/`NEW` per update: it auto-sets `identity_locked_at` the instant `profile_complete` first becomes `true`, then rejects any further change to those three columns from non-`service_role` callers. `service_role` (Core) is exempt at every point, with no migration ever needed to "unlock" a user — a future admin-identity-change workflow uses the same exemption. An RLS predicate was deliberately not used for this: RLS cannot compare `OLD` vs `NEW` in one expression without an awkward self-join, and cannot derive/set a value at all, so it would still have needed a trigger for the auto-lock timestamp regardless.
- Admins (`private.has_role(..., 'admin')`) may `SELECT` all profiles.
- Public, unauthenticated access goes through the `profiles_public` view (masked columns only), not the base table.
- Profiles are auto-created client-side on first sign-in (`AuthContext.loadOrCreateProfile`), not via a database trigger — the `authenticated`-role `INSERT` policy on `profiles` (own row only) exists to support exactly this. A user created directly through the Supabase Admin API (not through the app's sign-in flow) has no `profiles` row until they first authenticate through the app.

### Premium profiles

- Authenticated users may manage only their own premium profile.
- `website`, `facebook_url`, `instagram_url`, `tiktok_url`, `youtube_url`, `linkedin_url`, and `x_url` each have a `CHECK` constraint requiring `NULL` or an `http(s)://` prefix, rejecting other URL schemes at the database level.
- Public access goes through the `premium_profiles_public` view, which masks each contact field behind its own `_public` boolean flag.

### Applications

- Publicly readable.
- Admins may manage all application records.

### Subscription plans

- Publicly readable only when `is_active = true`; `anon` reads a restricted column set (payment links excluded).
- Admins may manage all plans.

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

### Storage

- All objects live in the one `core` bucket; RLS is scoped by top-level folder prefix (`storage.foldername(name)[1]`), not by bucket id.
- `avatars/<user_id>/...`: publicly readable; only the owning user (via `foldername[2] = auth.uid()`) may insert/update/delete their own folder.
- `applications/<slug>/...`: publicly readable; only admins may write.

## Server functions

The app uses TanStack Start server functions in `/src/lib`.

### Admin server functions

Defined in `src/lib/admin.functions.ts`:
- `adminUpsertPlan`
- `adminDeletePlan`
- `adminGrantPremium`
- `adminRevokePremium`
- `adminListUsers` (paginated: `page`/`pageSize`; filterable by `search`, `premiumFilter` ("premium"/"standard", resolved live against `subscriptions` — not `profiles.user_type`), `is_verified`, `is_active`; each returned row carries a computed `is_premium` boolean)
- `adminUpdateUser` (edits `city`/`country`/`bio`/`username`/`email` only — `first_name`/`last_name`/`avatar_url` are excluded; those are under Identity Lock and reserved for a future administrator identity-review workflow, not general user-management editing)
- `adminSetUserActive` (suspend/reactivate — sets `profiles.is_active`; an admin cannot suspend their own account through this function)
- `adminDeleteUser` (admin-initiated deletion; shares its cascade-delete implementation — `deleteUserAccountCascade` in `admin.server.ts` — with the self-service GDPR deletion in `gdpr.functions.ts`, rather than duplicating it; an admin cannot delete their own account through this function)
- `adminListAuditLogs`
- `getMyIsAdmin`
- `adminOverviewStats`
- `adminSendNotification`
- `adminListPayments`
- `adminListVerificationRequests`
- `adminSetVerified`
- `adminCreateApplication`
- `adminSetAppEnabled`
- `adminUpdateAppSettings` (covers identity/branding fields — `name`, `slug`, `domain`, `primary_color`, `secondary_color`, `cover_image_url`, `sort_order`, `google_client_id` — in addition to logo/favicon/descriptions/enabled)

These functions use `requireSupabaseAuth` middleware, validate inputs with Zod, then either enforce admin status or execute service-role operations.

### Notification and support functions

Defined in `src/lib/notifications.functions.ts`:
- `notifyNewUserRegistered`
- `updateUserSettings`
- `markAllNotificationsRead`
- `markNotificationRead`
- `sendSupportRequest`

### Trial activation

Defined in `src/lib/trial.functions.ts`:
- `activateTrialIfEligible`
- Activates a 7-day trial when the user has no existing active subscription and has not used a trial before.

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
- `/admin/applications`: manage apps and subscription plans
- `/admin/users`: search/filter/paginate users, edit profile fields, suspend/reactivate/delete accounts, approve/revoke verification, grant/revoke premium, view audit logs
- `/admin/communication`: broadcast notifications to users
- `/admin/payments`: payments history via server function
- `/admin/verification`: approve or revoke verified user status

### Admin data flow

- Admin pages use `useServerFn` with admin server functions for privileged operations.
- Some admin pages also query Supabase directly for read-only data such as applications.

## Subscription system (implementation)

### Pricing and plans

- Plans are stored in `subscription_plans` and belong to applications.
- `pricing.tsx` lists active plans by app; on clicking "Pay with Stripe/PayPal" it calls `createPaymentReference` (server function) to obtain a signed reference, then redirects to the plan's stored payment link with that reference attached.
- Both Stripe (`client_reference_id`) and PayPal (`custom_id`) use the same signed format: `userId__appId__planId__hmac` (see Billing above).

### Trial activation

- `activateTrialIfEligible` grants a 7-day active subscription for all active apps when a user has no active subscription.
- It prevents reuse by checking for an existing `stripe_payment_id = 'trial_7days'` record.

### Subscription persistence

- Successful payment webhooks and admin grant operations `upsert` `subscriptions` on `(user_id, app_id)` — one row per user per app, refreshed in place on renewal, resubscribe-after-cancel, or repeat admin grant rather than inserted anew.
- Admin revoke operations, and a Stripe refund, update the existing row's `status`/`expires_at`.
- Subscriptions store expiry, payment ids, amount, currency, and status.

### Subscription UI

- Dashboard and `/dashboard/subscriptions` show current subscriptions, expiry, and status.
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
- On `checkout.session.completed`, webhook:
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
- On `PAYMENT.CAPTURE.COMPLETED`, webhook:
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
