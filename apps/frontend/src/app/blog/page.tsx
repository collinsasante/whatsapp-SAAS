import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { buildMetadata, breadcrumbSchema } from '@/lib/seo';
import { BLOG_POSTS } from '@/lib/blog-posts';

export const metadata = buildMetadata({
  title: 'Blog',
  description:
    'Guides on running a WhatsApp business inbox: team setup, broadcast messaging rules, CRM workflows, and automation — written from the product, not generic advice.',
  path: '/blog',
  keywords: ['WhatsApp business blog', 'WhatsApp business guides', 'shared inbox guides'],
  ogImageAlt: 'VerzChat Blog',
});

const pageBreadcrumb = breadcrumbSchema('/blog', [
  { name: 'Home', path: '/' },
  { name: 'Blog', path: '/blog' },
]);

function formatDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default function BlogIndexPage() {
  const posts = [...BLOG_POSTS].sort((a, b) => (a.publishedDate < b.publishedDate ? 1 : -1));

  return (
    <main className="min-h-screen bg-white pt-36 pb-16">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(pageBreadcrumb) }} />

      <div className="mx-auto max-w-6xl px-5 md:px-8">
        <div className="text-center mb-14">
          <p className="mb-4 inline-block rounded-full border border-teal-200 bg-teal-50 px-4 py-1.5 text-[13px] font-semibold uppercase tracking-widest text-teal-700">
            Blog
          </p>
          <h1 className="text-4xl font-extrabold tracking-tight text-gray-900 md:text-6xl leading-[1.05]">
            Running a WhatsApp Business Inbox
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-[15px] leading-7 text-gray-500">
            Practical guides on team setup, broadcast messaging, CRM, and automation — written from
            building the product, not generic advice.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => (
            <Link
              key={post.slug}
              href={`/blog/${post.slug}`}
              className="group flex flex-col rounded-[1.75rem] border border-gray-100 bg-white p-7 transition hover:border-teal-200 hover:shadow-[0_20px_50px_rgba(13,148,136,0.08)]"
            >
              <p className="text-[12px] font-semibold uppercase tracking-widest text-gray-400">
                {formatDate(post.publishedDate)} · {post.readTimeMinutes} min read
              </p>
              <h2 className="mt-3 text-xl font-bold leading-snug tracking-tight text-gray-900 group-hover:text-teal-700">
                {post.title}
              </h2>
              <p className="mt-3 flex-1 text-[14px] leading-6 text-gray-500">{post.excerpt}</p>
              <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-bold text-teal-600">
                Read more
                <ArrowUpRight className="h-3.5 w-3.5" />
              </span>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
