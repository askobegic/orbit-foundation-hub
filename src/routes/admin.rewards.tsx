// Priority 8.7 (C-1): Admin UI for Rewards & Loyalty (Priority 8.3).
//
// Reward Action Rules, Levels, Achievements, Catalog, Fulfillment Types and
// Config were all fully implemented server-side (src/lib/rewards.functions.ts)
// but had no admin surface -- every value (point amounts, level thresholds,
// achievement triggers, catalog items, fulfillment types, the referral
// verification window) required SQL. This page closes that gap, following
// the same Card-based pattern already established by /admin/advertising.
import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Plus } from "lucide-react";
import { toast } from "sonner";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { AdminTogglePill } from "@/components/admin/AdminTogglePill";
import { getMyIsAdmin } from "@/lib/admin.functions";
import { adminListCapabilityDefinitions } from "@/lib/capabilities.functions";
import {
  adminListRewardAchievements,
  adminListRewardActionRules,
  adminListRewardCatalog,
  adminListRewardConfig,
  adminListRewardFulfillmentTypes,
  adminListRewardLevels,
  adminSetRewardConfig,
  adminUpsertRewardAchievement,
  adminUpsertRewardActionRule,
  adminUpsertRewardCatalogItem,
  adminUpsertRewardFulfillmentType,
  adminUpsertRewardLevel,
} from "@/lib/rewards.functions";

export const Route = createFileRoute("/admin/rewards")({
  head: () => ({
    meta: [
      { title: "Admin · Rewards & Loyalty — Core Platform" },
      { name: "description", content: "Action rules, levels, achievements, catalog, fulfillment types and config." },
    ],
  }),
  component: () => (
    <ProtectedRoute>
      <AdminRewards />
    </ProtectedRoute>
  ),
});

