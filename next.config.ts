import type { NextConfig } from "next";

// `output: "standalone"` is only produced for the Electron desktop build
// (scripts/desktop-build.mjs packs .next/standalone). Cloud deployments on
// Vercel/Netlify use their own serverless output, so standalone is skipped there.
const nextConfig: NextConfig = {
  /* config options here */
  output: process.env.NEXT_DESKTOP_BUILD === "1" ? "standalone" : undefined,
  // Type errors now fail the build again. `ignoreBuildErrors: true` was hiding
  // a 73-error baseline and would have let any new type error ship silently.
  // Fix errors with `npx tsc --noEmit` rather than re-enabling this flag.
  reactStrictMode: false,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
