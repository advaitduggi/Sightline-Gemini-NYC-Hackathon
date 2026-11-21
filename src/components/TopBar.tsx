import { ShoppingBag } from 'lucide-react';
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
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-neutral-200">
      <div className="max-w-[1440px] mx-auto px-6 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Single text element wordmark */}
        <button
          type="button"
          onClick={() => onSelectView('live')}
          className="font-display text-xl font-bold tracking-tight text-neutral-900 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-blue-600 rounded"
        >
          Sightline
        </button>

        {/* Zone 2: 4 concise single-line navigation links */}
        <nav className="flex items-center gap-6 overflow-x-auto" aria-label="Primary navigation">
          {NAV_ITEMS.map((item) => {
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectView(item.id)}
                className={`relative py-5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-blue-600 ${
                  isActive
                    ? 'text-neutral-950'
                    : 'text-neutral-500 hover:text-neutral-900'
                }`}
              >
                {item.label}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 bottom-0 h-0.5 bg-blue-700"
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="shrink-0">
          <button
            type="button"
            onClick={onOpenBag}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          >
            <ShoppingBag className="w-4 h-4" />
            <span className="tabular-nums">Shopping Bag ({bagCount})</span>
          </button>
        </div>
      </div>
    </header>
  );
}
