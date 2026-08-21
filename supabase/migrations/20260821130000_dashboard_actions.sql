-- CORE User Engagement & Dashboard Actions -- new CORE-wide capability.
--
-- Two new, deliberately separate tables:
--
-- 1. dashboard_actions -- admin-authored generic dashboard prompts (an
--    Admin Dashboard Offer/Action, or an "Application-Provided Action":
--    the same table, distinguished only by app_id being null (platform-
--    wide/CORE) or set to a real application -- CORE has no per-app write
--    credential mechanism anywhere in this codebase, so an application
--    "exposing" an action to CORE means an admin configures a row scoped
--    to that application, exactly the same convention every other
--    admin-managed per-application registry in this codebase already uses
--    (event_rules, ad_channels, dashboard_widget_settings, etc.). This is
--    deliberately NOT a merge with dashboard_offers (Priority 17): that
--    table requires a real commercial product (subscription_plan or
--    ad_placement_price) with a discount and a mandatory date window --
--    a fundamentally different concept (a purchase promotion) from a
--    generic "go do this" prompt with an arbitrary destination and no
--    product at all. Reusing/loosening dashboard_offers' NOT NULL
--    product/discount columns to fit this need would be exactly the kind
--    of "redesign working architecture" this feature must not do.
--
-- 2. resource_references -- a generic pointer to a resource a user owns in
--    a connected application's OWN database (a Shop, a Business, an
--    Event...). CORE stores only the reference/status needed for the
--    central Dashboard, never the underlying business data -- written
--    exclusively by service_role, either an admin (support/testing) or
--    the new PUT /v1/me/resources/{resourceType} endpoint an application
--    calls on the current user's behalf (see API_CONTRACT.md).
--
-- Both reuse the existing offer_segments registry (Priority 17) for
-- audience targeting rather than inventing a second segment vocabulary,
-- and the existing dashboard_widgets registry (Priority 8.2) for
-- Dashboard-section visibility toggles.

-- ============================================================
-- 1. dashboard_actions
-- ============================================================

CREATE TABLE IF NOT EXISTS public.dashboard_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What kind of prompt this is, so the Dashboard can group/explain it
  -- (spec section 11) -- not a business-logic branch, purely a display
  -- grouping key.
  action_type text NOT NULL CHECK (action_type IN ('offer', 'action', 'complete_task', 'discovery')),

  -- Null = platform-wide/CORE action. Set = scoped to one application --
  -- this is also how an "Application-Provided Action" is represented; see
  -- header comment.
  app_id uuid REFERENCES public.applications(id) ON DELETE CASCADE,

  -- Audience targeting -- same shape as dashboard_offers' offer_type
  -- discriminator, reusing offer_segments, named distinctly (target_type,
  -- not offer_type) since this table also has its own action_type.
  target_type text NOT NULL CHECK (target_type IN ('segment', 'individual')),
  target_segment text REFERENCES public.offer_segments(key),
  target_user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  CHECK (
    (target_type = 'segment' AND target_segment IS NOT NULL AND target_user_id IS NULL)
    OR
    (target_type = 'individual' AND target_user_id IS NOT NULL AND target_segment IS NULL)
  ),

  -- Minimal generic eligibility (spec section 12): only show this action
  -- to a user who does NOT already have a resource_references row of this
  -- type for this action's app_id (e.g. "Open your Shop" only shown to a
  -- user with no 'shop' resource on that application). Null = no such
  -- gate. CORE never interprets what the resource type means.
  requires_missing_resource_type text,

  title_bs text NOT NULL,
  title_en text NOT NULL,
  title_de text NOT NULL,
  description_bs text,
  description_en text,
  description_de text,
  cta_bs text,
  cta_en text,
  cta_de text,
  -- Free-text icon (an emoji, matching dashboard_offers.badge_icon's
  -- existing convention) -- no image-upload infrastructure needed for
  -- this feature.
  icon text,

  -- Internal relative path ("/dashboard/profile") or absolute http(s) URL
  -- to another application's own domain -- validated server-side
  -- (isSafeDashboardActionDestination, dashboard-actions.functions.ts),
  -- the same "validate before storage" rule CO-1 established for every
  -- other user/admin-supplied URL in this codebase.
  destination text NOT NULL,

  -- Nullable -- "where appropriate" (spec section 5), unlike
  -- dashboard_offers' mandatory commercial-promotion window.
  starts_at timestamptz,
  ends_at timestamptz,
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at),

  display_order integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  archived boolean NOT NULL DEFAULT false,

  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dashboard_actions_individual
  ON public.dashboard_actions(target_user_id) WHERE target_type = 'individual';
