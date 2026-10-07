import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.1';
import { createMemoryProvider } from '../_shared/memory.ts';
import { makeHandler } from './handler.ts';
const required = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};
const url = required('SUPABASE_URL');
const auth = { persistSession: false, autoRefreshToken: false };
Deno.serve(makeHandler({
  admin: createClient(url, required('SUPABASE_SERVICE_ROLE_KEY'), { auth }),
  caller: jwt => createClient(url, required('SUPABASE_ANON_KEY'), { auth, global: { headers: { Authorization: `Bearer ${jwt}` } } }),
  domain: Deno.env.get('TEST_USER_EMAIL_DOMAIN') ?? 'example.test',
  deleteMemories: userId => createMemoryProvider(required('MEM0_API_KEY')).deleteUser(userId),
}));
