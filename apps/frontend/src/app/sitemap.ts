import type { MetadataRoute } from 'next';
import { BLOG_POSTS } from '@/lib/blog-posts';

const base = 'https://verzchat.com';

// Not wired to real per-page git/CMS modification dates yet -- a single build-time
// constant is still more honest than `new Date()` per request (which claimed every
// page changed at the exact moment a crawler happened to hit the sitemap). Bump
// this when page content actually changes; Phase 3's blog posts carry their own
// real publish dates instead of this fallback.
const lastModified = new Date('2026-07-07');

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: base, lastModified, changeFrequency: 'weekly', priority: 1.0 },
    { url: `${base}/book-demo`, lastModified, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${base}/shared-inbox`, lastModified, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${base}/whatsapp-broadcasts`, lastModified, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${base}/whatsapp-crm`, lastModified, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${base}/whatsapp-chatbot`, lastModified, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${base}/faq`, lastModified, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${base}/contact-us`, lastModified, changeFrequency: 'yearly', priority: 0.6 },
    { url: `${base}/privacy`, lastModified, changeFrequency: 'yearly', priority: 0.5 },
    { url: `${base}/terms`, lastModified, changeFrequency: 'yearly', priority: 0.5 },
    { url: `${base}/gdpr`, lastModified, changeFrequency: 'yearly', priority: 0.5 },
    { url: `${base}/changelog`, lastModified, changeFrequency: 'weekly', priority: 0.5 },
    { url: `${base}/api-docs`, lastModified, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${base}/status`, lastModified, changeFrequency: 'daily', priority: 0.5 },
    { url: `${base}/blog`, lastModified, changeFrequency: 'weekly', priority: 0.7 },
    ...BLOG_POSTS.map((post) => ({
      url: `${base}/blog/${post.slug}`,
      lastModified: new Date(post.updatedDate ?? post.publishedDate),
      changeFrequency: 'yearly' as const,
      priority: 0.6,
    })),
  ];
}
