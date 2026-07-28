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

**Known deviation from this rule:** the Premium Model (below) is intended to be scoped per application, but the current implementation of `is_user_premium()` and `premium_profiles` treats premium as a single global flag. This is tracked as an architecture deviation in `PROJECT_AUDIT.md` (`DB-4`) — the only remaining known architecture deviation — and should be corrected deliberately rather than worked around per-application.

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

Authentication is a Core service. A user signs in once (via Google OAuth or phone OTP today) and that session is what every application relies on. The Core issues and validates the session; applications never independently verify identity. See the Technical Appendix for the specific client/server auth flow currently implemented.

## Profiles

Every user has exactly one profile, owned by the Core, visible (in appropriate form) across every application. A profile carries identity fields (name, avatar, bio, username), locale preference, account status flags (`is_active`, `is_verified`), and account type (`user_type`). Applications read this profile; they do not maintain their own.

Premium contact details (phone, website, social links) live in a separate, still Core-owned, extended profile record — see Premium Model below.

## Roles

Platform-level roles (`admin`, `moderator`, `user`) are Core-owned and stored independently of the profile record, specifically so that a role can never be granted by editing profile data. A user can hold more than one role. Roles are platform-wide, not per-application — there is no such thing as "admin of one application only."

Operationally, the platform runs with a single administrator. There is no in-app role assignment, grant, or revoke interface, and none is planned as a Core feature — if a second administrator is ever needed, that role is granted manually via direct database access by the project owner. See `CLAUDE.md` → Single Administrator Rule.

## Permissions

Permission checks are enforced by the Core, on the server, every time — never inferred from client-supplied state and never trusted from a cached client value. A role grants a permission only when the server independently re-verifies it against the Core's role data at the moment of the privileged action.

## Premium Model

**Premium belongs to an application, not globally.** A user's premium status is an entitlement to a specific application (or applications), reflecting what that user has actually paid for — it is not a single platform-wide flag. Two users can each be "premium," one for `Muzika.ba` and one for `Svadba.ba`, without either having any entitlement on the other's application.

