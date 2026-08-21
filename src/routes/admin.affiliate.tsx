// Universal CORE Affiliate System -- Admin management: Offers, Affiliates,
// Conversions, Payouts, and global Config. Same Card-based pattern as
// /admin/offers-coupons and /admin/dashboard-actions.
import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { getMyIsAdmin } from "@/lib/admin.functions";
import { supabase } from "@/integrations/supabase/client";
import type { ApplicationRow } from "@/types/database";
import {
  adminArchiveAffiliateOffer,
  adminListAffiliateConfig,
  adminListAffiliateConversions,
  adminListAffiliateOffers,
  adminListAffiliatePayouts,
  adminListAffiliates,
  adminMarkAffiliatePayoutPaid,
  adminReverseAffiliateConversion,
  adminSetAffiliateConfig,
  adminSetAffiliateOfferEnabled,
  adminSetAffiliateStatus,
  adminUpsertAffiliateOffer,
} from "@/lib/affiliate.functions";

export const Route = createFileRoute("/admin/affiliate")({
  head: () => ({
    meta: [{ title: "Admin · Affiliate — Core Platform" }],
  }),
  component: () => (
    <ProtectedRoute>
      <AdminAffiliate />
    </ProtectedRoute>
  ),
});

function AdminAffiliate() {
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
        <h1 className="text-2xl font-semibold text-gray-900">{t("admin.affiliate.title")}</h1>
        <p className="mt-1 text-sm text-gray-500">{t("admin.affiliate.subtitle")}</p>

        <ConfigSection />
        <OffersSection />
        <AffiliatesSection />
        <ConversionsSection />
        <PayoutsSection />
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

function ConfigSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const listFn = useServerFn(adminListAffiliateConfig);
  const setFn = useServerFn(adminSetAffiliateConfig);
  const q = useQuery({ queryKey: ["admin-affiliate-config"], queryFn: () => listFn() });

  const update = useMutation({
    mutationFn: (row: { key: string; value: unknown }) => setFn({ data: row }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-affiliate-config"] }),
  });

  return (
    <Card title={t("admin.affiliate.configTitle")}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {(q.data ?? []).map((row) => (
          <label key={row.key} className="text-sm">
            {row.key}
            {row.key === "enabled" ? (
              <select
                value={String(row.value)}
                onChange={(e) => update.mutate({ key: row.key, value: e.target.value === "true" })}
                className={inputCls}
              >
                <option value="true">{t("admin.common.enable")}</option>
                <option value="false">{t("admin.common.disable")}</option>
              </select>
            ) : (
              <input
                defaultValue={String(row.value)}
                onBlur={(e) => {
                  const num = Number(e.target.value);
                  update.mutate({ key: row.key, value: Number.isNaN(num) ? e.target.value : num });
                }}
                className={inputCls}
              />
            )}
            {row.description && (
              <p className="mt-0.5 text-[11px] text-gray-400">{row.description}</p>
            )}
          </label>
        ))}
      </div>
    </Card>
  );
}

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

function OffersSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const listFn = useServerFn(adminListAffiliateOffers);
  const upsertFn = useServerFn(adminUpsertAffiliateOffer);
  const setEnabledFn = useServerFn(adminSetAffiliateOfferEnabled);
  const archiveFn = useServerFn(adminArchiveAffiliateOffer);
  const appsQ = useApplicationsList();
  const q = useQuery({ queryKey: ["admin-affiliate-offers"], queryFn: () => listFn() });

  const [sourceType, setSourceType] = useState<"core" | "application">("core");
  const [sourceAppId, setSourceAppId] = useState("");
  const [sourceProductType, setSourceProductType] = useState("subscription_plan");
  const [sourceProductId, setSourceProductId] = useState("");
  const [titleBs, setTitleBs] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [titleDe, setTitleDe] = useState("");
  const [destinationUrl, setDestinationUrl] = useState("");
  const [commissionType, setCommissionType] = useState<"percent" | "fixed">("percent");
  const [commissionRate, setCommissionRate] = useState(10);
  const [commissionFixedAmount, setCommissionFixedAmount] = useState(0);

  const create = useMutation({
    mutationFn: () =>
      upsertFn({
        data: {
          sourceType,
          sourceAppId: sourceType === "application" ? sourceAppId : undefined,
          sourceProductType,
          sourceProductId,
          titleBs,
          titleEn,
          titleDe,
          destinationUrl,
          commissionType,
          commissionRate: commissionType === "percent" ? commissionRate : undefined,
          commissionFixedAmount: commissionType === "fixed" ? commissionFixedAmount : undefined,
          enabled: false,
        },
      }),
    onSuccess: () => {
      toast.success(t("admin.common.create"));
      setTitleBs("");
      setTitleEn("");
      setTitleDe("");
      setSourceProductId("");
      setDestinationUrl("");
      void qc.invalidateQueries({ queryKey: ["admin-affiliate-offers"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: (row: { id: string; enabled: boolean }) =>
      setEnabledFn({ data: { id: row.id, enabled: !row.enabled } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-affiliate-offers"] }),
  });
  const archive = useMutation({
    mutationFn: (id: string) => archiveFn({ data: { id } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-affiliate-offers"] }),
  });

  const canCreate = titleBs && titleEn && titleDe && destinationUrl && sourceProductId;

  return (
    <Card title={t("admin.affiliate.offersTitle")}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-sm">
          {t("admin.affiliate.sourceType")}
          <select
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value as "core" | "application")}
            className={inputCls}
          >
            <option value="core">{t("admin.affiliate.sourceCore")}</option>
            <option value="application">{t("admin.affiliate.sourceApplication")}</option>
          </select>
        </label>
        {sourceType === "application" && (
          <label className="text-sm">
            {t("admin.common.application")}
            <select
              value={sourceAppId}
              onChange={(e) => setSourceAppId(e.target.value)}
              className={inputCls}
            >
              <option value="">{t("admin.common.select")}</option>
              {(appsQ.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="text-sm">
          {t("admin.affiliate.sourceProductType")}
          <input
            value={sourceProductType}
            onChange={(e) => setSourceProductType(e.target.value)}
            className={inputCls}
          />
        </label>
        <label className="text-sm">
          {t("admin.affiliate.sourceProductId")}
          <input
            value={sourceProductId}
            onChange={(e) => setSourceProductId(e.target.value)}
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
        <label className="text-sm sm:col-span-2">
          {t("admin.affiliate.destinationUrl")}
          <input
            value={destinationUrl}
            onChange={(e) => setDestinationUrl(e.target.value)}
            className={inputCls}
          />
        </label>
        <label className="text-sm">
          {t("admin.affiliate.commissionType")}
          <select
            value={commissionType}
            onChange={(e) => setCommissionType(e.target.value as "percent" | "fixed")}
            className={inputCls}
          >
            <option value="percent">%</option>
            <option value="fixed">€</option>
          </select>
        </label>
        {commissionType === "percent" ? (
          <label className="text-sm">
            {t("admin.affiliate.commissionRate")}
            <input
              type="number"
              value={commissionRate}
              onChange={(e) => setCommissionRate(Number(e.target.value))}
              className={inputCls}
            />
          </label>
        ) : (
          <label className="text-sm">
            {t("admin.affiliate.commissionFixedAmount")}
            <input
              type="number"
              value={commissionFixedAmount}
              onChange={(e) => setCommissionFixedAmount(Number(e.target.value))}
              className={inputCls}
            />
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
        {(q.data ?? []).map((row: NonNullable<typeof q.data>[number]) => (
          <li key={row.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <span className="min-w-0 truncate">
              {row.title_bs} — {row.source_type}
              {row.applications ? ` (${(row.applications as { name: string }).name})` : ""} —{" "}
              {row.commission_type === "percent"
                ? `${row.commission_rate}%`
                : `${row.commission_fixed_amount}€`}
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

function AffiliatesSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const listFn = useServerFn(adminListAffiliates);
  const setStatusFn = useServerFn(adminSetAffiliateStatus);
  const q = useQuery({ queryKey: ["admin-affiliates"], queryFn: () => listFn() });

  const setStatus = useMutation({
    mutationFn: (row: { userId: string; status: "active" | "suspended" | "disabled" }) =>
      setStatusFn({ data: row }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-affiliates"] }),
  });

  return (
    <Card title={t("admin.affiliate.affiliatesTitle")}>
      <ul className="divide-y divide-gray-100">
        {(q.data ?? []).map((row: NonNullable<typeof q.data>[number]) => {
          const profile = row.profiles as {
            username: string | null;
            first_name: string | null;
          } | null;
          return (
            <li key={row.user_id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span className="min-w-0 truncate">
                {profile?.username ?? profile?.first_name ?? row.user_id} — {row.status}
              </span>
              <span className="flex shrink-0 gap-2">
                {(["active", "suspended", "disabled"] as const)
                  .filter((s) => s !== row.status)
                  .map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setStatus.mutate({ userId: row.user_id, status: s })}
                      className="rounded-lg border border-gray-200 px-2 py-1 text-xs"
                    >
                      {s}
                    </button>
                  ))}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function ConversionsSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const listFn = useServerFn(adminListAffiliateConversions);
  const reverseFn = useServerFn(adminReverseAffiliateConversion);
  const q = useQuery({ queryKey: ["admin-affiliate-conversions"], queryFn: () => listFn() });

  const reverse = useMutation({
    mutationFn: (transactionRef: string) =>
      reverseFn({ data: { transactionRef, reason: "admin_manual_reversal" } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-affiliate-conversions"] }),
  });

  return (
    <Card title={t("admin.affiliate.conversionsTitle")}>
      <ul className="divide-y divide-gray-100">
        {(q.data ?? []).map((row: NonNullable<typeof q.data>[number]) => {
          const offer = row.affiliate_offers as { title_bs: string } | null;
          const profile = row.profiles as { username: string | null } | null;
          return (
            <li key={row.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span className="min-w-0 truncate">
                {offer?.title_bs} — {profile?.username} — {Number(row.commission_amount).toFixed(2)}{" "}
                {row.currency} — {row.status}
              </span>
              {row.status !== "reversed" && (
                <button
                  type="button"
                  onClick={() => reverse.mutate(row.transaction_ref)}
                  className="shrink-0 rounded-lg border border-gray-200 px-2 py-1 text-xs text-red-600"
                >
                  {t("admin.affiliate.reverse")}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function PayoutsSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const listFn = useServerFn(adminListAffiliatePayouts);
  const markPaidFn = useServerFn(adminMarkAffiliatePayoutPaid);
  const q = useQuery({ queryKey: ["admin-affiliate-payouts"], queryFn: () => listFn() });
  const [refInput, setRefInput] = useState<Record<string, string>>({});

  const markPaid = useMutation({
    mutationFn: (id: string) => markPaidFn({ data: { id, payoutReference: refInput[id] ?? "" } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-affiliate-payouts"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card title={t("admin.affiliate.payoutsTitle")}>
      <p className="mb-3 text-xs text-gray-500">{t("admin.affiliate.payoutsHint")}</p>
      <ul className="divide-y divide-gray-100">
        {(q.data ?? []).map((row: NonNullable<typeof q.data>[number]) => {
          const profile = row.profiles as {
            username: string | null;
            first_name: string | null;
          } | null;
          return (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
            >
              <span className="min-w-0 truncate">
                {profile?.username ?? profile?.first_name} — {Number(row.amount).toFixed(2)}{" "}
                {row.currency} — {row.status}
              </span>
              {row.status === "pending" && (
                <span className="flex shrink-0 gap-2">
                  <input
                    placeholder={t("admin.affiliate.payoutReferencePlaceholder")}
                    value={refInput[row.id] ?? ""}
                    onChange={(e) => setRefInput((prev) => ({ ...prev, [row.id]: e.target.value }))}
                    className="rounded-lg border border-gray-200 px-2 py-1 text-xs"
                  />
                  <button
                    type="button"
                    disabled={!refInput[row.id]}
                    onClick={() => markPaid.mutate(row.id)}
                    className="rounded-lg bg-[#1D6BF3] px-2 py-1 text-xs text-white disabled:opacity-50"
                  >
                    {t("admin.affiliate.markPaid")}
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
