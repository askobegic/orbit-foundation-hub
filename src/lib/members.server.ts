// CORE Members System -- shared member directory listing logic, reusable
// by every connected application (BosniaFans, Svadba, Gradovi, Ticketaria,
// and CORE itself). No parallel user/profile/Premium/verification system:
// reuses `profiles`, `premium_profiles`, `user_app_settings`, and the
// existing Premium Status Resolver (resolvePremiumStatusBulk,
// src/lib/premium.server.ts) -- the same one every other CORE surface
// (Dashboard, Admin, ProfileCard) already uses. Uses supabaseAdmin (service
// role) purely for query composition (search/pagination/count across
// tables whose base RLS restricts to own-row/admin) -- never to expose more
// than `profiles_public`/`premium_profiles_public` already would: only
// public-safe columns are ever selected here, and Standard members never
// expose profession, exactly matching ProfileCard's "Standard users expose
// only photo/name/city/country" rule (see PROJECT_KNOWLEDGE.md -> Premium
// Model).
//
// Final member-status rule: there are only two member TYPES, Standard and
// Premium (every registered user is Standard unless they hold active
// Premium -- resolvePremiumStatusBulk is still the one and only Premium
// check). Verified is a STATUS layered onto either type via the existing
// profiles.is_verified column, never a third type/section, and never a
// separate visibility gate of its own. "New member" is not a type or
// filter -- there is no time-based classification here at all.
import type { SupabaseClient } from "@supabase/supabase-js";

import { resolvePremiumStatusBulk } from "@/lib/premium.server";

export type MemberFilter = "all" | "premium" | "standard";

const PAGE_SIZE_MAX = 60;

// Admin-configurable display/pagination settings -- same key/value
// config-table shape as reward_config/ad_config/engagement_config/
// trial_policy (members_config, 20260812100000_members_config.sql /
// 20260812110000_members_config_standard_status.sql), not a new
// configuration mechanism. Affects display/pagination only -- never who is
// Premium or Verified.
export type MembersConfig = {
  premiumSectionCount: number;
  standardSectionCount: number;
  directoryPageSize: number;
};

const MEMBERS_CONFIG_DEFAULTS: MembersConfig = {
  premiumSectionCount: 6,
  standardSectionCount: 6,
  directoryPageSize: 24,
};

export async function getMembersConfig(supabaseAdmin: SupabaseClient): Promise<MembersConfig> {
  const { data } = await supabaseAdmin.from("members_config").select("key, value");
  const byKey = new Map((data ?? []).map((r) => [r.key as string, r.value]));
  const num = (key: string, fallback: number) => {
    const v = byKey.get(key);
    return typeof v === "number" && v > 0 ? v : fallback;
  };
  return {
    premiumSectionCount: num("premium_section_count", MEMBERS_CONFIG_DEFAULTS.premiumSectionCount),
    standardSectionCount: num(
      "standard_section_count",
      MEMBERS_CONFIG_DEFAULTS.standardSectionCount,
    ),
    directoryPageSize: Math.min(
      num("directory_page_size", MEMBERS_CONFIG_DEFAULTS.directoryPageSize),
      PAGE_SIZE_MAX,
    ),
  };
}

export type MemberRow = {
  id: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  city: string | null;
  country: string | null;
  isVerified: boolean;
  isPremium: boolean;
  // Premium-only, per the existing Premium Model -- always null for a
  // Standard member, never fetched for one.
  profession: string | null;
  createdAt: string;
};

export type ListMembersParams = {
  // The current application context (ApplicationContext -> useApplication()
  // -> application.id). null = opened directly from CORE with no resolved
  // application.
  appId: string | null;
  search?: string;
  filter?: MemberFilter;
  page?: number;
  pageSize?: number;
};

export type ListMembersResult = {
  rows: MemberRow[];
  total: number;
  page: number;
  pageSize: number;
};

type ProfileQueryRow = {
  id: string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  city: string | null;
  country: string | null;
  is_verified: boolean;
  created_at: string;
};

