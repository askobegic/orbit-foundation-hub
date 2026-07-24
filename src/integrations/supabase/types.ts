export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      applications: {
        Row: {
          cover_image_url: string | null
          created_at: string | null
          domain: string | null
          favicon_url: string | null
          id: string
          logo_url: string | null
          name: string
          primary_color: string | null
          secondary_color: string | null
          short_description_bs: string | null
          short_description_de: string | null
          short_description_en: string | null
          slug: string
          sort_order: number | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          cover_image_url?: string | null
          created_at?: string | null
          domain?: string | null
          favicon_url?: string | null
          id?: string
          logo_url?: string | null
          name: string
          primary_color?: string | null
          secondary_color?: string | null
          short_description_bs?: string | null
          short_description_de?: string | null
          short_description_en?: string | null
          slug: string
          sort_order?: number | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          cover_image_url?: string | null
          created_at?: string | null
          domain?: string | null
          favicon_url?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          primary_color?: string | null
          secondary_color?: string | null
          short_description_bs?: string | null
          short_description_de?: string | null
          short_description_en?: string | null
          slug?: string
          sort_order?: number | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string | null
          entity_id: string | null
          entity_type: string
          id: string
          ip_address: string | null
          new_data: Json | null
          old_data: Json | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          entity_id?: string | null
          entity_type: string
          id?: string
          ip_address?: string | null
          new_data?: Json | null
          old_data?: Json | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          ip_address?: string | null
          new_data?: Json | null
          old_data?: Json | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          app_id: string | null
          created_at: string | null
          id: string
          is_read: boolean | null
          message_bs: string | null
          message_de: string | null
          message_en: string | null
          title_bs: string | null
          title_de: string | null
          title_en: string | null
          type: string | null
          user_id: string | null
        }
        Insert: {
          app_id?: string | null
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          message_bs?: string | null
          message_de?: string | null
          message_en?: string | null
          title_bs?: string | null
          title_de?: string | null
          title_en?: string | null
          type?: string | null
          user_id?: string | null
        }
        Update: {
          app_id?: string | null
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          message_bs?: string | null
          message_de?: string | null
          message_en?: string | null
          title_bs?: string | null
          title_de?: string | null
          title_en?: string | null
          type?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          app_id: string | null
          created_at: string | null
          currency: string | null
          id: string
          invoice_url: string | null
          payment_method: string | null
          paypal_payment_id: string | null
          status: string | null
          stripe_payment_id: string | null
          subscription_id: string | null
          user_id: string | null
        }
        Insert: {
          amount: number
          app_id?: string | null
          created_at?: string | null
          currency?: string | null
          id?: string
          invoice_url?: string | null
          payment_method?: string | null
          paypal_payment_id?: string | null
          status?: string | null
          stripe_payment_id?: string | null
          subscription_id?: string | null
          user_id?: string | null
        }
        Update: {
          amount?: number
          app_id?: string | null
          created_at?: string | null
          currency?: string | null
          id?: string
          invoice_url?: string | null
          payment_method?: string | null
          paypal_payment_id?: string | null
          status?: string | null
          stripe_payment_id?: string | null
          subscription_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      premium_profiles: {
        Row: {
          contact_email: string | null
          contact_email_public: boolean | null
          created_at: string | null
          facebook_url: string | null
          id: string
          instagram_url: string | null
          linkedin_url: string | null
          phone: string | null
          phone_public: boolean | null
          primary_profession: string | null
          secondary_professions: string[] | null
          tiktok_url: string | null
          updated_at: string | null
          user_id: string | null
          website: string | null
          website_public: boolean | null
          whatsapp: string | null
          whatsapp_public: boolean | null
          x_url: string | null
          youtube_url: string | null
        }
        Insert: {
          contact_email?: string | null
          contact_email_public?: boolean | null
          created_at?: string | null
          facebook_url?: string | null
          id?: string
          instagram_url?: string | null
          linkedin_url?: string | null
          phone?: string | null
          phone_public?: boolean | null
          primary_profession?: string | null
          secondary_professions?: string[] | null
          tiktok_url?: string | null
          updated_at?: string | null
          user_id?: string | null
          website?: string | null
          website_public?: boolean | null
          whatsapp?: string | null
          whatsapp_public?: boolean | null
          x_url?: string | null
          youtube_url?: string | null
        }
        Update: {
          contact_email?: string | null
          contact_email_public?: boolean | null
          created_at?: string | null
          facebook_url?: string | null
          id?: string
          instagram_url?: string | null
          linkedin_url?: string | null
          phone?: string | null
          phone_public?: boolean | null
          primary_profession?: string | null
          secondary_professions?: string[] | null
          tiktok_url?: string | null
          updated_at?: string | null
          user_id?: string | null
          website?: string | null
          website_public?: boolean | null
          whatsapp?: string | null
          whatsapp_public?: boolean | null
          x_url?: string | null
          youtube_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "premium_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          city: string | null
          country: string | null
          created_at: string | null
          email: string | null
          first_name: string | null
          id: string
          is_active: boolean | null
          is_verified: boolean | null
          language: string | null
          last_name: string | null
          profile_complete: boolean | null
          updated_at: string | null
          user_type: string | null
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          city?: string | null
          country?: string | null
          created_at?: string | null
          email?: string | null
          first_name?: string | null
          id: string
          is_active?: boolean | null
          is_verified?: boolean | null
          language?: string | null
          last_name?: string | null
          profile_complete?: boolean | null
          updated_at?: string | null
          user_type?: string | null
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          city?: string | null
          country?: string | null
          created_at?: string | null
          email?: string | null
          first_name?: string | null
          id?: string
          is_active?: boolean | null
          is_verified?: boolean | null
          language?: string | null
          last_name?: string | null
          profile_complete?: boolean | null
          updated_at?: string | null
          user_type?: string | null
          username?: string | null
        }
        Relationships: []
      }
      subscription_plans: {
        Row: {
          app_id: string | null
          created_at: string | null
          currency: string | null
          duration_months: number
          features_bs: Json | null
          features_de: Json | null
          features_en: Json | null
          id: string
          is_active: boolean | null
          name: string
          paypal_payment_link: string | null
          price: number
          stripe_payment_link: string | null
        }
        Insert: {
          app_id?: string | null
          created_at?: string | null
          currency?: string | null
          duration_months: number
          features_bs?: Json | null
          features_de?: Json | null
          features_en?: Json | null
          id?: string
          is_active?: boolean | null
          name: string
          paypal_payment_link?: string | null
          price: number
          stripe_payment_link?: string | null
        }
        Update: {
          app_id?: string | null
          created_at?: string | null
          currency?: string | null
          duration_months?: number
          features_bs?: Json | null
          features_de?: Json | null
          features_en?: Json | null
          id?: string
          is_active?: boolean | null
          name?: string
          paypal_payment_link?: string | null
          price?: number
          stripe_payment_link?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscription_plans_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          amount_paid: number | null
          app_id: string | null
          created_at: string | null
          currency: string | null
          expires_at: string
          id: string
          paypal_payment_id: string | null
          plan_id: string | null
          started_at: string | null
          status: string | null
          stripe_payment_id: string | null
          user_id: string | null
        }
        Insert: {
          amount_paid?: number | null
          app_id?: string | null
          created_at?: string | null
          currency?: string | null
          expires_at: string
          id?: string
          paypal_payment_id?: string | null
          plan_id?: string | null
          started_at?: string | null
          status?: string | null
          stripe_payment_id?: string | null
          user_id?: string | null
        }
        Update: {
          amount_paid?: number | null
          app_id?: string | null
          created_at?: string | null
          currency?: string | null
          expires_at?: string
          id?: string
          paypal_payment_id?: string | null
          plan_id?: string | null
          started_at?: string | null
          status?: string | null
          stripe_payment_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
