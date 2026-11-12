import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Database drivers are Node-only; keep them out of the bundler.
  serverExternalPackages: ["mssql", "tedious", "oracledb"],
  // Docker / self-hosting builds a standalone server (set STANDALONE=1).
  output: process.env.STANDALONE === "1" ? "standalone" : undefined,
};

export default nextConfig;
