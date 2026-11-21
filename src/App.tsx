import { useCallback, useState } from 'react';
import { BagDrawer } from './components/BagDrawer';
import { BenchmarkView } from './components/BenchmarkView';
import { CatalogView } from './components/CatalogView';
import { FailureLogView } from './components/FailureLogView';
import { LiveStudioView } from './components/LiveStudioView';
import { TopBar } from './components/TopBar';
import {
  AppView,
  BagItem,
  CatalogProduct,
  FailureRecord,
  MitigationConfig,
  StressConfig,
} from './types';

export default function App() {
  const [activeView, setActiveView] = useState<AppView>('live');
  const [bagOpen, setBagOpen] = useState(false);
  const [bagItems, setBagItems] = useState<BagItem[]>([]);
  const [storefrontMcpUrl, setStorefrontMcpUrl] = useState('');
  const [failures, setFailures] = useState<FailureRecord[]>([]);

  const [stressConfig, setStressConfig] = useState<StressConfig>({
    targetFps: 1,
    blurRadiusPx: 0,
    noiseMixLevel: 0.15,
    lowLightDimming: 0,
    clutterCropZoom: 1,
  });

  const [mitigations, setMitigations] = useState<MitigationConfig>({
    blurGate: true,
    confidenceHysteresis: true,
    frameDedup: true,
    minUsableProb: 0.55,
    minIntentProb: 0.5,
  });

  const handleAddToBag = useCallback((product: CatalogProduct) => {
    setBagItems((prev) => {
      const existing = prev.find((i) => i.product.id === product.id);
      if (existing) {
        return prev.map((i) =>
          i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i,
        );
      }
      return [...prev, { product, quantity: 1 }];
    });
    setBagOpen(true);
  }, []);

  const handleUpdateQty = useCallback((productId: string, delta: number) => {
    setBagItems((prev) =>
      prev
        .map((i) =>
          i.product.id === productId ? { ...i, quantity: i.quantity + delta } : i,
        )
        .filter((i) => i.quantity > 0),
    );
  }, []);

  const handleRemoveFromBag = useCallback((productId: string) => {
    setBagItems((prev) => prev.filter((i) => i.product.id !== productId));
  }, []);

  const handleRecordFailure = useCallback((failure: FailureRecord) => {
    setFailures((prev) => [failure, ...prev].slice(0, 20));
  }, []);

  const bagCount = bagItems.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div className="min-h-screen bg-[#f2f2f2] text-[#111111] flex flex-col relative isolate">
      {/* Fixed Background Echo Stack (Part G) */}
      <div
        aria-hidden="true"
        className="fixed inset-0 flex items-center justify-center -z-10 pointer-events-none opacity-20 overflow-hidden select-none"
      >
        <div className="echo-stack">
          <span className="clash-display text-[18vw] font-bold uppercase opacity-10">
            Sightline
          </span>
          <span className="clash-display text-[18vw] font-bold uppercase echo-layer echo-1">
            Sightline
          </span>
          <span className="clash-display text-[18vw] font-bold uppercase echo-layer echo-2">
            Sightline
          </span>
          <span className="clash-display text-[18vw] font-bold uppercase echo-layer echo-3">
            Sightline
          </span>
          <span className="clash-display text-[18vw] font-bold uppercase echo-layer echo-4">
            Sightline
          </span>
        </div>
      </div>

      <TopBar
        activeView={activeView}
        onSelectView={setActiveView}
        bagCount={bagCount}
        onOpenBag={() => setBagOpen(true)}
      />

      <main className="flex-1">
        {activeView === 'live' && (
          <LiveStudioView
            stressConfig={stressConfig}
            onChangeStress={setStressConfig}
            mitigations={mitigations}
            onChangeMitigations={setMitigations}
            storefrontMcpUrl={storefrontMcpUrl}
            onAddToBag={handleAddToBag}
            onRecordFailure={handleRecordFailure}
          />
        )}

        {activeView === 'benchmark' && (
          <BenchmarkView
            mitigations={mitigations}
            onRecordFailure={handleRecordFailure}
          />
        )}

        {activeView === 'catalog' && (
          <CatalogView
            storefrontMcpUrl={storefrontMcpUrl}
            onChangeStorefrontMcpUrl={setStorefrontMcpUrl}
            onAddToBag={handleAddToBag}
          />
        )}

        {activeView === 'failures' && (
          <FailureLogView
            failures={failures}
            mitigations={mitigations}
            onChangeMitigations={setMitigations}
            onClearFailures={() => setFailures([])}
          />
        )}
      </main>

      <BagDrawer
        open={bagOpen}
        onClose={() => setBagOpen(false)}
        items={bagItems}
        onUpdateQty={handleUpdateQty}
        onRemove={handleRemoveFromBag}
        onClear={() => setBagItems([])}
      />
    </div>
  );
}
