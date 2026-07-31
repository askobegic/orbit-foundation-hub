export function slugifyName(first: string, last: string): string {
  const raw = `${first} ${last}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "dj")
    .replace(/[čć]/g, "c")
    .replace(/š/g, "s")
    .replace(/ž/g, "z")
    .replace(/[^a-z0-9]/g, "");
  return raw || "user";
}

import { supabase } from "@/integrations/supabase/client";

export async function generateUniqueUsername(
  first: string,
  last: string,
  currentUserId: string,
): Promise<string> {
  const base = slugifyName(first, last);
  let candidate = base;
  let n = 1;
  // Try up to 50 iterations
  while (n < 50) {
    const { data } = await supabase
      .from("profiles_public")
      .select("id")
      .eq("username", candidate)
      .neq("id", currentUserId)
      .maybeSingle();
    if (!data) return candidate;
    n += 1;
    candidate = `${base}${n}`;
  }
  return `${base}${Date.now()}`;
}