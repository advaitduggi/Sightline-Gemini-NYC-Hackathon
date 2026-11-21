import { CheckCircle2, ShieldAlert, Wrench } from 'lucide-react';
import { FailureRecord, MitigationConfig } from '../types';

interface FailureLogViewProps {
  failures: FailureRecord[];
  mitigations: MitigationConfig;
  onChangeMitigations: (next: MitigationConfig) => void;
  onClearFailures: () => void;
}

const REFERENCE_BREAKPOINTS: FailureRecord[] = [
  {
    id: 'ref_whip_pan',
    timestamp: 'Diagnostic Reference',
    dimension: 'Motion Blur & Whip-Pan',
    triggerLabel: '7px Motion Blur · 3 FPS',
    thumbnailDataUrl: '/src/assets/images/scene_midcentury_credenza_1795288498051.jpg',
    observedFailure:
      'Single-model Hydrogen baseline treated smeared walnut streaks as wooden shelving and launched irrelevant Shopify searches.',
    architecturalFix:
      'Added Decisions API zero-token noul pre-gate (frame_usable >= 0.55) before Gemini 4 Neon synthesis and Shopify MCP calls.',
    mitigationKey: 'blurGate',
    baselineStatus: 'False Shopify search fired',
    gatedStatus: 'Safely held until sharp frame',
  },
  {
    id: 'ref_cafe_chatter',
    timestamp: 'Diagnostic Reference',
    dimension: 'Acoustic SNR & Overlap',
    triggerLabel: '95% Noise · Background Speech',
    thumbnailDataUrl: '/src/assets/images/scene_thrift_shelf_1795288499185.jpg',
    observedFailure:
      'Background cafe conversation mentioning "mugs" caused un-gated pipeline to ignore the foreground gooseneck kettle request.',
    architecturalFix:
      'Paired Gemini 4 Hydrogen acoustic noise assessment with Decisions API intent_confirmed gate and Neon negative-constraint synthesis.',
    mitigationKey: 'blurGate',
    baselineStatus: 'Misfired on background chatter',
    gatedStatus: 'Filtered non-intent audio',
  },
  {
    id: 'ref_burst_queue',
    timestamp: 'Diagnostic Reference',
    dimension: 'High-FPS Static Burst',
    triggerLabel: '4 FPS · Identical Frames',
    thumbnailDataUrl: '/src/assets/images/scene_cluttered_workbench_1795288497448.jpg',
    observedFailure:
      'Continuous 4 FPS polling saturated downstream Gemini 4 Neon and Shopify MCP calls with redundant identical frames.',
    architecturalFix:
      'Implemented client-side luma pixel-delta deduplication (1.5% threshold) plus in-flight request locking.',
    mitigationKey: 'frameDedup',
    baselineStatus: '4x redundant API spend',
    gatedStatus: 'Static frames skipped locally',
  },
];

