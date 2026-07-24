// Stripe client-side helpers.
// The publishable key is safe in the browser; the secret key MUST stay on the server.
// Real Stripe SDK integration (Checkout sessions, webhooks) will be wired in a
// later step via TanStack Start server functions / server routes.

export const STRIPE_PUBLISHABLE_KEY =
  (import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined) ?? "";

export function isStripeConfigured(): boolean {
  return STRIPE_PUBLISHABLE_KEY.length > 0;
}