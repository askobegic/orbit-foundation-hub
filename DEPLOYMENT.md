# DEPLOYMENT.md — Production Deployment Guide (Hostinger Cloud Startup)

Operational runbook for deploying this application to a Hostinger **Cloud Startup** hosting plan. This is not one of the four permanent architecture documents (`CLAUDE.md`, `PROJECT_KNOWLEDGE.md`, `PROJECT_AUDIT.md`, `API_CONTRACT.md`) — it describes *how to deploy*, not how the platform is designed or governed.

Last verified against commit `213da03` (2026-08-05), by actually running the build and boot steps below against a local Node process.

## 0. Important: build target override

This project is built with [Nitro](https://nitro.build) via `@lovable.dev/vite-tanstack-config`, which **defaults to a Cloudflare Workers build target** (`cloudflare-module` preset — confirmed by the `.output/server/wrangler.json` a default build produces). Hostinger Cloud Startup runs plain Node.js processes, not Cloudflare Workers, so every build for Hostinger **must** override the preset to `node-server`:

```
NITRO_PRESET=node-server
```

This is a build-time environment variable, not a code change — no file in the repository needs editing. It was verified locally: with `NITRO_PRESET=node-server`, the build produces `.output/server/index.mjs` (a plain Node HTTP server, confirmed via `.output/nitro.json`'s `"preset": "node-server"` and `"commands": {"preview": "node ./server/index.mjs"}`), and that file was started directly with `node` and confirmed to serve the app (`HTTP 200`, full HTML response) on a local port. Without this override, the build output targets the Cloudflare Workers runtime and will not run under plain Node.

## 1. Prerequisites

- A Hostinger **Cloud Startup** (or higher) plan with the **Node.js Application** feature and **SSH access** enabled (both are included on Cloud plans).
- A domain or subdomain pointed at the hosting account.
- A **production** Supabase project with every migration under `supabase/migrations/*.sql` already applied, and the `core` Storage bucket created (used for avatars, campaign banners, and application branding uploads — see `src/lib/media-storage.ts`).
- Production Stripe and PayPal accounts/API keys.
- A generated RS256 keypair for the `/v1` API's JWT signing (`V1_JWT_PRIVATE_KEY` / `V1_JWT_KEY_ID` — see §3). Generate this **once** and keep it stable across every future deploy; regenerating it invalidates every previously-issued access token and changes the published JWKS.

## 2. Node.js version

- **Required range:** `^20.19.0 || >=22.12.0` (this is `vite`'s and `nitro`'s own `engines` constraint — the build tooling will not run outside it).
- **Recommended:** Node.js **22 LTS** (22.12 or newer), selected via Hostinger's Node.js version selector in hPanel.

## 3. Environment variables

Two categories. **Build-time** variables are baked into the client JavaScript bundle by Vite when `npm run build` runs and must be present (via a `.env` file in the project root, or exported in the shell) *at build time*. **Runtime** variables are read by the running server process via `process.env` and are configured in Hostinger's Node.js App → Environment Variables panel. The build-time `VITE_*` variables are harmless to also set at runtime, but the runtime-only server secrets must **never** be exposed as `VITE_*` variables — anything prefixed `VITE_` ships to the browser.

### Build-time (`VITE_*`)

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Production Supabase project URL. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase anon/publishable key (client-side). |
| `VITE_SUPABASE_PROJECT_ID` | Supabase project ref. |
| `VITE_APP_URL` | The final production URL (e.g. `https://yourdomain.com`) — used by the integration layer for redirect/callback construction. |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Stripe **live** publishable key. |

### Runtime (server-only secrets)

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Same Supabase project URL, read server-side. |
| `SUPABASE_PUBLISHABLE_KEY` | Same anon key, read server-side. |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key — used for every admin/service-role operation. Never expose this as a `VITE_*` variable. |
| `STRIPE_SECRET_KEY` | Stripe **live** secret key. |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for the Stripe webhook endpoint (see §6). |
| `PAYPAL_CLIENT_ID` | PayPal REST app client ID. |
| `PAYPAL_CLIENT_SECRET` | PayPal REST app client secret. |
| `PAYPAL_WEBHOOK_ID` | PayPal webhook ID (for signature verification). |
| `PAYPAL_ENV` | Must be set to `live` for production (defaults to `sandbox` if unset — see `src/routes/api/public/webhooks/paypal.ts`). |
| `PAYMENT_REF_SECRET` | Signs the payment reference threaded through Stripe/PayPal checkout. Generate once: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `N8N_WEBHOOK_URL` | n8n automation webhook endpoint. |
| `V1_JWT_PRIVATE_KEY` | Base64-encoded PKCS8 RS256 private key for the `/v1` API JWT. Generate once (see below) and keep stable. |
| `V1_JWT_KEY_ID` | The `kid` published alongside the key. Generated together with the key above. |

Generate the JWT keypair once, before the first deploy:

```
node -e "const {generateKeyPairSync}=require('crypto');const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});console.log('V1_JWT_PRIVATE_KEY='+privateKey.export({type:'pkcs8',format:'pem'}).toString('base64'));console.log('V1_JWT_KEY_ID='+require('crypto').randomBytes(8).toString('hex'));"
```

Optional runtime variables (Nitro's `node-server` preset, confirmed by reading its source): `PORT` (default `3000`), `HOST` (default: all interfaces). Hostinger's Node.js App Manager typically assigns `PORT` itself — leave it unset unless you need a specific value.

## 4. Install command

```
npm ci
```

Use `npm ci`, not `npm install` — it installs exactly what `package-lock.json` pins, which is what you want for a reproducible production build.

## 5. Build command

```
NITRO_PRESET=node-server npm run build
```

(`npm run build` is `vite build`; the `NITRO_PRESET` override is what redirects Nitro's output from the Cloudflare Workers target to a plain Node server — see §0.) This produces `.output/server/index.mjs` (the server entry) and `.output/public/` (static assets, served by the same process).

## 6. Start command

```
node .output/server/index.mjs
```

No `npm start` script exists in `package.json` — point Hostinger's Node.js App "startup file" field directly at `.output/server/index.mjs` (relative to your application root). This was verified locally: the process binds and serves the app on `PORT` (default `3000`) immediately, with no further flags needed — `package.json` already declares `"type": "module"`, so Node runs the ESM entry natively.

## 7. Required Hostinger configuration

- **Node.js Application** (hPanel → your website → Advanced → Node.js): select the Node.js version from §2, set the application root to the repository root, and set the startup file to `.output/server/index.mjs`.
- **Environment variables**: enter every runtime variable from §3 in the panel's Environment Variables section. (The panel's own "npm install" action is not sufficient on its own — it does not run a build step; see the deployment steps below for why the build must be run over SSH.)
- **SSH access**: required to clone the repository, run the install/build commands, and generate the one-time JWT keypair. Cloud Startup includes SSH.
- **Domain / SSL**: bind your domain to the hosting account and enable Hostinger's free SSL (Let's Encrypt) with "Force HTTPS" on. Hostinger's front-end web server terminates TLS and reverse-proxies to the Node process — the app itself never needs to handle certificates.
- **Process management**: Hostinger's Node.js App Manager (Passenger-based) keeps the process alive and restarts it automatically on crash or reboot — no separate `pm2`/`systemd` setup is needed as long as the app is registered through the panel's Node.js App feature rather than started ad hoc over SSH.
- **Webhook endpoints**: register these two URLs with Stripe and PayPal respectively, once the domain is live:
  - Stripe: `https://yourdomain.com/api/public/webhooks/stripe`
  - PayPal: `https://yourdomain.com/api/public/webhooks/paypal`

## 8. Deployment steps

1. SSH into the Hostinger account.
2. Clone the repository (or `git pull` on subsequent deploys) into the application root Hostinger will serve from.
3. Create a `.env` file in the project root containing **every** variable from §3 (both build-time and runtime — Vite reads `VITE_*` from this file automatically at build time; having the server-only ones here too is harmless and simplifies testing the build locally over SSH).
4. Install dependencies:
   ```
   npm ci
   ```
5. Build with the Node target:
   ```
   NITRO_PRESET=node-server npm run build
   ```
6. Confirm `.output/server/index.mjs` and `.output/public/` were produced.
7. In hPanel's Node.js Application screen, set (or confirm) the application root and startup file (§7), and enter the runtime environment variables from §3 in the panel's Environment Variables section (the panel-managed process does not read your SSH session's `.env` file — it needs its own copy).
8. Restart the Node.js application from the panel.
9. Bind the domain and enable Force HTTPS (§7) if not already done.
10. Register the Stripe and PayPal webhook URLs (§7) in each provider's dashboard, pointing at the live domain.
11. For every subsequent deploy: `git pull`, repeat steps 4–6, then restart the app from the panel (step 8) — no further hPanel reconfiguration is needed unless environment variables changed.

## 9. Post-deployment verification checklist

- [ ] Homepage loads over `https://yourdomain.com` with a valid TLS certificate (no mixed-content warnings).
- [ ] Login flow (Google OAuth via Supabase Auth) completes successfully.
- [ ] `GET https://yourdomain.com/v1/.well-known/jwks.json` returns a valid JWKS document (this route is handled as a special case in `src/server.ts`, not the normal file-based router — worth confirming explicitly since it's the one routing exception in the app).
- [ ] `/v1/auth/session` (or another `/v1` endpoint) responds correctly, confirming the CORE API layer is reachable.
- [ ] Static assets under `/assets/*` load (confirms `.output/public` is being served correctly by the Node process).
- [ ] Stripe dashboard → webhook → "send test event" against the live endpoint succeeds (HTTP 200).
- [ ] PayPal dashboard → webhook simulator against the live endpoint succeeds.
- [ ] A real (small) Stripe test-mode-off purchase completes and the resulting `subscriptions`/`payments` rows appear correctly — or, at minimum, a manual admin Premium grant (`/admin/users`) works end-to-end.
- [ ] Avatar upload (`/dashboard/profile`) succeeds — confirms `SUPABASE_SERVICE_ROLE_KEY` is correct and the `core` Storage bucket exists in the production Supabase project.
- [ ] `/admin` is reachable and gated correctly for an admin account, and inaccessible (redirects) for a non-admin account.
- [ ] Switching language (BS/EN/DE) updates visible text immediately, including on at least one `/admin/*` page (Priority 9 i18n migration).
- [ ] Restart the Node.js app once from hPanel and confirm it comes back up automatically — validates that Hostinger's process manager is correctly supervising it.
- [ ] Check the app's logs (hPanel Node.js Application → Logs) for unexpected errors on first boot — in particular, any `process.env` variable read as `undefined` indicates a missed entry in §3.
