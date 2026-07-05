import type { Metadata } from "next";
import { Inter, IBM_Plex_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Toaster as SonnerToaster } from "sonner";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "MERIDIAN Terminal — Multi-Asset Research, Signal & Risk",
  description:
    "Institutional-grade research, signal, risk & portfolio terminal for crypto, IDX equities and forex/gold. 100% real market data.",
  keywords: [
    "MERIDIAN",
    "trading terminal",
    "multi-asset",
    "crypto",
    "IDX",
    "forex",
    "gold",
    "risk management",
  ],
  authors: [{ name: "MERIDIAN" }],
  icons: {
    icon: "/logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${plexSans.variable} ${jetbrainsMono.variable} antialiased bg-background text-foreground font-sans`}
      >
        {children}
        <SonnerToaster
          theme="dark"
          position="bottom-right"
          toastOptions={{
            style: {
              background: "#151920",
              border: "1px solid #262b33",
              color: "#e7e9ec",
              fontSize: "12px",
            },
          }}
        />
      </body>
    </html>
  );
}
