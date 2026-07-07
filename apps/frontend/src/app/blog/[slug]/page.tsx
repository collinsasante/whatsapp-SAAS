import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ArrowUpRight } from 'lucide-react';
import { buildMetadata, breadcrumbSchema, SITE_URL } from '@/lib/seo';
import { BLOG_POSTS, getBlogPost } from '@/lib/blog-posts';

export function generateStaticParams() {
  return BLOG_POSTS.map((post) => ({ slug: post.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const post = getBlogPost(params.slug);
  if (!post) return {};
  return buildMetadata({
    title: post.title,
    description: post.excerpt,
    path: `/blog/${post.slug}`,
    keywords: [post.targetKeyword],
    ogImageAlt: post.title,
  });
}

function formatDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default function BlogPostPage({ params }: { params: { slug: string } }) {
  const post = getBlogPost(params.slug);
  if (!post) notFound();

  const pageBreadcrumb = breadcrumbSchema(`/blog/${post.slug}`, [
    { name: 'Home', path: '/' },
    { name: 'Blog', path: '/blog' },
    { name: post.title, path: `/blog/${post.slug}` },
  ]);

  const articleSchema = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    '@id': `${SITE_URL}/blog/${post.slug}/#article`,
    headline: post.title,
    description: post.excerpt,
    datePublished: post.publishedDate,
    dateModified: post.updatedDate ?? post.publishedDate,
    author: { '@id': `${SITE_URL}/#organization` },
    publisher: { '@id': `${SITE_URL}/#organization` },
    mainEntityOfPage: { '@type': 'WebPage', '@id': `${SITE_URL}/blog/${post.slug}/#webpage` },
    isPartOf: { '@id': `${SITE_URL}/#website` },
  };

  return (
    <main className="min-h-screen bg-white pt-36 pb-16">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(pageBreadcrumb) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }} />

      <article className="mx-auto max-w-3xl px-5 md:px-8">
        <Link
          href="/blog"
          className="mb-8 inline-flex items-center gap-1.5 text-sm font-bold text-gray-400 transition hover:text-teal-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to blog
        </Link>

        <p className="text-[12px] font-semibold uppercase tracking-widest text-gray-400">
          {formatDate(post.publishedDate)} · {post.readTimeMinutes} min read
        </p>
        <h1 className="mt-3 text-3xl font-extrabold leading-[1.1] tracking-tight text-gray-900 md:text-5xl">
          {post.title}
        </h1>
        <p className="mt-6 text-lg leading-8 text-gray-500">{post.excerpt}</p>

        <div className="mt-10 space-y-8">
          {post.sections.map((section, i) => (
            <section key={i}>
              {section.heading && (
                <h2 className="mb-3 text-xl font-bold tracking-tight text-gray-900">{section.heading}</h2>
              )}
              {section.paragraphs.map((p, j) => (
                <p key={j} className="mb-4 text-[15px] leading-7 text-gray-600">
                  {p}
                </p>
              ))}
              {section.bullets && (
                <ul className="mb-4 space-y-2">
                  {section.bullets.map((b) => (
                    <li key={b} className="flex items-start gap-3 text-[15px] leading-6 text-gray-600">
                      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-teal-100 text-[11px] font-bold text-teal-700">
                        ✓
                      </span>
                      {b}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>

        <div className="mt-12 rounded-2xl border border-teal-100 bg-teal-50 p-7">
          <p className="text-[13px] font-semibold uppercase tracking-widest text-teal-700">See it in VerzChat</p>
          <Link
            href={post.related.href}
            className="mt-2 inline-flex items-center gap-1.5 text-lg font-bold text-teal-800 transition hover:text-teal-900"
          >
            {post.related.label}
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
      </article>
    </main>
  );
}
