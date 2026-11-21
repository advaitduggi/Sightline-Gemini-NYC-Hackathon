import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, ShieldAlert, Wrench, Zap } from 'lucide-react';
import { SCENARIO_PRESETS } from '../data/scenarios';
import { FailureRecord, MitigationConfig, PipelineTrace } from '../types';
import { renderStressedFrameToCanvas, synthesizeStressAudioWav } from '../utils/mediaStress';

interface FailureLogViewProps {
  failures: FailureRecord[];
  mitigations: MitigationConfig;
  onChangeMitigations: (next: MitigationConfig) => void;
  onRecordFailure: (failure: FailureRecord) => void;
  onClearFailures: () => void;
}

type ProbeId = 'whip_pan' | 'cafe_noise';

export function FailureLogView({
  failures,
  mitigations,
  onChangeMitigations,
  onRecordFailure,
  onClearFailures,
}: FailureLogViewProps) {
  const [runningProbe, setRunningProbe] = useState<ProbeId | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);

  const runLiveStressProbe = async (probe: ProbeId) => {
    setRunningProbe(probe);
    setProbeError(null);

    try {
      const scenario = probe === 'whip_pan' ? SCENARIO_PRESETS[0] : SCENARIO_PRESETS[2];
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Failed to load probe scene image.'));
        image.src = scenario.imagePath;
      });

      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 360;

      const blurRadiusPx = probe === 'whip_pan' ? 9 : 2;
      const noiseMixLevel = probe === 'whip_pan' ? 0.25 : 0.95;
      const hasIntent = probe === 'whip_pan';

      renderStressedFrameToCanvas(
        canvas,
        img,
        {
          targetFps: 3,
          blurRadiusPx,
          noiseMixLevel,
          lowLightDimming: probe === 'whip_pan' ? 0.25 : 0.1,
          clutterCropZoom: 1.15,
        },
        15,
        scenario.panPattern,
      );

      const imageDataUrl = canvas.toDataURL('image/jpeg', 0.78);
      const audioBase64 = synthesizeStressAudioWav(0.8, noiseMixLevel, hasIntent);

      const res = await fetch('/api/pipeline/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: imageDataUrl,
          imageMimeType: 'image/jpeg',
          audioBase64,
          audioMimeType: 'audio/wav',
          spokenTranscriptHint: hasIntent
            ? scenario.spokenPrompt
            : '[Unintelligible overlapping background chatter, no shopping request]',
          mode: 'gated',
          mitigations,
          scenarioLabel: scenario.title,
        }),
      });

      const trace = (await res.json()) as PipelineTrace & { error?: string };
      if (!res.ok) {
        throw new Error(trace.error || `Stress probe failed (HTTP ${res.status})`);
      }

      onRecordFailure({
        id: `probe_${Date.now()}`,
        timestamp: new Date().toLocaleTimeString(),
        dimension: probe === 'whip_pan' ? 'Motion Blur & Whip-Pan' : 'Acoustic SNR & Overlap',
        triggerLabel:
          probe === 'whip_pan' ? '9px Motion Blur · 3 FPS' : '95% Noise · Background Speech',
        thumbnailDataUrl: imageDataUrl,
        observedFailure:
          trace.status === 'held_by_gate'
            ? trace.decisionGate?.holdReason || 'Degraded stream held upstream by Decisions API.'
            : `Passed gate with frame_usable=${trace.decisionGate?.frameUsableProb.toFixed(2)}, intent=${trace.decisionGate?.intentConfirmedProb.toFixed(2)} (${trace.totalLatencyMs}ms).`,
        architecturalFix:
          probe === 'whip_pan'
            ? 'Decisions API zero-token noul pre-gate evaluates frame_usable before Gemini 4 Neon or Shopify MCP run.'
            : 'Decisions API intent_confirmed gate filters non-shopping background speech before synthesis.',
        mitigationKey: 'blurGate',
        baselineStatus: 'Ungated baseline searches anyway',
        gatedStatus:
          trace.status === 'held_by_gate'
            ? `Safely Held (${trace.decisionGate?.gateLatencyMs ?? trace.totalLatencyMs}ms)`
            : 'Bypassed Gate (Adjust Threshold)',
      });
    } catch (err) {
      setProbeError(err instanceof Error ? err.message : 'Stress probe failed');
    } finally {
      setRunningProbe(null);
    }
  };

  return (
    <div className="max-w-[1920px] mx-auto p-6 lg:p-8 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-6 border-b border-[#1e1e1e]/10">
        <div>
          <h1 className="clash-display text-3xl font-bold uppercase text-[#111111]">
            Failure Log &amp; Mitigations
          </h1>
          <p className="text-xs text-[#838282] mt-2 max-w-2xl leading-relaxed">
            Real breaking points captured from Live Studio and Stress Benchmark runs paired with the
            active safeguards built to push past each threshold.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={runningProbe !== null}
            onClick={() => runLiveStressProbe('whip_pan')}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-[11px] font-bold uppercase bg-[#0052cc] text-white hover:opacity-90 disabled:opacity-60 cursor-pointer"
          >
            {runningProbe === 'whip_pan' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Zap className="w-3.5 h-3.5" />
            )}
            <span>Probe 9px Blur</span>
          </button>

          <button
            type="button"
            disabled={runningProbe !== null}
            onClick={() => runLiveStressProbe('cafe_noise')}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-[11px] font-bold uppercase bg-black text-white hover:opacity-90 disabled:opacity-60 cursor-pointer"
          >
            {runningProbe === 'cafe_noise' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Zap className="w-3.5 h-3.5" />
            )}
            <span>Probe 95% Noise</span>
          </button>

          {failures.length > 0 && (
            <button
              type="button"
              onClick={onClearFailures}
              className="px-4 py-2 text-[11px] font-bold uppercase text-[#111111] bg-white border border-[#1e1e1e] btn-invert cursor-pointer"
            >
              Clear Session Captures ({failures.length})
            </button>
          )}
        </div>
      </div>

      {probeError && (
        <div
          role="alert"
          className="p-4 bg-white border border-red-600/50 flex items-center gap-3 text-xs text-red-900"
        >
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{probeError}</span>
        </div>
      )}

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
              Blocks blurry frames and unconfirmed speech before Hydrogen, Neon, or Shopify runs.
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

      {/* Real Failure Snapshot List */}
      {failures.length === 0 ? (
        <div className="bg-white border border-[#1e1e1e]/10 p-10 text-center space-y-2">
          <p className="clash-display text-lg font-bold uppercase text-[#111111]">
            No Session Failures Captured Yet
          </p>
          <p className="text-xs text-[#838282] max-w-xl mx-auto leading-relaxed">
            Click <strong className="text-[#111111]">Probe 9px Blur</strong> or{' '}
            <strong className="text-[#111111]">Probe 95% Noise</strong> above, raise the{' '}
            <strong className="text-[#111111]">Stress Injector</strong> sliders in Live Studio, or
            execute a sweep in <strong className="text-[#111111]">Stress Benchmark</strong> to log
            live measured breaking points here.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {failures.map((item) => {
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
                    <strong className="uppercase">Observed Gate / Failure:</strong>{' '}
                    {item.observedFailure}
                  </p>

                  <p className="text-[11px] text-[#838282] leading-relaxed flex items-start gap-1.5">
                    <Wrench className="w-3.5 h-3.5 text-[#0052cc] shrink-0 mt-0.5" />
                    <span>
                      <strong className="uppercase text-[#111111]">Mitigation Mechanism:</strong>{' '}
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
                    <span className="text-[#838282] uppercase text-[10px] font-bold">Gated</span>
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
      )}
    </div>
  );
}
