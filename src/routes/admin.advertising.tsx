import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect } from "react";
import { ArrowLeft, Check, Gift, Plus, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
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
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <h1 className="text-2xl font-semibold text-gray-900">Advertising</h1>
        <p className="mt-1 text-sm text-gray-500">Placements, pricing, moderation, and trusted advertisers.</p>

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
  const qc = useQueryClient();
  const listFn = useServerFn(adminListAdPlacements);
  const upsertFn = useServerFn(adminUpsertAdPlacement);
  const q = useQuery({ queryKey: ["admin-ad-placements"], queryFn: () => listFn() });
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");

  const mut = useMutation({
    mutationFn: () => upsertFn({ data: { key, label, enabled: true, archived: false, displayOrder: 0 } }),
    onSuccess: () => {
      toast.success("Placement created");
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
    <Card title="Placements">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          Key
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="e.g. hero_banner"
            className="mt-1 block rounded-lg border border-gray-200 px-3 py-1.5 text-sm"
          />
        </label>
        <label className="text-sm">
          Label
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="mt-1 block rounded-lg border border-gray-200 px-3 py-1.5 text-sm"
          />
        </label>
        <button
          onClick={() => mut.mutate()}
          disabled={!key.trim() || !label.trim() || mut.isPending}
          className="inline-flex items-center gap-1 rounded-lg bg-[#1D6BF3] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> Add
        </button>
      </div>
      <ul className="mt-4 divide-y divide-gray-100">
        {(q.data ?? []).map((p) => (
          <li key={p.id} className="flex items-center justify-between py-2 text-sm">
            <span>
              <span className="font-medium">{p.label}</span>{" "}
              <span className="text-gray-400">({p.key})</span>
            </span>
            <button
              onClick={() => toggle.mutate(p)}
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                p.enabled ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"
              }`}
            >
              {p.enabled ? "Enabled" : "Disabled"}
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function PricesSection({ apps }: { apps: ApplicationRow[] }) {
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
      toast.success("Price added");
      void qc.invalidateQueries({ queryKey: ["admin-ad-prices"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card title="Placement pricing">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          Placement
          <select
            value={placementKey}
            onChange={(e) => setPlacementKey(e.target.value)}
            className="mt-1 block rounded-lg border border-gray-200 px-3 py-1.5 text-sm"
          >
            <option value="">Select...</option>
            {(placementsQ.data ?? []).map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Application
          <select
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            className="mt-1 block rounded-lg border border-gray-200 px-3 py-1.5 text-sm"
          >
            <option value="">Global (all applications)</option>
            {apps.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Duration (days)
          <input
            type="number"
            value={durationDays}
            onChange={(e) => setDurationDays(Number(e.target.value))}
            className="mt-1 block w-24 rounded-lg border border-gray-200 px-3 py-1.5 text-sm"
          />
        </label>
        <label className="text-sm">
          Price
          <input
            type="number"
            value={price}
            onChange={(e) => setPrice(Number(e.target.value))}
            className="mt-1 block w-24 rounded-lg border border-gray-200 px-3 py-1.5 text-sm"
          />
        </label>
        <label className="text-sm">
          Currency
          <input
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            className="mt-1 block w-20 rounded-lg border border-gray-200 px-3 py-1.5 text-sm"
          />
        </label>
        <button
          onClick={() => mut.mutate()}
          disabled={!placementKey || mut.isPending}
          className="inline-flex items-center gap-1 rounded-lg bg-[#1D6BF3] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> Add price
        </button>
      </div>
      <p className="mt-3 text-xs text-gray-500">
        Set a Stripe/PayPal Payment Link for each price row after creating it (edit support coming with the admin
        panel layout retrofit) -- checkout requires one, matching how subscription plans work today.
      </p>
      <ul className="mt-4 divide-y divide-gray-100">
        {(pricesQ.data ?? []).map((p) => (
          <li key={p.id} className="flex items-center justify-between py-2 text-sm">
            <span>
              {p.placement_key} — {p.duration_days}d — {p.price} {p.currency}{" "}
              <span className="text-gray-400">
                ({apps.find((a) => a.id === p.app_id)?.name ?? "Global"})
              </span>
            </span>
            {!p.stripe_payment_link && !p.paypal_payment_link && (
              <span className="text-xs text-amber-600">No payment link set</span>
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
  const setConfigFn = useServerFn(adminSetAdConfig);
  const setAppSettingsFn = useServerFn(adminSetAdApplicationSettings);
  const [appId, setAppId] = useState("");
  const [moderationMode, setModerationMode] = useState<"manual" | "auto" | "trusted_only">("manual");
  const [eligibilityRule, setEligibilityRule] = useState<
    "anyone" | "premium_only" | "verified_only" | "trusted_only"
  >("anyone");

  const globalMut = useMutation<unknown, Error, AdConfigInput>({
    mutationFn: (input) => setConfigFn({ data: input }),
    onSuccess: () => toast.success("Global default updated"),
    onError: (e: Error) => toast.error(e.message),
  });

  const appMut = useMutation({
    mutationFn: () =>
      setAppSettingsFn({
        data: { appId, moderationMode, eligibilityRule },
      }),
    onSuccess: () => toast.success("Application override saved"),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card title="Moderation & eligibility">
      <div>
        <p className="text-sm font-medium text-gray-700">Global defaults</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {(["manual", "auto", "trusted_only"] as const).map((m) => (
            <button
              key={m}
              onClick={() => globalMut.mutate({ key: "moderation_mode", value: m })}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50"
            >
              Moderation: {m}
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
              Eligibility: {r}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6 border-t border-gray-100 pt-4">
        <p className="text-sm font-medium text-gray-700">Per-application override</p>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="text-sm">
            Application
            <select
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              className="mt-1 block rounded-lg border border-gray-200 px-3 py-1.5 text-sm"
            >
              <option value="">Select...</option>
              {apps.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Moderation
            <select
              value={moderationMode}
              onChange={(e) => setModerationMode(e.target.value as typeof moderationMode)}
              className="mt-1 block rounded-lg border border-gray-200 px-3 py-1.5 text-sm"
            >
              <option value="manual">manual</option>
              <option value="auto">auto</option>
              <option value="trusted_only">trusted_only</option>
            </select>
          </label>
          <label className="text-sm">
            Eligibility
            <select
              value={eligibilityRule}
              onChange={(e) => setEligibilityRule(e.target.value as typeof eligibilityRule)}
              className="mt-1 block rounded-lg border border-gray-200 px-3 py-1.5 text-sm"
            >
              <option value="anyone">anyone</option>
              <option value="premium_only">premium_only</option>
              <option value="verified_only">verified_only</option>
              <option value="trusted_only">trusted_only</option>
            </select>
          </label>
          <button
            onClick={() => appMut.mutate()}
            disabled={!appId || appMut.isPending}
            className="rounded-lg bg-[#1D6BF3] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            Save override
          </button>
        </div>
      </div>
    </Card>
  );
}

function DraftExpirySection() {
  const setHoursFn = useServerFn(adminSetAdDraftExpiryHours);
  const [hours, setHours] = useState(48);

  const mut = useMutation({
    mutationFn: () => setHoursFn({ data: { hours } }),
    onSuccess: () => toast.success("Draft expiry updated"),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card title="Draft campaign expiry">
      <p className="text-xs text-gray-500">
        An unpaid draft campaign is automatically cancelled after this many hours.
      </p>
      <div className="mt-2 flex items-end gap-2">
        <label className="text-sm">
          Hours
          <input
            type="number"
            min={1}
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            className="mt-1 block w-24 rounded-lg border border-gray-200 px-3 py-1.5 text-sm"
          />
        </label>
        <button
          onClick={() => mut.mutate()}
          disabled={mut.isPending}
          className="rounded-lg bg-[#1D6BF3] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          Save
        </button>
      </div>
    </Card>
  );
}

function TrustedAdvertisersSection({ apps }: { apps: ApplicationRow[] }) {
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
      if (!profile) throw new Error("User not found");
      return setFn({ data: { userId: profile.id, appId, trusted: true } });
    },
    onSuccess: () => {
      toast.success("Trusted advertiser granted");
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
    <Card title="Trusted advertisers">
      <p className="mb-3 text-xs text-gray-500">Trust is granted per application, not globally.</p>
      <div className="flex items-end gap-2">
        <label className="text-sm">
          Application
          <select
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            className="mt-1 block rounded-lg border border-gray-200 px-3 py-1.5 text-sm"
          >
            <option value="">Select...</option>
            {apps.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Username
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="mt-1 block rounded-lg border border-gray-200 px-3 py-1.5 text-sm"
          />
        </label>
        <button
          onClick={() => grant.mutate()}
          disabled={!appId || !username.trim() || grant.isPending}
          className="inline-flex items-center gap-1 rounded-lg bg-[#1D6BF3] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          <ShieldCheck className="h-4 w-4" /> Grant
        </button>
      </div>
      <ul className="mt-4 divide-y divide-gray-100">
        {(q.data ?? []).map((row) => (
          <li key={row.user_id} className="flex items-center justify-between py-2 text-sm">
            <span>
              {[row.profiles?.first_name, row.profiles?.last_name].filter(Boolean).join(" ") ||
                row.profiles?.username ||
                row.user_id}
            </span>
            <button
              onClick={() => revoke.mutate(row.user_id)}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
            >
              <X className="h-3 w-3" /> Revoke
            </button>
          </li>
        ))}
        {(q.data ?? []).length === 0 && <p className="py-2 text-sm text-gray-500">No trusted advertisers yet.</p>}
      </ul>
    </Card>
  );
}

function ModerationQueueSection() {
  const qc = useQueryClient();
  const listFn = useServerFn(adminListCampaigns);
  const moderateFn = useServerFn(adminModerateCampaign);
  const q = useQuery({ queryKey: ["admin-campaigns", "pending"], queryFn: () => listFn({ data: { status: "pending" } }) });

  const mut = useMutation({
    mutationFn: (v: { campaignId: string; approve: boolean }) => moderateFn({ data: v }),
    onSuccess: () => {
      toast.success("Updated");
      void qc.invalidateQueries({ queryKey: ["admin-campaigns", "pending"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card title="Campaigns awaiting moderation">
      {(q.data ?? []).length === 0 ? (
        <p className="text-sm text-gray-500">Nothing pending.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {q.data!.map((c) => (
            <li key={c.id} className="flex items-center justify-between py-3 text-sm">
              <div>
                <p className="font-medium text-gray-800">{c.title}</p>
                <p className="text-xs text-gray-500">
                  {c.placement_key} ·{" "}
                  {[c.profiles?.first_name, c.profiles?.last_name].filter(Boolean).join(" ") ||
                    c.profiles?.username}{" "}
                  · {c.applications?.name}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => mut.mutate({ campaignId: c.id, approve: true })}
                  className="inline-flex items-center gap-1 rounded-lg bg-[#1D6BF3] px-3 py-1.5 text-sm font-semibold text-white"
                >
                  <Check className="h-4 w-4" /> Approve
                </button>
                <button
                  onClick={() => mut.mutate({ campaignId: c.id, approve: false })}
                  className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                >
                  <X className="h-4 w-4" /> Reject
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
  const qc = useQueryClient();
  const listFn = useServerFn(adminListPendingAdvertisingCreditRedemptions);
  const fulfillFn = useServerFn(adminFulfillAdvertisingCreditRedemption);
  const q = useQuery({ queryKey: ["admin-pending-ad-credits"], queryFn: () => listFn() });

  const mut = useMutation({
    mutationFn: (redemptionId: string) => fulfillFn({ data: { redemptionId } }),
    onSuccess: () => {
      toast.success("Credit fulfilled");
      void qc.invalidateQueries({ queryKey: ["admin-pending-ad-credits"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card title="Pending advertising-credit redemptions">
      {(q.data ?? []).length === 0 ? (
        <p className="text-sm text-gray-500">Nothing pending.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {q.data!.map((r) => (
            <li key={r.id} className="flex items-center justify-between py-3 text-sm">
              <span>
                <Gift className="mr-1 inline h-4 w-4 text-amber-500" />
                {[r.profiles?.first_name, r.profiles?.last_name].filter(Boolean).join(" ") || r.profiles?.username}
              </span>
              <button
                onClick={() => mut.mutate(r.id)}
                className="rounded-lg bg-[#1D6BF3] px-3 py-1.5 text-sm font-semibold text-white"
              >
                Fulfill
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
