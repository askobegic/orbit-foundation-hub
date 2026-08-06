import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Check, Gift, Plus, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { AdminTogglePill } from "@/components/admin/AdminTogglePill";
import { supabase } from "@/integrations/supabase/client";
import { getMyIsAdmin } from "@/lib/admin.functions";
import {
  adminFulfillAdvertisingCreditRedemption,
  adminListAdPlacementPrices,
  adminListAdPlacements,
  adminListCampaigns,
  adminListPendingAdvertisingCreditRedemptions,
  adminListTrustedAdvertisers,
  adminModerateCampaign,
  adminSetAdApplicationSettings,
  adminSetAdConfig,
  adminSetAdDraftExpiryHours,
  adminSetTrustedAdvertiser,
  adminUpsertAdPlacement,
  adminUpsertAdPlacementPrice,
} from "@/lib/advertising.functions";
import type { ApplicationRow } from "@/types/database";

export const Route = createFileRoute("/admin/advertising")({
  head: () => ({
    meta: [
      { title: "Admin · Advertising — Core Platform" },
      { name: "description", content: "Manage placements, pricing, moderation and trusted advertisers." },
    ],
  }),
  component: () => (
    <ProtectedRoute>
      <AdminAdvertising />
    </ProtectedRoute>
  ),
});

