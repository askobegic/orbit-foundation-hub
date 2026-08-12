// CORE Members System -- public server function. No auth required, same as
// the existing public profile page (src/routes/u.$username.tsx) and
// getApplicationCapabilities (src/lib/capabilities.functions.ts): a
// signed-out visitor can already browse an individual public profile, so
// browsing the directory that leads to one is no more exposed than that.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { Json } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin, writeAuditLog } from "@/lib/admin.server";
import {
  getMembersConfig,
  listMembers,
  type ListMembersResult,
  type MemberFilter,
  type MembersConfig,
} from "@/lib/members.server";

// Re-exported here (not from members.server.ts directly) so client code
// never imports a *.server.ts module, even for a type-only import --
// members.functions.ts is the intended client/server boundary file.
export type { MemberFilter, ListMembersResult, MembersConfig };

const searchMembersSchema = z.object({
  appId: z.string().uuid().nullable().optional(),
  search: z.string().trim().max(120).optional(),
  filter: z.enum(["all", "premium", "standard"]).optional().default("all"),
  page: z.number().int().min(1).optional().default(1),
  pageSize: z.number().int().min(1).max(60).optional().default(24),
});

export const searchMembers = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => searchMembersSchema.parse(raw ?? {}))
  .handler(async ({ data }): Promise<ListMembersResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return listMembers(supabaseAdmin, {
      appId: data.appId ?? null,
      search: data.search,
      filter: data.filter === "all" ? undefined : data.filter,
      page: data.page,
      pageSize: data.pageSize,
    });
  });

// Public -- the Members page reads section counts / directory page size
// before it knows whether the viewer is an admin, same public-access model
// as searchMembers above.
export const getMembersDisplayConfig = createServerFn({ method: "POST" }).handler(
  async (): Promise<MembersConfig> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return getMembersConfig(supabaseAdmin);
  },
);

export const adminListMembersConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("members_config")
      .select("*")
      .order("key", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const setMembersConfigSchema = z.object({
  key: z.string().trim().min(1),
  value: z.unknown(),
  reason: z.string().trim().max(500).optional(),
});

export const adminSetMembersConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => setMembersConfigSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: previous } = await supabaseAdmin
      .from("members_config")
      .select("value")
      .eq("key", data.key)
      .maybeSingle();

    const { error } = await supabaseAdmin
      .from("members_config")
      .upsert({ key: data.key, value: data.value as Json, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: "members_config.set",
      entityType: "members_config",
      entityId: data.key,
      oldData: previous?.value ?? null,
      newData: data.value,
      reason: data.reason ?? null,
    });
    return { ok: true };
  });
