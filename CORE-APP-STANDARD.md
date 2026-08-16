# CORE-APP-STANDARD.md

**Version:** 1.0  
**Status:** Mandatory architecture standard  
**Scope:** All current and future applications connected to the CORE platform

---

## 1. Purpose

This document defines the mandatory architecture and development rules for every application that belongs to the CORE ecosystem.

It is the common baseline for applications such as:

- BosniaFans
- Gradovi.ba
- Muzika.ba
- Svadba.ba
- Stampa.ba
- Shop.ba / Eshop.ba
- Ticketaria
- all future CORE-connected applications

An individual application may add its own business rules, but it must not contradict this standard without an explicit CORE architecture decision.

---

# 2. Core Architecture Principle

Every application is an independent product.

Every application has:

- its own frontend
- its own business logic
- its own Supabase project/database
- its own production deployment
- its own assets/media
- its own backup and disaster-recovery procedure

Every application communicates with CORE for shared platform functions.

CORE is the central system for shared identity and platform capabilities.

### High-level architecture

    CORE
      │
      ├── Authentication
      ├── Users
      ├── Profiles
      ├── Roles & Permissions
      ├── Global Premium
      ├── Billing
      ├── Rewards
      └── Shared Services
             │
       ┌─────┼──────────────┐
       │     │              │
    App A  App B          App C
       │     │              │
   Supabase Supabase   Supabase
       │     │              │
   Hostinger Cloud / production deployment
       │
    App-specific assets

---

# 3. Separation of Responsibilities

## CORE owns

CORE is the single source of truth for shared functionality, including:

- authentication
- user identity
- user profiles where centrally defined
- roles
- permissions
- global Premium status
- billing/subscription infrastructure
- Rewards
- shared platform services
- shared API capabilities

Applications must consume CORE services rather than reimplementing them.

## Individual applications own

Each application owns its own:

- business logic
- application-specific database entities
- application-specific content
- application-specific workflows
- application-specific UI
- application-specific SEO content
- application-specific media/content metadata

An application must not move its unique business logic into CORE merely because it is convenient.

## Future Application Rule

CORE-connected applications must be treated as dynamic. New applications will be added after this standard is written.

CORE standards must never depend on a fixed list of application names.

Do not implement shared CORE functionality using architecture such as:

    if app === "BosniaFans"
    if app === "Muzika"
    if app === "Svadba"

Use instead:

- application context
- configuration
- capabilities
- permissions
- entitlements
- product configuration
- generic APIs

This rule applies to every current and future CORE-connected application, without exception.

---

# 4. Database Isolation

Every application must have its own Supabase project.

Example:

    BosniaFans → Supabase A
    Gradovi    → Supabase B
    Muzika     → Supabase C
    Svadba     → Supabase D

Do not place unrelated application business data into one shared application database.

CORE data and application business data must remain logically separated.

The application communicates with CORE through approved APIs/services.

---

# 5. Hosting Standard

Each application is independently deployed.

The production environment uses Hostinger Cloud according to the project's deployment architecture.

The application's domain is connected to its production deployment.

Application assets and graphics are hosted/managed on Hostinger Cloud according to the approved deployment structure.

Examples:

    bosniafans.com → BosniaFans production
    gradovi.ba     → Gradovi production
    muzika.ba      → Muzika production
    svadba.ba      → Svadba production

Do not assume that one application's deployment failure should automatically affect another application's production availability.

---

# 6. Design and UI Workflow

The approved design is the visual source of truth.

## V0 role

v0 is used for:

- UI design
- screenshot-based design reproduction
- frontend prototyping
- reusable UI components
- responsive UI
- design-system preparation

v0 is NOT the authority for:

- backend architecture
- database architecture
- CORE architecture
- authentication architecture
- billing architecture
- Rewards architecture
- application business logic

## Design workflow

    Screenshot / approved design
             ↓
            v0
             ↓
    UI + reusable components
             ↓
          GitHub
             ↓
        Claude Code
             ↓
    complete application

The v0 output is a frontend/design starting point.

The application must not depend on v0 at runtime.

