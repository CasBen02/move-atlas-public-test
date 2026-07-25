import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Move Atlas",
    short_name: "Move Atlas",
    description: "Every part of your move, organized around real life.",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f5ef",
    theme_color: "#263b2b",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
