import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { useAuth } from "@/context/AuthContext";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin — Core Platform" },
      { name: "description", content: "Administratorski panel Core Platforme." },
      { property: "og:title", content: "Admin — Core Platform" },
      { property: "og:description", content: "Administratorski panel Core Platforme." },
    ],
  }),
  component: () => (
    <ProtectedRoute>
      <AdminGate />
    </ProtectedRoute>
  ),
});

function AdminGate() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const isAdmin = profile?.user_type === "admin" || profile?.user_type === "super_admin";
  useEffect(() => {
    if (profile && !isAdmin) void navigate({ to: "/dashboard", replace: true });
  }, [profile, isAdmin, navigate]);
  if (!isAdmin) return null;
  return (
    <main className="min-h-screen bg-gray-50 px-6 py-10">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-2xl font-semibold text-gray-900">Admin</h1>
      </div>
    </main>
  );
}