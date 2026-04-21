import { LiveMapPage } from "@/components/live-map-page";

/** Evita che Vercel/edge serva una shell HTML vecchia (“backoffice sempre uguale” senza redeploy). */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function Home() {
  return <LiveMapPage />;
}
