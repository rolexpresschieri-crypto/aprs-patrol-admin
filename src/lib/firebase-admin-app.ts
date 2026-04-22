import { cert, getApps, initializeApp, type App, type ServiceAccount } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";

let app: App | null | undefined;

/**
 * Inizializza Firebase Admin da `FIREBASE_SERVICE_ACCOUNT_JSON` (stringa JSON del service account).
 * Su Vercel: Environment Variable, valore = contenuto file JSON su una riga.
 */
export function getFirebaseAdminApp(): App | null {
  if (app !== undefined) {
    return app;
  }

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) {
    app = null;
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const projectId = parsed.project_id ?? parsed.projectId;
    const clientEmail = parsed.client_email ?? parsed.clientEmail;
    if (typeof projectId !== "string" || typeof clientEmail !== "string") {
      app = null;
      return null;
    }
    if (getApps().length > 0) {
      app = getApps()[0]!;
      return app;
    }
    app = initializeApp({
      credential: cert(parsed as ServiceAccount),
    });
    return app;
  } catch {
    app = null;
    return null;
  }
}

export function getFirebaseAdminMessaging() {
  const a = getFirebaseAdminApp();
  if (!a) {
    return null;
  }
  return getMessaging(a);
}
