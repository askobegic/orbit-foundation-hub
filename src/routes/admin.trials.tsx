import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Ban, Save, Square, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { supabase } from "@/integrations/supabase/client";
import { getMyIsAdmin } from "@/lib/admin.functions";
import {
  adminEndTrial,
  adminGrantPromotionalTrial,
  adminListTrialHistory,
  adminRevokeTrial,
  adminSetTrialPolicy,
  getTrialPolicy,
} from "@/lib/trial.functions";

export const Route = createFileRoute("/admin/trials")({
  head: () => ({
    meta: [
      { title: "Admin · Promotional Trials — Core Platform" },
      { name: "description", content: "Grant, end, and review Promotional Trials." },
    ],
  }),
  component: () => (
    <ProtectedRoute>
      <AdminTrials />
    </ProtectedRoute>
  ),
});

function AdminTrials() {
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
        <h1 className="text-2xl font-semibold text-gray-900">{t("admin.trials.title")}</h1>
        <p className="mt-1 text-sm text-gray-500">{t("admin.trials.subtitle")}</p>

        <GrantSection />
        <PolicySection />
        <HistorySection />
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

function GrantSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const getPolicyFn = useServerFn(getTrialPolicy);
  const grantFn = useServerFn(adminGrantPromotionalTrial);
  const policyQ = useQuery({ queryKey: ["trial-policy"], queryFn: () => getPolicyFn() });

  const [username, setUsername] = useState("");
  const [days, setDays] = useState(7);
  const [reason, setReason] = useState("");

  const grant = useMutation({
    mutationFn: async () => {
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("id")
        .eq("username", username.trim())
        .maybeSingle();
      if (error) throw error;
      if (!profile) throw new Error(t("admin.trials.userNotFound"));
      return grantFn({ data: { userId: profile.id, days, reason: reason.trim() || undefined } });
    },
    onSuccess: () => {
      toast.success(t("admin.trials.granted"));
      setUsername("");
      setReason("");
      void qc.invalidateQueries({ queryKey: ["admin-trial-history"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const presets = policyQ.data?.presetDays ?? [1, 3, 7, 14];
  const maxDays = policyQ.data?.maxDurationDays ?? 90;

  return (
    <Card title={t("admin.trials.grantTitle")}>
      <div className="grid grid-cols-1 items-end gap-2 sm:flex sm:flex-wrap">
        <label className="text-sm">
          {t("admin.trials.username")}
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-auto"
          />
        </label>
        <div className="text-sm">
          <span className="mb-1 block text-xs font-medium text-gray-600">{t("admin.trials.duration")}</span>
          <div className="flex flex-wrap gap-1">
            {presets.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setDays(p)}
                className={`rounded-lg border px-3 py-1.5 text-sm ${
                  days === p ? "border-[#1D6BF3] bg-[#1D6BF3]/10 text-[#1D6BF3]" : "border-gray-200 hover:bg-gray-50"
                }`}
              >
                {p}d
              </button>
            ))}
          </div>
        </div>
        <label className="text-sm">
          {t("admin.trials.customDays", { max: maxDays })}
          <input
            type="number"
            min={1}
            max={maxDays}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-28"
          />
        </label>
        <label className="text-sm">
          {t("admin.trials.reasonOptional")}
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-56"
          />
        </label>
        <button
          onClick={() => grant.mutate()}
          disabled={!username.trim() || days < 1 || grant.isPending}
          className="inline-flex items-center justify-center gap-1 rounded-lg bg-[#1D6BF3] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          <UserPlus className="h-4 w-4" /> {t("admin.trials.grant")}
        </button>
      </div>
    </Card>
  );
}

function PolicySection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const getPolicyFn = useServerFn(getTrialPolicy);
  const setPolicyFn = useServerFn(adminSetTrialPolicy);
  const policyQ = useQuery({ queryKey: ["trial-policy"], queryFn: () => getPolicyFn() });

  const [presetDays, setPresetDays] = useState("");
  const [maxDurationDays, setMaxDurationDays] = useState(90);

  useEffect(() => {
    if (policyQ.data) {
      setPresetDays(policyQ.data.presetDays.join(", "));
      setMaxDurationDays(policyQ.data.maxDurationDays);
    }
  }, [policyQ.data]);

  const save = useMutation({
    mutationFn: () =>
      setPolicyFn({
        data: {
          presetDays: presetDays
            .split(",")
            .map((s) => Number(s.trim()))
            .filter((n) => Number.isInteger(n) && n > 0),
          maxDurationDays,
        },
      }),
    onSuccess: () => {
      toast.success(t("admin.trials.policySaved"));
      void qc.invalidateQueries({ queryKey: ["trial-policy"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card title={t("admin.trials.policyTitle")}>
      <div className="grid grid-cols-1 items-end gap-2 sm:flex sm:flex-wrap">
        <label className="text-sm">
          {t("admin.trials.presetDurations")}
          <input
            value={presetDays}
            onChange={(e) => setPresetDays(e.target.value)}
            placeholder="1, 3, 7, 14"
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-64"
          />
        </label>
        <label className="text-sm">
          {t("admin.trials.maxDuration")}
          <input
            type="number"
            min={1}
            value={maxDurationDays}
            onChange={(e) => setMaxDurationDays(Number(e.target.value))}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-32"
          />
        </label>
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="inline-flex items-center justify-center gap-1 rounded-lg bg-[#1D6BF3] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          <Save className="h-4 w-4" /> {t("common.save")}
        </button>
      </div>
    </Card>
  );
}

function HistorySection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const listFn = useServerFn(adminListTrialHistory);
  const endFn = useServerFn(adminEndTrial);
  const revokeFn = useServerFn(adminRevokeTrial);
  const historyQ = useQuery({
    queryKey: ["admin-trial-history"],
    queryFn: () => listFn({ data: {} }),
  });

  const end = useMutation({
    mutationFn: (trialId: string) => endFn({ data: { trialId } }),
    onSuccess: () => {
      toast.success(t("admin.trials.ended"));
      void qc.invalidateQueries({ queryKey: ["admin-trial-history"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revoke = useMutation({
    mutationFn: (trialId: string) => revokeFn({ data: { trialId } }),
    onSuccess: () => {
      toast.success(t("admin.trials.revoked"));
      void qc.invalidateQueries({ queryKey: ["admin-trial-history"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card title={t("admin.trials.historyTitle")}>
      {(historyQ.data ?? []).length === 0 ? (
        <p className="text-sm text-gray-500">{t("admin.trials.noHistory")}</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {historyQ.data!.map((row) => {
            const user = row.profiles;
            const grantedBy = row.granted_by_profile;
            const isActive = row.status === "active" && new Date(row.expires_at).getTime() > Date.now();
            return (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-gray-800">
                    {[user?.first_name, user?.last_name].filter(Boolean).join(" ") || user?.username}
                  </p>
                  <p className="truncate text-xs text-gray-500">
                    {row.source} · {new Date(row.starts_at).toLocaleDateString()} –{" "}
                    {new Date(row.expires_at).toLocaleDateString()}
                    {grantedBy &&
                      ` · ${t("admin.trials.grantedBy", { name: [grantedBy.first_name, grantedBy.last_name].filter(Boolean).join(" ") || grantedBy.username })}`}
                    {row.reason && ` · "${row.reason}"`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      isActive
                        ? "bg-emerald-100 text-emerald-700"
                        : row.status === "revoked"
                          ? "bg-red-100 text-red-700"
                          : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {t(`admin.trials.status.${isActive ? "active" : row.status}`, isActive ? "active" : row.status)}
                  </span>
                  {row.status === "active" && (
                    <>
                      <button
                        onClick={() => end.mutate(row.id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                        title={t("admin.trials.endTitle")}
                      >
                        <Square className="h-3 w-3" /> {t("admin.trials.end")}
                      </button>
                      <button
                        onClick={() => revoke.mutate(row.id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                        title={t("admin.trials.revokeTitle")}
                      >
                        <Ban className="h-3 w-3" /> {t("admin.trials.revoke")}
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
