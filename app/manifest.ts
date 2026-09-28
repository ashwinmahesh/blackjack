import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ashwin's Blackjack",
    short_name: "Blackjack",
    description: "Free solo and private multiplayer blackjack with practice tokens.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#071b16",
    theme_color: "#071b16",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
