import { ScenarioPreset, StressConfig } from '../types';

export function renderStressedFrameToCanvas(
  canvas: HTMLCanvasElement,
  source: HTMLImageElement | HTMLVideoElement,
  stress: StressConfig,
  tick: number,
  panPattern: ScenarioPreset['panPattern'] = 'slow-pan',
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const srcW =
    source instanceof HTMLVideoElement ? source.videoWidth || w : source.naturalWidth || w;
  const srcH =
    source instanceof HTMLVideoElement ? source.videoHeight || h : source.naturalHeight || h;

  const zoom = Math.max(1, stress.clutterCropZoom);
  const phase = tick * 0.04;

  let offsetX = 0;
  let offsetY = 0;
  if (panPattern === 'whip-pan') {
    offsetX = Math.sin(phase * 3.1) * (w * 0.035);
    offsetY = Math.cos(phase * 2.2) * (h * 0.015);
  } else if (panPattern === 'slow-pan') {
    offsetX = Math.sin(phase) * (w * 0.02);
  } else if (panPattern === 'rack-focus') {
    offsetX = Math.cos(phase * 1.4) * (w * 0.025);
    offsetY = Math.sin(phase * 1.1) * (h * 0.012);
  }

  const brightness = Math.max(0.2, 1 - stress.lowLightDimming);
  const blur = Math.max(0, stress.blurRadiusPx);
  ctx.filter = `blur(${blur.toFixed(1)}px) brightness(${brightness.toFixed(2)})`;

  const scale = Math.max(w / srcW, h / srcH) * zoom;
  const drawW = srcW * scale;
  const drawH = srcH * scale;
  const drawX = (w - drawW) / 2 + offsetX;
  const drawY = (h - drawH) / 2 + offsetY;

  ctx.drawImage(source, drawX, drawY, drawW, drawH);
  ctx.filter = 'none';

  // Simulate realistic motion smear ghosts on high blur
  if (blur >= 5) {
    ctx.save();
    ctx.globalAlpha = Math.min(0.32, blur * 0.025);
    ctx.drawImage(source, drawX + blur * 2.2, drawY, drawW, drawH);
    ctx.restore();
  }
}

export function computeFrameLumaDelta(
  prevData: Uint8ClampedArray | null,
  canvas: HTMLCanvasElement,
): { deltaRatio: number; snapshot: Uint8ClampedArray } {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { deltaRatio: 1, snapshot: new Uint8ClampedArray(0) };

  const w = canvas.width;
  const h = canvas.height;
  const imgData = ctx.getImageData(0, 0, w, h).data;
  // Subsample every 32nd pixel for instant comparison
  const sampleCount = Math.floor(imgData.length / (4 * 32));
  const snapshot = new Uint8ClampedArray(sampleCount);
  let diffSum = 0;

  for (let i = 0; i < sampleCount; i++) {
    const idx = i * 4 * 32;
    const luma = Math.round(
      0.299 * imgData[idx] + 0.587 * imgData[idx + 1] + 0.114 * imgData[idx + 2],
    );
    snapshot[i] = luma;
    if (prevData && prevData.length === sampleCount) {
      diffSum += Math.abs(luma - prevData[i]) / 255;
    }
  }

  if (!prevData || prevData.length !== sampleCount) {
    return { deltaRatio: 1, snapshot };
  }
  return { deltaRatio: diffSum / sampleCount, snapshot };
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

export function encodeFloat32ToWavBase64(samples: Float32Array, sampleRate = 16000): string {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Generates a real 16kHz mono WAV clip mixing modulated vocal-band formants
 * with controllable broadband + babble noise for deterministic SNR stress tests.
 */
export function synthesizeStressAudioWav(
  durationSec: number,
  noiseMixLevel: number,
  hasSpokenIntent: boolean,
): string {
  const sampleRate = 16000;
  const len = Math.floor(sampleRate * durationSec);
  const samples = new Float32Array(len);

  const signalAmp = hasSpokenIntent ? Math.max(0.05, 0.45 * (1 - noiseMixLevel * 0.65)) : 0;
  const noiseAmp = Math.min(0.85, 0.02 + noiseMixLevel * 0.72);

  for (let i = 0; i < len; i++) {
    const t = i / sampleRate;
    // Modulated speech-like cadence envelope
    const syllableEnv = 0.5 + 0.5 * Math.sin(2 * Math.PI * 3.4 * t);
    const voice =
      signalAmp *
      syllableEnv *
      (0.6 * Math.sin(2 * Math.PI * 190 * t) +
        0.3 * Math.sin(2 * Math.PI * 440 * t) +
        0.1 * Math.sin(2 * Math.PI * 980 * t));

    // Ambient chatter + white static mix
    const chatter =
      noiseAmp *
      0.4 *
      (Math.sin(2 * Math.PI * 310 * t + Math.sin(t * 9)) +
        Math.sin(2 * Math.PI * 520 * t + Math.cos(t * 7)));
    const white = noiseAmp * 0.6 * (Math.random() * 2 - 1);

    samples[i] = Math.max(-0.98, Math.min(0.98, voice + chatter + white));
  }

  return encodeFloat32ToWavBase64(samples, sampleRate);
}
