import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Mic, MicOff, Zap } from 'lucide-react';
import { SCENARIO_PRESETS } from '../data/scenarios';
import {
  CatalogProduct,
  FailureRecord,
  MediaSourceMode,
  MitigationConfig,
  PipelineTrace,
  StressConfig,
} from '../types';
import {
  computeFrameLumaDelta,
  encodeFloat32ToWavBase64,
  renderStressedFrameToCanvas,
  synthesizeStressAudioWav,
} from '../utils/mediaStress';
import { ProductCard } from './ProductCard';

interface LiveStudioViewProps {
  stressConfig: StressConfig;
  onChangeStress: (next: StressConfig) => void;
  mitigations: MitigationConfig;
  onChangeMitigations: (next: MitigationConfig) => void;
  storefrontMcpUrl: string;
  onAddToBag: (product: CatalogProduct) => void;
  onRecordFailure: (failure: FailureRecord) => void;
}

const AMPLITUDE_DELAYS = ['0.1s', '0.3s', '0.2s', '0.4s', '0.05s', '0.15s', '0.25s', '0.35s'];

export function LiveStudioView({
  stressConfig,
  onChangeStress,
  mitigations,
  onChangeMitigations,
  storefrontMcpUrl,
  onAddToBag,
  onRecordFailure,
}: LiveStudioViewProps) {
  const [sourceMode, setSourceMode] = useState<MediaSourceMode>('scenario');
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>(SCENARIO_PRESETS[0].id);
  const [pipelineMode, setPipelineMode] = useState<'gated' | 'baseline'>('gated');
  const [spokenHint, setSpokenHint] = useState<string>(SCENARIO_PRESETS[0].spokenPrompt);

  const [isStreaming, setIsStreaming] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [dedupSkippedCount, setDedupSkippedCount] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);

  const [latestTrace, setLatestTrace] = useState<PipelineTrace | null>(null);
  const [traceHistory, setTraceHistory] = useState<PipelineTrace[]>([]);
  const [audioLevel, setAudioLevel] = useState<number>(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const tickRef = useRef(0);
  const prevLumaRef = useRef<Uint8ClampedArray | null>(null);
  const inFlightRef = useRef(false);

  const micStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const pcmBufferRef = useRef<Float32Array[]>([]);

  const scenario =
    SCENARIO_PRESETS.find((s) => s.id === selectedScenarioId) || SCENARIO_PRESETS[0];

  useEffect(() => {
    if (sourceMode === 'scenario') {
      setSpokenHint(scenario.spokenPrompt);
    }
  }, [selectedScenarioId, sourceMode, scenario.spokenPrompt]);

  useEffect(() => {
    if (sourceMode !== 'scenario') return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = scenario.imagePath;
    img.onload = () => {
      imgRef.current = img;
    };
  }, [scenario.imagePath, sourceMode]);

  useEffect(() => {
    if (!isStreaming) return;
    const id = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [isStreaming]);

  const stopCameraAndMic = useCallback(() => {
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    setCameraReady(false);
    setMicActive(false);
    pcmBufferRef.current = [];
  }, []);

  const startCameraAndMic = useCallback(async () => {
    setMediaError(null);
    stopCameraAndMic();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraReady(true);
      }

      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length > 0) {
        const ctx = new AudioContext({ sampleRate: 16000 });
        audioCtxRef.current = ctx;
        const src = ctx.createMediaStreamSource(stream);
        const proc = ctx.createScriptProcessor(4096, 1, 1);
        src.connect(proc);
        proc.connect(ctx.destination);
        proc.onaudioprocess = (ev) => {
          const ch = ev.inputBuffer.getChannelData(0);
          const copy = new Float32Array(ch.length);
          copy.set(ch);
          pcmBufferRef.current.push(copy);
          if (pcmBufferRef.current.length > 16) {
            pcmBufferRef.current.shift();
          }
          let rms = 0;
          for (let i = 0; i < ch.length; i += 8) rms += ch[i] * ch[i];
          setAudioLevel(Math.min(1, Math.sqrt(rms / (ch.length / 8)) * 4));
        };
        micStreamRef.current = stream;
        setMicActive(true);
      }
    } catch (err) {
      setMediaError(
        err instanceof Error
          ? `Camera/Mic unavailable: ${err.message}. Switch to Scenario Stream or Upload Video.`
          : 'Camera/Mic permission denied.',
      );
    }
  }, [stopCameraAndMic]);

  useEffect(() => {
    if (sourceMode === 'camera') {
      startCameraAndMic();
    } else {
      stopCameraAndMic();
    }
    return () => {
      stopCameraAndMic();
    };
  }, [sourceMode, startCameraAndMic, stopCameraAndMic]);

  useEffect(() => {
    let rafId = 0;
    const render = () => {
      tickRef.current += 1;
      const canvas = canvasRef.current;
      if (canvas) {
        const src =
          sourceMode === 'scenario'
            ? imgRef.current
            : videoRef.current && videoRef.current.readyState >= 2
              ? videoRef.current
              : null;
        if (src) {
          renderStressedFrameToCanvas(
            canvas,
            src,
            stressConfig,
            tickRef.current,
            sourceMode === 'scenario' ? scenario.panPattern : 'slow-pan',
          );
        }
      }
      if (sourceMode !== 'camera' || !micActive) {
        const syntheticLevel =
          0.14 +
          stressConfig.noiseMixLevel * 0.55 +
          Math.abs(Math.sin(tickRef.current * 0.14)) * 0.25;
        setAudioLevel(Math.min(1, syntheticLevel));
      }
      rafId = requestAnimationFrame(render);
    };
    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, [sourceMode, stressConfig, scenario.panPattern, micActive]);

  const handleVideoFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMediaError(null);
    const url = URL.createObjectURL(file);
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.src = url;
      videoRef.current.loop = true;
      videoRef.current.muted = true;
      videoRef.current.play().catch(() => {});
      setCameraReady(true);
    }
  };

  const captureCurrentAudioWavBase64 = (): string => {
    if (sourceMode === 'camera' && micActive && pcmBufferRef.current.length > 0) {
      const totalLen = pcmBufferRef.current.reduce((acc, buf) => acc + buf.length, 0);
      const merged = new Float32Array(totalLen);
      let offset = 0;
      for (const buf of pcmBufferRef.current) {
        merged.set(buf, offset);
        offset += buf.length;
      }
      return encodeFloat32ToWavBase64(merged, 16000);
    }
    return synthesizeStressAudioWav(
      1.6,
      stressConfig.noiseMixLevel,
      spokenHint.trim().length > 0,
    );
  };

  const analyzeFrameNow = useCallback(
    async (isFromLoop = false) => {
      const canvas = canvasRef.current;
      if (!canvas || inFlightRef.current) return;

      if (isFromLoop && mitigations.frameDedup) {
        const { deltaRatio, snapshot } = computeFrameLumaDelta(prevLumaRef.current, canvas);
        prevLumaRef.current = snapshot;
        if (deltaRatio < 0.015) {
          setDedupSkippedCount((c) => c + 1);
          return;
        }
      } else {
        const { snapshot } = computeFrameLumaDelta(prevLumaRef.current, canvas);
        prevLumaRef.current = snapshot;
      }

      inFlightRef.current = true;
      setIsAnalyzing(true);
      setApiError(null);

      try {
        const imageDataUrl = canvas.toDataURL('image/jpeg', 0.85);
        const audioBase64 = captureCurrentAudioWavBase64();

        const res = await fetch('/api/pipeline/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: imageDataUrl,
            imageMimeType: 'image/jpeg',
            audioBase64,
            audioMimeType: 'audio/wav',
            spokenTranscriptHint: spokenHint,
            mode: pipelineMode,
            mitigations,
            storefrontMcpUrl,
            scenarioLabel:
              sourceMode === 'scenario'
                ? scenario.title
                : sourceMode === 'camera'
                  ? 'Live Webcam + Mic'
                  : 'Uploaded Video Stream',
            stressConfig,
          }),
        });

        const payload = await res.json();
        if (!res.ok) {
          throw new Error(payload.error || `Pipeline failed with HTTP ${res.status}`);
        }

        const fullTrace: PipelineTrace = {
          ...payload,
          thumbnailDataUrl: imageDataUrl,
        };

        setLatestTrace(fullTrace);
        setTraceHistory((prev) => [fullTrace, ...prev].slice(0, 12));

        if (
          fullTrace.status === 'held_by_gate' ||
          (fullTrace.mode === 'baseline' && stressConfig.blurRadiusPx >= 5)
        ) {
          onRecordFailure({
            id: `fail_${Date.now()}`,
            timestamp: new Date().toLocaleTimeString(),
            dimension:
              stressConfig.blurRadiusPx >= 5
                ? 'Motion Blur & Defocus'
                : 'Acoustic SNR / Ambiguity',
            triggerLabel: `Blur ${stressConfig.blurRadiusPx}px · Noise ${Math.round(
              stressConfig.noiseMixLevel * 100,
            )}%`,
            thumbnailDataUrl: imageDataUrl,
            observedFailure:
              fullTrace.mode === 'baseline'
                ? `Ungated Hydrogen baseline still fired Shopify search ("${fullTrace.hydrogen.quickSearchQuery}") despite ${fullTrace.hydrogen.blurOrOcclusionObserved}.`
                : fullTrace.decisionGate?.holdReason || 'Frame rejected by Decisions API gate.',
            architecturalFix:
              'Decisions API zero-token pre-gate (frame_usable + intent_confirmed) prevented wasted Gemini 4 Neon reasoning and false Shopify MCP triggers.',
            mitigationKey: 'blurGate',
            baselineStatus: 'False Shopify search triggered',
            gatedStatus: fullTrace.status === 'held_by_gate' ? 'Safely Held' : 'Matched',
          });
        }
      } catch (err) {
        setApiError(err instanceof Error ? err.message : 'Unexpected analysis error');
        setIsStreaming(false);
      } finally {
        inFlightRef.current = false;
        setIsAnalyzing(false);
      }
    },
    [
      mitigations,
      pipelineMode,
      scenario.title,
      sourceMode,
      spokenHint,
      storefrontMcpUrl,
      stressConfig,
      onRecordFailure,
    ],
  );

  useEffect(() => {
    if (!isStreaming) return;
    const intervalMs = Math.max(250, Math.round(1000 / Math.max(0.5, stressConfig.targetFps)));
    const timer = setInterval(() => {
      analyzeFrameNow(true);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [isStreaming, stressConfig.targetFps, analyzeFrameNow]);

  const formattedClock = `00:${String(Math.floor(elapsedSec / 60)).padStart(2, '0')}:${String(
    elapsedSec % 60,
  ).padStart(2, '0')}`;

  return (
    <div className="max-w-[1920px] mx-auto p-6 lg:p-8 grid grid-cols-12 gap-8">
      {/* LEFT SIDE: 7 columns (Capture & Control) */}
      <section className="col-span-12 lg:col-span-7 flex flex-col gap-6">
        {/* E.1 Source Mode Switcher + Pipeline Mode */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1e1e1e]/10 pb-4">
          <div className="flex flex-wrap gap-1">
            {(
              [
                ['scenario', 'Scenario Stream'],
                ['camera', 'Live Camera + Mic'],
                ['upload', 'Upload Video'],
              ] as const
            ).map(([id, label]) => {
              const active = sourceMode === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSourceMode(id)}
                  className={`px-4 py-1.5 text-xs font-bold uppercase border transition-colors whitespace-nowrap cursor-pointer ${
                    active
                      ? 'border-black bg-black text-white'
                      : 'border-[#1e1e1e]/10 bg-transparent hover:bg-[#1e1e1e]/5 text-[#111111]'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setPipelineMode('gated')}
              className={`px-3 py-1.5 text-[11px] font-bold uppercase border transition-colors whitespace-nowrap cursor-pointer ${
                pipelineMode === 'gated'
                  ? 'border-[#0052cc] bg-[#0052cc] text-white'
                  : 'border-[#1e1e1e]/10 bg-transparent hover:bg-[#1e1e1e]/5 text-[#111111]'
              }`}
            >
              Element 119 Gated
            </button>
            <button
              type="button"
              onClick={() => setPipelineMode('baseline')}
              className={`px-3 py-1.5 text-[11px] font-bold uppercase border transition-colors whitespace-nowrap cursor-pointer ${
                pipelineMode === 'baseline'
                  ? 'border-black bg-black text-white'
                  : 'border-[#1e1e1e]/10 bg-transparent hover:bg-[#1e1e1e]/5 text-[#111111]'
              }`}
            >
              Ungated Baseline
            </button>
          </div>
        </div>

        {/* Scenario Selector Strip */}
        {sourceMode === 'scenario' && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {SCENARIO_PRESETS.map((preset) => {
              const selected = preset.id === selectedScenarioId;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setSelectedScenarioId(preset.id)}
                  className={`text-left p-3 border transition-colors cursor-pointer ${
                    selected
                      ? 'bg-black text-white border-black'
                      : 'bg-white border-[#1e1e1e]/10 text-[#111111] hover:border-[#1e1e1e]/35'
                  }`}
                >
                  <p className="text-[11px] font-bold uppercase truncate">{preset.title}</p>
                  <p
                    className={`text-[10px] mt-0.5 truncate ${
                      selected ? 'text-[#b6b5b5]' : 'text-[#838282]'
                    }`}
                  >
                    {preset.category}
                  </p>
                </button>
              );
            })}
          </div>
        )}

        {sourceMode === 'upload' && (
          <div className="p-4 bg-white border border-[#1e1e1e]/10 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase text-[#111111]">
                Load Local Video Footage (.mp4, .webm, .mov)
              </p>
              <p className="text-[11px] text-[#838282] mt-0.5">
                Canvas samples frames live with active stress injectors applied.
              </p>
            </div>
            <label className="px-4 py-2 text-[11px] font-bold uppercase border border-[#1e1e1e] btn-invert cursor-pointer whitespace-nowrap">
              Choose Video
              <input
                type="file"
                accept="video/*"
                onChange={handleVideoFileUpload}
                className="hidden"
              />
            </label>
          </div>
        )}

        {mediaError && (
          <div className="p-3 bg-white border border-amber-600/40 text-xs text-amber-800">
            {mediaError}
          </div>
        )}

        {apiError && (
          <div
            role="alert"
            className="p-4 bg-white border border-red-600/50 flex items-start gap-3 text-xs text-red-900"
          >
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-bold uppercase">Pipeline Error</p>
              <p className="mt-0.5 text-red-800">{apiError}</p>
            </div>
            <button
              type="button"
              onClick={() => setApiError(null)}
              className="text-[10px] font-bold uppercase underline cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* E.2 Video Canvas Area (16:9 Aspect Ratio) */}
        <div className="relative aspect-video bg-gradient-to-br from-[#e8e8e8] to-[#f2f2f2] rounded-sm overflow-hidden border border-[#1e1e1e]/10">
          <video ref={videoRef} playsInline muted className="hidden" />

          {/* Optical Reticle Placeholder when live camera/upload not active yet */}
          {sourceMode !== 'scenario' && !cameraReady && (
            <div className="absolute inset-0 flex items-center justify-center opacity-20 pointer-events-none">
              <div className="w-32 h-32 border-2 border-dashed border-black rounded-full animate-pulse" />
              <div className="absolute w-full h-[1px] bg-black" />
              <div className="absolute h-full w-[1px] bg-black" />
            </div>
          )}

          <canvas
            ref={canvasRef}
            width={960}
            height={540}
            className="w-full h-full object-cover"
          />

          {/* Scrim & Telemetry (Bottom Overlay) */}
          <div className="absolute bottom-0 inset-x-0 h-32 scrim-bottom flex items-end justify-between p-6 pointer-events-none">
            <div className="flex items-center gap-4">
              {/* 8-Bar Cobalt Amplitude Meter */}
              <div className="flex gap-1 h-8 items-end">
                {AMPLITUDE_DELAYS.map((delay, idx) => (
                  <div
                    key={delay}
                    className={`w-1 bg-[#0052cc] ${isStreaming || micActive ? 'amplitude-bar' : ''}`}
                    style={
                      isStreaming || micActive
                        ? { animationDelay: delay }
                        : {
                            height: `${Math.max(
                              18,
                              Math.min(88, Math.round(audioLevel * 100 * (0.65 + (idx % 3) * 0.2))),
                            )}%`,
                          }
                    }
                  />
                ))}
              </div>
              <div className="text-white mono text-[10px] uppercase tracking-widest">
                16.0 kHz Mono ·{' '}
                {pipelineMode === 'gated' ? 'Gated Stream' : 'Ungated Baseline'}
              </div>
            </div>

            <div className="text-white mono text-[10px] uppercase tracking-widest">
              {isStreaming ? 'REC' : 'READY'} · {formattedClock} · {stressConfig.targetFps} FPS
              {mitigations.frameDedup && dedupSkippedCount > 0
                ? ` · DEDUP ${dedupSkippedCount}`
                : ''}
            </div>
          </div>
        </div>

        {/* E.3 Prompt Input with Mic Icon, Analyze Trigger & Loop Toggle */}
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-4 border border-[#1e1e1e]/20 p-4 bg-white rounded-sm">
          {sourceMode === 'camera' && micActive ? (
            <Mic className="w-5 h-5 text-[#0052cc] shrink-0" />
          ) : (
            <MicOff className="w-5 h-5 text-[#0052cc] shrink-0" />
          )}

          <input
            type="text"
            value={spokenHint}
            onChange={(e) => setSpokenHint(e.target.value)}
            aria-label="Spoken voice prompt or scenario transcript"
            placeholder="Describe the item you are holding..."
            className="flex-1 min-w-[180px] bg-transparent outline-none text-sm font-medium text-[#111111] placeholder:text-[#b6b5b5]"
          />

          <button
            type="button"
            onClick={() => analyzeFrameNow(false)}
            disabled={isAnalyzing}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#0052cc] text-white text-[11px] font-bold uppercase hover:opacity-90 disabled:opacity-60 transition-opacity whitespace-nowrap cursor-pointer"
          >
            {isAnalyzing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Zap className="w-3.5 h-3.5" />
            )}
            <span>{isAnalyzing ? 'Running' : 'Analyze Frame'}</span>
          </button>

          <button
            type="button"
            onClick={() => setIsStreaming((s) => !s)}
            aria-pressed={isStreaming}
            className="flex items-center gap-2 border-l pl-4 border-[#1e1e1e]/10 cursor-pointer shrink-0"
          >
            <span className="text-[10px] font-bold uppercase tracking-tighter text-[#111111]">
              Loop
            </span>
            <div
              className={`w-8 h-4 rounded-full relative flex items-center px-0.5 transition-colors ${
                isStreaming ? 'bg-[#0052cc]' : 'bg-black'
              }`}
            >
              <div
                className={`w-3 h-3 bg-white rounded-full transition-transform duration-150 ${
                  isStreaming ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </div>
          </button>
        </div>

        {/* E.4 Stress Control Grid (2 Columns) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 border-t border-[#1e1e1e]/10 pt-6">
          {/* LEFT: Stress Injector */}
          <div className="flex flex-col gap-4">
            <h4 className="clash-display text-sm font-bold uppercase text-[#111111]">
              Stress Injector
            </h4>

            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between items-end">
                  <span className="text-[10px] uppercase font-bold text-[#838282]">
                    Motion Blur
                  </span>
                  <span className="mono text-xs font-medium text-[#111111]">
                    {stressConfig.blurRadiusPx.toFixed(1)}px
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={14}
                  step={1}
                  value={stressConfig.blurRadiusPx}
                  onChange={(e) =>
                    onChangeStress({ ...stressConfig, blurRadiusPx: Number(e.target.value) })
                  }
                  className="custom-slider"
                />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-end">
                  <span className="text-[10px] uppercase font-bold text-[#838282]">
                    Acoustic Noise
                  </span>
                  <span className="mono text-xs font-medium text-[#111111]">
                    {Math.round(stressConfig.noiseMixLevel * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={stressConfig.noiseMixLevel}
                  onChange={(e) =>
                    onChangeStress({ ...stressConfig, noiseMixLevel: Number(e.target.value) })
                  }
                  className="custom-slider"
                />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-end">
                  <span className="text-[10px] uppercase font-bold text-[#838282]">
                    Low-Light Dimming
                  </span>
                  <span className="mono text-xs font-medium text-[#111111]">
                    {Math.round(stressConfig.lowLightDimming * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={0.8}
                  step={0.05}
                  value={stressConfig.lowLightDimming}
                  onChange={(e) =>
                    onChangeStress({ ...stressConfig, lowLightDimming: Number(e.target.value) })
                  }
                  className="custom-slider"
                />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-end">
                  <span className="text-[10px] uppercase font-bold text-[#838282]">
                    Stream Cadence
                  </span>
                  <span className="mono text-xs font-medium text-[#111111]">
                    {stressConfig.targetFps} FPS
                  </span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={4}
                  step={0.5}
                  value={stressConfig.targetFps}
                  onChange={(e) =>
                    onChangeStress({ ...stressConfig, targetFps: Number(e.target.value) })
                  }
                  className="custom-slider"
                />
              </div>
            </div>
          </div>

          {/* RIGHT: Mitigation Gate */}
          <div className="flex flex-col gap-4">
            <h4 className="clash-display text-sm font-bold uppercase text-[#111111]">
              Mitigation Gate
            </h4>

            <div className="grid grid-cols-1 gap-3">
              <button
                type="button"
                onClick={() =>
                  onChangeMitigations({ ...mitigations, blurGate: !mitigations.blurGate })
                }
                className="flex items-center gap-2.5 text-left cursor-pointer group"
              >
                <div className="w-3 h-3 border border-black flex items-center justify-center shrink-0">
                  {mitigations.blurGate && <div className="w-1.5 h-1.5 bg-black" />}
                </div>
                <span className="text-[10px] uppercase font-bold group-hover:text-[#0052cc]">
                  Decisions API Pre-Filtering
                </span>
              </button>

              <button
                type="button"
                onClick={() =>
                  onChangeMitigations({ ...mitigations, frameDedup: !mitigations.frameDedup })
                }
                className="flex items-center gap-2.5 text-left cursor-pointer group"
              >
                <div className="w-3 h-3 border border-black flex items-center justify-center shrink-0">
                  {mitigations.frameDedup && <div className="w-1.5 h-1.5 bg-black" />}
                </div>
                <span className="text-[10px] uppercase font-bold group-hover:text-[#0052cc]">
                  Luma Frame-Diff Deduplication
                </span>
              </button>

              <button
                type="button"
                onClick={() =>
                  onChangeMitigations({
                    ...mitigations,
                    confidenceHysteresis: !mitigations.confidenceHysteresis,
                  })
                }
                className="flex items-center gap-2.5 text-left cursor-pointer group"
              >
                <div className="w-3 h-3 border border-black flex items-center justify-center shrink-0">
                  {mitigations.confidenceHysteresis && <div className="w-1.5 h-1.5 bg-black" />}
                </div>
                <span className="text-[10px] uppercase font-bold group-hover:text-[#0052cc]">
                  Visual-Fit Rubric Sorting
                </span>
              </button>

              <div className="space-y-2 pt-2">
                <div className="flex justify-between items-end">
                  <span className="text-[10px] uppercase font-bold text-[#838282]">
                    Min Usability Gate
                  </span>
                  <span className="mono text-xs font-medium text-[#111111]">
                    {mitigations.minUsableProb.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min={0.3}
                  max={0.85}
                  step={0.05}
                  value={mitigations.minUsableProb}
                  onChange={(e) =>
                    onChangeMitigations({
                      ...mitigations,
                      minUsableProb: Number(e.target.value),
                    })
                  }
                  className="custom-slider"
                />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-end">
                  <span className="text-[10px] uppercase font-bold text-[#838282]">
                    Min Intent Gate
                  </span>
                  <span className="mono text-xs font-medium text-[#111111]">
                    {mitigations.minIntentProb.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min={0.3}
                  max={0.85}
                  step={0.05}
                  value={mitigations.minIntentProb}
                  onChange={(e) =>
                    onChangeMitigations({
                      ...mitigations,
                      minIntentProb: Number(e.target.value),
                    })
                  }
                  className="custom-slider"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* RIGHT SIDE: 5 columns (Insights & Commerce) */}
      <section className="col-span-12 lg:col-span-5 flex flex-col gap-8">
        {/* F.1 Inference Pipeline */}
        <div className="bg-white border border-[#1e1e1e]/10 p-6 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="clash-display text-xs font-bold uppercase tracking-widest text-[#838282]">
              Inference Pipeline
            </h3>
            {latestTrace && (
              <span className="mono text-[10px] text-[#838282]">
                TOTAL {latestTrace.totalLatencyMs}MS
              </span>
            )}
          </div>

          <div className="flex flex-col gap-4">
            <div className="pipeline-node flex items-center justify-between">
              <span className="text-[11px] uppercase font-bold text-[#111111]">
                01. Stream Triage · Hydrogen
              </span>
              <span
                className={`text-[10px] mono ${
                  isAnalyzing
                    ? 'text-[#0052cc]'
                    : latestTrace
                      ? 'text-green-700'
                      : 'text-[#838282]'
                }`}
              >
                {isAnalyzing
                  ? 'SCANNING...'
                  : latestTrace
                    ? `ACTIVE · ${latestTrace.hydrogen.latencyMs}MS`
                    : 'IDLE'}
              </span>
            </div>

            <div className="pipeline-node flex items-center justify-between">
              <span className="text-[11px] uppercase font-bold text-[#111111]">
                02. Probability Gate · Decisions
              </span>
              <span
                className={`text-[10px] mono font-bold ${
                  latestTrace?.decisionGate
                    ? latestTrace.decisionGate.passed
                      ? 'text-[#111111]'
                      : 'text-amber-700'
                    : 'text-[#838282]'
                }`}
              >
                {latestTrace?.mode === 'baseline'
                  ? 'BYPASSED'
                  : latestTrace?.decisionGate
                    ? `${latestTrace.decisionGate.passed ? 'PASS' : 'HELD'} · P=${latestTrace.decisionGate.frameUsableProb.toFixed(2)}`
                    : '0 TOKENS'}
              </span>
            </div>

            <div className="pipeline-node flex items-center justify-between">
              <span className="text-[11px] uppercase font-bold text-[#111111]">
                03. Spatial Synthesis · Neon
              </span>
              <span
                className={`text-[10px] mono ${
                  isAnalyzing
                    ? 'text-[#0052cc]'
                    : latestTrace?.neon
                      ? 'text-[#0052cc]'
                      : 'text-[#838282]'
                }`}
              >
                {isAnalyzing
                  ? 'RESOLVING...'
                  : latestTrace?.neon
                    ? `MATCHED · ${latestTrace.neon.latencyMs}MS`
                    : latestTrace?.status === 'held_by_gate'
                      ? 'SKIPPED'
                      : 'STANDBY'}
              </span>
            </div>
          </div>

          {latestTrace ? (
            <div className="pt-4 mt-1 border-t border-[#1e1e1e]/10 space-y-2 text-xs text-[#111111]">
              <p className="text-[11px] leading-relaxed">
                <span className="font-bold uppercase text-[#838282] mr-1.5">Cues:</span>
                {latestTrace.hydrogen.visualObjects.slice(0, 5).join(', ')}
                {latestTrace.hydrogen.materialsAndFinishes.length > 0 &&
                  ` (${latestTrace.hydrogen.materialsAndFinishes.slice(0, 3).join(', ')})`}
              </p>
              <p className="text-[11px] text-[#838282]">
                <span className="font-bold uppercase mr-1.5">Optics:</span>
                {latestTrace.hydrogen.lightingTone} · {latestTrace.hydrogen.blurOrOcclusionObserved}
              </p>
              {latestTrace.decisionGate?.holdReason && (
                <p className="text-[11px] font-bold text-amber-700">
                  {latestTrace.decisionGate.holdReason}
                </p>
              )}
              {latestTrace.neon && (
                <p className="text-[11px] leading-relaxed">
                  <span className="font-bold uppercase text-[#0052cc] mr-1.5">
                    Raw Media Delta:
                  </span>
                  {latestTrace.neon.whatRawMediaRevealed}
                </p>
              )}
            </div>
          ) : (
            <div className="pt-4 mt-1 border-t border-[#1e1e1e]/10 text-[11px] text-[#838282] leading-relaxed">
              {sourceMode === 'scenario'
                ? scenario.whatTextLoses
                : 'Point your camera at a space or object and click Analyze Frame or toggle Loop.'}
            </div>
          )}
        </div>

        {/* F.2 Shopify Matches (2-Column Grid) */}
        <div className="flex flex-col gap-4">
          <div className="flex justify-between items-end border-b border-[#1e1e1e]/10 pb-2">
            <h3 className="clash-display text-lg font-bold text-[#111111]">Shopify Matches</h3>
            <span className="text-[10px] font-bold uppercase text-[#838282]">
              {latestTrace?.products?.length
                ? `${latestTrace.products.length} Items · ${latestTrace.shopifyLatencyMs}ms`
                : 'Ranked by Visual Fit'}
            </span>
          </div>

          {latestTrace && latestTrace.products.length > 0 ? (
            <div className="grid grid-cols-2 gap-4">
              {latestTrace.products.slice(0, 4).map((product) => (
                <ProductCard key={product.id} product={product} onAddToBag={onAddToBag} />
              ))}
            </div>
          ) : (
            <div className="bg-white border border-[#1e1e1e]/10 p-6 text-center">
              <p className="text-[11px] font-bold uppercase text-[#111111]">
                {latestTrace?.status === 'held_by_gate'
                  ? 'Search Held by Decisions API'
                  : 'Awaiting Frame Analysis'}
              </p>
              <p className="text-[11px] text-[#838282] mt-1">
                {latestTrace?.status === 'held_by_gate'
                  ? 'Degraded frame or unconfirmed intent blocked upstream to prevent false triggers.'
                  : 'Click Analyze Frame or toggle Loop to query Shopify Global Catalog MCP.'}
              </p>
            </div>
          )}
        </div>

        {/* F.3 Recent Stream Events (Decision History) */}
        <div className="flex flex-col gap-4">
          <h3 className="clash-display text-xs font-bold uppercase tracking-widest text-[#838282]">
            Recent Stream Events
          </h3>

          <div className="flex flex-col border border-[#1e1e1e]/10 divide-y divide-[#1e1e1e]/10 bg-white">
            {traceHistory.length === 0 ? (
              <div className="p-4 text-[11px] text-[#838282]">
                No frames analyzed yet in this session.
              </div>
            ) : (
              traceHistory.slice(0, 5).map((item) => {
                const isHeld = item.status === 'held_by_gate';
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setLatestTrace(item)}
                    className="p-3 flex justify-between items-center gap-3 hover:bg-[#f9f9f9] transition-colors cursor-pointer text-left"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <img
                        src={item.thumbnailDataUrl}
                        alt={item.scenarioLabel}
                        className="w-8 h-6 object-cover bg-[#d9d9d9] shrink-0"
                      />
                      <div className="flex flex-col min-w-0">
                        <span className="text-[10px] font-bold uppercase text-[#111111]">
                          {isHeld
                            ? 'Motion / Noise Gated'
                            : item.mode === 'baseline'
                              ? 'Baseline Fired'
                              : 'Intent Matched'}
                        </span>
                        <span
                          className={`text-[9px] truncate ${
                            isHeld ? 'text-red-500' : 'text-[#838282]'
                          }`}
                        >
                          {isHeld
                            ? item.decisionGate?.routeChoice
                            : item.products[0]?.title || item.hydrogen.spokenTranscript}
                        </span>
                      </div>
                    </div>

                    <span className="mono text-[9px] text-[#838282] shrink-0">
                      {item.totalLatencyMs}ms
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
