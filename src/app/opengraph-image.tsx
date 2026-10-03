import { ImageResponse } from "next/og";

// Social preview card. Rendered at build/request time by next/og; the text
// uses the renderer's bundled sans-serif, so nothing is fetched to draw it.

export const alt = "Keel — plans, decisions, notes and a dashboard for tech leads";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "#0a0a0a",
          color: "#fafafa",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div
            style={{
              display: "flex",
              width: 80,
              height: 80,
              borderRadius: 18,
              background: "#fafafa",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#0a0a0a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 6c4 0 6 3 8 3s4-3 8-3" />
              <path d="M12 9v9" />
              <path d="M7 18h10" />
            </svg>
          </div>
          <div style={{ fontSize: 72, fontWeight: 700, letterSpacing: "-0.03em" }}>Keel</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div style={{ fontSize: 46, lineHeight: 1.2, maxWidth: 980 }}>Plans, decisions, notes and a dashboard for tech leads</div>
          <div style={{ fontSize: 26, color: "#a1a1aa" }}>Local-first · Markdown · Arabic/RTL · Bring your own AI key</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
