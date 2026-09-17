import React from 'react';

export interface BarChartDatum {
  label: string;
  value: number;
}

interface SimpleBarChartProps {
  data: BarChartDatum[];
  colorClass?: string;
  formatValue?: (v: number) => string;
  heightPx?: number;
  emptyText?: string;
}

// Dependency-free CSS bar chart — bars are plain divs scaled by height
// percentage, so it stays responsive and theme-aware without pulling in a
// charting library for a couple of simple dashboards.
export const SimpleBarChart: React.FC<SimpleBarChartProps> = ({
  data,
  colorClass = 'bg-emerald-500',
  formatValue = (v) => String(v),
  heightPx = 140,
  emptyText = 'Chưa có dữ liệu',
}) => {
  const max = Math.max(1, ...data.map((d) => d.value));
  const hasAnyValue = data.some((d) => d.value > 0);

  // With many bars (e.g. a 30-day view), every column's label text can't fit
  // — thin the tick text out to roughly 10 evenly-spaced labels while the
  // hover title (and the value tooltip) below still uses each bar's real,
  // full label, so no information is actually lost, just decluttered.
  const tickStride = data.length > 10 ? Math.ceil(data.length / 10) : 1;

  if (data.length === 0 || !hasAnyValue) {
    return (
      <div
        className="flex items-center justify-center text-xs text-slate-500 dark:text-slate-500"
        style={{ height: heightPx }}
      >
        {emptyText}
      </div>
    );
  }

  return (
    <div className="flex items-end gap-1.5 sm:gap-2" style={{ height: heightPx }}>
      {data.map((d, i) => {
        const pct = d.value > 0 ? Math.max(3, (d.value / max) * 100) : 0;
        return (
          <div key={i} className="flex-1 min-w-0 flex flex-col items-center justify-end h-full group relative">
            <div className="text-[9px] font-mono font-bold text-slate-700 dark:text-slate-300 mb-1 opacity-0 group-hover:opacity-100 transition-opacity absolute -top-4 whitespace-nowrap bg-[#f3f5f4] dark:bg-[#181a1e] px-1 rounded shadow z-10">
              {formatValue(d.value)}
            </div>
            <div
              className={`w-full rounded-t transition-all ${colorClass} ${d.value > 0 ? 'opacity-90 group-hover:opacity-100' : 'opacity-20'}`}
              style={{ height: `${pct}%`, minHeight: d.value > 0 ? 2 : 1 }}
              title={`${d.label}: ${formatValue(d.value)}`}
            />
            {/* absolute + whitespace-nowrap (not confined to this column's
                narrow flex-1 slot) so a shown label can spill into its empty
                neighbors' space instead of being clipped mid-word */}
            <div className="relative w-full h-3.5 mt-1">
              {(i % tickStride === 0 || i === data.length - 1) && (
                <div className="absolute left-1/2 -translate-x-1/2 text-[9px] text-slate-600 dark:text-slate-400 whitespace-nowrap">
                  {d.label}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
