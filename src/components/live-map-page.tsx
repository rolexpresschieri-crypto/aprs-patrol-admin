"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  ADMIN_SESSION_STORAGE_KEY,
  normalizeAdminRole,
  type AdminSessionData,
} from "@/lib/admin-auth";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import styles from "./live-map-page.module.css";
import {
  formatFixTimestamp,
  formatDurationBetween,
  formatSessionDuration,
  formatTimelineStepDuration,
  formatTimeOnly,
  getStatusColor,
  getStatusLabel,
  hasCoordinates,
  layerOptions,
  mockPatrols,
  mockPatrolRegistry,
  mockWaypoints,
  statusOptions,
  tacticalWaypointsFromRows,
  type LayerMode,
  type LivePatrol,
  type PatrolRegistryItem,
  type PatrolSessionRecord,
  type TacticalWaypoint,
} from "@/lib/live-patrols";

function normalizePatrolStatusForFilter(status: string): string {
  return (status ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_")
    .replace(/\s+/g, "_");
}

const PatrolLiveMap = dynamic(() => import("@/components/patrol-live-map"), {
  ssr: false,
});

const navigationItems = [
  "Dashboard",
  "Mappa Live",
  "Pattuglie",
  "Missioni",
  "Esercitazioni",
  "Sessioni Live",
  "Storico Eventi",
  "Accessi Admin",
  "Export",
  "Admin",
  "Impostazioni",
];

type BackendMode = "live" | "mock";
type AdminView =
  | "live-map"
  | "patrols"
  | "export"
  | "admin-access"
  | "admin-accounts"
  | "live-sessions";
type AdminAccessEvent = {
  id: string;
  adminCode: string;
  adminName: string | null;
  role: string;
  eventType: string;
  occurredAt: string;
};

type AdminAccountRow = {
  id: string;
  admin_code: string;
  admin_name: string;
  role: string;
  is_enabled: boolean;
};

const SUPABASE_BATCH_TIMEOUT_MS = 45_000;

/** Evita che `setLoading(true)` resti per sempre se le query PostgREST non rispondono. */
function raceSupabaseBatch<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      reject(
        new Error(
          `${label}: nessuna risposta entro ${SUPABASE_BATCH_TIMEOUT_MS / 1000}s (rete, progetto Supabase in pausa o blocco browser).`,
        ),
      );
    }, SUPABASE_BATCH_TIMEOUT_MS);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export function LiveMapPage() {
  const router = useRouter();
  const [supabase, setSupabase] = useState<ReturnType<
    typeof getSupabaseBrowserClient
  >>(null);

  useLayoutEffect(() => {
    setSupabase(getSupabaseBrowserClient());
  }, []);

  const [patrols, setPatrols] = useState<LivePatrol[]>(mockPatrols);
  const [missions, setMissions] = useState<string[]>([
    "MISSIONE ALFA",
    "MISSIONE BRAVO",
    "MISSIONE CHARLIE",
  ]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    mockPatrols[0]?.sessionId ?? null,
  );
  const [focusedPatrol, setFocusedPatrol] = useState<LivePatrol | null>(
    mockPatrols[0] ?? null,
  );
  const [layerMode, setLayerMode] = useState<LayerMode>("standard");
  const [statusFilter, setStatusFilter] = useState("all");
  const [missionFilter, setMissionFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(false);
  const [backendMode, setBackendMode] = useState<BackendMode>(
    supabase ? "live" : "mock",
  );
  const [message, setMessage] = useState(
    supabase
      ? "Connessione a Supabase configurata. Il pannello legge i dati reali."
      : "Variabili NEXT_PUBLIC_SUPABASE_* mancanti: pagina attualmente in fallback mock.",
  );
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);
  const [adminView, setAdminView] = useState<AdminView>("live-map");
  const [registryItems, setRegistryItems] =
    useState<PatrolRegistryItem[]>(mockPatrolRegistry);
  const [editingPatrolId, setEditingPatrolId] = useState<string | null>(null);
  const [patrolCodeInput, setPatrolCodeInput] = useState("");
  const [patrolNameInput, setPatrolNameInput] = useState("");
  const [patrolPinInput, setPatrolPinInput] = useState("1234");
  const [patrolEnabledInput, setPatrolEnabledInput] = useState(true);
  const [exportPatrolsSelected, setExportPatrolsSelected] = useState(true);
  const [includePinInExport, setIncludePinInExport] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [session, setSession] = useState<AdminSessionData | null>(null);
  const [loginCode, setLoginCode] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [adminAccessEvents, setAdminAccessEvents] = useState<AdminAccessEvent[]>([]);
  const [adminAccessFilter, setAdminAccessFilter] = useState("all");
  const [adminRoleFilter, setAdminRoleFilter] = useState("all");
  const [sessionRecords, setSessionRecords] = useState<PatrolSessionRecord[]>([]);
  const [adminsManageExpanded, setAdminsManageExpanded] = useState(false);
  const [adminAccountRows, setAdminAccountRows] = useState<AdminAccountRow[]>([]);
  const [adminsModalLoading, setAdminsModalLoading] = useState(false);
  const [adminsModalError, setAdminsModalError] = useState<string | null>(null);
  const [adminsFormMode, setAdminsFormMode] = useState<"idle" | "create" | "edit">(
    "idle",
  );
  const [adminsEditingId, setAdminsEditingId] = useState<string | null>(null);
  const [adminsFormCode, setAdminsFormCode] = useState("");
  const [adminsFormName, setAdminsFormName] = useState("");
  const [adminsFormPin, setAdminsFormPin] = useState("");
  const [adminsFormRole, setAdminsFormRole] = useState<"admin" | "viewer">("admin");
  const [adminsFormEnabled, setAdminsFormEnabled] = useState(true);

  const [waypoints, setWaypoints] = useState<TacticalWaypoint[]>([]);
  const [waypointBusy, setWaypointBusy] = useState(false);
  const [waypointFeedError, setWaypointFeedError] = useState<string | null>(null);

  const sidePanelsScrollRef = useRef<HTMLDivElement | null>(null);
  const mainScrollRef = useRef<HTMLElement | null>(null);

  const isViewer = session?.role === "viewer";
  const canEdit = session?.role === "admin";

  useEffect(() => {
    if (isViewer && adminView === "admin-accounts") {
      setAdminView("live-map");
      setAdminsManageExpanded(false);
    }
  }, [isViewer, adminView]);

  useEffect(() => {
    if (adminView !== "admin-accounts") {
      setAdminsManageExpanded(false);
    }
  }, [adminView]);

  useEffect(() => {
    const rawSession = window.localStorage.getItem(ADMIN_SESSION_STORAGE_KEY);

    if (rawSession) {
      try {
        const parsed = JSON.parse(rawSession) as AdminSessionData;
        setSession({
          code: parsed.code,
          name: parsed.name,
          role: normalizeAdminRole(parsed.role),
        });
      } catch {
        window.localStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
      }
    }

    setAuthChecked(true);
  }, []);

  const loadData = useCallback(async () => {
    if (!supabase) {
      setPatrols(mockPatrols);
      setMissions(["MISSIONE ALFA", "MISSIONE BRAVO", "MISSIONE CHARLIE"]);
      setWaypoints(mockWaypoints);
      setWaypointFeedError(null);
      setBackendMode("mock");
      setLastRefreshAt(new Date().toISOString());
      return;
    }

    setLoading(true);

    try {
      const loadWarnings: string[] = [];

      let patrolResult;
      let missionResult;
      let registryResult;

      try {
        [patrolResult, missionResult, registryResult] = await raceSupabaseBatch(
          Promise.all([
            supabase
              .from("active_patrol_summaries")
              .select(
                "session_id, exercise_id, patrol_id, patrol_code, patrol_name, mission_id, mission_name, current_status, last_status_at, is_online, last_latitude, last_longitude, last_accuracy, last_fix_at",
              )
              .order("patrol_code", { ascending: true }),
            supabase
              .from("missions")
              .select("mission_name")
              .eq("is_enabled", true)
              .order("sort_order", { ascending: true }),
            supabase
              .from("patrols")
              .select("id, patrol_code, patrol_name, pin_hash, is_enabled, created_at")
              .order("patrol_code", { ascending: true }),
          ]),
          "Riepilogo pattuglie e missioni",
        );
      } catch (batchErr) {
        const msg =
          batchErr instanceof Error ? batchErr.message : String(batchErr);
        loadWarnings.push(`Riepilogo pattuglie: ${msg}`);
        patrolResult = { data: [], error: null };
        missionResult = { data: [], error: null };
        registryResult = { data: [], error: null };
      }

      let accessResult;
      let sessionsResult;
      let statusEventsResult;

      try {
        [accessResult, sessionsResult, statusEventsResult] =
          await raceSupabaseBatch(
            Promise.all([
              supabase
                .from("admin_access_events")
                .select("id, admin_code, admin_name, role, event_type, occurred_at")
                .order("occurred_at", { ascending: false })
                .limit(100),
              supabase
                .from("patrol_sessions")
                .select(
                  "id, exercise_id, patrol_id, mission_id, is_online, login_at, logout_at, last_status_at, current_status, patrols!inner(patrol_code, patrol_name), missions(mission_name)",
                )
                .order("login_at", { ascending: false })
                .limit(100),
              supabase
                .from("patrol_status_events")
                .select(
                  "session_id, mission_id, status, changed_at, missions(mission_name)",
                )
                .in("status", [
                  "start_mission",
                  "moving",
                  "target",
                  "operation_start",
                  "operation_end",
                  "standby",
                  "end_mission",
                ])
                .order("changed_at", { ascending: true })
                .limit(500),
            ]),
            "Storico sessioni ed eventi",
          );
      } catch (batchErr) {
        const msg =
          batchErr instanceof Error ? batchErr.message : String(batchErr);
        loadWarnings.push(`Storico sessioni/eventi (saltato): ${msg}`);
        accessResult = { data: [], error: null };
        sessionsResult = { data: [], error: null };
        statusEventsResult = { data: [], error: null };
      }

      if (patrolResult.error) {
        loadWarnings.push(
          `active_patrol_summaries: ${patrolResult.error.message}`,
        );
      }
      if (missionResult.error) {
        loadWarnings.push(`missions: ${missionResult.error.message}`);
      }
      if (registryResult.error) {
        loadWarnings.push(`patrols: ${registryResult.error.message}`);
      }
      if (accessResult.error) {
        loadWarnings.push(`admin_access_events: ${accessResult.error.message}`);
      }
      if (sessionsResult.error) {
        loadWarnings.push(`patrol_sessions: ${sessionsResult.error.message}`);
      }
      if (statusEventsResult.error) {
        loadWarnings.push(`patrol_status_events: ${statusEventsResult.error.message}`);
      }

      const nextPatrols: LivePatrol[] = (
        patrolResult.error ? [] : patrolResult.data ?? []
      ).map((row) => ({
        sessionId: row.session_id as string,
        exerciseId: row.exercise_id as string,
        patrolId: row.patrol_id as string,
        patrolCode: row.patrol_code as string,
        patrolName: row.patrol_name as string,
        missionId: (row.mission_id as string | null) ?? null,
        missionName: (row.mission_name as string | null) ?? null,
        status: row.current_status as string,
        isOnline: Boolean(row.is_online),
        lastLatitude: (row.last_latitude as number | null) ?? null,
        lastLongitude: (row.last_longitude as number | null) ?? null,
        lastAccuracy: (row.last_accuracy as number | null) ?? null,
        lastFixAt: (row.last_fix_at as string | null) ?? null,
        lastStatusAt: row.last_status_at as string,
      }));

      const fallbackPatrolsFromSessions: LivePatrol[] = (
        sessionsResult.error ? [] : sessionsResult.data ?? []
      )
        .filter((row) => Boolean(row.is_online))
        .map((row) => {
          const patrolData = row.patrols as
            | { patrol_code?: string; patrol_name?: string }
            | Array<{ patrol_code?: string; patrol_name?: string }>
            | null;
          const missionData = row.missions as
            | { mission_name?: string }
            | Array<{ mission_name?: string }>
            | null;

          const patrol = Array.isArray(patrolData) ? patrolData[0] : patrolData;
          const mission = Array.isArray(missionData) ? missionData[0] : missionData;

          return {
            sessionId: row.id as string,
            exerciseId: row.exercise_id as string,
            patrolId: row.patrol_id as string,
            patrolCode: patrol?.patrol_code ?? "n/d",
            patrolName: patrol?.patrol_name ?? "n/d",
            missionId: (row.mission_id as string | null) ?? null,
            missionName: (mission?.mission_name as string | null) ?? null,
            status: String(row.current_status ?? "start_mission"),
            isOnline: Boolean(row.is_online),
            lastLatitude: null,
            lastLongitude: null,
            lastAccuracy: null,
            lastFixAt: null,
            lastStatusAt: row.last_status_at as string,
          };
        });

      let patrolsForState = nextPatrols;
      if (patrolsForState.length === 0 && fallbackPatrolsFromSessions.length > 0) {
        patrolsForState = fallbackPatrolsFromSessions;
        loadWarnings.push(
          "Lista pattuglie: uso `patrol_sessions` perché `active_patrol_summaries` non ha restituito righe (vista o RLS). Coordinate GPS possono mancare.",
        );
      }

      if (loadWarnings.length > 0) {
        console.warn("[APRS Patrol Admin] loadData avvisi parziali:", loadWarnings);
      }

      const nextMissions = Array.from(
        new Set(
          (missionResult.error ? [] : missionResult.data ?? [])
            .map((row) => row.mission_name as string | null)
            .filter((value): value is string => Boolean(value)),
        ),
      );

      const nextRegistry: PatrolRegistryItem[] = (
        registryResult.error ? [] : registryResult.data ?? []
      ).map(
        (row) => ({
          id: row.id as string,
          patrolCode: row.patrol_code as string,
          patrolName: row.patrol_name as string,
          pinHash: (row.pin_hash as string | null) ?? "",
          isEnabled: Boolean(row.is_enabled),
          createdAt: row.created_at as string,
        }),
      );

      const nextAccessEvents: AdminAccessEvent[] = (
        accessResult.error ? [] : accessResult.data ?? []
      ).map(
        (row) => ({
          id: row.id as string,
          adminCode: row.admin_code as string,
          adminName: (row.admin_name as string | null) ?? null,
          role: (row.role as string | null) ?? "admin",
          eventType: row.event_type as string,
          occurredAt: row.occurred_at as string,
        }),
      );

      const statusTimelineBySession = new Map<
        string,
        Array<{
          missionId: string | null;
          missionName: string | null;
          status: string;
          changedAt: string;
        }>
      >();

      for (const row of statusEventsResult.error
        ? []
        : statusEventsResult.data ?? []) {
        const sessionId = row.session_id as string | null;
        const missionId = (row.mission_id as string | null) ?? null;
        const missionData = row.missions as
          | { mission_name?: string }
          | Array<{ mission_name?: string }>
          | null;
        const mission = Array.isArray(missionData) ? missionData[0] : missionData;
        const missionName = (mission?.mission_name as string | undefined) ?? null;
        const status = row.status as string;
        const changedAt = row.changed_at as string;

        if (!sessionId) {
          continue;
        }

        const timeline = statusTimelineBySession.get(sessionId) ?? [];
        timeline.push({
          missionId,
          missionName,
          status,
          changedAt,
        });
        statusTimelineBySession.set(sessionId, timeline);
      }

      const nextSessionRecords: PatrolSessionRecord[] = (
        sessionsResult.error ? [] : sessionsResult.data ?? []
      ).map(
        (row) => {
          const patrolData = row.patrols as
            | { patrol_code?: string; patrol_name?: string }
            | Array<{ patrol_code?: string; patrol_name?: string }>
            | null;
          const missionData = row.missions as
            | { mission_name?: string }
            | Array<{ mission_name?: string }>
            | null;

          const patrol = Array.isArray(patrolData) ? patrolData[0] : patrolData;
          const statusTimeline = statusTimelineBySession.get(row.id as string) ?? [];
          const missionGroups = statusTimeline.reduce<
            PatrolSessionRecord["missionGroups"]
          >((groups, event) => {
            const lastGroup = groups[groups.length - 1];
            const shouldStartNewGroup =
              !lastGroup ||
              event.status === "start_mission" ||
              lastGroup.missionId !== event.missionId;

            if (shouldStartNewGroup) {
              groups.push({
                missionId: event.missionId,
                missionName: event.missionName,
                startMissionAt: event.status === "start_mission" ? event.changedAt : null,
                targetAt: event.status === "target" ? event.changedAt : null,
                endMissionAt: event.status === "end_mission" ? event.changedAt : null,
                events: [
                  {
                    status: event.status,
                    changedAt: event.changedAt,
                  },
                ],
              });
              return groups;
            }

            lastGroup.events.push({
              status: event.status,
              changedAt: event.changedAt,
            });

            if (event.status === "start_mission" && !lastGroup.startMissionAt) {
              lastGroup.startMissionAt = event.changedAt;
            }

            if (event.status === "target" && !lastGroup.targetAt) {
              lastGroup.targetAt = event.changedAt;
            }

            if (event.status === "end_mission") {
              lastGroup.endMissionAt = event.changedAt;
            }

            if (!lastGroup.missionName && event.missionName) {
              lastGroup.missionName = event.missionName;
            }

            if (!lastGroup.missionId && event.missionId) {
              lastGroup.missionId = event.missionId;
            }

            return groups;
          }, []);

          return {
            id: row.id as string,
            patrolCode: patrol?.patrol_code ?? "n/d",
            patrolName: patrol?.patrol_name ?? "n/d",
            status: row.current_status as string,
            isOnline: Boolean(row.is_online),
            loginAt: row.login_at as string,
            logoutAt: (row.logout_at as string | null) ?? null,
            lastStatusAt: row.last_status_at as string,
            missionGroups,
            statusTimeline,
          };
        },
      );

      let wpRes;

      try {
        wpRes = await raceSupabaseBatch(
          Promise.resolve(
            supabase
              .from("tactical_map_points")
              .select("*")
              .order("created_at", { ascending: false })
              .limit(400),
          ),
          "Lettura waypoint",
        );
      } catch (batchErr) {
        const msg =
          batchErr instanceof Error ? batchErr.message : String(batchErr);
        loadWarnings.push(`Waypoint (saltato): ${msg}`);
        wpRes = { data: [], error: { message: msg } };
      }

      if (!wpRes.error && wpRes.data) {
        setWaypoints(tacticalWaypointsFromRows(wpRes.data as Record<string, unknown>[]));
        setWaypointFeedError(null);
      } else {
        if (wpRes.error) {
          console.warn("tactical_map_points:", wpRes.error.message);
          setWaypointFeedError(
            `Lettura waypoint non riuscita: ${wpRes.error.message}. Verifica tabella e policy RLS su tactical_map_points.`,
          );
          setWaypoints([]);
        }
      }

      setPatrols(patrolsForState);
      setMissions(nextMissions);
      setRegistryItems(nextRegistry);
      setAdminAccessEvents(nextAccessEvents);
      setSessionRecords(nextSessionRecords);
      setBackendMode("live");
      const baseLiveMessage =
        patrolsForState.length > 0
          ? "Feed live caricato da Supabase. Marker e lista sono aggiornati dal backend."
          : "Connessione live attiva: nessuna pattuglia nel riepilogo operativo.";
      setMessage(
        loadWarnings.length > 0
          ? `${baseLiveMessage} Alcune letture sono fallite (dettaglio in console): ${loadWarnings.join(" · ")}`
          : baseLiveMessage,
      );
      setLastRefreshAt(new Date().toISOString());
    } catch (error) {
      const errorText =
        error instanceof Error ? error.message : "Errore sconosciuto.";
      setBackendMode("mock");
      setPatrols(mockPatrols);
      setMissions(["MISSIONE ALFA", "MISSIONE BRAVO", "MISSIONE CHARLIE"]);
      setWaypoints(mockWaypoints);
      setRegistryItems(mockPatrolRegistry);
      setAdminAccessEvents([]);
      setSessionRecords([]);
      setMessage(
        `Lettura live non riuscita: ${errorText}. Rimango in fallback mock per proseguire il lavoro UI.`,
      );
      setLastRefreshAt(new Date().toISOString());
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  const refreshWaypointsOnly = useCallback(async () => {
    if (!supabase) {
      setWaypoints(mockWaypoints);
      return;
    }

    const { data, error } = await supabase
      .from("tactical_map_points")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(400);

    if (!error && data) {
      setWaypoints(tacticalWaypointsFromRows(data as Record<string, unknown>[]));
      setWaypointFeedError(null);
    } else if (error) {
      setWaypointFeedError(
        `Aggiornamento waypoint: ${error.message}`,
      );
    }
  }, [supabase]);

  useEffect(() => {
    if (!authChecked || !session) {
      return;
    }
    void loadData();
  }, [authChecked, loadData, session, supabase]);

  useEffect(() => {
    if (!authChecked || !supabase || !session) {
      return;
    }

    const channel = supabase
      .channel("realtime-tactical-map-points")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tactical_map_points",
        },
        () => {
          void refreshWaypointsOnly();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [authChecked, refreshWaypointsOnly, session, supabase]);

  useEffect(() => {
    if (!authChecked || !session) {
      return;
    }

    const timer = window.setInterval(() => {
      void loadData();
    }, 20000);

    return () => window.clearInterval(timer);
  }, [authChecked, loadData, session]);

  const missionFilterOptions = useMemo(() => {
    const set = new Set<string>();
    for (const mission of missions) {
      const trimmed = mission.trim();
      if (trimmed.length > 0) {
        set.add(trimmed);
      }
    }
    for (const patrol of patrols) {
      const trimmed = (patrol.missionName ?? "").trim();
      if (trimmed.length > 0) {
        set.add(trimmed);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "it"));
  }, [missions, patrols]);

  useEffect(() => {
    if (missionFilter === "all" || missionFilter === "__none__") {
      return;
    }
    if (!missionFilterOptions.includes(missionFilter)) {
      setMissionFilter("all");
    }
  }, [missionFilter, missionFilterOptions]);

  const filteredPatrols = useMemo(() => {
    return patrols.filter((patrol) => {
      const patrolStatus = (patrol.status ?? "").trim();
      const matchesStatus =
        statusFilter === "all"
          ? true
          : normalizePatrolStatusForFilter(patrolStatus) ===
            normalizePatrolStatusForFilter(statusFilter);

      const missionKey = (patrol.missionName ?? "").trim();
      const matchesMission =
        missionFilter === "all"
          ? true
          : missionFilter === "__none__"
            ? missionKey.length === 0
            : missionKey === missionFilter;

      const query = searchTerm.trim().toLowerCase();
      const code = (patrol.patrolCode ?? "").toLowerCase();
      const name = (patrol.patrolName ?? "").toLowerCase();
      const matchesSearch =
        query.length === 0 ? true : code.includes(query) || name.includes(query);

      return matchesStatus && matchesMission && matchesSearch;
    });
  }, [missionFilter, patrols, searchTerm, statusFilter]);

  const resetLiveMapFilters = useCallback(() => {
    setStatusFilter("all");
    setMissionFilter("all");
    setSearchTerm("");
  }, []);

  const selectedPatrol =
    filteredPatrols.find((patrol) => patrol.sessionId === selectedSessionId) ??
    filteredPatrols[0] ??
    null;

  useEffect(() => {
    if (!selectedPatrol) {
      setSelectedSessionId(null);
      return;
    }

    if (selectedPatrol.sessionId !== selectedSessionId) {
      setSelectedSessionId(selectedPatrol.sessionId);
    }
  }, [selectedPatrol, selectedSessionId]);

  const onlineCount = patrols.filter((patrol) => patrol.isOnline).length;
  const withFixCount = patrols.filter((patrol) => hasCoordinates(patrol)).length;
  const missionCount = new Set(
    patrols
      .map((patrol) => patrol.missionName)
      .filter((value): value is string => Boolean(value)),
  ).size;

  const filteredAdminAccessEvents = useMemo(() => {
    return adminAccessEvents.filter((event) => {
      const matchesUser =
        adminAccessFilter === "all" ? true : event.adminCode === adminAccessFilter;
      const matchesRole =
        adminRoleFilter === "all" ? true : event.role === adminRoleFilter;
      return matchesUser && matchesRole;
    });
  }, [adminAccessEvents, adminAccessFilter, adminRoleFilter]);

  const accessUsers = useMemo(() => {
    return Array.from(new Set(adminAccessEvents.map((event) => event.adminCode))).sort();
  }, [adminAccessEvents]);

  async function handleDeleteWaypointFromMap(waypoint: TacticalWaypoint) {
    if (!supabase || !canEdit) {
      setMessage("Eliminazione waypoint non consentita.");
      return;
    }

    const confirmed = window.confirm(
      `Eliminare il waypoint "${waypoint.label?.trim() || "senza nome"}"?`,
    );

    if (!confirmed) {
      return;
    }

    setWaypointBusy(true);

    try {
      const { error } = await supabase
        .from("tactical_map_points")
        .delete()
        .eq("id", waypoint.id);

      if (error) {
        throw error;
      }

      setMessage("Waypoint eliminato.");
      await refreshWaypointsOnly();
    } catch (error) {
      const errorText =
        error instanceof Error ? error.message : "Errore sconosciuto.";
      setMessage(`Eliminazione waypoint: ${errorText}`);
    } finally {
      setWaypointBusy(false);
    }
  }

  async function handleForceLogout(patrol: LivePatrol) {
    if (!canEdit) {
      setMessage("Profilo viewer: force logout non consentito.");
      return;
    }

    const confirmed = window.confirm(
      `Vuoi chiudere la sessione online di ${patrol.patrolCode} - ${patrol.patrolName}?`,
    );

    if (!confirmed) {
      return;
    }

    if (!supabase) {
      setPatrols((current) =>
        current.map((item) =>
          item.sessionId === patrol.sessionId
            ? { ...item, isOnline: false, lastFixAt: item.lastFixAt }
            : item,
        ),
      );
      setMessage(
        `Force logout simulato per ${patrol.patrolCode}. Configura Supabase per l'azione live.`,
      );
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase
        .from("patrol_sessions")
        .update({
          is_online: false,
          logout_at: new Date().toISOString(),
        })
        .eq("id", patrol.sessionId);

      if (error) {
        throw error;
      }

      setMessage(`Force logout eseguito per ${patrol.patrolCode}.`);
      await loadData();
    } catch (error) {
      const errorText =
        error instanceof Error ? error.message : "Errore sconosciuto.";
      setMessage(`Force logout non riuscito: ${errorText}`);
    } finally {
      setLoading(false);
    }
  }

  function resetPatrolForm() {
    setEditingPatrolId(null);
    setPatrolCodeInput("");
    setPatrolNameInput("");
    setPatrolPinInput("1234");
    setPatrolEnabledInput(true);
  }

  function startEditingPatrol(item: PatrolRegistryItem) {
    setEditingPatrolId(item.id);
    setPatrolCodeInput(item.patrolCode);
    setPatrolNameInput(item.patrolName);
    setPatrolPinInput(item.pinHash);
    setPatrolEnabledInput(item.isEnabled);
    setAdminView("patrols");
  }

  async function handleSavePatrol() {
    if (!canEdit) {
      setMessage("Profilo viewer: modifica pattuglie non consentita.");
      return;
    }

    const code = patrolCodeInput.trim().toUpperCase();
    const name = patrolNameInput.trim().toUpperCase();
    const pin = patrolPinInput.trim();

    if (!code || !name || !pin) {
      setMessage("Compila codice, nome e PIN della pattuglia.");
      return;
    }

    if (!supabase) {
      const nextItem: PatrolRegistryItem = {
        id: editingPatrolId ?? `mock-${code}`,
        patrolCode: code,
        patrolName: name,
        pinHash: pin,
        isEnabled: patrolEnabledInput,
        createdAt: new Date().toISOString(),
      };

      setRegistryItems((current) => {
        const filtered = current.filter((item) => item.id !== nextItem.id);
        return [...filtered, nextItem].sort((a, b) =>
          a.patrolCode.localeCompare(b.patrolCode),
        );
      });

      setMessage(
        editingPatrolId
          ? `Modifica mock salvata per ${code}.`
          : `Nuova pattuglia mock creata: ${code}.`,
      );
      resetPatrolForm();
      return;
    }

    setLoading(true);

    try {
      if (editingPatrolId) {
        const { data, error } = await supabase
          .from("patrols")
          .update({
            patrol_code: code,
            patrol_name: name,
            pin_hash: pin,
            is_enabled: patrolEnabledInput,
          })
          .select("id, patrol_code")
          .eq("id", editingPatrolId);

        if (error) {
          throw error;
        }

        if (!data || data.length === 0) {
          throw new Error("Nessuna pattuglia aggiornata. Verifica permessi e RLS.");
        }

        setMessage(`Pattuglia ${code} aggiornata correttamente.`);
      } else {
        const { data, error } = await supabase
          .from("patrols")
          .insert({
            patrol_code: code,
            patrol_name: name,
            pin_hash: pin,
            is_enabled: patrolEnabledInput,
          })
          .select("id, patrol_code");

        if (error) {
          throw error;
        }

        if (!data || data.length === 0) {
          throw new Error("Inserimento non confermato dal database. Verifica permessi e RLS.");
        }

        setMessage(`Pattuglia ${code} creata correttamente.`);
      }

      resetPatrolForm();
      await loadData();
    } catch (error) {
      const errorText =
        error instanceof Error ? error.message : "Errore sconosciuto.";
      setMessage(`Salvataggio pattuglia non riuscito: ${errorText}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleTogglePatrol(item: PatrolRegistryItem) {
    if (!canEdit) {
      setMessage("Profilo viewer: modifica pattuglie non consentita.");
      return;
    }

    if (!supabase) {
      setRegistryItems((current) =>
        current.map((patrol) =>
          patrol.id === item.id
            ? { ...patrol, isEnabled: !patrol.isEnabled }
            : patrol,
        ),
      );
      setMessage(
        `${item.patrolCode} ${item.isEnabled ? "disabilitata" : "abilitata"} in modalità mock.`,
      );
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase
        .from("patrols")
        .update({ is_enabled: !item.isEnabled })
        .eq("id", item.id);

      if (error) {
        throw error;
      }

      setMessage(
        `${item.patrolCode} ${item.isEnabled ? "disabilitata" : "abilitata"} correttamente.`,
      );
      await loadData();
    } catch (error) {
      const errorText =
        error instanceof Error ? error.message : "Errore sconosciuto.";
      setMessage(`Aggiornamento pattuglia non riuscito: ${errorText}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleDeletePatrol(item: PatrolRegistryItem) {
    if (!canEdit) {
      setMessage("Profilo viewer: cancellazione pattuglie non consentita.");
      return;
    }

    const confirmed = window.confirm(
      `Vuoi cancellare definitivamente ${item.patrolCode} - ${item.patrolName}?`,
    );

    if (!confirmed) {
      return;
    }

    if (!supabase) {
      setRegistryItems((current) =>
        current.filter((patrol) => patrol.id !== item.id),
      );

      if (editingPatrolId === item.id) {
        resetPatrolForm();
      }

      setMessage(`Pattuglia ${item.patrolCode} eliminata in modalità mock.`);
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.from("patrols").delete().eq("id", item.id);

      if (error) {
        throw error;
      }

      if (editingPatrolId === item.id) {
        resetPatrolForm();
      }

      setMessage(`Pattuglia ${item.patrolCode} eliminata correttamente.`);
      await loadData();
    } catch (error) {
      const errorText =
        error instanceof Error ? error.message : "Errore sconosciuto.";
      setMessage(
        `Eliminazione pattuglia non riuscita: ${errorText}. Se la pattuglia ha sessioni o eventi collegati, il database può bloccare la cancellazione.`,
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleResetAdminAccessHistory() {
    if (!canEdit) {
      setMessage("Profilo viewer: reset storico accessi non consentito.");
      return;
    }

    const confirmed = window.confirm(
      "Azzerare lo storico in tabella «accessi admin» (login/logout pannello)?\n\n" +
        "Non chiude le sessioni pattuglie in mappa: per quelle apri «Sessioni Live» (CHIUDI / pattuglie online) o conferma anche il passo successivo.",
    );

    if (!confirmed) {
      return;
    }

    if (!supabase) {
      setAdminAccessEvents([]);
      setMessage("Storico accessi azzerato in modalità mock.");
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase
        .from("admin_access_events")
        .delete()
        .not("id", "is", null);

      if (error) {
        throw error;
      }

      setMessage("Storico accessi admin azzerato correttamente.");

      const nOnlineMap = patrols.filter((p) => p.isOnline).length;
      const alsoLive = window.confirm(
        nOnlineMap > 0
          ? `Vuoi chiudere anche le ${nOnlineMap} sessioni segnate come online (come CHIUDI / pattuglie online)?`
          : "In mappa nessuna pattuglia risulta online. Vuoi comunque eseguire il reset lato database (allinea is_online / ping; come CHIUDI / pattuglie online)?",
      );

      if (alsoLive && supabase) {
        try {
          await resetLivePatrolSessionsOnBackend();
        } catch (liveErr) {
          const liveText =
            liveErr instanceof Error ? liveErr.message : "Errore sconosciuto.";
          setMessage(
            `Accessi azzerati, ma CHIUDI / pattuglie online non riuscito: ${liveText}`,
          );
        }
      }

      await loadData();
    } catch (error) {
      const errorText =
        error instanceof Error ? error.message : "Errore sconosciuto.";
      setMessage(`Reset storico accessi non riuscito: ${errorText}`);
    } finally {
      setLoading(false);
    }
  }

  /**
   * Chiude sessioni live su Supabase (API service role se disponibile, altrimenti fallback anon).
   * Richiede `supabase` non null. Non imposta `loading`.
   */
  async function resetLivePatrolSessionsOnBackend() {
    if (!supabase) {
      return;
    }

    const chunkSize = 40;
    const logoutAt = new Date().toISOString();

    if (session) {
      const sessionIdsFromClient = [
        ...new Set(
          patrols
            .filter((p) => p.isOnline && p.sessionId)
            .map((p) => p.sessionId as string),
        ),
      ];

      const apiResponse = await fetch("/api/reset-live-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session, sessionIdsFromClient }),
      });

      const apiPayload = (await apiResponse.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
        updated?: number;
        deletedPings?: number;
        sessionCount?: number;
        partial?: boolean;
        message?: string;
      };

      if (apiResponse.ok && apiPayload.ok) {
        if ((apiPayload.updated ?? 0) === 0) {
          setMessage(apiPayload.message ?? "Nessuna sessione online da chiudere.");
        } else {
          let msg = `${apiPayload.updated} sessioni live chiuse, ${apiPayload.deletedPings ?? 0} ping rimossi dal buffer.`;
          if (apiPayload.partial) {
            msg += ` Attenzione: aggiornate ${apiPayload.updated} su ${apiPayload.sessionCount ?? "?"} sessioni segnalate.`;
          }
          setMessage(msg);
        }
        await loadData();
        return;
      }

      if (apiResponse.status !== 501) {
        throw new Error(apiPayload.error ?? `Errore server ${apiResponse.status}`);
      }
    }

    const sessionIdSet = new Set<string>();

    const summariesResult = await supabase
      .from("active_patrol_summaries")
      .select("session_id");

    if (summariesResult.error) {
      throw summariesResult.error;
    }

    for (const row of summariesResult.data ?? []) {
      const sid = row.session_id as string | undefined;
      if (sid) {
        sessionIdSet.add(sid);
      }
    }

    if (sessionIdSet.size === 0) {
      const sessionsResult = await supabase
        .from("patrol_sessions")
        .select("id")
        .eq("is_online", true);

      if (sessionsResult.error) {
        throw sessionsResult.error;
      }

      for (const row of sessionsResult.data ?? []) {
        const sid = row.id as string | undefined;
        if (sid) {
          sessionIdSet.add(sid);
        }
      }
    }

    for (const patrol of patrols) {
      if (patrol.isOnline && patrol.sessionId) {
        sessionIdSet.add(patrol.sessionId);
      }
    }

    const sessionIds = [...sessionIdSet];

    if (sessionIds.length === 0) {
      setMessage("Non risultano sessioni live pattuglie da chiudere.");
      await loadData();
      return;
    }

    let updatedCount = 0;

    for (let i = 0; i < sessionIds.length; i += chunkSize) {
      const chunk = sessionIds.slice(i, i + chunkSize);
      const { data: updatedRows, error: updateError } = await supabase
        .from("patrol_sessions")
        .update({
          is_online: false,
          logout_at: logoutAt,
        })
        .in("id", chunk)
        .select("id");

      if (updateError) {
        throw updateError;
      }

      updatedCount += updatedRows?.length ?? 0;
    }

    if (updatedCount === 0) {
      setMessage(
        "CHIUDI / pattuglie online: nessuna riga aggiornata. Verifica le policy RLS su `patrol_sessions` (UPDATE per anon) oppure esegui lo script `supabase_reset_live_sessions_rls.sql` nel progetto.",
      );
      await loadData();
      return;
    }

    let deletedPings = 0;

    for (let i = 0; i < sessionIds.length; i += chunkSize) {
      const chunk = sessionIds.slice(i, i + chunkSize);
      const { data: deletedRows, error: pingDeleteError } = await supabase
        .from("patrol_position_pings")
        .delete()
        .in("session_id", chunk)
        .select("id");

      if (pingDeleteError) {
        throw pingDeleteError;
      }

      deletedPings += deletedRows?.length ?? 0;
    }

    const partial =
      updatedCount < sessionIds.length
        ? ` Attenzione: aggiornate ${updatedCount} su ${sessionIds.length} sessioni segnalate.`
        : "";

    setMessage(
      `${updatedCount} sessioni live chiuse, ${deletedPings} ping posizione rimossi dal buffer.${partial}`,
    );
    await loadData();
  }

  async function handleResetLivePatrolSessions() {
    if (!canEdit) {
      setMessage("Profilo viewer: CHIUDI / pattuglie online non consentito.");
      return;
    }

    const nOnlineMap = patrols.filter((p) => p.isOnline).length;
    const resetLiveMsg =
      nOnlineMap > 0
        ? `Vuoi chiudere le ${nOnlineMap} sessioni pattuglie segnate come online?`
        : "In mappa nessuna pattuglia risulta online. Vuoi comunque allineare il database (chiude eventuali sessioni ancora «online» lato server e pulisce i ping nel buffer)?";

    const confirmed = window.confirm(resetLiveMsg);

    if (!confirmed) {
      return;
    }

    if (!supabase) {
      setPatrols((current) => current.map((patrol) => ({ ...patrol, isOnline: false })));
      setMessage("Sessioni live pattuglie chiuse in modalità mock.");
      return;
    }

    setLoading(true);

    try {
      await resetLivePatrolSessionsOnBackend();
    } catch (error) {
      const errorText =
        error instanceof Error ? error.message : "Errore sconosciuto.";
      setMessage(`CHIUDI / pattuglie online non riuscito: ${errorText}`);
    } finally {
      setLoading(false);
    }
  }

  async function handlePurgeClosedSessionsFromDb() {
    if (!canEdit) {
      setMessage("Profilo viewer: eliminazione sessioni non consentita.");
      return;
    }

    const confirmed = window.confirm(
      "Eliminare DEFINITIVAMENTE dal database tutte le sessioni già CHIUSE (is_online = false)?\n\n" +
        "Vengono rimosse anche timeline eventi e ping collegati (cascade). Le sessioni ancora online non sono toccate.",
    );

    if (!confirmed) {
      return;
    }

    if (!session) {
      setMessage("Accedi come admin per usare questa funzione.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/purge-closed-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session }),
      });

      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
        deletedSessions?: number;
        message?: string;
      };

      if (!res.ok) {
        if (res.status === 501) {
          setMessage(
            payload.error ??
              "Serve SUPABASE_SERVICE_ROLE_KEY in .env.local sul PC che esegue Next.js.",
          );
          return;
        }
        throw new Error(payload.error ?? `Errore HTTP ${res.status}`);
      }

      setMessage(
        payload.message ??
          `Rimosse ${payload.deletedSessions ?? 0} sessioni CHIUSE dal database.`,
      );
      await loadData();
    } catch (error) {
      const errorText =
        error instanceof Error ? error.message : "Errore sconosciuto.";
      setMessage(`Eliminazione sessioni CHIUSE non riuscita: ${errorText}`);
    } finally {
      setLoading(false);
    }
  }

  function buildPatrolExportRows() {
    return registryItems.map((item) => {
      const baseRow = [
        item.patrolCode,
        item.patrolName,
      ];

      const optionalPin = includePinInExport ? [item.pinHash] : [];

      return [
        ...baseRow,
        ...optionalPin,
        item.isEnabled ? "Abilitata" : "Disabilitata",
        formatFixTimestamp(item.createdAt),
      ];
    });
  }

  function exportPatrolsCsv() {
    if (!exportPatrolsSelected) {
      setMessage("Seleziona almeno la tabella Pattuglie per l'export.");
      return;
    }

    const headRow = includePinInExport
      ? ["Codice", "Nome", "PIN", "Stato", "Creata il"]
      : ["Codice", "Nome", "Stato", "Creata il"];

    const rows = [
      headRow,
      ...buildPatrolExportRows(),
    ];

    const csvContent = rows
      .map((row) =>
        row
          .map((value) => `"${String(value).replaceAll('"', '""')}"`)
          .join(";"),
      )
      .join("\n");

    const blob = new Blob(["\uFEFF" + csvContent], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `aprs_patrols_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    setMessage("Export CSV pattuglie generato.");
  }

  function exportPatrolsPdf() {
    if (!exportPatrolsSelected) {
      setMessage("Seleziona almeno la tabella Pattuglie per l'export.");
      return;
    }

    const headRow = includePinInExport
      ? ["Codice", "Nome", "PIN", "Stato", "Creata il"]
      : ["Codice", "Nome", "Stato", "Creata il"];

    const doc = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    });

    doc.setFontSize(16);
    doc.text("Elenco Pattuglie APRS Patrol", 14, 16);
    doc.setFontSize(10);
    doc.text(
      `Generato il ${formatFixTimestamp(new Date().toISOString())}`,
      14,
      22,
    );

    autoTable(doc, {
      startY: 28,
      head: [headRow],
      body: buildPatrolExportRows(),
      styles: {
        fontSize: 9,
      },
      headStyles: {
        fillColor: [17, 113, 183],
      },
    });

    doc.save(`aprs_patrols_${new Date().toISOString().slice(0, 10)}.pdf`);
    setMessage("Export PDF pattuglie generato.");
  }

  function openFullscreenMap() {
    const sw =
      typeof window.screen?.availWidth === "number"
        ? window.screen.availWidth
        : 1600;
    const sh =
      typeof window.screen?.availHeight === "number"
        ? window.screen.availHeight
        : 900;
    const width = Math.min(sw - 48, 1920);
    const height = Math.min(sh - 48, 1200);
    window.open(
      `/map-fullscreen`,
      "_blank",
      `width=${width},height=${height},left=24,top=24,noopener,noreferrer`,
    );
  }

  async function handleBackendLogin() {
    const code = loginCode.trim().toLowerCase();
    const password = loginPassword.trim();

    if (!code || !password) {
      setLoginError("Inserisci login e password.");
      return;
    }

    if (!supabase) {
      const nextSession: AdminSessionData = {
        code,
        name: code.startsWith("view") ? "Viewer Locale" : "Admin Locale",
        role: code.startsWith("view") ? "viewer" : "admin",
      };
      window.localStorage.setItem(
        ADMIN_SESSION_STORAGE_KEY,
        JSON.stringify(nextSession),
      );
      setSession(nextSession);
      setLoginError(null);
      setMessage("Modalità locale senza Supabase: dati demo per la sola interfaccia.");
      return;
    }

    try {
      const { data, error } = await supabase
        .from("admins")
        .select("admin_code, admin_name, pin_hash, role, is_enabled")
        .eq("admin_code", code)
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (!data || !data.is_enabled) {
        setLoginError("Utente non trovato o disabilitato.");
        return;
      }

      if ((data.pin_hash as string | null) !== password) {
        setLoginError("Password non corretta.");
        return;
      }

      const nextSession: AdminSessionData = {
        code: data.admin_code as string,
        name: (data.admin_name as string | null) ?? code,
        role: normalizeAdminRole(data.role as string | null),
      };

      await supabase.from("admin_access_events").insert({
        admin_code: nextSession.code,
        admin_name: nextSession.name,
        role: nextSession.role,
        event_type: "login",
      });

      window.localStorage.setItem(
        ADMIN_SESSION_STORAGE_KEY,
        JSON.stringify(nextSession),
      );
      setSession(nextSession);
      setLoginError(null);
      setMessage(
        nextSession.role === "viewer"
          ? "Accesso viewer eseguito: sola consultazione."
          : "Accesso admin eseguito: gestione completa disponibile.",
      );
    } catch (error) {
      const errorText =
        error instanceof Error ? error.message : "Errore sconosciuto.";
      setLoginError(`Login backend non riuscito: ${errorText}`);
    }
  }

  async function handleLogout() {
    const currentSession = session;

    if (supabase && currentSession) {
      try {
        const { error } = await supabase.from("admin_access_events").insert({
          admin_code: currentSession.code,
          admin_name: currentSession.name,
          role: currentSession.role,
          event_type: "logout",
        });

        if (error) {
          throw error;
        }
      } catch (error) {
        const errorText =
          error instanceof Error ? error.message : "Errore sconosciuto.";
        setMessage(`Logout eseguito, ma tracking logout non salvato: ${errorText}`);
      }
    }

    window.localStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
    setSession(null);
    setLoginError(null);
    setLoginCode("");
    setLoginPassword("");
    setPatrols(mockPatrols);
    setWaypoints(mockWaypoints);
    setWaypointFeedError(null);
    setLastRefreshAt(null);
    setMessage(
      supabase
        ? "Sessione chiusa. Accedi di nuovo per ricaricare i dati da Supabase."
        : "Sessione chiusa.",
    );
  }

  function resetAdminsForm() {
    setAdminsFormMode("idle");
    setAdminsEditingId(null);
    setAdminsFormCode("");
    setAdminsFormName("");
    setAdminsFormPin("");
    setAdminsFormRole("admin");
    setAdminsFormEnabled(true);
    setAdminsModalError(null);
  }

  const loadAdminAccountsForModal = useCallback(async () => {
    if (!session) {
      return;
    }
    setAdminsModalLoading(true);
    setAdminsModalError(null);
    try {
      const res = await fetch("/api/admins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session, action: "list" }),
      });
      const json = (await res.json()) as {
        admins?: AdminAccountRow[];
        error?: string;
      };
      if (!res.ok) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      setAdminAccountRows(json.admins ?? []);
    } catch (error) {
      const text =
        error instanceof Error ? error.message : "Errore caricamento lista.";
      setAdminsModalError(text);
      setAdminAccountRows([]);
    } finally {
      setAdminsModalLoading(false);
    }
  }, [session]);

  function expandAdminsManageAndLoad() {
    setAdminsManageExpanded(true);
    resetAdminsForm();
    void loadAdminAccountsForModal();
  }

  function collapseAdminsManage() {
    setAdminsManageExpanded(false);
    resetAdminsForm();
  }

  async function deleteAdminAccount(row: AdminAccountRow) {
    if (!session) {
      return;
    }
    const ok = window.confirm(
      `Eliminare definitivamente l'account «${row.admin_name}» (${row.admin_code})?\n\nL'operazione non è annullabile.`,
    );
    if (!ok) {
      return;
    }
    setAdminsModalLoading(true);
    setAdminsModalError(null);
    try {
      const res = await fetch("/api/admins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session, action: "delete", id: row.id }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      setMessage(`Account «${row.admin_code}» eliminato.`);
      if (adminsFormMode === "edit" && adminsEditingId === row.id) {
        resetAdminsForm();
      }
      await loadAdminAccountsForModal();
    } catch (error) {
      setAdminsModalError(
        error instanceof Error ? error.message : "Eliminazione non riuscita.",
      );
    } finally {
      setAdminsModalLoading(false);
    }
  }

  function startCreateAdminAccount() {
    setAdminsFormMode("create");
    setAdminsEditingId(null);
    setAdminsFormCode("");
    setAdminsFormName("");
    setAdminsFormPin("");
    setAdminsFormRole("viewer");
    setAdminsFormEnabled(true);
    setAdminsModalError(null);
  }

  function startEditAdminAccount(row: AdminAccountRow) {
    setAdminsFormMode("edit");
    setAdminsEditingId(row.id);
    setAdminsFormCode(row.admin_code);
    setAdminsFormName(row.admin_name);
    setAdminsFormPin("");
    setAdminsFormRole(normalizeAdminRole(row.role));
    setAdminsFormEnabled(row.is_enabled);
    setAdminsModalError(null);
  }

  async function submitAdminsForm() {
    if (!session || adminsFormMode === "idle") {
      return;
    }
    setAdminsModalLoading(true);
    setAdminsModalError(null);
    try {
      const adminPayload = {
        admin_code: adminsFormCode,
        admin_name: adminsFormName,
        pin_plain: adminsFormPin,
        role: adminsFormRole,
        is_enabled: adminsFormEnabled,
      };
      const body =
        adminsFormMode === "create"
          ? { session, action: "create", admin: adminPayload }
          : {
              session,
              action: "update",
              id: adminsEditingId,
              admin: adminPayload,
            };
      const res = await fetch("/api/admins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      setMessage(
        adminsFormMode === "create"
          ? "Account backend creato."
          : "Account backend aggiornato.",
      );
      resetAdminsForm();
      await loadAdminAccountsForModal();
    } catch (error) {
      setAdminsModalError(
        error instanceof Error ? error.message : "Salvataggio non riuscito.",
      );
    } finally {
      setAdminsModalLoading(false);
    }
  }

  function getNavTarget(item: string): AdminView | null {
    switch (item) {
      case "Mappa Live":
        return "live-map";
      case "Pattuglie":
        return "patrols";
      case "Sessioni Live":
        return "live-sessions";
      case "Accessi Admin":
        return "admin-access";
      case "Admin":
        return "admin-accounts";
      case "Export":
        return "export";
      default:
        return null;
    }
  }

  const pageTitle =
    adminView === "live-map"
      ? "Mappa Live Pattuglie"
      : adminView === "patrols"
        ? "Gestione Pattuglie"
        : adminView === "live-sessions"
          ? "Sessioni Pattuglie"
        : adminView === "admin-access"
          ? "Accessi Admin"
          : adminView === "admin-accounts"
            ? "Gestione account backend"
          : "Export Pattuglie";

  const pageEyebrow =
    adminView === "live-map"
      ? "Live Operations View"
      : adminView === "patrols"
        ? "Patrol Registry"
        : adminView === "live-sessions"
          ? "Patrol Sessions"
        : adminView === "admin-access"
          ? "Admin Audit Trail"
          : adminView === "admin-accounts"
            ? "Admin user registry"
          : "Operational Export";

  const pageDescription =
    adminView === "live-map"
      ? "Prima schermata reale del backend PC in Next.js: legge le pattuglie online, mostra i marker colorati per stato e consente di passare da mappa standard a ortofoto."
      : adminView === "patrols"
        ? "Anagrafica operativa pattuglie: creazione, modifica, abilitazione, cancellazione ed export."
        : adminView === "live-sessions"
          ? "Vista sessioni pattuglie con login, logout, stato e durata operativa."
        : adminView === "admin-access"
          ? "Storico accessi backend con login e logout di admin e viewer."
          : adminView === "admin-accounts"
            ? "Crea o modifica account admin e viewer (tabella Supabase admins). Disponibile solo in modalità Live con ruolo amministratore."
          : "Esporta l'elenco pattuglie in formato CSV o PDF per invio rapido agli operatori.";

  if (!authChecked) {
    return null;
  }

  if (!session) {
    return (
      <div className={styles.authShell}>
        <div className={styles.authCard}>
          <div className={styles.authLogoWrap}>
            <img alt="Logo ANSMI" className={styles.authLogo} src="/logo_ansmi.png" />
          </div>
          <span className={styles.brandTag}>APRS Patrol Admin</span>
          <h1 className={styles.authTitle}>Accesso Backend</h1>
          <p className={styles.authText}>
            Login amministratore o visualizzatore per entrare nel pannello PC.
          </p>

          <div className={styles.authForm}>
            <div className={styles.fieldGroup}>
              <label htmlFor="backend-login">Login</label>
              <input
                autoComplete="username"
                className={styles.authInput}
                id="backend-login"
                onChange={(event) => setLoginCode(event.target.value)}
                placeholder="Codice admin o viewer"
                value={loginCode}
              />
            </div>
            <div className={styles.fieldGroup}>
              <label htmlFor="backend-password">Password</label>
              <input
                autoComplete="current-password"
                className={styles.authInput}
                id="backend-password"
                onChange={(event) => setLoginPassword(event.target.value)}
                placeholder="Password"
                type="password"
                value={loginPassword}
              />
            </div>
            {loginError ? <div className={styles.messageBox}>{loginError}</div> : null}
            <button
              className={styles.mapAction}
              onClick={() => {
                void handleBackendLogin();
              }}
              type="button"
            >
              Entra nel backend
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
      <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarTop}>
          <div className={styles.brand}>
            <div className={styles.brandLogoWrap}>
              <img
                alt="Logo ANSMI"
                className={styles.brandLogo}
                src="/logo_ansmi.png"
              />
            </div>
            <span className={styles.brandTag}>APRS Patrol Admin</span>
            <strong className={styles.brandTitle}>Tactical Map</strong>
            <p className={styles.brandSubtext}>
              Pannello PC per monitoraggio pattuglie, controllo live e gestione
              operativa su mappa.
            </p>
          </div>

          <nav className={styles.navList}>
            {navigationItems.map((item) => {
              const targetView = getNavTarget(item);
              const adminNavLocked = item === "Admin" && !canEdit;
              const isActive =
                (item === "Mappa Live" && adminView === "live-map") ||
                (item === "Pattuglie" && adminView === "patrols") ||
                (item === "Sessioni Live" && adminView === "live-sessions") ||
                (item === "Accessi Admin" && adminView === "admin-access") ||
                (item === "Admin" && adminView === "admin-accounts") ||
                (item === "Export" && adminView === "export");
              const navClassName = [
                isActive ? styles.navItemActive : styles.navItem,
                item === "Admin" && canEdit && !isActive
                  ? styles.navItemAdminAvailable
                  : "",
              ]
                .filter(Boolean)
                .join(" ");

              return (
                <button
                  key={item}
                  className={navClassName}
                  disabled={!targetView || adminNavLocked}
                  title={
                    adminNavLocked
                      ? "Solo utenti con ruolo amministratore."
                      : undefined
                  }
                  type="button"
                  onClick={() => {
                    if (targetView && !adminNavLocked) {
                      setAdminView(targetView);
                    }
                  }}
                >
                  {item}
                </button>
              );
            })}
          </nav>
        </div>

        <div className={styles.sidebarBottom}>
          <div className={styles.sidebarFooter}>
            Mappa PC con doppio layer:
            <br />
            `Standard` per il controllo operativo
            <br />
            `Ortofoto` per lettura del terreno e dei riferimenti visivi.
          </div>
        </div>
      </aside>

      <div className={styles.mainColumn}>
      <main
        ref={mainScrollRef}
        className={
          adminView === "live-map"
            ? styles.contentLiveMap
            : adminView === "live-sessions"
              ? `${styles.content} ${styles.fullHeightContent}`
              : styles.content
        }
      >
        <section className={styles.header}>
          <div className={styles.headerTitle}>
            <span className={styles.eyebrow}>{pageEyebrow}</span>
            <h1>{pageTitle}</h1>
            <p>{pageDescription}</p>
          </div>

          <div className={styles.headerActions}>
            <span className={styles.roleBadge}>
              {isViewer ? "Viewer" : "Admin Full"} | {session.name}
            </span>
            <span
              className={
                backendMode === "live" ? styles.badgeLive : styles.badgeMock
              }
            >
              {backendMode === "live" ? "Live Supabase" : "Fallback Mock"}
            </span>
            <button
              className={styles.ghostButton}
              onClick={() => {
                void handleLogout();
              }}
              type="button"
            >
              Logout
            </button>
            <button
              className={styles.refreshButton}
              onClick={() => {
                void loadData();
              }}
              type="button"
            >
              {loading ? "Aggiornamento..." : "Ricarica dati"}
            </button>
            {adminView === "live-map" && lastRefreshAt ? (
              <span className={styles.refreshMeta} title="Ultimo caricamento dati da Supabase">
                {formatFixTimestamp(lastRefreshAt)}
              </span>
            ) : null}
          </div>
        </section>

        {adminView === "live-map" && (
        <section className={`${styles.toolbar} ${styles.toolbarLive}`}>
          <div className={styles.toolbarCard}>
            <label htmlFor="layer-mode">Layer</label>
            <select
              id="layer-mode"
              value={layerMode}
              onChange={(event) =>
                setLayerMode(event.target.value as LayerMode)
              }
            >
              {layerOptions.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.toolbarCard}>
            <label htmlFor="status-filter">Stato</label>
            <select
              id="status-filter"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              {statusOptions.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.toolbarCard}>
            <label htmlFor="mission-filter">Missione</label>
            <select
              id="mission-filter"
              value={missionFilter}
              onChange={(event) => setMissionFilter(event.target.value)}
            >
              <option value="all">Tutte le missioni</option>
              <option value="__none__">Senza missione</option>
              {missionFilterOptions.map((mission) => (
                <option key={mission} value={mission}>
                  {mission}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.toolbarCard}>
            <label htmlFor="search-term">Ricerca pattuglia</label>
            <input
              id="search-term"
              placeholder="PTG001 o LUPO"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </div>

          <div
            className={`${styles.toolbarCard} ${styles.toolbarCardWaypoint}`}
          >
            <label
              title="Marcatori waypoint sulla mappa (▲); scala cartografica in basso a sinistra."
            >
              Waypoint ▲ / scala
            </label>
            <Link
              className={styles.mapAction}
              href="/waypoints"
              id="waypoint-panel-fullscreen-link"
            >
              Vai al pannello waypoint
            </Link>
            <p className={styles.toolbarHint}>
              ▲ sulla mappa (etichetta gialla) · scala in basso a sinistra. Gestione elenco e
              form: pagina dedicata.
            </p>
            {waypointFeedError ? (
              <p
                className={styles.toolbarHint}
                style={{ color: "#ffb74d", marginTop: 4 }}
                role="alert"
              >
                {waypointFeedError}
              </p>
            ) : null}
          </div>
        </section>
        )}

        {adminView === "live-map" ? (
        <section className={`${styles.mainGrid} ${styles.mapMainGrid}`}>
          <article className={`${styles.mapCard} ${styles.mapCardLive}`}>
            <div className={styles.mapHeader}>
              <div className={styles.mapHeaderTitle}>
                <h2>Operational Map</h2>
                <p>
                  Marker live e waypoint (▲ giallo); scala in basso a sinistra; filtro stato
                  e layer Standard / Ortofoto.
                </p>
              </div>
              <div className={styles.mapHeaderActions}>
                <div className={styles.legend}>
                  {statusOptions
                    .filter((item) => item.value !== "all")
                    .map((item) => (
                      <span className={styles.legendItem} key={item.value}>
                        <span
                          className={styles.legendDot}
                          style={{ backgroundColor: getStatusColor(item.value) }}
                        />
                        {item.label}
                      </span>
                    ))}
                </div>
                <button
                  className={styles.ghostButton}
                  onClick={openFullscreenMap}
                  type="button"
                >
                  Apri su secondo schermo
                </button>
              </div>
            </div>

            <div className={styles.mapStage}>
              <PatrolLiveMap
                canManageWaypoints={canEdit}
                focusedPatrol={focusedPatrol}
                layerMode={layerMode}
                onDeleteWaypoint={handleDeleteWaypointFromMap}
                onEditWaypoint={(waypoint) => {
                  router.push(
                    `/waypoints?edit=${encodeURIComponent(waypoint.id)}`,
                  );
                }}
                onFocusHandled={() => setFocusedPatrol(null)}
                onForceLogout={handleForceLogout}
                onSelectPatrol={(patrol) => {
                  setSelectedSessionId(patrol.sessionId);
                  setFocusedPatrol(patrol);
                }}
                patrols={filteredPatrols}
                selectedSessionId={selectedSessionId}
                waypoints={waypoints}
              />
            </div>
          </article>

          <div
            ref={sidePanelsScrollRef}
            className={styles.sidePanels}
          >
            <section className={`${styles.panelCard} ${styles.sidePanelFixed}`}>
              <div className={styles.panelHeader}>
                <div className={styles.panelHeaderTitle}>
                  <h2>Quadro rapido</h2>
                  <p>Stato backend, pattuglie online e dettaglio selezione.</p>
                </div>
              </div>

              <div className={styles.stats}>
                <div className={styles.statCard}>
                  <span className={styles.statLabel}>Pattuglie online</span>
                  <strong className={styles.statValue}>{onlineCount}</strong>
                  <span className={styles.statMeta}>
                    Sessioni online lette da `active_patrol_summaries`.
                  </span>
                </div>
                <div className={styles.statCard}>
                  <span className={styles.statLabel}>Fix disponibili</span>
                  <strong className={styles.statValue}>{withFixCount}</strong>
                  <span className={styles.statMeta}>
                    Marker mostrati in mappa con coordinate valide.
                  </span>
                </div>
                <div className={styles.statCard}>
                  <span className={styles.statLabel}>Missioni visibili</span>
                  <strong className={styles.statValue}>{missionCount}</strong>
                  <span className={styles.statMeta}>
                    Filtri missione ricavati dal backend o dal fallback mock.
                  </span>
                </div>
                <div className={styles.statCard}>
                  <span className={styles.statLabel}>Feed backend</span>
                  <strong className={styles.statValue}>
                    {backendMode === "live" ? "LIVE" : "MOCK"}
                  </strong>
                  <span className={styles.statMeta}>
                    Polling automatico ogni 20 secondi.
                  </span>
                </div>
              </div>

              <div className={styles.statusPanelBody}>
                <div className={styles.messageBox}>{message}</div>
                <div style={{ height: 12 }} />

                {selectedPatrol ? (
                  <div className={styles.selectedCard}>
                    <div className={styles.selectedTop}>
                      <div className={styles.selectedTitle}>
                        <span className={styles.selectedCode}>
                          {selectedPatrol.patrolCode}
                        </span>
                        <strong className={styles.selectedName}>
                          {selectedPatrol.patrolName}
                        </strong>
                      </div>
                      <span
                        className={styles.statusPill}
                        style={{
                          backgroundColor: getStatusColor(selectedPatrol.status),
                        }}
                      >
                        {getStatusLabel(selectedPatrol.status)}
                      </span>
                    </div>

                    <div className={styles.detailGrid}>
                      <div className={styles.detailItem}>
                        <span className={styles.detailItemLabel}>Missione</span>
                        <span className={styles.detailItemValue}>
                          {selectedPatrol.missionName ?? "Missione non assegnata"}
                        </span>
                      </div>
                      <div className={styles.detailItem}>
                        <span className={styles.detailItemLabel}>Ultimo fix</span>
                        <span className={styles.detailItemValue}>
                          {formatFixTimestamp(selectedPatrol.lastFixAt)}
                        </span>
                      </div>
                      <div className={styles.detailItem}>
                        <span className={styles.detailItemLabel}>
                          Accuratezza
                        </span>
                        <span className={styles.detailItemValue}>
                          {selectedPatrol.lastAccuracy !== null
                            ? `${selectedPatrol.lastAccuracy.toFixed(0)} m`
                            : "n/d"}
                        </span>
                      </div>
                      <div className={styles.detailItem}>
                        <span className={styles.detailItemLabel}>Coordinate</span>
                        <span className={styles.detailItemValue}>
                          {hasCoordinates(selectedPatrol)
                            ? `${selectedPatrol.lastLatitude!.toFixed(5)}, ${selectedPatrol.lastLongitude!.toFixed(5)}`
                            : "GPS in acquisizione"}
                        </span>
                      </div>
                    </div>

                    <div className={styles.selectedActions}>
                      <button
                        className={styles.mapAction}
                        type="button"
                        onClick={() => setFocusedPatrol(selectedPatrol)}
                      >
                        Centra su mappa
                      </button>
                      <button className={styles.ghostButton} type="button">
                        Apri dettaglio
                      </button>
                      <button
                        className={styles.logoutButton}
                        type="button"
                        onClick={() => {
                          void handleForceLogout(selectedPatrol);
                        }}
                      >
                        Force logout
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className={styles.emptyState}>
                    Nessuna pattuglia corrisponde ai filtri attuali.
                  </div>
                )}
              </div>
            </section>

            <section
              className={`${styles.panelCard} ${styles.patrolListPanel}`}
            >
              <div className={styles.panelHeader}>
                <div className={styles.panelHeaderTitle}>
                  <h2>Elenco pattuglie live</h2>
                  <p>Lista sincronizzata con la mappa e pronta per il CRUD reale.</p>
                </div>
              </div>

              <div className={`${styles.listBody} ${styles.patrolListScrollArea}`}>
                {filteredPatrols.length === 0 ? (
                  <div className={styles.emptyState}>
                    {patrols.length > 0 ? (
                      <>
                        Nessuna pattuglia corrisponde ai filtri attuali (
                        {patrols.length} in backend).
                        <div style={{ marginTop: 12 }}>
                          <button
                            className={styles.mapAction}
                            type="button"
                            onClick={resetLiveMapFilters}
                          >
                            Reimposta filtri (stato, missione, ricerca)
                          </button>
                        </div>
                      </>
                    ) : (
                      "Nessuna pattuglia nel riepilogo operativo."
                    )}
                  </div>
                ) : (
                  filteredPatrols.map((patrol) => (
                    <article
                      key={patrol.sessionId}
                      className={
                        patrol.sessionId === selectedSessionId
                          ? styles.listItemSelected
                          : styles.listItem
                      }
                    >
                      <div className={styles.listRow}>
                        <div className={styles.listIdentity}>
                          <div className={styles.listIdentityTop}>
                            <span className={styles.listCode}>
                              {patrol.patrolCode}
                            </span>
                            <h3>{patrol.patrolName}</h3>
                            <span
                              className={styles.statusPill}
                              style={{
                                backgroundColor: getStatusColor(patrol.status),
                              }}
                            >
                              {getStatusLabel(patrol.status)}
                            </span>
                          </div>
                          <span className={styles.missionText}>
                            {patrol.missionName ?? "Missione non assegnata"}
                          </span>
                        </div>
                        <button
                          className={styles.inlineButton}
                          type="button"
                          onClick={() => {
                            setSelectedSessionId(patrol.sessionId);
                            setFocusedPatrol(patrol);
                          }}
                        >
                          Seleziona
                        </button>
                      </div>

                      <div className={styles.listMeta}>
                        <div className={styles.metaCard}>
                          <span className={styles.metaLabel}>Ultimo fix</span>
                          <span className={styles.metaValue}>
                            {formatFixTimestamp(patrol.lastFixAt)}
                          </span>
                        </div>
                        <div className={styles.metaCard}>
                          <span className={styles.metaLabel}>Accuratezza</span>
                          <span className={styles.metaValue}>
                            {patrol.lastAccuracy !== null
                              ? `${patrol.lastAccuracy.toFixed(0)} m`
                              : "n/d"}
                          </span>
                        </div>
                        <div className={styles.metaCard}>
                          <span className={styles.metaLabel}>Coordinate</span>
                          <span className={styles.metaValue}>
                            {hasCoordinates(patrol)
                              ? `${patrol.lastLatitude!.toFixed(4)}, ${patrol.lastLongitude!.toFixed(4)}`
                              : "GPS in acquisizione"}
                          </span>
                        </div>
                      </div>

                      <div className={styles.listActions}>
                        <button
                          className={styles.mapAction}
                          type="button"
                          onClick={() => {
                            setSelectedSessionId(patrol.sessionId);
                            setFocusedPatrol(patrol);
                          }}
                        >
                          Centra
                        </button>
                        <button className={styles.ghostButton} type="button">
                          Dettaglio
                        </button>
                        <button
                          className={styles.logoutButton}
                          type="button"
                          onClick={() => {
                            void handleForceLogout(patrol);
                          }}
                        >
                          Force logout
                        </button>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </section>
          </div>
        </section>
        ) : adminView === "patrols" ? (
          <section className={styles.registryWrap}>
            <section className={styles.panelCard}>
              <div className={styles.panelHeader}>
                <div className={styles.panelHeaderTitle}>
                  <h2>Gestione Pattuglie</h2>
                  <p>
                    Prima sezione backend reale: elenco, nuova pattuglia, modifica,
                    abilitazione e PIN.
                  </p>
                </div>
                <div className={styles.panelHeaderActions}>
                  <label className={styles.inlineToggleRow} htmlFor="include-pin-patrols">
                    <input
                      checked={includePinInExport}
                      id="include-pin-patrols"
                      onChange={(event) => setIncludePinInExport(event.target.checked)}
                      type="checkbox"
                    />
                    <span>Includi PIN</span>
                  </label>
                  <button
                    className={styles.ghostButton}
                    onClick={exportPatrolsCsv}
                    type="button"
                  >
                    Export CSV
                  </button>
                  <button
                    className={styles.mapAction}
                    onClick={exportPatrolsPdf}
                    type="button"
                  >
                    Export PDF
                  </button>
                </div>
              </div>

              <div className={styles.listBody}>
                <table className={styles.registryTable}>
                  <thead>
                    <tr>
                      <th>Codice</th>
                      <th>Nome</th>
                      <th>PIN</th>
                      <th>Stato</th>
                      <th>Azioni</th>
                    </tr>
                  </thead>
                  <tbody>
                    {registryItems.map((item) => (
                      <tr
                        key={item.id}
                        className={
                          item.isEnabled
                            ? styles.registryRowActive
                            : styles.registryRowDisabled
                        }
                      >
                        <td>{item.patrolCode}</td>
                        <td>{item.patrolName}</td>
                        <td>{item.pinHash}</td>
                        <td>
                          <span
                            className={
                              item.isEnabled ? styles.enabledBadge : styles.disabledBadge
                            }
                          >
                            {item.isEnabled ? "Abilitata" : "Disabilitata"}
                          </span>
                        </td>
                        <td>
                          <div className={styles.tableActionRow}>
                            <button
                              className={styles.tableActionPrimary}
                              disabled={!canEdit}
                              onClick={() => startEditingPatrol(item)}
                              type="button"
                            >
                              Modifica
                            </button>
                            <button
                              className={
                                item.isEnabled
                                  ? styles.tableActionDanger
                                  : styles.tableActionGhost
                              }
                              disabled={!canEdit}
                              onClick={() => {
                                void handleTogglePatrol(item);
                              }}
                              type="button"
                            >
                              {item.isEnabled ? "Disabilita" : "Abilita"}
                            </button>
                            <button
                              className={styles.tableActionDanger}
                              disabled={!canEdit}
                              onClick={() => {
                                void handleDeletePatrol(item);
                              }}
                              type="button"
                            >
                              Elimina
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className={styles.panelCard}>
              <div className={styles.panelHeader}>
                <div className={styles.panelHeaderTitle}>
                  <h2>{editingPatrolId ? "Modifica Pattuglia" : "Nuova Pattuglia"}</h2>
                  <p>
                    Form iniziale per creare o aggiornare pattuglie direttamente dal PC.
                  </p>
                </div>
              </div>

              <div className={styles.registryForm}>
                <div className={styles.messageBox}>{message}</div>
                <div className={styles.formGrid}>
                  <div className={styles.fieldGroup}>
                    <label htmlFor="patrol-code">Codice pattuglia</label>
                    <input
                      id="patrol-code"
                      value={patrolCodeInput}
                      onChange={(event) => setPatrolCodeInput(event.target.value)}
                      placeholder="PTG006"
                    />
                  </div>
                  <div className={styles.fieldGroup}>
                    <label htmlFor="patrol-name">Nome pattuglia</label>
                    <input
                      id="patrol-name"
                      value={patrolNameInput}
                      onChange={(event) => setPatrolNameInput(event.target.value)}
                      placeholder="FALCO"
                    />
                  </div>
                  <div className={styles.fieldGroup}>
                    <label htmlFor="patrol-pin">PIN</label>
                    <input
                      id="patrol-pin"
                      value={patrolPinInput}
                      onChange={(event) => setPatrolPinInput(event.target.value)}
                      placeholder="1234"
                    />
                  </div>
                  <div className={styles.fieldGroup}>
                    <label>Abilitazione</label>
                    <div className={styles.checkboxRow}>
                      <input
                        checked={patrolEnabledInput}
                        id="patrol-enabled"
                        onChange={(event) => setPatrolEnabledInput(event.target.checked)}
                        type="checkbox"
                      />
                      <label htmlFor="patrol-enabled">
                        Pattuglia abilitata all&apos;uso
                      </label>
                    </div>
                  </div>
                </div>

                <div className={styles.formActions}>
                  <button
                    className={styles.mapAction}
                    disabled={!canEdit}
                    onClick={() => {
                      void handleSavePatrol();
                    }}
                    type="button"
                  >
                    {editingPatrolId ? "Salva modifica" : "Crea pattuglia"}
                  </button>
                  <button
                    className={styles.ghostButton}
                    onClick={resetPatrolForm}
                    type="button"
                  >
                    Annulla / Nuova
                  </button>
                </div>
              </div>
            </section>
          </section>
        ) : adminView === "live-sessions" ? (
          <section className={`${styles.accessWrap} ${styles.fullHeightWrap}`}>
            <section className={`${styles.panelCard} ${styles.fullHeightPanel}`}>
              <div className={`${styles.panelHeader} ${styles.sessionPanelHeader}`}>
                <div className={styles.panelHeaderTitle}>
                  <h2>Sessioni Pattuglie</h2>
                  <p>
                    Elenco sessioni con orari di login/logout, durata e ultimo stato. Il pulsante a
                    due righe CHIUDI / pattuglie online mette in logout le pattuglie ancora online;
                    ELIMINA / pattuglie chiuse rimuove dallo storico le sessioni già chiuse (serve
                    service role sul server).
                  </p>
                </div>
                <div
                  className={`${styles.panelHeaderActions} ${styles.sessionActionsWrap}`}
                >
                  <button
                    className={`${styles.sessionToolbarBtn} ${styles.sessionToolbarBtnOffline}`}
                    disabled={!canEdit}
                    onClick={() => {
                      void handleResetLivePatrolSessions();
                    }}
                    type="button"
                  >
                    CHIUDI
                    <br />
                    pattuglie online
                  </button>
                  <button
                    className={`${styles.sessionToolbarBtn} ${styles.sessionToolbarBtnPurge}`}
                    disabled={!canEdit}
                    onClick={() => {
                      void handlePurgeClosedSessionsFromDb();
                    }}
                    type="button"
                  >
                    ELIMINA
                    <br />
                    pattuglie chiuse
                  </button>
                </div>
              </div>

              <div className={styles.sessionScrollArea}>
                <div className={styles.listBody}>
                  {sessionRecords.length === 0 ? (
                    <div className={styles.emptyState}>
                      Nessuna sessione disponibile al momento.
                    </div>
                  ) : (
                    <table className={styles.registryTable}>
                      <thead>
                        <tr>
                          <th>Pattuglia</th>
                          <th>Stato</th>
                          <th>Stato dalle</th>
                          <th>Missioni e timeline</th>
                          <th>Login</th>
                          <th>Logout</th>
                          <th>Durata TOTALE sessione</th>
                          <th>Online</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sessionRecords.map((record) => (
                          <tr key={record.id} className={styles.registryRowActive}>
                            <td>
                              {record.patrolCode} - {record.patrolName}
                            </td>
                            <td>{getStatusLabel(record.status)}</td>
                            <td>{formatFixTimestamp(record.lastStatusAt)}</td>
                            <td className={styles.timelineCell}>
                              {record.missionGroups.length === 0 ? (
                                "n/d"
                              ) : (
                                <div className={styles.missionGroupList}>
                                  {record.missionGroups.map((group, groupIndex) => (
                                    <div
                                      key={`${record.id}-mission-group-${group.missionId ?? "none"}-${groupIndex}`}
                                      className={styles.missionGroup}
                                    >
                                      <div className={styles.missionGroupHeader}>
                                        {group.missionName ?? "Missione non assegnata"}
                                      </div>
                                      <div className={styles.timelineGrid}>
                                        <div className={styles.timelineList}>
                                          {group.events.map((event, index) => (
                                            <div
                                              key={`${record.id}-${groupIndex}-${event.status}-${event.changedAt}-${index}`}
                                              className={styles.timelineEvent}
                                            >
                                              <span
                                                className={styles.timelineDot}
                                                style={{
                                                  backgroundColor: getStatusColor(event.status),
                                                }}
                                              />
                                              <span className={styles.timelineTime}>
                                                {formatTimeOnly(event.changedAt)}
                                              </span>
                                              <span className={styles.timelineLabel}>
                                                {getStatusLabel(event.status)}
                                              </span>
                                            </div>
                                          ))}
                                        </div>
                                        <div className={styles.timelineList}>
                                          {group.events.map((event, index) => (
                                            <div
                                              key={`${record.id}-delta-${groupIndex}-${event.status}-${event.changedAt}-${index}`}
                                              className={styles.timelineEvent}
                                            >
                                              <span className={styles.timelineDelta}>
                                                {formatTimelineStepDuration(
                                                  index > 0
                                                    ? group.events[index - 1]?.changedAt ?? null
                                                    : null,
                                                  event.changedAt,
                                                )}
                                              </span>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                      <div className={styles.missionMetrics}>
                                        <span className={styles.missionMetricItem}>
                                          Target:{" "}
                                          {formatDurationBetween(
                                            group.startMissionAt,
                                            group.targetAt,
                                          )}
                                        </span>
                                        <span className={styles.missionMetricItem}>
                                          Totale:{" "}
                                          {formatDurationBetween(
                                            group.startMissionAt,
                                            group.endMissionAt,
                                          )}
                                        </span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </td>
                            <td>{formatFixTimestamp(record.loginAt)}</td>
                            <td>
                              {record.logoutAt ? formatFixTimestamp(record.logoutAt) : "In corso"}
                            </td>
                            <td>
                              {formatSessionDuration(record.loginAt, record.logoutAt)}
                            </td>
                            <td>
                              <span
                                className={
                                  record.isOnline ? styles.enabledBadge : styles.disabledBadge
                                }
                              >
                                {record.isOnline ? "Online" : "Chiusa"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </section>
          </section>
        ) : adminView === "admin-access" ? (
          <section className={styles.accessWrap}>
            <section className={styles.panelCard}>
              <div className={styles.panelHeader}>
                <div className={styles.panelHeaderTitle}>
                  <h2>Storico Accessi Backend</h2>
                  <p>Audit trail di login e logout per admin e viewer.</p>
                </div>
                <div className={styles.panelHeaderActions}>
                  {canEdit && supabase ? (
                    <button
                      className={styles.mapAction}
                      onClick={() => {
                        setAdminView("admin-accounts");
                        expandAdminsManageAndLoad();
                      }}
                      type="button"
                    >
                      Gestione account
                    </button>
                  ) : null}
                  <button
                    className={styles.logoutButton}
                    disabled={!canEdit}
                    onClick={() => {
                      void handleResetAdminAccessHistory();
                    }}
                    type="button"
                  >
                    Reset Accessi
                  </button>
                </div>
              </div>

              <div className={styles.registryForm}>
                <div className={styles.accessToolbar}>
                  <div className={styles.fieldGroup}>
                    <label htmlFor="access-user-filter">Utente</label>
                    <select
                      id="access-user-filter"
                      onChange={(event) => setAdminAccessFilter(event.target.value)}
                      value={adminAccessFilter}
                    >
                      <option value="all">Tutti gli utenti</option>
                      {accessUsers.map((user) => (
                        <option key={user} value={user}>
                          {user}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className={styles.fieldGroup}>
                    <label htmlFor="access-role-filter">Ruolo</label>
                    <select
                      id="access-role-filter"
                      onChange={(event) => setAdminRoleFilter(event.target.value)}
                      value={adminRoleFilter}
                    >
                      <option value="all">Tutti i ruoli</option>
                      <option value="admin">Admin</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  </div>
                </div>

                <div className={styles.listBody}>
                  {filteredAdminAccessEvents.length === 0 ? (
                    <div className={styles.emptyState}>
                      Nessun accesso disponibile con i filtri attuali.
                    </div>
                  ) : (
                    <table className={styles.registryTable}>
                      <thead>
                        <tr>
                          <th>Utente</th>
                          <th>Nome</th>
                          <th>Ruolo</th>
                          <th>Evento</th>
                          <th>Data/Ora</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredAdminAccessEvents.map((event) => (
                          <tr key={event.id} className={styles.registryRowActive}>
                            <td>{event.adminCode}</td>
                            <td>{event.adminName ?? "-"}</td>
                            <td>{event.role}</td>
                            <td>{event.eventType}</td>
                            <td>{formatFixTimestamp(event.occurredAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </section>
          </section>
        ) : adminView === "admin-accounts" ? (
          <section className={styles.accessWrap}>
            <section
              className={`${styles.panelCard} ${styles.adminAccountsPanel}`}
            >
              <div className={styles.panelHeader}>
                <div className={styles.panelHeaderTitle}>
                  <h2>Account admin e viewer</h2>
                  <p>
                    Gestione utenti del pannello PC: login, nome, ruolo, eliminazione.
                    Richiede Supabase Live e permessi da amministratore.
                  </p>
                </div>
                <div className={styles.panelHeaderActions}>
                  {canEdit && supabase ? (
                    <button
                      className={styles.mapAction}
                      onClick={() => {
                        if (adminsManageExpanded) {
                          collapseAdminsManage();
                        } else {
                          expandAdminsManageAndLoad();
                        }
                      }}
                      type="button"
                    >
                      {adminsManageExpanded
                        ? "Chiudi gestione account"
                        : "Crea / modifica account"}
                    </button>
                  ) : (
                    <span className={styles.emptyState}>
                      {!canEdit
                        ? "Profilo viewer: gestione account non disponibile."
                        : "Connessione Supabase non attiva: usa variabili NEXT_PUBLIC_* e riavvia."}
                    </span>
                  )}
                </div>
              </div>

              {adminsManageExpanded && canEdit && supabase ? (
                <div className={styles.adminsInlinePanel}>
                  <div className={styles.adminsInlineIntro}>
                    <p>
                      Elenco da Supabase (<code>admins</code>). Puoi creare, modificare o
                      eliminare account; non puoi eliminare l&apos;ultimo admin né il tuo
                      utente attuale.
                    </p>
                  </div>

                  {adminsModalError ? (
                    <div className={styles.adminsModalError}>{adminsModalError}</div>
                  ) : null}

                  <div className={styles.adminsModalToolbar}>
                    <button
                      className={styles.mapAction}
                      disabled={adminsModalLoading}
                      onClick={() => {
                        startCreateAdminAccount();
                      }}
                      type="button"
                    >
                      Nuovo account
                    </button>
                    <button
                      className={styles.ghostButton}
                      disabled={adminsModalLoading}
                      onClick={() => {
                        void loadAdminAccountsForModal();
                      }}
                      type="button"
                    >
                      Ricarica lista
                    </button>
                  </div>

                  <div className={styles.adminsInlineTableWrap}>
                    {adminsModalLoading && adminAccountRows.length === 0 ? (
                      <div className={styles.emptyState}>Caricamento…</div>
                    ) : adminAccountRows.length === 0 ? (
                      <div className={styles.emptyState}>
                        Nessun account in tabella admins.
                      </div>
                    ) : (
                      <table className={styles.registryTable}>
                        <thead>
                          <tr>
                            <th>Login</th>
                            <th>Nome</th>
                            <th>Ruolo</th>
                            <th>Abilitato</th>
                            <th />
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {adminAccountRows.map((row) => (
                            <tr key={row.id}>
                              <td>{row.admin_code}</td>
                              <td>{row.admin_name}</td>
                              <td>{row.role}</td>
                              <td>{row.is_enabled ? "Sì" : "No"}</td>
                              <td>
                                <button
                                  className={styles.ghostButton}
                                  disabled={adminsModalLoading}
                                  onClick={() => {
                                    startEditAdminAccount(row);
                                  }}
                                  type="button"
                                >
                                  Modifica
                                </button>
                              </td>
                              <td>
                                <button
                                  className={styles.dangerGhostButton}
                                  disabled={adminsModalLoading}
                                  onClick={() => {
                                    void deleteAdminAccount(row);
                                  }}
                                  type="button"
                                >
                                  Elimina
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>

                  {adminsFormMode !== "idle" ? (
                    <div className={styles.adminsModalForm}>
                      <h3>
                        {adminsFormMode === "create" ? "Nuovo" : "Modifica"} account
                      </h3>
                      <div className={styles.formGrid}>
                        <div className={styles.fieldGroup}>
                          <label htmlFor="admins-form-code">Login (admin_code)</label>
                          <input
                            id="admins-form-code"
                            autoComplete="off"
                            disabled={adminsModalLoading}
                            onChange={(event) =>
                              setAdminsFormCode(
                                event.target.value.trim().toLowerCase(),
                              )
                            }
                            value={adminsFormCode}
                          />
                        </div>
                        <div className={styles.fieldGroup}>
                          <label htmlFor="admins-form-name">Nome</label>
                          <input
                            id="admins-form-name"
                            disabled={adminsModalLoading}
                            onChange={(event) => setAdminsFormName(event.target.value)}
                            value={adminsFormName}
                          />
                        </div>
                        <div className={styles.fieldGroup}>
                          <label htmlFor="admins-form-role">Ruolo</label>
                          <select
                            id="admins-form-role"
                            disabled={adminsModalLoading}
                            onChange={(event) =>
                              setAdminsFormRole(
                                event.target.value === "viewer" ? "viewer" : "admin",
                              )
                            }
                            value={adminsFormRole}
                          >
                            <option value="admin">admin</option>
                            <option value="viewer">viewer</option>
                          </select>
                        </div>
                        <div className={styles.fieldGroup}>
                          <label
                            className={styles.inlineToggleRow}
                            htmlFor="admins-form-enabled"
                          >
                            <input
                              checked={adminsFormEnabled}
                              disabled={adminsModalLoading}
                              id="admins-form-enabled"
                              onChange={(event) =>
                                setAdminsFormEnabled(event.target.checked)
                              }
                              type="checkbox"
                            />
                            Account abilitato
                          </label>
                        </div>
                        <div className={styles.fieldGroup}>
                          <label htmlFor="admins-form-pin">
                            Password
                            {adminsFormMode === "edit"
                              ? " (vuoto = non cambiare)"
                              : " (obbligatoria)"}
                          </label>
                          <input
                            id="admins-form-pin"
                            autoComplete="new-password"
                            disabled={adminsModalLoading}
                            onChange={(event) => setAdminsFormPin(event.target.value)}
                            type="password"
                            value={adminsFormPin}
                          />
                        </div>
                      </div>
                      <div className={styles.adminsModalFormActions}>
                        <button
                          className={styles.mapAction}
                          disabled={
                            adminsModalLoading ||
                            !adminsFormCode.trim() ||
                            !adminsFormName.trim() ||
                            (adminsFormMode === "create" && !adminsFormPin.trim())
                          }
                          onClick={() => {
                            void submitAdminsForm();
                          }}
                          type="button"
                        >
                          Salva
                        </button>
                        <button
                          className={styles.ghostButton}
                          disabled={adminsModalLoading}
                          onClick={() => {
                            resetAdminsForm();
                          }}
                          type="button"
                        >
                          Annulla modulo
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>
          </section>
        ) : (
          <section className={styles.exportWrap}>
            <section className={styles.panelCard}>
              <div className={styles.panelHeader}>
                <div className={styles.panelHeaderTitle}>
                  <h2>Selezione Tabelle</h2>
                  <p>Scegli quali dati includere nell&apos;export.</p>
                </div>
              </div>

              <div className={styles.registryForm}>
                <div className={styles.messageBox}>{message}</div>
                <div className={styles.exportSelectionList}>
                  <label className={styles.exportOptionCard} htmlFor="export-patrols">
                    <input
                      checked={exportPatrolsSelected}
                      id="export-patrols"
                      onChange={(event) =>
                        setExportPatrolsSelected(event.target.checked)
                      }
                      type="checkbox"
                    />
                    <div>
                      <strong>Pattuglie</strong>
                      <p>Anagrafica pattuglie con codice, nome, stato e data creazione.</p>
                    </div>
                  </label>
                </div>
              </div>
            </section>

            <section className={styles.panelCard}>
              <div className={styles.panelHeader}>
                <div className={styles.panelHeaderTitle}>
                  <h2>Azioni Export</h2>
                  <p>Genera il formato da inviare agli operatori.</p>
                </div>
              </div>

              <div className={styles.registryForm}>
                <div className={styles.exportActionPanel}>
                  <label className={styles.exportToggleRow} htmlFor="include-pin-export">
                    <input
                      checked={includePinInExport}
                      id="include-pin-export"
                      onChange={(event) => setIncludePinInExport(event.target.checked)}
                      type="checkbox"
                    />
                    <span>Includi PIN nell&apos;export</span>
                  </label>

                  <div className={styles.exportButtonRow}>
                    <button
                      className={styles.ghostButton}
                      onClick={exportPatrolsCsv}
                      type="button"
                    >
                      Export CSV
                    </button>
                    <button
                      className={styles.mapAction}
                      onClick={exportPatrolsPdf}
                      type="button"
                    >
                      Export PDF
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </section>
        )}
      </main>
      </div>
      </div>
  );
}