If v0 becomes unavailable, an already deployed application must continue operating normally.

---

# 7. Claude Code Role

Claude Code is the implementation/development layer.

Claude Code is responsible for:

- implementing the approved UI
- frontend functionality
- backend/API implementation
- application business logic
- Supabase integration
- CORE integration
- security
- SEO
- internationalization
- analytics integrations
- testing
- error handling
- deployment preparation
- documentation
- backup/recovery implementation where applicable

Claude Code must not redesign an approved UI without explicit approval.

---

# 8. Mandatory Design Rules

When approved screenshots/designs are provided:

- treat them as the visual source of truth
- do not redesign the layout
- do not remove sections
- do not add sections without approval
- preserve visual hierarchy
- preserve spacing and alignment
- preserve typography
- preserve card proportions
- preserve button styles
- preserve colors
- preserve responsive behavior

Build reusable components instead of duplicating similar UI.

Examples:

- Header
- Navigation
- Hero
- CategoryCard
- ArticleCard
- MemberCard
- CommunityPostCard
- BusinessCard
- EventCard
- ProductCard
- RecommendationCard
- CTA
- Footer

The same component should be reused wherever the same visual pattern occurs.

---

# 9. Responsive Design

Desktop and mobile are intentional layouts.

Do not simply scale the desktop layout down.

Each application must be tested for:

- desktop
- tablet where relevant
- mobile
- touch interaction
- small screens
- large screens
- no horizontal overflow
- readable typography
- accessible controls

If a mobile screenshot is supplied, it is a visual source of truth for the mobile implementation.

---

# 10. Global Premium Model

Premium is GLOBAL across the CORE ecosystem.

A user purchases Premium once.

An active Premium status applies across all CORE-connected applications.

Examples:

- BosniaFans
- Svadba
- Gradovi
- Muzika
- Ticketaria
- future applications

Applications must never create their own separate Premium permission system.

Applications ask CORE whether the user has active global Premium.

### Important distinction

Billing/subscription records may remain application-scoped where required for pricing, plans, accounting, or commercial configuration.

The derived Premium permission is global.

Do not create application-specific Premium permission checks.

## Application Premium Benefits

Global Premium and Application Premium Benefits are not the same thing.

Global Premium:

→ one user-level membership, recognized by every application.

Application Premium Benefits:

→ additional functionality an application unlocks for users who already have Global Premium.

Application Premium Benefits:

- belong to the individual application
- are defined and implemented by that application
- may differ between applications
- do not create a second Premium membership
- do not require the application to sell Premium

Example:

A user has Global Premium.

Muzika.ba may unlock additional musician-related Premium features for that user.

Svadba.ba may unlock different wedding-related Premium features for the same user.

Both are benefits of the same Global Premium status, not two Premium memberships.

## Premium Sale Availability

An application may independently choose:

    Premium Sale = ON
    or
    Premium Sale = OFF

without creating a second Premium system.

Supported configurations:

1. Premium Sale ON + Application Premium Benefits
2. Premium Sale ON + no additional benefits
3. Premium Sale OFF + Application Premium Benefits (existing Global Premium users still receive them)
4. Premium Sale OFF + application-specific paid products (see Application-Specific Commercial Products below)
5. Premium Sale OFF + no commercial products

Disabling Premium Sale for an application must never affect any user's existing Global Premium status — it only means that application currently offers no way to purchase a new one.

This is an outcome of the generic product configuration already required by this standard (an application simply has no active Premium product), not a separate "premium_enabled" mechanism.

## Premium Plans, Durations & Pricing

Premium commercial plans are configuration-driven, not hardcoded.

The generic product model supports multiple plan durations, for example:

- 1 month
- 3 months
- 6 months
- 12 months

An application/administrator may choose to offer only some of these durations — not every duration needs to exist or be active for every application.

Example (illustrative only — not a fixed CORE price):

    1 month   = €4.90
    12 months = a separately configured annual price

Prices, currencies, and durations belong to product configuration. They must never be hardcoded into application or CORE logic.

## Application-Specific Commercial Products

