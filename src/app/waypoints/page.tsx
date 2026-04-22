import { Suspense } from "react";
import { TacticalWaypointsFullPage } from "@/components/tactical-waypoints-full-page";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function WaypointsPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24, color: "#edf2ff" }}>Caricamento…</div>}>
      <TacticalWaypointsFullPage />
    </Suspense>
  );
}
