GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

INSERT INTO public.subscription_plans (
  app_id,
  name,
  duration_months,
  price,
  currency,
  features_bs,
  features_en,
  features_de,
  is_active
)
SELECT
  a.id,
  'Premium 12m',
  12,
  49.00,
  'EUR',
  '["Premium profil", "Javna bio-link kartica", "Kontakt podaci", "Društvene mreže"]'::jsonb,
  '["Premium profile", "Public bio-link card", "Contact details", "Social links"]'::jsonb,
  '["Premium-Profil", "Öffentliche Bio-Link-Karte", "Kontaktdaten", "Social Links"]'::jsonb,
  true
FROM public.applications a
WHERE a.status = 'active'
  AND NOT EXISTS (
    SELECT 1
    FROM public.subscription_plans sp
    WHERE sp.app_id = a.id
  );