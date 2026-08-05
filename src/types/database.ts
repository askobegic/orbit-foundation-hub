// Re-export the generated Database type so app code has one import path.
export type { Database } from "@/integrations/supabase/types";

// Domain enums (kept in sync with SQL CHECK constraints)
export type UserLanguage = "bs" | "en" | "de";
export type UserType = "standard" | "premium" | "admin";
// Priority 8.9: one single visibility state per application, replacing the
// earlier status/is_enabled pair (two independently-settable flags
// answering overlapping questions -- see the migration that dropped both).
// draft: hidden from all normal users, visible only to administrators.
// coming_soon: visible on the Dashboard, clearly marked, not enterable.
// active: fully visible and accessible. archived: hidden from normal
// users, preserved for administration/history. See PROJECT_KNOWLEDGE.md ->
// Applications -> Application Visibility.
export type ApplicationVisibility = "draft" | "coming_soon" | "active" | "archived";
export type SubscriptionStatus = "active" | "expired" | "cancelled" | "pending";
// Priority 8.11: classifies what kind of purchasable item a
// subscription_plans row represents -- "Products & Purchases" evolved from
// "Subscription Plans" by adding this one column, not by renaming or
// restructuring anything. Every product still creates a normal
// subscriptions row and still grants the same one global Premium
// entitlement when active, regardless of type -- see PROJECT_KNOWLEDGE.md
// -> Products & Purchases.
export type ProductType = "subscription" | "promotion" | "one_time";
export type PaymentStatus = "pending" | "success" | "failed" | "refunded";
export type PaymentMethod = "stripe" | "paypal";
export type NotificationType = "info" | "success" | "warning" | "error";

// -----------------------------------------------------------------------------
// Hand-written row shapes mirroring the SQL schema.
// Kept until Lovable Cloud regenerates src/integrations/supabase/types.ts
// with real table types (currently a placeholder).
// -----------------------------------------------------------------------------

export interface ProfileRow {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  city: string | null;
  country: string | null;
  username: string | null;
  bio: string | null;
  language: UserLanguage;
  user_type: UserType;
  is_verified: boolean;
  is_active: boolean;
  profile_complete: boolean;
  notify_email: boolean;
  notify_in_app: boolean;
  notify_marketing: boolean;
  // Set automatically by the enforce_identity_lock trigger the moment
  // onboarding completes -- never client-writable. See PROJECT_KNOWLEDGE.md
  // -> Profiles (Identity Lock).
  identity_locked_at: string | null;
  created_at: string;
  updated_at: string;
}
export type ProfileInsert = Partial<ProfileRow> & { id: string };

// Client-editable subset of ProfileRow. Deliberately excludes id,
// user_type, is_verified, is_active, created_at, and updated_at -- those
// are service-role-only, enforced at the database via column-level
// UPDATE grants (see supabase/migrations -> protect_profile_privileged_columns).
// This type is a compile-time safety net only; the database grant is the
// real enforcement boundary. See PROJECT_AUDIT.md -> AU-1 / DB-1.
export type ProfileUpdate = Partial<
  Pick<
    ProfileRow,
    | "first_name"
    | "last_name"
    | "avatar_url"
    | "city"
    | "country"
    | "username"
    | "bio"
    | "language"
    | "email"
    | "profile_complete"
    | "notify_email"
    | "notify_in_app"
    | "notify_marketing"
  >
>;

export interface PremiumProfileRow {
  id: string;
  user_id: string;
  phone: string | null;
  phone_public: boolean;
  whatsapp: string | null;
  whatsapp_public: boolean;
  contact_email: string | null;
  contact_email_public: boolean;
  website: string | null;
  website_public: boolean;
  primary_profession: string | null;
  secondary_professions: string[] | null;
  facebook_url: string | null;
  instagram_url: string | null;
  tiktok_url: string | null;
  youtube_url: string | null;
  linkedin_url: string | null;
  x_url: string | null;
  created_at: string;
  updated_at: string;
}
export type PremiumProfileInsert = Partial<PremiumProfileRow> & { user_id: string };
export type PremiumProfileUpdate = Partial<PremiumProfileRow>;

