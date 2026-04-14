"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import {
  ADMIN_SESSION_STORAGE_KEY,
  type AdminSessionData,
} from "@/lib/admin-auth";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import styles from "./page.module.css";
import {
  formatFixTimestamp,
  getStatusColor,
  getStatusLabel,
  mockPatrols,
  statusOptions,
  type LayerMode,
  type LivePatrol,
} from "@/lib/live-patrols";

const PatrolLiveMap = dynamic(() => import("@/components/patrol-live-map"), {
  ssr: false,
});

export default function FullscreenMapPage() {
  const [supabase, setSupabase] = useState<ReturnType<
    typeof getSupabaseBrowserClient
  >>(null);

  useEffect(() => {
    setSupabase(getSupabaseBrowserClient());
  }, []);

  const [patrols, setPatrols] = useState<LivePatrol[]>(mockPatrols);
  const [layerMode, setLayerMode] = useState<LayerMode>("standard");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [focusedPatrol, setFocusedPatrol] = useState<LivePatrol | null>(null);
  const [message, setMessage] = useState("Caricamento mappa fullscreen...");
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [session, setSession] = useState<AdminSessionData | null>(null);

  useEffect(() => {
    const rawSession = window.localStorage.getItem(ADMIN_SESSION_STORAGE_KEY);

    if (rawSession) {
      try {
        setSession(JSON.parse(rawSession) as AdminSessionData);
      } catch {
        window.localStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
      }
    }

    setAuthChecked(true);
  }, []);

  const loadData = useCallback(async () => {
    if (!supabase) {
      setPatrols(mockPatrols);
      setMessage("Supabase non configurato: visualizzazione mock attiva.");
      setLastRefreshAt(new Date().toISOString());
      return;
    }

    try {
      const { data, error } = await supabase
        .from("active_patrol_summaries")
        .select(
          "session_id, exercise_id, patrol_id, patrol_code, patrol_name, mission_id, mission_name, current_status, last_status_at, is_online, last_latitude, last_longitude, last_accuracy, last_fix_at",
        )
        .order("patrol_code", { ascending: true });

      if (error) {
        throw error;
      }

      const nextPatrols: LivePatrol[] = (data ?? []).map((row) => ({
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

      setPatrols(nextPatrols);
      setMessage(
        nextPatrols.length > 0
          ? "Mappa fullscreen live attiva."
          : "Nessuna pattuglia online al momento.",
      );
      setLastRefreshAt(new Date().toISOString());
    } catch (error) {
      const errorText =
        error instanceof Error ? error.message : "Errore sconosciuto.";
      setPatrols(mockPatrols);
      setMessage(`Errore feed live: ${errorText}. Rimango in mock.`);
      setLastRefreshAt(new Date().toISOString());
    }
  }, [supabase]);

  useEffect(() => {
    if (!session) {
      return;
    }

    void loadData();
  }, [loadData, session]);

  useEffect(() => {
    if (!session) {
      return;
    }

    const timer = window.setInterval(() => {
      void loadData();
    }, 20000);

    return () => window.clearInterval(timer);
  }, [loadData, session]);

  if (!authChecked) {
    return null;
  }

  if (!session) {
    return (
      <main className={styles.screen}>
        <section className={styles.lockedState}>
          <h1>Accesso richiesto</h1>
          <p>
            Apri prima il backend principale ed effettua il login come admin o viewer,
            poi riapri questa finestra fullscreen.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.screen}>
      <header className={styles.topBar}>
        <div className={styles.topTitle}>
          <span className={styles.eyebrow}>Fullscreen Tactical Map</span>
          <h1>Mappa Live Secondo Schermo</h1>
          <p>{message}</p>
        </div>

        <div className={styles.topActions}>
          <select
            className={styles.layerSelect}
            onChange={(event) => setLayerMode(event.target.value as LayerMode)}
            value={layerMode}
          >
            <option value="standard">Standard</option>
            <option value="orthophoto">Ortofoto</option>
          </select>
          <button
            className={styles.refreshButton}
            onClick={() => {
              void loadData();
            }}
            type="button"
          >
            Aggiorna
          </button>
        </div>
      </header>

      <section className={styles.legendBar}>
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
        <span className={styles.legendMeta}>
          Ultimo refresh:{" "}
          {lastRefreshAt ? formatFixTimestamp(lastRefreshAt) : "In attesa"}
        </span>
      </section>

      <section className={styles.mapShell}>
        <PatrolLiveMap
          focusedPatrol={focusedPatrol}
          layerMode={layerMode}
          onFocusHandled={() => setFocusedPatrol(null)}
          onForceLogout={() => {}}
          onSelectPatrol={(patrol) => {
            setSelectedSessionId(patrol.sessionId);
            setFocusedPatrol(patrol);
          }}
          patrols={patrols}
          selectedSessionId={selectedSessionId}
        />
      </section>

      <section className={styles.bottomStrip}>
        {patrols.map((patrol) => (
          <button
            key={patrol.sessionId}
            className={styles.patrolChip}
            onClick={() => {
              setSelectedSessionId(patrol.sessionId);
              setFocusedPatrol(patrol);
            }}
            type="button"
          >
            <span
              className={styles.patrolChipDot}
              style={{ backgroundColor: getStatusColor(patrol.status) }}
            />
            {patrol.patrolCode} - {patrol.patrolName} | {getStatusLabel(patrol.status)}
          </button>
        ))}
      </section>
    </main>
  );
}
