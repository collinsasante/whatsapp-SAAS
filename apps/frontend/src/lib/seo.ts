import type { Metadata } from 'next';

export const SITE_URL = 'https://verzchat.com';

/** The real, branded 1200x630 OG image generated at apps/frontend/src/app/opengraph-image.tsx. */
const DEFAULT_OG_IMAGE = { url: '/opengraph-image', width: 1200, height: 630 };

export interface SeoOptions {
  /**
   * Page-specific title ONLY -- do not include "VerzChat" or a "—" brand suffix.
   * The root layout's title.template ('%s | VerzChat') adds the brand suffix for
   * every page automatically. Manually appending it here double-brands the title
   * tag (this was a real, sitewide bug before this helper existed: e.g. "Privacy
   * Policy — VerzChat | VerzChat").
   */
  title: string;
  description: string;
  /** Canonical path starting with '/', e.g. '/faq'. */
  path: string;
  keywords?: string[];
  ogImageAlt?: string;
  /** For thin/utility pages that must stay reachable but shouldn't rank. */
  noIndex?: boolean;
}

export function buildMetadata(opts: SeoOptions): Metadata {
  const url = `${SITE_URL}${opts.path}`;
  return {
    title: opts.title,
    description: opts.description,
    ...(opts.keywords ? { keywords: opts.keywords } : {}),
    alternates: { canonical: opts.path },
    ...(opts.noIndex ? { robots: { index: false, follow: false } } : {}),
    openGraph: {
      url,
      title: opts.title,
      description: opts.description,
      images: [{ ...DEFAULT_OG_IMAGE, alt: opts.ogImageAlt ?? opts.title }],
    },
    twitter: {
      card: 'summary_large_image',
      title: opts.title,
      description: opts.description,
      images: [DEFAULT_OG_IMAGE.url],
    },
  };
}

/** BreadcrumbList JSON-LD. First item should almost always be { name: 'Home', path: '/' }. */
export function breadcrumbSchema(path: string, items: { name: string; path: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    '@id': `${SITE_URL}${path}/#breadcrumb`,
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: item.path.startsWith('http') ? item.path : `${SITE_URL}${item.path}`,
    })),
  };
}

/** WebPage JSON-LD, cross-linked to the sitewide Organization/WebSite entities declared on the landing page. */
export function webPageSchema(opts: { path: string; name: string; description: string; hasBreadcrumb?: boolean }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': `${SITE_URL}${opts.path}/#webpage`,
    url: `${SITE_URL}${opts.path}`,
    name: opts.name,
    description: opts.description,
    isPartOf: { '@id': `${SITE_URL}/#website` },
    publisher: { '@id': `${SITE_URL}/#organization` },
    inLanguage: 'en-US',
    ...(opts.hasBreadcrumb ? { breadcrumb: { '@id': `${SITE_URL}${opts.path}/#breadcrumb` } } : {}),
  };
}
