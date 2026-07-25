import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL = 'https://bzzcowkiprxcrpeisttp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ6emNvd2tpcHJ4Y3JwZWlzdHRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4ODgxODYsImV4cCI6MjEwMDQ2NDE4Nn0.dJVg57Y0nZ3dd6608dhZpgqtrVmHn5rrSOYAFRUl154';

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: typeof window !== 'undefined' ? localStorage : undefined,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  }
});
