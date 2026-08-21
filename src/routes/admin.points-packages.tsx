// CORE Rewards / Points Purchase -- Admin management for points_packages
// and the Buy Points ON/OFF switch. A new, small admin page rather than
// growing the already-large /admin/rewards further -- same precedent as
// /admin/offers-coupons splitting off from it.
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
import { adminListRewardConfig, adminSetRewardConfig } from "@/lib/rewards.functions";
import {
  adminListPointsPackages,
  adminListPointsPurchases,
  adminSetPointsPackageActive,
  adminUpsertPointsPackage,
} from "@/lib/points-purchase.functions";
import type { ApplicationRow } from "@/types/database";

export const Route = createFileRoute("/admin/points-packages")({
  head: () => ({
    meta: [{ title: "Admin · Points Packages — Core Platform" }],
  }),
  component: () => (
    <ProtectedRoute>
      <AdminPointsPackages />
    </ProtectedRoute>
  ),
});

function AdminPointsPackages() {
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
        <h1 className="text-2xl font-semibold text-gray-900">{t("admin.pointsPackages.title")}</h1>
        <p className="mt-1 text-sm text-gray-500">{t("admin.pointsPackages.subtitle")}</p>

        <BuySwitchSection />
        <PackagesSection />
        <PurchasesSection />
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

function BuySwitchSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const listFn = useServerFn(adminListRewardConfig);
  const setFn = useServerFn(adminSetRewardConfig);
  const q = useQuery({ queryKey: ["admin-reward-config"], queryFn: () => listFn() });
  const row = (q.data ?? []).find((r) => r.key === "buy_points_enabled");

  const update = useMutation({
    mutationFn: (value: boolean) => setFn({ data: { key: "buy_points_enabled", value } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-reward-config"] }),
  });

  return (
    <Card title={t("admin.pointsPackages.buySwitchTitle")}>
      <label className="flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={row?.value === true}
          onChange={(e) => update.mutate(e.target.checked)}
          className="h-4 w-4"
        />
        {t("admin.pointsPackages.buySwitchLabel")}
      </label>
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

function PackagesSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const listFn = useServerFn(adminListPointsPackages);
  const upsertFn = useServerFn(adminUpsertPointsPackage);
  const setActiveFn = useServerFn(adminSetPointsPackageActive);
  const appsQ = useApplicationsList();
  const q = useQuery({ queryKey: ["admin-points-packages"], queryFn: () => listFn() });

  const [appId, setAppId] = useState("");
  const [name, setName] = useState("");
  const [price, setPrice] = useState(4.99);
  const [pointsAmount, setPointsAmount] = useState(500);
  const [bonusPoints, setBonusPoints] = useState(0);
  const [stripeLink, setStripeLink] = useState("");
  const [paypalLink, setPaypalLink] = useState("");

  const create = useMutation({
    mutationFn: () =>
      upsertFn({
        data: {
          appId: appId || null,
          name,
          price,
          currency: "EUR",
          pointsAmount,
          bonusPoints,
          isActive: true,
          displayOrder: 0,
          stripePaymentLink: stripeLink || undefined,
          paypalPaymentLink: paypalLink || undefined,
        },
      }),
    onSuccess: () => {
      toast.success(t("admin.common.create"));
      setName("");
      setStripeLink("");
      setPaypalLink("");
      void qc.invalidateQueries({ queryKey: ["admin-points-packages"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: (row: { id: string; is_active: boolean }) =>
      setActiveFn({ data: { id: row.id, isActive: !row.is_active } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-points-packages"] }),
  });

  return (
    <Card title={t("admin.pointsPackages.packagesTitle")}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-sm">
          {t("admin.common.name")}
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
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
          {t("admin.pointsPackages.price")}
          <input
            type="number"
            value={price}
            onChange={(e) => setPrice(Number(e.target.value))}
            className={inputCls}
          />
        </label>
        <label className="text-sm">
          {t("admin.pointsPackages.pointsAmount")}
          <input
            type="number"
            value={pointsAmount}
            onChange={(e) => setPointsAmount(Number(e.target.value))}
            className={inputCls}
          />
        </label>
        <label className="text-sm">
          {t("admin.pointsPackages.bonusPoints")}
          <input
            type="number"
            value={bonusPoints}
            onChange={(e) => setBonusPoints(Number(e.target.value))}
            className={inputCls}
          />
        </label>
        <label className="text-sm">
          {t("admin.pointsPackages.stripeLink")}
          <input
            value={stripeLink}
            onChange={(e) => setStripeLink(e.target.value)}
            className={inputCls}
          />
        </label>
        <label className="text-sm">
          {t("admin.pointsPackages.paypalLink")}
          <input
            value={paypalLink}
            onChange={(e) => setPaypalLink(e.target.value)}
            className={inputCls}
          />
        </label>
      </div>
      <button
        type="button"
        disabled={!name}
        onClick={() => create.mutate()}
        className="mt-3 rounded-lg bg-[#1D6BF3] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {t("admin.common.create")}
      </button>

      <ul className="mt-4 divide-y divide-gray-100">
        {(q.data ?? []).map((row: NonNullable<typeof q.data>[number]) => (
          <li key={row.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <span className="min-w-0 truncate">
              {row.name} — {row.points_amount}
              {row.bonus_points > 0 ? ` (+${row.bonus_points})` : ""} Points —{" "}
              {Number(row.price).toFixed(2)} {row.currency}
            </span>
            <button
              type="button"
              onClick={() => toggle.mutate(row)}
              className="shrink-0 rounded-lg border border-gray-200 px-2 py-1 text-xs"
            >
              {row.is_active ? t("admin.common.disable") : t("admin.common.enable")}
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function PurchasesSection() {
  const { t } = useTranslation();
  const listFn = useServerFn(adminListPointsPurchases);
  const q = useQuery({ queryKey: ["admin-points-purchases"], queryFn: () => listFn() });

  return (
    <Card title={t("admin.pointsPackages.purchasesTitle")}>
      <ul className="divide-y divide-gray-100">
        {(q.data ?? []).map((row: NonNullable<typeof q.data>[number]) => {
          const profile = row.profiles as {
            username: string | null;
            first_name: string | null;
          } | null;
          return (
            <li key={row.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span className="min-w-0 truncate">
                {profile?.username ?? profile?.first_name} — {row.points > 0 ? "+" : ""}
                {row.points} Points — {row.origin}
              </span>
              <span className="shrink-0 text-xs text-gray-400">
                {new Date(row.created_at).toLocaleDateString()}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
