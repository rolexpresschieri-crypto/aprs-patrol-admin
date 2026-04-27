export const ADMIN_SESSION_STORAGE_KEY = "aprs_patrol_admin_session";

export type AdminRole = "admin" | "viewer";

export type AdminSessionData = {
  code: string;
  name: string;
  role: AdminRole;
  /** UUID riga `public.admins.id` (impostato al login; usato per filtrare esercitazioni/missioni). */
  adminId?: string;
};

export function normalizeAdminRole(value: string | null | undefined): AdminRole {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return v === "viewer" ? "viewer" : "admin";
}
