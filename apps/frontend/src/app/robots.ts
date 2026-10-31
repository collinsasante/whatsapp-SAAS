import type { MetadataRoute } from 'next';
import { NON_PRODUCTION_SITE, SITE_URL } from '@/lib/seo/site';

/**
 * Crawler policy. The full table, with the reason for each rule, is in docs/seo/crawler-policy.md; keep the two in step.
 *
 * Three principles:
 *  1. robots.txt controls CRAWLING; `noindex` (page metadata) controls INDEXING. They are not substitutes. Private pages are therefore NOT
 *     disallowed here: a page a crawler may not fetch is a page whose noindex it can never read. Each private area sets its own noindex.
 *  2. Search-oriented AI crawlers (they fetch pages to answer a user's question, and link back) are allowed. Training-oriented crawlers
 *     (they collect pages to build or tune a model) are blocked, for now.
 *  3. Google Search indexing is Googlebot. `Google-Extended` is only a permission token for using content in Google's generative AI models;
 *     blocking it does not affect Search indexing or ranking, and allowing Googlebot does not grant it.
 *
 * The site is behind Cloudflare, which prepends its own managed block of rules to the live /robots.txt. The groups below are merged with it
 * per user agent, and agree with it on the training crawlers.
 */

/** Fetch pages to answer a user's question or build a search index that links back to the source. Allowed. */
const SEARCH_AI_CRAWLERS = [
  'OAI-SearchBot', // OpenAI: indexes pages for ChatGPT search results
  'ChatGPT-User', // OpenAI: fetches a page when a user asks ChatGPT about it. OpenAI says robots.txt rules may not apply to it
  'Claude-SearchBot', // Anthropic: indexes pages for Claude search results
  'Claude-User', // Anthropic: fetches a page when a user asks Claude about it
  'PerplexityBot', // Perplexity: indexes pages for Perplexity search results
  'Perplexity-User', // Perplexity: fetches a page when a user asks about it. Perplexity says it generally ignores robots.txt
  'DuckAssistBot', // DuckDuckGo: AI-assisted answers. Name not confirmed on DuckDuckGo's own pages when last checked; harmless if unused
  'Applebot', // Apple: Siri, Spotlight and Safari search. Apple says crawled data may also inform its models and AI answers; Applebot-Extended below is the training opt-out
];

/** Collect content to train or tune models, or build datasets. Blocked for now. */
const TRAINING_AI_CRAWLERS = [
  'GPTBot', // OpenAI: model training
  'ClaudeBot', // Anthropic: model training
  'anthropic-ai', // Anthropic: older name; NOT in Anthropic's current crawler help page, kept because blocking an unused token is harmless
  'Claude-Web', // Anthropic: older name; NOT in Anthropic's current crawler help page, kept for the same reason
  'Google-Extended', // Google: opt-out token for Gemini training and grounding. Does NOT affect Google Search indexing (that is Googlebot)
  'Applebot-Extended', // Apple: opt-out token for Apple's model training. Does not affect Applebot search
  'CCBot', // Common Crawl: open datasets used to train many models
  'Bytespider', // ByteDance: model training
  'Amazonbot', // Amazon: crawler used to improve Amazon's AI products
  'meta-externalagent', // Meta: model training and indexing
  'cohere-ai', // Cohere: model training
  'Diffbot', // Diffbot: extracts content for datasets
  'omgilibot', // Webz.io: sells crawled content as datasets
];

export default function robots(): MetadataRoute.Robots {
  // Staging and local builds: nothing to crawl. The same builds also send `X-Robots-Tag: noindex` on every response and a noindex tag in the page.
  if (NON_PRODUCTION_SITE) {
    return { rules: [{ userAgent: '*', disallow: '/' }] };
  }

  return {
    rules: [
      // Everyone else, including Googlebot and Bingbot: the whole site is crawlable. Private routes carry noindex. /api/ is JSON, not pages.
      { userAgent: '*', allow: '/', disallow: ['/api/'] },
      { userAgent: SEARCH_AI_CRAWLERS, allow: '/', disallow: ['/api/'] },
      { userAgent: TRAINING_AI_CRAWLERS, disallow: '/' },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
