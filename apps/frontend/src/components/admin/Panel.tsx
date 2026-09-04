import React from 'react';
import { cn } from '@/lib/utils';

export function Panel({
  title, icon: Icon, action, children, className,
}: {
  title: string;
  icon: React.ElementType;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('bg-white rounded-xl border border-gray-100 p-5', className)}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-teal-600" />
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}
