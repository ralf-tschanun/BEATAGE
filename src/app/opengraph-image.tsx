import { ImageResponse } from "next/og";
import { BRAND_NAME } from "@/lib/brand";

export const alt = `${BRAND_NAME} — guess the release year`;
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
          justifyContent: "center",
          padding: "72px 80px",
          background: "linear-gradient(145deg, #0c0f14 0%, #161b22 55%, #1a2332 100%)",
          color: "#f4f6f8",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 64,
            fontWeight: 700,
            letterSpacing: "-0.03em",
            lineHeight: 1.1,
          }}
        >
          {BRAND_NAME}
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 28,
            fontSize: 40,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            color: "#e8edf2",
          }}
        >
          Guess the release year.
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 18,
            maxWidth: 820,
            fontSize: 26,
            lineHeight: 1.4,
            color: "#9aa7b5",
          }}
        >
          Host plays a track on Spotify. Friends score years off.
        </div>
      </div>
    ),
    { ...size },
  );
}
