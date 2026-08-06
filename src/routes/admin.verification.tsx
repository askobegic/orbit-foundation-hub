import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { ArrowLeft, BadgeCheck, X } from "lucide-react";
import { toast } from "sonner";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { adminListVerificationRequests, adminSetVerified } from "@/lib/admin.functions";

export const Route = createFileRoute("/admin/verification")({
  head: () => ({
    meta: [
      { title: "Admin · Verification — Core Platform" },
      { name: "description", content: "Approve or reject user verification." },
      { property: "og:title", content: "Admin · Verification — Core Platform" },
      { property: "og:description", content: "Approve or reject user verification." },
    ],
  }),
  component: () => (
    <ProtectedRoute>
      <VerificationPage />
    </ProtectedRoute>
  ),
});

function VerificationPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const listFn = useServerFn(adminListVerificationRequests);
  const setFn = useServerFn(adminSetVerified);
  const q = useQuery({ queryKey: ["admin-verification"], queryFn: () => listFn() });
  const mut = useMutation({
    mutationFn: (v: { user_id: string; verified: boolean }) => setFn({ data: v }),
    onSuccess: () => {
      toast.success(t("admin.common.updated"));
      void qc.invalidateQueries({ queryKey: ["admin-verification"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = q.data ?? [];

  return (
    <main className="min-h-screen bg-[#F7F8FA] px-6 py-10">
      <div className="mx-auto max-w-5xl">
        <Link to="/admin" className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900">
          <ArrowLeft className="h-4 w-4" /> {t("admin.common.back")}
        </Link>
        <h1 className="text-2xl font-semibold text-gray-900">{t("admin.verification.title")}</h1>
        <p className="mt-1 text-sm text-gray-500">{t("admin.verification.subtitle")}</p>

        <div className="mt-6 space-y-3">
          {q.isLoading && <p className="text-sm text-gray-500">{t("common.loading")}</p>}
          {!q.isLoading && rows.length === 0 && (
            <p className="rounded-2xl bg-white p-6 text-sm text-gray-500 shadow-sm ring-1 ring-gray-100">{t("admin.verification.noCandidates")}</p>
          )}
          {rows.map((u) => (
            <div key={u.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-100">
              <div className="flex min-w-0 items-center gap-3">
                {u.avatar_url ? (
                  <img src={u.avatar_url} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
                ) : (
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gray-100 text-sm font-semibold text-gray-600">
                    {(u.first_name ?? "?").slice(0, 1)}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-gray-900">
                    {[u.first_name, u.last_name].filter(Boolean).join(" ") || u.email}
                    {u.is_verified && <BadgeCheck className="ml-1 inline h-4 w-4 text-[#1D6BF3]" />}
                  </p>
                  <p className="truncate text-xs text-gray-500">{u.email} · {u.city ?? "—"}, {u.country ?? "—"}</p>
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                {u.is_verified ? (
                  <button
                    onClick={() => mut.mutate({ user_id: u.id, verified: false })}
                    className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    <X className="h-4 w-4" /> {t("admin.verification.revoke")}
                  </button>
                ) : (
                  <button
                    onClick={() => mut.mutate({ user_id: u.id, verified: true })}
                    className="inline-flex items-center gap-1 rounded-lg bg-[#1D6BF3] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#155ac9]"
                  >
                    <BadgeCheck className="h-4 w-4" /> {t("admin.verification.approve")}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}