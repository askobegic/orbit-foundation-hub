// CORE User Engagement & Dashboard Actions -- "My Resources" (generic
// resource_references the user owns across connected applications) plus
// admin/application-provided prompts grouped by action_type ("For You" /
// "Complete" / "New" / "Discover"). Deliberately restrained, like
// SpecialOffers.tsx: renders nothing at all when there is nothing eligible
// to show. See PROJECT_KNOWLEDGE.md -> User Engagement & Dashboard Actions.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, Compass, ListChecks, Package, Sparkles } from "lucide-react";

import {
  getMyResourceReferences,
  resolveMyDashboardActions,
  type ResolvedDashboardAction,
} from "@/lib/dashboard-actions.functions";

type Lang = "bs" | "en" | "de";
type ResourceReference = Awaited<ReturnType<typeof getMyResourceReferences>>[number];

function cap(lang: Lang): "Bs" | "En" | "De" {
  return (lang.charAt(0).toUpperCase() + lang.slice(1)) as "Bs" | "En" | "De";
}

// Internal paths open in the same tab; another application's own domain
// opens in a new one -- the same distinction u.$username.tsx/ProfileCard
// already make for external application links.
function isExternalDestination(destination: string): boolean {
  return destination.startsWith("http://") || destination.startsWith("https://");
}

function ActionCard({ action }: { action: ResolvedDashboardAction }) {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language?.slice(0, 2) ?? "bs") as Lang;
  const title = action[`title${cap(lang)}` as "titleBs" | "titleEn" | "titleDe"];
  const description =
    action[`description${cap(lang)}` as "descriptionBs" | "descriptionEn" | "descriptionDe"];
  const cta =
    action[`cta${cap(lang)}` as "ctaBs" | "ctaEn" | "ctaDe"] || t("dashboardActions.open");
  const external = isExternalDestination(action.destination);

  return (
    <a
      href={action.destination}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      className="flex min-w-[240px] max-w-full flex-col rounded-2xl border border-gray-100 bg-white p-4 shadow-sm transition hover:border-gray-200 hover:shadow"
    >
      <div className="mb-1 flex items-center gap-2">
        {action.icon && <span aria-hidden="true">{action.icon}</span>}
        <p className="min-w-0 truncate text-sm font-semibold text-gray-900">{title}</p>
      </div>
      {description && <p className="mb-2 line-clamp-2 text-xs text-gray-500">{description}</p>}
      {action.appName && <p className="mb-2 text-[11px] text-gray-400">{action.appName}</p>}
      <span className="mt-auto flex items-center gap-1 text-xs font-medium text-[#1D6BF3]">
        {cta}
        <ArrowUpRight className="h-3 w-3" />
      </span>
    </a>
  );
}

function ActionGroup({
  title,
  icon: Icon,
  actions,
}: {
  title: string;
  icon: typeof Sparkles;
  actions: ResolvedDashboardAction[];
}) {
  if (actions.length === 0) return null;
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase text-gray-500">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {actions.map((a) => (
          <ActionCard key={a.id} action={a} />
        ))}
      </div>
    </div>
  );
}

function MyResources({ resources }: { resources: ResourceReference[] }) {
  const { t } = useTranslation();
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase text-gray-500">
        <Package className="h-3.5 w-3.5" />
        {t("dashboardActions.myResources")}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {resources.map((r) => {
          const app = r.applications as { name: string; logo_url: string | null } | null;
          const content = (
            <div className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50/40 p-3">
              {app?.logo_url ? (
                <img
                  src={app.logo_url}
                  alt={app.name}
                  className="h-9 w-9 shrink-0 rounded-lg object-cover"
                />
              ) : (
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-200 text-xs font-semibold text-gray-500">
                  {(app?.name ?? "?").slice(0, 1)}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-900">{r.label}</p>
                <p className="truncate text-xs text-gray-400">
                  {app?.name ?? ""} · {t(`dashboardActions.status.${r.status}` as const, r.status)}
                </p>
              </div>
            </div>
          );
          return r.destination ? (
            <a
              key={r.id}
              href={r.destination}
              target={isExternalDestination(r.destination) ? "_blank" : undefined}
              rel={isExternalDestination(r.destination) ? "noreferrer" : undefined}
              className="transition hover:opacity-90"
            >
              {content}
            </a>
          ) : (
            <div key={r.id}>{content}</div>
          );
        })}
      </div>
    </div>
  );
}

export function DashboardActions({ userId }: { userId?: string }) {
  const { t } = useTranslation();
  const actionsFn = useServerFn(resolveMyDashboardActions);
  const resourcesFn = useServerFn(getMyResourceReferences);

  const actionsQuery = useQuery({
    queryKey: ["dashboard", "my-actions", userId],
    enabled: !!userId,
    queryFn: () => actionsFn(),
  });
  const resourcesQuery = useQuery({
    queryKey: ["dashboard", "my-resources", userId],
    enabled: !!userId,
    queryFn: () => resourcesFn(),
  });

  const loading = actionsQuery.isLoading || resourcesQuery.isLoading;
  const actions = actionsQuery.data ?? [];
  const resources = resourcesQuery.data ?? [];

  // Renders nothing at all once both queries have settled and there is
  // genuinely nothing eligible to show -- same restrained-when-empty
  // convention as SpecialOffers.tsx.
  if (!loading && actions.length === 0 && resources.length === 0) return null;

  const byType = (type: ResolvedDashboardAction["actionType"]) =>
    actions.filter((a) => a.actionType === type);

  return (
    <section className="flex flex-col gap-5 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
      {loading ? (
        <div className="flex gap-3 overflow-x-auto pb-1">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-24 w-64 shrink-0 animate-pulse rounded-2xl bg-gray-100" />
          ))}
        </div>
      ) : (
        <>
          {resources.length > 0 && <MyResources resources={resources} />}
          <ActionGroup
            title={t("dashboardActions.forYou")}
            icon={Sparkles}
            actions={byType("action")}
          />
          <ActionGroup
            title={t("dashboardActions.complete")}
            icon={ListChecks}
            actions={byType("complete_task")}
          />
          <ActionGroup title={t("dashboardActions.new")} icon={Package} actions={byType("offer")} />
          <ActionGroup
            title={t("dashboardActions.discover")}
            icon={Compass}
            actions={byType("discovery")}
          />
        </>
      )}
    </section>
  );
}
