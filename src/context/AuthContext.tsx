import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";
import type { ProfileRow, ProfileUpdate } from "@/types/database";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: ProfileRow | null;
  loading: boolean;
  signInWithGoogle: () => Promise<{ error?: Error }>;
  signInWithApple: () => Promise<{ error?: Error }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateProfile: (data: ProfileUpdate) => Promise<ProfileRow>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = async (u: User) => {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", u.id)
      .maybeSingle();
    let row = (data as ProfileRow | null) ?? null;

    // Auto-import OAuth metadata (Google/Apple) into profile if fields are empty.
    // Apple only sends name on very first login — must capture immediately.
    if (row) {
      const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
      const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : "");
      const fullName = str(meta.full_name) || str(meta.name);
      const [splitFirst, ...splitRest] = fullName.split(" ");
      const metaFirst = str(meta.given_name) || str(meta.first_name) || splitFirst || "";
      const metaLast = str(meta.family_name) || str(meta.last_name) || splitRest.join(" ") || "";
      const metaAvatar = str(meta.avatar_url) || str(meta.picture);
      const patch: ProfileUpdate = {};
      if (!row.first_name && metaFirst) patch.first_name = metaFirst;
      if (!row.last_name && metaLast) patch.last_name = metaLast;
      if (!row.avatar_url && metaAvatar) patch.avatar_url = metaAvatar;
      if (!row.email && u.email) patch.email = u.email;
      if (Object.keys(patch).length > 0) {
        const { data: updated } = await supabase
          .from("profiles")
          .update(patch)
          .eq("id", u.id)
          .select("*")
          .single();
        if (updated) row = updated as ProfileRow;
      }
    }
    setProfile(row);
  };

  useEffect(() => {
    // Subscribe synchronously; defer any Supabase calls to avoid deadlocks.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession?.user) {
        setLoading(true);
        setTimeout(() => {
          void loadProfile(nextSession.user).finally(() => setLoading(false));
        }, 0);
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    void supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session?.user) {
        await loadProfile(data.session.user);
      } else {
        setProfile(null);
      }
      setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loading,
      signInWithGoogle: async () => {
        const { error } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo: 'https://orbit-foundation-hub.vercel.app/auth/callback' },
        });
        if (error) {
          console.error("[auth] Google sign-in failed", error);
          return { error };
        }
        return {};
      },
      signInWithApple: async () => {
        const { error } = await supabase.auth.signInWithOAuth({
          provider: "apple",
          options: { redirectTo: 'https://orbit-foundation-hub.vercel.app/auth/callback' },
        });
        if (error) {
          console.error("[auth] Apple sign-in failed", error);
          return { error };
        }
        return {};
      },
      signOut: async () => {
        await supabase.auth.signOut();
      },
      refreshProfile: async () => {
        if (session?.user) await loadProfile(session.user);
      },
      updateProfile: async (data) => {
        if (!session?.user) throw new Error("Not authenticated");
        const { data: updated, error } = await supabase
          .from("profiles")
          .update(data)
          .eq("id", session.user.id)
          .select("*")
          .single();
        if (error) throw error;
        setProfile(updated as ProfileRow);
        return updated as ProfileRow;
      },
    }),
    [session, profile, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
