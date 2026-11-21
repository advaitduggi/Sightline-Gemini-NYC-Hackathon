import { AppView } from '../types';

interface TopBarProps {
  activeView: AppView;
  onSelectView: (view: AppView) => void;
  bagCount: number;
  onOpenBag: () => void;
}

const NAV_ITEMS: Array<{ id: AppView; label: string }> = [
  { id: 'live', label: 'Live Studio' },
  { id: 'benchmark', label: 'Stress Benchmark' },
  { id: 'catalog', label: 'Shopify Catalog' },
  { id: 'failures', label: 'Failure Log' },
];

export function TopBar({ activeView, onSelectView, bagCount, onOpenBag }: TopBarProps) {
  return (
    <header className="sticky top-0 z-50 h-20 bg-[#f2f2f2]/90 backdrop-blur-xl border-b border-[#1e1e1e]/10 px-6 lg:px-8 flex items-center justify-between gap-8">
      <div className="flex items-center gap-8 lg:gap-12 min-w-0">
        <button
          type="button"
          onClick={() => onSelectView('live')}
          className="clash-display text-2xl font-bold tracking-tight uppercase text-[#111111] whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#0052cc]"
        >
          Sightline
        </button>

        <nav
          className="flex items-center gap-5 lg:gap-8 overflow-x-auto"
          aria-label="Primary navigation"
        >
          {NAV_ITEMS.map((item) => {
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectView(item.id)}
                className={`nav-link text-[13px] lg:text-[14px] uppercase tracking-wider whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#0052cc] ${
                  isActive
                    ? 'font-bold text-[#111111]'
                    : 'font-medium text-[#838282]'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>
      </div>

      <button
        type="button"
        onClick={onOpenBag}
        className="btn-invert border border-[#1e1e1e] px-5 lg:px-6 py-2 rounded-full text-[13px] lg:text-[14px] uppercase font-bold whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0052cc]"
      >
        <span className="mono">Shopping Bag ({bagCount})</span>
      </button>
    </header>
  );
}
