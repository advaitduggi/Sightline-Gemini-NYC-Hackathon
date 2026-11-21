import { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Play, ShieldAlert } from 'lucide-react';
import { SCENARIO_PRESETS } from '../data/scenarios';
import {
  BenchmarkDimension,
  BenchmarkStepResult,
  FailureRecord,
  MitigationConfig,
} from '../types';
import {
  renderStressedFrameToCanvas,
  synthesizeStressAudioWav,
} from '../utils/mediaStress';

interface BenchmarkViewProps {
  mitigations: MitigationConfig;
  onRecordFailure: (failure: FailureRecord) => void;
}

interface SweepStepSpec {
  stepLabel: string;
  stressValue: number;
  stressUnit: string;
  blurRadiusPx: number;
  noiseMixLevel: number;
  lowLightDimming: number;
  clutterCropZoom: number;
  targetFps: number;
  expectReject: boolean;
  hasIntent: boolean;
}

const SWEEP_SPECS: Record<BenchmarkDimension, SweepStepSpec[]> = {
  blur_motion: [
    {
      stepLabel: '0px Sharp Pan',
      stressValue: 0,
      stressUnit: 'px',
      blurRadiusPx: 0,
      noiseMixLevel: 0.1,
      lowLightDimming: 0,
      clutterCropZoom: 1,
      targetFps: 1,
      expectReject: false,
      hasIntent: true,
    },
    {
      stepLabel: '3px Light Motion',
      stressValue: 3,
      stressUnit: 'px',
      blurRadiusPx: 3,
      noiseMixLevel: 0.15,
      lowLightDimming: 0.1,
      clutterCropZoom: 1.05,
      targetFps: 2,
      expectReject: false,
      hasIntent: true,
    },
    {
      stepLabel: '7px Whip-Pan Smear',
      stressValue: 7,
      stressUnit: 'px',
      blurRadiusPx: 7,
      noiseMixLevel: 0.25,
      lowLightDimming: 0.2,
      clutterCropZoom: 1.15,
      targetFps: 3,
      expectReject: true,
      hasIntent: true,
    },
    {
      stepLabel: '12px Severe Defocus',
      stressValue: 12,
      stressUnit: 'px',
      blurRadiusPx: 12,
      noiseMixLevel: 0.3,
      lowLightDimming: 0.45,
      clutterCropZoom: 1.25,
      targetFps: 4,
      expectReject: true,
      hasIntent: true,
    },
  ],
  acoustic_snr: [
    {
      stepLabel: '0% Clean Speech',
      stressValue: 0,
      stressUnit: '% noise',
      blurRadiusPx: 0,
      noiseMixLevel: 0,
      lowLightDimming: 0,
      clutterCropZoom: 1,
      targetFps: 1,
      expectReject: false,
      hasIntent: true,
    },
    {
      stepLabel: '35% Ambient Room',
      stressValue: 35,
      stressUnit: '% noise',
      blurRadiusPx: 1,
      noiseMixLevel: 0.35,
      lowLightDimming: 0,
      clutterCropZoom: 1,
      targetFps: 1,
      expectReject: false,
      hasIntent: true,
    },
    {
      stepLabel: '75% Cafe Chatter',
      stressValue: 75,
      stressUnit: '% noise',
      blurRadiusPx: 1,
      noiseMixLevel: 0.75,
      lowLightDimming: 0.1,
      clutterCropZoom: 1.1,
      targetFps: 2,
      expectReject: false,
      hasIntent: true,
    },
    {
      stepLabel: '95% Pure Chatter (No Intent)',
      stressValue: 95,
      stressUnit: '% noise',
      blurRadiusPx: 2,
      noiseMixLevel: 0.95,
      lowLightDimming: 0.15,
      clutterCropZoom: 1.2,
      targetFps: 2,
      expectReject: true,
      hasIntent: false,
    },
  ],
  cadence_burst: [
    {
      stepLabel: '0.5 FPS Relaxed',
      stressValue: 0.5,
      stressUnit: 'FPS',
      blurRadiusPx: 0,
      noiseMixLevel: 0.1,
      lowLightDimming: 0,
      clutterCropZoom: 1,
      targetFps: 0.5,
      expectReject: false,
      hasIntent: true,
    },
    {
      stepLabel: '1.5 FPS Active Walk',
      stressValue: 1.5,
      stressUnit: 'FPS',
      blurRadiusPx: 2,
      noiseMixLevel: 0.25,
      lowLightDimming: 0.1,
      clutterCropZoom: 1.15,
      targetFps: 1.5,
      expectReject: false,
      hasIntent: true,
    },
    {
      stepLabel: '3.0 FPS Rapid Scan',
      stressValue: 3,
      stressUnit: 'FPS',
      blurRadiusPx: 5,
      noiseMixLevel: 0.45,
      lowLightDimming: 0.25,
      clutterCropZoom: 1.35,
      targetFps: 3,
      expectReject: true,
      hasIntent: true,
    },
    {
      stepLabel: '4.0 FPS Dark Whip Burst',
      stressValue: 4,
      stressUnit: 'FPS',
      blurRadiusPx: 10,
      noiseMixLevel: 0.8,
      lowLightDimming: 0.65,
      clutterCropZoom: 1.5,
      targetFps: 4,
      expectReject: true,
      hasIntent: false,
    },
  ],
};

