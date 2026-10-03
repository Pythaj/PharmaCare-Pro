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
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders(),
      },
    ];
  },
};

const isDev = process.env.NODE_ENV !== "production";
// The desktop build is served over plain http from the local machine, so
// transport-security headers must not be sent for it: HSTS would pin
// `localhost` to https in the user's browser and brick the app on next launch.
const isDesktop = process.env.NEXT_DESKTOP_BUILD === "1";

function securityHeaders(): { key: string; value: string }[] {
  const csp = [
    "default-src 'self'",
    // Next.js App Router emits the RSC payload and its hydration bootstrap as
    // inline <script> tags with no nonce, so 'unsafe-inline' is required. It
    // means this directive is not a meaningful XSS barrier on its own — the
    // directives below are the parts doing real work. Removing it needs
    // per-request nonces plumbed through middleware into the root layout.
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    // Inline `style` attributes are used throughout (progress widths, chart
    // sizes, Radix positioning) and the Tailwind stylesheet is injected, not
    // linked, so 'unsafe-inline' is required here too.
    "style-src 'self' 'unsafe-inline'",
    // https: is deliberately allowed. SettingsView renders the operator's own
    // `pharmacy.logoUrl` as an <img src>, so restricting this to 'self' would
    // silently break branding for any pharmacy that hosts its logo elsewhere.
    // Scoped to images only, and the URL is admin-entered rather than
    // visitor-supplied.
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    // WebSocket only for the dev server's HMR channel.
    `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // Applied only where it cannot break a local http origin.
    ...(isDev || isDesktop ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  return [
    { key: "Content-Security-Policy", value: csp },
    { key: "X-Content-Type-Options", value: "nosniff" },
    // frame-ancestors in the CSP covers modern browsers; this is the fallback
    // for older ones that ignore CSP.
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      // The app needs no camera, microphone, geolocation or payment access. A
      // cashier workstation should not silently hold those capabilities.
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    },
    ...(isDev || isDesktop
      ? []
      : [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ]),
  ];
}

export default nextConfig;