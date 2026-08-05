import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { extractIdentityFromAuthUser } from "@/lib/identity";
import type { ProfileRow, ProfileUpdate } from "@/types/database";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: ProfileRow | null;
  loading: boolean;
  signInWithGoogle: () => Promise<{ error?: Error }>;
  signInWithPhone: (phone: string) => Promise<{ error?: Error }>;
  verifyOtp: (phone: string, token: string) => Promise<{ error?: Error }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateProfile: (data: ProfileUpdate) => Promise<ProfileRow>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function loadOrCreateProfile(u: User): Promise<ProfileRow | null> {
  // Try to load existing profile
  const { data: existing } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", u.id)
    .maybeSingle();

  if (existing) {
    // Auto-import missing fields from the identity provider. first_name/
    // last_name/avatar_url only ever fill gaps -- once set (in particular,
    // once Identity Lock engages at onboarding completion), those three
    // conditions are always false, so this never conflicts with the lock.
    //
    // email is different (Priority 8.7, R-7): the authentication identity
    // must remain the single source of truth for it, so this always
    // re-syncs email to match `u.email` (not just fill-once-if-empty) --
    // self-healing on every session load/auth-state change, the two
    // places this function is called from. profiles.email is no longer
    // exposed as an admin-editable field (see admin.functions.ts's
    // userUpdateSchema) for the same reason: any manual override would
    // just be silently reverted the next time this runs.
    const identity = extractIdentityFromAuthUser(u);
    const patch: ProfileUpdate = {};
    if (!existing.first_name) patch.first_name = identity.firstName;
    if (!existing.last_name) patch.last_name = identity.lastName;
    if (!existing.avatar_url) patch.avatar_url = identity.avatarUrl;
    if (u.email && existing.email !== u.email) patch.email = u.email;

    if (Object.keys(patch).length > 0) {
      const { data: updated } = await supabase
        .from("profiles")
        .update(patch)
        .eq("id", u.id)
        .select("*")
        .single();
      return (updated as ProfileRow) ?? (existing as ProfileRow);
    }
    return existing as ProfileRow;
  }

  // Create new profile for first-time users
  const identity = extractIdentityFromAuthUser(u);

  const { data: created } = await supabase
    .from("profiles")
    .insert({
      id: u.id,
      email: u.email ?? "",
      first_name: identity.firstName,
      last_name: identity.lastName,
      avatar_url: identity.avatarUrl,
      profile_complete: false,
      language: "bs",
    })
    .select("*")
    .single();

  return (created as ProfileRow) ?? null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [loading, setLoading] = useState(true);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // Get initial session
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session?.user) {
        const p = await loadOrCreateProfile(data.session.user);
        setProfile(p);
      }
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        setSession(newSession);
        if (newSession?.user) {
          const p = await loadOrCreateProfile(newSession.user);
          setProfile(p);
        } else {
          setProfile(null);
        }
        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const value: AuthContextValue = {
    session,
    user: session?.user ?? null,
    profile,
    loading,

    // Intentionally disabled -- never wire this up. This platform supports
    // multiple applications, each with its own Google OAuth Client ID, all
    // authenticating into the same Supabase project via
    // signInWithIdToken() (see login.tsx). Supabase's Google provider holds
    // exactly one Client Secret; the redirect-based signInWithOAuth() flow
    // authenticates the code exchange using that single secret, so it can
    // only ever be correct for one of the applications' Google Clients.
    // Enabling it for Google would silently produce incorrect
    // authentication for every other application. See PROJECT_KNOWLEDGE.md
    // -> Authentication.
    signInWithGoogle: async () => {
      throw new Error(
        "Google redirect OAuth flow is intentionally disabled. This platform uses signInWithIdToken() exclusively.",
      );
    },

    signInWithPhone: async (phone: string) => {
      const { error } = await supabase.auth.signInWithOtp({
        phone,
      });
      return error ? { error } : {};
    },

    verifyOtp: async (phone: string, token: string) => {
      const { error } = await supabase.auth.verifyOtp({
        phone,
        token,
        type: "sms",
      });
      return error ? { error } : {};
    },

    signOut: async () => {
      await supabase.auth.signOut();
      setSession(null);
      setProfile(null);
    },

    refreshProfile: async () => {
      if (session?.user) {
        const p = await loadOrCreateProfile(session.user);
        setProfile(p);
      }
    },

    updateProfile: async (data: ProfileUpdate) => {
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
  };

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