Applications may sell products other than Global Premium, using CORE's generic payment and entitlement infrastructure — this is a related but distinct concept from Global Premium above, documented here because both are commercial/entitlement concepts.

Examples:

- Musician Listing
- Vendor Listing
- Professional Listing
- Studio Listing
- Sponsored Listing
- Featured Listing
- other future application-specific products

These products are NOT Global Premium. See Separation of Responsibilities above: the application owns what the product means; CORE owns the generic payment/entitlement mechanism that delivers it.

### Listing

A Listing product may grant an application-specific entitlement.

Example:

    musician_listing

The application decides what that entitlement means and how the listing is displayed.

CORE provides the generic payment/entitlement infrastructure only. CORE must not contain "Musician" business logic, or any other application's business logic.

### Sponsored

Sponsored is a separate application-specific product, using the same mechanism as Listing.

Example:

    sponsored_musician

Sponsored can optionally require an existing Listing entitlement.

The dependency itself is generic — CORE does not know that `musician_listing` means a musician. It only knows that one configured benefit can optionally depend on another configured benefit.

### Entitlement Model (conceptual)

    Global Premium
    → global user-level status

    Application-specific benefits
    → application-scoped entitlements

    Products
    → may grant Premium
    → may grant an application benefit
    → may grant both
    → may grant neither

    Dependencies
    → optional
    → configured per product

This is the conceptual model only. The detailed technical implementation (database schema, specific functions, API endpoints) is owned by each project's own implementation documentation (for the CORE platform itself, `PROJECT_KNOWLEDGE.md`) — not duplicated here.

---

# 11. Profile Rules

Every user can edit every available profile field.

Premium must not be used as a general edit lock.

Premium affects permissions and visibility according to the CORE model.

## Standard public profile

A standard public profile exposes only the fields defined by CORE as public standard fields, currently including:

- profile photo
- full name
- city
- country

## Premium public profile

A Premium profile can expose additional enabled information according to the user's privacy/public settings.

Possible fields include:

- biography
- profession
- website
- email
- phone
- WhatsApp
- Viber
- social links
- future approved profile fields

Do not expose information that the user has not enabled for public visibility.

---

# 12. Profile Visibility

`is_visible` is application-specific.

Meaning:

> Does this application have a public profile for this user?

If `is_visible = false`, the public profile must not exist on that application.

Do not downgrade a hidden profile into a Standard profile.

Public profile viewing itself is not a Premium-only feature.

---

# 13. Contact Permissions

Contacting members is a Premium feature.

Contact methods may include:

- internal messages
- email
- phone
- WhatsApp
- Viber
- future contact methods

A Premium user may contact another Premium user according to CORE permissions.

The application where the Premium subscription was purchased does not matter.

Premium permission is ecosystem-wide.

## Standard users

Standard users may:

- browse public profiles
- read permitted public information

Standard users may not perform Premium contact actions.

The UI should show the appropriate Premium upgrade flow.

## `is_contactable`

`is_contactable` is application-specific.

If false:

- hide or disable contact actions according to the approved UX.

If true:

- contact is allowed only when CORE permissions permit it.

---

# 14. Application Profile Badges

Application badges may represent the applications where the user has a visible profile.

If a public profile exists on the selected application:

→ open that profile.

If no public profile exists:

→ open the application homepage.

Do not incorrectly represent application-specific Premium status as global Premium status.

---

# 15. Rewards Standard

Rewards are a CORE service shared across applications.

An application sends an action/event to CORE.

The application does NOT send a hardcoded point value.

Example:

    business_approved
    invite_registration
    vendor_approved
    podcast_published
    comment_created
    share_created

CORE resolves the action through the reward-action rules.

CORE determines:

- points
- whether the action is enabled
- cooldown
- maximum repetitions
- other rule constraints

Administrators must be able to change reward values without modifying application code.

---

# 16. Reward Points

CORE supports two point concepts.

## Reward Points

Points that can be spent/redeemed.

## Lifetime Points

Points that never decrease.

Lifetime Points are used for:

- level progression
- activity history
- long-term contribution measurement

---

# 17. Reward Levels

