import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { ArrowLeft, BadgeCheck, Crown, Search, Users } from "lucide-react";

import { useApplication } from "@/context/ApplicationContext";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { UserCard, type Member } from "@/components/members/UserCard";
import { getMembersDisplayConfig, searchMembers, type MemberFilter } from "@/lib/members.functions";

// CORE Members System (src/lib/members.server.ts / members.functions.ts /
// components/members/UserCard.tsx) -- one shared page, reused by every
// connected application. The current application only supplies branding
// (logo/name via useApplication()) and the visibility scope (application.id
// passed to searchMembers) -- there is no per-application copy of this
// route, search, or card.
//
// Final member-status rule: only two sections/types exist -- PREMIUM
// MEMBERS and STANDARD MEMBERS (every registered user is Standard unless
// they hold active Premium; mutually exclusive, so no user ever appears in
// both). Verified is a status shown on the UserCard itself, never a third
// section. Structure: current app logo -> "MEMBERS" title -> search ->
// compact status explanation -> Premium Members -> Standard Members (both
// counts admin-configurable via /admin/members, members_config table).
export const Route = createFileRoute("/members")({
  head: () => ({
    meta: [{ title: "Members" }, { name: "description", content: "Browse community members." }],
  }),
  component: MembersPage,
});

const DEFAULT_SECTION_COUNT = 6;
const DEFAULT_PAGE_SIZE = 24;

