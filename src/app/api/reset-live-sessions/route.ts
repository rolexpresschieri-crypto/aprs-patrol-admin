import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { normalizeAdminRole, type AdminSessionData } from "@/lib/admin-auth";

const CHUNK = 40;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string) {
  return UUID_RE.test(value.trim());
}

export async function POST(request: Request) {
  const url =
    process.env.SUPABASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !serviceKey) {
    return NextResponse.json(
      {
        error:
          "SUPABASE_SERVICE_ROLE_KEY mancante nel server. Aggiungila in aprs_patrol_admin/.env.local (non committare) e riavvia Next.js.",
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

  const payload = body as {
    session?: AdminSessionData | null;
    sessionIdsFromClient?: unknown;
  };
  const session = payload.session;
  if (!session?.code) {
    return NextResponse.json({ error: "Sessione admin assente" }, { status: 401 });
  }

  if (normalizeAdminRole(session.role) !== "admin") {
    return NextResponse.json({ error: "Solo admin può eseguire il reset" }, { status: 403 });
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const logoutAt = new Date().toISOString();

  const idSet = new Set<string>();

  const { data: onlineRows, error: selectError } = await admin
    .from("patrol_sessions")
    .select("id")
    .eq("is_online", true);

  if (selectError) {
    return NextResponse.json({ error: selectError.message }, { status: 500 });
  }

  for (const row of onlineRows ?? []) {
    const id = row.id as string | undefined;
    if (id && isUuid(id)) {
      idSet.add(id);
    }
  }

  const fromClient = payload.sessionIdsFromClient;
  if (Array.isArray(fromClient)) {
    for (const raw of fromClient) {
      if (typeof raw === "string" && isUuid(raw)) {
        idSet.add(raw.trim());
      }
    }
  }

  const sessionIds = [...idSet];

  if (sessionIds.length === 0) {
    return NextResponse.json({
      ok: true,
      updated: 0,
      deletedPings: 0,
      message:
        "Nessuna sessione online da chiudere (né da DB né dalla mappa). Verifica che le pattuglie risultino online e che SUPABASE_SERVICE_ROLE_KEY sia la secret key dello stesso progetto.",
    });
  }

  let deletedPings = 0;

  for (let i = 0; i < sessionIds.length; i += CHUNK) {
    const chunk = sessionIds.slice(i, i + CHUNK);
    const { data: deleted, error: delError } = await admin
      .from("patrol_position_pings")
      .delete()
      .in("session_id", chunk)
      .select("id");

    if (delError) {
      return NextResponse.json({ error: delError.message }, { status: 500 });
    }

    deletedPings += deleted?.length ?? 0;
  }

  let updated = 0;

  for (let i = 0; i < sessionIds.length; i += CHUNK) {
    const chunk = sessionIds.slice(i, i + CHUNK);
    const { data: updatedRows, error: updError } = await admin
      .from("patrol_sessions")
      .update({
        is_online: false,
        logout_at: logoutAt,
      })
      .in("id", chunk)
      .select("id");

    if (updError) {
      return NextResponse.json({ error: updError.message }, { status: 500 });
    }

    updated += updatedRows?.length ?? 0;
  }

  return NextResponse.json({
    ok: true,
    updated,
    deletedPings,
    sessionCount: sessionIds.length,
    partial: updated < sessionIds.length,
  });
}
