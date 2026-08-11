// Priority 15 Phase B: Admin UI for Missions, Challenges & Streaks
// (src/lib/engagement.functions.ts). Same Card-based pattern as
// /admin/events and /admin/rewards -- reused deliberately, not reinvented.
// See PROJECT_KNOWLEDGE.md -> Missions, Challenges & Streaks.
import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Archive, Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { AdminTogglePill } from "@/components/admin/AdminTogglePill";
import { supabase } from "@/integrations/supabase/client";
import { getMyIsAdmin } from "@/lib/admin.functions";
import {
  adminDeleteEngagementCondition,
  adminDeleteStreakMilestone,
  adminListEngagementConditions,
  adminListEngagementConfig,
  adminListEngagementDefinitions,
  adminListStreakDefinitions,
  adminSetEngagementConfig,
  adminUpsertEngagementCondition,
  adminUpsertEngagementDefinition,
  adminUpsertStreakDefinition,
  adminUpsertStreakMilestone,
} from "@/lib/engagement.functions";
import type { ApplicationRow } from "@/types/database";

export const Route = createFileRoute("/admin/engagement")({
  head: () => ({
    meta: [
      { title: "Admin · Missions, Challenges & Streaks — Core Platform" },
      { name: "description", content: "Define missions, challenges, and streaks, global or per application." },
    ],
  }),
  component: () => (
    <ProtectedRoute>
      <AdminEngagement />
    </ProtectedRoute>
  ),
});