export function BenchmarkView({ mitigations, onRecordFailure }: BenchmarkViewProps) {
  const [dimension, setDimension] = useState<BenchmarkDimension>('blur_motion');
  const [scenarioId, setScenarioId] = useState<string>(SCENARIO_PRESETS[0].id);
  const [isRunning, setIsRunning] = useState(false);
  const [currentStepIdx, setCurrentStepIdx] = useState<number | null>(null);
  const [results, setResults] = useState<BenchmarkStepResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const loadScenarioImage = (src: string): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load scene image ${src}`));
      img.src = src;
    });

  const runLiveSweep = async () => {
    setIsRunning(true);
    setResults([]);
    setError(null);

    const scenario = SCENARIO_PRESETS.find((s) => s.id === scenarioId) || SCENARIO_PRESETS[0];
    const specs = SWEEP_SPECS[dimension];

    try {
      const img = await loadScenarioImage(scenario.imagePath);
      if (!offscreenCanvasRef.current) {
        const c = document.createElement('canvas');
        c.width = 960;
        c.height = 540;
        offscreenCanvasRef.current = c;
      }
      const canvas = offscreenCanvasRef.current;

      for (let i = 0; i < specs.length; i++) {
        setCurrentStepIdx(i);
        const spec = specs[i];

        renderStressedFrameToCanvas(
          canvas,
          img,
          {
            targetFps: spec.targetFps,
            blurRadiusPx: spec.blurRadiusPx,
            noiseMixLevel: spec.noiseMixLevel,
            lowLightDimming: spec.lowLightDimming,
            clutterCropZoom: spec.clutterCropZoom,
          },
          i * 15,
          scenario.panPattern,
        );

        const imageDataUrl = canvas.toDataURL('image/jpeg', 0.85);
        const audioBase64 = synthesizeStressAudioWav(1.5, spec.noiseMixLevel, spec.hasIntent);

        const res = await fetch('/api/benchmark/step', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stepIndex: i,
            stepLabel: spec.stepLabel,
            stressValue: spec.stressValue,
            stressUnit: spec.stressUnit,
            imageBase64: imageDataUrl,
            imageMimeType: 'image/jpeg',
            audioBase64,
            audioMimeType: 'audio/wav',
            spokenTranscriptHint: spec.hasIntent
              ? scenario.spokenPrompt
              : '[Unintelligible background cafe chatter, no product request]',
            mitigations,
            expectReject: spec.expectReject,
          }),
        });

        const stepData = await res.json();
        if (!res.ok) {
          throw new Error(stepData.error || `Benchmark step failed (HTTP ${res.status})`);
        }

        const typedStep: BenchmarkStepResult = stepData;
        setResults((prev) => [...prev, typedStep]);

        if (typedStep.gated.brokeHere || typedStep.baseline.hallucinatedOrLowQuality) {
          onRecordFailure({
            id: `bench_fail_${Date.now()}_${i}`,
            timestamp: new Date().toLocaleTimeString(),
            dimension:
              dimension === 'blur_motion'
                ? 'Motion Blur Sweep'
                : dimension === 'acoustic_snr'
                  ? 'Acoustic SNR Sweep'
                  : 'Cadence Burst Sweep',
            triggerLabel: spec.stepLabel,
            thumbnailDataUrl: imageDataUrl,
            observedFailure:
              typedStep.gated.breakReason ||
              `Ungated baseline blindly queried "${typedStep.baseline.topProductTitle || typedStep.baseline.summary}" under ${spec.stepLabel}.`,
            architecturalFix:
              'Calibrated Decisions API pre-gate + adaptive frame usability thresholding isolates degraded frames.',
            mitigationKey: 'blurGate',
            baselineStatus: typedStep.baseline.hallucinatedOrLowQuality
              ? 'False trigger on degraded frame'
              : 'Passed',
            gatedStatus: typedStep.gated.passedGate ? 'Passed' : 'Held by Gate',
          });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Stress sweep failed');
    } finally {
      setIsRunning(false);
      setCurrentStepIdx(null);
    }
  };

  const baselineBadCount = results.filter((r) => r.baseline.hallucinatedOrLowQuality).length;
  const gatedBreaks = results.filter((r) => r.gated.brokeHere);
  const avgGateMs =
    results.length > 0
      ? Math.round(results.reduce((s, r) => s + r.gated.gateLatencyMs, 0) / results.length)
      : null;
  const avgFit =
    results.filter((r) => r.gated.topFitScore !== null).length > 0
      ? Math.round(
          (results
            .filter((r) => r.gated.topFitScore !== null)
            .reduce((s, r) => s + (r.gated.topFitScore ?? 0), 0) /
            results.filter((r) => r.gated.topFitScore !== null).length) *
            100,
        )
      : null;

  return (
    <div className="max-w-[1440px] mx-auto px-6 py-8 space-y-8">
      {/* Header & Controls */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pb-6 border-b border-neutral-200">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-neutral-950 text-balance">
            Element 119 Stress Benchmark &amp; Breaking-Point Suite
          </h1>
          <p className="text-sm text-neutral-600 mt-1.5 max-w-2xl leading-relaxed">
            Pushes live video frames and audio across escalating blur, acoustic noise, and cadence
            bursts—comparing the single-model ungated baseline against our Decisions API + Gemini 4
            Neon pipeline.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            value={scenarioId}
            onChange={(e) => setScenarioId(e.target.value)}
            disabled={isRunning}
            aria-label="Select test scenario"
            className="px-3 py-2 text-xs font-medium bg-white border border-neutral-200 rounded-lg text-neutral-800"
          >
            {SCENARIO_PRESETS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>

          <div className="flex items-center p-1 bg-neutral-100 rounded-lg border border-neutral-200">
            {(
              [
                ['blur_motion', 'Motion Blur'],
                ['acoustic_snr', 'Acoustic SNR'],
                ['cadence_burst', 'Cadence Burst'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                disabled={isRunning}
                onClick={() => setDimension(id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  dimension === id
                    ? 'bg-white text-neutral-950 shadow-xs'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={runLiveSweep}
            disabled={isRunning}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
          >
            {isRunning ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Running Step {(currentStepIdx ?? 0) + 1}/4</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                <span>Run Live Stress Sweep</span>
              </>
            )}
          </button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 text-sm text-red-900"
        >
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Benchmark Run Error</p>
            <p className="text-red-800 mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {/* Measured KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-neutral-200 rounded-xl p-4">
          <span className="text-xs text-neutral-500">Steps Completed</span>
          <p className="font-mono text-2xl font-semibold text-neutral-950 mt-1 tabular-nums">
            {results.length} / 4
          </p>
        </div>
        <div className="bg-white border border-neutral-200 rounded-xl p-4">
          <span className="text-xs text-neutral-500">Baseline Degraded Triggers</span>
          <p className="font-mono text-2xl font-semibold text-amber-700 mt-1 tabular-nums">
            {results.length > 0 ? `${baselineBadCount} / ${results.length}` : '—'}
          </p>
        </div>
        <div className="bg-white border border-neutral-200 rounded-xl p-4">
          <span className="text-xs text-neutral-500">Avg Decisions Gate Latency</span>
          <p className="font-mono text-2xl font-semibold text-neutral-950 mt-1 tabular-nums">
            {avgGateMs !== null ? `${avgGateMs} ms` : '—'}
          </p>
        </div>
        <div className="bg-white border border-neutral-200 rounded-xl p-4">
          <span className="text-xs text-neutral-500">First Gated Breaking Point</span>
          <p className="font-mono text-lg font-semibold text-neutral-950 mt-1 truncate">
            {results.length === 0
              ? '—'
              : gatedBreaks.length > 0
                ? gatedBreaks[0].stepLabel
                : `Held all (${avgFit ?? 0}% fit)`}
          </p>
        </div>
      </div>

      {/* SVG Calibration Chart + Live Data Table */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Calibrated Probability Trajectory Chart (5 cols) */}
        <div className="lg:col-span-5 bg-white border border-neutral-200 rounded-xl p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-neutral-900">
              Decisions API Calibration Trajectory
            </h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              Measured <span className="font-mono">frame_usable</span> (blue) and{' '}
              <span className="font-mono">intent_confirmed</span> (amber) probabilities across
              escalating stress.
            </p>
          </div>

          <div className="h-56 w-full border border-neutral-100 rounded-lg bg-neutral-50 p-3">
            {results.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-neutral-400">
                Run a live stress sweep to plot measured probability decay.
              </div>
            ) : (
              <svg viewBox="0 0 360 180" className="w-full h-full overflow-visible">
                {/* Threshold dashed line */}
                <line
                  x1="28"
                  x2="344"
                  y1={160 - mitigations.minUsableProb * 140}
                  y2={160 - mitigations.minUsableProb * 140}
                  stroke="#DC2626"
                  strokeDasharray="4 4"
                  strokeWidth="1"
                />
                <text
                  x="30"
                  y={156 - mitigations.minUsableProb * 140}
                  fontSize="9"
                  fill="#DC2626"
                  fontFamily="JetBrains Mono, monospace"
                >
                  Gate {mitigations.minUsableProb.toFixed(2)}
                </text>

                {/* Grid baselines */}
                <line x1="28" x2="344" y1="160" y2="160" stroke="#E5E7EB" />
                <line x1="28" x2="344" y1="20" y2="20" stroke="#E5E7EB" />

                {/* Frame Usable Line */}
                <polyline
                  fill="none"
                  stroke="#1D4ED8"
                  strokeWidth="2.5"
                  points={results
                    .map((r, idx) => {
                      const x = 36 + idx * 96;
                      const y = 160 - r.gated.frameUsableProb * 140;
                      return `${x},${y}`;
                    })
                    .join(' ')}
                />

                {/* Intent Confirmed Line */}
                <polyline
                  fill="none"
                  stroke="#D97706"
                  strokeWidth="2"
                  strokeDasharray="3 2"
                  points={results
                    .map((r, idx) => {
                      const x = 36 + idx * 96;
                      const y = 160 - r.gated.intentProb * 140;
                      return `${x},${y}`;
                    })
                    .join(' ')}
                />

                {results.map((r, idx) => {
                  const x = 36 + idx * 96;
                  const yFrame = 160 - r.gated.frameUsableProb * 140;
                  const yIntent = 160 - r.gated.intentProb * 140;
                  return (
                    <g key={r.stepIndex}>
                      <circle cx={x} cy={yFrame} r="4" fill="#1D4ED8" />
                      <circle cx={x} cy={yIntent} r="3.5" fill="#D97706" />
                      <text
                        x={x}
                        y="174"
                        textAnchor="middle"
                        fontSize="9"
                        fill="#6B7280"
                        fontFamily="JetBrains Mono, monospace"
                      >
                        {r.stressValue}
                        {r.stressUnit}
                      </text>
                    </g>
                  );
                })}
              </svg>
            )}
          </div>
        </div>

        {/* Side-by-Side Comparison Data Grid (7 cols) */}
        <div className="lg:col-span-7 bg-white border border-neutral-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-neutral-200">
            <h2 className="text-sm font-semibold text-neutral-900">
              Baseline vs. Element 119 Gated Pipeline Results
            </h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50 text-[11px] font-semibold text-neutral-500">
                  <th className="py-2.5 px-4">Stress Level</th>
                  <th className="py-2.5 px-4">Ungated Baseline</th>
                  <th className="py-2.5 px-4 text-right">Usable</th>
                  <th className="py-2.5 px-4 text-right">Intent</th>
                  <th className="py-2.5 px-4">Gated Outcome</th>
                  <th className="py-2.5 px-4 text-right">Latency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200 text-xs">
                {results.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-neutral-500">
                      Click <strong>Run Live Stress Sweep</strong> to execute 4 live multimodal
                      calls across Gemini 4 Hydrogen, Decisions API, Gemini 4 Neon, and Shopify MCP.
                    </td>
                  </tr>
                ) : (
                  results.map((row) => (
                    <tr key={row.stepIndex} className="hover:bg-neutral-50">
                      <td className="py-3 px-4 font-medium text-neutral-900 whitespace-nowrap">
                        {row.stepLabel}
                      </td>
                      <td className="py-3 px-4 text-neutral-600 max-w-[180px] truncate">
                        {row.baseline.hallucinatedOrLowQuality ? (
                          <span className="text-amber-700 font-medium">
                            Fired: {row.baseline.topProductTitle || row.baseline.summary}
                          </span>
                        ) : (
                          <span>{row.baseline.topProductTitle || row.baseline.summary}</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-neutral-900">
                        {(row.gated.frameUsableProb * 100).toFixed(0)}%
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-neutral-900">
                        {(row.gated.intentProb * 100).toFixed(0)}%
                      </td>
                      <td className="py-3 px-4">
                        {row.gated.brokeHere ? (
                          <span className="inline-flex items-center gap-1 text-red-700 font-medium">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate max-w-[160px]">
                              {row.gated.breakReason || 'Broke'}
                            </span>
                          </span>
                        ) : row.gated.passedGate ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate max-w-[160px]">
                              {row.gated.topProductTitle || 'Matched'}
                            </span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                            <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                            <span>Held ({row.gated.routeChoice})</span>
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-neutral-500">
                        {row.gated.latencyMs}ms
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
