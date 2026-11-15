import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
// The browser-safe "publishable" key (or the legacy "anon" key). Never the secret/service_role key.
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;

/** Returns the current user id, signing in anonymously the first time this browser visits. */
export async function ensureSession(client: SupabaseClient): Promise<string> {
  const { data } = await client.auth.getSession();
  if (data.session) {
    // The nightly clean-up deletes anonymous players who haven't played for 30 days.
    // If ours was deleted, the server rejects it: forget it and start fresh.
    const { data: current, error } = await client.auth.getUser();
    if (current.user) return current.user.id;
    if (error?.status !== 401 && error?.status !== 403 && error?.status !== 404) {
      return data.session.user.id; // offline or a temporary error: keep using the saved session
    }
    await client.auth.signOut({ scope: "local" });
  }
  const { data: signIn, error } = await client.auth.signInAnonymously();
  if (error || !signIn.user) {
    throw new Error(error?.message ?? "Anonymous sign-in failed.");
  }
  return signIn.user.id;
}
