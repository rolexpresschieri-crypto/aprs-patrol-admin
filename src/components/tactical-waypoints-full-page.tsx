"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  type FormEvent,
} from "react";
import {
  ADMIN_SESSION_STORAGE_KEY,
  normalizeAdminRole,
  type AdminSessionData,
} from "@/lib/admin-auth";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import mapStyles from "./live-map-page.module.css";
import pageStyles from "./tactical-waypoints-full-page.module.css";
import {
  formatWaypointTimestamp,
  mockWaypoints,
  tacticalWaypointSourceLabel,
  tacticalWaypointsFromRows,
  type ExerciseOption,
  type TacticalWaypoint,
} from "@/lib/live-patrols";

const SUPABASE_BATCH_TIMEOUT_MS = 45_000;

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

export function TacticalWaypointsFullPage() {
  const [supabase, setSupabase] = useState<ReturnType<
    typeof getSupabaseBrowserClient
  >>(null);

  useLayoutEffect(() => {
    setSupabase(getSupabaseBrowserClient());
  }, []);

  const [authChecked, setAuthChecked] = useState(false);
  const [session, setSession] = useState<AdminSessionData | null>(null);
  const [loading, setLoading] = useState(true);

  const [waypoints, setWaypoints] = useState<TacticalWaypoint[]>([]);
  const [exerciseOptions, setExerciseOptions] = useState<ExerciseOption[]>([]);
  const [waypointExerciseId, setWaypointExerciseId] = useState("");
  const [waypointLabel, setWaypointLabel] = useState("");
  const [waypointLat, setWaypointLat] = useState("");
  const [waypointLon, setWaypointLon] = useState("");
  const [waypointAlt, setWaypointAlt] = useState("");
  const [editingWaypointId, setEditingWaypointId] = useState<string | null>(null);
  const [waypointBusy, setWaypointBusy] = useState(false);
  const [waypointFormError, setWaypointFormError] = useState<string | null>(null);
  const [waypointFeedError, setWaypointFeedError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

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

  const isViewer = session?.role === "viewer";
  const canEdit = session?.role === "admin";

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
      setWaypointFeedError(`Aggiornamento waypoint: ${error.message}`);
    }
  }, [supabase]);

  const loadWaypointPageData = useCallback(async () => {
    if (!supabase) {
      setWaypoints(mockWaypoints);
      setExerciseOptions([]);
      setWaypointFeedError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      let wpRes;
      let exRes;
      let activeExerciseRes;

      try {
        [wpRes, exRes, activeExerciseRes] = await raceSupabaseBatch(
          Promise.all([
            supabase
              .from("tactical_map_points")
              .select("*")
              .order("created_at", { ascending: false })
              .limit(400),
            supabase.from("exercises").select("id, title, is_active").order("title"),
            supabase.from("exercises").select("id, title").eq("is_active", true).maybeSingle(),
          ]),
          "Lettura waypoint ed esercitazioni",
        );
      } catch (batchErr) {
        const msg = batchErr instanceof Error ? batchErr.message : String(batchErr);
        wpRes = { data: [], error: { message: msg } };
        exRes = { data: [], error: null };
        activeExerciseRes = { data: null, error: null };
      }

      if (!wpRes.error && wpRes.data) {
        setWaypoints(tacticalWaypointsFromRows(wpRes.data as Record<string, unknown>[]));
        setWaypointFeedError(null);
      } else if (wpRes.error) {
        setWaypointFeedError(
          `Lettura waypoint non riuscita: ${wpRes.error.message}. Verifica tabella e policy RLS su tactical_map_points.`,
        );
        setWaypoints([]);
      }

      let nextExercises: ExerciseOption[] = [];
      if (!exRes.error && exRes.data) {
        nextExercises = exRes.data.map((row) => ({
          id: row.id as string,
          title: ((row.title as string) ?? "").trim() || "Esercitazione",
          isActive: (row.is_active as boolean | null) ?? null,
        }));
      }

      if (
        nextExercises.length === 0 &&
        !activeExerciseRes.error &&
        activeExerciseRes.data?.id
      ) {
        nextExercises = [
          {
            id: activeExerciseRes.data.id as string,
            title:
              (((activeExerciseRes.data.title as string) ?? "").trim() ||
                "Esercitazione attiva"),
            isActive: true,
          },
        ];
      }

      setExerciseOptions(nextExercises);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    if (!authChecked || !session) {
      return;
    }
    void loadWaypointPageData();
  }, [authChecked, loadWaypointPageData, session]);

  useEffect(() => {
    if (exerciseOptions.length === 0) {
      return;
    }

    setWaypointExerciseId((prev) => {
      if (prev && exerciseOptions.some((row) => row.id === prev)) {
        return prev;
      }

      const active = exerciseOptions.find((row) => row.isActive);
      return active?.id ?? exerciseOptions[0]!.id;
    });
  }, [exerciseOptions]);

  useEffect(() => {
    if (!authChecked || !supabase || !session) {
      return;
    }

    const channel = supabase
      .channel("realtime-tactical-map-points-waypoints-page")
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

  function resetWaypointForm() {
    setEditingWaypointId(null);
    setWaypointLabel("");
    setWaypointLat("");
    setWaypointLon("");
    setWaypointAlt("");
    setWaypointFormError(null);
  }

  function beginEditWaypoint(waypoint: TacticalWaypoint) {
    setWaypointFormError(null);
    setEditingWaypointId(waypoint.id);
    setWaypointExerciseId(waypoint.exerciseId);
    setWaypointLabel(waypoint.label ?? "");
    setWaypointLat(String(waypoint.latitude));
    setWaypointLon(String(waypoint.longitude));
    setWaypointAlt(waypoint.altitudeM !== null ? String(waypoint.altitudeM) : "");
  }

  async function handleWaypointSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supabase || !session) {
      setWaypointFormError("Sessione non valida.");
      return;
    }

    if (!canEdit) {
      setWaypointFormError("Solo gli admin possono modificare i waypoint.");
      return;
    }

    const latTrim = waypointLat.trim();
    const lonTrim = waypointLon.trim();
    if (!latTrim || !lonTrim) {
      setWaypointFormError("Inserisci latitudine e longitudine.");
      return;
    }

    const lat = Number(latTrim.replace(",", "."));
    const lon = Number(lonTrim.replace(",", "."));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      setWaypointFormError("Latitudine e longitudine devono essere numeri validi.");
      return;
    }

    if (!waypointExerciseId) {
      setWaypointFormError("Seleziona un'esercitazione.");
      return;
    }

    const altTrim = waypointAlt.trim();
    const altitudeParsed =
      altTrim === "" ? null : Number(altTrim.replace(",", "."));

    if (altitudeParsed !== null && !Number.isFinite(altitudeParsed)) {
      setWaypointFormError("Quota non valida.");
      return;
    }

    setWaypointBusy(true);
    setWaypointFormError(null);

    try {
      if (editingWaypointId) {
        const { error } = await supabase
          .from("tactical_map_points")
          .update({
            exercise_id: waypointExerciseId,
            latitude: lat,
            longitude: lon,
            altitude_m: altitudeParsed,
            label: waypointLabel.trim() ? waypointLabel.trim() : null,
          })
          .eq("id", editingWaypointId);

        if (error) {
          throw error;
        }

        setToast("Waypoint aggiornato.");
      } else {
        const { error } = await supabase.from("tactical_map_points").insert({
          exercise_id: waypointExerciseId,
          latitude: lat,
          longitude: lon,
          altitude_m: altitudeParsed,
          label: waypointLabel.trim() ? waypointLabel.trim() : null,
          created_by_admin_code: session.code,
          source: "backoffice",
        });

        if (error) {
          throw error;
        }

        setToast("Nuovo waypoint salvato sul database.");
      }

      resetWaypointForm();
      await refreshWaypointsOnly();
    } catch (error) {
      const errorText =
        error instanceof Error ? error.message : "Errore sconosciuto.";
      setWaypointFormError(errorText);
    } finally {
      setWaypointBusy(false);
    }
  }

  async function handleDeleteWaypoint(waypoint: TacticalWaypoint) {
    if (!supabase || !canEdit) {
      setToast("Eliminazione waypoint non consentita.");
      return;
    }

    const confirmed = window.confirm(
      `Eliminare il waypoint "${waypoint.label?.trim() || "senza nome"}"?`,
    );

    if (!confirmed) {
      return;
    }

    setWaypointBusy(true);
    setWaypointFormError(null);

    try {
      const { error } = await supabase
        .from("tactical_map_points")
        .delete()
        .eq("id", waypoint.id);

      if (error) {
        throw error;
      }

      if (editingWaypointId === waypoint.id) {
        resetWaypointForm();
      }

      setToast("Waypoint eliminato.");
      await refreshWaypointsOnly();
    } catch (error) {
      const errorText =
        error instanceof Error ? error.message : "Errore sconosciuto.";
      setWaypointFormError(errorText);
    } finally {
      setWaypointBusy(false);
    }
  }

  if (!authChecked) {
    return (
      <div className={pageStyles.root}>
        <div className={pageStyles.loginHint}>Caricamento…</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className={pageStyles.root}>
        <div className={pageStyles.loginHint}>
          <p>
            Accedi al backoffice dalla{" "}
            <Link href="/">pagina principale</Link> per gestire i waypoint.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={pageStyles.root}>
      <header className={pageStyles.topBar}>
        <h1>Waypoint tattici</h1>
        <div className={pageStyles.topActions}>
          {isViewer ? (
            <span style={{ opacity: 0.85, fontSize: 14 }}>Profilo viewer (sola lettura)</span>
          ) : null}
          <Link className={pageStyles.backLink} href="/">
            ← Mappa live
          </Link>
        </div>
      </header>

      <div className={pageStyles.scroll}>
        <div className={pageStyles.maxWidth}>
          {toast ? (
            <div className={pageStyles.toast} role="status">
              {toast}
              <button
                type="button"
                onClick={() => setToast(null)}
                style={{
                  marginLeft: 12,
                  background: "transparent",
                  border: "none",
                  color: "inherit",
                  cursor: "pointer",
                  textDecoration: "underline",
                }}
              >
                Chiudi
              </button>
            </div>
          ) : null}

          {loading ? (
            <p style={{ opacity: 0.85 }}>Caricamento dati…</p>
          ) : (
            <section
              className={`${mapStyles.panelCard} ${mapStyles.waypointPanelCard} ${mapStyles.waypointPanelAnchor}`}
              id="waypoint-tactical-panel-full"
            >
              <div className={mapStyles.panelHeader}>
                <div className={mapStyles.panelHeaderTitle}>
                  <h2 className={mapStyles.waypointPanelTitle}>Waypoint tattici</h2>
                  <p className={mapStyles.waypointPanelHeaderDesc}>
                    Stesso database dell&apos;app TOC (
                    <code>tactical_map_points</code>): lettura realtime; creazione /
                    modifica da PC con profilo admin.
                  </p>
                </div>
              </div>

              <div className={mapStyles.waypointPanelBody}>
                <div className={mapStyles.registryForm}>
                  <div className={mapStyles.messageBox}>
                    {waypoints.length} waypoint in elenco · Ultima fonte: sincronizzazione
                    Supabase e canale Realtime.
                  </div>

                  {waypointFeedError ? (
                    <div
                      className={mapStyles.messageBox}
                      style={{ borderColor: "#ffa726", color: "#ffe0b2" }}
                    >
                      {waypointFeedError}
                    </div>
                  ) : null}

                  {waypointFormError ? (
                    <div className={mapStyles.messageBox} style={{ borderColor: "#d91f2a" }}>
                      {waypointFormError}
                    </div>
                  ) : null}

                  {canEdit && supabase && exerciseOptions.length > 0 ? (
                    <form noValidate onSubmit={handleWaypointSubmit}>
                      <div className={mapStyles.fieldGroup}>
                        <label htmlFor="wp-exercise-full">Esercitazione</label>
                        <select
                          id="wp-exercise-full"
                          value={waypointExerciseId}
                          onChange={(event) => setWaypointExerciseId(event.target.value)}
                        >
                          {exerciseOptions.map((row) => (
                            <option key={row.id} value={row.id}>
                              {row.title}
                              {row.isActive ? " (attiva)" : ""}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className={mapStyles.fieldGroup}>
                        <label htmlFor="wp-label-full">Etichetta</label>
                        <input
                          id="wp-label-full"
                          placeholder="Es. CP nord / Obiettivo"
                          value={waypointLabel}
                          onChange={(event) => setWaypointLabel(event.target.value)}
                        />
                      </div>

                      <div className={mapStyles.formGrid}>
                        <div className={mapStyles.fieldGroup}>
                          <label htmlFor="wp-lat-full">Latitudine</label>
                          <input
                            id="wp-lat-full"
                            placeholder="es. 45.12345"
                            value={waypointLat}
                            onChange={(event) => setWaypointLat(event.target.value)}
                          />
                        </div>
                        <div className={mapStyles.fieldGroup}>
                          <label htmlFor="wp-lon-full">Longitudine</label>
                          <input
                            id="wp-lon-full"
                            placeholder="es. 7.98765"
                            value={waypointLon}
                            onChange={(event) => setWaypointLon(event.target.value)}
                          />
                        </div>
                      </div>

                      <div className={mapStyles.fieldGroup}>
                        <label htmlFor="wp-alt-full">Quota (m, opzionale)</label>
                        <input
                          id="wp-alt-full"
                          placeholder="es. 320"
                          value={waypointAlt}
                          onChange={(event) => setWaypointAlt(event.target.value)}
                        />
                      </div>

                      <div className={mapStyles.formActions}>
                        <button
                          className={mapStyles.mapAction}
                          disabled={waypointBusy}
                          type="submit"
                        >
                          {editingWaypointId ? "Salva modifiche" : "Aggiungi waypoint"}
                        </button>
                        {editingWaypointId ? (
                          <button
                            className={mapStyles.ghostButton}
                            disabled={waypointBusy}
                            onClick={() => {
                              resetWaypointForm();
                            }}
                            type="button"
                          >
                            Annulla modifica
                          </button>
                        ) : null}
                      </div>
                    </form>
                  ) : null}

                  {canEdit && supabase && exerciseOptions.length === 0 ? (
                    <div className={mapStyles.emptyState}>
                      Nessuna esercitazione trovata su Supabase (`exercises`). Inserisci almeno
                      una riga per poter creare waypoint dal backoffice.
                    </div>
                  ) : null}

                  {!canEdit ? (
                    <div className={mapStyles.emptyState}>
                      Profilo viewer: puoi vedere waypoint e coordinate, ma non modificarli.
                    </div>
                  ) : null}

                  <div className={mapStyles.listBody} style={{ marginTop: 12 }}>
                    {waypoints.length === 0 ? (
                      <div className={mapStyles.emptyState}>Nessun waypoint registrato.</div>
                    ) : (
                      waypoints.map((waypoint) => (
                        <article className={mapStyles.listItem} key={waypoint.id}>
                          <div className={mapStyles.listRow}>
                            <div className={mapStyles.listIdentity}>
                              <div className={mapStyles.listIdentityTop}>
                                <span className={mapStyles.listCode}>
                                  {waypoint.label?.trim() || "Waypoint"}
                                </span>
                                <span className={mapStyles.missionText}>
                                  {waypoint.latitude.toFixed(5)}, {waypoint.longitude.toFixed(5)}
                                  {waypoint.altitudeM !== null
                                    ? ` · ${waypoint.altitudeM.toFixed(0)} m`
                                    : ""}
                                </span>
                              </div>
                              <span className={mapStyles.missionText}>
                                {tacticalWaypointSourceLabel(waypoint.source)} ·{" "}
                                {formatWaypointTimestamp(waypoint.createdAt)}
                                {waypoint.createdByAdminCode
                                  ? ` · ${waypoint.createdByAdminCode}`
                                  : ""}
                              </span>
                            </div>
                            {canEdit && supabase ? (
                              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                <button
                                  className={mapStyles.inlineButton}
                                  disabled={waypointBusy}
                                  onClick={() => beginEditWaypoint(waypoint)}
                                  type="button"
                                >
                                  Modifica
                                </button>
                                <button
                                  className={mapStyles.inlineButton}
                                  disabled={waypointBusy}
                                  onClick={() => void handleDeleteWaypoint(waypoint)}
                                  style={{ color: "#ff8a80" }}
                                  type="button"
                                >
                                  Elimina
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </article>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
