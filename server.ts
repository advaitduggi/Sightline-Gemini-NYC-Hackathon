import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, MediaResolution, ThinkingLevel, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const SHOPIFY_GLOBAL_MCP = 'https://catalog.shopify.com/api/ucp/mcp';
const UCP_AGENT_PROFILE =
  'https://shopify.dev/ucp/agent-profiles/examples/2026-08-25/valid-with-capabilities.json';

function getGeminiClients() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw Object.assign(
      new Error('GEMINI_API_KEY is not configured in environment secrets.'),
      { status: 500, code: 'MISSING_API_KEY' },
    );
  }
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
  });
  const decisionsAi = new GoogleGenAI({
    apiKey,
    apiVersion: 'v1beta',
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
  });
  return { ai, decisionsAi };
}

function stripDataUrlPrefix(b64: string): string {
  const idx = b64.indexOf(',');
  return idx >= 0 ? b64.slice(idx + 1) : b64;
}

function redactSecrets(text: string): string {
  return text
    .replace(/(AIza[0-9A-Za-z_-]{10,}|ghp_[0-9A-Za-z]{10,}|github_pat_[0-9A-Za-z_]{10,})/g, '[REDACTED]')
    .replace(/Bearer\s+[0-9A-Za-z._-]+/gi, 'Bearer [REDACTED]');
}

function formatGeminiError(err: unknown): { status: number; message: string; code?: string } {
  const anyErr = err as { status?: number; message?: string; code?: string };
  const rawMsg = anyErr?.message || 'Unknown upstream model error';
  const msg = redactSecrets(rawMsg);
  const status = typeof anyErr?.status === 'number' && anyErr.status >= 400 && anyErr.status < 600
    ? anyErr.status
    : 500;
  if (msg.includes('403') || msg.includes('PERMISSION_DENIED')) {
    return {
      status: 403,
      code: 'PERMISSION_DENIED',
      message: 'API key permission denied. Check your key in Settings > Secrets.',
    };
  }
  if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
    return {
      status: 429,
      code: 'RESOURCE_EXHAUSTED',
      message:
        'Quota exhausted or paid-tier model limit reached. Select a billing-enabled API key in Settings > Secrets.',
    };
  }
  return { status, message: msg, code: anyErr?.code };
}

function validateExternalMcpUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw Object.assign(new Error('Invalid Storefront MCP URL.'), { status: 400, code: 'INVALID_URL' });
  }
  if (parsed.protocol !== 'https:') {
    throw Object.assign(new Error('Storefront MCP URL must use HTTPS.'), { status: 400, code: 'INVALID_PROTOCOL' });
  }
  const host = parsed.hostname.toLowerCase();
  const isPrivateHost =
    host === 'localhost' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ||
    /^(fc|fd|fe80)/i.test(host);
  if (isPrivateHost) {
    throw Object.assign(new Error('Private or loopback MCP hosts are not allowed.'), {
      status: 400,
      code: 'BLOCKED_HOST',
    });
  }
  return parsed.toString();
}

interface RawShopifyProduct {
  id: string;
  title: string;
  description?: { plain?: string };
  price_range?: {
    min?: { amount?: number; currency?: string };
    max?: { amount?: number; currency?: string };
  };
  media?: Array<{ type?: string; url?: string; alt_text?: string }>;
  variants?: Array<{
    id?: string;
    title?: string;
    price?: { amount?: number; currency?: string };
    url?: string;
    checkout_url?: string;
    availability?: { available?: boolean };
    seller?: { name?: string; domain?: string; url?: string };
    media?: Array<{ type?: string; url?: string }>;
  }>;
}

