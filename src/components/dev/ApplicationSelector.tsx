import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { ApplicationRow } from "@/types/database";

interface Props {
  onSelect: (slug: string) => void;
}

/**
 * Shown only when the Application Resolver cannot determine an application
 * from the request (no domain match and no stored override) -- i.e. local
 * development, previews, or an unregistered host. Never appears on a real,
 * configured production domain, since domain matching always resolves
 * there first. Lists every application straight from the registry, so a
 * newly added application is selectable with no code change.
 */
export function ApplicationSelector({ onSelect }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["application-selector-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("applications")
        .select("id, name, slug, logo_url, primary_color")
        .eq("status", "active")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Pick<
        ApplicationRow,
        "id" | "name" | "slug" | "logo_url" | "primary_color"
      >[];
    },
  });

  return (
    <main
      className="flex min-h-screen items-center justify-center px-4 py-12"
      style={{ background: "linear-gradient(135deg, #EEF2FF 0%, #F0F9FF 50%, #F0FDF4 100%)" }}
    >
      <div
        className="w-full max-w-[420px] rounded-2xl bg-white p-8"
        style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.08)" }}
      >
        <h1 className="mb-1 text-center text-lg font-semibold text-gray-900">Odaberi aplikaciju</h1>
        <p className="mb-6 text-center text-xs text-gray-500">
          Nijedna aplikacija nije prepoznata za ovaj hostname. Odaberi koju testiraš.
        </p>

        {isLoading ? (
          <div className="flex justify-center py-6">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {(data ?? []).map((app) => (
              <button
                key={app.id}
                type="button"
                onClick={() => onSelect(app.slug)}
                className="flex items-center gap-3 rounded-xl border border-[#E5E7EB] px-4 py-3 text-left text-sm font-medium text-gray-800 hover:bg-gray-50"
              >
                {app.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={app.logo_url} alt="" className="h-7 w-7 rounded-md object-contain" />
                ) : (
                  <span
                    className="flex h-7 w-7 items-center justify-center rounded-md text-xs font-semibold text-white"
                    style={{ backgroundColor: app.primary_color }}
                  >
                    {app.name.slice(0, 1)}
                  </span>
                )}
                {app.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
