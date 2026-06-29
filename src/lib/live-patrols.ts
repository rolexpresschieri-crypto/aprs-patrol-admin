export type LayerMode = "standard" | "orthophoto";

export type LivePatrol = {
  sessionId: string;
  exerciseId: string;
  patrolId: string;
  patrolCode: string;
  patrolName: string;
  missionId: string | null;
  missionName: string | null;
  status: string;
  isOnline: boolean;
  lastLatitude: number | null;
  lastLongitude: number | null;
  lastAccuracy: number | null;
  lastFixAt: string | null;
  lastStatusAt: string;
  /** `#RRGGBB` sulla tabella `patrols`: solo colore traccia sulla mappa; il marker usa il colore di stato. */
  mapColor: string | null;
};

/** `tactical_map_points` — stessi campi usati da app mobile + inserimenti backoffice. */
export type TacticalWaypoint = {
  id: string;
  exerciseId: string;
  label: string | null;
  latitude: number;
  longitude: number;
  altitudeM: number | null;
  createdAt: string;
  createdByAdminCode: string | null;
  source: string;
};

export type ExerciseOption = {
  id: string;
  title: string;
  isActive: boolean | null;
};

export type PatrolRegistryItem = {
  id: string;
  patrolCode: string;
  patrolName: string;
  pinHash: string;
  isEnabled: boolean;
  createdAt: string;
  /** `#RRGGBB` quando impostato in backoffice. */
  mapColor: string | null;
};

export type PatrolSessionRecord = {
  id: string;
  patrolCode: string;
  patrolName: string;
  status: string;
  isOnline: boolean;
  loginAt: string;
  logoutAt: string | null;
  lastStatusAt: string;
  missionGroups: Array<{
    missionId: string | null;
    missionName: string | null;
    startMissionAt: string | null;
    targetAt: string | null;
    endMissionAt: string | null;
    events: Array<{
      status: string;
      changedAt: string;
    }>;
  }>;
  statusTimeline: Array<{
    missionId: string | null;
    missionName: string | null;
    status: string;
    changedAt: string;
  }>;
};

export const statusOptions = [
  { value: "all", label: "Tutti gli stati" },
  { value: "start_mission", label: "START MISSION" },
  { value: "moving", label: "MOVIMENTO" },
  { value: "target", label: "TARGET" },
  { value: "operation_start", label: "INIZIO OPERAZIONE" },
  { value: "operation_end", label: "FINE OPERAZIONE" },
  { value: "standby", label: "STAND-BY" },
  { value: "end_mission", label: "END MISSION" },
] as const;

export const layerOptions = [
  { value: "standard", label: "Standard" },
  { value: "orthophoto", label: "Ortofoto" },
] as const satisfies ReadonlyArray<{ value: LayerMode; label: string }>;

const statusMap: Record<string, { label: string; color: string }> = {
  start_mission: { label: "START MISSION", color: "#1171B7" },
  moving: { label: "MOVIMENTO", color: "#34D12C" },
  target: { label: "TARGET", color: "#FFF100" },
  operation_start: { label: "INIZIO OPERAZIONE", color: "#FF1A14" },
  operation_end: { label: "FINE OPERAZIONE", color: "#FFA726" },
  standby: { label: "STAND-BY", color: "#7E57C2" },
  end_mission: { label: "END MISSION", color: "#90A4AE" },
};

export function getStatusLabel(status: string) {
  return statusMap[status]?.label ?? status.toUpperCase();
}

export function getStatusColor(status: string) {
  return statusMap[status]?.color ?? "#9ca3af";
}

const HEX_MAP_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

export function normalizePatrolMapColor(input: string | null | undefined): string | null {
  const trimmed = input?.trim() ?? "";
  if (!trimmed || !HEX_MAP_COLOR_RE.test(trimmed)) {
    return null;
  }
  return trimmed.toUpperCase();
}

/** Codici/etichette operativi: sempre maiuscolo (anche in digitazione). */
export function normalizeUppercaseField(value: string): string {
  return value.toLocaleUpperCase("en-US");
}

