
-- Public read access for premium_profiles (needed for public bio-link cards)
GRANT SELECT ON public.premium_profiles TO anon;
CREATE POLICY "Premium profiles publicly readable"
  ON public.premium_profiles FOR SELECT
  TO public
  USING (true);

-- Public read access for subscriptions (needed to show premium badge on public profile)
GRANT SELECT ON public.subscriptions TO anon;
CREATE POLICY "Active subscriptions publicly readable"
  ON public.subscriptions FOR SELECT
  TO public
  USING (status = 'active');