Levels are determined by Lifetime Points.

The level thresholds are administrator-configurable.

The system may support:

- Member
- Bronze
- Silver
- Gold
- Platinum
- Legend

Applications must not hardcode level thresholds.

---

# 18. Achievements

Achievements are shared CORE functionality.

Examples:

- First Invite
- First Post
- 100 Posts
- Verified Vendor
- Top Contributor

Achievements must be rule-driven and reusable across applications.

---

# 19. Referrals

Referral logic belongs to CORE.

A referral is not automatically considered verified when an invitation occurs.

Verification may depend on configurable conditions such as:

- registration
- Premium purchase
- Premium retention period
- other administrator-defined criteria

The verification period must be configurable.

---

# 20. Rewards Catalogue

CORE may provide universal rewards such as:

- Premium time
- Advertising Credit
- Featured Profile
- Featured Business
- Featured Event
- Profile Badge
- other reusable ecosystem rewards

Application-specific rewards may be supported only when the architecture clearly separates the application-specific reward definition from CORE's common reward engine.

---

# 21. Reward Administration

Administrators must be able to:

- enable/disable reward actions
- change point values
- configure cooldowns
- configure limits
- manage achievements
- manage levels
- manage rewards
- manage referral rules

No reward value should be hardcoded into an individual application when the rule belongs to CORE.

---

# 22. Security Standard

Every application must follow secure-by-default development.

Mandatory principles:

- never expose secrets
- never commit API keys or credentials
- validate all input
- authorize every protected operation
- use server-side authorization for sensitive actions
- protect against injection
- protect against XSS
- protect against CSRF where applicable
- validate file uploads
- restrict upload types and sizes
- use secure storage policies
- use least-privilege access
- protect admin functions
- never trust client-side permission checks
- log security-relevant events
- do not expose sensitive database errors to users

CORE permissions must be enforced server-side.

---

# 23. Internationalization

Every CORE-connected application must support the languages defined by its specification.

Default BosniaFans requirement:

- Bosnian
- English
- German

Do not hardcode user-facing strings throughout components.

Use a central translation structure.

New UI text must be added to all required locales.

Language switching must not require separate application builds.

---

# 24. SEO Standard

Public content applications must be SEO-ready.

Required considerations include:

- semantic HTML
- unique page titles
- meta descriptions
- canonical URLs
- Open Graph metadata
- structured data where appropriate
- clean URLs
- indexable public content
- proper headings
- image alt text
- sitemap
- robots configuration
- internal linking
- localized SEO where applicable

Do not sacrifice SEO by making important public content inaccessible to crawlers.

---

# 25. Analytics and Tracking

Where required by the individual application specification, implement:

- Facebook Pixel / Meta Pixel
- Microsoft Clarity
- other approved analytics tools

Tracking must respect the application's privacy/cookie requirements.

Do not hardcode tracking IDs in source code if configuration/environment variables are appropriate.

---

# 26. Error Handling

A failure of one dependency must not unnecessarily crash the entire application.

Examples:

If CORE is temporarily unavailable:

- public application content should remain available where technically possible
- authentication-dependent functions may be temporarily unavailable
- Premium/Rewards-dependent functions should fail gracefully
- users should receive a clear non-technical message

If Supabase is temporarily unavailable:

- show graceful error/empty states
- do not expose raw database errors
- retry where appropriate
- avoid infinite retry loops

If an image or external asset fails:

- use a fallback
- preserve layout dimensions
- do not break the page

---

# 27. Health Checks

Production applications should provide appropriate health checks for critical services.

Examples:

    /api/health
    /api/health/core
    /api/health/database

Health checks should allow administrators/monitoring systems to distinguish:

- application availability
- CORE availability
- database availability
- critical dependency failures

Do not expose sensitive internal information through public health endpoints.

---

# 28. Backup Standard

Every application must have a documented backup strategy.

## Code

- GitHub repository
- version history
- ability to restore a known-good version

## Database

- automated Supabase backups according to the selected plan
- defined retention policy
- tested restore procedure

## Storage

Back up important:

- images
- user uploads
- documents
- media
- application assets