export function FailureLogView({
  failures,
  mitigations,
  onChangeMitigations,
  onClearFailures,
}: FailureLogViewProps) {
  const combined = [...failures, ...REFERENCE_BREAKPOINTS];

  return (
    <div className="max-w-[1920px] mx-auto p-6 lg:p-8 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-6 border-b border-[#1e1e1e]/10">
        <div>
          <h1 className="clash-display text-3xl font-bold uppercase text-[#111111]">
            Failure Log &amp; Mitigations
          </h1>
          <p className="text-xs text-[#838282] mt-2 max-w-2xl leading-relaxed">
            Captured breaking points from Live Studio and Stress Benchmark runs paired with the
            architectural safeguards built to push past each threshold.
          </p>
        </div>

        {failures.length > 0 && (
          <button
            type="button"
            onClick={onClearFailures}
            className="px-4 py-2 text-[11px] font-bold uppercase text-[#111111] bg-white border border-[#1e1e1e] btn-invert cursor-pointer self-start sm:self-auto"
          >
            Clear Session Captures ({failures.length})
          </button>
        )}
      </div>

      {/* Active Safeguard Controls with Custom Swiss Checkboxes */}
      <div className="bg-white border border-[#1e1e1e]/10 p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
        <button
          type="button"
          onClick={() =>
            onChangeMitigations({ ...mitigations, blurGate: !mitigations.blurGate })
          }
          className="flex items-start gap-3 text-left cursor-pointer group"
        >
          <div className="w-3.5 h-3.5 mt-0.5 border border-black flex items-center justify-center shrink-0">
            {mitigations.blurGate && <div className="w-2 h-2 bg-black" />}
          </div>
          <div>
            <span className="text-xs font-bold uppercase text-[#111111] group-hover:text-[#0052cc] block">
              Decisions API Zero-Token Gate
            </span>
            <span className="text-[11px] text-[#838282] mt-0.5 block">
              Blocks blurry frames and unconfirmed speech before Neon or Shopify runs.
            </span>
          </div>
        </button>

        <button
          type="button"
          onClick={() =>
            onChangeMitigations({ ...mitigations, frameDedup: !mitigations.frameDedup })
          }
          className="flex items-start gap-3 text-left cursor-pointer group"
        >
          <div className="w-3.5 h-3.5 mt-0.5 border border-black flex items-center justify-center shrink-0">
            {mitigations.frameDedup && <div className="w-2 h-2 bg-black" />}
          </div>
          <div>
            <span className="text-xs font-bold uppercase text-[#111111] group-hover:text-[#0052cc] block">
              Luma Frame-Diff Deduplication
            </span>
            <span className="text-[11px] text-[#838282] mt-0.5 block">
              Drops redundant frames during static camera holds in high-FPS loops.
            </span>
          </div>
        </button>

        <button
          type="button"
          onClick={() =>
            onChangeMitigations({
              ...mitigations,
              confidenceHysteresis: !mitigations.confidenceHysteresis,
            })
          }
          className="flex items-start gap-3 text-left cursor-pointer group"
        >
          <div className="w-3.5 h-3.5 mt-0.5 border border-black flex items-center justify-center shrink-0">
            {mitigations.confidenceHysteresis && <div className="w-2 h-2 bg-black" />}
          </div>
          <div>
            <span className="text-xs font-bold uppercase text-[#111111] group-hover:text-[#0052cc] block">
              Rubric Fit Sorting
            </span>
            <span className="text-[11px] text-[#838282] mt-0.5 block">
              Batch-scores all Shopify candidates via Decisions API against the raw frame.
            </span>
          </div>
        </button>
      </div>

      {/* Failure Snapshot List */}
      <div className="space-y-4">
        {combined.map((item) => {
          const mitigationEnabled = Boolean(mitigations[item.mitigationKey]);
          return (
            <article
              key={item.id}
              className="bg-white border border-[#1e1e1e]/10 p-5 grid grid-cols-1 lg:grid-cols-12 gap-6 items-center"
            >
              <div className="lg:col-span-3 aspect-[16/9] overflow-hidden bg-[#f2f2f2] border border-[#1e1e1e]/10">
                <img
                  src={item.thumbnailDataUrl}
                  alt={item.triggerLabel}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              </div>

              <div className="lg:col-span-6 space-y-2">
                <div className="text-[10px] text-[#838282] uppercase">
                  <span className="font-bold text-[#111111]">{item.dimension}</span>
                  <span aria-hidden="true"> · </span>
                  <span className="mono">{item.triggerLabel}</span>
                  <span aria-hidden="true"> · </span>
                  <span className="mono">{item.timestamp}</span>
                </div>

                <p className="text-xs text-[#111111] leading-relaxed">
                  <strong className="uppercase">Failure Mode:</strong> {item.observedFailure}
                </p>

                <p className="text-[11px] text-[#838282] leading-relaxed flex items-start gap-1.5">
                  <Wrench className="w-3.5 h-3.5 text-[#0052cc] shrink-0 mt-0.5" />
                  <span>
                    <strong className="uppercase text-[#111111]">Fix Applied:</strong>{' '}
                    {item.architecturalFix}
                  </span>
                </p>
              </div>

              <div className="lg:col-span-3 lg:border-l lg:border-[#1e1e1e]/10 lg:pl-6 space-y-2 text-[11px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#838282] uppercase text-[10px] font-bold">Baseline</span>
                  <span className="text-amber-700 font-bold inline-flex items-center gap-1">
                    <ShieldAlert className="w-3.5 h-3.5" />
                    <span>{item.baselineStatus}</span>
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#838282] uppercase text-[10px] font-bold">Mitigated</span>
                  <span
                    className={`font-bold inline-flex items-center gap-1 ${
                      mitigationEnabled ? 'text-green-700' : 'text-red-700'
                    }`}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{mitigationEnabled ? item.gatedStatus : 'Mitigation Disabled'}</span>
                  </span>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
