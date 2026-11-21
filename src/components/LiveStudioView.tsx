import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Film,
  Loader2,
  Mic,
  MicOff,
  Pause,
  Play,
  ShieldAlert,
  Sparkles,
  Upload,
  Zap,
} from 'lucide-react';
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

  const [latestTrace, setLatestTrace] = useState<PipelineTrace | null>(null);
  const [traceHistory, setTraceHistory] = useState<PipelineTrace[]>([]);
  const [audioLevel, setAudioLevel] = useState<number>(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const tickRef = useRef(0);
  const prevLumaRef = useRef<Uint8ClampedArray | null>(null);
  const inFlightRef = useRef(false);

  // Live Mic PCM ring buffer
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

  // Load scenario image
  useEffect(() => {
    if (sourceMode !== 'scenario') return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = scenario.imagePath;
    img.onload = () => {
      imgRef.current = img;
    };
  }, [scenario.imagePath, sourceMode]);

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

  // Continuous 30fps preview render loop onto canvas with stress transforms
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

      // Frame-diff deduplication mitigation when streaming continuously
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

        // Automatically capture notable gate holds or baseline blur triggers into Failure Log
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

  // Continuous loop timer driven by targetFps
  useEffect(() => {
    if (!isStreaming) return;
    const intervalMs = Math.max(250, Math.round(1000 / Math.max(0.5, stressConfig.targetFps)));
    const timer = setInterval(() => {
      analyzeFrameNow(true);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [isStreaming, stressConfig.targetFps, analyzeFrameNow]);

  return (
    <div className="max-w-[1440px] mx-auto px-6 py-8 space-y-8">
      {/* Workspace Header & Source Controls */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pb-6 border-b border-neutral-200">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-neutral-950 text-balance">
            Live Vision-to-Commerce Studio
          </h1>
          <p className="text-sm text-neutral-600 mt-1.5 max-w-2xl leading-relaxed">
            Streams raw video frames and audio through Gemini 4 Hydrogen, zero-token Decisions API
            gating, Gemini 4 Neon spatial synthesis, and Shopify Global Catalog MCP.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Source Mode Segmented Control */}
          <div className="flex items-center p-1 bg-neutral-100 rounded-lg border border-neutral-200">
            <button
              type="button"
              onClick={() => setSourceMode('scenario')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                sourceMode === 'scenario'
                  ? 'bg-white text-neutral-950 shadow-xs'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              <Film className="w-3.5 h-3.5" />
              <span>Scenario Stream</span>
            </button>
            <button
              type="button"
              onClick={() => setSourceMode('camera')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                sourceMode === 'camera'
                  ? 'bg-white text-neutral-950 shadow-xs'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              <Camera className="w-3.5 h-3.5" />
              <span>Live Camera + Mic</span>
            </button>
            <button
              type="button"
              onClick={() => setSourceMode('upload')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                sourceMode === 'upload'
                  ? 'bg-white text-neutral-950 shadow-xs'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Upload Video</span>
            </button>
          </div>

          {/* Pipeline Architecture Toggle */}
          <div className="flex items-center p-1 bg-neutral-100 rounded-lg border border-neutral-200">
            <button
              type="button"
              onClick={() => setPipelineMode('gated')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                pipelineMode === 'gated'
                  ? 'bg-white text-blue-700 shadow-xs'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              Element 119 Gated
            </button>
            <button
              type="button"
              onClick={() => setPipelineMode('baseline')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                pipelineMode === 'baseline'
                  ? 'bg-white text-amber-700 shadow-xs'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              Ungated Baseline
            </button>
          </div>
        </div>
      </div>

      {apiError && (
        <div
          role="alert"
          className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 text-sm text-red-900"
        >
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold">Pipeline Error</p>
            <p className="text-red-800 mt-0.5">{apiError}</p>
          </div>
          <button
            type="button"
            onClick={() => setApiError(null)}
            className="text-xs font-medium text-red-700 hover:underline cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main 12-Column Split Studio */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Live Video Canvas + Audio + Stress Controls (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          {/* Scenario Selector or Upload Picker */}
          {sourceMode === 'scenario' && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {SCENARIO_PRESETS.map((preset) => {
                const selected = preset.id === selectedScenarioId;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setSelectedScenarioId(preset.id)}
                    className={`text-left p-3 rounded-xl border transition-colors cursor-pointer ${
                      selected
                        ? 'bg-white border-blue-700 text-neutral-950'
                        : 'bg-neutral-50 border-neutral-200 text-neutral-600 hover:bg-white hover:text-neutral-900'
                    }`}
                  >
                    <p className="text-xs font-semibold line-clamp-1">{preset.title}</p>
                    <p className="text-[11px] text-neutral-500 mt-0.5 line-clamp-1">
                      {preset.category}
                    </p>
                  </button>
                );
              })}
            </div>
          )}

          {sourceMode === 'upload' && (
            <div className="p-4 bg-white border border-neutral-200 rounded-xl flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-neutral-900">
                  Load local video footage (.mp4, .webm, .mov)
                </p>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Frames are sampled live from the canvas with your active stress settings applied.
                </p>
              </div>
              <label className="px-4 py-2 text-xs font-medium text-white bg-neutral-900 hover:bg-neutral-800 rounded-lg cursor-pointer whitespace-nowrap">
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
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">
              {mediaError}
            </div>
          )}

          {/* Live Video + Canvas Viewport */}
          <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
            <div className="relative aspect-[16/9] bg-neutral-950">
              <video ref={videoRef} playsInline muted className="hidden" />
              <canvas
                ref={canvasRef}
                width={960}
                height={540}
                className="w-full h-full object-cover"
              />

              {/* Subtle measured scrim only at bottom edge for stream telemetry */}
              <div className="absolute inset-x-0 bottom-0 px-4 py-3 bg-gradient-to-t from-black/80 via-black/40 to-transparent flex items-center justify-between text-white text-xs">
                <div className="flex items-center gap-2 font-mono tabular-nums">
                  {isStreaming && (
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  )}
                  <span>
                    {sourceMode === 'scenario'
                      ? scenario.title
                      : sourceMode === 'camera'
                        ? cameraReady
                          ? 'Webcam Feed Active'
                          : 'Awaiting Camera'
                        : 'Uploaded Video'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{stressConfig.targetFps} FPS</span>
                  <span aria-hidden="true">·</span>
                  <span>Blur {stressConfig.blurRadiusPx}px</span>
                </div>

                {mitigations.frameDedup && dedupSkippedCount > 0 && (
                  <span className="font-mono text-neutral-300 tabular-nums">
                    Dedup skipped: {dedupSkippedCount}
                  </span>
                )}
              </div>
            </div>

            {/* Acoustic Waveform + Spoken Intent Strip */}
            <div className="p-4 border-t border-neutral-200 space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 text-xs text-neutral-600">
                  {sourceMode === 'camera' && micActive ? (
                    <Mic className="w-4 h-4 text-blue-700" />
                  ) : (
                    <MicOff className="w-4 h-4 text-neutral-400" />
                  )}
                  <span className="font-medium text-neutral-900">
                    {sourceMode === 'camera' && micActive
                      ? 'Live Microphone Capture (16kHz WAV)'
                      : `Acoustic Stress Stream · ${Math.round(stressConfig.noiseMixLevel * 100)}% noise floor`}
                  </span>
                </div>

                {/* Live Audio Amplitude Meter */}
                <div className="flex items-center gap-1 h-4" aria-hidden="true">
                  {Array.from({ length: 16 }).map((_, idx) => {
                    const active = audioLevel * 16 > idx;
                    return (
                      <span
                        key={idx}
                        className={`w-1 rounded-sm transition-all duration-75 ${
                          active
                            ? idx > 12
                              ? 'h-4 bg-amber-600'
                              : 'h-3.5 bg-blue-700'
                            : 'h-1.5 bg-neutral-200'
                        }`}
                      />
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-2.5">
                <input
                  type="text"
                  value={spokenHint}
                  onChange={(e) => setSpokenHint(e.target.value)}
                  aria-label="Spoken voice prompt or scenario transcript"
                  placeholder="Spoken intent or voice prompt..."
                  className="flex-1 px-3 py-2 text-sm bg-neutral-50 border border-neutral-200 rounded-lg focus:outline-none focus:border-blue-700"
                />
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => analyzeFrameNow(false)}
                    disabled={isAnalyzing}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                  >
                    {isAnalyzing ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Zap className="w-4 h-4" />
                    )}
                    <span>Analyze Frame</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsStreaming((s) => !s)}
                    className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg border transition-colors whitespace-nowrap cursor-pointer ${
                      isStreaming
                        ? 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
                        : 'bg-white text-neutral-800 border-neutral-200 hover:bg-neutral-50'
                    }`}
                  >
                    {isStreaming ? (
                      <>
                        <Pause className="w-4 h-4" />
                        <span>Stop Loop</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4" />
                        <span>Start Loop</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Stress Injectors & Pipeline Mitigations Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-white border border-neutral-200 rounded-xl p-5">
            <div className="space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-neutral-900">
                  Real-World Input Stressors
                </h2>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Degrade live video &amp; audio to locate breaking thresholds.
                </p>
              </div>

              <label className="block space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-neutral-700">Motion Blur</span>
                  <span className="font-mono tabular-nums text-neutral-900">
                    {stressConfig.blurRadiusPx} px
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
                  className="w-full accent-blue-700"
                />
              </label>

              <label className="block space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-neutral-700">Acoustic Noise Floor</span>
                  <span className="font-mono tabular-nums text-neutral-900">
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
                  className="w-full accent-blue-700"
                />
              </label>

              <label className="block space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-neutral-700">Low-Light Dimming</span>
                  <span className="font-mono tabular-nums text-neutral-900">
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
                  className="w-full accent-blue-700"
                />
              </label>

              <label className="block space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-neutral-700">Stream Cadence</span>
                  <span className="font-mono tabular-nums text-neutral-900">
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
                  className="w-full accent-blue-700"
                />
              </label>
            </div>

            <div className="space-y-4 md:border-l md:border-neutral-200 md:pl-6">
              <div>
                <h2 className="text-sm font-semibold text-neutral-900">
                  Architectural Mitigations
                </h2>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Toggle Decisions API &amp; stream safeguards live.
                </p>
              </div>

              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={mitigations.blurGate}
                  onChange={(e) =>
                    onChangeMitigations({ ...mitigations, blurGate: e.target.checked })
                  }
                  className="mt-0.5 accent-blue-700"
                />
                <span className="text-xs text-neutral-700 leading-relaxed">
                  <strong className="font-medium text-neutral-900">Decisions API Pre-Gate</strong>
                  <br />
                  Short-circuits blurry frames &amp; background chatter before Gemini 4 Neon runs.
                </span>
              </label>

              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={mitigations.frameDedup}
                  onChange={(e) =>
                    onChangeMitigations({ ...mitigations, frameDedup: e.target.checked })
                  }
                  className="mt-0.5 accent-blue-700"
                />
                <span className="text-xs text-neutral-700 leading-relaxed">
                  <strong className="font-medium text-neutral-900">Luma Frame-Diff Dedup</strong>
                  <br />
                  Skips static frames during high-FPS bursts to avoid queue congestion.
                </span>
              </label>

              <label className="block space-y-1 pt-1">
                <div className="flex justify-between text-xs">
                  <span className="text-neutral-700">Min Frame Usability Gate</span>
                  <span className="font-mono tabular-nums text-neutral-900">
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
                  className="w-full accent-blue-700"
                />
              </label>

              <label className="block space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-neutral-700">Min Acoustic Intent Gate</span>
                  <span className="font-mono tabular-nums text-neutral-900">
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
                  className="w-full accent-blue-700"
                />
              </label>
            </div>
          </div>
        </div>

        {/* Right Column: 3-Stage Pipeline Trace + Shopify Catalog Matches (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white border border-neutral-200 rounded-xl divide-y divide-neutral-200">
            <div className="p-4 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-neutral-900">
                  Multimodal Execution Trace
                </h2>
                <p className="text-xs text-neutral-500 mt-0.5">
                  {latestTrace
                    ? `${latestTrace.mode === 'gated' ? 'Element 119 Pipeline' : 'Ungated Baseline'} · Total ${latestTrace.totalLatencyMs}ms`
                    : 'Click Analyze Frame or Start Loop to run live'}
                </p>
              </div>
              {latestTrace && (
                <span
                  className={`inline-flex items-center gap-1 text-xs font-medium ${
                    latestTrace.status === 'matched'
                      ? 'text-emerald-700'
                      : latestTrace.status === 'held_by_gate'
                        ? 'text-amber-700'
                        : 'text-neutral-600'
                  }`}
                >
                  {latestTrace.status === 'matched' ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : (
                    <ShieldAlert className="w-4 h-4" />
                  )}
                  <span>
                    {latestTrace.status === 'matched'
                      ? 'Matched'
                      : latestTrace.status === 'held_by_gate'
                        ? 'Held by Gate'
                        : 'No Matches'}
                  </span>
                </span>
              )}
            </div>

            {!latestTrace ? (
              <div className="p-8 text-center space-y-2">
                <Sparkles className="w-8 h-8 text-neutral-300 mx-auto" />
                <p className="text-sm font-medium text-neutral-900">
                  Ready for live multimodal analysis
                </p>
                <p className="text-xs text-neutral-500 max-w-sm mx-auto leading-relaxed">
                  {sourceMode === 'scenario'
                    ? scenario.whatTextLoses
                    : 'Point your camera at a room or product and ask what fits the space.'}
                </p>
              </div>
            ) : (
              <>
                {/* Stage 1: Hydrogen */}
                <div className="p-4 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-neutral-900">
                      01. Gemini 4 Hydrogen · Stream Triage
                    </span>
                    <span className="font-mono text-neutral-500 tabular-nums">
                      {latestTrace.hydrogen.latencyMs}ms
                    </span>
                  </div>
                  <p className="text-xs text-neutral-600 leading-relaxed">
                    <strong className="font-medium text-neutral-800">Cues:</strong>{' '}
                    {latestTrace.hydrogen.visualObjects.slice(0, 5).join(', ')}
                    {latestTrace.hydrogen.materialsAndFinishes.length > 0 &&
                      ` (${latestTrace.hydrogen.materialsAndFinishes.slice(0, 3).join(', ')})`}
                  </p>
                  <p className="text-xs text-neutral-600">
                    <strong className="font-medium text-neutral-800">Lighting &amp; Blur:</strong>{' '}
                    {latestTrace.hydrogen.lightingTone} · {latestTrace.hydrogen.blurOrOcclusionObserved}
                  </p>
                  <p className="text-xs text-neutral-600">
                    <strong className="font-medium text-neutral-800">Audio:</strong> “
                    {latestTrace.hydrogen.spokenTranscript}” ·{' '}
                    {latestTrace.hydrogen.acousticNoiseAssessment}
                  </p>
                </div>

                {/* Stage 2: Decisions API */}
                {latestTrace.decisionGate && (
                  <div className="p-4 space-y-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-neutral-900">
                        02. Decisions API (gemini-decision-1) · 0 Output Tokens
                      </span>
                      <span className="font-mono text-neutral-500 tabular-nums">
                        {latestTrace.decisionGate.gateLatencyMs}ms
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-3 text-xs">
                      <div>
                        <span className="text-neutral-500 block">Frame Usable</span>
                        <span className="font-mono font-semibold text-neutral-900 tabular-nums">
                          {(latestTrace.decisionGate.frameUsableProb * 100).toFixed(0)}%
                        </span>
                      </div>
                      <div>
                        <span className="text-neutral-500 block">Intent Confirmed</span>
                        <span className="font-mono font-semibold text-neutral-900 tabular-nums">
                          {(latestTrace.decisionGate.intentConfirmedProb * 100).toFixed(0)}%
                        </span>
                      </div>
                      <div>
                        <span className="text-neutral-500 block">Clutter Index</span>
                        <span className="font-mono font-semibold text-neutral-900 tabular-nums">
                          {(latestTrace.decisionGate.clutterScoreNormalized * 100).toFixed(0)}%
                        </span>
                      </div>
                    </div>

                    <div className="text-xs text-neutral-600">
                      Route choice:{' '}
                      <span className="font-mono font-medium text-neutral-900">
                        {latestTrace.decisionGate.routeChoice}
                      </span>
                      {latestTrace.decisionGate.holdReason && (
                        <p className="mt-1 text-amber-800 font-medium">
                          {latestTrace.decisionGate.holdReason}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Stage 3: Neon */}
                {latestTrace.neon && (
                  <div className="p-4 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-neutral-900">
                        03. Gemini 4 Neon · Spatial-Acoustic Synthesis
                      </span>
                      <span className="font-mono text-neutral-500 tabular-nums">
                        {latestTrace.neon.latencyMs}ms
                      </span>
                    </div>
                    <p className="text-xs text-neutral-700 leading-relaxed">
                      <strong className="font-medium text-neutral-900">
                        Lost in Text, Found in Raw Media:
                      </strong>{' '}
                      {latestTrace.neon.whatRawMediaRevealed}
                    </p>
                    <p className="text-xs text-neutral-600">
                      <strong className="font-medium text-neutral-800">Shopify Queries:</strong>{' '}
                      <span className="font-mono text-blue-800">
                        {latestTrace.neon.searchQueries.join(' | ')}
                      </span>
                    </p>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Live Shopify Matched Products */}
          {latestTrace && latestTrace.products.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-neutral-900">
                  Live Shopify Catalog Matches
                </h2>
                <span className="font-mono text-xs text-neutral-500 tabular-nums">
                  {latestTrace.products.length} items · MCP {latestTrace.shopifyLatencyMs}ms
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {latestTrace.products.slice(0, 4).map((product) => (
                  <ProductCard key={product.id} product={product} onAddToBag={onAddToBag} />
                ))}
              </div>
            </div>
          )}

          {/* Compact Trace History */}
          {traceHistory.length > 1 && (
            <div className="bg-white border border-neutral-200 rounded-xl p-4 space-y-2">
              <h3 className="text-xs font-semibold text-neutral-900">Recent Frame Decisions</h3>
              <div className="divide-y divide-neutral-100">
                {traceHistory.slice(0, 5).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setLatestTrace(item)}
                    className="w-full py-2 flex items-center justify-between gap-2 text-left text-xs hover:bg-neutral-50 px-1 rounded cursor-pointer"
                  >
                    <span className="truncate text-neutral-800 font-medium">
                      {item.mode === 'baseline' ? 'Baseline' : 'Gated'} ·{' '}
                      {item.status === 'held_by_gate'
                        ? item.decisionGate?.routeChoice
                        : item.products[0]?.title || 'No match'}
                    </span>
                    <span className="font-mono text-neutral-500 tabular-nums shrink-0">
                      {item.totalLatencyMs}ms
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