## Configuration

Document:

- environment variables
- deployment configuration
- external service configuration

Never store secrets in Git.

---

# 29. Disaster Recovery

Every application must have a Disaster Recovery procedure.

The procedure must define how to recover from:

- Hostinger outage
- Supabase outage
- database corruption
- storage loss
- deployment failure
- bad release
- compromised credentials
- external API outage
- CORE outage

Recovery must be possible from:

- GitHub source
- database backup
- storage/media backup
- documented configuration
- deployment documentation

The recovery process must be tested periodically.

---

# 30. No Single Point of Failure Where Avoidable

No application should depend on a single unbacked copy of:

- code
- database
- media
- configuration

The failure of a development tool must never mean loss of the production application.

v0 is not a production dependency.

Claude Code is not a production dependency.

GitHub is not a runtime dependency.

CORE is a critical shared dependency and therefore must have its own reliability and recovery strategy.

---

# 31. External Services

Every external service must have:

- a clearly defined purpose
- documented credentials/configuration
- timeout handling
- error handling
- fallback behavior where possible
- monitoring where appropriate

Do not make an external service a hidden dependency.

---

# 32. Application Boundaries

Applications must remain specialized.

Examples:

- BosniaFans = community, members, diaspora, BiH content and broad discovery
- Gradovi.ba = local/city information and local business ecosystem
- Muzika.ba = music ecosystem and music-specific events/booking
- Svadba.ba = wedding ecosystem
- Shop.ba / Eshop.ba = full multivendor commerce
- Stampa.ba = printing ecosystem

A general feature should not automatically be duplicated across every application.

Use CORE for truly shared platform functionality.

Use the specialized application for specialized business logic.

---

# 33. Code Quality

Claude Code must:

- use reusable components
- avoid unnecessary duplication
- keep modules focused
- use clear naming
- preserve type safety
- avoid dead code
- avoid temporary hacks in production
- document non-obvious architectural decisions
- keep generated files generated by their official process
- avoid manually editing generated files when regeneration is available

---

# 34. Testing

Before production release, test:

- authentication
- permissions
- CORE communication
- database operations
- public pages
- protected pages
- forms
- file uploads
- responsive layouts
- translations
- SEO metadata
- analytics consent/integration
- error states
- critical business flows
- backup/recovery procedures where applicable

Critical permission logic must have automated tests.

---

# 35. Development Protocol

Before implementing a major architectural task, Claude Code must:

1. inspect the existing codebase
2. identify existing relevant functionality
3. compare it with the requested behavior
4. identify conflicts
5. identify files/components affected
6. identify database/schema changes
7. identify possible regressions
8. prepare an implementation plan
9. wait for approval when the project workflow requires approval

Do not silently rewrite unrelated functionality.

Do not silently change architectural decisions.

Do not invent missing requirements.

---

# 36. Change Control

If a requested change conflicts with this standard:

- identify the conflict
- explain the impact
- do not silently bypass the standard
- request an explicit architecture decision

If a change is application-specific and does not affect CORE architecture, it may remain inside the application.

---

# 37. Project Documentation

Every application should contain:

    README.md
    CLAUDE.md
    ARCHITECTURE.md
    ENVIRONMENT.md
    DEPLOYMENT.md
    DISASTER-RECOVERY.md
    SECURITY.md

Where appropriate:

    API.md
    DATABASE.md
    DESIGN-SYSTEM.md
    SEO.md
    I18N.md

---

# 38. Mandatory CLAUDE.md Rule

Every CORE-connected application must have a `CLAUDE.md`.

The file must state:

> This application is part of the CORE ecosystem.

It must instruct Claude Code to read:

- CORE-APP-STANDARD.md
- application specification
- architecture documentation
- security rules
- approved design documentation

before making major architectural changes.

---

# 39. Source of Truth Hierarchy

When instructions conflict, use this hierarchy:

1. Explicit current architecture decision
2. CORE architecture standard
3. Application specification
4. Approved design
5. Existing implementation
6. Developer convenience

Security and data protection requirements always take precedence over convenience.

---

