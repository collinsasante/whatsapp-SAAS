import type { MetadataRoute } from 'next';
import { INDEXABLE_PAGES } from '@/lib/seo/public-pages';
import { NON_PRODUCTION_SITE, SITE_URL } from '@/lib/seo/site';

/**
 * Only canonical, public, indexable URLs, each with the date its content really last changed (see public-pages.ts).
 * No changefreq or priority: Google ignores both. Staging and local builds publish an empty sitemap.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  if (NON_PRODUCTION_SITE) return [];
  return INDEXABLE_PAGES.map((page) => ({
    // The homepage's canonical is the bare origin (no trailing slash), so that is what the sitemap lists.
    url: page.path === '/' ? SITE_URL : `${SITE_URL}${page.path}`,
    lastModified: page.lastModified,
  }));
}
