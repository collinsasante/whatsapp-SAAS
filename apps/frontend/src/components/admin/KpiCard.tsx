import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { AreaChart, Area, ResponsiveContainer, Tooltip } from 'recharts';
import { cn } from '@/lib/utils';

let sparklineIdCounter = 0;

/**
 * Unifies the three divergent stat-card shapes that had grown across
 * dashboard/insights/overview pages: an icon+color tile with a sub-label, a
 * compact label/value-only tile, and a tooltip+trend-delta+sparkline card.
 * All three are just optional slots on one component now.
 */
export function KpiCard({
  label, value, icon: Icon, color, sub, tooltip, changePct, trend, trendKey = 'value', compact,
}: {
  label: string;
  value: string | number;
  icon?: React.ElementType;
  color?: string;
  sub?: string;
  tooltip?: string;
  changePct?: number | null;
  trend?: Record<string, unknown>[];
  trendKey?: string;
  compact?: boolean;
}) {
  const sparklineId = React.useMemo(() => `kpi-sparkline-${sparklineIdCounter++}`, []);

  if (compact) {
    return (
      <div className="bg-gray-50 rounded-lg p-3 text-center">
        <div className="text-lg font-bold text-gray-900">{value}</div>
        <div className="text-xs text-gray-500">{label}</div>
      </div>
    );
  }

  return (
    <div className={cn('bg-white rounded-xl border border-gray-100 p-5', Icon && 'flex items-start gap-4')} title={tooltip}>
      {Icon && (
        <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center shrink-0', color ?? 'bg-teal-600')}>
          <Icon className="w-5 h-5 text-white" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className={cn(Icon ? 'text-2xl font-bold text-gray-900' : 'text-xs text-gray-500 font-medium mb-1')}>
          {Icon ? value : label}
        </div>
        <div className={cn(Icon ? 'text-sm text-gray-500 font-medium' : 'text-2xl font-bold text-gray-900')}>
          {Icon ? label : value}
        </div>
        {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
        {changePct != null && (
          <div className={cn('flex items-center gap-1 text-xs font-medium mt-1', changePct >= 0 ? 'text-emerald-600' : 'text-red-500')}>
            {changePct >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {Math.abs(changePct)}% vs previous period
          </div>
        )}
        {trend && trend.length > 1 && (
          <div className="h-10 mt-2 -mx-1">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend}>
                <defs>
                  <linearGradient id={sparklineId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0d9488" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#0d9488" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Tooltip formatter={(v) => [String(v), label]} contentStyle={{ fontSize: 11, padding: '4px 8px' }} />
                <Area type="monotone" dataKey={trendKey} stroke="#0d9488" strokeWidth={1.5} fill={`url(#${sparklineId})`} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