function AdminAdvertising() {
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
      const { data, error } = await supabase.from("applications").select("*").order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ApplicationRow[];
    },
  });

  return (
    <main className="min-h-screen bg-[#F7F8FA] px-6 py-10">
      <div className="mx-auto max-w-5xl">
        <Link to="/admin" className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900">
          <ArrowLeft className="h-4 w-4" /> {t("admin.common.back")}
        </Link>
        <h1 className="text-2xl font-semibold text-gray-900">{t("admin.advertising.title")}</h1>
        <p className="mt-1 text-sm text-gray-500">{t("admin.advertising.subtitle")}</p>

        <PlacementsSection />
        <PricesSection apps={appsQ.data ?? []} />
        <ConfigSection apps={appsQ.data ?? []} />
        <DraftExpirySection />
        <TrustedAdvertisersSection apps={appsQ.data ?? []} />
        <ModerationQueueSection />
        <CreditFulfillmentSection />
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

function PlacementsSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const listFn = useServerFn(adminListAdPlacements);
  const upsertFn = useServerFn(adminUpsertAdPlacement);
  const q = useQuery({ queryKey: ["admin-ad-placements"], queryFn: () => listFn() });
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");

  const mut = useMutation({
    mutationFn: () => upsertFn({ data: { key, label, enabled: true, archived: false, displayOrder: 0 } }),
    onSuccess: () => {
      toast.success(t("admin.advertising.placementCreated"));
      setKey("");
      setLabel("");
      void qc.invalidateQueries({ queryKey: ["admin-ad-placements"] });
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
          displayOrder: row.display_order,
          enabled: !row.enabled,
          archived: row.archived,
        },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-ad-placements"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card title={t("admin.advertising.placementsTitle")}>
      <div className="grid grid-cols-1 items-end gap-2 sm:flex sm:flex-wrap">
        <label className="text-sm">
          {t("admin.common.key")}
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={t("admin.advertising.placementKeyPlaceholder")}
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
          onClick={() => mut.mutate()}
          disabled={!key.trim() || !label.trim() || mut.isPending}
          className="inline-flex items-center justify-center gap-1 rounded-lg bg-[#1D6BF3] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> {t("admin.common.add")}
        </button>
      </div>
      <ul className="mt-4 divide-y divide-gray-100">
        {(q.data ?? []).map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">{p.label}</span>{" "}
              <span className="text-gray-400">({p.key})</span>
            </span>
            <AdminTogglePill enabled={p.enabled} onClick={() => toggle.mutate(p)} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function PricesSection({ apps }: { apps: ApplicationRow[] }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const listPlacementsFn = useServerFn(adminListAdPlacements);
  const listPricesFn = useServerFn(adminListAdPlacementPrices);
  const upsertFn = useServerFn(adminUpsertAdPlacementPrice);
  const placementsQ = useQuery({ queryKey: ["admin-ad-placements"], queryFn: () => listPlacementsFn() });
  const pricesQ = useQuery({ queryKey: ["admin-ad-prices"], queryFn: () => listPricesFn({ data: {} }) });

  const [placementKey, setPlacementKey] = useState("");
  const [appId, setAppId] = useState(""); // "" = global
  const [durationDays, setDurationDays] = useState(30);
  const [price, setPrice] = useState(0);
  const [currency, setCurrency] = useState("EUR");

  const mut = useMutation({
    mutationFn: () =>
      upsertFn({
        data: {
          appId: appId || null,
          placementKey,
          pricingStrategy: "fixed_duration",
          durationDays,
          price,
          currency,
          enabled: true,
          archived: false,
          displayOrder: 0,
        },
      }),
    onSuccess: () => {
      toast.success(t("admin.advertising.priceAdded"));
      void qc.invalidateQueries({ queryKey: ["admin-ad-prices"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card title={t("admin.advertising.pricingTitle")}>
      <div className="grid grid-cols-1 items-end gap-2 sm:flex sm:flex-wrap">
        <label className="text-sm">
          {t("admin.advertising.placement")}
          <select
            value={placementKey}
            onChange={(e) => setPlacementKey(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-auto"
          >
            <option value="">{t("admin.common.select")}</option>
            {(placementsQ.data ?? []).map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          {t("admin.common.application")}
          <select
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-auto"
          >
            <option value="">{t("admin.advertising.global")}</option>
            {apps.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          {t("admin.advertising.durationDays")}
          <input
            type="number"
            value={durationDays}
            onChange={(e) => setDurationDays(Number(e.target.value))}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-24"
          />
        </label>
        <label className="text-sm">
          {t("admin.advertising.price")}
          <input
            type="number"
            value={price}
            onChange={(e) => setPrice(Number(e.target.value))}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-24"
          />
        </label>
        <label className="text-sm">
          {t("admin.advertising.currency")}
          <input
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-20"
          />
        </label>
        <button
          onClick={() => mut.mutate()}
          disabled={!placementKey || mut.isPending}
          className="inline-flex items-center justify-center gap-1 rounded-lg bg-[#1D6BF3] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> {t("admin.advertising.addPrice")}
        </button>
      </div>
      <p className="mt-3 text-xs text-gray-500">{t("admin.advertising.priceHint")}</p>
      <ul className="mt-4 divide-y divide-gray-100">
        {(pricesQ.data ?? []).map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate">
              {p.placement_key} — {p.duration_days}d — {p.price} {p.currency}{" "}
              <span className="text-gray-400">
                ({apps.find((a) => a.id === p.app_id)?.name ?? t("admin.advertising.globalShort")})
              </span>
            </span>
            {!p.stripe_payment_link && !p.paypal_payment_link && (
              <span className="shrink-0 text-xs text-amber-600">{t("admin.advertising.noPaymentLink")}</span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

type AdConfigInput =
  | { key: "moderation_mode"; value: "manual" | "auto" | "trusted_only" }
  | { key: "eligibility_rule"; value: "anyone" | "premium_only" | "verified_only" | "trusted_only" };

function ConfigSection({ apps }: { apps: ApplicationRow[] }) {
  const { t } = useTranslation();
  const setConfigFn = useServerFn(adminSetAdConfig);
  const setAppSettingsFn = useServerFn(adminSetAdApplicationSettings);
  const [appId, setAppId] = useState("");
  const [moderationMode, setModerationMode] = useState<"manual" | "auto" | "trusted_only">("manual");
  const [eligibilityRule, setEligibilityRule] = useState<
    "anyone" | "premium_only" | "verified_only" | "trusted_only"
  >("anyone");

  const globalMut = useMutation<unknown, Error, AdConfigInput>({
    mutationFn: (input) => setConfigFn({ data: input }),
    onSuccess: () => toast.success(t("admin.advertising.globalDefaultUpdated")),
    onError: (e: Error) => toast.error(e.message),
  });

  const appMut = useMutation({
    mutationFn: () =>
      setAppSettingsFn({
        data: { appId, moderationMode, eligibilityRule },
      }),
    onSuccess: () => toast.success(t("admin.advertising.overrideSaved")),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card title={t("admin.advertising.moderationEligibilityTitle")}>
      <div>
        <p className="text-sm font-medium text-gray-700">{t("admin.advertising.globalDefaults")}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {(["manual", "auto", "trusted_only"] as const).map((m) => (
            <button
              key={m}
              onClick={() => globalMut.mutate({ key: "moderation_mode", value: m })}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50"
            >
              {t("admin.advertising.moderationPrefix", { mode: t(`admin.advertising.moderationMode.${m}`) })}
            </button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {(["anyone", "premium_only", "verified_only", "trusted_only"] as const).map((r) => (
            <button
              key={r}
              onClick={() => globalMut.mutate({ key: "eligibility_rule", value: r })}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50"
            >
              {t("admin.advertising.eligibilityPrefix", { rule: t(`admin.advertising.eligibilityRule.${r}`) })}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6 border-t border-gray-100 pt-4">
        <p className="text-sm font-medium text-gray-700">{t("admin.advertising.perAppOverride")}</p>
        <div className="mt-2 grid grid-cols-1 items-end gap-2 sm:flex sm:flex-wrap">
          <label className="text-sm">
            {t("admin.common.application")}
            <select
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-auto"
            >
              <option value="">{t("admin.common.select")}</option>
              {apps.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            {t("admin.advertising.moderation")}
            <select
              value={moderationMode}
              onChange={(e) => setModerationMode(e.target.value as typeof moderationMode)}
              className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-auto"
            >
              <option value="manual">{t("admin.advertising.moderationMode.manual")}</option>
              <option value="auto">{t("admin.advertising.moderationMode.auto")}</option>
              <option value="trusted_only">{t("admin.advertising.moderationMode.trusted_only")}</option>
            </select>
          </label>
          <label className="text-sm">
            {t("admin.advertising.eligibility")}
            <select
              value={eligibilityRule}
              onChange={(e) => setEligibilityRule(e.target.value as typeof eligibilityRule)}
              className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-auto"
            >
              <option value="anyone">{t("admin.advertising.eligibilityRule.anyone")}</option>
              <option value="premium_only">{t("admin.advertising.eligibilityRule.premium_only")}</option>
              <option value="verified_only">{t("admin.advertising.eligibilityRule.verified_only")}</option>
              <option value="trusted_only">{t("admin.advertising.eligibilityRule.trusted_only")}</option>
            </select>
          </label>
          <button
            onClick={() => appMut.mutate()}
            disabled={!appId || appMut.isPending}
            className="rounded-lg bg-[#1D6BF3] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {t("admin.advertising.saveOverride")}
          </button>
        </div>
      </div>
    </Card>
  );
}

function DraftExpirySection() {
  const { t } = useTranslation();
  const setHoursFn = useServerFn(adminSetAdDraftExpiryHours);
  const [hours, setHours] = useState(48);

  const mut = useMutation({
    mutationFn: () => setHoursFn({ data: { hours } }),
    onSuccess: () => toast.success(t("admin.advertising.draftExpiryUpdated")),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card title={t("admin.advertising.draftExpiryTitle")}>
      <p className="text-xs text-gray-500">{t("admin.advertising.draftExpiryHint")}</p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="text-sm">
          {t("admin.advertising.hours")}
          <input
            type="number"
            min={1}
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-24"
          />
        </label>
        <button
          onClick={() => mut.mutate()}
          disabled={mut.isPending}
          className="rounded-lg bg-[#1D6BF3] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {t("common.save")}
        </button>
      </div>
    </Card>
  );
}

function TrustedAdvertisersSection({ apps }: { apps: ApplicationRow[] }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const listFn = useServerFn(adminListTrustedAdvertisers);
  const setFn = useServerFn(adminSetTrustedAdvertiser);
  const [appId, setAppId] = useState("");
  const q = useQuery({
    queryKey: ["admin-trusted-advertisers", appId],
    enabled: !!appId,
    queryFn: () => listFn({ data: { appId } }),
  });
  const [username, setUsername] = useState("");

  const grant = useMutation({
    mutationFn: async () => {
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("id")
        .eq("username", username.trim())
        .maybeSingle();
      if (error) throw error;
      if (!profile) throw new Error(t("admin.trials.userNotFound"));
      return setFn({ data: { userId: profile.id, appId, trusted: true } });
    },
    onSuccess: () => {
      toast.success(t("admin.advertising.trustedGranted"));
      setUsername("");
      void qc.invalidateQueries({ queryKey: ["admin-trusted-advertisers", appId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revoke = useMutation({
    mutationFn: (userId: string) => setFn({ data: { userId, appId, trusted: false } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-trusted-advertisers", appId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card title={t("admin.advertising.trustedAdvertisersTitle")}>
      <p className="mb-3 text-xs text-gray-500">{t("admin.advertising.trustedAdvertisersHint")}</p>
      <div className="grid grid-cols-1 items-end gap-2 sm:flex">
        <label className="text-sm">
          {t("admin.common.application")}
          <select
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-auto"
          >
            <option value="">{t("admin.common.select")}</option>
            {apps.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          {t("admin.trials.username")}
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-auto"
          />
        </label>
        <button
          onClick={() => grant.mutate()}
          disabled={!appId || !username.trim() || grant.isPending}
          className="inline-flex items-center justify-center gap-1 rounded-lg bg-[#1D6BF3] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          <ShieldCheck className="h-4 w-4" /> {t("admin.common.grant")}
        </button>
      </div>
      <ul className="mt-4 divide-y divide-gray-100">
        {(q.data ?? []).map((row) => (
          <li key={row.user_id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate">
              {[row.profiles?.first_name, row.profiles?.last_name].filter(Boolean).join(" ") ||
                row.profiles?.username ||
                row.user_id}
            </span>
            <button
              onClick={() => revoke.mutate(row.user_id)}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
            >
              <X className="h-3 w-3" /> {t("admin.common.revoke")}
            </button>
          </li>
        ))}
        {(q.data ?? []).length === 0 && <p className="py-2 text-sm text-gray-500">{t("admin.advertising.noTrustedAdvertisers")}</p>}
      </ul>
    </Card>
  );
}

function ModerationQueueSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const listFn = useServerFn(adminListCampaigns);
  const moderateFn = useServerFn(adminModerateCampaign);
  const q = useQuery({ queryKey: ["admin-campaigns", "pending"], queryFn: () => listFn({ data: { status: "pending" } }) });

  const mut = useMutation({
    mutationFn: (v: { campaignId: string; approve: boolean }) => moderateFn({ data: v }),
    onSuccess: () => {
      toast.success(t("admin.common.updated"));
      void qc.invalidateQueries({ queryKey: ["admin-campaigns", "pending"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card title={t("admin.advertising.moderationQueueTitle")}>
      {(q.data ?? []).length === 0 ? (
        <p className="text-sm text-gray-500">{t("admin.common.nothingPending")}</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {q.data!.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-gray-800">{c.title}</p>
                <p className="truncate text-xs text-gray-500">
                  {c.placement_key} ·{" "}
                  {[c.profiles?.first_name, c.profiles?.last_name].filter(Boolean).join(" ") ||
                    c.profiles?.username}{" "}
                  · {c.applications?.name}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  onClick={() => mut.mutate({ campaignId: c.id, approve: true })}
                  className="inline-flex items-center gap-1 rounded-lg bg-[#1D6BF3] px-3 py-1.5 text-sm font-semibold text-white"
                >
                  <Check className="h-4 w-4" /> {t("admin.common.approve")}
                </button>
                <button
                  onClick={() => mut.mutate({ campaignId: c.id, approve: false })}
                  className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                >
                  <X className="h-4 w-4" /> {t("admin.common.reject")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function CreditFulfillmentSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const listFn = useServerFn(adminListPendingAdvertisingCreditRedemptions);
  const fulfillFn = useServerFn(adminFulfillAdvertisingCreditRedemption);
  const q = useQuery({ queryKey: ["admin-pending-ad-credits"], queryFn: () => listFn() });

  const mut = useMutation({
    mutationFn: (redemptionId: string) => fulfillFn({ data: { redemptionId } }),
    onSuccess: () => {
      toast.success(t("admin.advertising.creditFulfilled"));
      void qc.invalidateQueries({ queryKey: ["admin-pending-ad-credits"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card title={t("admin.advertising.creditFulfillmentTitle")}>
      {(q.data ?? []).length === 0 ? (
        <p className="text-sm text-gray-500">{t("admin.common.nothingPending")}</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {q.data!.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
              <span className="min-w-0 flex-1 truncate">
                <Gift className="mr-1 inline h-4 w-4 text-amber-500" />
                {[r.profiles?.first_name, r.profiles?.last_name].filter(Boolean).join(" ") || r.profiles?.username}
              </span>
              <button
                onClick={() => mut.mutate(r.id)}
                className="shrink-0 rounded-lg bg-[#1D6BF3] px-3 py-1.5 text-sm font-semibold text-white"
              >
                {t("admin.advertising.fulfill")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
