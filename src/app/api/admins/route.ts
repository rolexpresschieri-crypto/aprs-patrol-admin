import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { normalizeAdminRole, type AdminSessionData } from "@/lib/admin-auth";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ADMIN_CODE_RE = /^[a-z0-9_]{2,40}$/;

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
  return {
    code,
    name: typeof s.name === "string" ? s.name : code,
    role: normalizeAdminRole(s.role as string | null),
  };
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
    action?: string;
    id?: string;
    admin?: Record<string, unknown>;
  };

  const session = requireAdminSession(payload.session);
  if (!session) {
    return NextResponse.json({ error: "Sessione admin assente" }, { status: 401 });
  }

  if (normalizeAdminRole(session.role) !== "admin") {
    return NextResponse.json(
      { error: "Solo un amministratore può gestire gli account backend." },
      { status: 403 },
    );
  }

  const action = typeof payload.action === "string" ? payload.action : "";

  if (action === "list") {
    const { data, error } = await admin
      .from("admins")
      .select("id, admin_code, admin_name, role, is_enabled")
      .order("admin_code", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ admins: data ?? [] });
  }

  const row = payload.admin;
  if (!row || typeof row !== "object") {
    return NextResponse.json({ error: "Dati account mancanti" }, { status: 400 });
  }

  if (action === "create") {
    const code = String(row.admin_code ?? "")
      .trim()
      .toLowerCase();
    if (!ADMIN_CODE_RE.test(code)) {
      return NextResponse.json(
        {
          error:
            "Login non valido: usa 2–40 caratteri tra lettere minuscole, numeri e underscore (es. adm_mario, view_01).",
        },
        { status: 400 },
      );
    }

    const name = String(row.admin_name ?? "").trim();
    if (!name || name.length > 120) {
      return NextResponse.json(
        { error: "Nome obbligatorio (max 120 caratteri)." },
        { status: 400 },
      );
    }

    const pin = String(row.pin_plain ?? "").trim();
    if (pin.length < 4 || pin.length > 200) {
      return NextResponse.json(
        { error: "Password: minimo 4 caratteri, massimo 200." },
        { status: 400 },
      );
    }

    const role = normalizeAdminRole(row.role as string | null);
    const isEnabled = row.is_enabled !== false;

    const { error } = await admin.from("admins").insert({
      admin_code: code,
      admin_name: name,
      pin_hash: pin,
      role,
      is_enabled: isEnabled,
    });

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "Esiste già un account con questo login (admin_code)." },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  }

  if (action === "update") {
    const id = typeof payload.id === "string" ? payload.id.trim() : "";
    if (!id || !UUID_RE.test(id)) {
      return NextResponse.json({ error: "Id account non valido" }, { status: 400 });
    }

    const code = String(row.admin_code ?? "")
      .trim()
      .toLowerCase();
    if (!ADMIN_CODE_RE.test(code)) {
      return NextResponse.json(
        {
          error:
            "Login non valido: usa 2–40 caratteri tra lettere minuscole, numeri e underscore.",
        },
        { status: 400 },
      );
    }

    const name = String(row.admin_name ?? "").trim();
    if (!name || name.length > 120) {
      return NextResponse.json(
        { error: "Nome obbligatorio (max 120 caratteri)." },
        { status: 400 },
      );
    }

    const role = normalizeAdminRole(row.role as string | null);
    const isEnabled = row.is_enabled !== false;
    const pin = String(row.pin_plain ?? "").trim();

    const updates: Record<string, string | boolean> = {
      admin_code: code,
      admin_name: name,
      role,
      is_enabled: isEnabled,
    };

    if (pin.length > 0) {
      if (pin.length < 4 || pin.length > 200) {
        return NextResponse.json(
          { error: "Nuova password: minimo 4 caratteri, massimo 200 (o lascia vuoto per non cambiare)."},
          { status: 400 },
        );
      }
      updates.pin_hash = pin;
    }

    const { error } = await admin.from("admins").update(updates).eq("id", id);

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "Esiste già un altro account con questo login." },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Azione non supportata" }, { status: 400 });
}
