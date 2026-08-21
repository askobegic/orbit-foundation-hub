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
      ad_application_placements: {
        Row: {
          allowed_format_keys: string[]
          app_id: string
          created_at: string
          display_order: number
          enabled: boolean
          id: string
          last_delivery_at: string | null
          placement_key: string
          purchasable: boolean
          supported_devices: string[]
          updated_at: string
        }
        Insert: {
          allowed_format_keys?: string[]
          app_id: string
          created_at?: string
          display_order?: number
          enabled?: boolean
          id?: string
          last_delivery_at?: string | null
          placement_key: string
          purchasable?: boolean
          supported_devices?: string[]
          updated_at?: string
        }
        Update: {
          allowed_format_keys?: string[]
          app_id?: string
          created_at?: string
          display_order?: number
          enabled?: boolean
          id?: string
          last_delivery_at?: string | null
          placement_key?: string
          purchasable?: boolean
          supported_devices?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_application_placements_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_application_placements_placement_key_fkey"
            columns: ["placement_key"]
            isOneToOne: false
            referencedRelation: "ad_placements"
            referencedColumns: ["key"]
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
      ad_campaign_formats: {
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
      ad_campaign_targets: {
        Row: {
          campaign_id: string
          channel_id: string
          channel_price_id: string
          created_at: string
          expires_at: string | null
          external_reference: string | null
          id: string
          metrics: Json
          moderation_note: string | null
          placement_key: string | null
          starts_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          campaign_id: string
          channel_id: string
          channel_price_id: string
          created_at?: string
          expires_at?: string | null
          external_reference?: string | null
          id?: string
          metrics?: Json
          moderation_note?: string | null
          placement_key?: string | null
          starts_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          channel_id?: string
          channel_price_id?: string
          created_at?: string
          expires_at?: string | null
          external_reference?: string | null
          id?: string
          metrics?: Json
          moderation_note?: string | null
          placement_key?: string | null
          starts_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_campaign_targets_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "ad_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_campaign_targets_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "ad_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_campaign_targets_channel_price_id_fkey"
            columns: ["channel_price_id"]
            isOneToOne: false
            referencedRelation: "ad_channel_prices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_campaign_targets_placement_key_fkey"
            columns: ["placement_key"]
            isOneToOne: false
            referencedRelation: "ad_placements"
            referencedColumns: ["key"]
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
          impressions_delivered: number
          impressions_purchased: number | null
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
          impressions_delivered?: number
          impressions_purchased?: number | null
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
          impressions_delivered?: number
          impressions_purchased?: number | null
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
      ad_channel_apps: {
        Row: {
          app_id: string
          channel_id: string
          created_at: string
        }
        Insert: {
          app_id: string
          channel_id: string
          created_at?: string
        }
        Update: {
          app_id?: string
          channel_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_channel_apps_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_channel_apps_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "ad_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_channel_prices: {
        Row: {
          archived: boolean
          channel_id: string
          created_at: string
          currency: string
          display_order: number
          duration_days: number
          enabled: boolean
          id: string
          price: number
          pricing_strategy: string
          updated_at: string
        }
        Insert: {
          archived?: boolean
          channel_id: string
          created_at?: string
          currency?: string
          display_order?: number
          duration_days: number
          enabled?: boolean
          id?: string
          price: number
          pricing_strategy?: string
          updated_at?: string
        }
        Update: {
          archived?: boolean
          channel_id?: string
          created_at?: string
          currency?: string
          display_order?: number
          duration_days?: number
          enabled?: boolean
          id?: string
          price?: number
          pricing_strategy?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_channel_prices_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "ad_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_channel_prices_pricing_strategy_fkey"
            columns: ["pricing_strategy"]
            isOneToOne: false
            referencedRelation: "ad_pricing_strategies"
            referencedColumns: ["key"]
          },
        ]
      }
      ad_channel_types: {
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
      ad_channels: {
        Row: {
          allowed_format_keys: string[]
          allowed_media_types: string[]
          archived: boolean
          channel_type_key: string
          created_at: string
          description: string | null
          display_order: number
          enabled: boolean
          external_partner: string | null
          external_url: string | null
          id: string
          integration_id: string | null
          key: string
          logo_url: string | null
          max_duration_days: number | null
          max_file_size_bytes: number | null
          min_duration_days: number | null
          name: string
          notes: string | null
          purchasable: boolean
          represents_app_id: string | null
          updated_at: string
        }
        Insert: {
          allowed_format_keys?: string[]
          allowed_media_types?: string[]
          archived?: boolean
          channel_type_key: string
          created_at?: string
          description?: string | null
          display_order?: number
          enabled?: boolean
          external_partner?: string | null
          external_url?: string | null
          id?: string
          integration_id?: string | null
          key: string
          logo_url?: string | null
          max_duration_days?: number | null
          max_file_size_bytes?: number | null
          min_duration_days?: number | null
          name: string
          notes?: string | null
          purchasable?: boolean
          represents_app_id?: string | null
          updated_at?: string
        }
        Update: {
          allowed_format_keys?: string[]
          allowed_media_types?: string[]
          archived?: boolean
          channel_type_key?: string
          created_at?: string
          description?: string | null
          display_order?: number
          enabled?: boolean
          external_partner?: string | null
          external_url?: string | null
          id?: string
          integration_id?: string | null
          key?: string
          logo_url?: string | null
          max_duration_days?: number | null
          max_file_size_bytes?: number | null
          min_duration_days?: number | null
          name?: string
          notes?: string | null
          purchasable?: boolean
          represents_app_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_channels_channel_type_key_fkey"
            columns: ["channel_type_key"]
            isOneToOne: false
            referencedRelation: "ad_channel_types"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "ad_channels_represents_app_id_fkey"
            columns: ["represents_app_id"]
            isOneToOne: false
            referencedRelation: "applications"
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
          impressions_included: number | null
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
          impressions_included?: number | null
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
          impressions_included?: number | null
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
      affiliate_clicks: {
        Row: {
          clicked_at: string
          id: string
          link_id: string
        }
        Insert: {
          clicked_at?: string
          id?: string
          link_id: string
        }
        Update: {
          clicked_at?: string
          id?: string
          link_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_clicks_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "affiliate_links"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_config: {
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
      affiliate_conversions: {
        Row: {
          affiliate_user_id: string
          click_id: string | null
          commission_amount: number
          commission_fixed_amount: number | null
          commission_rate: number | null
          commission_type: string
          converted_user_id: string | null
          created_at: string
          currency: string
          eligible_amount: number
          id: string
          link_id: string | null
          offer_id: string
          payout_id: string | null
          return_period_days: number
          reversed_at: string | null
          reversed_conversion_id: string | null
          reversed_reason: string | null
          source_app_id: string | null
          status: string
          transaction_ref: string
        }
        Insert: {
          affiliate_user_id: string
          click_id?: string | null
          commission_amount: number
          commission_fixed_amount?: number | null
          commission_rate?: number | null
          commission_type: string
          converted_user_id?: string | null
          created_at?: string
          currency: string
          eligible_amount: number
          id?: string
          link_id?: string | null
          offer_id: string
          payout_id?: string | null
          return_period_days: number
          reversed_at?: string | null
          reversed_conversion_id?: string | null
          reversed_reason?: string | null
          source_app_id?: string | null
          status?: string
          transaction_ref: string
        }
        Update: {
          affiliate_user_id?: string
          click_id?: string | null
          commission_amount?: number
          commission_fixed_amount?: number | null
          commission_rate?: number | null
          commission_type?: string
          converted_user_id?: string | null
          created_at?: string
          currency?: string
          eligible_amount?: number
          id?: string
          link_id?: string | null
          offer_id?: string
          payout_id?: string | null
          return_period_days?: number
          reversed_at?: string | null
          reversed_conversion_id?: string | null
          reversed_reason?: string | null
          source_app_id?: string | null
          status?: string
          transaction_ref?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_conversions_affiliate_user_id_fkey"
            columns: ["affiliate_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_conversions_affiliate_user_id_fkey"
            columns: ["affiliate_user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_conversions_click_id_fkey"
            columns: ["click_id"]
            isOneToOne: false
            referencedRelation: "affiliate_clicks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_conversions_converted_user_id_fkey"
            columns: ["converted_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_conversions_converted_user_id_fkey"
            columns: ["converted_user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_conversions_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "affiliate_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_conversions_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "affiliate_offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_conversions_payout_id_fkey"
            columns: ["payout_id"]
            isOneToOne: false
            referencedRelation: "affiliate_payouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_conversions_reversed_conversion_id_fkey"
            columns: ["reversed_conversion_id"]
            isOneToOne: false
            referencedRelation: "affiliate_conversions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_conversions_source_app_id_fkey"
            columns: ["source_app_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_links: {
        Row: {
          affiliate_user_id: string
          code: string
          created_at: string
          id: string
          offer_id: string
        }
        Insert: {
          affiliate_user_id: string
          code: string
          created_at?: string
          id?: string
          offer_id: string
        }
        Update: {
          affiliate_user_id?: string
          code?: string
          created_at?: string
          id?: string
          offer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_links_affiliate_user_id_fkey"
            columns: ["affiliate_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_links_affiliate_user_id_fkey"
            columns: ["affiliate_user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_links_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "affiliate_offers"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_offers: {
        Row: {
          archived: boolean
          attribution_window_days: number | null
          commission_fixed_amount: number | null
          commission_rate: number | null
          commission_type: string
          created_at: string
          created_by: string | null
          currency: string
          description_bs: string | null
          description_de: string | null
          description_en: string | null
          destination_url: string
          display_order: number
          enabled: boolean
          id: string
          return_period_days: number | null
          source_app_id: string | null
          source_product_id: string
          source_product_type: string
          source_type: string
          title_bs: string
          title_de: string
          title_en: string
          updated_at: string
        }
        Insert: {
          archived?: boolean
          attribution_window_days?: number | null
          commission_fixed_amount?: number | null
          commission_rate?: number | null
          commission_type: string
          created_at?: string
          created_by?: string | null
          currency?: string
          description_bs?: string | null
          description_de?: string | null
          description_en?: string | null
          destination_url: string
          display_order?: number
          enabled?: boolean
          id?: string
          return_period_days?: number | null
          source_app_id?: string | null
          source_product_id: string
          source_product_type: string
          source_type: string
          title_bs: string
          title_de: string
          title_en: string
          updated_at?: string
        }
        Update: {
          archived?: boolean
          attribution_window_days?: number | null
          commission_fixed_amount?: number | null
          commission_rate?: number | null
          commission_type?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          description_bs?: string | null
          description_de?: string | null
          description_en?: string | null
          destination_url?: string
          display_order?: number
          enabled?: boolean
          id?: string
          return_period_days?: number | null
          source_app_id?: string | null
          source_product_id?: string
          source_product_type?: string
          source_type?: string
          title_bs?: string
          title_de?: string
          title_en?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_offers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_offers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_offers_source_app_id_fkey"
            columns: ["source_app_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_payouts: {
        Row: {
          affiliate_user_id: string
          amount: number
          created_at: string
          currency: string
          id: string
          notes: string | null
          paid_at: string | null
          payout_reference: string | null
          status: string
        }
        Insert: {
          affiliate_user_id: string
          amount: number
          created_at?: string
          currency?: string
          id?: string
          notes?: string | null
          paid_at?: string | null
          payout_reference?: string | null
          status?: string
        }
        Update: {
          affiliate_user_id?: string
          amount?: number
          created_at?: string
          currency?: string
          id?: string
          notes?: string | null
          paid_at?: string | null
          payout_reference?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_payouts_affiliate_user_id_fkey"
            columns: ["affiliate_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_payouts_affiliate_user_id_fkey"
            columns: ["affiliate_user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_pending_attributions: {
        Row: {
          affiliate_code: string
          created_at: string
          id: string
          source_product_id: string
          source_product_type: string
          user_id: string
        }
        Insert: {
          affiliate_code: string
          created_at?: string
          id?: string
          source_product_id: string
          source_product_type: string
          user_id: string
        }
        Update: {
          affiliate_code?: string
          created_at?: string
          id?: string
          source_product_id?: string
          source_product_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_pending_attributions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_pending_attributions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliates: {
        Row: {
          created_at: string
          payout_notes: string | null
          status: string
          suspended_reason: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          payout_notes?: string | null
          status?: string
          suspended_reason?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          payout_notes?: string | null
          status?: string
          suspended_reason?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliates_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliates_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
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
      application_pre_launch_content: {
        Row: {
          app_id: string
          banner_image_url: string | null
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          facebook_url: string | null
          info_text_bs: string | null
          info_text_de: string | null
          info_text_en: string | null
          instagram_url: string | null
          logo_url: string | null
          tiktok_url: string | null
          title_bs: string | null
          title_de: string | null
          title_en: string | null
          updated_at: string
          youtube_url: string | null
        }
        Insert: {
          app_id: string
          banner_image_url?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          facebook_url?: string | null
          info_text_bs?: string | null
          info_text_de?: string | null
          info_text_en?: string | null
          instagram_url?: string | null
          logo_url?: string | null
          tiktok_url?: string | null
          title_bs?: string | null
          title_de?: string | null
          title_en?: string | null
          updated_at?: string
          youtube_url?: string | null
        }
        Update: {
          app_id?: string
          banner_image_url?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          facebook_url?: string | null
          info_text_bs?: string | null
          info_text_de?: string | null
          info_text_en?: string | null
          instagram_url?: string | null
          logo_url?: string | null
          tiktok_url?: string | null
          title_bs?: string | null
          title_de?: string | null
          title_en?: string | null
          updated_at?: string
          youtube_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "application_pre_launch_content_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: true
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      application_test_users: {
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
            foreignKeyName: "application_test_users_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_test_users_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_test_users_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
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
          launch_status: string
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
          launch_status?: string
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
          launch_status?: string
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
          // null = GLOBAL rule (Priority 15 Phase A) -- see
          // 20260811100000_event_rules_global_scope.sql.
          app_id: string | null
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
          notify_category: string | null
          notify_message_bs: string | null
          notify_message_de: string | null
          notify_message_en: string | null
          notify_target_path: string | null
          notify_title_bs: string | null
          notify_title_de: string | null
          notify_title_en: string | null
          points: number
          priority: number
          repeatable: boolean
          updated_at: string
          weekly_limit: number | null
        }
        Insert: {
          app_id?: string | null
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
          notify_category?: string | null
          notify_message_bs?: string | null
          notify_message_de?: string | null
          notify_message_en?: string | null
          notify_target_path?: string | null
          notify_title_bs?: string | null
          notify_title_de?: string | null
          notify_title_en?: string | null
          points?: number
          priority?: number
          repeatable?: boolean
          updated_at?: string
          weekly_limit?: number | null
        }
        Update: {
          app_id?: string | null
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
          notify_category?: string | null
          notify_message_bs?: string | null
          notify_message_de?: string | null
          notify_message_en?: string | null
          notify_target_path?: string | null
          notify_title_bs?: string | null
          notify_title_de?: string | null
          notify_title_en?: string | null
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
      engagement_config: {
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
      engagement_conditions: {
        Row: {
          created_at: string
          definition_id: string
          display_order: number
          event_key: string
          id: string
          target: number
        }
        Insert: {
          created_at?: string
          definition_id: string
          display_order?: number
          event_key: string
          id?: string
          target: number
        }
        Update: {
          created_at?: string
          definition_id?: string
          display_order?: number
          event_key?: string
          id?: string
          target?: number
        }
        Relationships: [
          {
            foreignKeyName: "engagement_conditions_definition_id_fkey"
            columns: ["definition_id"]
            isOneToOne: false
            referencedRelation: "engagement_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_conditions_event_key_fkey"
            columns: ["event_key"]
            isOneToOne: false
            referencedRelation: "event_definitions"
            referencedColumns: ["event_key"]
          },
        ]
      }
      engagement_definitions: {
        Row: {
          app_id: string | null
          archived: boolean
          created_at: string
          description_bs: string | null
          description_de: string | null
          description_en: string | null
          display_order: number
          enabled: boolean
          ends_at: string | null
          id: string
          key: string
          kind: string
          name_bs: string
          name_de: string
          name_en: string
          reward_grant_type: string | null
          reward_grant_value: Json
          reward_lifetime_points: number
          reward_points: number
          starts_at: string | null
          updated_at: string
        }
        Insert: {
          app_id?: string | null
          archived?: boolean
          created_at?: string
          description_bs?: string | null
          description_de?: string | null
          description_en?: string | null
          display_order?: number
          enabled?: boolean
          ends_at?: string | null
          id?: string
          key: string
          kind: string
          name_bs: string
          name_de: string
          name_en: string
          reward_grant_type?: string | null
          reward_grant_value?: Json
          reward_lifetime_points?: number
          reward_points?: number
          starts_at?: string | null
          updated_at?: string
        }
        Update: {
          app_id?: string | null
          archived?: boolean
          created_at?: string
          description_bs?: string | null
          description_de?: string | null
          description_en?: string | null
          display_order?: number
          enabled?: boolean
          ends_at?: string | null
          id?: string
          key?: string
          kind?: string
          name_bs?: string
          name_de?: string
          name_en?: string
          reward_grant_type?: string | null
          reward_grant_value?: Json
          reward_lifetime_points?: number
          reward_points?: number
          starts_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "engagement_definitions_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_definitions_reward_grant_type_fkey"
            columns: ["reward_grant_type"]
            isOneToOne: false
            referencedRelation: "reward_fulfillment_types"
            referencedColumns: ["key"]
          },
        ]
      }
      streak_definitions: {
        Row: {
          app_id: string | null
          archived: boolean
          created_at: string
          description_bs: string | null
          description_de: string | null
          description_en: string | null
          display_order: number
          enabled: boolean
          event_key: string
          id: string
          key: string
          name_bs: string
          name_de: string
          name_en: string
          updated_at: string
        }
        Insert: {
          app_id?: string | null
          archived?: boolean
          created_at?: string
          description_bs?: string | null
          description_de?: string | null
          description_en?: string | null
          display_order?: number
          enabled?: boolean
          event_key: string
          id?: string
          key: string
          name_bs: string
          name_de: string
          name_en: string
          updated_at?: string
        }
        Update: {
          app_id?: string | null
          archived?: boolean
          created_at?: string
          description_bs?: string | null
          description_de?: string | null
          description_en?: string | null
          display_order?: number
          enabled?: boolean
          event_key?: string
          id?: string
          key?: string
          name_bs?: string
          name_de?: string
          name_en?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "streak_definitions_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "streak_definitions_event_key_fkey"
            columns: ["event_key"]
            isOneToOne: false
            referencedRelation: "event_definitions"
            referencedColumns: ["event_key"]
          },
        ]
      }
      streak_milestones: {
        Row: {
          created_at: string
          display_order: number
          id: string
          reward_grant_type: string | null
          reward_grant_value: Json
          reward_lifetime_points: number
          reward_points: number
          streak_definition_id: string
          threshold_days: number
        }
        Insert: {
          created_at?: string
          display_order?: number
          id?: string
          reward_grant_type?: string | null
          reward_grant_value?: Json
          reward_lifetime_points?: number
          reward_points?: number
          streak_definition_id: string
          threshold_days: number
        }
        Update: {
          created_at?: string
          display_order?: number
          id?: string
          reward_grant_type?: string | null
          reward_grant_value?: Json
          reward_lifetime_points?: number
          reward_points?: number
          streak_definition_id?: string
          threshold_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "streak_milestones_streak_definition_id_fkey"
            columns: ["streak_definition_id"]
            isOneToOne: false
            referencedRelation: "streak_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      user_engagement_completions: {
        Row: {
          completed_at: string
          created_at: string
          definition_id: string
          grant_result: Json | null
          id: string
          reward_ledger_id: string | null
          user_id: string
        }
        Insert: {
          completed_at?: string
          created_at?: string
          definition_id: string
          grant_result?: Json | null
          id?: string
          reward_ledger_id?: string | null
          user_id: string
        }
        Update: {
          completed_at?: string
          created_at?: string
          definition_id?: string
          grant_result?: Json | null
          id?: string
          reward_ledger_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_engagement_completions_definition_id_fkey"
            columns: ["definition_id"]
            isOneToOne: false
            referencedRelation: "engagement_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_engagement_completions_reward_ledger_id_fkey"
            columns: ["reward_ledger_id"]
            isOneToOne: false
            referencedRelation: "reward_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_engagement_completions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_streak_milestones: {
        Row: {
          achieved_at: string
          grant_result: Json | null
          id: string
          milestone_id: string
          reward_ledger_id: string | null
          user_id: string
        }
        Insert: {
          achieved_at?: string
          grant_result?: Json | null
          id?: string
          milestone_id: string
          reward_ledger_id?: string | null
          user_id: string
        }
        Update: {
          achieved_at?: string
          grant_result?: Json | null
          id?: string
          milestone_id?: string
          reward_ledger_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_streak_milestones_milestone_id_fkey"
            columns: ["milestone_id"]
            isOneToOne: false
            referencedRelation: "streak_milestones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_streak_milestones_reward_ledger_id_fkey"
            columns: ["reward_ledger_id"]
            isOneToOne: false
            referencedRelation: "reward_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_streak_milestones_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_streaks: {
        Row: {
          current_streak: number
          id: string
          last_qualifying_date: string | null
          longest_streak: number
          streak_definition_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          current_streak?: number
          id?: string
          last_qualifying_date?: string | null
          longest_streak?: number
          streak_definition_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          current_streak?: number
          id?: string
          last_qualifying_date?: string | null
          longest_streak?: number
          streak_definition_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_streaks_streak_definition_id_fkey"
            columns: ["streak_definition_id"]
            isOneToOne: false
            referencedRelation: "streak_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_streaks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      members_config: {
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
      support_messages: {
        Row: {
          body: string
          created_at: string
          id: string
          is_internal_note: boolean
          read_at: string | null
          sender_id: string
          sender_role: string
          ticket_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          is_internal_note?: boolean
          read_at?: string | null
          sender_id: string
          sender_role: string
          ticket_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          is_internal_note?: boolean
          read_at?: string | null
          sender_id?: string
          sender_role?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          app_id: string | null
          category: string | null
          created_at: string
          id: string
          priority: string
          status: string
          subject: string
          updated_at: string
          user_id: string
        }
        Insert: {
          app_id?: string | null
          category?: string | null
          created_at?: string
          id?: string
          priority?: string
          status?: string
          subject: string
          updated_at?: string
          user_id: string
        }
        Update: {
          app_id?: string | null
          category?: string | null
          created_at?: string
          id?: string
          priority?: string
          status?: string
          subject?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_user_id_fkey"
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
          category: string | null
          created_at: string | null
          dedupe_key: string | null
          email_error: string | null
          email_status: string
          id: string
          is_read: boolean | null
          message_bs: string | null
          message_de: string | null
          message_en: string | null
          read_at: string | null
          target_path: string | null
          title_bs: string | null
          title_de: string | null
          title_en: string | null
          type: string | null
          user_id: string | null
        }
        Insert: {
          app_id?: string | null
          category?: string | null
          created_at?: string | null
          dedupe_key?: string | null
          email_error?: string | null
          email_status?: string
          id?: string
          is_read?: boolean | null
          message_bs?: string | null
          message_de?: string | null
          message_en?: string | null
          read_at?: string | null
          target_path?: string | null
          title_bs?: string | null
          title_de?: string | null
          title_en?: string | null
          type?: string | null
          user_id?: string | null
        }
        Update: {
          app_id?: string | null
          category?: string | null
          created_at?: string | null
          dedupe_key?: string | null
          email_error?: string | null
          email_status?: string
          id?: string
          is_read?: boolean | null
          message_bs?: string | null
          message_de?: string | null
          message_en?: string | null
          read_at?: string | null
          target_path?: string | null
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
          points_package_id: string | null
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
          points_package_id?: string | null
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
          points_package_id?: string | null
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
            foreignKeyName: "payments_points_package_id_fkey"
            columns: ["points_package_id"]
            isOneToOne: false
            referencedRelation: "points_packages"
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
      points_packages: {
        Row: {
          app_id: string | null
          bonus_points: number
          created_at: string
          currency: string
          description: string | null
          display_order: number
          id: string
          is_active: boolean
          name: string
          paypal_payment_link: string | null
          points_amount: number
          price: number
          purchase_limit_per_user: number | null
          stripe_payment_link: string | null
          updated_at: string
          valid_from: string | null
          valid_until: string | null
        }
        Insert: {
          app_id?: string | null
          bonus_points?: number
          created_at?: string
          currency?: string
          description?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          name: string
          paypal_payment_link?: string | null
          points_amount: number
          price: number
          purchase_limit_per_user?: number | null
          stripe_payment_link?: string | null
          updated_at?: string
          valid_from?: string | null
          valid_until?: string | null
        }
        Update: {
          app_id?: string | null
          bonus_points?: number
          created_at?: string
          currency?: string
          description?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          name?: string
          paypal_payment_link?: string | null
          points_amount?: number
          price?: number
          purchase_limit_per_user?: number | null
          stripe_payment_link?: string | null
          updated_at?: string
          valid_from?: string | null
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "points_packages_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "applications"
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
          email_disabled_categories: string[]
          first_name: string | null
          id: string
          identity_locked_at: string | null
          is_active: boolean | null
          is_verified: boolean | null
          language: string | null
          last_active_at: string | null
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
          email_disabled_categories?: string[]
          first_name?: string | null
          id: string
          identity_locked_at?: string | null
          is_active?: boolean | null
          is_verified?: boolean | null
          language?: string | null
          last_active_at?: string | null
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
          email_disabled_categories?: string[]
          first_name?: string | null
          id?: string
          identity_locked_at?: string | null
          is_active?: boolean | null
          is_verified?: boolean | null
          language?: string | null
          last_active_at?: string | null
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
      resource_references: {
        Row: {
          app_id: string | null
          created_at: string
          destination: string | null
          id: string
          label: string
          resource_type: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          app_id?: string | null
          created_at?: string
          destination?: string | null
          id?: string
          label: string
          resource_type: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          app_id?: string | null
          created_at?: string
          destination?: string | null
          id?: string
          label?: string
          resource_type?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "resource_references_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resource_references_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resource_references_user_id_fkey"
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
          daily_limit: number | null
          display_order: number
          enabled: boolean
          id: string
          label: string
          max_per_user: number | null
          monthly_limit: number | null
          points: number
          points_per_euro: number | null
          updated_at: string
          weekly_limit: number | null
        }
        Insert: {
          action: string
          archived?: boolean
          cooldown_seconds?: number
          created_at?: string
          daily_limit?: number | null
          display_order?: number
          enabled?: boolean
          id?: string
          label: string
          max_per_user?: number | null
          monthly_limit?: number | null
          points?: number
          points_per_euro?: number | null
          updated_at?: string
          weekly_limit?: number | null
        }
        Update: {
          action?: string
          archived?: boolean
          cooldown_seconds?: number
          created_at?: string
          daily_limit?: number | null
          display_order?: number
          enabled?: boolean
          id?: string
          label?: string
          max_per_user?: number | null
          monthly_limit?: number | null
          points?: number
          points_per_euro?: number | null
          updated_at?: string
          weekly_limit?: number | null
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
      entitlement_sources: {
        Row: {
          archived: boolean
          created_at: string
          description: string | null
          display_order: number
          enabled: boolean
          key: string
          label: string
        }
        Insert: {
          archived?: boolean
          created_at?: string
          description?: string | null
          display_order?: number
          enabled?: boolean
          key: string
          label: string
        }
        Update: {
          archived?: boolean
          created_at?: string
          description?: string | null
          display_order?: number
          enabled?: boolean
          key?: string
          label?: string
        }
        Relationships: []
      }
      entitlements: {
        Row: {
          app_id: string | null
          benefit_type: string
          created_at: string
          ends_at: string | null
          granted_by: string | null
          id: string
          metadata: Json
          reason: string | null
          source: string
          starts_at: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          app_id?: string | null
          benefit_type: string
          created_at?: string
          ends_at?: string | null
          granted_by?: string | null
          id?: string
          metadata?: Json
          reason?: string | null
          source: string
          starts_at?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          app_id?: string | null
          benefit_type?: string
          created_at?: string
          ends_at?: string | null
          granted_by?: string | null
          id?: string
          metadata?: Json
          reason?: string | null
          source?: string
          starts_at?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entitlements_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entitlements_benefit_type_fkey"
            columns: ["benefit_type"]
            isOneToOne: false
            referencedRelation: "reward_fulfillment_types"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "entitlements_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entitlements_source_fkey"
            columns: ["source"]
            isOneToOne: false
            referencedRelation: "entitlement_sources"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "entitlements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      offer_segments: {
        Row: {
          archived: boolean
          created_at: string
          description: string | null
          display_order: number
          enabled: boolean
          key: string
          label: string
        }
        Insert: {
          archived?: boolean
          created_at?: string
          description?: string | null
          display_order?: number
          enabled?: boolean
          key: string
          label: string
        }
        Update: {
          archived?: boolean
          created_at?: string
          description?: string | null
          display_order?: number
          enabled?: boolean
          key?: string
          label?: string
        }
        Relationships: []
      }
      dashboard_actions: {
        Row: {
          action_type: string
          app_id: string | null
          archived: boolean
          created_at: string
          created_by: string | null
          cta_bs: string | null
          cta_de: string | null
          cta_en: string | null
          description_bs: string | null
          description_de: string | null
          description_en: string | null
          destination: string
          display_order: number
          enabled: boolean
          ends_at: string | null
          icon: string | null
          id: string
          requires_missing_resource_type: string | null
          starts_at: string | null
          target_segment: string | null
          target_type: string
          target_user_id: string | null
          title_bs: string
          title_de: string
          title_en: string
          updated_at: string
        }
        Insert: {
          action_type: string
          app_id?: string | null
          archived?: boolean
          created_at?: string
          created_by?: string | null
          cta_bs?: string | null
          cta_de?: string | null
          cta_en?: string | null
          description_bs?: string | null
          description_de?: string | null
          description_en?: string | null
          destination: string
          display_order?: number
          enabled?: boolean
          ends_at?: string | null
          icon?: string | null
          id?: string
          requires_missing_resource_type?: string | null
          starts_at?: string | null
          target_segment?: string | null
          target_type: string
          target_user_id?: string | null
          title_bs: string
          title_de: string
          title_en: string
          updated_at?: string
        }
        Update: {
          action_type?: string
          app_id?: string | null
          archived?: boolean
          created_at?: string
          created_by?: string | null
          cta_bs?: string | null
          cta_de?: string | null
          cta_en?: string | null
          description_bs?: string | null
          description_de?: string | null
          description_en?: string | null
          destination?: string
          display_order?: number
          enabled?: boolean
          ends_at?: string | null
          icon?: string | null
          id?: string
          requires_missing_resource_type?: string | null
          starts_at?: string | null
          target_segment?: string | null
          target_type?: string
          target_user_id?: string | null
          title_bs?: string
          title_de?: string
          title_en?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dashboard_actions_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dashboard_actions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dashboard_actions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dashboard_actions_target_segment_fkey"
            columns: ["target_segment"]
            isOneToOne: false
            referencedRelation: "offer_segments"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "dashboard_actions_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dashboard_actions_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      dashboard_offers: {
        Row: {
          archived: boolean
          badge_icon: string | null
          created_at: string
          created_by: string | null
          cta_bs: string | null
          cta_de: string | null
          cta_en: string | null
          description_bs: string | null
          description_de: string | null
          description_en: string | null
          discount_percent: number | null
          discount_type: string
          enabled: boolean
          ends_at: string
          fixed_price: number | null
          id: string
          offer_type: string
          priority: number
          product_id: string
          product_type: string
          starts_at: string
          target_segment: string | null
          target_user_id: string | null
          title_bs: string
          title_de: string
          title_en: string
          updated_at: string
        }
        Insert: {
          archived?: boolean
          badge_icon?: string | null
          created_at?: string
          created_by?: string | null
          cta_bs?: string | null
          cta_de?: string | null
          cta_en?: string | null
          description_bs?: string | null
          description_de?: string | null
          description_en?: string | null
          discount_percent?: number | null
          discount_type: string
          enabled?: boolean
          ends_at: string
          fixed_price?: number | null
          id?: string
          offer_type: string
          priority?: number
          product_id: string
          product_type: string
          starts_at: string
          target_segment?: string | null
          target_user_id?: string | null
          title_bs: string
          title_de: string
          title_en: string
          updated_at?: string
        }
        Update: {
          archived?: boolean
          badge_icon?: string | null
          created_at?: string
          created_by?: string | null
          cta_bs?: string | null
          cta_de?: string | null
          cta_en?: string | null
          description_bs?: string | null
          description_de?: string | null
          description_en?: string | null
          discount_percent?: number | null
          discount_type?: string
          enabled?: boolean
          ends_at?: string
          fixed_price?: number | null
          id?: string
          offer_type?: string
          priority?: number
          product_id?: string
          product_type?: string
          starts_at?: string
          target_segment?: string | null
          target_user_id?: string | null
          title_bs?: string
          title_de?: string
          title_en?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dashboard_offers_target_segment_fkey"
            columns: ["target_segment"]
            isOneToOne: false
            referencedRelation: "offer_segments"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "dashboard_offers_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      public_coupons: {
        Row: {
          archived: boolean
          code: string
          created_at: string
          created_by: string | null
          description_bs: string | null
          description_de: string | null
          description_en: string | null
          discount_percent: number | null
          discount_type: string
          display_label: string | null
          enabled: boolean
          ends_at: string
          fixed_price: number | null
          id: string
          is_public: boolean
          max_total_uses: number | null
          max_uses_per_user: number
          min_purchase: number | null
          product_id: string
          product_type: string
          starts_at: string
          title_bs: string
          title_de: string
          title_en: string
          updated_at: string
        }
        Insert: {
          archived?: boolean
          code: string
          created_at?: string
          created_by?: string | null
          description_bs?: string | null
          description_de?: string | null
          description_en?: string | null
          discount_percent?: number | null
          discount_type: string
          display_label?: string | null
          enabled?: boolean
          ends_at: string
          fixed_price?: number | null
          id?: string
          is_public?: boolean
          max_total_uses?: number | null
          max_uses_per_user?: number
          min_purchase?: number | null
          product_id: string
          product_type: string
          starts_at: string
          title_bs: string
          title_de: string
          title_en: string
          updated_at?: string
        }
        Update: {
          archived?: boolean
          code?: string
          created_at?: string
          created_by?: string | null
          description_bs?: string | null
          description_de?: string | null
          description_en?: string | null
          discount_percent?: number | null
          discount_type?: string
          display_label?: string | null
          enabled?: boolean
          ends_at?: string
          fixed_price?: number | null
          id?: string
          is_public?: boolean
          max_total_uses?: number | null
          max_uses_per_user?: number
          min_purchase?: number | null
          product_id?: string
          product_type?: string
          starts_at?: string
          title_bs?: string
          title_de?: string
          title_en?: string
          updated_at?: string
        }
        Relationships: []
      }
      coupon_redemptions: {
        Row: {
          coupon_id: string
          currency: string
          final_price: number
          id: string
          payment_id: string | null
          redeemed_at: string
          user_id: string
        }
        Insert: {
          coupon_id: string
          currency: string
          final_price: number
          id?: string
          payment_id?: string | null
          redeemed_at?: string
          user_id: string
        }
        Update: {
          coupon_id?: string
          currency?: string
          final_price?: number
          id?: string
          payment_id?: string | null
          redeemed_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coupon_redemptions_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "public_coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupon_redemptions_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupon_redemptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reward_boosts: {
        Row: {
          action: string
          archived: boolean
          created_at: string
          created_by: string | null
          enabled: boolean
          ends_at: string
          id: string
          multiplier: number
          starts_at: string
          updated_at: string
        }
        Insert: {
          action: string
          archived?: boolean
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          ends_at: string
          id?: string
          multiplier: number
          starts_at: string
          updated_at?: string
        }
        Update: {
          action?: string
          archived?: boolean
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          ends_at?: string
          id?: string
          multiplier?: number
          starts_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reward_boosts_action_fkey"
            columns: ["action"]
            isOneToOne: false
            referencedRelation: "reward_action_rules"
            referencedColumns: ["action"]
          },
        ]
      }
      reward_fulfillment_types: {
        Row: {
          archived: boolean
          created_at: string
          description: string | null
          display_order: number
          enabled: boolean
          grants_premium: boolean
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
          grants_premium?: boolean
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
          grants_premium?: boolean
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
      reward_milestones: {
        Row: {
          archived: boolean
          created_at: string
          display_order: number
          enabled: boolean
          grant_type: string
          grant_value: Json
          id: string
          key: string
          label: string
          min_lifetime_points: number
          min_successful_invites: number
          updated_at: string
        }
        Insert: {
          archived?: boolean
          created_at?: string
          display_order?: number
          enabled?: boolean
          grant_type: string
          grant_value?: Json
          id?: string
          key: string
          label: string
          min_lifetime_points: number
          min_successful_invites?: number
          updated_at?: string
        }
        Update: {
          archived?: boolean
          created_at?: string
          display_order?: number
          enabled?: boolean
          grant_type?: string
          grant_value?: Json
          id?: string
          key?: string
          label?: string
          min_lifetime_points?: number
          min_successful_invites?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reward_milestones_grant_type_fkey"
            columns: ["grant_type"]
            isOneToOne: false
            referencedRelation: "reward_fulfillment_types"
            referencedColumns: ["key"]
          },
        ]
      }
      user_reward_milestones: {
        Row: {
          achieved_at: string
          grant_result: Json | null
          id: string
          milestone_id: string
          user_id: string
        }
        Insert: {
          achieved_at?: string
          grant_result?: Json | null
          id?: string
          milestone_id: string
          user_id: string
        }
        Update: {
          achieved_at?: string
          grant_result?: Json | null
          id?: string
          milestone_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_reward_milestones_milestone_id_fkey"
            columns: ["milestone_id"]
            isOneToOne: false
            referencedRelation: "reward_milestones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_reward_milestones_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
          grants_benefit_key: string | null
          grants_premium: boolean
          id: string
          is_active: boolean | null
          name: string
          paypal_payment_link: string | null
          price: number
          product_type: string
          requires_benefit_key: string | null
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
          grants_benefit_key?: string | null
          grants_premium?: boolean
          id?: string
          is_active?: boolean | null
          name: string
          paypal_payment_link?: string | null
          price: number
          product_type?: string
          requires_benefit_key?: string | null
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
          grants_benefit_key?: string | null
          grants_premium?: boolean
          id?: string
          is_active?: boolean | null
          name?: string
          paypal_payment_link?: string | null
          price?: number
          product_type?: string
          requires_benefit_key?: string | null
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
          {
            foreignKeyName: "subscription_plans_grants_benefit_key_fkey"
            columns: ["grants_benefit_key"]
            isOneToOne: false
            referencedRelation: "reward_fulfillment_types"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "subscription_plans_requires_benefit_key_fkey"
            columns: ["requires_benefit_key"]
            isOneToOne: false
            referencedRelation: "reward_fulfillment_types"
            referencedColumns: ["key"]
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
      advance_user_streak: {
        Args: { p_activity_date: string; p_streak_definition_id: string; p_user_id: string }
        Returns: {
          changed: boolean
          current_streak: number
          longest_streak: number
        }[]
      }
      redeem_reward_atomic: {
        Args: {
          p_catalog_key: string
          p_grant_type: string
          p_grant_value: Json
          p_points_cost: number
          p_user_id: string
          p_verified_referrals: number
          p_verified_referrals_required: number
        }
        Returns: {
          error_code: string | null
          ok: boolean
          redemption_id: string | null
        }[]
      }
      redeem_coupon_atomic: {
        Args: {
          p_coupon_id: string
          p_currency: string
          p_final_price: number
          p_max_total_uses: number | null
          p_max_uses_per_user: number
          p_payment_id: string | null
          p_user_id: string
        }
        Returns: {
          error_code: string | null
          ok: boolean
          redemption_id: string | null
        }[]
      }
      record_ad_impression: {
        Args: { p_campaign_id: string }
        Returns: undefined
      }
      event_analytics_by_event: {
        Args: { _app_id: string; _since: string }
        Returns: {
          event_key: string
          execution_count: number
          total_points: number
        }[]
      }
      event_analytics_top_earners: {
        Args: { _app_id: string; _limit?: number; _since: string }
        Returns: {
          total_points: number
          user_id: string
        }[]
      }
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
