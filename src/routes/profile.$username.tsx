import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/profile/$username")({
  head: ({ params }) => ({
    meta: [
      { title: `@${params.username} — Core Platform` },
      { name: "description", content: `Javni profil korisnika @${params.username}.` },
      { property: "og:title", content: `@${params.username} — Core Platform` },
      { property: "og:description", content: `Javni profil korisnika @${params.username}.` },
    ],
  }),
  component: PublicProfile,
});

function PublicProfile() {
  const { username } = Route.useParams();
  return (
    <main className="min-h-screen bg-gray-50 px-6 py-10">
      <div className="mx-auto max-w-2xl rounded-2xl bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-gray-900">@{username}</h1>
        <p className="mt-2 text-sm text-gray-500">Public profile — coming soon.</p>
      </div>
    </main>
  );
}