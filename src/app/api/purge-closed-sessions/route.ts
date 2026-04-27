import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { normalizeAdminRole, type AdminSessionData } from "@/lib/admin-auth";
import { resolveOwnerAdminId } from "@/lib/resolve-owner-admin";

const CHUNK = 80;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireAdminSession(session: unknown): AdminSessionData | null {
  if (!session || typeof session !== "object") {
    return null;
  }
  const s = session as Record<string, unknown>;
  const code = typeof s.code === "string" ? s.code.trim() : "";
  if (!code) {
    return null;
  }
  const adminIdRaw = typeof s.adminId === "string" ? s.adminId.trim() : "";
  const adminId = adminIdRaw && UUID_RE.test(adminIdRaw) ? adminIdRaw : undefined;
  return {
    code,
    name: typeof s.name === "string" ? s.name : code,
    role: normalizeAdminRole(s.role as string | null),
    ...(adminId ? { adminId } : {}),
  };
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

  const session = requireAdminSession((body as { session?: AdminSessionData | null }).session);
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

  const ownerRes = await resolveOwnerAdminId(admin, session);
  if ("error" in ownerRes) {
    return ownerRes.error;
  }
  const ownerId = ownerRes.id;

  const { data: myExercises, error: exErr } = await admin
    .from("exercises")
    .select("id")
    .eq("owner_admin_id", ownerId);

  if (exErr) {
    return NextResponse.json({ error: exErr.message }, { status: 500 });
  }

  const exerciseIds = (myExercises ?? [])
    .map((r) => r.id as string | undefined)
    .filter((id): id is string => Boolean(id));

  if (exerciseIds.length === 0) {
    return NextResponse.json({
      ok: true,
      deletedSessions: 0,
      message:
        "Nessuna esercitazione associata a questo account: nulla da eliminare tra le sessioni chiuse.",
    });
  }

  let deleted = 0;
  const maxRounds = 500;

  for (let round = 0; round < maxRounds; round += 1) {
    const { data: rows, error: selError } = await admin
      .from("patrol_sessions")
      .select("id")
      .eq("is_online", false)
      .in("exercise_id", exerciseIds)
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
        ? "Nessuna sessione CHIUSA da rimuovere tra le tue esercitazioni (is_online = false)."
        : `Rimosse ${deleted} sessioni CHIUSE solo per le tue esercitazioni (eventi/ping collegati in cascade).`,
  });
}
