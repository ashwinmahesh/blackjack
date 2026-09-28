import type { Metadata, Viewport } from "next";
import { GoogleAnalytics } from "@next/third-parties/google";
import { SITE_URL } from "../lib/seo";
import "./globals.css";

const GOOGLE_ANALYTICS_ID = "G-RMTSSXD4LY";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Play Free Blackjack Online | Classic, Free Bet & Multiplayer",
  applicationName: "Ashwin's Blackjack",
  description: "Play free six-deck blackjack with friends or solo. Try Classic, Free Bet, and Double Down Madness with side bets, practice tokens, and no ads.",
  keywords: ["free blackjack online", "multiplayer blackjack", "free bet blackjack", "double down madness", "blackjack side bets", "practice blackjack"],
  robots: { index: true, follow: true },
  alternates: { canonical: `${SITE_URL}/` },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/`,
    title: "Ashwin's Blackjack | Free Blackjack Online",
    description: "Ad-free blackjack with private multiplayer rooms, side bets, and three game modes.",
    siteName: "Ashwin's Blackjack",
  },
  twitter: { card: "summary_large_image", title: "Ashwin's Blackjack", description: "Play free blackjack online with friends or solo." },
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
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: "Ashwin's Blackjack",
            url: `${SITE_URL}/`,
          }) }}
        />
        {children}
        <GoogleAnalytics gaId={GOOGLE_ANALYTICS_ID} />
      </body>
    </html>
  );
}
