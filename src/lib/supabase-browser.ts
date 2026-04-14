import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let browserClient: SupabaseClient | null | undefined;

/**
 * Un solo client Supabase nel browser (evita più GoTrueClient sulla stessa storage key).
 */
export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (typeof window === "undefined") {
    return null;
  }
  if (!url || !anonKey) {
    return null;
  }
  if (browserClient === undefined) {
    browserClient = createClient(url, anonKey);
  }
  return browserClient;
}
