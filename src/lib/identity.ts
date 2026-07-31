// Core Identity Service.
//
// Owns identity import and lock-state reads for the platform's trusted-
// identity-provider model (see PROJECT_KNOWLEDGE.md -> Profiles). The
// public API is provider-agnostic by design: callers ask for "the identity
// this auth user's provider supplied," never for "the Google identity."
// Google is the first registered provider, added to PROVIDER_EXTRACTORS
// below -- adding Apple, Microsoft, etc. later means adding another entry
// there, not changing any function signature in this file.
import type { User } from "@supabase/supabase-js";
import type { ProfileRow } from "@/types/database";

export interface ImportedIdentity {
  firstName: string;
  lastName: string;
  avatarUrl: string;
  provider: string;
}

type ProviderMetadataExtractor = (
  metadata: Record<string, unknown>,
) => Omit<ImportedIdentity, "provider">;

function readString(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function splitFullName(fullName: string): { first: string; last: string } {
  const [first, ...rest] = fullName.split(" ");
  return { first: first ?? "", last: rest.join(" ") };
}

// Shared shape used by every OIDC-style provider registered below (Google
// today; Apple/Microsoft would plug in here too unless their metadata is
// shaped differently enough to need their own extractor function).
const extractFromOidcMetadata: ProviderMetadataExtractor = (metadata) => {
  const fullName = readString(metadata.full_name) || readString(metadata.name);
  const { first, last } = splitFullName(fullName);
  return {
    firstName: readString(metadata.given_name) || readString(metadata.first_name) || first,
    lastName: readString(metadata.family_name) || readString(metadata.last_name) || last,
    avatarUrl: readString(metadata.avatar_url) || readString(metadata.picture),
  };
};

const PROVIDER_EXTRACTORS: Record<string, ProviderMetadataExtractor> = {
  google: extractFromOidcMetadata,
};

/**
 * Extracts the identity Core imports at first login (name + photo),
 * regardless of which identity provider the user signed in with.
 */
export function extractIdentityFromAuthUser(user: User): ImportedIdentity {
  const provider = (
    (user.app_metadata as Record<string, unknown> | undefined)?.provider ?? ""
  ).toString();
  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
  const extractor = PROVIDER_EXTRACTORS[provider] ?? extractFromOidcMetadata;
  return { ...extractor(metadata), provider };
}

/** Whether the identity provider supplied a photo to import. */
export function hasImportedAvatar(user: User): boolean {
  return extractIdentityFromAuthUser(user).avatarUrl !== "";
}

/** Whether this profile's identity fields (name, photo) are locked. */
export function isIdentityLocked(
  profile: Pick<ProfileRow, "identity_locked_at"> | null | undefined,
): boolean {
  return !!profile?.identity_locked_at;
}
