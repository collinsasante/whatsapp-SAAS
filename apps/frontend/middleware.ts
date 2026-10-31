import { NextResponse, type NextRequest } from 'next/server';
import { PRODUCTION_HOSTS } from '@/lib/seo/site';

/**
 * Lives at the app root, not in src/: the repo has a root pages/500.tsx, and Next then looks for the middleware beside that pages directory.
 *
 * Second, independent staging guard. NON_PRODUCTION_SITE (a build-time environment variable) is the first, and a missing variable fails open
 * towards "production". This one reads the Host the request actually arrived on: anything that is not the production site (staging, a preview
 * URL, a bare IP, localhost) gets `X-Robots-Tag: noindex, nofollow`, whatever the build was configured with.
 *
 * It only ever ADDS the noindex header. It never makes a response indexable, and it never touches robots.txt or page metadata.
 */
export function middleware(request: NextRequest) {
  const host = (request.headers.get('host') ?? '').split(':')[0].toLowerCase();
  const response = NextResponse.next();
  if (!PRODUCTION_HOSTS.includes(host)) response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return response;
}

export const config = {
  // Static assets are not pages and are never indexed on their own; skipping them keeps the middleware off the hot path.
  matcher: ['/((?!_next/static|_next/image).*)'],
};
