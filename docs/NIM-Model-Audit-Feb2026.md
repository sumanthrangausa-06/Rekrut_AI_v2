# NIM Model Audit — February 13, 2026

**Purpose:** Comprehensive test of ALL NIM model endpoints to identify dead/working/new models
**Triggered by:** AI Health Dashboard showing NIM 404s and timeouts (Task #30307)

---

## Executive Summary

- **19 models working** out of 37 tested (51% alive)
- **17 models dead** (404 or 410 Gone) — includes 13 CURRENTLY INTEGRATED models
- **1 model too slow** (Llama 3.1 405B — 12s timeout)
- **7 new working models** discovered that aren't yet integrated
- **Embedding models NOT dead** — just need `input_type` parameter fix
- **Reranking endpoints moved** — both returning 404

### Critical Findings

The NIM platform has undergone a **major model rotation** since Feb 11. Many third-party models (DeepSeek, Kimi, Mistral, Qwen) have been **removed from the free tier / cloud API**.

---

## Full Audit Results

### LLM Models

| Model | Model ID | Status | Response Time | Integrated? | Action |
|-------|----------|--------|---------------|-------------|--------|
| Nemotron Super 49B v1 | `nvidia/llama-3.3-nemotron-super-49b-v1` | ✅ Working | 534ms | Yes | Keep |
| **Nemotron Super 49B v1.5** | `nvidia/llama-3.3-nemotron-super-49b-v1.5` | ✅ Working | 483ms | **No** | **ADD — upgraded version** |
| Step 3.5 Flash | `stepfun-ai/step-3.5-flash` | ✅ Working | 257ms | Yes | Keep |
| GPT-OSS-120B | `openai/gpt-oss-120b` | ✅ Working | 312ms | Yes | Keep |
| **GPT-OSS-20B** | `openai/gpt-oss-20b` | ✅ Working | 256ms | **No** | **ADD** |
| QwQ-32B | `qwen/qwq-32b` | ✅ Working | 2146ms | Yes | Keep (reasoning only, slow) |
| Gemma 3 27B | `google/gemma-3-27b-it` | ✅ Working | 428ms | Yes | Keep |
| **Llama 3.1 8B** | `meta/llama-3.1-8b-instruct` | ✅ Working | 151ms | **No** | **ADD — fastest!** |
| **Llama 3.3 70B** | `meta/llama-3.3-70b-instruct` | ✅ Working | 197ms | **No** | **ADD** |
| **Llama 3.1 70B** | `meta/llama-3.1-70b-instruct` | ✅ Working | 218ms | **No** | **ADD** |
| **Nemotron Nano 30B** | `nvidia/nemotron-3-nano-30b-a3b` | ✅ Working | 283ms | **No** | **ADD — replace dead Nano 9B** |
| **Nemotron Ultra 253B** | `nvidia/llama-3.1-nemotron-ultra-253b-v1` | ✅ Working | 368ms | **No** | **ADD — quality tier** |
| Phi-4 Mini | `microsoft/phi-4-mini-instruct` | ✅ Working | 757ms | No | Consider for efficient chain |
| Granite 3.3 8B | `ibm/granite-3.3-8b-instruct` | ✅ Working | 834ms | No | Consider for efficient chain |
| Seed-OSS-36B | `bytedance/seed-oss-36b-instruct` | ✅ Working | 1082ms | No | Consider |
| Kimi K2.5 | `moonshot-ai/kimi-k2.5` | ❌ 404 | — | Yes | **REMOVE** |
| DeepSeek V3.2 | `deepseek-ai/deepseek-v3p2` | ❌ 404 | — | Yes | **REMOVE** |
| DeepSeek V3.1 | `deepseek-ai/deepseek-v3p1` | ❌ 404 | — | Yes | **REMOVE** |
| DeepSeek R1 | `deepseek-ai/deepseek-r1` | ❌ 410 Gone | — | Yes | **REMOVE** |
| Nemotron Nano 9B | `nvidia/nemotron-nano-8b-v2` | ❌ 404 | — | Yes | **REMOVE** |
| Mistral Small 24B | `mistralai/mistral-small-24b-instruct-2501` | ❌ 404 | — | Yes | **REMOVE** |
| Qwen 2.5 72B | `qwen/qwen2.5-72b-instruct` | ❌ 404 | — | Yes | **REMOVE** |
| Kimi K2 Instruct | `moonshot-ai/kimi-k2-instruct` | ❌ 404 | — | No | Skip |
| MiniMax-M2 | `minimax/minimax-m2` | ❌ 404 | — | No | Skip |
| GLM-4.7 | `zhipu-ai/glm-4.7` | ❌ 404 | — | No | Skip |
| Devstral 123B | `mistralai/devstral-2-123b` | ❌ 404 | — | No | Skip |
| Llama 3.1 405B | `meta/llama-3.1-405b-instruct` | ⚠️ Timeout | 12000ms+ | No | Skip |

### Vision Models

| Model | Model ID | Status | Response Time | Integrated? | Action |
|-------|----------|--------|---------------|-------------|--------|
| Nemotron Nano 12B VL | `nvidia/nemotron-nano-12b-v2-vl` | ✅ Working | 207ms | Yes | Keep |
| Gemma 3 27B | `google/gemma-3-27b-it` | ✅ Working | 357ms | Yes | Keep |
| Cosmos Reason2 8B | `nvidia/cosmos-reason2-8b` | ❌ 404 | — | Yes | **REMOVE** |
| Kimi K2.5 (vision) | `moonshot-ai/kimi-k2.5` | ❌ 404 | — | Yes | **REMOVE** |

### Embedding Models

| Model | Model ID | Status | Response Time | Integrated? | Action |
|-------|----------|--------|---------------|-------------|--------|
| NV-EmbedQA-1B-v2 | `nvidia/llama-3.2-nv-embedqa-1b-v2` | ⚠️ 400 Error | 696ms | Yes | **FIX — needs `input_type` param** |
| Nemotron-Embed-VL-1B-v2 | `nvidia/llama-nemotron-embed-vl-1b-v2` | ⚠️ 400 Error | 701ms | Yes | **FIX — needs `input_type` param** |

### Reranking Models

| Model | Model ID | Status | Integrated? | Action |
|-------|----------|--------|-------------|--------|
| NV-RerankQA-1B-v2 | `nvidia/llama-3.2-nv-rerankqa-1b-v2` | ❌ 404 | Yes | **REMOVE — endpoint moved** |
| Nemotron-Rerank-VL-1B-v2 | `nvidia/llama-nemotron-rerank-vl-1b-v2` | ❌ 404 | Yes | **REMOVE — endpoint moved** |

### Safety Models

| Model | Model ID | Status | Response Time | Integrated? | Action |
|-------|----------|--------|---------------|-------------|--------|
| Nemotron Safety Guard 8B | `nvidia/llama-3.1-nemotron-safety-guard-8b-v3` | ✅ Working | 1078ms | Yes | Keep |
| Nemotron Content Safety 4B | `nvidia/nemotron-content-safety-reasoning-4b` | ✅ Working | 899ms | Yes | Keep |

---

## New Fallback Chain Design (Post-Audit)

### LLM Chain (ordered by response time)

1. Anthropic (Polsia proxy) — primary
2. OpenAI (Polsia proxy) — secondary
3. **Llama 3.1 8B** (NIM, 151ms) — fastest NIM, efficient tasks 🆕
4. **Llama 3.3 70B** (NIM, 197ms) — quality workhorse 🆕
5. **GPT-OSS-20B** (NIM, 256ms) — light but capable 🆕
6. Step 3.5 Flash (NIM, 257ms) — ultra-efficient
7. **Nemotron Nano 30B** (NIM, 283ms) — replaces dead Nano 9B 🆕
8. GPT-OSS-120B (NIM, 312ms) — OpenAI open model
9. **Nemotron Ultra 253B** (NIM, 368ms) — quality tier 🆕
10. Gemma 3 27B (NIM, 428ms)
11. Nemotron Super 49B v1 (NIM, 534ms)
12. **Groq llama-3.3-70b-versatile** (280 t/s) 🆕
13. **Groq gpt-oss-120b** (500 t/s) 🆕
14. **Cerebras gpt-oss-120b** (3000 t/s) 🆕
15. **Cerebras llama3.1-8b** (2200 t/s) 🆕

### Vision Chain

1. OpenAI GPT-4o (Polsia proxy)
2. Nemotron Nano 12B VL (NIM, 207ms)
3. Gemma 3 27B (NIM, 357ms)

### Reasoning Chain

1. Anthropic → OpenAI
2. QwQ-32B (NIM, 2146ms — slow but working)
3. Step 3.5 Flash (NIM, 257ms)
4. Nemotron Ultra 253B (NIM, 368ms)
5. Groq/Cerebras fallbacks

---

## Groq + Cerebras Models (Additional Fallback Layers)

### Groq (Production-Ready)
- `llama-3.1-8b-instant` — 560 t/s, 131K context
- `llama-3.3-70b-versatile` — 280 t/s, 131K context
- `openai/gpt-oss-120b` — 500 t/s, 131K context
- `openai/gpt-oss-20b` — 1000 t/s, 131K context
- `whisper-large-v3-turbo` — FREE ASR fallback!

### Cerebras (Production-Ready)
- `gpt-oss-120b` — 3000 t/s (fastest inference anywhere)
- `llama3.1-8b` — 2200 t/s
- ~~`llama-3.3-70b`~~ — DEPRECATED Feb 16, 2026
- ~~`qwen-3-32b`~~ — DEPRECATED Feb 16, 2026

---

## Test Methodology

- Ran `scripts/nim-audit.js` on Feb 13, 2026 at 05:34 UTC
- Each model tested with real API call: `messages: [{ role: 'user', content: 'Say hello in one word.' }]`
- 12-second timeout per model
- Tested chat completions, embeddings, reranking, and safety endpoints
- NIM API key verified active
