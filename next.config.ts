import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces a self-contained Node server for the final Docker stage.
  // API routes and the React frontend are served by this one process.
  output: "standalone",
};

export default nextConfig;