function AdminRewards() {
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
        <Link to="/admin" className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900">
          <ArrowLeft className="h-4 w-4" /> {t("admin.common.back")}
        </Link>
        <h1 className="text-2xl font-semibold text-gray-900">{t("admin.rewards.title")}</h1>
        <p className="mt-1 text-sm text-gray-500">{t("admin.rewards.subtitle")}</p>

        <ActionRulesSection />
        <LevelsSection />
        <AchievementsSection />
        <CatalogSection />
        <FulfillmentTypesSection />
        <ConfigSection />
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

function ActionRulesSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const listFn = useServerFn(adminListRewardActionRules);
  const upsertFn = useServerFn(adminUpsertRewardActionRule);
  const q = useQuery({ queryKey: ["admin-reward-action-rules"], queryFn: () => listFn() });
  const [action, setAction] = useState("");
  const [label, setLabel] = useState("");
  const [points, setPoints] = useState(0);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  const create = useMutation({
    mutationFn: () =>
      upsertFn({
        data: { action, label, points, cooldownSeconds, displayOrder: 0, enabled: true, archived: false },
      }),
    onSuccess: () => {
      toast.success(t("admin.rewards.actionRuleCreated"));
      setAction("");
      setLabel("");
      setPoints(0);
      setCooldownSeconds(0);
      void qc.invalidateQueries({ queryKey: ["admin-reward-action-rules"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: (row: NonNullable<typeof q.data>[number]) =>
      upsertFn({
        data: {
          id: row.id,
          action: row.action,
          label: row.label,
          points: row.points,
          cooldownSeconds: row.cooldown_seconds,
          maxPerUser: row.max_per_user,
          displayOrder: row.display_order,
          enabled: !row.enabled,
          archived: row.archived,
        },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-reward-action-rules"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card title={t("admin.rewards.actionRulesTitle")}>
      <p className="mb-3 text-xs text-gray-500">{t("admin.rewards.actionRulesHint")}</p>
      <div className="grid grid-cols-1 items-end gap-2 sm:flex sm:flex-wrap">
        <label className="text-sm">
          {t("admin.rewards.action")}
          <input
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder={t("admin.rewards.actionPlaceholder")}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-auto"
          />
        </label>
        <label className="text-sm">
          {t("admin.common.label")}
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-auto"
          />
        </label>
        <label className="text-sm">
          {t("admin.rewards.points")}
          <input
            type="number"
            value={points}
            onChange={(e) => setPoints(Number(e.target.value))}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-24"
          />
        </label>
        <label className="text-sm">
          {t("admin.rewards.cooldownSeconds")}
          <input
            type="number"
            value={cooldownSeconds}
            onChange={(e) => setCooldownSeconds(Number(e.target.value))}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-24"
          />
        </label>
        <button
          onClick={() => create.mutate()}
          disabled={!action.trim() || !label.trim() || create.isPending}
          className="inline-flex items-center justify-center gap-1 rounded-lg bg-[#1D6BF3] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> {t("admin.common.add")}
        </button>
      </div>
      <ul className="mt-4 divide-y divide-gray-100">
        {(q.data ?? []).map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">{r.label}</span>{" "}
              <span className="text-gray-400">
                ({r.action}) — {r.points} {t("admin.rewards.pts")}
                {r.cooldown_seconds > 0 ? t("admin.rewards.cooldownPhrase", { seconds: r.cooldown_seconds }) : ""}
              </span>
            </span>
            <AdminTogglePill enabled={r.enabled} onClick={() => toggle.mutate(r)} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function LevelsSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const listFn = useServerFn(adminListRewardLevels);
  const upsertFn = useServerFn(adminUpsertRewardLevel);
  const q = useQuery({ queryKey: ["admin-reward-levels"], queryFn: () => listFn() });
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [minLifetimePoints, setMinLifetimePoints] = useState(0);

  const create = useMutation({
    mutationFn: () =>
      upsertFn({ data: { key, label, minLifetimePoints, displayOrder: 0, enabled: true, archived: false } }),
    onSuccess: () => {
      toast.success(t("admin.rewards.levelCreated"));
      setKey("");
      setLabel("");
      setMinLifetimePoints(0);
      void qc.invalidateQueries({ queryKey: ["admin-reward-levels"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: (row: NonNullable<typeof q.data>[number]) =>
      upsertFn({
        data: {
          id: row.id,
          key: row.key,
          label: row.label,
          minLifetimePoints: row.min_lifetime_points,
          displayOrder: row.display_order,
          enabled: !row.enabled,
          archived: row.archived,
        },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-reward-levels"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card title={t("admin.rewards.levelsTitle")}>
      <p className="mb-3 text-xs text-gray-500">{t("admin.rewards.levelsHint")}</p>
      <div className="grid grid-cols-1 items-end gap-2 sm:flex sm:flex-wrap">
        <label className="text-sm">
          {t("admin.common.key")}
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={t("admin.rewards.keyPlaceholderLevel")}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-auto"
          />
        </label>
        <label className="text-sm">
          {t("admin.common.label")}
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-auto"
          />
        </label>
        <label className="text-sm">
          {t("admin.rewards.minLifetimePoints")}
          <input
            type="number"
            value={minLifetimePoints}
            onChange={(e) => setMinLifetimePoints(Number(e.target.value))}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-32"
          />
        </label>
        <button
          onClick={() => create.mutate()}
          disabled={!key.trim() || !label.trim() || create.isPending}
          className="inline-flex items-center justify-center gap-1 rounded-lg bg-[#1D6BF3] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> {t("admin.common.add")}
        </button>
      </div>
      <ul className="mt-4 divide-y divide-gray-100">
        {(q.data ?? []).map((l) => (
          <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">{l.label}</span>{" "}
              <span className="text-gray-400">
                ({l.key}) — {t("admin.rewards.fromPts", { points: l.min_lifetime_points })}
              </span>
            </span>
            <AdminTogglePill enabled={l.enabled} onClick={() => toggle.mutate(l)} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function AchievementsSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const listFn = useServerFn(adminListRewardAchievements);
  const upsertFn = useServerFn(adminUpsertRewardAchievement);
  const listActionsFn = useServerFn(adminListRewardActionRules);
  const q = useQuery({ queryKey: ["admin-reward-achievements"], queryFn: () => listFn() });
  const actionsQ = useQuery({ queryKey: ["admin-reward-action-rules"], queryFn: () => listActionsFn() });
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [triggerAction, setTriggerAction] = useState("");
  const [triggerCount, setTriggerCount] = useState(1);

  const create = useMutation({
    mutationFn: () =>
      upsertFn({
        data: {
          key,
          label,
          triggerAction: triggerAction || null,
          triggerCount,
          displayOrder: 0,
          enabled: true,
          archived: false,
        },
      }),
    onSuccess: () => {
      toast.success(t("admin.rewards.achievementCreated"));
      setKey("");
      setLabel("");
      setTriggerAction("");
      setTriggerCount(1);
      void qc.invalidateQueries({ queryKey: ["admin-reward-achievements"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: (row: NonNullable<typeof q.data>[number]) =>
      upsertFn({
        data: {
          id: row.id,
          key: row.key,
          label: row.label,
          description: row.description,
          triggerAction: row.trigger_action,
          triggerCount: row.trigger_count,
          displayOrder: row.display_order,
          enabled: !row.enabled,
          archived: row.archived,
        },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-reward-achievements"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card title={t("admin.rewards.achievementsTitle")}>
      <div className="grid grid-cols-1 items-end gap-2 sm:flex sm:flex-wrap">
        <label className="text-sm">
          {t("admin.common.key")}
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={t("admin.rewards.keyPlaceholderAchievement")}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-auto"
          />
        </label>
        <label className="text-sm">
          {t("admin.common.label")}
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-auto"
          />
        </label>
        <label className="text-sm">
          {t("admin.rewards.triggerAction")}
          <select
            value={triggerAction}
            onChange={(e) => setTriggerAction(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-auto"
          >
            <option value="">{t("admin.rewards.noneManualOnly")}</option>
            {(actionsQ.data ?? []).map((a) => (
              <option key={a.action} value={a.action}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          {t("admin.rewards.triggerCount")}
          <input
            type="number"
            min={1}
            value={triggerCount}
            onChange={(e) => setTriggerCount(Number(e.target.value))}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-24"
          />
        </label>
        <button
          onClick={() => create.mutate()}
          disabled={!key.trim() || !label.trim() || create.isPending}
          className="inline-flex items-center justify-center gap-1 rounded-lg bg-[#1D6BF3] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> {t("admin.common.add")}
        </button>
      </div>
      <ul className="mt-4 divide-y divide-gray-100">
        {(q.data ?? []).map((a) => (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">{a.label}</span>{" "}
              <span className="text-gray-400">
                ({a.key}){" "}
                {a.trigger_action
                  ? `— ${t("admin.rewards.triggerSummary", { count: a.trigger_count, action: a.trigger_action })}`
                  : `— ${t("admin.rewards.manual")}`}
              </span>
            </span>
            <AdminTogglePill enabled={a.enabled} onClick={() => toggle.mutate(a)} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function CatalogSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const listFn = useServerFn(adminListRewardCatalog);
  const upsertFn = useServerFn(adminUpsertRewardCatalogItem);
  const listFulfillmentFn = useServerFn(adminListRewardFulfillmentTypes);
  const listCapabilitiesFn = useServerFn(adminListCapabilityDefinitions);
  const q = useQuery({ queryKey: ["admin-reward-catalog"], queryFn: () => listFn() });
  const fulfillmentQ = useQuery({
    queryKey: ["admin-reward-fulfillment-types"],
    queryFn: () => listFulfillmentFn(),
  });
  const capabilitiesQ = useQuery({
    queryKey: ["admin-capability-definitions"],
    queryFn: () => listCapabilitiesFn(),
  });
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [pointsCost, setPointsCost] = useState(0);
  const [verifiedReferralsRequired, setVerifiedReferralsRequired] = useState(0);
  const [grantType, setGrantType] = useState("");
  const [requiresCapability, setRequiresCapability] = useState("");

  const create = useMutation({
    mutationFn: () =>
      upsertFn({
        data: {
          key,
          label,
          pointsCost,
          verifiedReferralsRequired,
          grantType,
          grantValue: {},
          requiresCapability: requiresCapability || null,
          displayOrder: 0,
          enabled: true,
          archived: false,
        },
      }),
    onSuccess: () => {
      toast.success(t("admin.rewards.catalogItemCreated"));
      setKey("");
      setLabel("");
      setPointsCost(0);
      setVerifiedReferralsRequired(0);
      setGrantType("");
      setRequiresCapability("");
      void qc.invalidateQueries({ queryKey: ["admin-reward-catalog"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: (row: NonNullable<typeof q.data>[number]) =>
      upsertFn({
        data: {
          id: row.id,
          key: row.key,
          label: row.label,
          description: row.description,
          pointsCost: row.points_cost,
          verifiedReferralsRequired: row.verified_referrals_required,
          grantType: row.grant_type,
          grantValue: (row.grant_value as Record<string, unknown>) ?? {},
          requiresCapability: row.requires_capability,
          displayOrder: row.display_order,
          enabled: !row.enabled,
          archived: row.archived,
        },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-reward-catalog"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card title={t("admin.rewards.catalogTitle")}>
      <p className="mb-3 text-xs text-gray-500">{t("admin.rewards.catalogHint")}</p>
      <div className="grid grid-cols-1 items-end gap-2 sm:flex sm:flex-wrap">
        <label className="text-sm">
          {t("admin.common.key")}
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={t("admin.rewards.keyPlaceholderCatalog")}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-auto"
          />
        </label>
        <label className="text-sm">
          {t("admin.common.label")}
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-auto"
          />
        </label>
        <label className="text-sm">
          {t("admin.rewards.pointsCost")}
          <input
            type="number"
            value={pointsCost}
            onChange={(e) => setPointsCost(Number(e.target.value))}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-24"
          />
        </label>
        <label className="text-sm">
          {t("admin.rewards.verifiedReferralsReq")}
          <input
            type="number"
            value={verifiedReferralsRequired}
            onChange={(e) => setVerifiedReferralsRequired(Number(e.target.value))}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-24"
          />
        </label>
        <label className="text-sm">
          {t("admin.rewards.grantType")}
          <select
            value={grantType}
            onChange={(e) => setGrantType(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-auto"
          >
            <option value="">{t("admin.common.select")}</option>
            {(fulfillmentQ.data ?? []).map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          {t("admin.dashboardWidgets.requiresCapability")}
          <select
            value={requiresCapability}
            onChange={(e) => setRequiresCapability(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-auto"
          >
            <option value="">{t("admin.common.none")}</option>
            {(capabilitiesQ.data ?? []).map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => create.mutate()}
          disabled={!key.trim() || !label.trim() || !grantType || create.isPending}
          className="inline-flex items-center justify-center gap-1 rounded-lg bg-[#1D6BF3] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> {t("admin.common.add")}
        </button>
      </div>
      <ul className="mt-4 divide-y divide-gray-100">
        {(q.data ?? []).map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">{c.label}</span>{" "}
              <span className="text-gray-400">
                ({c.key}) — {c.points_cost} {t("admin.rewards.pts")}
                {c.verified_referrals_required > 0
                  ? t("admin.rewards.verifiedReferralsSuffix", { count: c.verified_referrals_required })
                  : ""}
                {" — "}
                {c.grant_type}
              </span>
            </span>
            <AdminTogglePill enabled={c.enabled} onClick={() => toggle.mutate(c)} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function FulfillmentTypesSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const listFn = useServerFn(adminListRewardFulfillmentTypes);
  const upsertFn = useServerFn(adminUpsertRewardFulfillmentType);
  const q = useQuery({ queryKey: ["admin-reward-fulfillment-types"], queryFn: () => listFn() });
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");

  const create = useMutation({
    mutationFn: () => upsertFn({ data: { key, label, enabled: true, archived: false, displayOrder: 0 } }),
    onSuccess: () => {
      toast.success(t("admin.rewards.fulfillmentTypeCreated"));
      setKey("");
      setLabel("");
      void qc.invalidateQueries({ queryKey: ["admin-reward-fulfillment-types"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: (row: NonNullable<typeof q.data>[number]) =>
      upsertFn({
        data: {
          id: row.id,
          key: row.key,
          label: row.label,
          description: row.description,
          displayOrder: row.display_order,
          enabled: !row.enabled,
          archived: row.archived,
        },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-reward-fulfillment-types"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card title={t("admin.rewards.fulfillmentTypesTitle")}>
      <p className="mb-3 text-xs text-gray-500">{t("admin.rewards.fulfillmentTypesHint")}</p>
      <div className="grid grid-cols-1 items-end gap-2 sm:flex sm:flex-wrap">
        <label className="text-sm">
          {t("admin.common.key")}
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={t("admin.rewards.keyPlaceholderFulfillment")}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-auto"
          />
        </label>
        <label className="text-sm">
          {t("admin.common.label")}
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-auto"
          />
        </label>
        <button
          onClick={() => create.mutate()}
          disabled={!key.trim() || !label.trim() || create.isPending}
          className="inline-flex items-center justify-center gap-1 rounded-lg bg-[#1D6BF3] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> {t("admin.common.add")}
        </button>
      </div>
      <ul className="mt-4 divide-y divide-gray-100">
        {(q.data ?? []).map((f) => (
          <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">{f.label}</span>{" "}
              <span className="text-gray-400">({f.key})</span>
            </span>
            <AdminTogglePill enabled={f.enabled} onClick={() => toggle.mutate(f)} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ConfigSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const listFn = useServerFn(adminListRewardConfig);
  const setFn = useServerFn(adminSetRewardConfig);
  const q = useQuery({ queryKey: ["admin-reward-config"], queryFn: () => listFn() });

  // The one config key rewards.server.ts currently reads
  // (getVerificationDays()) -- exposed as a dedicated field so the admin
  // doesn't need to guess the key/JSON shape; the list below still shows
  // every row verbatim for anything added later.
  const verificationRow = (q.data ?? []).find((r) => r.key === "referral_verification_days");
  const [verificationDays, setVerificationDays] = useState(
    typeof verificationRow?.value === "number" ? verificationRow.value : 30,
  );

  const save = useMutation({
    mutationFn: () => setFn({ data: { key: "referral_verification_days", value: verificationDays } }),
    onSuccess: () => {
      toast.success(t("admin.rewards.configSaved"));
      void qc.invalidateQueries({ queryKey: ["admin-reward-config"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card title={t("admin.rewards.configTitle")}>
      <label className="text-sm">
        {t("admin.rewards.referralVerificationDays")}
        <input
          type="number"
          min={1}
          value={verificationDays}
          onChange={(e) => setVerificationDays(Number(e.target.value))}
          className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-32"
        />
      </label>
      <p className="mt-1 text-xs text-gray-500">{t("admin.rewards.referralVerificationHint")}</p>
      <button
        onClick={() => save.mutate()}
        disabled={save.isPending}
        className="mt-2 rounded-lg bg-[#1D6BF3] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {t("common.save")}
      </button>

      <ul className="mt-6 divide-y divide-gray-100 border-t border-gray-100 pt-4">
        {(q.data ?? []).map((c) => (
          <li key={c.key} className="flex items-center justify-between py-2 text-sm">
            <span className="font-medium">{c.key}</span>
            <span className="text-gray-500">{JSON.stringify(c.value)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
