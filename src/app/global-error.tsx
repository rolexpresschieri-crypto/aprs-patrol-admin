"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="it">
      <body style={{ fontFamily: "system-ui", padding: 24 }}>
        <h2>Errore nel pannello</h2>
        <p style={{ color: "#666" }}>{error.message}</p>
        <button type="button" onClick={reset}>
          Riprova
        </button>
      </body>
    </html>
  );
}
