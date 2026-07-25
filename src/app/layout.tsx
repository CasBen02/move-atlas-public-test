import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: {
    default: "Move Atlas — every part of your move, in one calm place",
    template: "%s · Move Atlas",
  },
  description:
    "Plan, compare, route, pack, budget, and settle in with one private moving command center.",
  applicationName: "Move Atlas",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: "/apple-icon",
  },
  openGraph: {
    title: "Move Atlas",
    description: "Every part of your move, organized around real life.",
    type: "website",
    siteName: "Move Atlas",
    images: ["/opengraph-image"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Move Atlas",
    description: "Every part of your move, organized around real life.",
    images: ["/opengraph-image"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
