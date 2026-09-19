import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "mySavings",
    template: "%s · mySavings",
  },
  description:
    "Προσωπική διαχείριση οικονομικών με προτεραιότητα στην προστασία των αποταμιεύσεων.",
  applicationName: "mySavings",
  icons: {
    icon: [
      {
        url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23059669'/%3E%3Cpath d='M9 17.5l4.5 4.5L23 11' stroke='white' stroke-width='3.4' stroke-linecap='round' stroke-linejoin='round' fill='none'/%3E%3C/svg%3E",
        type: "image/svg+xml",
      },
    ],
  },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#059669",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="el">
      <body>{children}</body>
    </html>
  );
}