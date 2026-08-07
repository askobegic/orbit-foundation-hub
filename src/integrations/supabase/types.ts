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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      ad_account_credits: {
        Row: {
          amount: number
          created_at: string
          currency: string
          id: string
          source: string
          source_id: string | null
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          id?: string
          source: string
          source_id?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          id?: string
          source?: string
          source_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_account_credits_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_account_credits_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_application_settings: {
        Row: {
          app_id: string
          created_at: string
          eligibility_rule: string | null
          id: string
          moderation_mode: string | null
          updated_at: string
        }
        Insert: {
          app_id: string
          created_at?: string
          eligibility_rule?: string | null
          id?: string
          moderation_mode?: string | null
          updated_at?: string
        }
        Update: {
          app_id?: string
          created_at?: string
          eligibility_rule?: string | null
          id?: string
          moderation_mode?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_application_settings_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: true
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_campaigns: {
        Row: {
          app_id: string
          created_at: string
          expires_at: string | null
          id: string
          image_url: string | null
          link_url: string | null
          moderation_note: string | null
          placement_key: string
          placement_price_id: string | null
          starts_at: string | null
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          app_id: string
          created_at?: string
          expires_at?: string | null
          id?: string
          image_url?: string | null
          link_url?: string | null
          moderation_note?: string | null
          placement_key: string
          placement_price_id?: string | null
          starts_at?: string | null
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          app_id?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          image_url?: string | null
          link_url?: string | null
          moderation_note?: string | null
          placement_key?: string
          placement_price_id?: string | null
          starts_at?: string | null
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_campaigns_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_campaigns_placement_key_fkey"
            columns: ["placement_key"]
            isOneToOne: false
            referencedRelation: "ad_placements"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "ad_campaigns_placement_price_id_fkey"
            columns: ["placement_price_id"]
            isOneToOne: false
            referencedRelation: "ad_placement_prices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_campaigns_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_campaigns_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_config: {
        Row: {
          description: string | null
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      ad_placement_prices: {
        Row: {
          app_id: string | null
          archived: boolean
          created_at: string
          currency: string
          display_order: number
          duration_days: number
          enabled: boolean
          id: string
          paypal_payment_link: string | null
          placement_key: string
          price: number
          pricing_strategy: string
          stripe_payment_link: string | null
          updated_at: string
        }
        Insert: {
          app_id?: string | null
          archived?: boolean
          created_at?: string
          currency?: string
          display_order?: number
          duration_days: number
          enabled?: boolean
          id?: string
          paypal_payment_link?: string | null
          placement_key: string
          price: number
          pricing_strategy?: string
          stripe_payment_link?: string | null
          updated_at?: string
        }
        Update: {
          app_id?: string | null
          archived?: boolean
          created_at?: string
          currency?: string
          display_order?: number
          duration_days?: number
          enabled?: boolean
          id?: string
          paypal_payment_link?: string | null
          placement_key?: string
          price?: number
          pricing_strategy?: string
          stripe_payment_link?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_placement_prices_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_placement_prices_placement_key_fkey"
            columns: ["placement_key"]
            isOneToOne: false
            referencedRelation: "ad_placements"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "ad_placement_prices_pricing_strategy_fkey"
            columns: ["pricing_strategy"]
            isOneToOne: false
            referencedRelation: "ad_pricing_strategies"
            referencedColumns: ["key"]
          },
        ]
      }
      ad_placements: {
        Row: {
          archived: boolean
          created_at: string
          description: string | null
          display_order: number
          enabled: boolean
          id: string
          key: string
          label: string
          updated_at: string
        }
        Insert: {
          archived?: boolean
          created_at?: string
          description?: string | null
          display_order?: number
          enabled?: boolean
          id?: string
          key: string
          label: string
          updated_at?: string
        }
        Update: {
          archived?: boolean
          created_at?: string
          description?: string | null
          display_order?: number
          enabled?: boolean
          id?: string
          key?: string
          label?: string
          updated_at?: string
        }
        Relationships: []
      }
      ad_pricing_strategies: {
        Row: {
          archived: boolean
          created_at: string
          description: string | null
          display_order: number
          enabled: boolean
          id: string
          key: string
          label: string
          updated_at: string
        }
        Insert: {
          archived?: boolean
          created_at?: string
          description?: string | null
          display_order?: number
          enabled?: boolean
          id?: string
          key: string
          label: string
          updated_at?: string
        }
        Update: {
          archived?: boolean
          created_at?: string
          description?: string | null
          display_order?: number
          enabled?: boolean
          id?: string
          key?: string
          label?: string
          updated_at?: string
        }
        Relationships: []
      }
      ad_trusted_advertisers: {
        Row: {
          app_id: string
          granted_at: string
          granted_by: string | null
          user_id: string
        }
        Insert: {
          app_id: string
          granted_at?: string
          granted_by?: string | null
          user_id: string
        }
        Update: {
          app_id?: string
          granted_at?: string
          granted_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_trusted_advertisers_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_trusted_advertisers_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_trusted_advertisers_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_trusted_advertisers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_trusted_advertisers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      application_capabilities: {
        Row: {
          app_id: string
          capability_key: string
          created_at: string
          enabled: boolean
          id: string
          updated_at: string
        }
        Insert: {
          app_id: string
          capability_key: string
          created_at?: string
          enabled?: boolean
          id?: string
          updated_at?: string
        }
        Update: {
          app_id?: string
          capability_key?: string
          created_at?: string
          enabled?: boolean
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_capabilities_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_capabilities_capability_key_fkey"
            columns: ["capability_key"]
            isOneToOne: false
            referencedRelation: "capability_definitions"
            referencedColumns: ["key"]
          },
        ]
      }
      application_events: {
        Row: {
          app_id: string
          created_at: string
          enabled: boolean
          event_key: string
          id: string
          updated_at: string
        }
        Insert: {
          app_id: string
          created_at?: string
          enabled?: boolean
          event_key: string
          id?: string
          updated_at?: string
        }
        Update: {
          app_id?: string
          created_at?: string
          enabled?: boolean
          event_key?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_events_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_events_event_key_fkey"
            columns: ["event_key"]
            isOneToOne: false
            referencedRelation: "event_definitions"
            referencedColumns: ["event_key"]
          },
        ]
      }
      applications: {
        Row: {
          cover_image_url: string | null
          created_at: string | null
          default_language: string | null
          domain: string | null
          favicon_url: string | null
          google_client_id: string | null
          id: string
          launch_date: string | null
          logo_url: string | null
          name: string
          primary_color: string | null
          secondary_color: string | null
          short_description_bs: string | null
          short_description_de: string | null
          short_description_en: string | null
          slug: string
          sort_order: number | null
          updated_at: string | null
          visibility: string
        }
        Insert: {
          cover_image_url?: string | null
          created_at?: string | null
          default_language?: string | null
          domain?: string | null
          favicon_url?: string | null
          google_client_id?: string | null
          id?: string
          launch_date?: string | null
          logo_url?: string | null
          name: string
          primary_color?: string | null
          secondary_color?: string | null
          short_description_bs?: string | null
          short_description_de?: string | null
          short_description_en?: string | null
          slug: string
          sort_order?: number | null
          updated_at?: string | null
          visibility?: string
        }
        Update: {
          cover_image_url?: string | null
          created_at?: string | null
          default_language?: string | null
          domain?: string | null
          favicon_url?: string | null
          google_client_id?: string | null
          id?: string
          launch_date?: string | null
          logo_url?: string | null
          name?: string
          primary_color?: string | null
          secondary_color?: string | null
          short_description_bs?: string | null
          short_description_de?: string | null
          short_description_en?: string | null
          slug?: string
          sort_order?: number | null
          updated_at?: string | null
          visibility?: string
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
          reason: string | null
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
          reason?: string | null
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
          reason?: string | null
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
          {
            foreignKeyName: "audit_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      capability_definitions: {
        Row: {
          archived: boolean
          created_at: string
          description: string | null
          display_order: number
          enabled: boolean
          id: string
          key: string
          label: string
          updated_at: string
        }
        Insert: {
          archived?: boolean
          created_at?: string
          description?: string | null
          display_order?: number
          enabled?: boolean
          id?: string
          key: string
          label: string
          updated_at?: string
        }
        Update: {
          archived?: boolean
          created_at?: string
          description?: string | null
          display_order?: number
          enabled?: boolean
          id?: string
          key?: string
          label?: string
          updated_at?: string
        }
        Relationships: []
      }
      conversations: {
        Row: {
          created_at: string
          hidden_by_a_at: string | null
          hidden_by_b_at: string | null
          id: string
          last_message_at: string | null
          user_a_id: string
          user_b_id: string
        }
        Insert: {
          created_at?: string
          hidden_by_a_at?: string | null
          hidden_by_b_at?: string | null
          id?: string
          last_message_at?: string | null
          user_a_id: string
          user_b_id: string
        }
        Update: {
          created_at?: string
          hidden_by_a_at?: string | null
          hidden_by_b_at?: string | null
          id?: string
          last_message_at?: string | null
          user_a_id?: string
          user_b_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_user_a_id_fkey"
            columns: ["user_a_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_user_a_id_fkey"
            columns: ["user_a_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_user_b_id_fkey"
            columns: ["user_b_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_user_b_id_fkey"
            columns: ["user_b_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      dashboard_widget_settings: {
        Row: {
          app_id: string
          created_at: string
          enabled: boolean
          id: string
          updated_at: string
          widget_key: string
        }
        Insert: {
          app_id: string
          created_at?: string
          enabled: boolean
          id?: string
          updated_at?: string
          widget_key: string
        }
        Update: {
          app_id?: string
          created_at?: string
          enabled?: boolean
          id?: string
          updated_at?: string
          widget_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "dashboard_widget_settings_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dashboard_widget_settings_widget_key_fkey"
            columns: ["widget_key"]
            isOneToOne: false
            referencedRelation: "dashboard_widgets"
            referencedColumns: ["key"]
          },
        ]
      }
      dashboard_widgets: {
        Row: {
          archived: boolean
          created_at: string
          description: string | null
          display_order: number
          enabled: boolean
          id: string
          key: string
          label: string
          requires_capability: string | null
          updated_at: string
        }
        Insert: {
          archived?: boolean
          created_at?: string
          description?: string | null
          display_order?: number
          enabled?: boolean
          id?: string
          key: string
          label: string
          requires_capability?: string | null
          updated_at?: string
        }
        Update: {
          archived?: boolean
          created_at?: string
          description?: string | null
          display_order?: number
          enabled?: boolean
          id?: string
          key?: string
          label?: string
          requires_capability?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dashboard_widgets_requires_capability_fkey"
            columns: ["requires_capability"]
            isOneToOne: false
            referencedRelation: "capability_definitions"
            referencedColumns: ["key"]
          },
        ]
      }
      event_abuse_flags: {
        Row: {
          app_id: string | null
          created_at: string
          event_key: string | null
          id: string
          metadata: Json
          reason: string
          reviewed: boolean
          reviewed_at: string | null
          reviewed_by: string | null
          user_id: string
        }
        Insert: {
          app_id?: string | null
          created_at?: string
          event_key?: string | null
          id?: string
          metadata?: Json
          reason: string
          reviewed?: boolean
          reviewed_at?: string | null
          reviewed_by?: string | null
          user_id: string
        }
        Update: {
          app_id?: string | null
          created_at?: string
          event_key?: string | null
          id?: string
          metadata?: Json
          reason?: string
          reviewed?: boolean
          reviewed_at?: string | null
          reviewed_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_abuse_flags_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_abuse_flags_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_abuse_flags_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_abuse_flags_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_abuse_flags_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      event_definitions: {
        Row: {
          archived: boolean
          category: string | null
          created_at: string
          description: string | null
          display_name: string
          display_order: number
          enabled: boolean
          event_key: string
          icon: string | null
          id: string
          is_system: boolean
          updated_at: string
          version: number
        }
        Insert: {
          archived?: boolean
          category?: string | null
          created_at?: string
          description?: string | null
          display_name: string
          display_order?: number
          enabled?: boolean
          event_key: string
          icon?: string | null
          id?: string
          is_system?: boolean
          updated_at?: string
          version?: number
        }
        Update: {
          archived?: boolean
          category?: string | null
          created_at?: string
          description?: string | null
          display_name?: string
          display_order?: number
          enabled?: boolean
          event_key?: string
          icon?: string | null
          id?: string
          is_system?: boolean
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      event_rule_conditions: {
        Row: {
          condition_type: string
          created_at: string
          display_order: number
          id: string
          params: Json
          rule_id: string
        }
        Insert: {
          condition_type: string
          created_at?: string
          display_order?: number
          id?: string
          params?: Json
          rule_id: string
        }
        Update: {
          condition_type?: string
          created_at?: string
          display_order?: number
          id?: string
          params?: Json
          rule_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_rule_conditions_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "event_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      event_rules: {
        Row: {
          app_id: string
          archived: boolean
          cooldown_seconds: number
          created_at: string
          daily_limit: number | null
          display_order: number
          enabled: boolean
          event_key: string
          id: string
          lifetime_points: number
          max_executions: number | null
          monthly_limit: number | null
          points: number
          priority: number
          repeatable: boolean
          updated_at: string
          weekly_limit: number | null
        }
        Insert: {
          app_id: string
          archived?: boolean
          cooldown_seconds?: number
          created_at?: string
          daily_limit?: number | null
          display_order?: number
          enabled?: boolean
          event_key: string
          id?: string
          lifetime_points?: number
          max_executions?: number | null
          monthly_limit?: number | null
          points?: number
          priority?: number
          repeatable?: boolean
          updated_at?: string
          weekly_limit?: number | null
        }
        Update: {
          app_id?: string
          archived?: boolean
          cooldown_seconds?: number
          created_at?: string
          daily_limit?: number | null
          display_order?: number
          enabled?: boolean
          event_key?: string
          id?: string
          lifetime_points?: number
          max_executions?: number | null
          monthly_limit?: number | null
          points?: number
          priority?: number
          repeatable?: boolean
          updated_at?: string
          weekly_limit?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "event_rules_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_rules_event_key_fkey"
            columns: ["event_key"]
            isOneToOne: false
            referencedRelation: "event_definitions"
            referencedColumns: ["event_key"]
          },
        ]
      }
      messages: {
        Row: {
          body: string
          conversation_id: string
          created_at: string
          id: string
          read_at: string | null
          sender_id: string
        }
        Insert: {
          body: string
          conversation_id: string
          created_at?: string
          id?: string
          read_at?: string | null
          sender_id: string
        }
        Update: {
          body?: string
          conversation_id?: string
          created_at?: string
          id?: string
          read_at?: string | null
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
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
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          app_id: string | null
          campaign_id: string | null
          created_at: string | null
          currency: string | null
          id: string
          invoice_url: string | null
          payment_method: string | null
          paypal_payment_id: string | null
          status: string | null
          stripe_payment_id: string | null
          stripe_payment_intent_id: string | null
          subscription_id: string | null
          user_id: string | null
        }
        Insert: {
          amount: number
          app_id?: string | null
          campaign_id?: string | null
          created_at?: string | null
          currency?: string | null
          id?: string
          invoice_url?: string | null
          payment_method?: string | null
          paypal_payment_id?: string | null
          status?: string | null
          stripe_payment_id?: string | null
          stripe_payment_intent_id?: string | null
          subscription_id?: string | null
          user_id?: string | null
        }
        Update: {
          amount?: number
          app_id?: string | null
          campaign_id?: string | null
          created_at?: string | null
          currency?: string | null
          id?: string
          invoice_url?: string | null
          payment_method?: string | null
          paypal_payment_id?: string | null
          status?: string | null
          stripe_payment_id?: string | null
          stripe_payment_intent_id?: string | null
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
            foreignKeyName: "payments_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "ad_campaigns"
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
          {
            foreignKeyName: "payments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
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
          {
            foreignKeyName: "premium_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      premium_referrals: {
        Row: {
          created_at: string
          id: string
          referred_user_id: string
          referrer_id: string
          subscription_id: string | null
          verification_due_at: string
          verified_at: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          referred_user_id: string
          referrer_id: string
          subscription_id?: string | null
          verification_due_at: string
          verified_at?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          referred_user_id?: string
          referrer_id?: string
          subscription_id?: string | null
          verification_due_at?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "premium_referrals_referred_user_id_fkey"
            columns: ["referred_user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "premium_referrals_referred_user_id_fkey"
            columns: ["referred_user_id"]
            isOneToOne: true
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "premium_referrals_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "premium_referrals_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "premium_referrals_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
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
          identity_locked_at: string | null
          is_active: boolean | null
          is_verified: boolean | null
          language: string | null
          last_name: string | null
          notify_email: boolean
          notify_in_app: boolean
          notify_marketing: boolean
          profile_complete: boolean | null
          referred_by_user_id: string | null
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
          identity_locked_at?: string | null
          is_active?: boolean | null
          is_verified?: boolean | null
          language?: string | null
          last_name?: string | null
          notify_email?: boolean
          notify_in_app?: boolean
          notify_marketing?: boolean
          profile_complete?: boolean | null
          referred_by_user_id?: string | null
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
          identity_locked_at?: string | null
          is_active?: boolean | null
          is_verified?: boolean | null
          language?: string | null
          last_name?: string | null
          notify_email?: boolean
          notify_in_app?: boolean
          notify_marketing?: boolean
          profile_complete?: boolean | null
          referred_by_user_id?: string | null
          updated_at?: string | null
          user_type?: string | null
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_referred_by_user_id_fkey"
            columns: ["referred_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_referred_by_user_id_fkey"
            columns: ["referred_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      promotional_trials: {
        Row: {
          created_at: string
          ended_at: string | null
          expires_at: string
          granted_by: string | null
          id: string
          reason: string | null
          source: string
          source_reference: string | null
          starts_at: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          ended_at?: string | null
          expires_at: string
          granted_by?: string | null
          id?: string
          reason?: string | null
          source: string
          source_reference?: string | null
          starts_at?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          ended_at?: string | null
          expires_at?: string
          granted_by?: string | null
          id?: string
          reason?: string | null
          source?: string
          source_reference?: string | null
          starts_at?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "promotional_trials_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotional_trials_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotional_trials_source_fkey"
            columns: ["source"]
            isOneToOne: false
            referencedRelation: "trial_sources"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "promotional_trials_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotional_trials_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      reward_achievements: {
        Row: {
          archived: boolean
          created_at: string
          description: string | null
          display_order: number
          enabled: boolean
          id: string
          key: string
          label: string
          trigger_action: string | null
          trigger_count: number
          updated_at: string
        }
        Insert: {
          archived?: boolean
          created_at?: string
          description?: string | null
          display_order?: number
          enabled?: boolean
          id?: string
          key: string
          label: string
          trigger_action?: string | null
          trigger_count?: number
          updated_at?: string
        }
        Update: {
          archived?: boolean
          created_at?: string
          description?: string | null
          display_order?: number
          enabled?: boolean
          id?: string
          key?: string
          label?: string
          trigger_action?: string | null
          trigger_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reward_achievements_trigger_action_fkey"
            columns: ["trigger_action"]
            isOneToOne: false
            referencedRelation: "reward_action_rules"
            referencedColumns: ["action"]
          },
        ]
      }
      reward_action_rules: {
        Row: {
          action: string
          archived: boolean
          cooldown_seconds: number
          created_at: string
          display_order: number
          enabled: boolean
          id: string
          label: string
          max_per_user: number | null
          points: number
          updated_at: string
        }
        Insert: {
          action: string
          archived?: boolean
          cooldown_seconds?: number
          created_at?: string
          display_order?: number
          enabled?: boolean
          id?: string
          label: string
          max_per_user?: number | null
          points?: number
          updated_at?: string
        }
        Update: {
          action?: string
          archived?: boolean
          cooldown_seconds?: number
          created_at?: string
          display_order?: number
          enabled?: boolean
          id?: string
          label?: string
          max_per_user?: number | null
          points?: number
          updated_at?: string
        }
        Relationships: []
      }
      reward_catalog: {
        Row: {
          archived: boolean
          created_at: string
          description: string | null
          display_order: number
          enabled: boolean
          grant_type: string
          grant_value: Json
          id: string
          key: string
          label: string
          points_cost: number
          requires_capability: string | null
          updated_at: string
          verified_referrals_required: number
        }
        Insert: {
          archived?: boolean
          created_at?: string
          description?: string | null
          display_order?: number
          enabled?: boolean
          grant_type: string
          grant_value?: Json
          id?: string
          key: string
          label: string
          points_cost: number
          requires_capability?: string | null
          updated_at?: string
          verified_referrals_required?: number
        }
        Update: {
          archived?: boolean
          created_at?: string
          description?: string | null
          display_order?: number
          enabled?: boolean
          grant_type?: string
          grant_value?: Json
          id?: string
          key?: string
          label?: string
          points_cost?: number
          requires_capability?: string | null
          updated_at?: string
          verified_referrals_required?: number
        }
        Relationships: [
          {
            foreignKeyName: "reward_catalog_grant_type_fkey"
            columns: ["grant_type"]
            isOneToOne: false
            referencedRelation: "reward_fulfillment_types"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "reward_catalog_requires_capability_fkey"
            columns: ["requires_capability"]
            isOneToOne: false
            referencedRelation: "capability_definitions"
            referencedColumns: ["key"]
          },
        ]
      }
      reward_config: {
        Row: {
          description: string | null
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      reward_fulfillment_types: {
        Row: {
          archived: boolean
          created_at: string
          description: string | null
          display_order: number
          enabled: boolean
          id: string
          key: string
          label: string
          updated_at: string
        }
        Insert: {
          archived?: boolean
          created_at?: string
          description?: string | null
          display_order?: number
          enabled?: boolean
          id?: string
          key: string
          label: string
          updated_at?: string
        }
        Update: {
          archived?: boolean
          created_at?: string
          description?: string | null
          display_order?: number
          enabled?: boolean
          id?: string
          key?: string
          label?: string
          updated_at?: string
        }
        Relationships: []
      }
      reward_ledger: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          dedupe_key: string | null
          id: string
          lifetime_points: number
          metadata: Json
          origin: string
          points: number
          resource_id: string | null
          resource_type: string | null
          source_app_id: string | null
          user_id: string
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          dedupe_key?: string | null
          id?: string
          lifetime_points?: number
          metadata?: Json
          origin?: string
          points: number
          resource_id?: string | null
          resource_type?: string | null
          source_app_id?: string | null
          user_id: string
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          dedupe_key?: string | null
          id?: string
          lifetime_points?: number
          metadata?: Json
          origin?: string
          points?: number
          resource_id?: string | null
          resource_type?: string | null
          source_app_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reward_ledger_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reward_ledger_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reward_ledger_source_app_id_fkey"
            columns: ["source_app_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reward_ledger_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reward_ledger_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      reward_levels: {
        Row: {
          archived: boolean
          created_at: string
          display_order: number
          enabled: boolean
          id: string
          key: string
          label: string
          min_lifetime_points: number
          updated_at: string
        }
        Insert: {
          archived?: boolean
          created_at?: string
          display_order?: number
          enabled?: boolean
          id?: string
          key: string
          label: string
          min_lifetime_points?: number
          updated_at?: string
        }
        Update: {
          archived?: boolean
          created_at?: string
          display_order?: number
          enabled?: boolean
          id?: string
          key?: string
          label?: string
          min_lifetime_points?: number
          updated_at?: string
        }
        Relationships: []
      }
      reward_redemptions: {
        Row: {
          catalog_key: string
          created_at: string
          grant_result: Json | null
          id: string
          points_spent: number
          user_id: string
          verified_referrals_at_redemption: number
        }
        Insert: {
          catalog_key: string
          created_at?: string
          grant_result?: Json | null
          id?: string
          points_spent: number
          user_id: string
          verified_referrals_at_redemption: number
        }
        Update: {
          catalog_key?: string
          created_at?: string
          grant_result?: Json | null
          id?: string
          points_spent?: number
          user_id?: string
          verified_referrals_at_redemption?: number
        }
        Relationships: [
          {
            foreignKeyName: "reward_redemptions_catalog_key_fkey"
            columns: ["catalog_key"]
            isOneToOne: false
            referencedRelation: "reward_catalog"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "reward_redemptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reward_redemptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      share_invite_templates: {
        Row: {
          app_id: string
          created_at: string
          id: string
          invite_template: string | null
          share_description: string | null
          share_title: string | null
          share_url: string | null
          updated_at: string
        }
        Insert: {
          app_id: string
          created_at?: string
          id?: string
          invite_template?: string | null
          share_description?: string | null
          share_title?: string | null
          share_url?: string | null
          updated_at?: string
        }
        Update: {
          app_id?: string
          created_at?: string
          id?: string
          invite_template?: string | null
          share_description?: string | null
          share_title?: string | null
          share_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "share_invite_templates_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: true
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
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
          product_type: string
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
          product_type?: string
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
          product_type?: string
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
          {
            foreignKeyName: "subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      trial_policy: {
        Row: {
          description: string | null
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      trial_sources: {
        Row: {
          archived: boolean
          created_at: string
          description: string | null
          display_order: number
          enabled: boolean
          id: string
          key: string
          label: string
          updated_at: string
        }
        Insert: {
          archived?: boolean
          created_at?: string
          description?: string | null
          display_order?: number
          enabled?: boolean
          id?: string
          key: string
          label: string
          updated_at?: string
        }
        Update: {
          archived?: boolean
          created_at?: string
          description?: string | null
          display_order?: number
          enabled?: boolean
          id?: string
          key?: string
          label?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_achievements: {
        Row: {
          achievement_key: string
          earned_at: string
          id: string
          user_id: string
        }
        Insert: {
          achievement_key: string
          earned_at?: string
          id?: string
          user_id: string
        }
        Update: {
          achievement_key?: string
          earned_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_achievements_achievement_key_fkey"
            columns: ["achievement_key"]
            isOneToOne: false
            referencedRelation: "reward_achievements"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "user_achievements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_achievements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      user_app_settings: {
        Row: {
          app_id: string
          id: string
          is_contactable: boolean
          is_visible: boolean
          joined_at: string
          user_id: string
        }
        Insert: {
          app_id: string
          id?: string
          is_contactable?: boolean
          is_visible?: boolean
          joined_at?: string
          user_id: string
        }
        Update: {
          app_id?: string
          id?: string
          is_contactable?: boolean
          is_visible?: boolean
          joined_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_app_settings_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_app_settings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_app_settings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          role?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      v1_refresh_tokens: {
        Row: {
          app_id: string
          created_at: string
          expires_at: string
          id: string
          replaced_by: string | null
          revoked_at: string | null
          token_hash: string
          user_id: string
        }
        Insert: {
          app_id: string
          created_at?: string
          expires_at: string
          id?: string
          replaced_by?: string | null
          revoked_at?: string | null
          token_hash: string
          user_id: string
        }
        Update: {
          app_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          replaced_by?: string | null
          revoked_at?: string | null
          token_hash?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "v1_refresh_tokens_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "v1_refresh_tokens_replaced_by_fkey"
            columns: ["replaced_by"]
            isOneToOne: false
            referencedRelation: "v1_refresh_tokens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "v1_refresh_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "v1_refresh_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      premium_profiles_public: {
        Row: {
          contact_email: string | null
          contact_email_public: boolean | null
          created_at: string | null
          facebook_url: string | null
          id: string | null
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
          contact_email?: never
          contact_email_public?: boolean | null
          created_at?: string | null
          facebook_url?: string | null
          id?: string | null
          instagram_url?: string | null
          linkedin_url?: string | null
          phone?: never
          phone_public?: boolean | null
          primary_profession?: string | null
          secondary_professions?: string[] | null
          tiktok_url?: string | null
          updated_at?: string | null
          user_id?: string | null
          website?: never
          website_public?: boolean | null
          whatsapp?: never
          whatsapp_public?: boolean | null
          x_url?: string | null
          youtube_url?: string | null
        }
        Update: {
          contact_email?: never
          contact_email_public?: boolean | null
          created_at?: string | null
          facebook_url?: string | null
          id?: string | null
          instagram_url?: string | null
          linkedin_url?: string | null
          phone?: never
          phone_public?: boolean | null
          primary_profession?: string | null
          secondary_professions?: string[] | null
          tiktok_url?: string | null
          updated_at?: string | null
          user_id?: string | null
          website?: never
          website_public?: boolean | null
          whatsapp?: never
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
          {
            foreignKeyName: "premium_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles_public: {
        Row: {
          avatar_url: string | null
          bio: string | null
          city: string | null
          country: string | null
          created_at: string | null
          first_name: string | null
          id: string | null
          is_active: boolean | null
          is_verified: boolean | null
          language: string | null
          last_name: string | null
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
          first_name?: string | null
          id?: string | null
          is_active?: boolean | null
          is_verified?: boolean | null
          language?: string | null
          last_name?: string | null
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
          first_name?: string | null
          id?: string | null
          is_active?: boolean | null
          is_verified?: boolean | null
          language?: string | null
          last_name?: string | null
          updated_at?: string | null
          user_type?: string | null
          username?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      get_premium_application_ids: {
        Args: { _user_id: string }
        Returns: string[]
      }
      get_visible_application_ids: {
        Args: { _user_id: string }
        Returns: string[]
      }
      has_any_active_premium: { Args: { _user_id: string }; Returns: boolean }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
