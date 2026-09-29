import type { MetadataRoute } from "next";

// Web App Manifest served at /manifest.webmanifest by Next.js.
//
// Stable app id and start_url/scope are "/" so the installed app opens the
// public landing page; authenticated routes redirect to /login or /dashboard
// server-side and are NEVER cached by the service worker. display=standalone
// gives the app its own window. Icons are real PNG assets in /public/icons.
// The maskable icon has full-bleed background so Android adaptive icons keep
// the checkmark inside the safe zone. No personal data is referenced here.

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/?mysavings=pwa",
    name: "mySavings",
    short_name: "mySavings",
    description:
      "Προσωπική διαχείριση οικονομικών με προτεραιότητα στην προστασία των αποταμιεύσεων.",
    lang: "el",
    dir: "ltr",
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "portrait",
    background_color: "#f8fafc",
    theme_color: "#059669",
    categories: ["finance", "productivity"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "Σύνδεση",
        short_name: "Σύνδεση",
        url: "/login?source=pwa",
      },
    ],
  };
}