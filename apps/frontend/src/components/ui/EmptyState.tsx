import Link from 'next/link';
import { buttonClasses } from './Button';

/** Says what is missing and offers the next step. `compact` is for panels inside a page; the default fills a page area. */
export default function EmptyState({ title, children, href, hrefLabel, compact = true }: {
  title: string; children?: React.ReactNode; href?: string; hrefLabel?: string; compact?: boolean;
}) {
  return (
    <div className={`rounded-lg border border-dashed border-gray-300 bg-gray-50 text-sm ${compact ? 'px-4 py-5' : 'px-6 py-12 text-center'}`}>
      <p className="font-medium text-gray-800">{title}</p>
      {children && <p className={`text-gray-500 mt-1 ${compact ? 'max-w-xl' : 'max-w-md mx-auto'}`}>{children}</p>}
      {href && hrefLabel && <Link href={href} className={buttonClasses('secondary', 'sm', 'mt-3')}>{hrefLabel}</Link>}
    </div>
  );
}
