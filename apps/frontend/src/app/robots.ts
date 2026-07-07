import type { MetadataRoute } from 'next';

// Disallow prefixes match by path prefix (standard robots.txt semantics), so e.g.
// '/platform-admin' also covers '/platform-admin/workspaces/123' -- no need to
// enumerate every sub-route.
const DISALLOWED_PREFIXES = [
  // Authenticated tenant app ((dashboard) route group -- every page under it)
  '/dashboard', '/inbox', '/contacts', '/campaigns', '/settings', '/onboarding',
  '/account', '/ai', '/ai-pending', '/ai-test', '/analytics', '/automation',
  '/billing', '/calls', '/channels', '/chatbot', '/library', '/manage', '/templates',
  // Platform admin (super-admin panel) -- must never be indexed
  '/platform-admin',
  // Auth flows -- not content, and several carry one-time tokens
  '/login', '/register', '/forgot-password', '/reset-password',
  '/verify-email', '/join', '/auth',
  // API
  '/api/',
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: DISALLOWED_PREFIXES,
      },
    ],
    sitemap: 'https://verzchat.com/sitemap.xml',
  };
}
