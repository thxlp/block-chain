import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow HMR (webpack-dev) requests from your LAN IP in development.
  allowedDevOrigins: ["10.0.82.103"],
};

export default nextConfig;
