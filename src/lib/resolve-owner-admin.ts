import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import type { AdminSessionData } from "@/lib/admin-auth";

/**
 * Risolve l'UUID riga `admins` dal login in sessione (non ci si affida a `adminId` inviato dal client).
 */
export async function resolveOwnerAdminId(
  admin: SupabaseClient,
  session: AdminSessionData,
): Promise<{ id: string } | { error: NextResponse }> {
  const code = session.code.trim().toLowerCase();
  const { data, error } = await admin
    .from("admins")
    .select("id")
    .eq("admin_code", code)
    .maybeSingle();

  if (error) {
    return {
      error: NextResponse.json({ error: error.message }, { status: 500 }),
    };
  }
  const id = data?.id as string | undefined;
  if (!id) {
    return {
      error: NextResponse.json(
        {
          error:
            "Account amministratore non trovato: verifica il login o effettua di nuovo l'accesso.",
        },
        { status: 403 },
      ),
    };
  }
  return { id };
}
