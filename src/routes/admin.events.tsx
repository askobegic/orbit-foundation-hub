// Priority 12 Phase 2: Admin UI for the Universal Event & Rewards Engine's
// Event Registry, Application Mapping, and Reward Rule Engine
// (src/lib/events.functions.ts). Same Card-based pattern as
// /admin/capabilities and /admin/rewards -- reused deliberately, not
// reinvented. See PROJECT_KNOWLEDGE.md -> Rewards & Loyalty / Universal
// Event Engine.
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
  adminDeleteEventRuleCondition,
  adminGetEventAnalytics,
  adminListApplicationEvents,
  adminListEventDefinitions,
  adminListEventRuleConditions,
  adminListEventRules,
  adminSetApplicationEvent,
  adminUpsertEventDefinition,
  adminUpsertEventRule,
  adminUpsertEventRuleCondition,
} from "@/lib/events.functions";
import type { ApplicationRow } from "@/types/database";

export const Route = createFileRoute("/admin/events")({
  head: () => ({
    meta: [
      { title: "Admin · Universal Events — Core Platform" },
      { name: "description", content: "Event registry, application mapping, and reward rules." },
    ],
  }),
  component: () => (
    <ProtectedRoute>
      <AdminEvents />
    </ProtectedRoute>
  ),
});