CREATE INDEX IF NOT EXISTS idx_dashboard_actions_segment
  ON public.dashboard_actions(target_segment) WHERE target_type = 'segment';
CREATE INDEX IF NOT EXISTS idx_dashboard_actions_app
  ON public.dashboard_actions(app_id) WHERE app_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dashboard_actions_live
  ON public.dashboard_actions(enabled, archived) WHERE enabled = true AND archived = false;

GRANT SELECT ON public.dashboard_actions TO authenticated;
GRANT ALL ON public.dashboard_actions TO service_role;
ALTER TABLE public.dashboard_actions ENABLE ROW LEVEL SECURITY;

-- Same "RLS is the safe boundary, business filtering is a server
-- function" split dashboard_offers already established: an authenticated
-- user may see any enabled, non-archived segment-targeted action (seeing
-- that e.g. a Premium-segment action exists is no more sensitive than any
-- other public catalog row) or their own individual action. Resource-gate
-- and date-window filtering happen server-side in resolveMyDashboardActions().
DROP POLICY IF EXISTS "Users can view eligible dashboard actions" ON public.dashboard_actions;
CREATE POLICY "Users can view eligible dashboard actions"
  ON public.dashboard_actions FOR SELECT TO authenticated
  USING (
    enabled = true AND archived = false
    AND (target_type = 'segment' OR target_user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Admins manage dashboard actions" ON public.dashboard_actions;
CREATE POLICY "Admins manage dashboard actions"
  ON public.dashboard_actions FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

-- ============================================================
-- 2. resource_references
-- ============================================================

CREATE TABLE IF NOT EXISTS public.resource_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  app_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  -- Generic, application-supplied label (e.g. 'shop', 'business', 'event',
  -- 'fan_club') -- CORE never interprets its meaning, only displays it and
  -- uses it as the requires_missing_resource_type match key above.
  resource_type text NOT NULL,
  label text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'incomplete', 'inactive')),
  destination text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Deliberate V1 simplification: one reference per (user, app, type) --
  -- every current spec example ("My Shop", "My Business") is inherently
  -- singular. A future application needing multiple resources of the same
  -- type per user (e.g. several Events) would need this constraint
  -- relaxed and resource_id added -- not required by anything in scope
  -- today, so not built ahead of an actual need.
  UNIQUE (user_id, app_id, resource_type)
);

CREATE INDEX IF NOT EXISTS idx_resource_references_user ON public.resource_references(user_id);

GRANT SELECT ON public.resource_references TO authenticated;
GRANT ALL ON public.resource_references TO service_role;
ALTER TABLE public.resource_references ENABLE ROW LEVEL SECURITY;

-- A user may see only their own resource references -- never another
-- user's, and never cross-application aggregation beyond their own rows.
-- No authenticated INSERT/UPDATE policy: writes only ever happen through
-- service_role (admin support/testing, or the PUT /v1/me/resources/{type}
-- endpoint, both of which re-verify the caller server-side) -- the same
-- "no direct client write for a business-rule-gated table" pattern
-- conversations/ad_campaigns already use.
DROP POLICY IF EXISTS "Users can view their own resource references" ON public.resource_references;
CREATE POLICY "Users can view their own resource references"
  ON public.resource_references FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins manage resource references" ON public.resource_references;
CREATE POLICY "Admins manage resource references"
  ON public.resource_references FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

-- ============================================================
-- 3. Dashboard Widget Modularity registrations (Priority 8.2) -- same
--    mechanism every other Dashboard section already uses to be
--    globally/per-application toggleable, not a new visibility mechanism.
-- ============================================================

INSERT INTO public.dashboard_widgets (key, label, display_order) VALUES
  ('dashboard_actions', 'Dashboard Actions', 23),
  ('recent_activity', 'Recent Activity', 24)
ON CONFLICT (key) DO NOTHING;