export interface ApplicationRow {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  logo_url: string | null;
  favicon_url: string | null;
  cover_image_url: string | null;
  primary_color: string;
  secondary_color: string;
  // Google Cloud OAuth Client ID for this application's own branded
  // consent screen. Not secret -- see PROJECT_KNOWLEDGE.md -> Authentication.
  google_client_id: string | null;
  short_description_bs: string | null;
  short_description_en: string | null;
  short_description_de: string | null;
  visibility: ApplicationVisibility;
  // Informational only (Priority 8.9) -- an optional release date shown
  // alongside a "coming_soon" application. Never read by any activation
  // logic; moving to "active" is always a separate, explicit admin action.
  launch_date: string | null;
  // Localization resolution order step 3 (see PROJECT_KNOWLEDGE.md ->
  // Authentication -> Localization / API_CONTRACT.md). Nullable -- falls
  // through to the next resolution step when unset.
  default_language: UserLanguage | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}
export type ApplicationInsert = Partial<ApplicationRow> & { name: string; slug: string };
export type ApplicationUpdate = Partial<ApplicationRow>;

export interface SubscriptionPlanRow {
  id: string;
  app_id: string | null;
  name: string;
  duration_months: 1 | 3 | 6 | 12;
  price: number;
  currency: string;
  stripe_payment_link: string | null;
  paypal_payment_link: string | null;
  features_bs: string[];
  features_en: string[];
  features_de: string[];
  is_active: boolean;
  // Priority 8.11: Subscription (default, unchanged behavior) | Promotion |
  // One-Time -- an admin-facing classification only, does not change
  // checkout/entitlement logic. See ProductType above.
  product_type: ProductType;
  created_at: string;
}
export type SubscriptionPlanInsert = Partial<SubscriptionPlanRow> & {
  name: string;
  duration_months: 1 | 3 | 6 | 12;
  price: number;
};

export interface SubscriptionRow {
  id: string;
  user_id: string | null;
  app_id: string | null;
  plan_id: string | null;
  status: SubscriptionStatus;
  stripe_payment_id: string | null;
  paypal_payment_id: string | null;
  amount_paid: number | null;
  currency: string;
  started_at: string;
  expires_at: string;
  created_at: string;
}
export type SubscriptionInsert = Partial<SubscriptionRow> & { expires_at: string };

export interface PaymentRow {
  id: string;
  user_id: string | null;
  app_id: string | null;
  subscription_id: string | null;
  // Priority 8.4 (Advertising) -- set for a campaign purchase, mutually
  // exclusive with subscription_id in practice (a payment is for one or the
  // other, never both). Missing from this hand-written type until Priority
  // 8.12 surfaced it via dashboard.purchases.tsx joining ad_campaigns.
  campaign_id: string | null;
  stripe_payment_id: string | null;
  stripe_payment_intent_id: string | null;
  paypal_payment_id: string | null;
  amount: number;
  currency: string;
  status: PaymentStatus;
  payment_method: PaymentMethod | null;
  invoice_url: string | null;
  created_at: string;
}
export type PaymentInsert = Partial<PaymentRow> & { amount: number };

export interface NotificationRow {
  id: string;
  user_id: string | null;
  title_bs: string | null;
  title_en: string | null;
  title_de: string | null;
  message_bs: string | null;
  message_en: string | null;
  message_de: string | null;
  type: NotificationType;
  app_id: string | null;
  is_read: boolean;
  created_at: string;
}
export type NotificationInsert = Partial<NotificationRow>;

export interface AuditLogRow {
  id: string;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  old_data: unknown;
  new_data: unknown;
  ip_address: string | null;
  created_at: string;
}
