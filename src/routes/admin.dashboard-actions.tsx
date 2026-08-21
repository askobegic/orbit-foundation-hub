// CORE User Engagement & Dashboard Actions -- Admin management for
// dashboard_actions (Global + Individual, admin-authored or application-
// scoped) and resource_references (support/testing). Same Card-based
// pattern as /admin/offers-coupons and /admin/rewards -- a new page rather
// than folded into offers-coupons, since dashboard_actions is a distinct
// concept (no commercial product/discount involved).
import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { getMyIsAdmin } from "@/lib/admin.functions";
import { adminListOfferSegments, adminSearchUsersForOffer } from "@/lib/offers.functions";
import {
  adminArchiveDashboardAction,
  adminDeleteResourceReference,
  adminListDashboardActions,
  adminListResourceReferences,
  adminSetDashboardActionEnabled,
  adminUpsertDashboardAction,
  adminUpsertResourceReference,
} from "@/lib/dashboard-actions.functions";
import { supabase } from "@/integrations/supabase/client";
import type { ApplicationRow } from "@/types/database";

export const Route = createFileRoute("/admin/dashboard-actions")({
  head: () => ({
    meta: [
      { title: "Admin · Dashboard Actions — Core Platform" },
      { name: "description", content: "Manage Dashboard Actions and Resource References." },
    ],
  }),
  component: () => (
    <ProtectedRoute>
      <AdminDashboardActions />
    </ProtectedRoute>
  ),
});

