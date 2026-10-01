import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/rules", "/free-bet", "/double-down-madness", "/breakout", "/double-up", "/side-bets"].map((path) => ({
    url: new URL(path, SITE_URL).toString(),
  }));
}
