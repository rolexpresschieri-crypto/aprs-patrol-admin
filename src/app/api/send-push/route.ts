import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { getFirebaseAdminMessaging } from "@/lib/firebase-admin-app";
import { normalizeAdminRole, type AdminSessionData } from "@/lib/admin-auth";

/** Deve coincidere con `toc_operational_alerts` in toc_app (MainActivity + push_notifications). */
const ANDROID_NOTIFICATION_CHANNEL_ID = "toc_operational_alerts";

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
          "SUPABASE_SERVICE_ROLE_KEY o URL mancanti sul server. Configura le variabili in Vercel / .env.local.",
        code: "SERVICE_ROLE_NOT_CONFIGURED",
      },
      { status: 501 },
    );
  }

  const messaging = getFirebaseAdminMessaging();
  if (!messaging) {
    return NextResponse.json(
      {
        error:
          "Firebase Admin non configurato. Imposta FIREBASE_SERVICE_ACCOUNT_JSON (JSON service account) in Vercel / .env.local.",
        code: "FIREBASE_ADMIN_NOT_CONFIGURED",
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
    sessionId?: string;
    title?: string;
    body?: string;
  };

  const adminSession = payload.session;
  if (!adminSession?.code) {
    return NextResponse.json({ error: "Sessione admin assente" }, { status: 401 });
  }

  const role = normalizeAdminRole(adminSession.role);
  if (role !== "admin" && role !== "viewer") {
    return NextResponse.json({ error: "Ruolo non valido" }, { status: 403 });
  }

  const sessionId = typeof payload.sessionId === "string" ? payload.sessionId.trim() : "";
  if (!sessionId || !isUuid(sessionId)) {
    return NextResponse.json({ error: "sessionId UUID obbligatorio" }, { status: 400 });
  }

  const title =
    typeof payload.title === "string" && payload.title.trim()
      ? payload.title.trim()
      : "TOC — avviso operativo";
  const bodyText =
    typeof payload.body === "string" && payload.body.trim()
      ? payload.body.trim()
      : "Messaggio dal Tactical Operations Center.";

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: sessionRow, error: sessionErr } = await admin
    .from("patrol_sessions")
    .select("id, is_online")
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionErr) {
    return NextResponse.json({ error: sessionErr.message }, { status: 500 });
  }

  if (!sessionRow) {
    return NextResponse.json({ error: "Sessione pattuglia non trovata" }, { status: 404 });
  }

  if (!sessionRow.is_online) {
    return NextResponse.json(
      { error: "La sessione non risulta online: nessun invio push." },
      { status: 409 },
    );
  }

  const { data: tokenRow, error: tokenErr } = await admin
    .from("patrol_fcm_tokens")
    .select("fcm_token")
    .eq("session_id", sessionId)
    .maybeSingle();

  if (tokenErr) {
    return NextResponse.json({ error: tokenErr.message }, { status: 500 });
  }

  const token = tokenRow?.fcm_token as string | undefined;
  if (!token) {
    return NextResponse.json(
      {
        error:
          "Nessun token FCM registrato per questa sessione. Verifica che l'app pattuglia abbia Firebase e abbia eseguito login dopo l'aggiornamento.",
        code: "NO_FCM_TOKEN",
      },
      { status: 404 },
    );
  }

  try {
    const messageId = await messaging.send({
      token,
      notification: {
        title,
        body: bodyText,
      },
      android: {
        notification: {
          channelId: ANDROID_NOTIFICATION_CHANNEL_ID,
        },
      },
    });

    return NextResponse.json({
      ok: true,
      messageId,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Errore invio FCM";
    return NextResponse.json({ error: msg, code: "FCM_SEND_FAILED" }, { status: 502 });
  }
}
