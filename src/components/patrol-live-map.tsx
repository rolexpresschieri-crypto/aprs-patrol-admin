"use client";

import "leaflet/dist/leaflet.css";
import "./patrol-live-map.css";
import L from "leaflet";
import { useEffect, useMemo, useRef } from "react";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Popup,
  ScaleControl,
  TileLayer,
  useMap,
} from "react-leaflet";
import type { LatLngExpression } from "leaflet";
import {
  formatFixTimestamp,
  formatWaypointTimestamp,
  getStatusColor,
  getStatusLabel,
  hasCoordinates,
  tacticalWaypointSourceLabel,
  type LayerMode,
  type LivePatrol,
  type TacticalWaypoint,
} from "@/lib/live-patrols";

const defaultCenter: LatLngExpression = [45.0703, 7.6869];

type PatrolLiveMapProps = {
  layerMode: LayerMode;
  patrols: LivePatrol[];
  waypoints: TacticalWaypoint[];
  focusedPatrol: LivePatrol | null;
  selectedSessionId: string | null;
  onSelectPatrol: (patrol: LivePatrol) => void;
  onForceLogout: (patrol: LivePatrol) => void;
  onFocusHandled: () => void;
  canManageWaypoints?: boolean;
  onDeleteWaypoint?: (waypoint: TacticalWaypoint) => void;
  onEditWaypoint?: (waypoint: TacticalWaypoint) => void;
};

function MapViewportController({
  patrols,
  waypoints,
  focusedPatrol,
  onFocusHandled,
}: {
  patrols: LivePatrol[];
  waypoints: TacticalWaypoint[];
  focusedPatrol: LivePatrol | null;
  onFocusHandled: () => void;
}) {
  const map = useMap();
  const lastFocusedSignatureRef = useRef<string | null>(null);
  const lastBoundsSignatureRef = useRef<string | null>(null);

  /** When set of patrols with fix / waypoints changes, refit bounds (not on every GPS tick). */
  const boundsSignature = useMemo(() => {
    const patrolPart = patrols
      .filter(hasCoordinates)
      .map((p) => p.sessionId)
      .sort()
      .join("|");
    const wpPart = waypoints
      .map((w) => w.id)
      .sort()
      .join("|");
    return `${patrolPart}#${wpPart}`;
  }, [patrols, waypoints]);

  useEffect(() => {
    const focusedSignature =
      focusedPatrol &&
      focusedPatrol.lastLatitude !== null &&
      focusedPatrol.lastLongitude !== null
        ? `${focusedPatrol.sessionId}:${focusedPatrol.lastLatitude}:${focusedPatrol.lastLongitude}`
        : null;

    if (
      focusedPatrol &&
      focusedPatrol.lastLatitude !== null &&
      focusedPatrol.lastLongitude !== null &&
      focusedSignature != lastFocusedSignatureRef.current
    ) {
      lastFocusedSignatureRef.current = focusedSignature;
      map.flyTo(
        [focusedPatrol.lastLatitude, focusedPatrol.lastLongitude],
        15,
        { duration: 0.7 },
      );
      onFocusHandled();
      return;
    }

    if (boundsSignature === lastBoundsSignatureRef.current) {
      return;
    }
    lastBoundsSignatureRef.current = boundsSignature;

    const patrolPoints = patrols
      .filter(hasCoordinates)
      .map((patrol) => [patrol.lastLatitude!, patrol.lastLongitude!] as [number, number]);

    const waypointPoints = waypoints.map(
      (waypoint) => [waypoint.latitude, waypoint.longitude] as [number, number],
    );

    const points = [...patrolPoints, ...waypointPoints];

    if (points.length === 0) {
      map.setView(defaultCenter, 12);
      return;
    }

    if (points.length === 1) {
      map.setView(points[0], 14);
      return;
    }

    map.fitBounds(points, { padding: [40, 40] });
  }, [
    boundsSignature,
    focusedPatrol,
    map,
    onFocusHandled,
    patrols,
    waypoints,
  ]);

  return null;
}

/** Leaflet misura il contenitore al mount: se l’altezza flex non è ancora stabile → striscia; il click forza reflow. */
function LeafletInvalidateOnLayout() {
  const map = useMap();

  useEffect(() => {
    const el = map.getContainer();

    const invalidate = () => {
      map.invalidateSize({ animate: false });
    };

    invalidate();
    const raf1 = requestAnimationFrame(() => {
      invalidate();
      requestAnimationFrame(invalidate);
    });

    const timeouts = [40, 120, 350, 800].map((ms) =>
      window.setTimeout(invalidate, ms),
    );

    const ro = new ResizeObserver(() => invalidate());
    ro.observe(el);
    let node: HTMLElement | null = el;
    for (let i = 0; i < 4 && node; i++) {
      ro.observe(node);
      node = node.parentElement;
    }

    return () => {
      cancelAnimationFrame(raf1);
      timeouts.forEach(clearTimeout);
      ro.disconnect();
    };
  }, [map]);

  return null;
}