/** Colore marker mappa = colore stato operativo della pattuglia. */
export function getPatrolMarkerFillColor(patrol: { status: string }) {
  return getStatusColor(patrol.status);
}

/** Colore traccia sulla mappa: `map_color` pattuglia, altrimenti stesso fallback del marker (stato). */
export function getPatrolTrackStrokeColor(patrol: {
  status: string;
  mapColor: string | null;
}) {
  const hex = normalizePatrolMapColor(patrol.mapColor);
  return hex ?? getStatusColor(patrol.status);
}

export const PATROL_MAP_COLOR_PALETTE = [
  "#1171B7",
  "#34D12C",
  "#FFB300",
  "#D91F2A",
  "#7E57C2",
  "#0097A7",
  "#C2185B",
  "#5D4037",
] as const;

/** Nomi semplificati rosso/blu/verde/celeste… (palette + stati/UI comuni). */
const PATROL_MAP_COLOR_LABELS_IT: Record<string, string> = {
  "#1171B7": "Blu",
  "#34D12C": "Verde",
  "#FFB300": "Giallo",
  "#D91F2A": "Rosso",
  "#7E57C2": "Viola",
  "#0097A7": "Celeste",
  "#C2185B": "Rosa",
  "#5D4037": "Marrone",
  "#FFA726": "Arancio",
  "#FF1A14": "Rosso",
  "#FFF100": "Giallo",
  "#90A4AE": "Grigio",
  "#079B42": "Verde",
};

function italianColorWordFromHex(hex: string): string {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  const l = (max + min) / 2;

  let h = 0;
  if (d > 1e-6) {
    if (max === rn) {
      h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
    } else if (max === gn) {
      h = ((bn - rn) / d + 2) / 6;
    } else {
      h = ((rn - gn) / d + 4) / 6;
    }
  }
  h *= 360;

  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));

  if (l < 0.1) {
    return "Nero";
  }
  if (l > 0.93 && s < 0.12) {
    return "Bianco";
  }
  if (s < 0.12) {
    return "Grigio";
  }
  if (s < 0.28 && l > 0.12 && l < 0.45) {
    return "Marrone";
  }

  if (h < 12 || h >= 352) {
    return "Rosso";
  }
  if (h < 42) {
    return "Arancio";
  }
  if (h < 62) {
    return "Giallo";
  }
  if (h < 150) {
    return "Verde";
  }
  if (h < 188) {
    return "Celeste";
  }
  if (h < 258) {
    return "Blu";
  }
  if (h < 292) {
    return "Viola";
  }
  if (h < 337) {
    return "Rosa";
  }
  return "Rosso";
}

/**
 * Etichetta CSV/PDF: solo nome colore in italiano (rosso, blu, verde, celeste, …).
 * Per hex non in elenco si stima la tonalità; senza `map_color` si usa il colore di stato sulla mappa.
 */
export function formatPatrolMapColorForExport(raw: string | null | undefined): string {
  const hex = normalizePatrolMapColor(raw);
  if (!hex) {
    return "Predefinito (come stato sulla mappa)";
  }
  return PATROL_MAP_COLOR_LABELS_IT[hex] ?? italianColorWordFromHex(hex);
}

export function pickDefaultPatrolMapColor(items: PatrolRegistryItem[]): string {
  const used = new Set(
    items
      .map((r) => normalizePatrolMapColor(r.mapColor)?.toLowerCase())
      .filter((v): v is string => Boolean(v)),
  );
  for (const c of PATROL_MAP_COLOR_PALETTE) {
    if (!used.has(c.toLowerCase())) {
      return c;
    }
  }
  const idx =
    PATROL_MAP_COLOR_PALETTE.length > 0 ? items.length % PATROL_MAP_COLOR_PALETTE.length : 0;
  return PATROL_MAP_COLOR_PALETTE[idx]!;
}

/** Finestra lettura traccia (pings): ~30 min app + margine orologio. */
export const PATROL_TRACK_HISTORY_MINUTES = 31;

