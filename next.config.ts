import type { NextConfig } from "next";

// `output: "standalone"` is only produced for the Electron desktop build
// (scripts/desktop-build.mjs packs .next/standalone). Cloud deployments on
// Vercel/Netlify use their own serverless output, so standalone is skipped there.
const nextConfig: NextConfig = {
  /* config options here */
  output: process.env.NEXT_DESKTOP_BUILD === "1" ? "standalone" : undefined,
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
