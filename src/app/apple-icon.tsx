import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: "#263b2b",
          borderRadius: 42,
          color: "#263b2b",
          display: "flex",
          height: "100%",
          justifyContent: "center",
          position: "relative",
          width: "100%",
        }}
      >
        <div
          style={{
            alignItems: "center",
            background: "#c8dd77",
            borderRadius: 90,
            display: "flex",
            height: 122,
            justifyContent: "center",
            width: 122,
          }}
        >
          <div
            style={{
              alignItems: "center",
              background: "#fbfbf7",
              borderRadius: 48,
              display: "flex",
              fontFamily: "serif",
              fontSize: 60,
              fontWeight: 700,
              height: 88,
              justifyContent: "center",
              width: 88,
            }}
          >
            M
          </div>
        </div>
      </div>
    ),
    size,
  );
}