export async function listMembers(
  supabaseAdmin: SupabaseClient,
  params: ListMembersParams,
): Promise<ListMembersResult> {
  const config = await getMembersConfig(supabaseAdmin);
  const page = params.page && params.page > 0 ? params.page : 1;
  const pageSize = Math.min(
    params.pageSize && params.pageSize > 0 ? params.pageSize : config.directoryPageSize,
    PAGE_SIZE_MAX,
  );
  const emptyResult: ListMembersResult = { rows: [], total: 0, page, pageSize };

  // Application scope: EXACT same visibility semantics as
  // src/routes/u.$username.tsx (the existing public-profile route):
  //   if (!application) { setVisibleHere(true); return; }   // no app context -> always visible
  //   ...is_visible ?? true                                 // app context -> visible UNLESS an explicit false row exists
  // A denylist, not an allowlist -- absence of a user_app_settings row
  // defaults to visible, never to hidden. No app context (opened directly
  // from CORE) applies no visibility filter at all.
  let hiddenIds = new Set<string>();
  if (params.appId) {
    const { data: hiddenRows, error: hiddenError } = await supabaseAdmin
      .from("user_app_settings")
      .select("user_id")
      .eq("app_id", params.appId)
      .eq("is_visible", false);
    if (hiddenError) throw new Error(hiddenError.message);
    hiddenIds = new Set((hiddenRows ?? []).map((r) => r.user_id as string));
  }

  // Premium set -- resolved once, platform-wide (a fixed small number of
  // queries regardless of N, never N+1), reused for the "premium"/
  // "standard" filters (mutually exclusive -- see below) and every row's
  // badge.
  const premiumMap = await resolvePremiumStatusBulk(supabaseAdmin);
  const premiumIds = new Set(premiumMap.keys());
  if (params.filter === "premium" && premiumIds.size === 0) return emptyResult;

  // Search: name/username/city/country match directly against profiles;
  // additionally, a Premium member's public profession is searchable too
  // (spec examples: "Doctor", "Lawyer") -- Standard members have no
  // searchable profession, since they never expose one. Profession matches
  // are resolved as an id set up front and OR'd into the main query below.
  const search = params.search?.trim();
  let searchProfessionIds: Set<string> | null = null;
  if (search && premiumIds.size > 0) {
    const s = `%${search}%`;
    // primary_profession only -- secondary_professions is a text[] and
    // PostgREST's array-contains filter needs an exact element match, not
    // ilike substring matching, so it's deliberately left out here rather
    // than risk a malformed filter on a search term containing spaces or
    // commas.
    const { data, error: profErr } = await supabaseAdmin
      .from("premium_profiles")
      .select("user_id")
      .in("user_id", [...premiumIds])
      .ilike("primary_profession", s);
    if (profErr) throw new Error(profErr.message);
    searchProfessionIds = new Set((data ?? []).map((r) => r.user_id as string));
  }

  let query = supabaseAdmin
    .from("profiles")
    .select(
      "id, username, first_name, last_name, avatar_url, city, country, is_verified, created_at",
      { count: "exact" },
    )
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .range((page - 1) * pageSize, (page - 1) * pageSize + pageSize - 1);

  if (hiddenIds.size > 0) query = query.not("id", "in", `(${[...hiddenIds].join(",")})`);

  // Premium/Standard are mutually exclusive and cover every member --
  // "standard" is everyone NOT in the Premium set (the "no duplicate
  // users across sections" rule), not a separate stored flag. Verified
  // never affects this filter -- it's a status rendered on the card, not
  // a placement rule.
  if (params.filter === "premium") {
    query = query.in("id", [...premiumIds]);
  } else if (params.filter === "standard" && premiumIds.size > 0) {
    query = query.not("id", "in", `(${[...premiumIds].join(",")})`);
  }

  if (search) {
    const s = `%${search}%`;
    const nameFilter = `username.ilike.${s},first_name.ilike.${s},last_name.ilike.${s},city.ilike.${s},country.ilike.${s}`;
    query =
      searchProfessionIds && searchProfessionIds.size > 0
        ? query.or(`${nameFilter},id.in.(${[...searchProfessionIds].join(",")})`)
        : query.or(nameFilter);
  }

  const { data: rows, error, count } = await query;
  if (error) throw new Error(error.message);
  const profileRows = (rows ?? []) as ProfileQueryRow[];

  // Profession is fetched only for the Premium members actually on this
  // page -- never for Standard members, and never more than one page's
  // worth at a time.
  const premiumIdsOnPage = profileRows.map((r) => r.id).filter((id) => premiumIds.has(id));
  const professionById = new Map<string, string | null>();
  if (premiumIdsOnPage.length > 0) {
    const { data: premiumProfiles, error: ppErr } = await supabaseAdmin
      .from("premium_profiles")
      .select("user_id, primary_profession")
      .in("user_id", premiumIdsOnPage);
    if (ppErr) throw new Error(ppErr.message);
    for (const p of premiumProfiles ?? []) professionById.set(p.user_id, p.primary_profession);
  }

  const memberRows: MemberRow[] = profileRows.map((r) => {
    const isPremium = premiumIds.has(r.id);
    return {
      id: r.id,
      username: r.username,
      firstName: r.first_name,
      lastName: r.last_name,
      avatarUrl: r.avatar_url,
      city: r.city,
      country: r.country,
      isVerified: r.is_verified,
      isPremium,
      profession: isPremium ? (professionById.get(r.id) ?? null) : null,
      createdAt: r.created_at,
    };
  });

  return { rows: memberRows, total: count ?? 0, page, pageSize };
}
