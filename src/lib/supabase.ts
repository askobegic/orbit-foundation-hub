// Re-export the auto-generated Lovable Cloud client so app code has a
// stable import path (`@/lib/supabase`) as specified in the project layout.
// Do NOT edit src/integrations/supabase/client.ts — it is auto-generated.
export { supabase } from "@/integrations/supabase/client";
export type { Database } from "@/integrations/supabase/types";
export type {
  ApplicationRow,
  ApplicationInsert,
  ApplicationUpdate,
  ProfileRow,
  ProfileInsert,
  ProfileUpdate,
  PremiumProfileRow,
  PremiumProfileInsert,
  PremiumProfileUpdate,
  SubscriptionPlanRow,
  SubscriptionPlanInsert,
  ProductType,
  SubscriptionRow,
  SubscriptionInsert,
  PaymentRow,
  PaymentInsert,
  NotificationRow,
  NotificationInsert,
  AuditLogRow,
  UserLanguage,
  UserType,
  ApplicationVisibility,
  SubscriptionStatus,
  PaymentStatus,
  PaymentMethod,
  NotificationType,
} from "@/types/database";