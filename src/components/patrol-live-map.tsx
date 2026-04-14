"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import {
  CircleMarker,
  MapContainer,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import type { LatLngExpression } from "leaflet";
import {
  formatFixTimestamp,
  getStatusColor,
  getStatusLabel,
  hasCoordinates,
  type LayerMode,
  type LivePatrol,
} from "@/lib/live-patrols";

const defaultCenter: LatLngExpression = [45.0703, 7.6869];

type PatrolLiveMapProps = {
  layerMode: LayerMode;
  patrols: LivePatrol[];
  focusedPatrol: LivePatrol | null;
  selectedSessionId: string | null;
  onSelectPatrol: (patrol: LivePatrol) => void;
  onForceLogout: (patrol: LivePatrol) => void;
  onFocusHandled: () => void;
};

function MapViewportController({
  patrols,
  focusedPatrol,
  onFocusHandled,
}: {
  patrols: LivePatrol[];
  focusedPatrol: LivePatrol | null;
  onFocusHandled: () => void;
}) {
  const map = useMap();
  const initializedRef = useRef(false);
  const lastFocusedSignatureRef = useRef<string | null>(null);

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

    if (initializedRef.current) {
      return;
    }

    const points = patrols
      .filter(hasCoordinates)
      .map((patrol) => [patrol.lastLatitude!, patrol.lastLongitude!] as [number, number]);

    if (points.length === 0) {
      map.setView(defaultCenter, 12);
      initializedRef.current = true;
      return;
    }

    if (points.length === 1) {
      map.setView(points[0], 14);
      initializedRef.current = true;
      return;
    }

    map.fitBounds(points, { padding: [40, 40] });
    initializedRef.current = true;
  }, [focusedPatrol, map, onFocusHandled, patrols]);

  return null;
}

export default function PatrolLiveMap({
  layerMode,
  patrols,
  focusedPatrol,
  selectedSessionId,
  onSelectPatrol,
  onForceLogout,
  onFocusHandled,
}: PatrolLiveMapProps) {
  const tileUrl =
    layerMode === "orthophoto"
      ? "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
      : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

  const attribution =
    layerMode === "orthophoto"
      ? "&copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community"
      : "&copy; OpenStreetMap contributors";

  return (
    <MapContainer
      center={defaultCenter}
      zoom={12}
      style={{ width: "100%", height: "100%" }}
      scrollWheelZoom
    >
      <TileLayer attribution={attribution} url={tileUrl} />
      <MapViewportController
        patrols={patrols}
        focusedPatrol={focusedPatrol}
        onFocusHandled={onFocusHandled}
      />

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
    </MapContainer>
  );
}
