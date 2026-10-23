import { cn } from '@/lib/utils';

/** Standard panel: white surface, border, rounded-xl, p-4 sm:p-5. */
export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('bg-white border border-gray-200 rounded-xl p-4 sm:p-5', className)} {...rest}>{children}</div>;
}

/** Card heading: text-base semibold with an optional description and a slot for actions. */
export function CardHeader({ title, description, aside, id }: {
  title: React.ReactNode; description?: React.ReactNode; aside?: React.ReactNode; id?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 mb-3">
      <div className="min-w-0">
        <h2 id={id} className="text-base font-semibold text-gray-900">{title}</h2>
        {description && <p className="text-sm text-gray-500 mt-0.5">{description}</p>}
      </div>
      {aside}
    </div>
  );
}
