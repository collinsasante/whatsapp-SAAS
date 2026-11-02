import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { fetchPublicPage } from '../knowledge-base/public-page-fetch';

function extract(html: string, prop: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i');
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, 'i');
  return (html.match(re) ?? html.match(re2))?.[1]?.trim() ?? null;
}

function extractTitle(html: string): string | null {
  return html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? null;
}

@Controller('link-preview')
@UseGuards(JwtAuthGuard)
export class LinkPreviewController {
  @Get()
  async preview(@Query('url') url: string) {
    if (!url) return { error: 'missing url' };
    try {
      new URL(url); // validate
    } catch {
      return { error: 'invalid url' };
    }

    try {
      // Same guarded fetch the knowledge base uses: every hop (including redirects) is checked and the connection is pinned to
      // public addresses, so a preview can never reach localhost, the Docker network, or a cloud metadata address.
      const { html: fullHtml } = await fetchPublicPage(url);
      const html = fullHtml.slice(0, 100_000);
      return {
        url,
        title: extract(html, 'og:title') ?? extractTitle(html),
        description: extract(html, 'og:description') ?? extract(html, 'description'),
        image: extract(html, 'og:image') ?? null,
        siteName: extract(html, 'og:site_name') ?? null,
      };
    } catch {
      return { url, title: null, description: null, image: null, siteName: null };
    }
  }
}
