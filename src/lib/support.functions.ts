// Priority 15 Phase D (15.12 User -> Admin Support). A simple support
// ticket/conversation system -- NOT the one-on-one social Messaging
// system (conversations/messages), whose eligibility+hide-per-side
// lifecycle doesn't fit a ticket's subject/priority/status/replies shape.
// See PROJECT_KNOWLEDGE.md -> Admin -> User Communication & Support.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin, writeAuditLog } from "@/lib/admin.server";
import { sendNotification } from "@/lib/notify.server";

async function adminClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

// ---------- User-facing ----------

export const getMySupportTickets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("support_tickets")
      .select("*")
      .eq("user_id", context.userId)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const createTicketSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(2000),
  category: z.string().trim().max(60).nullable().optional(),
  appId: z.string().uuid().nullable().optional(),
});

export const createSupportTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => createTicketSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await adminClient();

    const { data: ticket, error: ticketErr } = await supabaseAdmin
      .from("support_tickets")
      .insert({
        user_id: context.userId,
        subject: data.subject,
        category: data.category ?? null,
        app_id: data.appId ?? null,
      })
      .select("*")
      .single();
    if (ticketErr) throw new Error(ticketErr.message);

    const { error: msgErr } = await supabaseAdmin.from("support_messages").insert({
      ticket_id: ticket.id,
      sender_id: context.userId,
      sender_role: "user",
      body: data.message,
    });
    if (msgErr) throw new Error(msgErr.message);

    return ticket;
  });

export const getMySupportTicketMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ ticketId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { data: ticket } = await context.supabase
      .from("support_tickets")
      .select("id")
      .eq("id", data.ticketId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!ticket) throw new Error("Ticket not found");

    const { data: messages, error } = await context.supabase
      .from("support_messages")
      .select("*")
      .eq("ticket_id", data.ticketId)
      .eq("is_internal_note", false)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    // Mark the admin's messages read the moment the user opens the thread
    // -- the same "read triggers on open" convention Messaging already
    // uses (markConversationRead).
    const supabaseAdmin = await adminClient();
    await supabaseAdmin
      .from("support_messages")
      .update({ read_at: new Date().toISOString() })
      .eq("ticket_id", data.ticketId)
      .eq("sender_role", "admin")
      .is("read_at", null);

    return messages ?? [];
  });

const replySchema = z.object({
  ticketId: z.string().uuid(),
  body: z.string().trim().min(1).max(2000),
});

export const replySupportTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => replySchema.parse(raw))
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await adminClient();

    const { data: ticket } = await supabaseAdmin
      .from("support_tickets")
      .select("id, status")
      .eq("id", data.ticketId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!ticket) throw new Error("Ticket not found");

    const { error: msgErr } = await supabaseAdmin.from("support_messages").insert({
      ticket_id: data.ticketId,
      sender_id: context.userId,
      sender_role: "user",
      body: data.body,
    });
    if (msgErr) throw new Error(msgErr.message);

    // A user reply to a closed ticket reopens it -- an ongoing exchange,
    // not a new one.
    await supabaseAdmin
      .from("support_tickets")
      .update({
        status: ticket.status === "closed" ? "in_progress" : ticket.status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.ticketId);

    return { ok: true };
  });

// ---------- Admin-facing ----------

const listTicketsSchema = z.object({ status: z.enum(["open", "in_progress", "closed"]).optional() });

export const adminListSupportTickets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => listTicketsSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    let query = context.supabase
      .from("support_tickets")
      .select("*, profiles(username, first_name, last_name, email)")
      .order("updated_at", { ascending: false });
    if (data.status) query = query.eq("status", data.status);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const adminGetSupportTicketMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ ticketId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: rows, error } = await context.supabase
      .from("support_messages")
      .select("*")
      .eq("ticket_id", data.ticketId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const adminReplySchema = z.object({
  ticketId: z.string().uuid(),
  body: z.string().trim().min(1).max(2000),
  isInternalNote: z.boolean().default(false),
});

export const adminReplySupportTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => adminReplySchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();

    const { data: ticket } = await supabaseAdmin
      .from("support_tickets")
      .select("id, user_id, status, subject")
      .eq("id", data.ticketId)
      .maybeSingle();
    if (!ticket) throw new Error("Ticket not found");

    const { data: row, error } = await supabaseAdmin
      .from("support_messages")
      .insert({
        ticket_id: data.ticketId,
        sender_id: context.userId,
        sender_role: "admin",
        body: data.body,
        is_internal_note: data.isInternalNote,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    if (!data.isInternalNote) {
      await supabaseAdmin
        .from("support_tickets")
        .update({
          status: ticket.status === "open" ? "in_progress" : ticket.status,
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.ticketId);

      // Engagement Notifications (D8): Admin Reply -- routed through the
      // shared sendNotification() (CORE Notification & User Engagement
      // System), deep-linking to the support inbox (D4).
      await sendNotification({
        userId: ticket.user_id,
        category: "information",
        type: "info",
        targetPath: "/dashboard/help",
        dedupeKey: `support_reply:${row.id}`,
        content: {
          titleBs: "Odgovor na vaš zahtjev za podrškom",
          titleEn: "Reply to your support request",
          titleDe: "Antwort auf Ihre Support-Anfrage",
          messageBs: ticket.subject,
          messageEn: ticket.subject,
          messageDe: ticket.subject,
        },
      });
    }

    await writeAuditLog({
      userId: context.userId,
      action: "support_ticket.reply",
      entityType: "support_ticket",
      entityId: data.ticketId,
      newData: { isInternalNote: data.isInternalNote },
    });

    return row;
  });

const setStatusSchema = z.object({
  ticketId: z.string().uuid(),
  status: z.enum(["open", "in_progress", "closed"]),
  reason: z.string().trim().max(500).optional(),
});

export const adminSetSupportTicketStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => setStatusSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();

    const { data: previous } = await supabaseAdmin
      .from("support_tickets")
      .select("status")
      .eq("id", data.ticketId)
      .maybeSingle();

    const { error } = await supabaseAdmin
      .from("support_tickets")
      .update({ status: data.status, updated_at: new Date().toISOString() })
      .eq("id", data.ticketId);
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: "support_ticket.set_status",
      entityType: "support_ticket",
      entityId: data.ticketId,
      oldData: previous,
      newData: { status: data.status },
      reason: data.reason ?? null,
    });
    return { ok: true };
  });

const setPrioritySchema = z.object({
  ticketId: z.string().uuid(),
  priority: z.enum(["low", "normal", "high"]),
  reason: z.string().trim().max(500).optional(),
});

export const adminSetSupportTicketPriority = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => setPrioritySchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();

    const { data: previous } = await supabaseAdmin
      .from("support_tickets")
      .select("priority")
      .eq("id", data.ticketId)
      .maybeSingle();

    const { error } = await supabaseAdmin
      .from("support_tickets")
      .update({ priority: data.priority, updated_at: new Date().toISOString() })
      .eq("id", data.ticketId);
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: "support_ticket.set_priority",
      entityType: "support_ticket",
      entityId: data.ticketId,
      oldData: previous,
      newData: { priority: data.priority },
      reason: data.reason ?? null,
    });
    return { ok: true };
  });