function AdminEvents() {
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

  const [appId, setAppId] = useState("");

  return (
    <main className="min-h-screen bg-[#F7F8FA] px-6 py-10">
      <div className="mx-auto max-w-5xl">
        <Link
          to="/admin"
          className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" /> {t("admin.common.back")}
        </Link>
        <h1 className="text-2xl font-semibold text-gray-900">{t("admin.events.title")}</h1>
        <p className="mt-1 text-sm text-gray-500">{t("admin.events.subtitle")}</p>

        <EventDefinitionsSection />

        <GlobalRulesSection />

        <Card title={t("admin.common.application")}>
          <select
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            className="block rounded-lg border border-gray-200 px-3 py-1.5 text-sm"
          >
            <option value="">{t("admin.common.select")}</option>
            {(appsQ.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Card>

        {appId && (
          <>
            <ApplicationMappingSection appId={appId} />
            <RewardRulesSection appId={appId} />
          </>
        )}

        <AnalyticsSection appId={appId || null} />
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

function EventDefinitionsSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const listFn = useServerFn(adminListEventDefinitions);
  const upsertFn = useServerFn(adminUpsertEventDefinition);
  const q = useQuery({ queryKey: ["admin-event-definitions"], queryFn: () => listFn() });
  const [eventKey, setEventKey] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [category, setCategory] = useState("");

  const create = useMutation({
    mutationFn: () =>
      upsertFn({
        data: {
          eventKey,
          displayName,
          category: category.trim() || null,
          displayOrder: 0,
          enabled: true,
          archived: false,
        },
      }),
    onSuccess: () => {
      toast.success(t("admin.events.created"));
      setEventKey("");
      setDisplayName("");
      setCategory("");
      void qc.invalidateQueries({ queryKey: ["admin-event-definitions"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleEnabled = useMutation({
    mutationFn: (row: NonNullable<typeof q.data>[number]) =>
      upsertFn({
        data: {
          id: row.id,
          eventKey: row.event_key,
          displayName: row.display_name,
          description: row.description,
          category: row.category,
          icon: row.icon,
          displayOrder: row.display_order,
          enabled: !row.enabled,
          archived: row.archived,
        },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-event-definitions"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleArchived = useMutation({
    mutationFn: (row: NonNullable<typeof q.data>[number]) =>
      upsertFn({
        data: {
          id: row.id,
          eventKey: row.event_key,
          displayName: row.display_name,
          description: row.description,
          category: row.category,
          icon: row.icon,
          displayOrder: row.display_order,
          enabled: row.enabled,
          archived: !row.archived,
        },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-event-definitions"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card title={t("admin.events.definitionsTitle")}>
      <div className="grid grid-cols-1 items-end gap-2 sm:flex sm:flex-wrap">
        <label className="text-sm">
          {t("admin.common.key")}
          <input
            value={eventKey}
            onChange={(e) => setEventKey(e.target.value)}
            placeholder={t("admin.events.keyPlaceholder")}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-auto"
          />
        </label>
        <label className="text-sm">
          {t("admin.common.label")}
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-auto"
          />
        </label>
        <label className="text-sm">
          {t("admin.events.categoryPlaceholder")}
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-auto"
          />
        </label>
        <button
          onClick={() => create.mutate()}
          disabled={!eventKey.trim() || !displayName.trim() || create.isPending}
          className="inline-flex items-center justify-center gap-1 rounded-lg bg-[#1D6BF3] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> {t("admin.common.add")}
        </button>
      </div>
      <ul className="mt-4 divide-y divide-gray-100">
        {(q.data ?? []).map((d) => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span
              className={`min-w-0 flex-1 truncate ${d.archived ? "text-gray-400 line-through" : ""}`}
            >
              <span className="font-medium">{d.display_name}</span>{" "}
              <span className="text-gray-400">
                ({d.event_key}
                {d.category ? ` · ${d.category}` : ""} ·{" "}
                {t("admin.events.versionLabel", { version: d.version })})
              </span>
            </span>
            <div className="flex shrink-0 items-center gap-2">
              <AdminTogglePill
                enabled={d.enabled}
                disabled={d.archived}
                onClick={() => toggleEnabled.mutate(d)}
              />
              <button
                onClick={() => toggleArchived.mutate(d)}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                title={d.archived ? t("admin.common.unarchive") : t("admin.common.archive")}
              >
                {d.archived ? <RotateCcw className="h-3 w-3" /> : <Archive className="h-3 w-3" />}
                {d.archived ? t("admin.common.unarchive") : t("admin.common.archive")}
              </button>
            </div>
          </li>
        ))}
        {(q.data ?? []).length === 0 && (
          <p className="py-2 text-sm text-gray-500">{t("admin.events.noDefinitions")}</p>
        )}
      </ul>
    </Card>
  );
}

// Priority 15 Phase A: GLOBAL rules -- one optional event_rules row per
// event_key with app_id = null, applying to every application that has
// the event enabled unless that application also has its own
// app-specific rule (which always wins -- see resolveEventRule() in
// events.server.ts). Not gated by application_events/an app selection,
// since a global rule isn't tied to any one application's mapping.
function GlobalRulesSection() {
  const { t } = useTranslation();
  const definitionsListFn = useServerFn(adminListEventDefinitions);
  const rulesListFn = useServerFn(adminListEventRules);
  const definitionsQ = useQuery({
    queryKey: ["admin-event-definitions"],
    queryFn: () => definitionsListFn(),
  });
  const rulesQ = useQuery({
    // null matches the key RuleRow already invalidates via its own
    // `appId` prop (also null here) -- see RuleRow's save mutation below.
    queryKey: ["admin-event-rules", null],
    queryFn: () => rulesListFn({ data: { appId: null } }),
  });

  const activeDefinitions = (definitionsQ.data ?? []).filter((d) => !d.archived);
  const rulesByKey = new Map((rulesQ.data ?? []).map((r) => [r.event_key, r]));

  return (
    <Card title={t("admin.events.globalRulesTitle")}>
      <p className="mb-3 text-xs text-gray-500">{t("admin.events.globalRulesDesc")}</p>
      {activeDefinitions.length === 0 && (
        <p className="text-sm text-gray-500">{t("admin.events.noDefinitions")}</p>
      )}
      <div className="space-y-4">
        {activeDefinitions.map((d) => (
          <RuleRow
            key={d.event_key}
            appId={null}
            eventKey={d.event_key}
            label={d.display_name}
            rule={rulesByKey.get(d.event_key) ?? null}
          />
        ))}
      </div>
    </Card>
  );
}

function ApplicationMappingSection({ appId }: { appId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const listFn = useServerFn(adminListApplicationEvents);
  const setFn = useServerFn(adminSetApplicationEvent);
  const q = useQuery({
    queryKey: ["admin-application-events", appId],
    queryFn: () => listFn({ data: { appId } }),
  });

  const toggle = useMutation({
    mutationFn: (v: { eventKey: string; enabled: boolean }) =>
      setFn({ data: { appId, eventKey: v.eventKey, enabled: v.enabled } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin-application-events", appId] });
      void qc.invalidateQueries({ queryKey: ["admin-event-rules", appId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card title={t("admin.events.mappingTitle")}>
      <ul className="divide-y divide-gray-100">
        {(q.data ?? []).map((e) => (
          <li
            key={e.event_key}
            className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
          >
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">{e.display_name}</span>{" "}
              <span className="text-gray-400">({e.event_key})</span>
            </span>
            <AdminTogglePill
              enabled={e.appEnabled}
              onClick={() => toggle.mutate({ eventKey: e.event_key, enabled: !e.appEnabled })}
            />
          </li>
        ))}
        {(q.data ?? []).length === 0 && (
          <p className="py-2 text-sm text-gray-500">{t("admin.events.noDefinitions")}</p>
        )}
      </ul>
    </Card>
  );
}

type EventRuleRow = Awaited<ReturnType<typeof adminListEventRules>>[number];

function RewardRulesSection({ appId }: { appId: string }) {
  const { t } = useTranslation();
  const mappingListFn = useServerFn(adminListApplicationEvents);
  const rulesListFn = useServerFn(adminListEventRules);
  const mappingQ = useQuery({
    queryKey: ["admin-application-events", appId],
    queryFn: () => mappingListFn({ data: { appId } }),
  });
  const rulesQ = useQuery({
    queryKey: ["admin-event-rules", appId],
    queryFn: () => rulesListFn({ data: { appId } }),
  });

  const enabledEvents = (mappingQ.data ?? []).filter((e) => e.appEnabled);
  const rulesByKey = new Map((rulesQ.data ?? []).map((r) => [r.event_key, r]));

  return (
    <Card title={t("admin.events.rulesTitle")}>
      {enabledEvents.length === 0 && (
        <p className="text-sm text-gray-500">{t("admin.events.noEnabledEvents")}</p>
      )}
      <div className="space-y-4">
        {enabledEvents.map((e) => (
          <RuleRow
            key={e.event_key}
            appId={appId}
            eventKey={e.event_key}
            label={e.display_name}
            rule={rulesByKey.get(e.event_key) ?? null}
          />
        ))}
      </div>
    </Card>
  );
}

function RuleRow({
  appId,
  eventKey,
  label,
  rule,
}: {
  // null = GLOBAL rule (Priority 15 Phase A) -- see GlobalRulesSection.
  appId: string | null;
  eventKey: string;
  label: string;
  rule: EventRuleRow | null;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const upsertFn = useServerFn(adminUpsertEventRule);

  const [points, setPoints] = useState(rule?.points ?? 0);
  const [lifetimePoints, setLifetimePoints] = useState(rule?.lifetime_points ?? 0);
  const [cooldownSeconds, setCooldownSeconds] = useState(rule?.cooldown_seconds ?? 0);
  const [maxExecutions, setMaxExecutions] = useState<number | "">(rule?.max_executions ?? "");
  const [dailyLimit, setDailyLimit] = useState<number | "">(rule?.daily_limit ?? "");
  const [weeklyLimit, setWeeklyLimit] = useState<number | "">(rule?.weekly_limit ?? "");
  const [monthlyLimit, setMonthlyLimit] = useState<number | "">(rule?.monthly_limit ?? "");
  const [priority, setPriority] = useState(rule?.priority ?? 0);
  const [repeatable, setRepeatable] = useState(rule?.repeatable ?? true);
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [showConditions, setShowConditions] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      upsertFn({
        data: {
          id: rule?.id,
          appId,
          eventKey,
          points,
          lifetimePoints,
          cooldownSeconds,
          maxExecutions: maxExecutions === "" ? null : maxExecutions,
          dailyLimit: dailyLimit === "" ? null : dailyLimit,
          weeklyLimit: weeklyLimit === "" ? null : weeklyLimit,
          monthlyLimit: monthlyLimit === "" ? null : monthlyLimit,
          priority,
          repeatable,
          displayOrder: rule?.display_order ?? 0,
          enabled,
          archived: rule?.archived ?? false,
        },
      }),
    onSuccess: () => {
      toast.success(t("admin.events.saved"));
      void qc.invalidateQueries({ queryKey: ["admin-event-rules", appId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const numberField = (
    labelKey: string,
    value: number | "",
    setValue: (v: number | "") => void,
  ) => (
    <label className="text-xs">
      {t(labelKey)}
      <input
        type="number"
        value={value}
        onChange={(e) => setValue(e.target.value === "" ? "" : Number(e.target.value))}
        className="mt-1 block w-24 rounded-lg border border-gray-200 px-2 py-1 text-sm"
      />
    </label>
  );

  return (
    <div className="rounded-xl border border-gray-100 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">
          {label} <span className="text-gray-400">({eventKey})</span>
        </span>
        <AdminTogglePill enabled={enabled} onClick={() => setEnabled((v) => !v)} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {numberField("admin.events.points", points, (v) => setPoints(v === "" ? 0 : v))}
        {numberField("admin.events.lifetimePoints", lifetimePoints, (v) =>
          setLifetimePoints(v === "" ? 0 : v),
        )}
        {numberField("admin.events.cooldownSeconds", cooldownSeconds, (v) =>
          setCooldownSeconds(v === "" ? 0 : v),
        )}
        {numberField("admin.events.maxExecutions", maxExecutions, setMaxExecutions)}
        {numberField("admin.events.dailyLimit", dailyLimit, setDailyLimit)}
        {numberField("admin.events.weeklyLimit", weeklyLimit, setWeeklyLimit)}
        {numberField("admin.events.monthlyLimit", monthlyLimit, setMonthlyLimit)}
        {numberField("admin.events.priority", priority, (v) => setPriority(v === "" ? 0 : v))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={repeatable}
            onChange={(e) => setRepeatable(e.target.checked)}
          />
          {t("admin.events.repeatable")}
        </label>
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="rounded-lg bg-[#1D6BF3] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          {t("admin.events.save")}
        </button>
        {rule?.id && (
          <button
            onClick={() => setShowConditions((v) => !v)}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
          >
            {t("admin.events.conditions")}
          </button>
        )}
      </div>
      {showConditions && rule?.id && <ConditionsEditor ruleId={rule.id} />}
    </div>
  );
}

function ConditionsEditor({ ruleId }: { ruleId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const listFn = useServerFn(adminListEventRuleConditions);
  const upsertFn = useServerFn(adminUpsertEventRuleCondition);
  const deleteFn = useServerFn(adminDeleteEventRuleCondition);
  const q = useQuery({
    queryKey: ["admin-event-rule-conditions", ruleId],
    queryFn: () => listFn({ data: { ruleId } }),
  });
  const [conditionType, setConditionType] = useState("");
  const [paramsText, setParamsText] = useState("{}");

  const add = useMutation({
    mutationFn: () => {
      let params: Record<string, unknown>;
      try {
        params = JSON.parse(paramsText || "{}");
      } catch {
        throw new Error(t("admin.events.invalidParams"));
      }
      return upsertFn({ data: { ruleId, conditionType, params, displayOrder: 0 } });
    },
    onSuccess: () => {
      setConditionType("");
      setParamsText("{}");
      void qc.invalidateQueries({ queryKey: ["admin-event-rule-conditions", ruleId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ["admin-event-rule-conditions", ruleId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mt-3 rounded-lg bg-gray-50 p-3">
      <ul className="divide-y divide-gray-100">
        {(q.data ?? []).map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-2 py-1.5 text-xs">
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">{c.condition_type}</span>{" "}
              <span className="text-gray-400">{JSON.stringify(c.params)}</span>
            </span>
            <button
              onClick={() => remove.mutate(c.id)}
              className="text-gray-400 hover:text-red-600"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
        {(q.data ?? []).length === 0 && (
          <p className="py-1.5 text-xs text-gray-500">{t("admin.events.noConditions")}</p>
        )}
      </ul>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="text-xs">
          {t("admin.common.key")}
          <input
            value={conditionType}
            onChange={(e) => setConditionType(e.target.value)}
            placeholder={t("admin.events.conditionTypePlaceholder")}
            className="mt-1 block rounded-lg border border-gray-200 px-2 py-1 text-sm"
          />
        </label>
        <label className="text-xs">
          {t("admin.events.paramsPlaceholder")}
          <input
            value={paramsText}
            onChange={(e) => setParamsText(e.target.value)}
            className="mt-1 block w-40 rounded-lg border border-gray-200 px-2 py-1 font-mono text-sm"
          />
        </label>
        <button
          onClick={() => add.mutate()}
          disabled={!conditionType.trim() || add.isPending}
          className="inline-flex items-center gap-1 rounded-lg bg-[#1D6BF3] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" /> {t("admin.events.addCondition")}
        </button>
      </div>
    </div>
  );
}

function AnalyticsSection({ appId }: { appId: string | null }) {
  const { t } = useTranslation();
  const analyticsFn = useServerFn(adminGetEventAnalytics);
  const [sinceDays, setSinceDays] = useState(30);
  const q = useQuery({
    queryKey: ["admin-event-analytics", appId, sinceDays],
    queryFn: () => analyticsFn({ data: { appId, sinceDays } }),
  });

  return (
    <Card title={t("admin.events.analyticsTitle")}>
      <label className="text-xs">
        {t("admin.events.analyticsSinceDays")}
        <input
          type="number"
          min={1}
          max={365}
          value={sinceDays}
          onChange={(e) => setSinceDays(Number(e.target.value) || 30)}
          className="mt-1 block w-24 rounded-lg border border-gray-200 px-2 py-1 text-sm"
        />
      </label>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase text-gray-500">
            {t("admin.events.analyticsByEvent")}
          </p>
          <ul className="divide-y divide-gray-100 text-sm">
            {(q.data?.byEvent ?? []).map((r) => (
              <li key={r.eventKey} className="flex items-center justify-between gap-2 py-1.5">
                <span className="min-w-0 flex-1 truncate">{r.eventKey}</span>
                <span className="shrink-0 text-gray-500">
                  {r.executionCount}× · {r.totalPoints} pts
                </span>
              </li>
            ))}
            {(q.data?.byEvent ?? []).length === 0 && (
              <p className="py-1.5 text-sm text-gray-500">{t("admin.events.analyticsEmpty")}</p>
            )}
          </ul>
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase text-gray-500">
            {t("admin.events.analyticsTopEarners")}
          </p>
          <ul className="divide-y divide-gray-100 text-sm">
            {(q.data?.topEarners ?? []).map((r) => (
              <li key={r.userId} className="flex items-center justify-between gap-2 py-1.5">
                <span className="min-w-0 flex-1 truncate">{r.name ?? r.username ?? r.userId}</span>
                <span className="shrink-0 text-gray-500">{r.totalPoints} pts</span>
              </li>
            ))}
            {(q.data?.topEarners ?? []).length === 0 && (
              <p className="py-1.5 text-sm text-gray-500">{t("admin.events.analyticsEmpty")}</p>
            )}
          </ul>
        </div>
      </div>
    </Card>
  );
}
