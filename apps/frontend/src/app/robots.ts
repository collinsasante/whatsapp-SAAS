import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/dashboard',
          '/inbox',
          '/contacts',
          '/campaigns',
          '/settings',
          '/onboarding',
          '/login',
          '/register',

          '/api/',
        ],
      },
    ],
    sitemap: 'https://verzchat.com/sitemap.xml',
  };
}
