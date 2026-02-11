# NVIDIA NIM Complete Model Catalog — All Providers

**Date:** February 11, 2026
**Replaces:** Report #16624 (which only covered NVIDIA-branded models)
**Purpose:** Comprehensive catalog of EVERY model on [build.nvidia.com](https://build.nvidia.com/models) with module mapping for Rekrut AI (HireLoop)

---

## Executive Summary

- **210+ model endpoints** across **25+ providers** on NVIDIA NIM — not just NVIDIA models
- **Kimi K2.5 IS available** on NIM — 1T parameter multimodal MoE with 256K context, free prototyping
- **GPT-OSS-120B and GPT-OSS-20B** (OpenAI's open-weight models) are on NIM — Apache 2.0 licensed
- **Best value for HireLoop: 4-model strategy** using Nemotron Super 49B, DeepSeek V3.1, Kimi K2.5, and NV-EmbedQA — projected **90%+ cost savings** vs GPT-4o
- **NIM pricing is credit-based for prototyping** (1,000 free credits), GPU-licensed for production ($4,500/GPU/year), or per-token via third-party providers like DeepInfra

---

## 1. All Providers on NVIDIA NIM

| # | Provider | Models on NIM | Specialization |
|---|----------|--------------|----------------|
| 1 | **NVIDIA** | 30+ | Nemotron LLMs, Parakeet ASR, Cosmos VLMs, NemoGuard safety, NeMo Retriever, Maxine audio, Nemotron-Parse OCR |
| 2 | **Meta** | 20+ | Llama 2/3/3.1/3.2/3.3, Code Llama |
| 3 | **Mistral AI** | 8+ | Mistral 7B/NeMo 12B/Small 24B/Large 675B, Codestral, Devstral, Mixtral |
| 4 | **DeepSeek** | 10+ | V3.1, V3.2, R1 reasoning, R1 Distill variants (Llama/Qwen) |
| 5 | **Alibaba/Qwen** | 9+ | Qwen2/2.5/3/QwQ, Coder variants, Next series |
| 6 | **Google** | 5+ | Gemma 2 (2B/9B), Gemma 3 (1B/27B), Gemma 3n |
| 7 | **Microsoft** | 3+ | Phi-3 Mini, Phi-4 Mini |
| 8 | **IBM** | 2+ | Granite 3.3 8B |
| 9 | **Moonshot AI** | 3 | Kimi K2.5, K2-thinking, K2-instruct |
| 10 | **OpenAI** | 2 | GPT-OSS-20B, GPT-OSS-120B |
| 11 | **Stability AI** | 1 | Stable Diffusion 3.5 Large |
| 12 | **Black Forest Labs** | 2+ | FLUX.1-dev, FLUX.1-Kontext-dev |
| 13 | **ByteDance** | 1 | seed-oss-36b-instruct |
| 14 | **StepFun** | 1 | Step 3.5 Flash (196B MoE, 11B active) |
| 15 | **MiniMax** | 2 | MiniMax-M2 (230B), MiniMax-M2.1 |
| 16 | **Zhipu AI (Z.ai)** | 1 | GLM-4.7 |
| 17 | **Stockmark** | 1 | Stockmark-2-100B (Japanese enterprise) |
| 18 | **Sarvam AI** | 1 | Sarvam-M (Indian languages) |
| 19 | **OpenGPT-X** | 1 | Teuken-7B (24 EU languages) |
| 20 | **SpeakLeash** | 1 | Bielik-11B (Polish) |
| 21 | **BigCode** | 2 | StarCoder2-7B, StarCoderBase-15.5B |
| 22 | **SCB 10X** | 2 | Typhoon 2 8B/70B (Thai) |
| 23 | **Kakao** | 1 | Kanana-1.5-8B (Korean) |
| 24 | **OpenFold** | 1 | OpenFold3 (biomolecular) |
| 25 | **Phind** | 1 | Phind-CodeLlama-34B |
| 26+ | **Others** | 5+ | SILMA AI, GreenNode, GoToCompany, UTTER/EuroLLM, Defog |

---

## 2. Complete LLM Catalog (Text Generation)

### Tier 1: Frontier LLMs (Best Quality)

| Model | Provider | Total Params | Active Params | Context | API Price (Input/Output per 1M tokens) | Key Strength |
|-------|----------|-------------|---------------|---------|----------------------------------------|-------------|
| **DeepSeek V3.2** | DeepSeek | 685B | ~37B | 128K | $0.28/$0.42 (direct); free on NIM trial | GPT-5 comparable, IMO gold medal, sparse attention |
| **Mistral Large 3 675B** | Mistral | 675B | MoE | 256K | ~$2.00/$6.00 (Mistral API) | State-of-the-art VLM, multimodal |
| **Llama 3.1 405B Instruct** | Meta | 405B | 405B (dense) | 128K | ~$3.00/$3.00 (third-party) | Largest open-weight dense model |
| **Llama 3.1 Nemotron Ultra 253B** | NVIDIA | 253B | MoE | 128K | $0.60/$1.80 (DeepInfra) | Best NVIDIA reasoning model |
| **GPT-OSS-120B** | OpenAI | 117B | 5.1B | 128K | Free on NIM trial | OpenAI's open model, Apache 2.0, fits 1x H100 |
| **Stockmark-2-100B** | Stockmark | 100B | 100B | — | Free on NIM trial | Japanese enterprise specialist |

### Tier 2: High-Performance (Best Value-to-Quality)

| Model | Provider | Total Params | Active Params | Context | API Price (Input/Output per 1M tokens) | Key Strength |
|-------|----------|-------------|---------------|---------|----------------------------------------|-------------|
| **Kimi K2.5** | Moonshot AI | 1T | 32B | 256K | Free on NIM trial | Multimodal (video/image/PDF), agentic, 384 experts |
| **Qwen3-Coder-480B-A35B** | Alibaba | 480B | 35B | 256K | ~$0.22/$0.95 | Best open coding model, browser use |
| **Step 3.5 Flash** | StepFun | 196B | 11B | 256K | Free on NIM trial | 97.3% AIME 2025, 350 tok/s, ultra-efficient |
| **DeepSeek V3.1** | DeepSeek | 685B | MoE | 128K | $0.28/$0.42 | Hybrid thinking/non-thinking, strong tool use |
| **MiniMax-M2.1** | MiniMax | — | — | — | ~$0.30/$1.20 | Multimodal, coding, agentic |
| **GLM-4.7** | Zhipu AI | — | — | — | Free on NIM trial | Multilingual, agentic coding, tool use |
| **Llama 3.3 Nemotron Super 49B v1.5** | NVIDIA | 49B | MoE | 128K | **$0.10/$0.40** | 70B-level quality at 12x less cost |
| **Llama 3.3 70B Instruct** | Meta | 70B | 70B | 128K | ~$0.60/$0.60 | Workhorse open model |
| **Qwen3-Next-80B-A3B** | Alibaba | 80B | 3B | Ultra-long | Free on NIM trial | Hybrid attention MoE, 119 languages |
| **Mixtral 8x22B** | Mistral | 176B | 44B | 64K | ~$0.60/$0.60 | Strong multilingual MoE |

### Tier 3: Efficient / Specialized

| Model | Provider | Total Params | Active Params | Context | API Price (Input/Output per 1M tokens) | Key Strength |
|-------|----------|-------------|---------------|---------|----------------------------------------|-------------|
| **Nemotron 3 Nano 30B-A3B** | NVIDIA | 30B | 3.5B | 128K–1M | **$0.05/$0.20** | Hybrid Mamba-2/Transformer MoE, 1M context |
| **NVIDIA Nemotron Nano 9B v2** | NVIDIA | 9B | 9B | 32K | **$0.04/$0.16** | Cheapest NVIDIA model, hybrid Transformer-Mamba |
| **GPT-OSS-20B** | OpenAI | 21B | 3.6B | 128K | Free on NIM trial | Runs in 16GB, Apache 2.0 |
| **Mistral Small 24B** | Mistral | 24B | 24B | 128K | ~$0.20/$0.60 | Best small Mistral |
| **Qwen2.5-72B Instruct** | Alibaba | 72B | 72B | 128K | ~$0.30/$0.30 | 95%+ GPT-4 parity, strong math |
| **Llama 3.1 8B Instruct** | Meta | 8B | 8B | 128K | ~$0.05/$0.05 | Lightweight, fast |
| **Gemma 3 27B** | Google | 27B | 27B | 128K | Free on NIM trial | Multimodal (text+image), 140+ languages |
| **Phi-4 Mini** | Microsoft | ~4B | ~4B | 4K | Free on NIM trial | Smallest capable model |
| **Granite 3.3 8B** | IBM | 8B | 8B | — | Free on NIM trial | Enterprise function calling, Apache 2.0 |
| **Devstral-2-123B** | Mistral | 123B | MoE | 256K | Free on NIM trial | Code specialist, 256K context |
| **seed-oss-36b** | ByteDance | 36B | — | — | Free on NIM trial | Long-context reasoning, agentic intelligence |

### Tier 4: Reasoning / Thinking Models

| Model | Provider | Params | Context | Price | Key Strength |
|-------|----------|--------|---------|-------|-------------|
| **DeepSeek R1** | DeepSeek | 671B | 128K | $0.55/$2.19 (direct) | Best open reasoning model |
| **Kimi K2-thinking** | Moonshot | 1T | 256K | Free on NIM trial | Extended reasoning with CoT |
| **Qwen3-Next-80B-A3B Thinking** | Alibaba | 80B | Ultra-long | Free on NIM trial | 119-language reasoning |
| **QwQ-32B** | Alibaba | 32B | 32K | Free on NIM trial | Dedicated reasoning model |
| **DeepSeek R1 Distill Qwen 32B** | DeepSeek | 32B | 32K | Free on NIM trial | R1 reasoning in smaller form |
| **DeepSeek R1 Distill Llama 70B** | DeepSeek | 70B | 128K | ~$0.03 input | Cheapest high-quality reasoning |
| **Step 3.5 Flash** | StepFun | 196B (11B active) | 256K | Free on NIM trial | 97.3% AIME, reasoning champion |

### Tier 5: Code-Specialized Models

| Model | Provider | Params | Context | Price | Key Strength |
|-------|----------|--------|---------|-------|-------------|
| **Qwen3-Coder-480B-A35B** | Alibaba | 480B (35B active) | 256K | ~$0.22/$0.95 | Agentic coding, browser use |
| **Devstral-2-123B** | Mistral | 123B | 256K | Free on NIM trial | Code specialist |
| **Qwen2.5-Coder-32B** | Alibaba | 32B | 128K | Free on NIM trial | Multi-language code gen |
| **Code Llama 70B** | Meta | 70B | 16K | Free on NIM trial | Meta's code model |
| **Phind-CodeLlama-34B** | Phind | 34B | 16K | Free on NIM trial | Code search optimization |
| **StarCoder2-7B** | BigCode | 7B | 16K | Free on NIM trial | Lightweight code completion |

### Tier 6: Language-Specific Models

| Model | Provider | Language Focus | Params | Available on NIM |
|-------|----------|---------------|--------|-----------------|
| **Stockmark-2-100B** | Stockmark | Japanese enterprise | 100B | ✅ |
| **Sarvam-M** | Sarvam AI | Indian languages | — | ✅ |
| **Teuken-7B** | OpenGPT-X | 24 EU languages | 7B | ✅ |
| **Bielik-11B** | SpeakLeash | Polish | 11B | ✅ |
| **Typhoon 2** | SCB 10X | Thai | 8B/70B | ✅ |
| **Kanana-1.5-8B** | Kakao | Korean | 8B | ✅ |
| **Llama 3 Taiwan 70B** | Meta | Mandarin (TW) | 70B | ✅ |
| **EuroLLM-9B** | UTTER | European languages | 9B | ✅ |

---

## 3. Vision & Multimodal Models

| Model | Provider | Params | Context | Capabilities | Price |
|-------|----------|--------|---------|-------------|-------|
| **Kimi K2.5** | Moonshot AI | 1T (32B active) | 256K | Images, video, PDF, agentic | Free trial |
| **Nemotron Nano 12B v2 VL** | NVIDIA | 12B | — | Multi-image, video understanding, visual QA | $0.20/$0.60 |
| **Gemma 3 27B** | Google | 27B | 128K | Text + image, 140+ languages | Free trial |
| **Mistral Large 3 675B** | Mistral | 675B MoE | 256K | State-of-the-art VLM | ~$2.00/$6.00 |
| **Cosmos Reason2-8B** | NVIDIA | 8B | — | Physical AI, video/image reasoning | Free trial |
| **Cosmos Reason1-7B** | NVIDIA | 7B | — | Robotics/physical AI reasoning | Free trial |
| **Nemotron-Parse** | NVIDIA | 1B | — | Document OCR, table extraction (LaTeX) | Free trial |
| **MiniMax-M2.1** | MiniMax | — | — | Multimodal coding/agentic | ~$0.30/$1.20 |

---

## 4. Embedding & Retrieval Models

| Model | Provider | Params | Max Tokens | Languages | Use Case |
|-------|----------|--------|-----------|-----------|---------|
| **Llama-3.2-NV-EmbedQA-1B-v2** | NVIDIA | 1B | 8,192 | 26 languages | QA retrieval, multilingual, Matryoshka embeddings |
| **Llama-Nemotron-Embed-VL-1B-v2** | NVIDIA | 1.7B | 8,192 | Multilingual | Multimodal (text + image) embeddings |
| **Llama-3.2-NemoRetriever-300M-Embed-v2** | NVIDIA | 300M | — | 26 languages | Lightweight multilingual embeddings |
| **NV-Embed-v1** | NVIDIA | — | — | English | Original embedding model |
| **NV-EmbedCode** | NVIDIA | 7B | — | — | Code retrieval (Mistral-based) |

---

## 5. Reranking Models

| Model | Provider | Params | Max Tokens | Languages | Use Case |
|-------|----------|--------|-----------|-----------|---------|
| **Llama-3.2-NV-RerankQA-1B-v2** | NVIDIA | 1B | 8,192 | 26 languages | Document reranking for RAG |
| **Llama-Nemotron-Rerank-VL-1B-v2** | NVIDIA | 1.7B | 8,192 | Multilingual | Multimodal reranking |

---

## 6. Speech & Audio Models

| Model | Provider | Params | Capability | Languages | Key Specs |
|-------|----------|--------|-----------|-----------|----------|
| **Parakeet-TDT-0.6B v2** | NVIDIA | 600M | ASR (speech-to-text) | English | 6.05% WER, 50x faster than alternatives, #1 on HF leaderboard |
| **Parakeet-TDT-0.6B v3** | NVIDIA | 600M | ASR multilingual | 25 European langs | Auto language detect, up to 3hr audio |
| **Parakeet-CTC-0.6B (zh-tw)** | NVIDIA | 600M | ASR | Mandarin TW + English | CTC decoder variant |
| **Parakeet-CTC-0.6B (zh-cn)** | NVIDIA | 600M | ASR | Mandarin CN + English | CTC decoder variant |
| **Parakeet-CTC-0.6B (es)** | NVIDIA | 600M | ASR | Spanish + English | CTC decoder variant |
| **Parakeet-CTC-0.6B (vi)** | NVIDIA | 600M | ASR | Vietnamese + English | CTC decoder variant |
| **Nemotron-Speech-Streaming** | NVIDIA | 600M | Streaming ASR | English | Cache-aware, real-time, low latency |
| **Maxine Studio Voice** | NVIDIA | — | Audio enhancement | English | Noise removal, studio quality |
| **Maxine BNR** | NVIDIA | — | Background noise removal | Multi-language | Improves ASR accuracy |
| **Riva TTS** | NVIDIA | — | Text-to-speech | Multiple | Natural speech synthesis |
| **Riva Translate 4B** | NVIDIA | 4B | Translation | 12+ languages | Neural machine translation |

---

## 7. Image Generation Models

| Model | Provider | Architecture | Capabilities | Available |
|-------|----------|-------------|-------------|-----------|
| **Stable Diffusion 3.5 Large** | Stability AI | Diffusion | Text-to-image, 1.8x speedup on H100 | ✅ |
| **FLUX.1-dev** | Black Forest Labs | Diffusion Transformer | High-quality text-to-image | ✅ |
| **FLUX.1-Kontext-dev** | Black Forest Labs | Diffusion Transformer | In-context image generation/editing | ✅ |
| **Microsoft Trellis** | Microsoft | — | 3D asset generation from text/images | ✅ |

---

## 8. Safety & Guardrail Models

| Model | Provider | Params | Capability |
|-------|----------|--------|-----------|
| **Llama-3.1-Nemotron-Safety-Guard-8B-v3** | NVIDIA | 8B | Multilingual content safety, 23 categories |
| **Nemotron-Content-Safety-Reasoning-4B** | NVIDIA | 4B | Safety with domain-specific policies |
| **NemoGuard (Content Safety)** | NVIDIA | 8B | Content safety for agentic AI pipelines |
| **NemoGuard (Topic Control)** | NVIDIA | 8B | Off-topic drift prevention |

---

## 9. Scientific & Specialized Models

| Model | Provider | Capability |
|-------|----------|-----------|
| **OpenFold3** | OpenFold | Biomolecular structure prediction (proteins, DNA, RNA) |
| **StreamPETR** | NVIDIA | 3D object detection for autonomous driving |
| **VISTA-3D** | NVIDIA | Medical imaging segmentation |
| **NemoRetriever-Page-Elements-v3** | NVIDIA | Object detection in documents (charts, tables) |

---

## 10. Pricing Comparison: NIM vs OpenAI vs Direct APIs

### LLM Pricing (per 1M tokens)

| Model | Provider | Input | Output | vs GPT-4o ($2.50/$10) | Notes |
|-------|----------|-------|--------|----------------------|-------|
| **Nemotron Nano 9B v2** | NVIDIA | $0.04 | $0.16 | **62x cheaper** | Best for bulk/simple tasks |
| **Nemotron 3 Nano 30B** | NVIDIA | $0.05 | $0.20 | **50x cheaper** | 1M context window |
| **Nemotron Super 49B v1.5** | NVIDIA | $0.10 | $0.40 | **25x cheaper** | Best value: 70B quality |
| **DeepSeek V3.2** | DeepSeek | $0.28 | $0.42 | **9x cheaper** | GPT-5 level, cache hits $0.028 |
| **DeepSeek V3.1** | DeepSeek | $0.28 | $0.42 | **9x cheaper** | Hybrid thinking + tool use |
| **DeepSeek R1 Distill 70B** | DeepSeek | $0.03 | — | **83x cheaper** | Budget reasoning |
| **GPT-OSS-120B** | OpenAI | Free trial | Free trial | **Free to prototype** | Apache 2.0, 5.1B active |
| **GPT-OSS-20B** | OpenAI | Free trial | Free trial | **Free to prototype** | 16GB memory, Apache 2.0 |
| **Kimi K2.5** | Moonshot | Free trial | Free trial | **Free to prototype** | 1T params, multimodal |
| **Step 3.5 Flash** | StepFun | Free trial | Free trial | **Free to prototype** | 97.3% AIME, ultra-efficient |
| **Nemotron Nano 12B VL** | NVIDIA | $0.20 | $0.60 | **12x cheaper** | Vision + language |
| **Nemotron Ultra 253B** | NVIDIA | $0.60 | $1.80 | **4x cheaper** | Best NVIDIA model |
| **Llama 3.1 Nemotron 70B** | NVIDIA | $1.20 | $1.20 | **2x cheaper** | Legacy, use Super 49B instead |
| **Qwen3-Coder-480B** | Alibaba | $0.22 | $0.95 | **11x cheaper** | Best coding model |
| **Mistral Small 24B** | Mistral | $0.20 | $0.60 | **12x cheaper** | Good general purpose |
| **Mistral Large 675B** | Mistral | $2.00 | $6.00 | **Comparable** | Premium quality |
| **MiniMax-M2** | MiniMax | $0.30 | $1.20 | **8x cheaper** | Multimodal, coding |

### NIM Pricing Model

| Tier | Cost | Best For |
|------|------|---------|
| **Free Prototyping** | 1,000 credits (build.nvidia.com) | Testing all 210+ models |
| **Developer Program** | Free (up to 16 GPUs) | Dev/test, non-production |
| **AI Enterprise License** | $4,500/GPU/year (~$1/GPU/hour) | Production self-hosted |
| **90-Day Trial** | Free | Production evaluation |
| **Third-Party (DeepInfra)** | Per-token pricing | Production without self-hosting |

---

## 11. Kimi K2.5 Deep Dive (User-Requested)

**Status: ✅ AVAILABLE on NVIDIA NIM** ([build.nvidia.com/moonshotai/kimi-k2.5](https://build.nvidia.com/moonshotai/kimi-k2.5/modelcard))

| Spec | Value |
|------|-------|
| **Provider** | Moonshot AI |
| **Architecture** | Transformer MoE with MLA (Multi-head Latent Attention) |
| **Total Parameters** | 1 Trillion |
| **Active Parameters** | 32B per token |
| **Experts** | 384 total, 8 selected per token (3.2% activation) |
| **Vision Encoder** | MoonViT (400M params) |
| **Context Window** | 256K tokens |
| **Max Output** | 32,768 tokens |
| **Input Types** | Text, images, video, PDF |
| **Training Data** | ~15T mixed visual and text tokens |
| **API Endpoint** | `https://integrate.api.nvidia.com/v1/chat/completions` |
| **OpenAI Compatible** | ✅ Yes (chat/completions format) |
| **Streaming** | ✅ Yes (SSE format) |
| **Tool Calling** | ✅ Yes |
| **License** | MIT (open source) |
| **Released** | January 27, 2026 |
| **NIM Available** | February 4, 2026 |

### Kimi K2.5 Operating Modes

1. **K2.5 Instant** — Fast responses, thinking disabled
2. **K2.5 Thinking** — Extended reasoning with chain-of-thought
3. **K2.5 Agent** — Single-agent autonomous task execution
4. **K2.5 Agent Swarm** (Beta) — Multi-agent parallel workflows

### Kimi K2.5 Benchmarks

| Benchmark | Score | Comparison |
|-----------|-------|------------|
| MMMU-Pro (visual understanding) | 78.5% | Competitive with Gemini 3 Pro |
| SWE-Bench Verified (coding) | 76.8% | Strong coding capability |

### Kimi K2.5 for HireLoop

**Best fit modules:**
- **Mock Interview** — Multimodal (video analysis), thinking mode for evaluation
- **Resume Parsing** — PDF input native, OCR-level extraction
- **AI Coaching** — Agent mode for autonomous guidance
- **Assessment** — Visual + text understanding for multimodal tests

---

## 12. Best Model Per HireLoop Module (Updated Recommendation)

| Module | Best Model | Provider | Why | Cost (per 1M tokens) | Fallback |
|--------|-----------|----------|-----|----------------------|---------|
| **Mock Interview** | Nemotron Super 49B v1.5 | NVIDIA | Best quality-per-dollar, tool calling, 128K context | $0.10/$0.40 | Kimi K2.5 (if video analysis needed) |
| **AI Coaching** | Nemotron Super 49B v1.5 | NVIDIA | Reasoning + instruction following at lowest cost | $0.10/$0.40 | DeepSeek V3.1 (hybrid thinking) |
| **Resume Parsing** | Nemotron-Parse + Nemotron Nano 9B | NVIDIA | Parse extracts structure, Nano processes text | $0.04/$0.16 | Kimi K2.5 (for PDF-native parsing) |
| **Job Matching** | NV-EmbedQA-1B-v2 + NV-RerankQA-1B-v2 | NVIDIA | Purpose-built for QA retrieval, 26 languages | Minimal | Llama-Nemotron-Embed-VL (multimodal) |
| **Onboarding** | Nemotron Nano 9B v2 | NVIDIA | Simple Q&A, low cost, fast | $0.04/$0.16 | GPT-OSS-20B (free prototype) |
| **Assessment Generation** | Nemotron Super 49B v1.5 | NVIDIA | Reasoning depth for quality questions | $0.10/$0.40 | Step 3.5 Flash (97.3% AIME) |
| **Offer Letter Generation** | Nemotron Nano 9B v2 | NVIDIA | Template-based, doesn't need frontier model | $0.04/$0.16 | Qwen2.5-7B |
| **Payroll Q&A** | Nemotron Nano 9B v2 | NVIDIA | Simple factual Q&A over docs | $0.04/$0.16 | Granite 3.3 8B (enterprise focus) |
| **Interview Scheduling** | Nemotron Nano 9B v2 | NVIDIA | Function calling for calendar APIs | $0.04/$0.16 | GPT-OSS-20B |
| **Profile Management** | NV-EmbedQA-1B-v2 | NVIDIA | Embedding + similarity for profiles | Minimal | — |
| **Document Generation** | Nemotron Super 49B v1.5 | NVIDIA | Complex document structuring | $0.10/$0.40 | Qwen3-Coder-480B (if templates need code) |
| **JD Generation** | Nemotron Nano 9B v2 | NVIDIA | Straightforward text generation | $0.04/$0.16 | Mistral Small 24B |
| **Candidate Screening** | Nemotron Nano 9B v2 | NVIDIA | Bulk processing, cost matters | $0.04/$0.16 | DeepSeek R1 Distill 70B ($0.03 input) |
| **Voice Interview** | Parakeet-TDT-0.6B v2 + Nemotron Super 49B | NVIDIA | #1 ASR + quality analysis | Minimal + $0.10/$0.40 | Nemotron-Speech-Streaming (real-time) |
| **Content Safety** | NemoGuard-8B | NVIDIA | 23 safety categories, purpose-built | Minimal | Nemotron-Content-Safety-4B |
| **Compliance/Doc Review** | Kimi K2.5 | Moonshot | PDF-native, 256K context for long docs | Free trial | Nemotron Super 49B |

---

## 13. Recommended Architecture: 5-Model Strategy

Previous research recommended 3 models. With the full catalog visible, **5 models** covers everything:

| Role | Model | Provider | Monthly Cost Est. (10K interactions) |
|------|-------|----------|--------------------------------------|
| **Primary LLM** | Nemotron Super 49B v1.5 | NVIDIA | ~$15-40/mo |
| **Bulk/Simple Tasks** | Nemotron Nano 9B v2 | NVIDIA | ~$5-15/mo |
| **Embeddings + Matching** | NV-EmbedQA-1B-v2 + NV-RerankQA-1B-v2 | NVIDIA | ~$2-5/mo |
| **Document Parsing** | Nemotron-Parse | NVIDIA | ~$1-3/mo |
| **Voice/ASR** | Parakeet-TDT-0.6B v2 | NVIDIA | ~$1-2/mo |

**Estimated total: $24-65/month** vs **$775-2,210/month with GPT-4o** = **90-97% savings**

### When to Use Non-NVIDIA Models

| Scenario | Use Instead | Why |
|----------|------------|-----|
| Need 256K+ context for long documents | **Kimi K2.5** or **Step 3.5 Flash** | 256K context vs 128K on Nemotron |
| Need video analysis in interviews | **Kimi K2.5** | Native video understanding |
| Need ultra-cheap reasoning | **DeepSeek R1 Distill 70B** | $0.03/1M input tokens |
| Need multilingual (100+ languages) | **Qwen3-Next-80B** | 119 language support |
| Need advanced coding/automation | **Qwen3-Coder-480B** | Best coding benchmarks |
| Need reasoning for math/logic tests | **Step 3.5 Flash** | 97.3% AIME, 350 tok/s |
| Free prototyping of frontier models | **GPT-OSS-120B** or **Kimi K2.5** | Free on NIM trial |

---

## 14. API Compatibility

**ALL models on NIM use the OpenAI-compatible API format.** Migration from GPT-4o requires only changing:

```
base_url: "https://integrate.api.nvidia.com/v1"
model: "nvidia/llama-3.3-nemotron-super-49b-v1.5"  // or any other model
```

No code rewrite needed. Same `chat/completions` endpoint, same request/response format.

---

## 15. Key Differences from Previous Research (Report #16624)

| What Changed | Previous Report | This Report |
|-------------|----------------|-------------|
| **Providers covered** | NVIDIA only (Nemotron, Parakeet) | 25+ providers including Meta, DeepSeek, Moonshot, OpenAI, Qwen, etc. |
| **Total models** | 82 (mostly NVIDIA) | **210+ endpoints** across all providers |
| **Kimi K2.5** | Not mentioned | ✅ Fully cataloged — 1T param multimodal, available on NIM |
| **GPT-OSS** | Not mentioned | ✅ OpenAI's open models on NIM, Apache 2.0 |
| **Step 3.5 Flash** | Not mentioned | ✅ 97.3% AIME, best efficiency per parameter |
| **DeepSeek V3.1/V3.2** | Not mentioned | ✅ GPT-5 competitive, $0.28/1M tokens |
| **Strategy** | 3-model (all NVIDIA) | **5-model primary + situational non-NVIDIA models** |
| **Coding models** | None | Qwen3-Coder, Devstral, Code Llama, StarCoder |
| **Image generation** | None | Stable Diffusion 3.5, FLUX.1, Trellis |

---

## Sources

- [NVIDIA NIM Model Catalog](https://build.nvidia.com/models)
- [NVIDIA NIM Supported LLMs](https://docs.nvidia.com/nim/large-language-models/latest/supported-models.html)
- [Kimi K2.5 on NIM](https://build.nvidia.com/moonshotai/kimi-k2.5/modelcard)
- [DeepSeek V3.2 on NIM](https://build.nvidia.com/deepseek-ai/deepseek-v3_2/modelcard)
- [GPT-OSS-120B on NIM](https://build.nvidia.com/openai/gpt-oss-120b/modelcard)
- [Step 3.5 Flash on NIM](https://build.nvidia.com/stepfun-ai/step-3.5-flash/modelcard)
- [NVIDIA Nemotron Pricing (DeepInfra)](https://deepinfra.com/blog/nvidia-nemotron-api-pricing-guide-2026)
- [DeepSeek API Pricing](https://api-docs.deepseek.com/quick_start/pricing)
- [NVIDIA NIM FAQ](https://docs.api.nvidia.com/nim/docs/product)
- [NVIDIA Speech Models Blog](https://developer.nvidia.com/blog/nvidia-speech-ai-models-deliver-industry-leading-accuracy-and-performance/)
- [Kimi K2.5 NVIDIA Blog](https://developer.nvidia.com/blog/build-with-kimi-k2-5-multimodal-vlm-using-nvidia-gpu-accelerated-endpoints/)
- [OpenAI GPT-OSS NVIDIA Blog](https://developer.nvidia.com/blog/delivering-1-5-m-tps-inference-on-nvidia-gb200-nvl72-nvidia-accelerates-openai-gpt-oss-models-from-cloud-to-edge)
- [Qwen Models on NIM](https://build.nvidia.com/qwen)
- [Nemotron-Parse on NIM](https://build.nvidia.com/nvidia/nemotron-parse/modelcard)
- [pricepertoken.com NVIDIA pricing](https://pricepertoken.com/pricing-page/provider/nvidia)
