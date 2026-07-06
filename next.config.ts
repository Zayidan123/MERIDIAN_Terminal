import type { NextConfig } from "next";

// Static security headers applied to every route as a fallback. The
// middleware (src/middleware.ts) also sets these for matched routes, but
// this ensures coverage for static assets that bypass middleware.
// frame-ancestors allows embedding in preview panels / IDE iframes. See
// middleware.ts for the full rationale (app is behind auth, so clickjacking
// risk is low). Configure via FRAME_ANCESTORS env for production.
const frameAncestors =
  process.env.FRAME_ANCESTORS?.trim() || "'self' http: https:";
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "connect-src 'self' wss: ws: https:",
      `frame-ancestors ${frameAncestors}`,
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
