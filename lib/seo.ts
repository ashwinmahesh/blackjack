import type { Metadata } from "next";

export const SITE_URL = "https://ashwinblackjack.com";

export function guideMetadata(title: string, description: string, path: string): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "article",
      title,
      description,
      url: path,
      siteName: "Ashwin's Blackjack",
    },
    twitter: { card: "summary_large_image", title, description },
  };
}
