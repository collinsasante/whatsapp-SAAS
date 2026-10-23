import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

export interface Crumb { label: string; href?: string }

/** Title, one line of context, where this page sits, and the actions that belong to it. */
export function PageHeader({ title, description, crumbs, actions }: { title: string; description?: React.ReactNode; crumbs?: Crumb[]; actions?: React.ReactNode }) {
  return (
    <header className="mb-5">
      {crumbs && crumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-1.5">
          <ol className="flex flex-wrap items-center gap-1 text-xs text-gray-500">
            {crumbs.map((c, i) => (
              <li key={`${c.label}-${i}`} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="w-3 h-3 text-gray-300" aria-hidden="true" />}
                {c.href ? <Link href={c.href} className="hover:text-gray-900 hover:underline">{c.label}</Link> : <span aria-current="page" className="text-gray-700">{c.label}</span>}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-gray-900 tracking-tight">{title}</h1>
          {description && <p className="text-sm text-gray-500 mt-0.5 max-w-3xl">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/** A titled block of a page. Not a card: a heading and a hairline, so dense pages stay calm. */
export function Section({ title, description, actions, children, id }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className="mb-8 scroll-mt-20">
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-gray-200 pb-2 mb-3">
        <div>
          <h2 id={id ? `${id}-title` : undefined} className="text-sm font-semibold text-gray-900">{title}</h2>
          {description && <p className="text-xs text-gray-500 mt-0.5">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
