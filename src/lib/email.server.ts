// CORE Notification & User Engagement System -- the one email delivery
// path for the whole platform. Resend, chosen for this task (a plain REST
// call, no new npm dependency, one env var). Server-only -- never imported
// by client code.
//
// Graceful failure by design (CLAUDE.md -> Reliability): a missing API key
// or a failed Resend request never throws -- it returns { ok: false } so a
// notification's in-app row is always created regardless of email
// deliverability, and the caller (notify.server.ts) records the outcome on
// the notification row itself rather than surfacing an error to the user.
const RESEND_API_URL = "https://api.resend.com/emails";

export interface SendEmailResult {
  ok: boolean;
  error?: string;
}

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
}): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    return { ok: false, error: "not_configured" };
  }

  try {
    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: params.to,
        subject: params.subject,
        html: params.html,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("sendEmail: Resend request failed", res.status, body);
      return { ok: false, error: `resend_${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    console.error("sendEmail: Resend request threw", err);
    return { ok: false, error: "request_failed" };
  }
}
