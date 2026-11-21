export type AppView = 'live' | 'benchmark' | 'catalog' | 'failures';

export type MediaSourceMode = 'scenario' | 'camera' | 'upload';

export interface StressConfig {
  targetFps: number;
  blurRadiusPx: number;
  noiseMixLevel: number; // 0 (clean) to 1 (heavy ambient chatter + static)
  lowLightDimming: number; // 0 (normal) to 0.8 (dark)
  clutterCropZoom: number; // 1.0 (full) to 1.6 (tight crop)
}

export interface MitigationConfig {
  blurGate: boolean;
  confidenceHysteresis: boolean;
  frameDedup: boolean;
  minUsableProb: number;
  minIntentProb: number;
}

export interface ScenarioPreset {
  id: string;
  title: string;
  category: string;
  imagePath: string;
  spokenPrompt: string;
  noisyBackgroundHint: string;
  panPattern: 'slow-pan' | 'whip-pan' | 'rack-focus' | 'low-light-scan';
  whatTextLoses: string;
}

export interface DecisionGateResult {
  frameUsableProb: number;
  frameUsableConfidence: number;
  intentConfirmedProb: number;
  intentConfidence: number;
  routeChoice: 'proceed_commerce' | 'hold_blurry_frame' | 'hold_noisy_audio' | 'ask_clarification';
  routeProbabilities: Record<string, number>;
  clutterScoreNormalized: number;
  clutterLabel: string;
  gateLatencyMs: number;
  passed: boolean;
  holdReason?: string;
}

export interface HydrogenPerception {
  visualObjects: string[];
  materialsAndFinishes: string[];
  lightingTone: string;
  blurOrOcclusionObserved: string;
  spokenTranscript: string;
  acousticNoiseAssessment: string;
  quickSearchQuery?: string;
  latencyMs: number;
}

export interface NeonSynthesis {
  targetNeedSummary: string;
  whatRawMediaRevealed: string;
  spatialAndAcousticReasoning: string;
  searchQueries: string[];
  recommendedMaxPriceUsd?: number;
  latencyMs: number;
}

export interface CatalogProduct {
  id: string;
  variantId?: string;
  title: string;
  merchantName: string;
  merchantDomain?: string;
  priceAmountCents: number;
  currency: string;
  imageUrl?: string;
  productUrl?: string;
  checkoutUrl?: string;
  variantTitle?: string;
  available: boolean;
  descriptionSnippet: string;
  fitScoreNormalized?: number;
  fitLabel?: string;
  fitConfidence?: number;
  visualFitVerifiedProb?: number;
}

export interface PipelineTrace {
  id: string;
  timestamp: string;
  mode: 'baseline' | 'gated';
  scenarioLabel: string;
  thumbnailDataUrl: string;
  stressConfig: StressConfig;
  hydrogen: HydrogenPerception;
  decisionGate?: DecisionGateResult;
  neon?: NeonSynthesis;
  shopifyLatencyMs: number;
  totalLatencyMs: number;
  triggeredSearch: boolean;
  products: CatalogProduct[];
  status: 'matched' | 'held_by_gate' | 'no_products' | 'error';
  errorMessage?: string;
}

export type BenchmarkDimension = 'blur_motion' | 'acoustic_snr' | 'cadence_burst';

export interface BenchmarkStepResult {
  stepIndex: number;
  stepLabel: string;
  stressValue: number;
  stressUnit: string;
  baseline: {
    latencyMs: number;
    triggeredSearch: boolean;
    hallucinatedOrLowQuality: boolean;
    topProductTitle: string | null;
    summary: string;
  };
  gated: {
    latencyMs: number;
    gateLatencyMs: number;
    frameUsableProb: number;
    intentProb: number;
    clutterScore: number;
    routeChoice: string;
    passedGate: boolean;
    topProductTitle: string | null;
    topFitScore: number | null;
    brokeHere: boolean;
    breakReason?: string;
  };
}

export interface FailureRecord {
  id: string;
  timestamp: string;
  dimension: string;
  triggerLabel: string;
  thumbnailDataUrl: string;
  observedFailure: string;
  architecturalFix: string;
  mitigationKey: keyof MitigationConfig;
  baselineStatus: string;
  gatedStatus: string;
}

export interface BagItem {
  product: CatalogProduct;
  quantity: number;
}
