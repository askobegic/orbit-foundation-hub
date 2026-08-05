// Priority 8.4: replaceable media storage adapter.
//
// Approved instruction (Phase 8.2 approval): the Tier-2 storage provider
// decision (Hostinger, Cloudflare R2, S3-compatible, etc. -- see
// PROJECT_KNOWLEDGE.md -> Media Strategy) must not block CORE architecture.
// This interface is the swap point -- campaign banner upload code (and any
// future Tier-2 upload) calls only getMediaStorageProvider(), never
// `supabase.storage` directly, so changing the backing provider later is a
// change to this one file, not to campaign/business logic anywhere else.
//
// Today's only implementation still uses the existing `core` Supabase
// Storage bucket (Tier 1 infrastructure, already working) under a new
// `advertising/<user_id>/...` folder prefix -- this is a Tier-2 *shaped*
// upload (user-generated content) temporarily running on Tier-1
// infrastructure until a Tier-2 provider is chosen, exactly as scoped.
import { supabase } from "@/integrations/supabase/client";

export interface MediaStorageProvider {
  upload(path: string, file: File, contentType: string): Promise<{ url: string }>;
  remove(path: string): Promise<void>;
}

class SupabaseCoreBucketProvider implements MediaStorageProvider {
  async upload(path: string, file: File, contentType: string): Promise<{ url: string }> {
    const { error } = await supabase.storage.from("core").upload(path, file, {
      upsert: true,
      contentType,
    });
    if (error) throw error;
    const {
      data: { publicUrl },
    } = supabase.storage.from("core").getPublicUrl(path);
    return { url: publicUrl };
  }

  async remove(path: string): Promise<void> {
    const { error } = await supabase.storage.from("core").remove([path]);
    if (error) throw error;
  }
}

let provider: MediaStorageProvider | null = null;

export function getMediaStorageProvider(): MediaStorageProvider {
  if (!provider) provider = new SupabaseCoreBucketProvider();
  return provider;
}

export function campaignBannerPath(userId: string, fileName: string): string {
  const ext = fileName.split(".").pop() || "jpg";
  return `advertising/${userId}/${Date.now()}.${ext}`;
}

// Priority 8.7 (R-6/R-10): avatars are Tier-2-classified content per
// PROJECT_KNOWLEDGE.md -> Media Strategy, same as campaign banners, but
// were still calling `supabase.storage` directly from two independent
// places (AvatarUpload.tsx, onboarding.tsx) instead of going through this
// adapter -- meaning a future Tier-2 provider swap would silently miss
// both. Same path shape as before (a fixed `avatar.<ext>` filename, so a
// re-upload replaces the existing file via `upsert: true` rather than
// accumulating one per upload, unlike campaignBannerPath's timestamped
// name) -- this only changes which function performs the upload, not the
// storage layout or behavior.
export function avatarPath(userId: string, fileName: string): string {
  const ext = fileName.split(".").pop() || "jpg";
  return `avatars/${userId}/avatar.${ext}`;
}