function AdminEngagement() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isAdminFn = useServerFn(getMyIsAdmin);
  const adminQ = useQuery({ queryKey: ["is-admin"], queryFn: () => isAdminFn() });
  useEffect(() => {
    if (adminQ.data && !adminQ.data.isAdmin) void navigate({ to: "/dashboard", replace: true });
  }, [adminQ.data, navigate]);

  const appsQ = useQuery({
    queryKey: ["admin-apps"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("applications")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ApplicationRow[];
    },
  });

  return (
    <main className="min-h-screen bg-[#F7F8FA] px-6 py-10">
      <div className="mx-auto max-w-5xl">
        <Link
          to="/admin"
          className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" /> {t("admin.common.back")}
        </Link>
        <h1 className="text-2xl font-semibold text-gray-900">{t("admin.engagement.title")}</h1>
        <p className="mt-1 text-sm text-gray-500">{t("admin.engagement.subtitle")}</p>

        <DefinitionsSection kind="mission" apps={appsQ.data ?? []} />
        <DefinitionsSection kind="challenge" apps={appsQ.data ?? []} />
        <StreaksSection apps={appsQ.data ?? []} />
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

function AppScopeSelect({
  apps,
  value,
  onChange,
}: {
  apps: ApplicationRow[];
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
      className="mt-1 block rounded-lg border border-gray-200 px-2 py-1 text-sm"
    >
      <option value="">{t("admin.engagement.scopeGlobal")}</option>
      {apps.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
    </select>
  );
}

type DefinitionRow = Awaited<ReturnType<typeof adminListEngagementDefinitions>>[number];

function DefinitionsSection({ kind, apps }: { kind: "mission" | "challenge"; apps: ApplicationRow[] }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const listFn = useServerFn(adminListEngagementDefinitions);
  const upsertFn = useServerFn(adminUpsertEngagementDefinition);
  const q = useQuery({
    queryKey: ["admin-engagement-definitions", kind],
    queryFn: () => listFn({ data: { kind } }),
  });

  const [key, setKey] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [nameBs, setNameBs] = useState("");
  const [nameDe, setNameDe] = useState("");
  const [appId, setAppId] = useState<string | null>(null);
  const [rewardPoints, setRewardPoints] = useState(0);

  const create = useMutation({
    mutationFn: () =>
      upsertFn({
        data: {
          kind,
          key,
          nameBs,
          nameEn,
          nameDe,
          appId,
          rewardPoints,
          rewardLifetimePoints: rewardPoints,
          displayOrder: 0,
          enabled: true,
          archived: false,
        },
      }),
    onSuccess: () => {
      toast.success(t("admin.engagement.created"));
      setKey("");
      setNameEn("");
      setNameBs("");
      setNameDe("");
      setAppId(null);
      setRewardPoints(0);
      void qc.invalidateQueries({ queryKey: ["admin-engagement-definitions", kind] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleEnabled = useMutation({
    mutationFn: (row: DefinitionRow) =>
      upsertFn({
        data: {
          id: row.id,
          kind: row.kind as "mission" | "challenge",
          key: row.key,
          nameBs: row.name_bs,
          nameEn: row.name_en,
          nameDe: row.name_de,
          descriptionBs: row.description_bs,
          descriptionEn: row.description_en,
          descriptionDe: row.description_de,
          appId: row.app_id,
          rewardPoints: row.reward_points,
          rewardLifetimePoints: row.reward_lifetime_points,
          displayOrder: row.display_order,
          enabled: !row.enabled,
          archived: row.archived,
        },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-engagement-definitions", kind] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleArchived = useMutation({
    mutationFn: (row: DefinitionRow) =>
      upsertFn({
        data: {
          id: row.id,
          kind: row.kind as "mission" | "challenge",
          key: row.key,
          nameBs: row.name_bs,
          nameEn: row.name_en,
          nameDe: row.name_de,
          descriptionBs: row.description_bs,
          descriptionEn: row.description_en,
          descriptionDe: row.description_de,
          appId: row.app_id,
          rewardPoints: row.reward_points,
          rewardLifetimePoints: row.reward_lifetime_points,
          displayOrder: row.display_order,
          enabled: row.enabled,
          archived: !row.archived,
        },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-engagement-definitions", kind] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const title = kind === "mission" ? t("admin.engagement.missionsTitle") : t("admin.engagement.challengesTitle");

  return (
    <Card title={title}>
      <div className="grid grid-cols-1 items-end gap-2 sm:flex sm:flex-wrap">
        <label className="text-sm">
          {t("admin.common.key")}
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-auto"
          />
        </label>
        <label className="text-sm">
          {t("admin.engagement.nameEn")}
          <input
            value={nameEn}
            onChange={(e) => setNameEn(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-auto"
          />
        </label>
        <label className="text-sm">
          {t("admin.engagement.nameBs")}
          <input
            value={nameBs}
            onChange={(e) => setNameBs(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-auto"
          />
        </label>
        <label className="text-sm">
          {t("admin.engagement.nameDe")}
          <input
            value={nameDe}
            onChange={(e) => setNameDe(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-auto"
          />
        </label>
        <label className="text-sm">
          {t("admin.engagement.scope")}
          <AppScopeSelect apps={apps} value={appId} onChange={setAppId} />
        </label>
        <label className="text-sm">
          {t("admin.engagement.rewardPoints")}
          <input
            type="number"
            value={rewardPoints}
            onChange={(e) => setRewardPoints(Number(e.target.value) || 0)}
            className="mt-1 block w-24 rounded-lg border border-gray-200 px-3 py-1.5 text-sm"
          />
        </label>
        <button
          onClick={() => create.mutate()}
          disabled={!key.trim() || !nameEn.trim() || !nameBs.trim() || !nameDe.trim() || create.isPending}
          className="inline-flex items-center justify-center gap-1 rounded-lg bg-[#1D6BF3] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> {t("admin.common.add")}
        </button>
      </div>

      <ul className="mt-4 divide-y divide-gray-100">
        {(q.data ?? []).map((d) => (
          <li key={d.id} className="py-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={`min-w-0 flex-1 truncate ${d.archived ? "text-gray-400 line-through" : ""}`}>
                <span className="font-medium">{d.name_en}</span>{" "}
                <span className="text-gray-400">
                  ({d.key} · {apps.find((a) => a.id === d.app_id)?.name ?? t("admin.engagement.scopeGlobal")} ·{" "}
                  {t("admin.engagement.rewardPointsShort", { points: d.reward_points })})
                </span>
              </span>
              <div className="flex shrink-0 items-center gap-2">
                <AdminTogglePill enabled={d.enabled} disabled={d.archived} onClick={() => toggleEnabled.mutate(d)} />
                <button
                  onClick={() => toggleArchived.mutate(d)}
                  className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                  title={d.archived ? t("admin.common.unarchive") : t("admin.common.archive")}
                >
                  {d.archived ? <RotateCcw className="h-3 w-3" /> : <Archive className="h-3 w-3" />}
                  {d.archived ? t("admin.common.unarchive") : t("admin.common.archive")}
                </button>
              </div>
            </div>
            <ConditionsEditor definitionId={d.id} kind={kind} />
          </li>
        ))}
        {(q.data ?? []).length === 0 && (
          <p className="py-2 text-sm text-gray-500">{t("admin.engagement.noDefinitions")}</p>
        )}
      </ul>
    </Card>
  );
}

function ConditionsEditor({ definitionId, kind }: { definitionId: string; kind: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const listFn = useServerFn(adminListEngagementConditions);
  const upsertFn = useServerFn(adminUpsertEngagementCondition);
  const deleteFn = useServerFn(adminDeleteEngagementCondition);
  const q = useQuery({
    queryKey: ["admin-engagement-conditions", definitionId],
    queryFn: () => listFn({ data: { definitionId } }),
  });
  const [eventKey, setEventKey] = useState("");
  const [target, setTarget] = useState(1);

  const add = useMutation({
    mutationFn: () => upsertFn({ data: { definitionId, eventKey, target, displayOrder: 0 } }),
    onSuccess: () => {
      setEventKey("");
      setTarget(1);
      void qc.invalidateQueries({ queryKey: ["admin-engagement-conditions", definitionId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-engagement-conditions", definitionId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mt-2 rounded-lg bg-gray-50 p-3">
      <p className="text-[11px] font-semibold uppercase text-gray-500">
        {kind === "mission" ? t("admin.engagement.missionConditions") : t("admin.engagement.challengeConditions")}
      </p>
      <ul className="mt-1 divide-y divide-gray-100">
        {(q.data ?? []).map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-2 py-1.5 text-xs">
            <span>
              {c.event_key} → {t("admin.engagement.target", { count: c.target })}
            </span>
            <button onClick={() => remove.mutate(c.id)} className="text-gray-400 hover:text-red-600">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
        {(q.data ?? []).length === 0 && (
          <p className="py-1.5 text-xs text-gray-500">{t("admin.engagement.noConditions")}</p>
        )}
      </ul>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="text-xs">
          {t("admin.engagement.eventKey")}
          <input
            value={eventKey}
            onChange={(e) => setEventKey(e.target.value)}
            className="mt-1 block rounded-lg border border-gray-200 px-2 py-1 text-sm"
          />
        </label>
        <label className="text-xs">
          {t("admin.engagement.target", { count: target })}
          <input
            type="number"
            min={1}
            value={target}
            onChange={(e) => setTarget(Number(e.target.value) || 1)}
            className="mt-1 block w-20 rounded-lg border border-gray-200 px-2 py-1 text-sm"
          />
        </label>
        <button
          onClick={() => add.mutate()}
          disabled={!eventKey.trim() || add.isPending}
          className="inline-flex items-center gap-1 rounded-lg bg-[#1D6BF3] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" /> {t("admin.common.add")}
        </button>
      </div>
    </div>
  );
}

type StreakDefinitionRow = Awaited<ReturnType<typeof adminListStreakDefinitions>>[number];

function StreaksSection({ apps }: { apps: ApplicationRow[] }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const listFn = useServerFn(adminListStreakDefinitions);
  const upsertFn = useServerFn(adminUpsertStreakDefinition);
  const q = useQuery({ queryKey: ["admin-streak-definitions"], queryFn: () => listFn() });

  const [key, setKey] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [nameBs, setNameBs] = useState("");
  const [nameDe, setNameDe] = useState("");
  const [appId, setAppId] = useState<string | null>(null);
  const [eventKey, setEventKey] = useState("");

  const create = useMutation({
    mutationFn: () =>
      upsertFn({
        data: {
          key,
          nameBs,
          nameEn,
          nameDe,
          appId,
          eventKey,
          displayOrder: 0,
          enabled: true,
          archived: false,
        },
      }),
    onSuccess: () => {
      toast.success(t("admin.engagement.created"));
      setKey("");
      setNameEn("");
      setNameBs("");
      setNameDe("");
      setAppId(null);
      setEventKey("");
      void qc.invalidateQueries({ queryKey: ["admin-streak-definitions"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleEnabled = useMutation({
    mutationFn: (row: StreakDefinitionRow) =>
      upsertFn({
        data: {
          id: row.id,
          key: row.key,
          nameBs: row.name_bs,
          nameEn: row.name_en,
          nameDe: row.name_de,
          appId: row.app_id,
          eventKey: row.event_key,
          displayOrder: row.display_order,
          enabled: !row.enabled,
          archived: row.archived,
        },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-streak-definitions"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card title={t("admin.engagement.streaksTitle")}>
      <div className="grid grid-cols-1 items-end gap-2 sm:flex sm:flex-wrap">
        <label className="text-sm">
          {t("admin.common.key")}
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-auto"
          />
        </label>
        <label className="text-sm">
          {t("admin.engagement.nameEn")}
          <input
            value={nameEn}
            onChange={(e) => setNameEn(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-auto"
          />
        </label>
        <label className="text-sm">
          {t("admin.engagement.nameBs")}
          <input
            value={nameBs}
            onChange={(e) => setNameBs(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-auto"
          />
        </label>
        <label className="text-sm">
          {t("admin.engagement.nameDe")}
          <input
            value={nameDe}
            onChange={(e) => setNameDe(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-auto"
          />
        </label>
        <label className="text-sm">
          {t("admin.engagement.scope")}
          <AppScopeSelect apps={apps} value={appId} onChange={setAppId} />
        </label>
        <label className="text-sm">
          {t("admin.engagement.eventKey")}
          <input
            value={eventKey}
            onChange={(e) => setEventKey(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-auto"
          />
        </label>
        <button
          onClick={() => create.mutate()}
          disabled={
            !key.trim() || !nameEn.trim() || !nameBs.trim() || !nameDe.trim() || !eventKey.trim() || create.isPending
          }
          className="inline-flex items-center justify-center gap-1 rounded-lg bg-[#1D6BF3] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> {t("admin.common.add")}
        </button>
      </div>

      <ul className="mt-4 divide-y divide-gray-100">
        {(q.data ?? []).map((s) => (
          <li key={s.id} className="py-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={`min-w-0 flex-1 truncate ${s.archived ? "text-gray-400 line-through" : ""}`}>
                <span className="font-medium">{s.name_en}</span>{" "}
                <span className="text-gray-400">
                  ({s.key} · {s.event_key} · {apps.find((a) => a.id === s.app_id)?.name ?? t("admin.engagement.scopeGlobal")})
                </span>
              </span>
              <AdminTogglePill enabled={s.enabled} disabled={s.archived} onClick={() => toggleEnabled.mutate(s)} />
            </div>
            <MilestonesEditor streakDefinitionId={s.id} />
          </li>
        ))}
        {(q.data ?? []).length === 0 && (
          <p className="py-2 text-sm text-gray-500">{t("admin.engagement.noDefinitions")}</p>
        )}
      </ul>
    </Card>
  );
}

function MilestonesEditor({ streakDefinitionId }: { streakDefinitionId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const upsertFn = useServerFn(adminUpsertStreakMilestone);
  const deleteFn = useServerFn(adminDeleteStreakMilestone);
  const listFn = useServerFn(adminListStreakDefinitions);
  // Milestones come nested on the streak_definitions list query -- refetch
  // that same query rather than adding a parallel one-off query shape.
  const q = useQuery({ queryKey: ["admin-streak-definitions"], queryFn: () => listFn() });
  const milestones =
    (q.data ?? []).find((s) => s.id === streakDefinitionId)?.streak_milestones ?? [];

  const [thresholdDays, setThresholdDays] = useState(3);
  const [rewardPoints, setRewardPoints] = useState(0);

  const add = useMutation({
    mutationFn: () =>
      upsertFn({
        data: { streakDefinitionId, thresholdDays, rewardPoints, rewardLifetimePoints: rewardPoints, displayOrder: 0 },
      }),
    onSuccess: () => {
      setThresholdDays(3);
      setRewardPoints(0);
      void qc.invalidateQueries({ queryKey: ["admin-streak-definitions"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-streak-definitions"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mt-2 rounded-lg bg-gray-50 p-3">
      <p className="text-[11px] font-semibold uppercase text-gray-500">{t("admin.engagement.milestones")}</p>
      <ul className="mt-1 divide-y divide-gray-100">
        {(milestones as { id: string; threshold_days: number; reward_points: number }[]).map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-2 py-1.5 text-xs">
            <span>{t("admin.engagement.milestoneRow", { days: m.threshold_days, points: m.reward_points })}</span>
            <button onClick={() => remove.mutate(m.id)} className="text-gray-400 hover:text-red-600">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
        {milestones.length === 0 && <p className="py-1.5 text-xs text-gray-500">{t("admin.engagement.noMilestones")}</p>}
      </ul>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="text-xs">
          {t("admin.engagement.thresholdDays")}
          <input
            type="number"
            min={1}
            value={thresholdDays}
            onChange={(e) => setThresholdDays(Number(e.target.value) || 1)}
            className="mt-1 block w-20 rounded-lg border border-gray-200 px-2 py-1 text-sm"
          />
        </label>
        <label className="text-xs">
          {t("admin.engagement.rewardPoints")}
          <input
            type="number"
            value={rewardPoints}
            onChange={(e) => setRewardPoints(Number(e.target.value) || 0)}
            className="mt-1 block w-24 rounded-lg border border-gray-200 px-2 py-1 text-sm"
          />
        </label>
        <button
          onClick={() => add.mutate()}
          disabled={add.isPending}
          className="inline-flex items-center gap-1 rounded-lg bg-[#1D6BF3] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" /> {t("admin.common.add")}
        </button>
      </div>
    </div>
  );
}

function ConfigSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const listFn = useServerFn(adminListEngagementConfig);
  const setFn = useServerFn(adminSetEngagementConfig);
  const q = useQuery({ queryKey: ["admin-engagement-config"], queryFn: () => listFn() });
  const timezoneRow = (q.data ?? []).find((r) => r.key === "streak_timezone");
  const [timezone, setTimezone] = useState("");

  const save = useMutation({
    mutationFn: () => setFn({ data: { key: "streak_timezone", value: timezone || "Europe/Sarajevo" } }),
    onSuccess: () => {
      toast.success(t("admin.engagement.configSaved"));
      void qc.invalidateQueries({ queryKey: ["admin-engagement-config"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card title={t("admin.engagement.configTitle")}>
      <label className="text-sm">
        {t("admin.engagement.streakTimezone")}
        <input
          value={timezone || (typeof timezoneRow?.value === "string" ? timezoneRow.value : "")}
          onChange={(e) => setTimezone(e.target.value)}
          placeholder="Europe/Sarajevo"
          className="mt-1 block w-64 rounded-lg border border-gray-200 px-3 py-1.5 text-sm"
        />
      </label>
      <button
        onClick={() => save.mutate()}
        disabled={save.isPending}
        className="ml-2 mt-1 rounded-lg bg-[#1D6BF3] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {t("admin.events.save")}
      </button>
    </Card>
  );
}
