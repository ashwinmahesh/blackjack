import type { Metadata, Viewport } from "next";
import { GoogleAnalytics } from "@next/third-parties/google";
import "./globals.css";

const GOOGLE_ANALYTICS_ID = "G-RMTSSXD4LY";

export const metadata: Metadata = {
  title: "Play Free Blackjack Online | Classic, Free Bet & Multiplayer",
  applicationName: "Ashwin's Blackjack",
  description: "Play free six-deck blackjack with friends or solo. Try Classic, Free Bet, and Double Down Madness with side bets, practice tokens, and no ads.",
  keywords: ["free blackjack online", "multiplayer blackjack", "free bet blackjack", "double down madness", "blackjack side bets", "practice blackjack"],
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    title: "Ashwin's Blackjack | Free Blackjack Online",
    description: "Ad-free blackjack with private multiplayer rooms, side bets, and three game modes.",
    siteName: "Ashwin's Blackjack",
  },
  twitter: { card: "summary", title: "Ashwin's Blackjack", description: "Play free blackjack online with friends or solo." },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#071b16",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
        <GoogleAnalytics gaId={GOOGLE_ANALYTICS_ID} />
      </body>
    </html>
  );
}
