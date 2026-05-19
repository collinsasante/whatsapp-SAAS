import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import axios from 'axios';

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
      const res = await axios.get<string>(url, {
        timeout: 5000,
        maxRedirects: 3,
        responseType: 'text',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; LinkPreviewBot/1.0)',
          'Accept': 'text/html',
        },
        maxContentLength: 500_000,
      });
      const html = typeof res.data === 'string' ? res.data.slice(0, 100_000) : '';
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
