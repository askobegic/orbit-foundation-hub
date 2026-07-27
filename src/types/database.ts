// Re-export the generated Database type so app code has one import path.
export type { Database } from "@/integrations/supabase/types";

// Domain enums (kept in sync with SQL CHECK constraints)
export type UserLanguage = "bs" | "en" | "de";
export type UserType = "standard" | "premium" | "admin";
export type ApplicationStatus = "active" | "coming_soon" | "archived";
export type SubscriptionStatus = "active" | "expired" | "cancelled" | "pending";
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
  short_description_bs: string | null;
  short_description_en: string | null;
  short_description_de: string | null;
  status: ApplicationStatus;
  sort_order: number;
  is_enabled: boolean;
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