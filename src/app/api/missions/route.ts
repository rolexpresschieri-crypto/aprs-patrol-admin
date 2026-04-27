import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { normalizeAdminRole, type AdminSessionData } from "@/lib/admin-auth";
import { resolveOwnerAdminId } from "@/lib/resolve-owner-admin";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string) {
  return UUID_RE.test(value.trim());
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

function requireAdminRole(session: AdminSessionData) {
  if (normalizeAdminRole(session.role) !== "admin") {
    return NextResponse.json(
      { error: "Solo un amministratore può modificare le missioni." },
      { status: 403 },
    );
  }
  return null;
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
    missionCode?: string;
    missionName?: string;
    sortOrder?: number;
  };

  const session = requireAdminSession(payload.session);
  if (!session) {
    return NextResponse.json({ error: "Sessione admin assente" }, { status: 401 });
  }
  const forbidden = requireAdminRole(session);
  if (forbidden) {
    return forbidden;
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

  const { data: exerciseOwned, error: exErr } = await admin
    .from("exercises")
    .select("id")
    .eq("id", exerciseId)
    .eq("owner_admin_id", ownerId)
    .maybeSingle();

  if (exErr) {
    return NextResponse.json({ error: exErr.message }, { status: 500 });
  }
  if (!exerciseOwned) {
    return NextResponse.json(
      { error: "Esercitazione non trovata o non autorizzata per questo account." },
      { status: 403 },
    );
  }

  const rawCode = typeof payload.missionCode === "string" ? payload.missionCode.trim() : "";
  const missionCode = rawCode
    .toUpperCase()
    .replace(/\s+/g, "_")
    .replace(/[^A-Z0-9_]/g, "");
  const missionName =
    typeof payload.missionName === "string" ? payload.missionName.trim() : "";
  if (!missionCode || missionCode.length < 2) {
    return NextResponse.json(
      { error: "Codice missione obbligatorio (es. ALFA, M1)." },
      { status: 400 },
    );
  }
  if (!missionName) {
    return NextResponse.json({ error: "Nome missione obbligatorio." }, { status: 400 });
  }

  const sortOrder =
    typeof payload.sortOrder === "number" && Number.isFinite(payload.sortOrder)
      ? Math.floor(payload.sortOrder)
      : 0;

  const { data, error } = await admin
    .from("missions")
    .insert({
      exercise_id: exerciseId,
      mission_code: missionCode,
      mission_name: missionName,
      sort_order: sortOrder,
      is_enabled: true,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.code === "23505" ? 409 : 500 },
    );
  }

  return NextResponse.json({ ok: true, id: data?.id });
}

export async function PATCH(request: Request) {
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
    id?: string;
    missionCode?: string | null;
    missionName?: string | null;
    sortOrder?: number | null;
    isEnabled?: boolean | null;
  };

  const session = requireAdminSession(payload.session);
  if (!session) {
    return NextResponse.json({ error: "Sessione admin assente" }, { status: 401 });
  }
  const forbidden = requireAdminRole(session);
  if (forbidden) {
    return forbidden;
  }

  const id = typeof payload.id === "string" ? payload.id.trim() : "";
  if (!id || !isUuid(id)) {
    return NextResponse.json({ error: "id UUID obbligatorio" }, { status: 400 });
  }

  const ownerRes = await resolveOwnerAdminId(admin, session);
  if ("error" in ownerRes) {
    return ownerRes.error;
  }
  const ownerId = ownerRes.id;

  const { data: missionRow, error: missionSelErr } = await admin
    .from("missions")
    .select("id, exercise_id")
    .eq("id", id)
    .maybeSingle();

  if (missionSelErr) {
    return NextResponse.json({ error: missionSelErr.message }, { status: 500 });
  }
  if (!missionRow) {
    return NextResponse.json({ error: "Missione non trovata." }, { status: 404 });
  }

  const { data: exerciseOwned, error: exOwnErr } = await admin
    .from("exercises")
    .select("id")
    .eq("id", missionRow.exercise_id as string)
    .eq("owner_admin_id", ownerId)
    .maybeSingle();

  if (exOwnErr) {
    return NextResponse.json({ error: exOwnErr.message }, { status: 500 });
  }
  if (!exerciseOwned) {
    return NextResponse.json(
      { error: "Missione non autorizzata per questo account." },
      { status: 403 },
    );
  }

  const patch: Record<string, string | number | boolean> = {};
  if (typeof payload.missionCode === "string") {
    const c = payload.missionCode
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "_")
      .replace(/[^A-Z0-9_]/g, "");
    if (c.length >= 2) {
      patch.mission_code = c;
    }
  }
  if (typeof payload.missionName === "string") {
    const n = payload.missionName.trim();
    if (n) {
      patch.mission_name = n;
    }
  }
  if (typeof payload.sortOrder === "number" && Number.isFinite(payload.sortOrder)) {
    patch.sort_order = Math.floor(payload.sortOrder);
  }
  if (typeof payload.isEnabled === "boolean") {
    patch.is_enabled = payload.isEnabled;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nessun campo da aggiornare." }, { status: 400 });
  }

  const { error } = await admin.from("missions").update(patch).eq("id", id);

  if (error) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.code === "23505" ? 409 : 500 },
    );
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
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
    id?: string;
  };

  const session = requireAdminSession(payload.session);
  if (!session) {
    return NextResponse.json({ error: "Sessione admin assente" }, { status: 401 });
  }
  const forbidden = requireAdminRole(session);
  if (forbidden) {
    return forbidden;
  }

  const id = typeof payload.id === "string" ? payload.id.trim() : "";
  if (!id || !isUuid(id)) {
    return NextResponse.json({ error: "id UUID obbligatorio" }, { status: 400 });
  }

  const ownerRes = await resolveOwnerAdminId(admin, session);
  if ("error" in ownerRes) {
    return ownerRes.error;
  }
  const ownerId = ownerRes.id;

  const { data: missionRow, error: missionSelErr } = await admin
    .from("missions")
    .select("id, exercise_id")
    .eq("id", id)
    .maybeSingle();

  if (missionSelErr) {
    return NextResponse.json({ error: missionSelErr.message }, { status: 500 });
  }
  if (!missionRow) {
    return NextResponse.json({ error: "Missione non trovata." }, { status: 404 });
  }

  const { data: exerciseOwned, error: exOwnErr } = await admin
    .from("exercises")
    .select("id")
    .eq("id", missionRow.exercise_id as string)
    .eq("owner_admin_id", ownerId)
    .maybeSingle();

  if (exOwnErr) {
    return NextResponse.json({ error: exOwnErr.message }, { status: 500 });
  }
  if (!exerciseOwned) {
    return NextResponse.json(
      { error: "Missione non autorizzata per questo account." },
      { status: 403 },
    );
  }

  const { error } = await admin.from("missions").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
