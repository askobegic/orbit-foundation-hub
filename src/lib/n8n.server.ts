// Server-only helper to POST events to an n8n webhook.
// Never import from client-reachable modules at module scope.

export type N8nEventType =
  | "new_user_registered"
  | "premium_activated"
  | "payment_received"
  | "support_request";

export async function sendN8nEvent(
  event: N8nEventType,
  payload: Record<string, unknown>,
): Promise<void> {
  const url = process.env.N8N_WEBHOOK_URL;
  if (!url) {
    console.warn("[n8n] N8N_WEBHOOK_URL not set — skipping", event);
    return;
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event,
        timestamp: new Date().toISOString(),
        payload,
      }),
    });
    if (!res.ok) {
      console.error("[n8n] webhook failed", event, res.status, await res.text().catch(() => ""));
    }
  } catch (err) {
    console.error("[n8n] webhook error", event, err);
  }
}