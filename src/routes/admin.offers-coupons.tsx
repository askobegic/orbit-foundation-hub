// Priority 17: Admin -- OFFERS & COUPONS. Central management for Global
// Offers, Individual Offers, Public Coupons, and Reward Boosts (spec
// section 30). Advertising remains managed under the existing
// /admin/advertising page, untouched. Same Card-based pattern as
// /admin/rewards.
import { useState, useEffect } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { getMyIsAdmin } from "@/lib/admin.functions";
import {
  adminListDashboardOffers,
  adminListOfferSegments,
  adminUpsertDashboardOffer,
  adminArchiveDashboardOffer,
  adminSetDashboardOfferEnabled,
} from "@/lib/offers.functions";
import {
  adminListPublicCoupons,
  adminUpsertPublicCoupon,
  adminArchivePublicCoupon,
  adminSetPublicCouponEnabled,
  adminGetCouponStats,
} from "@/lib/coupons.functions";
import {
  adminListRewardBoosts,
  adminUpsertRewardBoost,
  adminArchiveRewardBoost,
  adminListRewardActionRules,
} from "@/lib/rewards.functions";

export const Route = createFileRoute("/admin/offers-coupons")({
  head: () => ({
    meta: [
      { title: "Admin · Offers & Coupons — Core Platform" },
      { name: "description", content: "Global Offers, Individual Offers, Public Coupons, Reward Boosts." },
    ],
  }),
  component: () => (
    <ProtectedRoute>
      <AdminOffersCoupons />
    </ProtectedRoute>
  ),
});

