import { cn } from '@/lib/utils';

/**
 * Title block shared by signed-in pages: one title size, one description style, actions on the right.
 * Page title scale: text-xl on phones, text-2xl from sm up, semibold. Section headings below it use text-lg, card headings text-base.
 */
export default function PageHeader({ title, description, actions, className }: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-x-6 gap-y-2', className)}>
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-semibold text-gray-900 tracking-tight">{title}</h1>
        {description && <p className="text-sm text-gray-600 mt-1 max-w-2xl">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
