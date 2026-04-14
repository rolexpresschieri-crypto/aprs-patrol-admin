import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { normalizeAdminRole, type AdminSessionData } from "@/lib/admin-auth";

const CHUNK = 80;

export async function POST(request: Request) {
  const url =
    process.env.SUPABASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !serviceKey) {
    return NextResponse.json(
      {
        error:
          "SUPABASE_SERVICE_ROLE_KEY mancante nel server. Aggiungila in aprs_patrol_admin/.env.local e riavvia Next.js.",
        code: "SERVICE_ROLE_NOT_CONFIGURED",
      },
      { status: 501 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body JSON non valido" }, { status: 400 });
  }

  const session = (body as { session?: AdminSessionData | null }).session;
  if (!session?.code) {
    return NextResponse.json({ error: "Sessione admin assente" }, { status: 401 });
  }

  if (normalizeAdminRole(session.role) !== "admin") {
    return NextResponse.json(
      { error: "Solo admin può eliminare sessioni chiuse" },
      { status: 403 },
    );
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let deleted = 0;
  const maxRounds = 500;

  for (let round = 0; round < maxRounds; round += 1) {
    const { data: rows, error: selError } = await admin
      .from("patrol_sessions")
      .select("id")
      .eq("is_online", false)
      .limit(CHUNK);

    if (selError) {
      return NextResponse.json({ error: selError.message }, { status: 500 });
    }

    const ids = (rows ?? [])
      .map((r) => r.id as string | undefined)
      .filter((id): id is string => Boolean(id));

    if (ids.length === 0) {
      break;
    }

    const { error: delError } = await admin.from("patrol_sessions").delete().in("id", ids);

    if (delError) {
      return NextResponse.json({ error: delError.message }, { status: 500 });
    }

    deleted += ids.length;
  }

  return NextResponse.json({
    ok: true,
    deletedSessions: deleted,
    message:
      deleted === 0
        ? "Nessuna sessione CHIUSA da rimuovere (is_online = false)."
        : `Rimosse ${deleted} sessioni CHIUSE dal database (eventi/ping collegati eliminati in cascade).`,
  });
}
