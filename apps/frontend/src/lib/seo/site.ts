import type { Metadata, Viewport } from 'next';

/** The one public origin. Canonicals, the sitemap and structured data are built from it; the layout's metadataBase resolves relative URLs against it. */
export const SITE_URL = 'https://verzchat.com';

/** The hostnames production is served on (www is redirected to the apex by nginx). Any other Host is treated as non-production by middleware.ts. */
export const PRODUCTION_HOSTS: readonly string[] = ['verzchat.com', 'www.verzchat.com'];

/**
 * True for any build that must not be indexed: local development, and staging. A build is non-production ONLY on a positive signal, never
 * by the absence of one, because the opposite mistake (production marked non-production) would de-index the whole site.
 *
 * - NODE_ENV=development: `next dev`.
 * - NEXT_PUBLIC_SITE_ENV=staging|preview|development|test: the explicit switch, for any environment that sets it.
 * - NEXT_PUBLIC_SHOW_DEV_TOOLS=true: already passed as a build argument by infra/docker-compose.staging.yml and never by production's.
 *
 * The three variables are written out literally on purpose: Next.js inlines `process.env.NEXT_PUBLIC_*` at build time, and the running
 * container does not carry them. next.config.js repeats this rule for the response headers; scripts/seo-check.mjs builds both ways to catch drift.
 */
export const NON_PRODUCTION_SITE: boolean =
  process.env.NODE_ENV === 'development' ||
  ['staging', 'preview', 'development', 'test'].includes((process.env.NEXT_PUBLIC_SITE_ENV ?? '').toLowerCase()) ||
  process.env.NEXT_PUBLIC_SHOW_DEV_TOOLS === 'true';

/**
 * Private and transactional pages: the signed-in app, sign-in and sign-up, password reset, e-mail verification, payment links.
 * `noindex` only. These routes are deliberately NOT blocked in robots.txt, because a crawler that is not allowed to fetch a page can never
 * see its noindex, and a blocked URL that is linked from elsewhere can still be listed without a description.
 */
export const PRIVATE_METADATA: Metadata = { robots: { index: false, follow: false } };

/**
 * The app-style viewport (no pinch-zoom, content resizes when the on-screen keyboard opens). Used for the signed-in app and its forms, where
 * it stops iOS zooming into an input. The marketing and legal pages use the root layout's default, which lets people zoom.
 */
export const APP_VIEWPORT: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  interactiveWidget: 'resizes-content',
};
