/**
 * The pages meant to appear in search results, and the only source for sitemap.xml. A page that is not listed here is not in the sitemap;
 * a private or transactional route must never be listed (scripts/seo-check.mjs fails the build check if one is).
 *
 * `lastModified` is the date the page's VISIBLE CONTENT last changed, as YYYY-MM-DD. It is a claim to search engines, so keep it honest:
 * update it when you change what the page says, not for refactors, styling or a redeploy. The values below are the date of the last commit
 * that touched each page's files, taken when this file was introduced.
 */
export interface PublicPage {
  /** Canonical path. The homepage is '/'. */
  path: string;
  lastModified: string;
}

export const INDEXABLE_PAGES: PublicPage[] = [
  { path: '/', lastModified: '2026-10-26' },
  { path: '/book-demo', lastModified: '2026-10-24' },
  { path: '/changelog', lastModified: '2026-10-31' },
  { path: '/api-docs', lastModified: '2026-10-19' },
  { path: '/data-deletion', lastModified: '2026-10-12' },
  { path: '/terms', lastModified: '2026-05-24' },
  { path: '/privacy', lastModified: '2026-05-23' },
  { path: '/gdpr', lastModified: '2026-05-23' },
  // /status is deliberately absent: it is a live dashboard, so any "last modified" date would be meaningless. It stays reachable and crawlable.
];
