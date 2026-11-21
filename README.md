# Sightline

Real-time multimodal vision-to-commerce agent, audio-visual gating pipeline, and stress-test benchmark built for the **Gemini 4 NYC Hackathon** (**Element 119** + **Shopify Bonus Track / `shop.dev`**).

## Overview

Sightline investigates where naive single-model multimodal commerce agents fail under real-world camera and audio degradation—motion blur, background noise, high-FPS redundant frames, and visual clutter—and routes every live frame through a calibrated multi-stage architecture:

1. **Upfront Speech & Stream Perception (`gemini-4-hydrogen`)**
   - When **Live Camera + Mic** or **Upload Video** supplies real audio (`hasRealAudio: true`) without a manual prompt override, `gemini-4-hydrogen` (`ThinkingLevel.LOW`) transcribes spoken audio verbatim before gating and streams the live transcript over SSE (`stage: transcribe`).
   - On passing frames, `gemini-4-hydrogen` runs in parallel with Neon to extract visible objects, materials/finishes, lighting tone, blur/occlusion, and fast search terms.
2. **Zero-Output-Token Calibrated Pre-Gate (`gemini-decision-1`)**
   - Evaluates `frame_usable` (`noul` threshold `>= 0.55`), `intent_confirmed` (`noul` threshold `>= 0.50`), `route_action` (`choice`: `proceed_commerce`, `hold_blurry_frame`, `hold_noisy_audio`, `ask_clarification`), and `clutter_severity` (`score`) at `medium` image resolution.
   - Blocks smeared frames or non-shopping chatter in `<1s` before invoking `gemini-4-neon` or calling Shopify MCP.
3. **Spatial-Acoustic Synthesis (`gemini-4-neon`)**
   - Extracts scale, wood/metal finishes, clearance geometry, and lighting color temperature from raw frames + audio (`What Raw Media Revealed`) and synthesizes targeted **Shopify MCP** queries.
4. **Live Commerce & Visual-Fit Ranking (`catalog.shopify.com/api/ucp/mcp`)**
   - Executes JSON-RPC 2.0 `search_catalog` calls against Shopify's Global Catalog MCP (or `search_shop_catalog` for custom storefront MCP endpoints).
   - Batch-scores every returned product against the raw frame using `gemini-decision-1` (`fit_*` rubric `score` + `verified_*` `noul` probability).

## Workspace Surfaces

- **Live Studio**: Switch between **Scenario Stream**, **Live Camera + Mic** (`getUserMedia` + `16 kHz` PCM capture), and **Upload Video** (`.mp4`/`.webm`/`.mov` with automatic `AudioBuffer` decoding, 8-second `16 kHz` mono WAV playhead slicing, Play/Pause, and Mute/Unmute controls). Includes real-time blur, noise, low-light, FPS, and gate threshold controls plus SSE stage progress.
- **Stress Benchmark**: Sweeps blur (`0px -> 12px`), acoustic SNR noise (`0% -> 95%`), and FPS cadence (`1 -> 4 FPS`), comparing an **Ungated Baseline** directly against the **Gated Pipeline**.
- **Shopify Catalog**: Standalone UCP Global Catalog MCP & custom storefront MCP explorer with rubric visual-fit scoring.
- **Failure Log**: Live reproducible failure probes (**Probe 9px Blur**, **Probe 95% Noise**) alongside architectural mitigation toggles (`Decisions API Pre-Filtering`, `Luma Frame-Diff Deduplication`, `Visual-Fit Rubric Sorting`).

## Backend API Endpoints

- `GET /api/health` — Returns runtime readiness (`hasApiKey`, configured Gemini models, Shopify MCP endpoint).
- `POST /api/pipeline/analyze?stream=1` — Executes the full SSE-streaming pipeline (`transcribe` -> `gate` -> parallel `hydrogen` + `neon` -> `shopify` -> `decisions` fit ranking) or `baseline` mode.
- `POST /api/benchmark/step` — Runs baseline and gated evaluation on identical stressed keyframes.
- `POST /api/shopify/search` — Direct Shopify Global Catalog / Storefront MCP JSON-RPC 2.0 proxy.
- `GET /ucp-agent.json` — UCP Shopping Agent capability manifest (`2026-08-25`).

## Local Development & Production Deployment

### Prerequisites

- Node.js `>= 22.18` (native TypeScript execution for `node server.ts`)
- A Gemini API key set via environment secrets (`GEMINI_API_KEY` — see `.env.example`; never commit `.env` or secret tokens).

### Run Locally

```bash
npm install
cp .env.example .env   # add GEMINI_API_KEY
npm run dev            # http://0.0.0.0:3000
```

### Production Build & Persistent Hosting

```bash
npm run build
NODE_ENV=production npm start   # runs: node server.ts on 0.0.0.0:${PORT:-3000}
```

In production (`NODE_ENV=production`), `server.ts` serves the compiled Vite bundle from `dist/` (including static scene assets under `dist/src/assets/`) and handles all `/api/*` routes on the same origin. In AI Studio, publish via **Deploy / Share App** after configuring `GEMINI_API_KEY` in Secrets to activate the public shared URL for anyone to access.

## Verified End-to-End Pipeline Test Runs

Verified live against real scraped 1080p stock video frames (`Mixkit`), real spoken English audio (`Wikimedia Commons Example.ogg`), `gemini-4-hydrogen`, `gemini-decision-1`, `gemini-4-neon`, and live `catalog.shopify.com/api/ucp/mcp`:

| Test Case | Gate Result | Audio / Neon Output | Top Shopify MCP Match | Latency |
| --- | --- | --- | --- | --- |
| **Mixkit #52075 Living Room** + custom throw/vase prompt | `PASS` (`frame_usable=0.88`, `intent=0.93`) | Detected vertical wood slats, tan leather stools, beige sofa arm & shelving clearance | *Organic Muslin Cotton Throw Blanket* (`$59.99`, `75% Strong match`) | `9,294 ms` |
| **Mixkit #50111 Workspace Desk** + custom stand/lamp prompt | `PASS` (`frame_usable=0.93`, `intent=0.93`) | Detected medium oak desk, existing matte black dome lamp & tight footprint clearance | *Voomy Office T3 Aluminum Stand* (`$14.00`, `71% Strong match`) | `12,316 ms` |
| **Mixkit #41859 Coffee Bar** + custom espresso/dripper prompt | `PASS` (`frame_usable=0.90`, `intent=0.89`) | Detected low-kelvin lighting over dark wood counter, ceramic cup & stainless pitcher | *Handleless Espresso Cup Set \| Stoneware* (`$54.00`, `83% Exact bespoke fit`) | `10,789 ms` |
| **Mixkit #52075 (10px Boxblur)** · Gated vs. Baseline | Gated: `HELD` (`0.10 < 0.55`) | Zero Neon/Shopify tokens spent (`0` false products) vs. Baseline firing 4 mismatched pillows | Blocked upstream (`triggeredSearch=false`) | `744 ms` (vs `4,256 ms` baseline) |
| **Wikimedia Spoken Audio (`hasRealAudio=true`)** + Coffee Frame | `HELD` (`frame=0.88`, `intent=0.13 < 0.50`) | Verbatim Hydrogen transcript: *"This is an example sound file in Ogg Vorbis format from Wikipedia, the free encyclopedia."* | Correctly held non-shopping speech (`hold_noisy_audio`) | `3,614 ms` (`2,818 ms` transcribe + `796 ms` gate) |
