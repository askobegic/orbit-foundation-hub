import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft } from "lucide-react";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { adminListPayments } from "@/lib/admin.functions";

export const Route = createFileRoute("/admin/payments")({
  head: () => ({
    meta: [
      { title: "Admin · Payments — Core Platform" },
      { name: "description", content: "All payments history." },
      { property: "og:title", content: "Admin · Payments — Core Platform" },
      { property: "og:description", content: "All payments history." },
    ],
  }),
  component: () => (
    <ProtectedRoute>
      <PaymentsPage />
    </ProtectedRoute>
  ),
});

function PaymentsPage() {
  const listFn = useServerFn(adminListPayments);
  const q = useQuery({ queryKey: ["admin-payments"], queryFn: () => listFn() });
  const rows = q.data ?? [];

  return (
    <main className="min-h-screen bg-[#F7F8FA] px-6 py-10">
      <div className="mx-auto max-w-6xl">
        <Link to="/admin" className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <h1 className="text-2xl font-semibold text-gray-900">Payments History</h1>

        <div className="mt-6 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-100">
          <table className="min-w-full divide-y divide-gray-100 text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">User ID</th>
                <th className="px-4 py-3">App</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Method</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Invoice</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {q.isLoading && (
                <tr><td className="px-4 py-6 text-center text-gray-500" colSpan={7}>Loading…</td></tr>
              )}
              {!q.isLoading && rows.length === 0 && (
                <tr><td className="px-4 py-6 text-center text-gray-500" colSpan={7}>No payments yet.</td></tr>
              )}
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-3 text-gray-500">{p.created_at ? new Date(p.created_at).toLocaleString() : "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">{p.user_id?.slice(0, 8) ?? "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">{p.app_id?.slice(0, 8) ?? "—"}</td>
                  <td className="px-4 py-3 font-semibold text-gray-900">{Number(p.amount).toFixed(2)} {p.currency}</td>
                  <td className="px-4 py-3 text-gray-700">{p.payment_method ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={
                      p.status === "completed" ? "rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700" :
                      p.status === "pending" ? "rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700" :
                      "rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700"
                    }>{p.status}</span>
                  </td>
                  <td className="px-4 py-3">
                    {p.invoice_url ? (
                      <a href={p.invoice_url} target="_blank" rel="noreferrer" className="text-[#1D6BF3] hover:underline">Open</a>
                    ) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}