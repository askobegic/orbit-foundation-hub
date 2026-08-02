import { useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Megaphone, Upload } from "lucide-react";
import { toast } from "sonner";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/context/AuthContext";
import { useApplication } from "@/context/ApplicationContext";
import {
  createCampaignCheckoutReference,
  createDraftCampaign,
  getAdPlacementsForApp,
  getMyAdvertisingSummary,
  getMyCampaigns,
  updateCampaignCreative,
} from "@/lib/advertising.functions";
import { campaignBannerPath, getMediaStorageProvider } from "@/lib/media-storage";

export const Route = createFileRoute("/dashboard/advertising")({
  head: () => ({
    meta: [
      { title: "Advertising — Core Platform" },
      { name: "description", content: "Create and manage advertising campaigns." },
    ],
  }),
  component: () => (
    <ProtectedRoute>
      <AdvertisingPage />
    </ProtectedRoute>
  ),
});

function appendParams(url: string, params: Record<string, string>) {
  try {
    const u = new URL(url);
    Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
    return u.toString();
  } catch {
    return url;
  }
}

const STATUS_I18N_KEY: Record<string, string> = {
  draft: "advertising.statusDraft",
  pending: "advertising.statusPending",
  active: "advertising.statusActive",
  rejected: "advertising.statusRejected",
  ended: "advertising.statusEnded",
  cancelled: "advertising.statusCancelled",
};

function AdvertisingPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { application } = useApplication();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const getSummaryFn = useServerFn(getMyAdvertisingSummary);
  const getPlacementsFn = useServerFn(getAdPlacementsForApp);
  const getCampaignsFn = useServerFn(getMyCampaigns);
  const createDraftFn = useServerFn(createDraftCampaign);
  const createReferenceFn = useServerFn(createCampaignCheckoutReference);
  const updateCreativeFn = useServerFn(updateCampaignCreative);

  const [title, setTitle] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [selectedPriceId, setSelectedPriceId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null);
  const [checkout, setCheckout] = useState<{
    expectedAmount: number;
    currency: string;
    creditApplied: number;
    stripePaymentLink: string | null;
    paypalPaymentLink: string | null;
    reference: string;
  } | null>(null);

  const appId = application?.id;

  const summaryQuery = useQuery({
    queryKey: ["advertising", "summary", appId],
    enabled: !!appId,
    queryFn: () => getSummaryFn({ data: { appId: appId! } }),
  });

  const placementsQuery = useQuery({
    queryKey: ["advertising", "placements", appId],
    enabled: !!appId,
    queryFn: () => getPlacementsFn({ data: { appId: appId! } }),
  });

  const campaignsQuery = useQuery({
    queryKey: ["advertising", "my-campaigns"],
    queryFn: () => getCampaignsFn(),
  });

  const allPrices = (placementsQuery.data ?? []).flatMap((p) =>
    p.prices.map((price) => ({ ...price, placementLabel: p.label })),
  );
  const selectedPrice = allPrices.find((p) => p.id === selectedPriceId) ?? null;

  async function handleUpload(file: File) {
    if (!user) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error(t("advertising.uploadError"));
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast.error(t("advertising.uploadError"));
      return;
    }
    setUploading(true);
    try {
      const path = campaignBannerPath(user.id, file.name);
      const { url } = await getMediaStorageProvider().upload(path, file, file.type);
      setImageUrl(url);
    } catch {
      toast.error(t("advertising.uploadError"));
    } finally {
      setUploading(false);
    }
  }

  async function handleCreateAndCheckout() {
    if (!appId || !selectedPrice || !title.trim()) return;
    setSubmitting(true);
    try {
      const campaign = await createDraftFn({
        data: {
          appId,
          placementPriceId: selectedPrice.id,
          title: title.trim(),
          imageUrl,
          linkUrl: linkUrl.trim() || null,
        },
      });
      const result = await createReferenceFn({ data: { campaignId: campaign.id } });
      setCheckout({ ...result });
      await queryClient.invalidateQueries({ queryKey: ["advertising", "my-campaigns"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("advertising.createError"));
    } finally {
      setSubmitting(false);
    }
  }

  function resetForm() {
    setEditingCampaignId(null);
    setTitle("");
    setLinkUrl("");
    setImageUrl(null);
    setSelectedPriceId(null);
  }

  function startEdit(c: NonNullable<typeof campaignsQuery.data>[number]) {
    setEditingCampaignId(c.id);
    setTitle(c.title);
    setLinkUrl(c.link_url ?? "");
    setImageUrl(c.image_url);
  }

  // Editing creative/destination after approval returns the campaign to
  // moderation whenever this application currently requires it -- decided
  // server-side (updateCampaignCreative re-runs the same resolver used at
  // purchase time), never assumed here.
  async function handleSaveEdit() {
    if (!editingCampaignId || !title.trim()) return;
    setSubmitting(true);
    try {
      await updateCreativeFn({
        data: { campaignId: editingCampaignId, title: title.trim(), imageUrl, linkUrl: linkUrl.trim() || null },
      });
      toast.success(t("advertising.editSuccess"));
      resetForm();
      await queryClient.invalidateQueries({ queryKey: ["advertising", "my-campaigns"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("advertising.editError"));
    } finally {
      setSubmitting(false);
    }
  }

  function payWith(provider: "stripe" | "paypal") {
    if (!checkout) return;
    const link = provider === "stripe" ? checkout.stripePaymentLink : checkout.paypalPaymentLink;
    if (!link) return;
    const url =
      provider === "stripe"
        ? appendParams(link, { client_reference_id: checkout.reference, prefilled_email: user?.email ?? "" })
        : appendParams(link, { custom: checkout.reference });
    window.location.href = url;
  }

  return (
    <main className="min-h-screen bg-[#F7F8FA] px-4 py-8 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("auth.backToDashboard")}
        </Link>

        <header className="mt-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1D6BF3]/10 text-[#1D6BF3]">
            <Megaphone className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">{t("advertising.title")}</h1>
            <p className="text-sm text-gray-500">{t("advertising.subtitle")}</p>
          </div>
        </header>

        {summaryQuery.isLoading || placementsQuery.isLoading ? (
          <div className="mt-6 space-y-4">
            <Skeleton className="h-40 w-full rounded-2xl" />
          </div>
        ) : summaryQuery.data && !summaryQuery.data.eligible ? (
          <section className="mt-6 rounded-2xl bg-white p-6 text-sm text-gray-600 shadow-sm ring-1 ring-gray-100">
            {t("advertising.notEligible")}
          </section>
        ) : (
          <>
            {summaryQuery.data && summaryQuery.data.creditBalance > 0 && (
              <p className="mt-4 text-sm text-emerald-700">
                {t("advertising.creditAvailable", { amount: summaryQuery.data.creditBalance })}
              </p>
            )}

            {checkout && !editingCampaignId ? (
              <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
                <h2 className="text-sm font-semibold text-gray-900">{t("advertising.checkoutTitle")}</h2>
                <p className="mt-2 text-sm text-gray-600">
                  {t("advertising.amountToPay", {
                    amount: checkout.expectedAmount,
                    currency: checkout.currency,
                  })}
                </p>
                {checkout.creditApplied > 0 && (
                  <p className="mt-1 text-xs text-emerald-700">
                    {t("advertising.creditApplied", { amount: checkout.creditApplied })}
                  </p>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  {checkout.stripePaymentLink && (
                    <button
                      type="button"
                      onClick={() => payWith("stripe")}
                      className="rounded-lg bg-[#1D6BF3] px-4 py-2 text-sm font-semibold text-white hover:bg-[#155ac9]"
                    >
                      {t("advertising.payWithStripe")}
                    </button>
                  )}
                  {checkout.paypalPaymentLink && (
                    <button
                      type="button"
                      onClick={() => payWith("paypal")}
                      className="rounded-lg bg-[#003087] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
                    >
                      {t("advertising.payWithPaypal")}
                    </button>
                  )}
                </div>
              </section>
            ) : (
              <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
                <h2 className="text-sm font-semibold text-gray-900">
                  {editingCampaignId ? t("advertising.editCampaign") : t("advertising.newCampaign")}
                </h2>
                <div className="mt-4 flex flex-col gap-3">
                  {!editingCampaignId && (
                    <label className="text-sm font-medium text-gray-700">
                      {t("advertising.placement")}
                      <select
                        value={selectedPriceId ?? ""}
                        onChange={(e) => setSelectedPriceId(e.target.value || null)}
                        className="mt-1 w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm outline-none focus:border-[#1D6BF3]"
                      >
                        <option value="">{t("advertising.selectPlacement")}</option>
                        {allPrices.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.placementLabel} — {p.durationDays}d — {p.price} {p.currency}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {editingCampaignId && (
                    <p className="text-xs text-amber-600">{t("advertising.editModerationNotice")}</p>
                  )}
                  <label className="text-sm font-medium text-gray-700">
                    {t("advertising.campaignTitle")}
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      maxLength={120}
                      className="mt-1 w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm outline-none focus:border-[#1D6BF3]"
                    />
                  </label>
                  <label className="text-sm font-medium text-gray-700">
                    {t("advertising.linkUrl")}
                    <input
                      type="url"
                      value={linkUrl}
                      onChange={(e) => setLinkUrl(e.target.value)}
                      placeholder="https://"
                      className="mt-1 w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm outline-none focus:border-[#1D6BF3]"
                    />
                  </label>
                  <div>
                    <span className="text-sm font-medium text-gray-700">{t("advertising.banner")}</span>
                    <div className="mt-1 flex items-center gap-3">
                      {imageUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={imageUrl} alt="" className="h-16 w-28 rounded-lg object-cover" />
                      )}
                      <input
                        ref={fileRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void handleUpload(f);
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => fileRef.current?.click()}
                        disabled={uploading}
                        className="inline-flex items-center gap-2 rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                      >
                        <Upload className="h-4 w-4" />
                        {uploading ? t("common.loading") : t("advertising.uploadBanner")}
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 flex gap-2">
                    {editingCampaignId ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void handleSaveEdit()}
                          disabled={submitting || !title.trim()}
                          className="flex-1 rounded-[10px] bg-[#1D6BF3] px-4 py-3 text-[15px] font-semibold text-white hover:bg-[#155ac9] disabled:opacity-60"
                        >
                          {submitting ? t("common.loading") : t("advertising.saveChanges")}
                        </button>
                        <button
                          type="button"
                          onClick={resetForm}
                          className="rounded-[10px] border border-[#E5E7EB] px-4 py-3 text-[15px] font-medium text-gray-700 hover:bg-gray-50"
                        >
                          {t("common.cancel")}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleCreateAndCheckout()}
                        disabled={submitting || !selectedPrice || !title.trim()}
                        className="w-full rounded-[10px] bg-[#1D6BF3] px-4 py-3 text-[15px] font-semibold text-white hover:bg-[#155ac9] disabled:opacity-60"
                      >
                        {submitting ? t("common.loading") : t("advertising.continueToPayment")}
                      </button>
                    )}
                  </div>
                </div>
              </section>
            )}
          </>
        )}

        <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">{t("advertising.myCampaigns")}</h2>
          {campaignsQuery.isLoading ? (
            <Skeleton className="mt-3 h-20 w-full rounded-xl" />
          ) : (campaignsQuery.data?.length ?? 0) === 0 ? (
            <p className="mt-2 text-sm text-gray-500">{t("advertising.noCampaigns")}</p>
          ) : (
            <ul className="mt-3 divide-y divide-gray-100">
              {campaignsQuery.data!.map((c) => (
                <li key={c.id} className="flex items-center justify-between py-3 text-sm">
                  <div>
                    <p className="font-medium text-gray-800">{c.title}</p>
                    <p className="text-xs text-gray-500">
                      {c.placement_key}
                      {c.expires_at
                        ? ` · ${t("advertising.until")} ${new Date(c.expires_at).toLocaleDateString(i18n.language)}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">
                      {t(STATUS_I18N_KEY[c.status] ?? c.status)}
                    </span>
                    {c.status !== "ended" && c.status !== "cancelled" && (
                      <button
                        type="button"
                        onClick={() => startEdit(c)}
                        className="text-xs font-medium text-[#1D6BF3] hover:underline"
                      >
                        {t("advertising.edit")}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