function toMember(row: {
  id: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  city: string | null;
  country: string | null;
  isVerified: boolean;
  isPremium: boolean;
  profession: string | null;
}): Member {
  return row;
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

function MembersPage() {
  const { t } = useTranslation();
  const { application } = useApplication();
  const searchMembersFn = useServerFn(searchMembers);
  const configFn = useServerFn(getMembersDisplayConfig);

  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput, 350);
  const [filter, setFilter] = useState<MemberFilter>("all");
  const [page, setPage] = useState(1);
  const [accumulated, setAccumulated] = useState<Member[]>([]);

  const appId = application?.id ?? null;
  const showFeatured = filter === "all" && !search;

  const configQuery = useQuery({ queryKey: ["members", "config"], queryFn: () => configFn() });
  const config = configQuery.data;
  const directoryPageSize = config?.directoryPageSize ?? DEFAULT_PAGE_SIZE;

  useEffect(() => {
    setPage(1);
    setAccumulated([]);
  }, [search, filter, appId]);

  const gridQuery = useQuery({
    queryKey: ["members", "grid", appId, search, filter, page, directoryPageSize],
    queryFn: () =>
      searchMembersFn({
        data: { appId, search: search || undefined, filter, page, pageSize: directoryPageSize },
      }),
    enabled: !showFeatured,
  });

  useEffect(() => {
    if (!gridQuery.data) return;
    const rows = gridQuery.data.rows.map(toMember);
    setAccumulated((prev) => (page === 1 ? rows : [...prev, ...rows]));
  }, [gridQuery.data, page]);

  const premiumFeaturedQuery = useQuery({
    queryKey: ["members", "featured", "premium", appId, config?.premiumSectionCount],
    queryFn: () =>
      searchMembersFn({
        data: {
          appId,
          filter: "premium",
          page: 1,
          pageSize: config?.premiumSectionCount ?? DEFAULT_SECTION_COUNT,
        },
      }),
    enabled: showFeatured && !!config,
  });
  const standardFeaturedQuery = useQuery({
    queryKey: ["members", "featured", "standard", appId, config?.standardSectionCount],
    queryFn: () =>
      searchMembersFn({
        data: {
          appId,
          filter: "standard",
          page: 1,
          pageSize: config?.standardSectionCount ?? DEFAULT_SECTION_COUNT,
        },
      }),
    enabled: showFeatured && !!config,
  });

  const total = gridQuery.data?.total ?? 0;
  const hasMore = useMemo(
    () => !showFeatured && accumulated.length < total,
    [showFeatured, accumulated.length, total],
  );

  function backToLanding() {
    setFilter("all");
    setSearchInput("");
  }

  return (
    <main className="min-h-screen bg-[#F7F8FA] pb-16">
      <header className="border-b border-gray-100 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <Link to="/" className="flex min-w-0 items-center gap-2">
            {application?.logo_url ? (
              <img
                src={application.logo_url}
                alt={application.name}
                className="h-8 w-8 shrink-0 rounded-lg object-contain"
              />
            ) : (
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white"
                style={{ backgroundColor: application?.primary_color ?? "#1D6BF3" }}
              >
                {application?.name?.slice(0, 1) ?? "C"}
              </div>
            )}
            <span className="truncate text-lg font-bold text-gray-900">
              {application?.name ?? "Core"}
            </span>
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1D6BF3]/10 text-[#1D6BF3]">
            <Users className="h-5 w-5" />
          </div>
          <h1 className="text-2xl font-bold uppercase tracking-tight text-gray-900">
            {t("members.title")}
          </h1>
        </div>

        <div className="relative mt-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t("members.searchPlaceholder")}
            className="h-12 rounded-xl pl-10 text-base"
          />
        </div>

        <StatusExplanation applicationSlug={application?.slug} />

        {!showFeatured && (
          <button
            type="button"
            onClick={backToLanding}
            className="mt-4 flex items-center gap-1 text-sm font-medium text-[#1D6BF3] hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t("members.title")}
          </button>
        )}

        {showFeatured ? (
          <div className="mt-8 space-y-10">
            <FeaturedSection
              icon={<Crown className="h-4 w-4 text-amber-500" />}
              title={t("members.premiumMembers")}
              members={premiumFeaturedQuery.data?.rows.map(toMember) ?? []}
              loading={premiumFeaturedQuery.isLoading || configQuery.isLoading}
              onViewAll={() => setFilter("premium")}
              viewAllLabel={t("members.viewAll")}
            />
            <FeaturedSection
              icon={<Users className="h-4 w-4 text-[#1D6BF3]" />}
              title={t("members.standardMembers")}
              members={standardFeaturedQuery.data?.rows.map(toMember) ?? []}
              loading={standardFeaturedQuery.isLoading || configQuery.isLoading}
              onViewAll={() => setFilter("standard")}
              viewAllLabel={t("members.viewAll")}
            />
          </div>
        ) : (
          <div className="mt-6">
            {!gridQuery.isLoading && (
              <p className="mb-3 text-sm text-gray-500">
                {t("members.resultsCount", { count: total })}
              </p>
            )}
            {accumulated.length === 0 && !gridQuery.isLoading ? (
              <p className="py-12 text-center text-sm text-gray-500">{t("members.noResults")}</p>
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                {accumulated.map((m) => (
                  <UserCard key={m.id} member={m} />
                ))}
                {gridQuery.isLoading &&
                  Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-56 rounded-2xl" />
                  ))}
              </div>
            )}
            {hasMore && !gridQuery.isLoading && (
              <div className="mt-6 flex justify-center">
                <button
                  type="button"
                  onClick={() => setPage((p) => p + 1)}
                  className="rounded-lg border border-gray-200 bg-white px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  {t("members.viewAll")}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

// Compact explanation of the two member types (Standard/Premium) plus the
// Verified status -- three small pills, immediately below Search. Verified
// is deliberately presented alongside, not nested under, Standard/Premium:
// it's an independent status that can layer onto either, not a third type.
//
// The PREMIUM pill is clickable and reuses the EXISTING Premium upgrade
// destination -- the same /pricing route (with ?app=<slug> to preserve
// application context) ProfileCard.tsx's own upgrade dialog already links
// to. No new Premium page, checkout, or payment logic -- this is the one
// and only place Premium purchase begins, platform-wide.
function StatusExplanation({ applicationSlug }: { applicationSlug: string | undefined }) {
  const { t } = useTranslation();
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600">
        <span className="font-semibold text-gray-800">{t("members.statusStandardTitle")}</span>
        {t("members.statusStandardDesc")}
      </span>
      <Link
        to="/pricing"
        search={{ app: applicationSlug }}
        aria-label={t("members.statusPremiumTitle")}
        className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 transition-colors hover:bg-amber-100 hover:underline"
      >
        <Crown className="h-3 w-3 shrink-0 fill-current text-amber-500" />
        <span className="font-semibold">{t("members.statusPremiumTitle")}</span>
        {t("members.statusPremiumDesc")}
      </Link>
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800">
        <BadgeCheck className="h-3 w-3 shrink-0 text-emerald-600" />
        <span className="font-semibold">{t("members.statusVerifiedTitle")}</span>
        {t("members.statusVerifiedDesc")}
      </span>
    </div>
  );
}

function FeaturedSection({
  icon,
  title,
  members,
  loading,
  onViewAll,
  viewAllLabel,
}: {
  icon: React.ReactNode;
  title: string;
  members: Member[];
  loading: boolean;
  onViewAll: () => void;
  viewAllLabel: string;
}) {
  if (!loading && members.length === 0) return null;
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700">{title}</h2>
        </div>
        <button
          type="button"
          onClick={onViewAll}
          className="text-sm font-medium text-[#1D6BF3] hover:underline"
        >
          {viewAllLabel} →
        </button>
      </div>
      {/* Mobile landing page: exactly 2 cards per row, capped at 4 visible
          (2 rows x 2) per section -- "Pogledaj sve" / "View all" is the
          only way to see more on mobile. Cards at index >= 4 are only
          revealed at the sm breakpoint and up, where desktop shows the
          full admin-configured section count across more columns. Purely
          a responsive-visibility cap -- fetching/config is unchanged. */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {loading
          ? Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className={cn("h-56 rounded-2xl", i >= 4 && "hidden sm:block")} />
            ))
          : members.map((m, i) => (
              <UserCard key={m.id} member={m} className={cn(i >= 4 && "hidden sm:block")} />
            ))}
      </div>
    </section>
  );
}
