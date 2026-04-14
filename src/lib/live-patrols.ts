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
};

export type PatrolRegistryItem = {
  id: string;
  patrolCode: string;
  patrolName: string;
  pinHash: string;
  isEnabled: boolean;
  createdAt: string;
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
  },
  {
    id: "ptg002",
    patrolCode: "PTG002",
    patrolName: "RUNA",
    pinHash: "1234",
    isEnabled: true,
    createdAt: "2026-04-01T10:00:00+02:00",
  },
  {
    id: "ptg003",
    patrolCode: "PTG003",
    patrolName: "BRIC",
    pinHash: "1234",
    isEnabled: true,
    createdAt: "2026-04-01T10:00:00+02:00",
  },
  {
    id: "ptg004",
    patrolCode: "PTG004",
    patrolName: "BASE",
    pinHash: "1234",
    isEnabled: true,
    createdAt: "2026-04-08T18:00:00+02:00",
  },
  {
    id: "ptg005",
    patrolCode: "PTG005",
    patrolName: "LOST",
    pinHash: "1234",
    isEnabled: true,
    createdAt: "2026-04-08T18:05:00+02:00",
  },
];
