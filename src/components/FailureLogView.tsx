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
    <div className="max-w-[1440px] mx-auto px-6 py-8 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-6 border-b border-neutral-200">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-neutral-950 text-balance">
            Failure Log &amp; Architectural Mitigations
          </h1>
          <p className="text-sm text-neutral-600 mt-1.5 max-w-2xl leading-relaxed">
            Live captured breaking points from Live Studio and Benchmark sweeps alongside the
            architectural changes built to push past each failure threshold.
          </p>
        </div>

        {failures.length > 0 && (
          <button
            type="button"
            onClick={onClearFailures}
            className="px-4 py-2 text-xs font-medium text-neutral-700 bg-white border border-neutral-200 hover:bg-neutral-50 rounded-lg cursor-pointer self-start sm:self-auto"
          >
            Clear Session Captures ({failures.length})
          </button>
        )}
      </div>

      {/* Active Safeguard Controls */}
      <div className="bg-white border border-neutral-200 rounded-xl p-5 grid grid-cols-1 md:grid-cols-3 gap-6">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={mitigations.blurGate}
            onChange={(e) =>
              onChangeMitigations({ ...mitigations, blurGate: e.target.checked })
            }
            className="mt-1 accent-blue-700"
          />
          <div>
            <span className="text-sm font-semibold text-neutral-900 block">
              Decisions API Zero-Token Gate
            </span>
            <span className="text-xs text-neutral-500">
              Blocks blurry frames and unconfirmed speech before Neon or Shopify runs.
            </span>
          </div>
        </label>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={mitigations.frameDedup}
            onChange={(e) =>
              onChangeMitigations({ ...mitigations, frameDedup: e.target.checked })
            }
            className="mt-1 accent-blue-700"
          />
          <div>
            <span className="text-sm font-semibold text-neutral-900 block">
              Luma Frame-Diff Deduplication
            </span>
            <span className="text-xs text-neutral-500">
              Drops redundant frames during static camera holds in high-FPS loops.
            </span>
          </div>
        </label>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={mitigations.confidenceHysteresis}
            onChange={(e) =>
              onChangeMitigations({
                ...mitigations,
                confidenceHysteresis: e.target.checked,
              })
            }
            className="mt-1 accent-blue-700"
          />
          <div>
            <span className="text-sm font-semibold text-neutral-900 block">
              Rubric Fit Sorting
            </span>
            <span className="text-xs text-neutral-500">
              Batch-scores all Shopify candidates via Decisions API against the raw frame.
            </span>
          </div>
        </label>
      </div>

      {/* Failure Snapshot List */}
      <div className="space-y-4">
        {combined.map((item) => {
          const mitigationEnabled = Boolean(mitigations[item.mitigationKey]);
          return (
            <article
              key={item.id}
              className="bg-white border border-neutral-200 rounded-xl p-5 grid grid-cols-1 lg:grid-cols-12 gap-6 items-center"
            >
              <div className="lg:col-span-3 aspect-[16/9] rounded-lg overflow-hidden bg-neutral-100 border border-neutral-200">
                <img
                  src={item.thumbnailDataUrl}
                  alt={item.triggerLabel}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              </div>

              <div className="lg:col-span-6 space-y-2">
                <div className="text-xs text-neutral-500">
                  <span className="font-medium text-neutral-800">{item.dimension}</span>
                  <span aria-hidden="true"> · </span>
                  <span className="font-mono">{item.triggerLabel}</span>
                  <span aria-hidden="true"> · </span>
                  <span>{item.timestamp}</span>
                </div>

                <p className="text-sm text-neutral-900 leading-relaxed">
                  <strong className="font-semibold">Failure Mode:</strong> {item.observedFailure}
                </p>

                <p className="text-xs text-neutral-600 leading-relaxed flex items-start gap-1.5">
                  <Wrench className="w-3.5 h-3.5 text-blue-700 shrink-0 mt-0.5" />
                  <span>
                    <strong className="font-medium text-neutral-800">Fix Applied:</strong>{' '}
                    {item.architecturalFix}
                  </span>
                </p>
              </div>

              <div className="lg:col-span-3 lg:border-l lg:border-neutral-200 lg:pl-6 space-y-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-neutral-500">Ungated Baseline</span>
                  <span className="text-amber-700 font-medium inline-flex items-center gap-1">
                    <ShieldAlert className="w-3.5 h-3.5" />
                    <span>{item.baselineStatus}</span>
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-neutral-500">With Mitigation</span>
                  <span
                    className={`font-medium inline-flex items-center gap-1 ${
                      mitigationEnabled ? 'text-emerald-700' : 'text-red-700'
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
