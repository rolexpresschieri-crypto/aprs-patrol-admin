import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { normalizeAdminRole, type AdminSessionData } from "@/lib/admin-auth";
import { formatFixTimestamp, getStatusLabel } from "@/lib/live-patrols";
import { resolveOwnerAdminId } from "@/lib/resolve-owner-admin";

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

function adminClient() {
  const url =
    process.env.SUPABASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) {
    return null;
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(request: Request) {
  const admin = adminClient();
  if (!admin) {
    return NextResponse.json(
      {
        error:
          "SUPABASE_SERVICE_ROLE_KEY o URL mancanti sul server. Configura le variabili in Vercel / .env.local.",
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
    exerciseId?: string;
  };

  const session = requireAdminSession(payload.session);
  if (!session?.code) {
    return NextResponse.json({ error: "Sessione admin assente" }, { status: 401 });
  }

  const role = normalizeAdminRole(session.role);
  if (role !== "admin" && role !== "viewer") {
    return NextResponse.json({ error: "Ruolo non valido" }, { status: 403 });
  }

  const exerciseId =
    typeof payload.exerciseId === "string" ? payload.exerciseId.trim() : "";
  if (!exerciseId || !isUuid(exerciseId)) {
    return NextResponse.json({ error: "exerciseId UUID obbligatorio" }, { status: 400 });
  }

  const ownerRes = await resolveOwnerAdminId(admin, session);
  if ("error" in ownerRes) {
    return ownerRes.error;
  }
  const ownerId = ownerRes.id;

  const { data: exerciseRow, error: exErr } = await admin
    .from("exercises")
    .select("id, title, owner_admin_id")
    .eq("id", exerciseId)
    .maybeSingle();

  if (exErr) {
    return NextResponse.json({ error: exErr.message }, { status: 500 });
  }
  if (!exerciseRow) {
    return NextResponse.json({ error: "Esercitazione non trovata." }, { status: 404 });
  }

  if (role === "admin" && (exerciseRow.owner_admin_id as string) !== ownerId) {
    return NextResponse.json(
      { error: "Esercitazione non autorizzata per questo account." },
      { status: 403 },
    );
  }

  const exerciseTitle = (exerciseRow.title as string | null)?.trim() || "Esercitazione";

  const { data: rows, error: qErr } = await admin
    .from("patrol_status_events")
    .select(
      "id, changed_at, status, note, patrols(patrol_code, patrol_name), missions(mission_name), patrol_sessions(is_online, login_at, logout_at)",
    )
    .eq("exercise_id", exerciseId)
    .order("changed_at", { ascending: true })
    .limit(50_000);

  if (qErr) {
    return NextResponse.json({ error: qErr.message }, { status: 500 });
  }

  const headers = [
    "ONLINE",
    "Pattuglia",
    "Missione",
    "Stato",
    "Data/ora",
    "Login sessione",
    "Logout sessione",
    "Nota",
  ];

  const bodyRows: string[][] = (rows ?? []).map((row) => {
    const patrolRaw = row.patrols as
      | { patrol_code?: string; patrol_name?: string }
      | Array<{ patrol_code?: string; patrol_name?: string }>
      | null;
    const patrol = Array.isArray(patrolRaw) ? patrolRaw[0] : patrolRaw;
    const missionRaw = row.missions as
      | { mission_name?: string }
      | Array<{ mission_name?: string }>
      | null;
    const mission = Array.isArray(missionRaw) ? missionRaw[0] : missionRaw;
    const psRaw = row.patrol_sessions as
      | { is_online?: boolean; login_at?: string; logout_at?: string | null }
      | Array<{ is_online?: boolean; login_at?: string; logout_at?: string | null }>
      | null;
    const ps = Array.isArray(psRaw) ? psRaw[0] : psRaw;

    const code = String(patrol?.patrol_code ?? "").trim();
    const name = String(patrol?.patrol_name ?? "").trim();
    const patrolLabel =
      code && name ? `${code} - ${name}` : code || name || "n/d";

    return [
      ps?.is_online ? "online" : "chiusa",
      patrolLabel,
      String(mission?.mission_name ?? ""),
      getStatusLabel(String(row.status ?? "")),
      formatFixTimestamp(String(row.changed_at ?? "")),
      ps?.login_at ? formatFixTimestamp(String(ps.login_at)) : "",
      ps?.logout_at ? formatFixTimestamp(String(ps.logout_at)) : "",
      typeof row.note === "string" ? row.note.trim() : "",
    ];
  });

  return NextResponse.json({
    ok: true,
    exerciseTitle,
    headers,
    rows: bodyRows,
    rowCount: bodyRows.length,
  });
}
