import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
// The browser-safe "publishable" key (or the legacy "anon" key). Never the secret/service_role key.
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;

/** Returns the current user id, signing in anonymously the first time this browser visits. */
export async function ensureSession(client: SupabaseClient): Promise<string> {
  const { data } = await client.auth.getSession();
  if (data.session) return data.session.user.id;
  const { data: signIn, error } = await client.auth.signInAnonymously();
  if (error || !signIn.user) {
    throw new Error(error?.message ?? "Anonymous sign-in failed.");
  }
  return signIn.user.id;
}