/** Righe `patrol_position_pings` → coordinate per `session_id` (ordine righe = ordine tempo se la query è ordinata). */
export function groupPatrolTrackPointsBySession(
  rows: Record<string, unknown>[],
): Record<string, [number, number][]> {
  const map: Record<string, [number, number][]> = {};
  for (const row of rows) {
    const sid = String(row.session_id ?? "");
    const lat = Number(row.latitude);
    const lon = Number(row.longitude);
    if (!sid || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      continue;
    }
    if (!map[sid]) {
      map[sid] = [];
    }
    map[sid].push([lat, lon]);
  }
  return map;
}

export function formatFixTimestamp(timestamp: string | null) {
  if (!timestamp) {
    return "GPS in acquisizione";
  }

  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(timestamp));
}

export function formatTimeOnly(timestamp: string | null) {
  if (!timestamp) {
    return "n/d";
  }

  return new Intl.DateTimeFormat("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

export function hasCoordinates(patrol: LivePatrol) {
  return patrol.lastLatitude !== null && patrol.lastLongitude !== null;
}

export function tacticalWaypointSourceLabel(source: string) {
  const s = source.trim().toLowerCase();
  if (s === "toc_mobile") {
    return "App TOC";
  }
  if (s === "backoffice") {
    return "Backoffice PC";
  }
  return source || "—";
}

export function formatWaypointTimestamp(iso: string | null) {
  if (!iso) {
    return "n/d";
  }
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function compareTacticalWaypointsAlphabetically(
  a: TacticalWaypoint,
  b: TacticalWaypoint,
): number {
  const labelA = (a.label ?? "").trim();
  const labelB = (b.label ?? "").trim();
  if (!labelA && !labelB) return a.id.localeCompare(b.id);
  if (!labelA) return 1;
  if (!labelB) return -1;
  const cmp = labelA.localeCompare(labelB, "it", { sensitivity: "base" });
  return cmp !== 0 ? cmp : a.id.localeCompare(b.id);
}

/** Ordine A–Z sull’etichetta (locale it), senza nome in fondo. */
export function sortTacticalWaypointsAlphabetically(
  waypoints: TacticalWaypoint[],
): TacticalWaypoint[] {
  return [...waypoints].sort(compareTacticalWaypointsAlphabetically);
}

/** Righe Supabase → modello UI condiviso (live map + fullscreen). */
export function tacticalWaypointsFromRows(
  rows: Record<string, unknown>[],
): TacticalWaypoint[] {
  const parsed = rows
    .map((row) => {
      const lat = Number(row.latitude);
      const lon = Number(row.longitude);
      return {
        id: String(row.id),
        exerciseId: String(row.exercise_id),
        label: (row.label as string | null) ?? null,
        latitude: lat,
        longitude: lon,
        altitudeM: row.altitude_m != null ? Number(row.altitude_m) : null,
        createdAt: String(row.created_at),
        createdByAdminCode: (row.created_by_admin_code as string | null) ?? null,
        source: (row.source as string) ?? "toc_mobile",
      };
    })
    .filter(
      (w) => w.id.length > 0 && Number.isFinite(w.latitude) && Number.isFinite(w.longitude),
    );

  return sortTacticalWaypointsAlphabetically(parsed);
}

export function formatSessionDuration(loginAt: string, logoutAt: string | null) {
  const start = new Date(loginAt).getTime();
  const end = logoutAt ? new Date(logoutAt).getTime() : Date.now();

  if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
    return "n/d";
  }

  const totalMinutes = Math.floor((end - start) / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
}

export function formatDurationBetween(
  startAt: string | null,
  endAt: string | null,
) {
  if (!startAt || !endAt) {
    return "n/d";
  }

  const start = new Date(startAt).getTime();
  const end = new Date(endAt).getTime();

  if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
    return "n/d";
  }

  const totalMinutes = Math.floor((end - start) / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
}

export function formatTimelineStepDuration(
  previousAt: string | null,
  currentAt: string | null,
) {
  if (!currentAt) {
    return "n/d";
  }

  if (!previousAt) {
    return "0h 00m";
  }

  return formatDurationBetween(previousAt, currentAt);
}

export const mockPatrols: LivePatrol[] = [
  {
    sessionId: "demo-session-001",
    exerciseId: "demo-exercise",
    patrolId: "ptg001",
    patrolCode: "PTG001",
    patrolName: "LUPO",
    missionId: "alfa",
    missionName: "MISSIONE ALFA",
    status: "moving",
    isOnline: true,
    lastLatitude: 45.0703,
    lastLongitude: 7.6869,
    lastAccuracy: 8,
    lastFixAt: "2026-04-07T18:32:10+02:00",
    lastStatusAt: "2026-04-07T18:32:10+02:00",
    mapColor: "#1171B7",
  },
  {
    sessionId: "demo-session-002",
    exerciseId: "demo-exercise",
    patrolId: "ptg002",
    patrolCode: "PTG002",
    patrolName: "RUNA",
    missionId: "bravo",
    missionName: "MISSIONE BRAVO",
    status: "target",
    isOnline: true,
    lastLatitude: 45.072,
    lastLongitude: 7.6905,
    lastAccuracy: 11,
    lastFixAt: "2026-04-07T18:32:00+02:00",
    lastStatusAt: "2026-04-07T18:32:00+02:00",
    mapColor: "#34D12C",
  },
  {
    sessionId: "demo-session-004",
    exerciseId: "demo-exercise",
    patrolId: "ptg004",
    patrolCode: "PTG004",
    patrolName: "BASE",
    missionId: "alfa",
    missionName: "MISSIONE ALFA",
    status: "standby",
    isOnline: true,
    lastLatitude: 45.0687,
    lastLongitude: 7.6824,
    lastAccuracy: 5,
    lastFixAt: "2026-04-07T18:31:00+02:00",
    lastStatusAt: "2026-04-07T18:31:00+02:00",
    mapColor: "#7E57C2",
  },
  {
    sessionId: "demo-session-005",
    exerciseId: "demo-exercise",
    patrolId: "ptg005",
    patrolCode: "PTG005",
    patrolName: "LOST",
    missionId: "charlie",
    missionName: "MISSIONE CHARLIE",
    status: "start_mission",
    isOnline: true,
    lastLatitude: null,
    lastLongitude: null,
    lastAccuracy: null,
    lastFixAt: null,
    lastStatusAt: "2026-04-07T18:30:00+02:00",
    mapColor: "#FFB300",
  },
];

export const mockWaypoints: TacticalWaypoint[] = [
  {
    id: "demo-wp-001",
    exerciseId: "demo-exercise",
    label: "CP Alfa (demo)",
    latitude: 45.071,
    longitude: 7.688,
    altitudeM: 245,
    createdAt: "2026-04-07T12:00:00+02:00",
    createdByAdminCode: "demo",
    source: "backoffice",
  },
];

export const mockPatrolRegistry: PatrolRegistryItem[] = [
  {
    id: "ptg001",
    patrolCode: "PTG001",
    patrolName: "LUPO",
    pinHash: "1234",
    isEnabled: true,
    createdAt: "2026-04-01T10:00:00+02:00",
    mapColor: "#1171B7",
  },
  {
    id: "ptg002",
    patrolCode: "PTG002",
    patrolName: "RUNA",
    pinHash: "1234",
    isEnabled: true,
    createdAt: "2026-04-01T10:00:00+02:00",
    mapColor: "#34D12C",
  },
  {
    id: "ptg003",
    patrolCode: "PTG003",
    patrolName: "BRIC",
    pinHash: "1234",
    isEnabled: true,
    createdAt: "2026-04-01T10:00:00+02:00",
    mapColor: "#FFB300",
  },
  {
    id: "ptg004",
    patrolCode: "PTG004",
    patrolName: "BASE",
    pinHash: "1234",
    isEnabled: true,
    createdAt: "2026-04-08T18:00:00+02:00",
    mapColor: "#7E57C2",
  },
  {
    id: "ptg005",
    patrolCode: "PTG005",
    patrolName: "LOST",
    pinHash: "1234",
    isEnabled: true,
    createdAt: "2026-04-08T18:05:00+02:00",
    mapColor: "#D91F2A",
  },
];
