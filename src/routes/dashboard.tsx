import { createFileRoute } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { DashboardPage } from "@/components/dashboard/DashboardPage";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Core Platform" },
      { name: "description", content: "Vaš kontrolni centar na Core Platformi." },
      { property: "og:title", content: "Dashboard — Core Platform" },
      { property: "og:description", content: "Vaš kontrolni centar na Core Platformi." },
    ],
  }),
  component: () => (
    <ProtectedRoute>
      <DashboardPage />
    </ProtectedRoute>
  ),
});