function stripHtmlTags(raw: string): string {
  return raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function searchShopifyMcp(
  query: string,
  options?: {
    limit?: number;
    maxPriceUsd?: number;
    storefrontMcpUrl?: string;
    intentContext?: string;
  },
) {
  const t0 = Date.now();
  const limit = Math.min(Math.max(options?.limit ?? 6, 1), 12);
  const customUrl = options?.storefrontMcpUrl?.trim();
  const endpoint = customUrl ? validateExternalMcpUrl(customUrl) : SHOPIFY_GLOBAL_MCP;

  const isCustomStorefront = Boolean(customUrl && endpoint !== SHOPIFY_GLOBAL_MCP);

  const payload = isCustomStorefront
    ? {
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: {
          name: 'search_shop_catalog',
          arguments: {
            query,
            context: options?.intentContext || 'Live multimodal shopping query',
          },
        },
      }
    : {
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: {
          name: 'search_catalog',
          arguments: {
            meta: { 'ucp-agent': { profile: UCP_AGENT_PROFILE } },
            catalog: {
              query,
              context: {
                address_country: 'US',
                currency: 'USD',
                language: 'en-US',
                ...(options?.intentContext ? { intent: options.intentContext } : {}),
              },
              ...(options?.maxPriceUsd && options.maxPriceUsd > 0
                ? {
                    filters: {
                      available: true,
                      price: { max: Math.round(options.maxPriceUsd * 100) },
                    },
                  }
                : { filters: { available: true } }),
              pagination: { limit },
            },
          },
        },
      };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(12000),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Shopify MCP HTTP ${res.status}: ${body.slice(0, 240)}`);
  }

  const rawText = await res.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(rawText);
  } catch {
    // Handle SSE response if a storefront MCP returns text/event-stream
    const dataLine = rawText
      .split('\n')
      .find((line) => line.startsWith('data:'))
      ?.slice(5)
      .trim();
    if (!dataLine) {
      throw new Error(`Unexpected Shopify MCP response: ${rawText.slice(0, 200)}`);
    }
    json = JSON.parse(dataLine);
  }

  if (json.error) {
    const errObj = json.error as { message?: string; data?: { content?: string } };
    throw new Error(errObj.data?.content || errObj.message || 'Shopify MCP returned error');
  }

  const result = json.result as {
    structuredContent?: { products?: RawShopifyProduct[] };
    content?: Array<{ type?: string; text?: string }>;
  };

  let rawProducts: RawShopifyProduct[] = result?.structuredContent?.products || [];
  if (rawProducts.length === 0 && result?.content?.length) {
    for (const part of result.content) {
      if (part.text) {
        try {
          const parsed = JSON.parse(part.text);
          if (Array.isArray(parsed.products)) {
            rawProducts = parsed.products;
            break;
          }
        } catch {
          // ignore non-json text
        }
      }
    }
  }

  const products = rawProducts.slice(0, limit).map((p) => {
    const firstVar = p.variants?.[0];
    const priceCents =
      firstVar?.price?.amount ?? p.price_range?.min?.amount ?? p.price_range?.max?.amount ?? 0;
    const currency =
      firstVar?.price?.currency ?? p.price_range?.min?.currency ?? 'USD';
    const imageUrl = p.media?.[0]?.url || firstVar?.media?.[0]?.url;
    return {
      id: p.id,
      variantId: firstVar?.id,
      title: p.title,
      merchantName: firstVar?.seller?.name || 'Shopify Merchant',
      merchantDomain: firstVar?.seller?.domain,
      priceAmountCents: priceCents,
      currency,
      imageUrl,
      productUrl: firstVar?.url,
      checkoutUrl: firstVar?.checkout_url || firstVar?.url,
      variantTitle: firstVar?.title,
      available: firstVar?.availability?.available ?? true,
      descriptionSnippet: stripHtmlTags(p.description?.plain || '').slice(0, 180),
    };
  });

  return {
    products,
    latencyMs: Date.now() - t0,
    endpoint,
  };
}

async function runFastAudioTranscribe(
  ai: GoogleGenAI,
  audioBase64: string,
  audioMimeType?: string,
): Promise<{ transcript: string; noiseNote: string; latencyMs: number }> {
  const t0 = Date.now();
  const resp = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: audioMimeType || 'audio/wav',
            data: stripDataUrlPrefix(audioBase64),
          },
        },
        {
          text: 'Transcribe all spoken words verbatim from this audio clip. If no intelligible speech is present, return an empty string for transcript and describe the sound in noiseNote.',
        },
      ] as never,
    },
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          transcript: { type: Type.STRING },
          noiseNote: { type: Type.STRING },
        },
        required: ['transcript', 'noiseNote'],
      },
    },
  });
  const parsed = JSON.parse((resp.text || '{}').trim());
  return {
    transcript: (parsed.transcript || '').trim(),
    noiseNote: (parsed.noiseNote || 'Audio analyzed').trim(),
    latencyMs: Date.now() - t0,
  };
}

async function runHydrogenPerception(
  ai: GoogleGenAI,
  imageBase64: string,
  imageMimeType: string,
  audioBase64?: string,
  audioMimeType?: string,
  spokenTranscriptHint?: string,
) {
  const t0 = Date.now();
  const parts: Array<Record<string, unknown>> = [
    {
      inlineData: {
        mimeType: imageMimeType || 'image/jpeg',
        data: stripDataUrlPrefix(imageBase64),
      },
    },
  ];
  if (audioBase64) {
    parts.push({
      inlineData: {
        mimeType: audioMimeType || 'audio/wav',
        data: stripDataUrlPrefix(audioBase64),
      },
    });
  }
  parts.push({
    text: [
      'Inspect this live video frame and optional audio clip for real-time commerce triage.',
      spokenTranscriptHint
        ? `Spoken context hint: "${spokenTranscriptHint}".`
        : 'Transcribe any speech accurately.',
      'Be concise: list visible objects, material/finish cues, lighting tone, blur/occlusion, spoken intent, acoustic noise level, and 1 short product search query.',
    ].join('\n'),
  });

  const resp = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: { parts: parts as never },
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          visualObjects: { type: Type.ARRAY, items: { type: Type.STRING } },
          materialsAndFinishes: { type: Type.ARRAY, items: { type: Type.STRING } },
          lightingTone: { type: Type.STRING },
          blurOrOcclusionObserved: { type: Type.STRING },
          spokenTranscript: { type: Type.STRING },
          acousticNoiseAssessment: { type: Type.STRING },
          quickSearchQuery: { type: Type.STRING },
        },
        required: [
          'visualObjects',
          'materialsAndFinishes',
          'lightingTone',
          'blurOrOcclusionObserved',
          'spokenTranscript',
          'acousticNoiseAssessment',
          'quickSearchQuery',
        ],
      },
    },
  });

  const parsed = JSON.parse((resp.text || '{}').trim());
  return {
    visualObjects: parsed.visualObjects || [],
    materialsAndFinishes: parsed.materialsAndFinishes || [],
    lightingTone: parsed.lightingTone || 'Unknown lighting',
    blurOrOcclusionObserved: parsed.blurOrOcclusionObserved || 'Clear',
    spokenTranscript: parsed.spokenTranscript || spokenTranscriptHint || '',
    acousticNoiseAssessment: parsed.acousticNoiseAssessment || 'Quiet',
    quickSearchQuery: parsed.quickSearchQuery || '',
    latencyMs: Date.now() - t0,
  };
}

async function runDecisionGate(
  decisionsAi: GoogleGenAI,
  imageBase64: string,
  imageMimeType: string,
  audioBase64: string | undefined,
  audioMimeType: string | undefined,
  spokenTranscriptHint: string | undefined,
  mitigations: {
    blurGate: boolean;
    minUsableProb: number;
    minIntentProb: number;
  },
) {
  const t0 = Date.now();
  const inputBlocks: Array<Record<string, unknown>> = [
    {
      type: 'text',
      text: [
        spokenTranscriptHint
          ? `Live speaker / scenario audio context: "${spokenTranscriptHint}"`
          : 'No prior text hint — rely directly on the attached frame and audio clip.',
        'Evaluate raw image sharpness/lighting, shopping intent in audio/context, routing decision, and scene clutter.',
      ].join('\n'),
    },
    {
      type: 'image',
      data: stripDataUrlPrefix(imageBase64),
      mime_type: imageMimeType || 'image/jpeg',
      resolution: 'medium',
    },
  ];

  if (audioBase64) {
    inputBlocks.push({
      type: 'audio',
      data: stripDataUrlPrefix(audioBase64),
      mime_type: audioMimeType || 'audio/wav',
    });
  }

  const clutterCriteria = [
    'Clean isolated subject: 1-2 clear focal items, minimal background distraction.',
    'Moderate context: furnished room or desk with 3-6 distinct objects.',
    'High clutter: 7-14 overlapping products/cables or partial occlusion.',
    'Extreme clutter or severe blur: >15 crowded items, whip-pan smear, or unusable darkness.',
  ];

  const decisionRes = await decisionsAi.decisions.create({
    model: 'gemini-decision-1',
    input: inputBlocks as never,
    questions: {
      frame_usable: {
        type: 'noul',
        instructions:
          'Is the attached image frame sharp, well-exposed, and free enough of severe motion blur or lens obstruction to identify room aesthetics and products?',
        criteria: {
          true_description:
            'Objects, textures, and materials are recognizable even if slightly busy.',
          false_description:
            'Severe motion blur, smearing, extreme darkness, or total obstruction makes identification unreliable.',
        },
      },
      intent_confirmed: {
        type: 'noul',
        instructions:
          'Does the speaker/context express an actionable product-discovery, styling, or shopping intent rather than pure irrelevant background chatter or noise?',
        criteria: {
          true_description:
            'User is clearly asking to find, match, replace, or buy a physical item for the visible scene.',
          false_description:
            'Audio is unintelligible noise, unrelated ambient conversation, or contains no shopping intent.',
        },
      },
      route_action: {
        type: 'choice',
        instructions:
          'Which pipeline action should execute next based on frame quality and audio intent?',
        criteria: {
          ask_clarification: 'Frame is clear, but spoken shopping request is ambiguous.',
          hold_blurry_frame: 'Image has too much motion blur or darkness; hold for a cleaner keyframe.',
          hold_noisy_audio: 'Audio is drowned in noise or lacks clear product intent.',
          proceed_commerce: 'Frame and shopping intent are both solid; run deep spatial synthesis and Shopify search.',
        },
      },
      clutter_severity: {
        type: 'score',
        instructions: 'Rate the visual clutter, occlusion, and blur difficulty of this frame.',
        criteria: clutterCriteria,
      },
    },
  });

  const answers = decisionRes.answers ?? {};
  const frameAns = answers.frame_usable;
  const intentAns = answers.intent_confirmed;
  const routeAns = answers.route_action;
  const clutterAns = answers.clutter_severity;

  const frameUsableProb = frameAns?.type === 'noul' ? frameAns.noul : 0.5;
  const frameUsableConfidence = frameAns?.type === 'noul' ? frameAns.confidence : 0.5;
  const intentConfirmedProb = intentAns?.type === 'noul' ? intentAns.noul : 0.5;
  const intentConfidence = intentAns?.type === 'noul' ? intentAns.confidence : 0.5;
  const routeChoice = (
    routeAns?.type === 'choice' ? routeAns.choice : 'proceed_commerce'
  ) as 'proceed_commerce' | 'hold_blurry_frame' | 'hold_noisy_audio' | 'ask_clarification';
  const routeProbabilities = routeAns?.type === 'choice' ? routeAns.probabilities : {};
  const clutterScoreNormalized =
    clutterAns?.type === 'score' ? clutterAns.score / (clutterCriteria.length - 1) : 0.5;
  const topClutterIdx =
    clutterAns?.type === 'score'
      ? Object.entries(clutterAns.probabilities).sort(([, a], [, b]) => b - a)[0]?.[0]
      : undefined;
  const clutterLabel =
    clutterAns?.type === 'score' && topClutterIdx
      ? clutterAns.legend[topClutterIdx] || 'Moderate context'
      : 'Moderate context';

  let passed = true;
  let holdReason: string | undefined;

  if (mitigations.blurGate) {
    if (frameUsableProb < mitigations.minUsableProb) {
      passed = false;
      holdReason = `Held by Decisions API blur gate: frame_usable=${frameUsableProb.toFixed(2)} < ${mitigations.minUsableProb.toFixed(2)}`;
    } else if (intentConfirmedProb < mitigations.minIntentProb) {
      passed = false;
      holdReason = `Held by Decisions API acoustic intent gate: intent_confirmed=${intentConfirmedProb.toFixed(2)} < ${mitigations.minIntentProb.toFixed(2)}`;
    } else if (routeChoice === 'hold_blurry_frame' || routeChoice === 'hold_noisy_audio') {
      passed = false;
      holdReason = `Held by Decisions API router: ${routeChoice}`;
    }
  }

  return {
    frameUsableProb,
    frameUsableConfidence,
    intentConfirmedProb,
    intentConfidence,
    routeChoice,
    routeProbabilities,
    clutterScoreNormalized,
    clutterLabel,
    gateLatencyMs: Date.now() - t0,
    passed,
    holdReason,
  };
}

async function runNeonSynthesis(
  ai: GoogleGenAI,
  imageBase64: string,
  imageMimeType: string,
  audioBase64: string | undefined,
  audioMimeType: string | undefined,
  spokenTranscriptHint?: string,
) {
  const t0 = Date.now();
  const parts: Array<Record<string, unknown>> = [
    {
      inlineData: {
        mimeType: imageMimeType || 'image/jpeg',
        data: stripDataUrlPrefix(imageBase64),
      },
    },
  ];
  if (audioBase64) {
    parts.push({
      inlineData: {
        mimeType: audioMimeType || 'audio/wav',
        data: stripDataUrlPrefix(audioBase64),
      },
    });
  }
  parts.push({
    text: [
      spokenTranscriptHint
        ? `Buyer spoken request: "${spokenTranscriptHint}".`
        : 'Infer the buyer need from audio and frame.',
      'Perform concise spatial-acoustic commerce synthesis from the RAW video frame and audio:',
      '1. targetNeedSummary: 1 crisp sentence summarizing what item + budget/constraint fits the user.',
      '2. whatRawMediaRevealed: 1-2 crisp sentences on wood/metal/color-temp/clearance cues text loses.',
      '3. spatialAndAcousticReasoning: 1 crisp sentence explaining clutter/occlusion resolution.',
      '4. searchQueries: 2 concise Shopify catalog search strings (e.g. "brushed brass cordless table lamp").',
    ].join('\n'),
  });

  const resp = await ai.models.generateContent({
    model: 'gemini-4-neon',
    contents: { parts: parts as never },
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          targetNeedSummary: { type: Type.STRING },
          whatRawMediaRevealed: { type: Type.STRING },
          spatialAndAcousticReasoning: { type: Type.STRING },
          searchQueries: { type: Type.ARRAY, items: { type: Type.STRING } },
          recommendedMaxPriceUsd: { type: Type.NUMBER },
        },
        required: [
          'targetNeedSummary',
          'whatRawMediaRevealed',
          'spatialAndAcousticReasoning',
          'searchQueries',
        ],
      },
    },
  });

  const parsed = JSON.parse((resp.text || '{}').trim());
  return {
    targetNeedSummary: parsed.targetNeedSummary || spokenTranscriptHint || 'Matched commerce item',
    whatRawMediaRevealed:
      parsed.whatRawMediaRevealed || 'Material patina and ambient lighting extracted from raw frame.',
    spatialAndAcousticReasoning:
      parsed.spatialAndAcousticReasoning || 'Matched product scale and finish to surrounding scene.',
    searchQueries:
      Array.isArray(parsed.searchQueries) && parsed.searchQueries.length > 0
        ? parsed.searchQueries.slice(0, 2)
        : ['minimalist brass table lamp'],
    recommendedMaxPriceUsd:
      typeof parsed.recommendedMaxPriceUsd === 'number' && parsed.recommendedMaxPriceUsd > 0
        ? parsed.recommendedMaxPriceUsd
        : undefined,
    latencyMs: Date.now() - t0,
  };
}

async function scoreCatalogProductsWithDecisions(
  decisionsAi: GoogleGenAI,
  imageBase64: string,
  imageMimeType: string,
  spokenIntent: string,
  whatRawMediaRevealed: string,
  products: Awaited<ReturnType<typeof searchShopifyMcp>>['products'],
): Promise<
  Array<
    Awaited<ReturnType<typeof searchShopifyMcp>>['products'][number] & {
      fitScoreNormalized?: number;
      fitLabel?: string;
      fitConfidence?: number;
      visualFitVerifiedProb?: number;
    }
  >
> {
  if (products.length === 0) return [];

  const fitRubric = [
    'Incompatible: wrong product category or clashes completely with scene aesthetics.',
    'Weak match: right broad category, but wrong material, finish, or size context.',
    'Plausible match: usable functionally, neutral aesthetic alignment.',
    'Strong match: right function, complementary materials, scale, and tone for the scene.',
    'Exact bespoke fit: nails both spoken request and raw visual patina/lighting/space.',
  ];

  const candidateSummary = products
    .map(
      (p, idx) =>
        `[${idx}] "${p.title}" by ${p.merchantName} — $${(p.priceAmountCents / 100).toFixed(2)} ${p.currency} — ${p.descriptionSnippet}`,
    )
    .join('\n');

  const questions: Record<string, never> = {};
  products.forEach((_, idx) => {
    (questions as Record<string, unknown>)[`fit_${idx}`] = {
      type: 'score',
      instructions: `Rate how well candidate product [${idx}] fits the attached scene photo and buyer request ("${spokenIntent}"). Visual context: ${whatRawMediaRevealed}`,
      criteria: fitRubric,
    };
    (questions as Record<string, unknown>)[`verified_${idx}`] = {
      type: 'noul',
      instructions: `Does candidate product [${idx}] genuinely match the user's requested item and visual environment without obvious mismatch?`,
    };
  });

  const res = await decisionsAi.decisions.create({
    model: 'gemini-decision-1',
    input: [
      {
        type: 'text',
        text: `Buyer spoken intent: ${spokenIntent}\nScene synthesis: ${whatRawMediaRevealed}\nCandidate Shopify products:\n${candidateSummary}`,
      },
      {
        type: 'image',
        data: stripDataUrlPrefix(imageBase64),
        mime_type: imageMimeType || 'image/jpeg',
        resolution: 'low',
      },
    ],
    questions,
  });

  const answers = res.answers ?? {};
  return products
    .map((p, idx) => {
      const fitAns = answers[`fit_${idx}`];
      const verAns = answers[`verified_${idx}`];
      const fitScoreNormalized =
        fitAns?.type === 'score' ? fitAns.score / (fitRubric.length - 1) : 0.5;
      const topKey =
        fitAns?.type === 'score'
          ? Object.entries(fitAns.probabilities).sort(([, a], [, b]) => b - a)[0]?.[0]
          : undefined;
      const fitLabel =
        fitAns?.type === 'score' && topKey
          ? fitAns.legend[topKey]?.split(':')[0] || 'Plausible match'
          : 'Plausible match';
      const fitConfidence = fitAns?.type === 'score' ? fitAns.confidence : 0.5;
      const visualFitVerifiedProb = verAns?.type === 'noul' ? verAns.noul : 0.5;
      return {
        ...p,
        fitScoreNormalized,
        fitLabel,
        fitConfidence,
        visualFitVerifiedProb,
      };
    })
    .sort((a, b) => (b.fitScoreNormalized ?? 0) - (a.fitScoreNormalized ?? 0));
}

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self)');
    next();
  });
  app.use(express.json({ limit: '25mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      hasApiKey: Boolean(process.env.GEMINI_API_KEY),
      models: ['gemini-4-hydrogen', 'gemini-4-neon', 'gemini-decision-1'],
      shopifyMcp: SHOPIFY_GLOBAL_MCP,
    });
  });

  app.get('/ucp-agent.json', (_req, res) => {
    res.json({
      ucp: {
        version: '2026-08-25',
        services: {
          'dev.ucp.shopping': [
            {
              version: '2026-08-25',
              spec: 'https://ucp.dev/2026-08-25/specification/overview',
              transport: 'mcp',
              schema: 'https://ucp.dev/2026-08-25/services/shopping/mcp.openrpc.json',
            },
          ],
        },
        capabilities: {
          'dev.ucp.shopping.catalog.search': [{ version: '2026-08-25' }],
          'dev.shopify.catalog.global': [{ version: '2026-08-25' }],
        },
        payment_handlers: {},
      },
    });
  });

  app.post('/api/shopify/search', async (req, res) => {
    try {
      const { query, limit, maxPriceUsd, storefrontMcpUrl, intentContext } = req.body ?? {};
      if (!query || typeof query !== 'string' || !query.trim()) {
        res.status(400).json({ error: 'Search query string is required.' });
        return;
      }
      const data = await searchShopifyMcp(query.trim().slice(0, 240), {
        limit,
        maxPriceUsd,
        storefrontMcpUrl,
        intentContext,
      });
      res.json(data);
    } catch (err) {
      const formatted = formatGeminiError(err);
      res.status(formatted.status).json({ error: formatted.message, code: formatted.code });
    }
  });

  app.post('/api/pipeline/analyze', async (req, res) => {
    const tTotal = Date.now();
    const wantsStream =
      req.query.stream === '1' || req.headers.accept?.includes('text/event-stream');

    const sendEvent = (eventName: string, data: unknown) => {
      if (!wantsStream) return;
      res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const {
        imageBase64,
        imageMimeType = 'image/jpeg',
        audioBase64,
        audioMimeType = 'audio/wav',
        spokenTranscriptHint,
        hasRealAudio = false,
        mode = 'gated',
        mitigations = {
          blurGate: true,
          confidenceHysteresis: true,
          frameDedup: true,
          minUsableProb: 0.55,
          minIntentProb: 0.5,
        },
        storefrontMcpUrl,
        scenarioLabel = 'Live Stream',
        stressConfig,
      } = req.body ?? {};

      if (!imageBase64) {
        res.status(400).json({ error: 'imageBase64 frame payload is required.' });
        return;
      }

      if (wantsStream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders?.();
      }

      const { ai, decisionsAi } = getGeminiClients();

      let effectiveTranscriptHint = (spokenTranscriptHint || '').trim();
      let preTranscribedAudio: { transcript: string; noiseNote: string; latencyMs: number } | null =
        null;

      // Always transcribe real video/mic audio when no manual prompt was supplied
      if (hasRealAudio && audioBase64 && !effectiveTranscriptHint) {
        sendEvent('stage', { stage: 'transcribe', status: 'running' });
        preTranscribedAudio = await runFastAudioTranscribe(ai, audioBase64, audioMimeType);
        if (preTranscribedAudio.transcript) {
          effectiveTranscriptHint = preTranscribedAudio.transcript;
        }
        sendEvent('stage', {
          stage: 'transcribe',
          status: 'done',
          transcript: effectiveTranscriptHint,
          noiseNote: preTranscribedAudio.noiseNote,
          latencyMs: preTranscribedAudio.latencyMs,
        });
      }

      if (mode === 'baseline') {
        sendEvent('stage', { stage: 'hydrogen', status: 'running' });
        const hydrogen = await runHydrogenPerception(
          ai,
          imageBase64,
          imageMimeType,
          audioBase64,
          audioMimeType,
          effectiveTranscriptHint || undefined,
        );
        sendEvent('stage', { stage: 'hydrogen', status: 'done', hydrogen });
        sendEvent('stage', { stage: 'shopify', status: 'running' });

        const query =
          hydrogen.quickSearchQuery ||
          hydrogen.visualObjects[0] ||
          effectiveTranscriptHint ||
          'home decor';
        const shopify = await searchShopifyMcp(query, {
          limit: 4,
          storefrontMcpUrl,
          intentContext: hydrogen.spokenTranscript,
        });

        const tracePayload = {
          id: `trace_${Date.now()}`,
          timestamp: new Date().toISOString(),
          mode: 'baseline',
          scenarioLabel,
          stressConfig,
          hydrogen,
          shopifyLatencyMs: shopify.latencyMs,
          totalLatencyMs: Date.now() - tTotal,
          triggeredSearch: true,
          products: shopify.products,
          status: shopify.products.length > 0 ? 'matched' : 'no_products',
        };

        if (wantsStream) {
          sendEvent('done', tracePayload);
          res.end();
        } else {
          res.json(tracePayload);
        }
        return;
      }

      // Stage 1 (Fast Gate <1s): Gemini Decisions API zero-token pre-filter before heavy models
      sendEvent('stage', { stage: 'gate', status: 'running' });
      const decisionGate = await runDecisionGate(
        decisionsAi,
        imageBase64,
        imageMimeType,
        audioBase64,
        audioMimeType,
        effectiveTranscriptHint || undefined,
        mitigations,
      );
      sendEvent('stage', { stage: 'gate', status: 'done', decisionGate });

      if (!decisionGate.passed) {
        const heldPayload = {
          id: `trace_${Date.now()}`,
          timestamp: new Date().toISOString(),
          mode: 'gated',
          scenarioLabel,
          stressConfig,
          hydrogen: {
            visualObjects: [],
            materialsAndFinishes: [],
            lightingTone: `Scene assessment: ${decisionGate.clutterLabel}`,
            blurOrOcclusionObserved:
              decisionGate.routeChoice === 'hold_blurry_frame'
                ? `Frame usable score=${decisionGate.frameUsableProb.toFixed(2)} (blur/darkness check)`
                : `Gate action: ${decisionGate.routeChoice}`,
            spokenTranscript: effectiveTranscriptHint,
            acousticNoiseAssessment:
              preTranscribedAudio?.noiseNote ||
              (decisionGate.routeChoice === 'hold_noisy_audio'
                ? `Audio unclear or no shopping intent detected (intent=${decisionGate.intentConfirmedProb.toFixed(2)})`
                : 'Gated upstream'),
            quickSearchQuery: '',
            latencyMs: preTranscribedAudio?.latencyMs ?? 0,
          },
          decisionGate,
          shopifyLatencyMs: 0,
          totalLatencyMs: Date.now() - tTotal,
          triggeredSearch: false,
          products: [],
          status: 'held_by_gate',
        };
        if (wantsStream) {
          sendEvent('done', heldPayload);
          res.end();
        } else {
          res.json(heldPayload);
        }
        return;
      }

      // Stage 2 (Parallel): Gemini 4 Hydrogen triage + Gemini 4 Neon spatial-acoustic synthesis
      sendEvent('stage', { stage: 'synthesis', status: 'running' });
      const [hydrogen, neon] = await Promise.all([
        runHydrogenPerception(
          ai,
          imageBase64,
          imageMimeType,
          audioBase64,
          audioMimeType,
          effectiveTranscriptHint || undefined,
        ).then((h) => {
          sendEvent('stage', { stage: 'hydrogen', status: 'done', hydrogen: h });
          return h;
        }),
        runNeonSynthesis(
          ai,
          imageBase64,
          imageMimeType,
          audioBase64,
          audioMimeType,
          effectiveTranscriptHint || undefined,
        ).then((n) => {
          sendEvent('stage', { stage: 'neon', status: 'done', neon: n });
          return n;
        }),
      ]);

      // Stage 3: Live Shopify Global Catalog MCP search
      sendEvent('stage', { stage: 'shopify', status: 'running' });
      const primaryQuery = neon.searchQueries[0] || hydrogen.quickSearchQuery || 'table lamp';
      const shopify = await searchShopifyMcp(primaryQuery, {
        limit: 6,
        maxPriceUsd: neon.recommendedMaxPriceUsd,
        storefrontMcpUrl,
        intentContext: neon.targetNeedSummary,
      });

      let finalProducts = shopify.products;
      let totalShopifyMs = shopify.latencyMs;
      if (finalProducts.length === 0 && neon.searchQueries[1]) {
        const secondary = await searchShopifyMcp(neon.searchQueries[1], {
          limit: 6,
          storefrontMcpUrl,
          intentContext: neon.targetNeedSummary,
        });
        finalProducts = secondary.products;
        totalShopifyMs += secondary.latencyMs;
      }

      // Stage 4: Batch-score Shopify products against raw image via Decisions API
      const scoredProducts =
        mitigations.confidenceHysteresis !== false
          ? await scoreCatalogProductsWithDecisions(
              decisionsAi,
              imageBase64,
              imageMimeType,
              hydrogen.spokenTranscript || spokenTranscriptHint || neon.targetNeedSummary,
              neon.whatRawMediaRevealed,
              finalProducts,
            )
          : finalProducts;

      const matchedPayload = {
        id: `trace_${Date.now()}`,
        timestamp: new Date().toISOString(),
        mode: 'gated',
        scenarioLabel,
        stressConfig,
        hydrogen,
        decisionGate,
        neon,
        shopifyLatencyMs: totalShopifyMs,
        totalLatencyMs: Date.now() - tTotal,
        triggeredSearch: true,
        products: scoredProducts,
        status: scoredProducts.length > 0 ? 'matched' : 'no_products',
      };

      if (wantsStream) {
        sendEvent('done', matchedPayload);
        res.end();
      } else {
        res.json(matchedPayload);
      }
    } catch (err) {
      const formatted = formatGeminiError(err);
      if (wantsStream && res.headersSent) {
        sendEvent('error', { error: formatted.message, code: formatted.code });
        res.end();
      } else {
        res.status(formatted.status).json({ error: formatted.message, code: formatted.code });
      }
    }
  });

  app.post('/api/benchmark/step', async (req, res) => {
    try {
      const {
        stepIndex,
        stepLabel,
        stressValue,
        stressUnit,
        imageBase64,
        imageMimeType = 'image/jpeg',
        audioBase64,
        audioMimeType = 'audio/wav',
        spokenTranscriptHint,
        mitigations = {
          blurGate: true,
          minUsableProb: 0.55,
          minIntentProb: 0.5,
        },
        expectReject = false,
      } = req.body ?? {};

      if (!imageBase64) {
        res.status(400).json({ error: 'imageBase64 is required for benchmark step.' });
        return;
      }

      const { ai, decisionsAi } = getGeminiClients();

      // Run baseline Hydrogen perception & Decisions API pre-gate in parallel on the exact same stressed frame
      const tParallel = Date.now();
      const [baseHydrogen, gate] = await Promise.all([
        runHydrogenPerception(
          ai,
          imageBase64,
          imageMimeType,
          audioBase64,
          audioMimeType,
          spokenTranscriptHint,
        ),
        runDecisionGate(
          decisionsAi,
          imageBase64,
          imageMimeType,
          audioBase64,
          audioMimeType,
          spokenTranscriptHint,
          mitigations,
        ),
      ]);

      const baseQuery = baseHydrogen.quickSearchQuery || baseHydrogen.visualObjects[0] || 'decor';
      const baseShopifyPromise = searchShopifyMcp(baseQuery, { limit: 2 });

      const tGatedDownstream = Date.now();
      let gatedTopTitle: string | null = null;
      let gatedTopFit: number | null = null;

      if (gate.passed) {
        const neon = await runNeonSynthesis(
          ai,
          imageBase64,
          imageMimeType,
          audioBase64,
          audioMimeType,
          spokenTranscriptHint,
        );
        const shopify = await searchShopifyMcp(neon.searchQueries[0] || baseQuery, { limit: 3 });
        const scored = await scoreCatalogProductsWithDecisions(
          decisionsAi,
          imageBase64,
          imageMimeType,
          baseHydrogen.spokenTranscript || spokenTranscriptHint || '',
          neon.whatRawMediaRevealed,
          shopify.products,
        );
        gatedTopTitle = scored[0]?.title || null;
        gatedTopFit = scored[0]?.fitScoreNormalized ?? null;
      }

      const baseShopify = await baseShopifyPromise;
      const baseLatencyMs = baseHydrogen.latencyMs + baseShopify.latencyMs;
      const gatedTotalMs = gate.gateLatencyMs + (gate.passed ? Date.now() - tGatedDownstream : 0);
      void tParallel;

      // Determine breaking points honestly from measured telemetry
      const baselineHallucinated =
        expectReject ||
        baseHydrogen.blurOrOcclusionObserved.toLowerCase().includes('blur') ||
        baseHydrogen.blurOrOcclusionObserved.toLowerCase().includes('dark');
      const brokeHere =
        (!expectReject && !gate.passed) ||
        (expectReject && gate.passed) ||
        gatedTotalMs > 15000;
      let breakReason: string | undefined;
      if (!expectReject && !gate.passed) {
        breakReason = `False reject at ${stepLabel}: gate held valid frame (${gate.holdReason})`;
      } else if (expectReject && gate.passed) {
        breakReason = `Gate bypass at ${stepLabel}: severe stress passed with frame_usable=${gate.frameUsableProb.toFixed(2)}`;
      } else if (gatedTotalMs > 15000) {
        breakReason = `Latency ceiling exceeded (${gatedTotalMs}ms)`;
      }

      res.json({
        stepIndex,
        stepLabel,
        stressValue,
        stressUnit,
        baseline: {
          latencyMs: baseLatencyMs,
          triggeredSearch: true,
          hallucinatedOrLowQuality: baselineHallucinated,
          topProductTitle: baseShopify.products[0]?.title || null,
          summary: `${baseQuery} (${baseHydrogen.blurOrOcclusionObserved})`,
        },
        gated: {
          latencyMs: gatedTotalMs,
          gateLatencyMs: gate.gateLatencyMs,
          frameUsableProb: gate.frameUsableProb,
          intentProb: gate.intentConfirmedProb,
          clutterScore: gate.clutterScoreNormalized,
          routeChoice: gate.routeChoice,
          passedGate: gate.passed,
          topProductTitle: gatedTopTitle,
          topFitScore: gatedTopFit,
          brokeHere,
          breakReason,
        },
      });
    } catch (err) {
      const formatted = formatGeminiError(err);
      res.status(formatted.status).json({ error: formatted.message, code: formatted.code });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Sightline server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
