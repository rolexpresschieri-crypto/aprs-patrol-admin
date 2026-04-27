import type { SupabaseClient } from "@supabase/supabase-js";

import { ADMIN_SESSION_STORAGE_KEY, type AdminSessionData } from "@/lib/admin-auth";

/**
 * Aggiunge `adminId` alla sessione salvata (sessioni precedenti alla migrazione multi-admin).
 */
export async function enrichAdminSessionWithId(
  supabase: SupabaseClient,
  session: AdminSessionData,
): Promise<AdminSessionData> {
  if (session.adminId) {
    return session;
  }
  const code = session.code.trim().toLowerCase();
  const { data, error } = await supabase
    .from("admins")
    .select("id")
    .eq("admin_code", code)
    .maybeSingle();

  if (error || !data?.id) {
    return session;
  }

  const next: AdminSessionData = { ...session, adminId: data.id as string };
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(ADMIN_SESSION_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }
  return next;
}
