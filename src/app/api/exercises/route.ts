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
      { error: "Solo un amministratore può modificare le esercitazioni." },
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
    title?: string;
    description?: string | null;
    isActive?: boolean | null;
  };

  const session = requireAdminSession(payload.session);
  if (!session) {
    return NextResponse.json({ error: "Sessione admin assente" }, { status: 401 });
  }
  const forbidden = requireAdminRole(session);
  if (forbidden) {
    return forbidden;
  }

  const ownerRes = await resolveOwnerAdminId(admin, session);
  if ("error" in ownerRes) {
    return ownerRes.error;
  }
  const ownerId = ownerRes.id;

  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "Titolo esercitazione obbligatorio." }, { status: 400 });
  }

  const description =
    typeof payload.description === "string" ? payload.description.trim() : "";
  const isActive = payload.isActive === true;

  if (isActive) {
    await admin
      .from("exercises")
      .update({ is_active: false })
      .eq("owner_admin_id", ownerId);
  }

  const { data, error } = await admin
    .from("exercises")
    .insert({
      title,
      description: description || null,
      is_active: isActive,
      owner_admin_id: ownerId,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: 500 },
    );
  }

  const newId = data?.id as string | undefined;
  return NextResponse.json({ ok: true, id: newId });
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
    title?: string | null;
    description?: string | null;
    isActive?: boolean | null;
  };

  const session = requireAdminSession(payload.session);
  if (!session) {
    return NextResponse.json({ error: "Sessione admin assente" }, { status: 401 });
  }
  const forbidden = requireAdminRole(session);
  if (forbidden) {
    return forbidden;
  }

  const ownerRes = await resolveOwnerAdminId(admin, session);
  if ("error" in ownerRes) {
    return ownerRes.error;
  }
  const ownerId = ownerRes.id;

  const id = typeof payload.id === "string" ? payload.id.trim() : "";
  if (!id || !isUuid(id)) {
    return NextResponse.json({ error: "id UUID obbligatorio" }, { status: 400 });
  }

  const { data: owned, error: ownErr } = await admin
    .from("exercises")
    .select("id")
    .eq("id", id)
    .eq("owner_admin_id", ownerId)
    .maybeSingle();

  if (ownErr) {
    return NextResponse.json({ error: ownErr.message }, { status: 500 });
  }
  if (!owned) {
    return NextResponse.json(
      { error: "Esercitazione non trovata o non autorizzata per questo account." },
      { status: 404 },
    );
  }

  const patch: Record<string, string | boolean | null> = {};
  if (typeof payload.title === "string") {
    const t = payload.title.trim();
    if (t) {
      patch.title = t;
    }
  }
  if (typeof payload.description === "string") {
    patch.description = payload.description.trim() || null;
  }
  if (typeof payload.isActive === "boolean") {
    patch.is_active = payload.isActive;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nessun campo da aggiornare." }, { status: 400 });
  }

  if (patch.is_active === true) {
    await admin
      .from("exercises")
      .update({ is_active: false })
      .eq("owner_admin_id", ownerId)
      .neq("id", id);
  }

  const { error } = await admin.from("exercises").update(patch).eq("id", id).eq("owner_admin_id", ownerId);

  if (error) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: 500 },
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

  const ownerRes = await resolveOwnerAdminId(admin, session);
  if ("error" in ownerRes) {
    return ownerRes.error;
  }
  const ownerId = ownerRes.id;

  const id = typeof payload.id === "string" ? payload.id.trim() : "";
  if (!id || !isUuid(id)) {
    return NextResponse.json({ error: "id UUID obbligatorio" }, { status: 400 });
  }

  const { data: owned, error: ownErr } = await admin
    .from("exercises")
    .select("id")
    .eq("id", id)
    .eq("owner_admin_id", ownerId)
    .maybeSingle();

  if (ownErr) {
    return NextResponse.json({ error: ownErr.message }, { status: 500 });
  }
  if (!owned) {
    return NextResponse.json(
      { error: "Esercitazione non trovata o non autorizzata per questo account." },
      { status: 404 },
    );
  }

  const { error } = await admin.from("exercises").delete().eq("id", id).eq("owner_admin_id", ownerId);

  if (error) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.code === "23503" ? 409 : 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
