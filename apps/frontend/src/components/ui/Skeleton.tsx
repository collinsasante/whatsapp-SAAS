import { cn } from '@/lib/utils';

export default function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('bg-gray-100 rounded-lg animate-pulse', className)} />;
}