# 40. Final Pre-Launch Checklist

Before production:

### Architecture
- [ ] CORE integration confirmed
- [ ] own Supabase project confirmed
- [ ] own application business logic confirmed
- [ ] no duplicated CORE functionality
- [ ] application boundaries confirmed

### Design
- [ ] approved desktop design implemented
- [ ] approved mobile design implemented
- [ ] reusable components used
- [ ] no unauthorized redesign

### Security
- [ ] secrets protected
- [ ] server-side authorization verified
- [ ] input validation verified
- [ ] upload security verified
- [ ] admin security verified

### Platform
- [ ] 3 languages where required
- [ ] SEO implemented
- [ ] Meta Pixel where required
- [ ] Microsoft Clarity where required

### Reliability
- [ ] health checks
- [ ] error handling
- [ ] database backup
- [ ] storage backup
- [ ] code backup
- [ ] disaster recovery procedure
- [ ] restore procedure documented

### Deployment
- [ ] Hostinger Cloud production configured
- [ ] domain connected
- [ ] assets configured
- [ ] environment variables configured securely
- [ ] production build tested

---

# 41. Universal Pre-Launch / Public Launch Standard

This standard applies to every CORE-connected application. It does not apply to CORE itself — CORE is the platform providing this infrastructure, not a consumer of it.

## Launch status

Every CORE-connected application has exactly one launch status: `PRE_LAUNCH` or `PUBLIC`. A newly created application always starts `PRE_LAUNCH`. It never becomes `PUBLIC` automatically — not because development finished, not because a deployment succeeded, not because a domain was connected. Only an explicit administrator action changes it.

## While PRE_LAUNCH

The application's main production domain and normal URL structure are used from day one — there is no separate coming-soon domain and no URL migration at launch. While `PRE_LAUNCH`:

- An ordinary public visitor may access only the application's Pre-Launch Front Page, at every URL. A direct request to any other application route returns the visitor to the Pre-Launch Front Page. This is enforced at the application's actual access/authorization layer — never by hiding navigation, buttons, or links alone.
- The application's authorized administrator has full, unrestricted access to the entire application, for testing, configuration, and quality control.
- The administrator may explicitly authorize specific individual users as test users, who then get access to the application per the access granted. Test access is per-application, not global, and is never hardcoded to a specific user or application.
- A normal registered user who has not been authorized as a test user sees the Pre-Launch Front Page only, exactly like a public visitor.
- The auth bootstrap flow (sign in, register) remains reachable regardless of launch status — a visitor cannot be authorized as the administrator or a test user without first being able to sign in.

## Pre-Launch Front Page

A configurable public entry page, owned by the application (not hardcoded by CORE), that may show a logo, one banner image, a title, information text, a "currently being prepared" message, and social/contact links where configured. Content is application-specific; CORE provides the mechanism, never the branding.

## Going PUBLIC

Moving from `PRE_LAUNCH` to `PUBLIC` is always one explicit administrator action. It changes access availability only — domain, URLs, routes, architecture, and business logic are unaffected, since `PRE_LAUNCH` is an access state of the application, not a separate website.

## CORE's role

CORE provides the generic launch-state mechanism and the generic access-control read every connected application uses to decide, for its own routes, whether the current caller may proceed: current launch status, the configured Pre-Launch content, and whether the caller is the administrator or an authorized test user. The connected application owns enforcing this on its own pages — CORE never absorbs an application's business routes to do this for it. See `PROJECT_KNOWLEDGE.md` → Pre-Launch / Public Launch and `API_CONTRACT.md` → Applications (`GET /v1/me/launch-access`) for the CORE-side implementation.

---

# 42. Permanent Rule

Every future CORE-connected application must start from this standard.

The application-specific specification defines what the application does.

The approved design defines how it looks.

CORE defines shared platform capabilities.

Supabase stores the application's business data.

Hostinger Cloud provides the production hosting/domain/assets according to the deployment architecture.

GitHub preserves the source code.

Claude Code implements and maintains the application.

v0 provides the approved UI/design starting point.

No individual application may silently redefine these responsibilities.