function AdminDashboardActions() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isAdminFn = useServerFn(getMyIsAdmin);
  const adminQ = useQuery({ queryKey: ["is-admin"], queryFn: () => isAdminFn() });
  useEffect(() => {
    if (adminQ.data && !adminQ.data.isAdmin) void navigate({ to: "/dashboard", replace: true });
  }, [adminQ.data, navigate]);

  return (
    <main className="min-h-screen bg-[#F7F8FA] px-6 py-10">
      <div className="mx-auto max-w-5xl">
        <Link
          to="/admin"
          className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" /> {t("admin.common.back")}
        </Link>
        <h1 className="text-2xl font-semibold text-gray-900">
          {t("admin.dashboardActions.title")}
        </h1>
        <p className="mt-1 text-sm text-gray-500">{t("admin.dashboardActions.subtitle")}</p>

        <ActionsSection targetType="segment" />
        <ActionsSection targetType="individual" />
        <ResourceReferencesSection />
      </div>
    </main>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

const inputCls = "mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm";
const ACTION_TYPES = ["offer", "action", "complete_task", "discovery"] as const;

function useApplicationsList() {
  return useQuery({
    queryKey: ["admin-applications-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("applications")
        .select("id, name")
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as Pick<ApplicationRow, "id" | "name">[];
    },
  });
}

function ActionsSection({ targetType }: { targetType: "segment" | "individual" }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const listFn = useServerFn(adminListDashboardActions);
  const segmentsFn = useServerFn(adminListOfferSegments);
  const searchUsersFn = useServerFn(adminSearchUsersForOffer);
  const upsertFn = useServerFn(adminUpsertDashboardAction);
  const archiveFn = useServerFn(adminArchiveDashboardAction);
  const setEnabledFn = useServerFn(adminSetDashboardActionEnabled);
  const appsQ = useApplicationsList();

  const q = useQuery({ queryKey: ["admin-dashboard-actions"], queryFn: () => listFn() });
  const segmentsQ = useQuery({ queryKey: ["admin-offer-segments"], queryFn: () => segmentsFn() });
  const rows = (q.data ?? []).filter((r) => r.target_type === targetType);

  const [actionType, setActionType] = useState<(typeof ACTION_TYPES)[number]>("action");
  const [appId, setAppId] = useState<string>("");
  const [titleBs, setTitleBs] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [titleDe, setTitleDe] = useState("");
  const [ctaBs, setCtaBs] = useState("");
  const [icon, setIcon] = useState("");
  const [destination, setDestination] = useState("");
  const [segment, setSegment] = useState("all");
  const [userSearch, setUserSearch] = useState("");
  const [targetUserId, setTargetUserId] = useState("");
  const [requiresMissing, setRequiresMissing] = useState("");
  const [displayOrder, setDisplayOrder] = useState(0);

  const usersQ = useQuery({
    queryKey: ["admin-dashboard-action-user-search", userSearch],
    enabled: targetType === "individual" && userSearch.length > 1,
    queryFn: () => searchUsersFn({ data: { search: userSearch } }),
  });

  const create = useMutation({
    mutationFn: () =>
      upsertFn({
        data: {
          actionType,
          appId: appId || null,
          targetType,
          targetSegment: targetType === "segment" ? segment : undefined,
          targetUserId: targetType === "individual" ? targetUserId : undefined,
          requiresMissingResourceType: requiresMissing || undefined,
          titleBs,
          titleEn,
          titleDe,
          ctaBs: ctaBs || undefined,
          icon: icon || undefined,
          destination,
          displayOrder,
          enabled: true,
        },
      }),
    onSuccess: () => {
      toast.success(t("admin.dashboardActions.actionCreated"));
      setTitleBs("");
      setTitleEn("");
      setTitleDe("");
      setCtaBs("");
      setIcon("");
      setDestination("");
      setTargetUserId("");
      setRequiresMissing("");
      void qc.invalidateQueries({ queryKey: ["admin-dashboard-actions"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: (row: { id: string; enabled: boolean }) =>
      setEnabledFn({ data: { id: row.id, enabled: !row.enabled } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-dashboard-actions"] }),
  });
  const archive = useMutation({
    mutationFn: (id: string) => archiveFn({ data: { id } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-dashboard-actions"] }),
  });

  const canCreate =
    titleBs && titleEn && titleDe && destination && (targetType === "segment" || targetUserId);

  return (
    <Card
      title={
        targetType === "segment"
          ? t("admin.dashboardActions.globalActionsTitle")
          : t("admin.dashboardActions.individualActionsTitle")
      }
    >
      {targetType === "individual" && (
        <p className="mb-3 text-xs text-gray-500">
          {t("admin.offersCoupons.individualOffersHint")}
        </p>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-sm">
          {t("admin.dashboardActions.actionType")}
          <select
            value={actionType}
            onChange={(e) => setActionType(e.target.value as (typeof ACTION_TYPES)[number])}
            className={inputCls}
          >
            {ACTION_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`admin.dashboardActions.actionType_${type}` as const)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          {t("admin.common.application")}
          <select value={appId} onChange={(e) => setAppId(e.target.value)} className={inputCls}>
            <option value="">{t("admin.dashboardActions.applicationNone")}</option>
            {(appsQ.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          {t("admin.dashboardActions.displayOrder")}
          <input
            type="number"
            value={displayOrder}
            onChange={(e) => setDisplayOrder(Number(e.target.value))}
            className={inputCls}
          />
        </label>
        <label className="text-sm">
          {t("admin.offersCoupons.titleBs")}
          <input
            value={titleBs}
            onChange={(e) => setTitleBs(e.target.value)}
            className={inputCls}
          />
        </label>
        <label className="text-sm">
          {t("admin.offersCoupons.titleEn")}
          <input
            value={titleEn}
            onChange={(e) => setTitleEn(e.target.value)}
            className={inputCls}
          />
        </label>
        <label className="text-sm">
          {t("admin.offersCoupons.titleDe")}
          <input
            value={titleDe}
            onChange={(e) => setTitleDe(e.target.value)}
            className={inputCls}
          />
        </label>
        <label className="text-sm">
          {t("admin.dashboardActions.cta")}
          <input value={ctaBs} onChange={(e) => setCtaBs(e.target.value)} className={inputCls} />
        </label>
        <label className="text-sm">
          {t("admin.dashboardActions.icon")}
          <input
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            className={inputCls}
            placeholder="🛍️"
          />
        </label>
        <label className="text-sm sm:col-span-2 lg:col-span-1">
          {t("admin.dashboardActions.destination")}
          <input
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder={t("admin.dashboardActions.destinationPlaceholder")}
            className={inputCls}
          />
        </label>
        <label className="text-sm">
          {t("admin.dashboardActions.requiresMissingResourceType")}
          <input
            value={requiresMissing}
            onChange={(e) => setRequiresMissing(e.target.value)}
            placeholder={t("admin.dashboardActions.requiresMissingResourceTypePlaceholder")}
            className={inputCls}
          />
        </label>
        {targetType === "segment" ? (
          <label className="text-sm">
            {t("admin.offersCoupons.segment")}
            <select
              value={segment}
              onChange={(e) => setSegment(e.target.value)}
              className={inputCls}
            >
              {(segmentsQ.data ?? []).map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="text-sm sm:col-span-2">
            {t("admin.offersCoupons.targetUserId")}
            <input
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder={t("admin.offersCoupons.targetUserIdPlaceholder")}
              className={inputCls}
            />
            {(usersQ.data ?? []).length > 0 && (
              <select
                value={targetUserId}
                onChange={(e) => setTargetUserId(e.target.value)}
                className={inputCls}
              >
                <option value="">{t("admin.common.select")}</option>
                {usersQ.data!.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.username ?? u.email} ({u.first_name} {u.last_name})
                  </option>
                ))}
              </select>
            )}
          </label>
        )}
      </div>
      <button
        type="button"
        disabled={!canCreate}
        onClick={() => create.mutate()}
        className="mt-3 rounded-lg bg-[#1D6BF3] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {t("admin.common.create")}
      </button>

      <ul className="mt-4 divide-y divide-gray-100">
        {rows.map((row: NonNullable<typeof q.data>[number]) => (
          <li key={row.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <span className="min-w-0 truncate">
              {row.title_bs} — {t(`admin.dashboardActions.actionType_${row.action_type}` as const)}
              {row.applications ? ` — ${(row.applications as { name: string }).name}` : ""}
            </span>
            <span className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => toggle.mutate(row)}
                className="rounded-lg border border-gray-200 px-2 py-1 text-xs"
              >
                {row.enabled ? t("admin.common.disable") : t("admin.common.enable")}
              </button>
              <button
                type="button"
                onClick={() => archive.mutate(row.id)}
                className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-red-600"
              >
                {t("admin.common.archive")}
              </button>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ResourceReferencesSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const listFn = useServerFn(adminListResourceReferences);
  const upsertFn = useServerFn(adminUpsertResourceReference);
  const deleteFn = useServerFn(adminDeleteResourceReference);
  const searchUsersFn = useServerFn(adminSearchUsersForOffer);
  const appsQ = useApplicationsList();

  const q = useQuery({
    queryKey: ["admin-resource-references"],
    queryFn: () => listFn({ data: {} }),
  });

  const [userSearch, setUserSearch] = useState("");
  const [userId, setUserId] = useState("");
  const [appId, setAppId] = useState("");
  const [resourceType, setResourceType] = useState("");
  const [label, setLabel] = useState("");
  const [status, setStatus] = useState<"active" | "pending" | "incomplete" | "inactive">("active");
  const [destination, setDestination] = useState("");

  const usersQ = useQuery({
    queryKey: ["admin-resource-reference-user-search", userSearch],
    enabled: userSearch.length > 1,
    queryFn: () => searchUsersFn({ data: { search: userSearch } }),
  });

  const create = useMutation({
    mutationFn: () =>
      upsertFn({
        data: { userId, appId, resourceType, label, status, destination: destination || undefined },
      }),
    onSuccess: () => {
      toast.success(t("admin.dashboardActions.resourceCreated"));
      setResourceType("");
      setLabel("");
      setDestination("");
      void qc.invalidateQueries({ queryKey: ["admin-resource-references"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-resource-references"] }),
  });

  const canCreate = userId && appId && resourceType && label;

  return (
    <Card title={t("admin.dashboardActions.resourceReferencesTitle")}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-sm sm:col-span-2">
          {t("admin.dashboardActions.userId")}
          <input
            value={userSearch}
            onChange={(e) => setUserSearch(e.target.value)}
            placeholder={t("admin.dashboardActions.userIdPlaceholder")}
            className={inputCls}
          />
          {(usersQ.data ?? []).length > 0 && (
            <select value={userId} onChange={(e) => setUserId(e.target.value)} className={inputCls}>
              <option value="">{t("admin.common.select")}</option>
              {usersQ.data!.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.username ?? u.email} ({u.first_name} {u.last_name})
                </option>
              ))}
            </select>
          )}
        </label>
        <label className="text-sm">
          {t("admin.common.application")}
          <select value={appId} onChange={(e) => setAppId(e.target.value)} className={inputCls}>
            <option value="">{t("admin.common.select")}</option>
            {(appsQ.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          {t("admin.dashboardActions.resourceType")}
          <input
            value={resourceType}
            onChange={(e) => setResourceType(e.target.value)}
            placeholder="shop"
            className={inputCls}
          />
        </label>
        <label className="text-sm">
          {t("admin.common.label")}
          <input value={label} onChange={(e) => setLabel(e.target.value)} className={inputCls} />
        </label>
        <label className="text-sm">
          {t("admin.dashboardActions.status")}
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
            className={inputCls}
          >
            <option value="active">active</option>
            <option value="pending">pending</option>
            <option value="incomplete">incomplete</option>
            <option value="inactive">inactive</option>
          </select>
        </label>
        <label className="text-sm">
          {t("admin.dashboardActions.destination")}
          <input
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            className={inputCls}
          />
        </label>
      </div>
      <button
        type="button"
        disabled={!canCreate}
        onClick={() => create.mutate()}
        className="mt-3 rounded-lg bg-[#1D6BF3] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {t("admin.common.create")}
      </button>

      <ul className="mt-4 divide-y divide-gray-100">
        {(q.data ?? []).map((row: NonNullable<typeof q.data>[number]) => {
          const profile = row.profiles as {
            username: string | null;
            first_name: string | null;
          } | null;
          const app = row.applications as { name: string } | null;
          return (
            <li key={row.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span className="min-w-0 truncate">
                {row.label} ({row.resource_type}) —{" "}
                {profile?.username ?? profile?.first_name ?? "?"} — {app?.name ?? "?"} —{" "}
                {row.status}
              </span>
              <button
                type="button"
                onClick={() => remove.mutate(row.id)}
                className="shrink-0 rounded-lg border border-gray-200 px-2 py-1 text-xs text-red-600"
              >
                {t("admin.common.delete")}
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
