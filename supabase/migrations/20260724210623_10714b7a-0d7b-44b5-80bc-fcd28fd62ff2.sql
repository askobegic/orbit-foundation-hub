ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_user_type_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_user_type_check CHECK (user_type IN ('standard','premium','admin'));
UPDATE public.profiles SET user_type = 'admin' WHERE user_type = 'super_admin';