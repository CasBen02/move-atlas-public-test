import { ImageResponse } from "next/og";

export const alt = "Move Atlas — every part of your move, in one calm place";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "#f5f5ef",
          color: "#20241e",
          display: "flex",
          flexDirection: "column",
          height: "100%",
          justifyContent: "center",
          overflow: "hidden",
          padding: "68px 72px",
          position: "relative",
          width: "100%",
        }}
      >
        <div
          style={{
            border: "3px solid rgba(79, 122, 85, .28)",
            borderRadius: 310,
            height: 520,
            position: "absolute",
            right: -116,
            top: -174,
            width: 520,
          }}
        />
        <div
          style={{
            alignItems: "center",
            display: "flex",
            fontSize: 32,
            fontWeight: 700,
            gap: 20,
            marginBottom: 96,
          }}
        >
          <div
            style={{
              alignItems: "center",
              background: "#263b2b",
              borderRadius: 31,
              color: "#c8dd77",
              display: "flex",
              fontFamily: "serif",
              height: 62,
              justifyContent: "center",
              width: 62,
            }}
          >
            M
          </div>
          Move Atlas
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            fontFamily: "serif",
            fontSize: 72,
            fontWeight: 700,
            lineHeight: 1.12,
          }}
        >
          <span>Every part of your move,</span>
          <span style={{ color: "#4f7a55", fontStyle: "italic" }}>
            in one calm place.
          </span>
        </div>
        <div
          style={{
            color: "#4d514a",
            display: "flex",
            fontSize: 28,
            marginTop: 42,
          }}
        >
          Plan · compare · route · pack · budget · settle in
        </div>
      </div>
    ),
    size,
  );
}
