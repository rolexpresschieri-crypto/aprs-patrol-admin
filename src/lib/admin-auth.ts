export const ADMIN_SESSION_STORAGE_KEY = "aprs_patrol_admin_session";

export type AdminRole = "admin" | "viewer";

export type AdminSessionData = {
  code: string;
  name: string;
  role: AdminRole;
};

export function normalizeAdminRole(value: string | null | undefined): AdminRole {
  return value === "viewer" ? "viewer" : "admin";
}
