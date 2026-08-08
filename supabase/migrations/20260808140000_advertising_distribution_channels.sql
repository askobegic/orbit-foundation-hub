-- Priority 13, Phase C: Universal Advertising Distribution Network.
--
-- Purely additive extension of the existing Advertising module (Priority
-- 8.4). Nothing here renames, drops, or narrows any existing table/column --
-- ad_placements/ad_placement_prices/ad_campaigns keep working exactly as
-- today; the existing single-app banner-placement purchase remains the
-- primary, unaffected product.
--
-- This phase only builds the admin-managed *registry* of distribution
-- channels (application / external website / social media / future types)
-- -- no pricing, no campaign-target selection, no checkout wiring yet (that
-- is Phase D onward). Same soft-lifecycle, admin-extensible registry shape
-- already established by ad_placements/ad_pricing_strategies, and the same
-- "publicly readable, admin-writable via service_role" RLS shape already
-- used by every pre-purchase catalog table in this module (ad_placements,
-- ad_pricing_strategies, ad_placement_prices) -- none of that catalog data
-- is sensitive, matching precedent rather than inventing a new access model.

-- === Channel types: application | external_website | social_media | future ===

CREATE TABLE IF NOT EXISTS public.ad_channel_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  label text NOT NULL,
  description text,
  display_order integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.ad_channel_types TO anon, authenticated;
GRANT ALL ON public.ad_channel_types TO service_role;
ALTER TABLE public.ad_channel_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Ad channel types are publicly readable" ON public.ad_channel_types;
CREATE POLICY "Ad channel types are publicly readable"
  ON public.ad_channel_types FOR SELECT TO anon, authenticated USING (true);

INSERT INTO public.ad_channel_types (key, label, display_order) VALUES
  ('application', 'Application', 10),
  ('external_website', 'External Website', 20),
  ('social_media', 'Social Media', 30)
ON CONFLICT (key) DO NOTHING;

-- === Campaign formats: banner | social_post | future ===
-- Referenced (as validated text[] values, not a join table -- see
-- PROJECT_KNOWLEDGE.md -> Universal Advertising Distribution Network) by
-- ad_channels.allowed_format_keys below.

CREATE TABLE IF NOT EXISTS public.ad_campaign_formats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  label text NOT NULL,
  description text,
  display_order integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.ad_campaign_formats TO anon, authenticated;
GRANT ALL ON public.ad_campaign_formats TO service_role;
ALTER TABLE public.ad_campaign_formats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Ad campaign formats are publicly readable" ON public.ad_campaign_formats;
CREATE POLICY "Ad campaign formats are publicly readable"
  ON public.ad_campaign_formats FOR SELECT TO anon, authenticated USING (true);

INSERT INTO public.ad_campaign_formats (key, label, display_order) VALUES
  ('banner', 'Banner', 10),
  ('social_post', 'Social Post', 20)
ON CONFLICT (key) DO NOTHING;

-- === Channels: one row per exact purchasable destination ===
-- E.g. "BosniaFans.com" (application), "Slatka-Tajna.eu" (external_website),
-- "BosniaFans -- Facebook" (social_media). Pricing (ad_channel_prices) and
-- campaign-target selection (ad_campaign_targets) are deliberately not part
-- of this phase -- see the header comment above.

CREATE TABLE IF NOT EXISTS public.ad_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  name text NOT NULL,
  channel_type_key text REFERENCES public.ad_channel_types(key) NOT NULL,
  description text,
  logo_url text,
  enabled boolean NOT NULL DEFAULT true,
  purchasable boolean NOT NULL DEFAULT true,
  allowed_format_keys text[] NOT NULL DEFAULT '{}',
  allowed_media_types text[] NOT NULL DEFAULT '{}',
  max_file_size_bytes integer CHECK (max_file_size_bytes IS NULL OR max_file_size_bytes > 0),
  min_duration_days integer CHECK (min_duration_days IS NULL OR min_duration_days > 0),
  max_duration_days integer CHECK (max_duration_days IS NULL OR max_duration_days >= min_duration_days),
  display_order integer NOT NULL DEFAULT 0,
  external_url text CHECK (external_url IS NULL OR external_url ~ '^https?://'),
  notes text,
  integration_id text,
  external_partner text,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_channels_type ON public.ad_channels(channel_type_key);

GRANT SELECT ON public.ad_channels TO anon, authenticated;
GRANT ALL ON public.ad_channels TO service_role;
ALTER TABLE public.ad_channels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Ad channels are publicly readable" ON public.ad_channels;
CREATE POLICY "Ad channels are publicly readable"
  ON public.ad_channels FOR SELECT TO anon, authenticated USING (true);

-- === Channel <-> application association ===
-- Which application(s) a channel is offered under (e.g. a social account
-- belongs to exactly one application; an external website may be scoped to
-- several, or none = offered to every application). Purely a "supported
-- applications" association -- selection/checkout logic is Phase D.

CREATE TABLE IF NOT EXISTS public.ad_channel_apps (
  channel_id uuid REFERENCES public.ad_channels(id) ON DELETE CASCADE NOT NULL,
  app_id uuid REFERENCES public.applications(id) ON DELETE CASCADE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, app_id)
);

CREATE INDEX IF NOT EXISTS idx_ad_channel_apps_app ON public.ad_channel_apps(app_id);

GRANT SELECT ON public.ad_channel_apps TO anon, authenticated;
GRANT ALL ON public.ad_channel_apps TO service_role;
ALTER TABLE public.ad_channel_apps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Ad channel apps are publicly readable" ON public.ad_channel_apps;
CREATE POLICY "Ad channel apps are publicly readable"
  ON public.ad_channel_apps FOR SELECT TO anon, authenticated USING (true);
