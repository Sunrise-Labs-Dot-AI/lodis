import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 40,
          background: "linear-gradient(135deg, #0a0e1a 0%, #111827 100%)",
        }}
      >
        <span
          style={{
            fontSize: 120,
            fontWeight: 700,
            background: "linear-gradient(135deg, #7dd3fc 0%, #a78bfa 100%)",
            backgroundClip: "text",
            color: "transparent",
          }}
        >
          e
        </span>
      </div>
    ),
    { ...size }
  );
}
