
-- === updated_at helper ===
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- === 1. profiles ===
CREATE TABLE public.profiles (
  id uuid REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email text,
  first_name text,
  last_name text,
  avatar_url text,
  city text,
  country text DEFAULT 'BA',
  username text UNIQUE,
  bio text,
  language text DEFAULT 'bs' CHECK (language IN ('bs','en','de')),
  user_type text DEFAULT 'standard' CHECK (user_type IN ('standard','premium','admin','super_admin')),
  is_verified boolean DEFAULT false,
  is_active boolean DEFAULT true,
  profile_complete boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
GRANT SELECT ON public.profiles TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public profiles viewable by everyone" ON public.profiles FOR SELECT USING (is_active = true);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Auto-create profile on new auth user
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, first_name, last_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'first_name',
    NEW.raw_user_meta_data->>'last_name',
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- === 2. premium_profiles ===
CREATE TABLE public.premium_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE UNIQUE,
  phone text,
  phone_public boolean DEFAULT false,
  whatsapp text,
  whatsapp_public boolean DEFAULT false,
  contact_email text,
  contact_email_public boolean DEFAULT false,
  website text,
  website_public boolean DEFAULT false,
  primary_profession text,
  secondary_professions text[],
  facebook_url text,
  instagram_url text,
  tiktok_url text,
  youtube_url text,
  linkedin_url text,
  x_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.premium_profiles TO authenticated;
GRANT ALL ON public.premium_profiles TO service_role;
ALTER TABLE public.premium_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own premium profile" ON public.premium_profiles FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER premium_profiles_updated_at BEFORE UPDATE ON public.premium_profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- === 3. applications ===
CREATE TABLE public.applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  domain text UNIQUE,
  logo_url text,
  favicon_url text,
  cover_image_url text,
  primary_color text DEFAULT '#1D6BF3',
  secondary_color text DEFAULT '#6366F1',
  short_description_bs text,
  short_description_en text,
  short_description_de text,
  status text DEFAULT 'active' CHECK (status IN ('active','coming_soon','archived')),
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
GRANT SELECT ON public.applications TO anon, authenticated;
GRANT ALL ON public.applications TO service_role;
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Applications publicly readable" ON public.applications FOR SELECT USING (true);
CREATE TRIGGER applications_updated_at BEFORE UPDATE ON public.applications FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- === 4. subscription_plans ===
CREATE TABLE public.subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id uuid REFERENCES public.applications(id) ON DELETE CASCADE,
  name text NOT NULL,
  duration_months integer NOT NULL CHECK (duration_months IN (1,3,6,12)),
  price numeric NOT NULL,
  currency text DEFAULT 'EUR',
  stripe_payment_link text,
  paypal_payment_link text,
  features_bs jsonb DEFAULT '[]'::jsonb,
  features_en jsonb DEFAULT '[]'::jsonb,
  features_de jsonb DEFAULT '[]'::jsonb,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);
GRANT SELECT ON public.subscription_plans TO anon, authenticated;
GRANT ALL ON public.subscription_plans TO service_role;
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Plans publicly readable" ON public.subscription_plans FOR SELECT USING (is_active = true);

-- === 5. subscriptions ===
CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  app_id uuid REFERENCES public.applications(id) ON DELETE CASCADE,
  plan_id uuid REFERENCES public.subscription_plans(id),
  status text DEFAULT 'active' CHECK (status IN ('active','expired','cancelled','pending')),
  stripe_payment_id text,
  paypal_payment_id text,
  amount_paid numeric,
  currency text DEFAULT 'EUR',
  started_at timestamptz DEFAULT now(),
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, app_id)
);
GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own subscriptions" ON public.subscriptions FOR SELECT USING (auth.uid() = user_id);

-- === 6. payments ===
CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  app_id uuid REFERENCES public.applications(id) ON DELETE SET NULL,
  subscription_id uuid REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  stripe_payment_id text UNIQUE,
  paypal_payment_id text,
  amount numeric NOT NULL,
  currency text DEFAULT 'EUR',
  status text DEFAULT 'pending' CHECK (status IN ('pending','success','failed','refunded')),
  payment_method text CHECK (payment_method IN ('stripe','paypal')),
  invoice_url text,
  created_at timestamptz DEFAULT now()
);
GRANT SELECT ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own payments" ON public.payments FOR SELECT USING (auth.uid() = user_id);

-- === 7. notifications ===
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  title_bs text,
  title_en text,
  title_de text,
  message_bs text,
  message_en text,
  message_de text,
  type text DEFAULT 'info' CHECK (type IN ('info','success','warning','error')),
  app_id uuid REFERENCES public.applications(id) ON DELETE SET NULL,
  is_read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own notifications" ON public.notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users update own notifications" ON public.notifications FOR UPDATE USING (auth.uid() = user_id);

-- === 8. audit_logs ===
CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  old_data jsonb,
  new_data jsonb,
  ip_address text,
  created_at timestamptz DEFAULT now()
);
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
-- No policies: locked to service_role only.

-- === Seed applications ===
INSERT INTO public.applications
  (name, slug, domain, primary_color, secondary_color, short_description_bs, short_description_en, short_description_de, status, sort_order)
VALUES
  ('Bosanci.pro','bosanci-pro','bosanci.pro','#1D6BF3','#6366F1',
   'Platforma za povezivanje Bosanaca širom svijeta.',
   'Platform for connecting Bosnians around the world.',
   'Plattform für die Verbindung von Bosniern weltweit.','active',1),
  ('Muzika.ba','muzika-ba','muzika.ba','#8B5CF6','#6366F1',
   'Platforma za muzičare i booking.',
   'Platform for musicians and booking.',
   'Plattform für Musiker und Buchungen.','active',2),
  ('Svadba.ba','svadba-ba','svadba.ba','#F59E0B','#EF4444',
   'Sve za vašu savršenu svadbu.',
   'Everything for your perfect wedding.',
   'Alles für Ihre perfekte Hochzeit.','active',3),
  ('Gradovi.ba','gradovi-ba','gradovi.ba','#10B981','#059669',
   'Najbolji biznisi u vašem gradu.',
   'The best businesses in your city.',
   'Die besten Unternehmen in Ihrer Stadt.','active',4),
  ('Ticketaria.io','ticketaria-io','ticketaria.io','#EF4444','#DC2626',
   'Prodaja ulaznica za evente i koncerte.',
   'Tickets for events and concerts.',
   'Tickets für Events und Konzerte.','coming_soon',5);
