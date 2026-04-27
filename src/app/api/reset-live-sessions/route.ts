import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { normalizeAdminRole, type AdminSessionData } from "@/lib/admin-auth";
import { resolveOwnerAdminId } from "@/lib/resolve-owner-admin";

const CHUNK = 40;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string) {
  return UUID_RE.test(value.trim());
}

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
  const adminId = adminIdRaw && isUuid(adminIdRaw) ? adminIdRaw : undefined;
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
  const session = requireAdminSession(payload.session);
  if (!session?.code) {
    return NextResponse.json({ error: "Sessione admin assente" }, { status: 401 });
  }

  if (normalizeAdminRole(session.role) !== "admin") {
    return NextResponse.json({ error: "Solo admin può eseguire il reset" }, { status: 403 });
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
      updated: 0,
      deletedPings: 0,
      sessionCount: 0,
      message:
        "Nessuna esercitazione per questo account: nessuna sessione online da chiudere.",
    });
  }

  const logoutAt = new Date().toISOString();

  const idSet = new Set<string>();

  const { data: onlineRows, error: selectError } = await admin
    .from("patrol_sessions")
    .select("id")
    .eq("is_online", true)
    .in("exercise_id", exerciseIds);

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
    const clientIds = fromClient
      .map((raw) => (typeof raw === "string" ? raw.trim() : ""))
      .filter((id) => isUuid(id));
    if (clientIds.length > 0) {
      const { data: validated, error: valErr } = await admin
        .from("patrol_sessions")
        .select("id")
        .in("id", clientIds)
        .in("exercise_id", exerciseIds)
        .eq("is_online", true);

      if (valErr) {
        return NextResponse.json({ error: valErr.message }, { status: 500 });
      }
      for (const row of validated ?? []) {
        const id = row.id as string | undefined;
        if (id && isUuid(id)) {
          idSet.add(id);
        }
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
        "Nessuna sessione online da chiudere tra le tue esercitazioni (né da DB né dalla mappa).",
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
      .in("exercise_id", exerciseIds)
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
