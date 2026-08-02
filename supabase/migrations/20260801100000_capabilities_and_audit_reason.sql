-- Priority 8.1: Capabilities system + audit "reason" field.
--
-- Foundational infrastructure for the Final CORE Architecture phase: every
-- future configurable module (Dashboard widgets, Rewards, Advertising)
-- gates itself on a capability key here, rather than CORE code ever
-- branching on which application is asking. New capabilities are added by
-- inserting a row, never by a deployment (see PROJECT_KNOWLEDGE.md ->
-- Capabilities).
--
-- capability_definitions.key is a free text column, not a Postgres enum,
-- specifically so an admin can register a brand new capability without a
-- schema migration -- an enum would defeat the entire "no deployments for
-- business-rule changes" purpose of this table.

CREATE TABLE IF NOT EXISTS public.capability_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  label text NOT NULL,
  description text,
  display_order integer NOT NULL DEFAULT 0,
  -- Soft lifecycle (Part 5 / adjustment 5): enabled/archived, never a hard
  -- delete of a definition once something may reference it.
  enabled boolean NOT NULL DEFAULT true,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.capability_definitions TO anon, authenticated;
GRANT ALL ON public.capability_definitions TO service_role;

ALTER TABLE public.capability_definitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Capability definitions are publicly readable" ON public.capability_definitions;
CREATE POLICY "Capability definitions are publicly readable"
  ON public.capability_definitions FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE TABLE IF NOT EXISTS public.application_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id uuid REFERENCES public.applications(id) ON DELETE CASCADE NOT NULL,
  capability_key text REFERENCES public.capability_definitions(key) ON DELETE CASCADE NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (app_id, capability_key)
);

CREATE INDEX IF NOT EXISTS idx_application_capabilities_app ON public.application_capabilities(app_id);

GRANT SELECT ON public.application_capabilities TO anon, authenticated;
GRANT ALL ON public.application_capabilities TO service_role;

ALTER TABLE public.application_capabilities ENABLE ROW LEVEL SECURITY;

-- Publicly readable, not just admin-readable: the calling application
-- itself, and cross-application UI (e.g. a future "this app also has X"
-- badge), both need to read enabled capabilities without an admin session.
-- Only service_role (admin server functions) can write.
DROP POLICY IF EXISTS "Application capabilities are publicly readable" ON public.application_capabilities;
CREATE POLICY "Application capabilities are publicly readable"
  ON public.application_capabilities FOR SELECT
  TO anon, authenticated
  USING (true);

-- Seed the capability vocabulary already named across Part 8 of the Final
-- CORE Architecture. Seeding known keys is not hardcoded business logic --
-- it's initial data in an admin-editable table; nothing in application
-- code requires exactly these rows to exist.
INSERT INTO public.capability_definitions (key, label, display_order) VALUES
  ('premium', 'Premium', 10),
  ('messaging', 'Messaging', 20),
  ('advertising', 'Advertising', 30),
  ('rewards', 'Rewards & Loyalty', 40),
  ('featured_business', 'Featured Business', 50),
  ('featured_event', 'Featured Event', 60),
  ('business_directory', 'Business Directory', 70),
  ('events', 'Events', 80),
  ('discover', 'Discover', 90),
  ('community', 'Community', 100)
ON CONFLICT (key) DO NOTHING;

-- Audit "reason" (adjustment 6): every configuration change should
-- optionally record why, alongside who/when/old/new (all already
-- supported by audit_logs/writeAuditLog).
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS reason text;
