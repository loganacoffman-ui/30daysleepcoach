import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, processLock } from '@supabase/supabase-js';
import 'react-native-url-polyfill/auto';

const fallbackSupabaseUrl = 'https://qfnouotdhfltgvjhfbld.supabase.co';
const fallbackSupabasePublicKey =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmbm91b3RkaGZsdGd2amhmYmxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NTEyODksImV4cCI6MjA4OTUyNzI4OX0.fI0QrHf1qutTlLtRH8JLoiv5UnHwjqulnKGPDtH1610';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || fallbackSupabaseUrl;
const supabasePublicKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || fallbackSupabasePublicKey;

export const supabase = createClient(supabaseUrl, supabasePublicKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    lock: processLock,
  },
});