function AdminOffersCoupons() {
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
        <h1 className="text-2xl font-semibold text-gray-900">{t("admin.offersCoupons.title")}</h1>
        <p className="mt-1 text-sm text-gray-500">{t("admin.offersCoupons.subtitle")}</p>

        <GlobalOffersSection />
        <IndividualOffersSection />
        <PublicCouponsSection />
        <RewardBoostsSection />
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

function ProductFields({
  productType,
  setProductType,
  productId,
  setProductId,
}: {
  productType: string;
  setProductType: (v: string) => void;
  productId: string;
  setProductId: (v: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <label className="text-sm">
        {t("admin.offersCoupons.productType")}
        <select value={productType} onChange={(e) => setProductType(e.target.value)} className={inputCls}>
          <option value="subscription_plan">{t("admin.offersCoupons.productSubscriptionPlan")}</option>
          <option value="ad_placement_price">{t("admin.offersCoupons.productAdPlacementPrice")}</option>
        </select>
      </label>
      <label className="text-sm">
        {t("admin.offersCoupons.productId")}
        <input
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
          placeholder={t("admin.offersCoupons.productIdPlaceholder")}
          className={inputCls}
        />
      </label>
    </>
  );
}

function DiscountFields({
  discountType,
  setDiscountType,
  discountPercent,
  setDiscountPercent,
  fixedPrice,
  setFixedPrice,
}: {
  discountType: string;
  setDiscountType: (v: string) => void;
  discountPercent: number;
  setDiscountPercent: (v: number) => void;
  fixedPrice: number;
  setFixedPrice: (v: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <label className="text-sm">
        {t("admin.offersCoupons.discountType")}
        <select value={discountType} onChange={(e) => setDiscountType(e.target.value)} className={inputCls}>
          <option value="percent">{t("admin.offersCoupons.discountPercent")}</option>
          <option value="fixed_price">{t("admin.offersCoupons.discountFixedPrice")}</option>
        </select>
      </label>
      {discountType === "percent" ? (
        <label className="text-sm">
          {t("admin.offersCoupons.discountPercentValue")}
          <input
            type="number"
            value={discountPercent}
            onChange={(e) => setDiscountPercent(Number(e.target.value))}
            className={inputCls}
          />
        </label>
      ) : (
        <label className="text-sm">
          {t("admin.offersCoupons.fixedPriceValue")}
          <input
            type="number"
            value={fixedPrice}
            onChange={(e) => setFixedPrice(Number(e.target.value))}
            className={inputCls}
          />
        </label>
      )}
    </>
  );
}

function GlobalOffersSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const listFn = useServerFn(adminListDashboardOffers);
  const segmentsFn = useServerFn(adminListOfferSegments);
  const upsertFn = useServerFn(adminUpsertDashboardOffer);
  const archiveFn = useServerFn(adminArchiveDashboardOffer);
  const setEnabledFn = useServerFn(adminSetDashboardOfferEnabled);

  const q = useQuery({
    queryKey: ["admin-dashboard-offers", "global"],
    queryFn: () => listFn({ data: { offerType: "global" } }),
  });
  const segmentsQ = useQuery({ queryKey: ["admin-offer-segments"], queryFn: () => segmentsFn() });

  const [titleBs, setTitleBs] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [titleDe, setTitleDe] = useState("");
  const [segment, setSegment] = useState("all");
  const [productType, setProductType] = useState("subscription_plan");
  const [productId, setProductId] = useState("");
  const [discountType, setDiscountType] = useState("percent");
  const [discountPercent, setDiscountPercent] = useState(20);
  const [fixedPrice, setFixedPrice] = useState(0);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");

  const create = useMutation({
    mutationFn: () =>
      upsertFn({
        data: {
          offerType: "global",
          targetSegment: segment,
          productType: productType as "subscription_plan" | "ad_placement_price",
          productId,
          titleBs,
          titleEn,
          titleDe,
          discountType: discountType as "percent" | "fixed_price",
          discountPercent: discountType === "percent" ? discountPercent : undefined,
          fixedPrice: discountType === "fixed_price" ? fixedPrice : undefined,
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
          priority: 0,
          enabled: true,
        },
      }),
    onSuccess: () => {
      toast.success(t("admin.offersCoupons.offerCreated"));
      setTitleBs("");
      setTitleEn("");
      setTitleDe("");
      setProductId("");
      void qc.invalidateQueries({ queryKey: ["admin-dashboard-offers", "global"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: (row: { id: string; enabled: boolean }) =>
      setEnabledFn({ data: { id: row.id, enabled: !row.enabled } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-dashboard-offers", "global"] }),
  });
  const archive = useMutation({
    mutationFn: (id: string) => archiveFn({ data: { id } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-dashboard-offers", "global"] }),
  });

  return (
    <Card title={t("admin.offersCoupons.globalOffersTitle")}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-sm">
          {t("admin.offersCoupons.titleBs")}
          <input value={titleBs} onChange={(e) => setTitleBs(e.target.value)} className={inputCls} />
        </label>
        <label className="text-sm">
          {t("admin.offersCoupons.titleEn")}
          <input value={titleEn} onChange={(e) => setTitleEn(e.target.value)} className={inputCls} />
        </label>
        <label className="text-sm">
          {t("admin.offersCoupons.titleDe")}
          <input value={titleDe} onChange={(e) => setTitleDe(e.target.value)} className={inputCls} />
        </label>
        <label className="text-sm">
          {t("admin.offersCoupons.segment")}
          <select value={segment} onChange={(e) => setSegment(e.target.value)} className={inputCls}>
            {(segmentsQ.data ?? []).map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <ProductFields
          productType={productType}
          setProductType={setProductType}
          productId={productId}
          setProductId={setProductId}
        />
        <DiscountFields
          discountType={discountType}
          setDiscountType={setDiscountType}
          discountPercent={discountPercent}
          setDiscountPercent={setDiscountPercent}
          fixedPrice={fixedPrice}
          setFixedPrice={setFixedPrice}
        />
        <label className="text-sm">
          {t("admin.offersCoupons.startsAt")}
          <input
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            className={inputCls}
          />
        </label>
        <label className="text-sm">
          {t("admin.offersCoupons.endsAt")}
          <input
            type="datetime-local"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            className={inputCls}
          />
        </label>
      </div>
      <button
        type="button"
        disabled={!titleBs || !titleEn || !titleDe || !productId || !startsAt || !endsAt}
        onClick={() => create.mutate()}
        className="mt-3 rounded-lg bg-[#1D6BF3] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {t("admin.common.create")}
      </button>

      <ul className="mt-4 divide-y divide-gray-100">
        {(q.data ?? []).map((row: NonNullable<typeof q.data>[number]) => (
          <li key={row.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <span className="min-w-0 truncate">
              {row.title_bs} — {row.target_segment} —{" "}
              {row.discount_type === "percent" ? `${row.discount_percent}%` : `${row.fixed_price}€`}
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

function IndividualOffersSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const listFn = useServerFn(adminListDashboardOffers);
  const upsertFn = useServerFn(adminUpsertDashboardOffer);
  const archiveFn = useServerFn(adminArchiveDashboardOffer);
  const setEnabledFn = useServerFn(adminSetDashboardOfferEnabled);

  const q = useQuery({
    queryKey: ["admin-dashboard-offers", "individual"],
    queryFn: () => listFn({ data: { offerType: "individual" } }),
  });

  const [titleBs, setTitleBs] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [titleDe, setTitleDe] = useState("");
  const [targetUserId, setTargetUserId] = useState("");
  const [productType, setProductType] = useState("subscription_plan");
  const [productId, setProductId] = useState("");
  const [discountType, setDiscountType] = useState("fixed_price");
  const [discountPercent, setDiscountPercent] = useState(20);
  const [fixedPrice, setFixedPrice] = useState(29);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");

  const create = useMutation({
    mutationFn: () =>
      upsertFn({
        data: {
          offerType: "individual",
          targetUserId,
          productType: productType as "subscription_plan" | "ad_placement_price",
          productId,
          titleBs,
          titleEn,
          titleDe,
          discountType: discountType as "percent" | "fixed_price",
          discountPercent: discountType === "percent" ? discountPercent : undefined,
          fixedPrice: discountType === "fixed_price" ? fixedPrice : undefined,
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
          priority: 10,
          enabled: true,
        },
      }),
    onSuccess: () => {
      toast.success(t("admin.offersCoupons.offerCreated"));
      setTitleBs("");
      setTitleEn("");
      setTitleDe("");
      setTargetUserId("");
      setProductId("");
      void qc.invalidateQueries({ queryKey: ["admin-dashboard-offers", "individual"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: (row: { id: string; enabled: boolean }) =>
      setEnabledFn({ data: { id: row.id, enabled: !row.enabled } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-dashboard-offers", "individual"] }),
  });
  const archive = useMutation({
    mutationFn: (id: string) => archiveFn({ data: { id } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-dashboard-offers", "individual"] }),
  });

  return (
    <Card title={t("admin.offersCoupons.individualOffersTitle")}>
      <p className="mb-3 text-xs text-gray-500">{t("admin.offersCoupons.individualOffersHint")}</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-sm">
          {t("admin.offersCoupons.titleBs")}
          <input value={titleBs} onChange={(e) => setTitleBs(e.target.value)} className={inputCls} />
        </label>
        <label className="text-sm">
          {t("admin.offersCoupons.titleEn")}
          <input value={titleEn} onChange={(e) => setTitleEn(e.target.value)} className={inputCls} />
        </label>
        <label className="text-sm">
          {t("admin.offersCoupons.titleDe")}
          <input value={titleDe} onChange={(e) => setTitleDe(e.target.value)} className={inputCls} />
        </label>
        <label className="text-sm">
          {t("admin.offersCoupons.targetUserId")}
          <input
            value={targetUserId}
            onChange={(e) => setTargetUserId(e.target.value)}
            placeholder={t("admin.offersCoupons.targetUserIdPlaceholder")}
            className={inputCls}
          />
        </label>
        <ProductFields
          productType={productType}
          setProductType={setProductType}
          productId={productId}
          setProductId={setProductId}
        />
        <DiscountFields
          discountType={discountType}
          setDiscountType={setDiscountType}
          discountPercent={discountPercent}
          setDiscountPercent={setDiscountPercent}
          fixedPrice={fixedPrice}
          setFixedPrice={setFixedPrice}
        />
        <label className="text-sm">
          {t("admin.offersCoupons.startsAt")}
          <input
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            className={inputCls}
          />
        </label>
        <label className="text-sm">
          {t("admin.offersCoupons.endsAt")}
          <input
            type="datetime-local"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            className={inputCls}
          />
        </label>
      </div>
      <button
        type="button"
        disabled={!titleBs || !titleEn || !titleDe || !targetUserId || !productId || !startsAt || !endsAt}
        onClick={() => create.mutate()}
        className="mt-3 rounded-lg bg-[#1D6BF3] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {t("admin.common.create")}
      </button>

      <ul className="mt-4 divide-y divide-gray-100">
        {(q.data ?? []).map((row: NonNullable<typeof q.data>[number]) => (
          <li key={row.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <span className="min-w-0 truncate">
              {row.title_bs} — {row.target_user?.username ?? row.target_user_id}
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

function CouponRedemptionCount({ couponId }: { couponId: string }) {
  const statsFn = useServerFn(adminGetCouponStats);
  const q = useQuery({
    queryKey: ["admin-coupon-stats", couponId],
    queryFn: () => statsFn({ data: { couponId } }),
  });
  return <span className="text-xs text-gray-400">{q.data?.totalRedemptions ?? 0}</span>;
}

function PublicCouponsSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const listFn = useServerFn(adminListPublicCoupons);
  const upsertFn = useServerFn(adminUpsertPublicCoupon);
  const archiveFn = useServerFn(adminArchivePublicCoupon);
  const setEnabledFn = useServerFn(adminSetPublicCouponEnabled);

  const q = useQuery({ queryKey: ["admin-public-coupons"], queryFn: () => listFn() });

  const [code, setCode] = useState("");
  const [titleBs, setTitleBs] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [titleDe, setTitleDe] = useState("");
  const [productType, setProductType] = useState("subscription_plan");
  const [productId, setProductId] = useState("");
  const [discountType, setDiscountType] = useState("percent");
  const [discountPercent, setDiscountPercent] = useState(20);
  const [fixedPrice, setFixedPrice] = useState(0);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [maxTotalUses, setMaxTotalUses] = useState<string>("");
  const [maxUsesPerUser, setMaxUsesPerUser] = useState(1);

  const create = useMutation({
    mutationFn: () =>
      upsertFn({
        data: {
          code,
          titleBs,
          titleEn,
          titleDe,
          productType: productType as "subscription_plan" | "ad_placement_price",
          productId,
          discountType: discountType as "percent" | "fixed_price",
          discountPercent: discountType === "percent" ? discountPercent : undefined,
          fixedPrice: discountType === "fixed_price" ? fixedPrice : undefined,
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
          maxTotalUses: maxTotalUses ? Number(maxTotalUses) : undefined,
          maxUsesPerUser,
          isPublic: true,
          enabled: true,
        },
      }),
    onSuccess: () => {
      toast.success(t("admin.offersCoupons.couponCreated"));
      setCode("");
      setTitleBs("");
      setTitleEn("");
      setTitleDe("");
      setProductId("");
      void qc.invalidateQueries({ queryKey: ["admin-public-coupons"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: (row: { id: string; enabled: boolean }) =>
      setEnabledFn({ data: { id: row.id, enabled: !row.enabled } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-public-coupons"] }),
  });
  const archive = useMutation({
    mutationFn: (id: string) => archiveFn({ data: { id } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-public-coupons"] }),
  });

  return (
    <Card title={t("admin.offersCoupons.publicCouponsTitle")}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-sm">
          {t("admin.offersCoupons.code")}
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="PREMIUM20"
            className={inputCls}
          />
        </label>
        <label className="text-sm">
          {t("admin.offersCoupons.titleBs")}
          <input value={titleBs} onChange={(e) => setTitleBs(e.target.value)} className={inputCls} />
        </label>
        <label className="text-sm">
          {t("admin.offersCoupons.titleEn")}
          <input value={titleEn} onChange={(e) => setTitleEn(e.target.value)} className={inputCls} />
        </label>
        <label className="text-sm">
          {t("admin.offersCoupons.titleDe")}
          <input value={titleDe} onChange={(e) => setTitleDe(e.target.value)} className={inputCls} />
        </label>
        <ProductFields
          productType={productType}
          setProductType={setProductType}
          productId={productId}
          setProductId={setProductId}
        />
        <DiscountFields
          discountType={discountType}
          setDiscountType={setDiscountType}
          discountPercent={discountPercent}
          setDiscountPercent={setDiscountPercent}
          fixedPrice={fixedPrice}
          setFixedPrice={setFixedPrice}
        />
        <label className="text-sm">
          {t("admin.offersCoupons.startsAt")}
          <input
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            className={inputCls}
          />
        </label>
        <label className="text-sm">
          {t("admin.offersCoupons.endsAt")}
          <input
            type="datetime-local"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            className={inputCls}
          />
        </label>
        <label className="text-sm">
          {t("admin.offersCoupons.maxTotalUses")}
          <input
            type="number"
            value={maxTotalUses}
            onChange={(e) => setMaxTotalUses(e.target.value)}
            placeholder={t("admin.offersCoupons.unlimited")}
            className={inputCls}
          />
        </label>
        <label className="text-sm">
          {t("admin.offersCoupons.maxUsesPerUser")}
          <input
            type="number"
            value={maxUsesPerUser}
            onChange={(e) => setMaxUsesPerUser(Number(e.target.value))}
            className={inputCls}
          />
        </label>
      </div>
      <button
        type="button"
        disabled={!code || !titleBs || !titleEn || !titleDe || !productId || !startsAt || !endsAt}
        onClick={() => create.mutate()}
        className="mt-3 rounded-lg bg-[#1D6BF3] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {t("admin.common.create")}
      </button>

      <ul className="mt-4 divide-y divide-gray-100">
        {(q.data ?? []).map((row: NonNullable<typeof q.data>[number]) => (
          <li key={row.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <span className="min-w-0 truncate">
              <span className="font-mono font-semibold">{row.code}</span> — {row.title_bs} —{" "}
              {t("admin.offersCoupons.redemptions")}: <CouponRedemptionCount couponId={row.id} />
              {row.max_total_uses ? ` / ${row.max_total_uses}` : ""}
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

function RewardBoostsSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const listFn = useServerFn(adminListRewardBoosts);
  const actionsFn = useServerFn(adminListRewardActionRules);
  const upsertFn = useServerFn(adminUpsertRewardBoost);
  const archiveFn = useServerFn(adminArchiveRewardBoost);

  const q = useQuery({ queryKey: ["admin-reward-boosts"], queryFn: () => listFn() });
  const actionsQ = useQuery({ queryKey: ["admin-reward-action-rules"], queryFn: () => actionsFn() });

  const [action, setAction] = useState("");
  const [multiplier, setMultiplier] = useState(2);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");

  const create = useMutation({
    mutationFn: () =>
      upsertFn({
        data: {
          action,
          multiplier,
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
          enabled: true,
        },
      }),
    onSuccess: () => {
      toast.success(t("admin.offersCoupons.boostCreated"));
      setMultiplier(2);
      void qc.invalidateQueries({ queryKey: ["admin-reward-boosts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const archive = useMutation({
    mutationFn: (id: string) => archiveFn({ data: { id } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-reward-boosts"] }),
  });

  return (
    <Card title={t("admin.offersCoupons.rewardBoostsTitle")}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm">
          {t("admin.rewards.action")}
          <select value={action} onChange={(e) => setAction(e.target.value)} className={inputCls}>
            <option value="">—</option>
            {(actionsQ.data ?? []).map((a: NonNullable<typeof actionsQ.data>[number]) => (
              <option key={a.action} value={a.action}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          {t("admin.offersCoupons.multiplier")}
          <input
            type="number"
            step="0.1"
            value={multiplier}
            onChange={(e) => setMultiplier(Number(e.target.value))}
            className={inputCls}
          />
        </label>
        <label className="text-sm">
          {t("admin.offersCoupons.startsAt")}
          <input
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            className={inputCls}
          />
        </label>
        <label className="text-sm">
          {t("admin.offersCoupons.endsAt")}
          <input
            type="datetime-local"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            className={inputCls}
          />
        </label>
      </div>
      <button
        type="button"
        disabled={!action || !startsAt || !endsAt}
        onClick={() => create.mutate()}
        className="mt-3 rounded-lg bg-[#1D6BF3] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {t("admin.common.create")}
      </button>

      <ul className="mt-4 divide-y divide-gray-100">
        {(q.data ?? []).map((row: NonNullable<typeof q.data>[number]) => (
          <li key={row.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <span className="min-w-0 truncate">
              {row.action} × {row.multiplier}
            </span>
            <button
              type="button"
              onClick={() => archive.mutate(row.id)}
              className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-red-600"
            >
              {t("admin.common.archive")}
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
