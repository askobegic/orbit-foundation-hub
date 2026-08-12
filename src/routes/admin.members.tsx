// CORE Members System -- admin configuration for the Members landing page
// (section counts, directory page size, "New" period). Same Card-based
// config-editor pattern as /admin/rewards's ConfigSection.
import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { getMyIsAdmin } from "@/lib/admin.functions";
import { adminListMembersConfig, adminSetMembersConfig } from "@/lib/members.functions";

export const Route = createFileRoute("/admin/members")({
  head: () => ({
    meta: [
      { title: "Admin · Members — Core Platform" },
      { name: "description", content: "Members directory configuration." },
    ],
  }),
  component: () => (
    <ProtectedRoute>
      <AdminMembers />
    </ProtectedRoute>
  ),
});

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

const FIELDS: { key: string; labelKey: string; hintKey: string }[] = [
  {
    key: "premium_section_count",
    labelKey: "admin.members.premiumSectionCount",
    hintKey: "admin.members.premiumSectionCountHint",
  },
  {
    key: "standard_section_count",
    labelKey: "admin.members.standardSectionCount",
    hintKey: "admin.members.standardSectionCountHint",
  },
  {
    key: "directory_page_size",
    labelKey: "admin.members.directoryPageSize",
    hintKey: "admin.members.directoryPageSizeHint",
  },
];

function AdminMembers() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isAdminFn = useServerFn(getMyIsAdmin);
  const adminQ = useQuery({ queryKey: ["is-admin"], queryFn: () => isAdminFn() });
  useEffect(() => {
    if (adminQ.data && !adminQ.data.isAdmin) void navigate({ to: "/dashboard", replace: true });
  }, [adminQ.data, navigate]);

  const listFn = useServerFn(adminListMembersConfig);
  const setFn = useServerFn(adminSetMembersConfig);
  const configQ = useQuery({ queryKey: ["admin-members-config"], queryFn: () => listFn() });
  const configByKey = new Map((configQ.data ?? []).map((r) => [r.key, r.value]));

  const [values, setValues] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!configQ.data) return;
    const next: Record<string, number> = {};
    for (const f of FIELDS) {
      const v = configByKey.get(f.key);
      next[f.key] = typeof v === "number" ? v : 0;
    }
    setValues(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configQ.data]);

  const save = useMutation({
    mutationFn: (key: string) => setFn({ data: { key, value: values[key] } }),
    onSuccess: () => {
      toast.success(t("admin.members.configSaved"));
      void qc.invalidateQueries({ queryKey: ["admin-members-config"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <main className="min-h-screen bg-[#F7F8FA] px-6 py-10">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-xl font-semibold text-gray-900">
          {t("admin.hub.cards.members.title")}
        </h1>
        <p className="mt-1 text-sm text-gray-500">{t("admin.members.subtitle")}</p>

        <Card title={t("admin.members.configTitle")}>
          <div className="space-y-4">
            {FIELDS.map((f) => (
              <div key={f.key} className="flex items-center justify-between gap-4">
                <div>
                  <label htmlFor={f.key} className="text-sm font-medium text-gray-900">
                    {t(f.labelKey)}
                  </label>
                  <p className="text-xs text-gray-500">{t(f.hintKey)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <input
                    id={f.key}
                    type="number"
                    min={1}
                    value={values[f.key] ?? 0}
                    onChange={(e) =>
                      setValues((prev) => ({ ...prev, [f.key]: Number(e.target.value) }))
                    }
                    className="w-24 rounded-lg border border-gray-200 px-3 py-1.5 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => save.mutate(f.key)}
                    disabled={save.isPending}
                    className="rounded-lg bg-[#1D6BF3] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {t("common.save")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </main>
  );
}
