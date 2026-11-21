# Sightline

Real-time multimodal vision-to-commerce agent and stress-test benchmark built for the **Gemini 4 NYC Hackathon** (**Element 119** + **Shopify Bonus Track**).

## Pipeline

1. **Stream Perception (`gemini-4-hydrogen`)** — Extracts objects, material finishes, lighting tone, blur/occlusion, and spoken intent from live video frames and 16 kHz WAV audio.
2. **Calibrated Gate (`gemini-decision-1`)** — Zero-output-token Decisions API (`noul`, `choice`, `score`) rejects motion-blurred frames and background chatter before downstream calls run.
3. **Spatial-Acoustic Synthesis (`gemini-4-neon`)** — Captures visual/acoustic context lost in text prompts and formulates product queries.
4. **Live Commerce (`catalog.shopify.com/api/ucp/mcp`)** — Executes JSON-RPC 2.0 `search_catalog` calls across Shopify merchants, batch-scores fit against the raw frame, and hands off to merchant checkout.

## Views

- **Live Studio** — Webcam/mic, uploaded video, or stress scenarios with real-time blur, noise, low-light, and cadence controls.
- **Stress Benchmark** — Sweeps blur, acoustic SNR, and FPS bursts comparing an ungated baseline vs. the gated pipeline.
- **Shopify Catalog** — Direct Global Catalog MCP and custom Storefront MCP search with calibrated fit sorting.
- **Failure Log** — Captures real breaking-point snapshots alongside interactive mitigation toggles.

## Run Locally

```bash
npm install
cp .env.example .env   # set GEMINI_API_KEY
npm run dev            # http://localhost:3000
```
