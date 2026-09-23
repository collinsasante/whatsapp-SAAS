const { withSentryConfig } = require('@sentry/nextjs');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [
      {
        // Allow Firebase popup to check window.closed on the login page
        source: '/(login|register)',
        headers: [{ key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' }],
      },
    ];
  },
  async rewrites() {
    const backendUrl = process.env.BACKEND_URL ?? 'https://verzchat.com';
    return [
      {
        source: '/api/proxy/:path*',
        destination: `${backendUrl}/api/v1/:path*`,
      },
    ];
  },
  // No component in this app passes a remote URL to next/image (every
  // usage renders a local /public asset) -- a wildcard hostname here only
  // exposes the built-in /_next/image?url= endpoint to fetch and process
  // any attacker-supplied HTTPS image directly, independent of app code.
  // That's the exact surface GHSA-2xp9-vwfh-vxw4 (Next <15.5.24 unauthenticated
  // RCE via AVIF Image Optimization) needs. Since nothing here legitimately
  // needs remote optimization, removing the wildcard closes the reachable
  // path without requiring the Next 14->15 major upgrade to ship first.
  // That upgrade is still recommended (see SECURITY_AUDIT notes) for the
  // other advisories it fixes, but is no longer a release blocker on its own.
  images: {
    remotePatterns: [],
  },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_SOCKET_URL: process.env.NEXT_PUBLIC_SOCKET_URL,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  },
};

// Sentry is opt-in: wraps the config only when NEXT_PUBLIC_SENTRY_DSN is set
const hasSentry = !!process.env.NEXT_PUBLIC_SENTRY_DSN;

module.exports = hasSentry
  ? withSentryConfig(nextConfig, {
      silent: true,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      widenClientFileUpload: true,
      hideSourceMaps: true,
      disableLogger: true,
    })
  : nextConfig;
