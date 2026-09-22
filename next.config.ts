import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
    ] }, { source: "/api/ga4/:path*", headers: [
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "Cache-Control", value: "no-store" },
    ] }];
  },
  // Keep development-only review chrome from covering the shared app header.
  // Next.js still surfaces compile and runtime errors when this badge is hidden.
  devIndicators: false,
  // The bounded PDF parser loads inside an eval worker, which intentionally
  // keeps its dependency outside the server bundle. Include that runtime tree
  // explicitly so standalone/Vercel output tracing ships the worker package.
  outputFileTracingIncludes: {
    "/{onboarding,reports}": [
      "./node_modules/pdf-parse/package.json",
      "./node_modules/pdf-parse/dist/pdf-parse/cjs/**/*",
      "./node_modules/@napi-rs/**/*",
    ],
  },
  experimental: {
    // The supplied-image action enforces a 5 MiB file cap before decode. The
    // small envelope accounts for multipart/RSC framing while keeping
    // Next's global request-parser ceiling close to the 5 MiB product limit.
    // The image action rejects the file itself at 5 MiB before Sharp runs.
    serverActions: { bodySizeLimit: "8mb" },
  },
};

export default nextConfig;