export default function PatrolLiveMap({
  layerMode,
  patrols,
  waypoints,
  focusedPatrol,
  selectedSessionId,
  onSelectPatrol,
  onForceLogout,
  onFocusHandled,
  canManageWaypoints = false,
  onDeleteWaypoint,
  onEditWaypoint,
}: PatrolLiveMapProps) {
  const tileUrl =
    layerMode === "orthophoto"
      ? "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
      : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

  const attribution =
    layerMode === "orthophoto"
      ? "&copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community"
      : "&copy; OpenStreetMap contributors";

  const waypointIcon = useMemo(
    () =>
      L.divIcon({
        className: "tactical-waypoint-divicon",
        html: '<div class="tactical-waypoint-glyph" aria-hidden="true">▲</div>',
        iconSize: [30, 30],
        iconAnchor: [15, 26],
        popupAnchor: [0, -22],
      }),
    [],
  );

  return (
    <MapContainer
      center={defaultCenter}
      zoom={12}
      style={{ width: "100%", height: "100%" }}
      scrollWheelZoom
      className="patrol-tactical-map"
    >
      <TileLayer attribution={attribution} url={tileUrl} />
      <ScaleControl imperial={false} maxWidth={140} metric position="bottomleft" />
      <MapViewportController
        patrols={patrols}
        waypoints={waypoints}
        focusedPatrol={focusedPatrol}
        onFocusHandled={onFocusHandled}
      />
      <LeafletInvalidateOnLayout />

      {patrols.filter(hasCoordinates).map((patrol) => {
        const selected = patrol.sessionId === selectedSessionId;

        return (
          <CircleMarker
            key={patrol.sessionId}
            center={[patrol.lastLatitude!, patrol.lastLongitude!]}
            radius={selected ? 11 : 9}
            pathOptions={{
              color: selected ? "#ffffff" : getStatusColor(patrol.status),
              weight: selected ? 3 : 2,
              fillColor: getStatusColor(patrol.status),
              fillOpacity: 0.92,
            }}
            eventHandlers={{
              click: () => onSelectPatrol(patrol),
            }}
          >
            <Popup minWidth={250}>
              <div
                style={{
                  display: "grid",
                  gap: 8,
                  minWidth: 220,
                  color: "#111827",
                }}
              >
                <div>
                  <strong>
                    {patrol.patrolCode} - {patrol.patrolName}
                  </strong>
                </div>
                <div>Missione: {patrol.missionName ?? "Non assegnata"}</div>
                <div>Stato: {getStatusLabel(patrol.status)}</div>
                <div>Ultimo fix: {formatFixTimestamp(patrol.lastFixAt)}</div>
                <div>
                  Accuratezza:{" "}
                  {patrol.lastAccuracy !== null
                    ? `${patrol.lastAccuracy.toFixed(0)} m`
                    : "n/d"}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => onSelectPatrol(patrol)}
                    style={{
                      border: 0,
                      borderRadius: 10,
                      padding: "8px 10px",
                      background: "#1171b7",
                      color: "#ffffff",
                      cursor: "pointer",
                      fontWeight: 700,
                    }}
                  >
                    Apri dettaglio
                  </button>
                  <button
                    type="button"
                    onClick={() => onForceLogout(patrol)}
                    style={{
                      border: 0,
                      borderRadius: 10,
                      padding: "8px 10px",
                      background: "#d91f2a",
                      color: "#ffffff",
                      cursor: "pointer",
                      fontWeight: 700,
                    }}
                  >
                    Force logout
                  </button>
                </div>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}

      {waypoints.map((waypoint) => (
        <Marker
          key={waypoint.id}
          position={[waypoint.latitude, waypoint.longitude]}
          icon={waypointIcon}
          zIndexOffset={800}
        >
          <Popup minWidth={260}>
            <div
              style={{
                display: "grid",
                gap: 8,
                minWidth: 220,
                color: "#111827",
              }}
            >
              <div>
                <strong>
                  {waypoint.label?.trim() ? waypoint.label : "Waypoint"}
                </strong>
              </div>
              <div>
                Coordinate: {waypoint.latitude.toFixed(5)},{" "}
                {waypoint.longitude.toFixed(5)}
              </div>
              {waypoint.altitudeM !== null ? (
                <div>Quota: {waypoint.altitudeM.toFixed(0)} m</div>
              ) : null}
              <div>
                Origine: {tacticalWaypointSourceLabel(waypoint.source)}
              </div>
              <div>
                Creato: {formatWaypointTimestamp(waypoint.createdAt)}
                {waypoint.createdByAdminCode ? (
                  <span>
                    {" "}
                    ({waypoint.createdByAdminCode})
                  </span>
                ) : null}
              </div>
              {(canManageWaypoints && (onDeleteWaypoint || onEditWaypoint)) ? (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {onEditWaypoint ? (
                    <button
                      type="button"
                      onClick={() => onEditWaypoint(waypoint)}
                      style={{
                        border: 0,
                        borderRadius: 10,
                        padding: "8px 10px",
                        background: "#1171b7",
                        color: "#ffffff",
                        cursor: "pointer",
                        fontWeight: 700,
                      }}
                    >
                      Modifica
                    </button>
                  ) : null}
                  {onDeleteWaypoint ? (
                    <button
                      type="button"
                      onClick={() => onDeleteWaypoint(waypoint)}
                      style={{
                        border: 0,
                        borderRadius: 10,
                        padding: "8px 10px",
                        background: "#d91f2a",
                        color: "#ffffff",
                        cursor: "pointer",
                        fontWeight: 700,
                      }}
                    >
                      Elimina
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
