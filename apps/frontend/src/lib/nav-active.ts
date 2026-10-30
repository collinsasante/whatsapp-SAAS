/** True when `pathname` is the route itself or a page inside it. `/ai` is not active on `/ai-test`. */
export function isRouteActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The one entry of a group that matches the current page: the most specific match wins, so `/ai/test-chat` lights
 * up "Test Chat" and not also "Verz AI Settings" (`/ai`). Null when no entry matches.
 */
export function activeChildHref(pathname: string, children: ReadonlyArray<{ href: string }>): string | null {
  let best: string | null = null;
  for (const child of children) {
    if (isRouteActive(pathname, child.href) && (best === null || child.href.length > best.length)) best = child.href;
  }
  return best;
}