Premium unlocks application-specific business features (for the reference dashboard/bio-link implementation in this repo, that means public contact details, verified-style badges, and social links on a user's shared profile page) that are conceptually tied to the application the user paid for.

This is the intended model. See "Known deviation from this rule" above — the current implementation does not yet enforce per-application scoping for the premium check or for premium contact-detail storage, which is tracked in `PROJECT_AUDIT.md`.

## Subscription Engine

The Core owns the subscription engine: what a user has purchased, for which application, at what price, for how long. Every application defines its own pricing plans (duration, price, currency) within the Core's shared `subscription_plans`/`subscriptions` model — pricing and duration are application-specific, but the engine that tracks and enforces entitlement is one shared system, not one per application.

A subscription always belongs to a specific `(user, application)` pair. See the Technical Appendix for the current schema and known correctness issues in how subscriptions are created/renewed (`PROJECT_AUDIT.md` → `DB-2`).

## Billing

Billing (payment processing, payment records, invoices) is a Core service backed by Stripe and PayPal. Payment webhooks are the Core's responsibility — they verify the payment provider's signature, verify what was actually paid against what plan was referenced, and are the only place a subscription is granted as a result of a real payment. Applications never process payments themselves or maintain their own payment records.

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
    - dashboard routes: `dashboard.index.tsx`, `dashboard.notifications.tsx`, `dashboard.profile.tsx`, `dashboard.security.tsx`, `dashboard.settings.tsx`, `dashboard.subscriptions.tsx`, `dashboard.help.tsx`
    - admin routes: `admin.tsx`, `admin.applications.tsx`, `admin.communication.tsx`, `admin.payments.tsx`, `admin.users.tsx`, `admin.verification.tsx`
    - payment and pricing: `pricing.tsx`, `payment.success.tsx`
    - public user pages: `profile.$username.tsx`, `u.$username.tsx`, `u.$username.share.tsx`
    - API webhook routes: `api/public/webhooks/stripe.ts`, `api/public/webhooks/paypal.ts`
    - root route shell: `__root.tsx`
  - `components/`: reusable UI and page components
    - `auth/ProtectedRoute.tsx`
    - `dashboard/`: dashboard layout and widgets
    - `ui/`: UI primitives and shared controls
  - `context/`
    - `AuthContext.tsx`: auth state, session, and profile management
    - `LanguageContext.tsx`: i18n language management and sync
  - `integrations/`
    - `supabase/client.ts`: browser Supabase client
    - `supabase/client.server.ts`: service-role Supabase client for server operations
    - `supabase/auth-middleware.ts`: server auth middleware for authenticated server functions
    - `supabase/auth-attacher.ts`: client middleware attaching Supabase bearer token to serverFn calls
  - `lib/`
    - `admin.functions.ts`: server functions for admin operations
    - `admin.server.ts`: admin helpers, audit logging, expiry math
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
- Sign-in methods supported:
  - Google via `supabase.auth.signInWithOAuth` and `supabase.auth.signInWithIdToken`
  - phone OTP via `supabase.auth.signInWithOtp` / `verifyOtp`
- Auth state changes are handled by `supabase.auth.onAuthStateChange`.
- `ProtectedRoute` redirects unauthenticated users to `/login` and incomplete profiles to `/onboarding`.

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
  - fields: `id`, `email`, `first_name`, `last_name`, `avatar_url`, `city`, `country`, `username`, `bio`, `language`, `user_type`, `is_verified`, `is_active`, `profile_complete`, timestamps
- `premium_profiles`
  - extended premium contact details and social links (`user_id` unique, no `app_id` — see Premium Model deviation above and `PROJECT_AUDIT.md` → `DB-4`)
- `applications`
  - platform/app definitions and visual metadata: `id`, `name`, `slug`, `domain`, `logo_url`, `favicon_url`, `cover_image_url`, `primary_color`, `secondary_color`, localized short descriptions, `status`, `sort_order`
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

### Storage

- `avatars` bucket: user avatars are uploaded and signed URLs created.
- `app-logos` bucket: admin-controlled app logo storage.

### Seed data

- `applications` is seeded with sample apps such as `Bosanci.pro`, `Muzika.ba`, `Svadba.ba`, `Gradovi.ba`, `Ticketaria.io`.

## RLS policies

Row-level security is enabled for tables and storage policies.

### Profiles

- `authenticated` users may `SELECT` their own profile and `INSERT` their own profile row.
- `UPDATE` is column-restricted: `authenticated` only has column-level `UPDATE` privilege on `first_name`, `last_name`, `avatar_url`, `city`, `country`, `username`, `bio`, `language`, `email`, `profile_complete` — `id`, `user_type`, `is_verified`, and `is_active` are writable only by `service_role`.
- Admins (`private.has_role(..., 'admin')`) may `SELECT` all profiles.
- Public, unauthenticated access goes through the `profiles_public` view (masked columns only), not the base table.
- Profiles are auto-created on auth user creation via a trigger.

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
- No direct public read policy; the scoped `is_user_premium()` function is the public-facing surface.

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

### Audit logs

- Only `service_role` can access audit logs; no public/authenticated read policy is defined.

### Storage

- Avatar uploads are restricted to user-owned folder paths: `avatars/<user_id>/...`.
- App logos are managed by admins only.

## Server functions

The app uses TanStack Start server functions in `/src/lib`.

### Admin server functions

Defined in `src/lib/admin.functions.ts`:
- `adminUpsertPlan`
- `adminDeletePlan`
- `adminGrantPremium`
- `adminRevokePremium`
- `adminListUsers`
- `adminListAuditLogs`
- `getMyIsAdmin`
- `adminOverviewStats`
- `adminSendNotification`
- `adminListPayments`
- `adminListVerificationRequests`
- `adminSetVerified`
- `adminCreateApplication`
- `adminSetAppEnabled`
- `adminUpdateAppSettings` (covers identity/branding fields — `name`, `slug`, `domain`, `primary_color`, `secondary_color`, `cover_image_url`, `sort_order` — in addition to logo/favicon/descriptions/enabled)

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

### Server helpers

- `src/lib/admin.server.ts`
  - `assertAdmin()`: verifies admin role using `user_roles`
  - `writeAuditLog()`: inserts audit log records via service-role client
  - `addMonthsIso()`: calculates subscription expiry dates
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

## Admin architecture

### Admin protection

- `src/routes/admin.tsx` wraps admin pages with `ProtectedRoute` and an `AdminGate` that blocks the `<Outlet/>` for non-admins.
- Client-side admin check reads `user_roles` and redirects non-admins to `/dashboard`.
- Server functions enforce admin role using `assertAdmin()` and service-role operations.

### Admin panels

- `/admin`: admin overview and quick links
- `/admin/applications`: manage apps and subscription plans
- `/admin/users`: search users, grant/revoke premium, view audit logs
- `/admin/communication`: broadcast notifications to users
- `/admin/payments`: payments history via server function
- `/admin/verification`: approve or revoke verified user status

### Admin data flow

- Admin pages use `useServerFn` with admin server functions for privileged operations.
- Some admin pages also query Supabase directly for read-only data such as applications.

## Subscription system (implementation)

### Pricing and plans

- Plans are stored in `subscription_plans` and belong to applications.
- `pricing.tsx` lists active plans by app and builds payment links for Stripe and PayPal.
- Stripe links use `client_reference_id` in the format `userId__appId__planId`.
- PayPal links use `custom_id` in the format `userId_appId_planId`.

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
  - parses `client_reference_id`; requires a resolvable `plan_id` segment (rejects if missing or unresolvable)
  - verifies plan amount and currency
  - checks for an existing `payments` row by `stripe_payment_id` first (idempotency guard against redelivered events)
  - upserts `subscriptions` on `(user_id, app_id)`
  - inserts `payments`, capturing `stripe_payment_intent_id` for later refund matching
  - updates `profiles.user_type` to `premium`
  - inserts a notification
  - writes an audit log
  - emits n8n events
- On `charge.refunded`, webhook:
  - matches the refund to its `payments` row via `stripe_payment_intent_id`
  - marks that row `status = 'refunded'`
  - cancels the associated subscription (`status = 'cancelled'`, `expires_at = now()`)
  - reverts `profiles.user_type` to `standard`, unless the user has another currently-active subscription to a different app
  - writes an audit log
  - `charge.dispute.created` is not handled (no `'disputed'` payment status exists yet)

### PayPal

- Webhook endpoint at `/api/public/webhooks/paypal` verifies signature against PayPal.
- On `PAYMENT.CAPTURE.COMPLETED`, webhook:
  - parses `custom_id`; requires a resolvable `plan_id` segment (rejects if missing or unresolvable)
  - verifies plan amount and currency
  - checks for an existing `payments` row by `paypal_payment_id` first (idempotency guard against redelivered events)
  - upserts `subscriptions` on `(user_id, app_id)`
  - inserts `payments`
  - updates `profiles.user_type` to `premium`
  - inserts a notification
  - writes an audit log
  - emits n8n events
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

> Note: Google client ID is hard-coded in `src/routes/login.tsx`.
> Note: `.env.example` is currently out of sync with this list — see `PROJECT_AUDIT.md` → `A-2`.

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
