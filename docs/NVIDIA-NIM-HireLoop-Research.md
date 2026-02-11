# NVIDIA NIM Complete Model Catalog & HireLoop Integration Guide

> **Research Date:** February 11, 2026
> **Task:** #28037 — Phase 1 Deep Research
> **Purpose:** Catalog ALL NVIDIA NIM models, map to HireLoop's 15 modules, and provide migration guide for Engineering Phase 2

---

## Executive Summary

- **82+ models cataloged** on NVIDIA NIM (build.nvidia.com) across 10 categories: LLMs, VLMs, Speech/ASR, Embeddings, OCR/Document, Safety/Guardrails, Translation, Image Generation, Retrieval/Reranking, and Specialized
- **"3 Model Strategy"** covers all 15 HireLoop modules: Nemotron Super 49B ($0.10/$0.40 per M tokens), Nemotron Nano 9B ($0.04/$0.16), and NV-EmbedQA 1B
- **85–95% cost reduction** vs current OpenAI GPT-4o pricing ($2.50/$10.00 per M tokens)
- **Zero code rewrite required** — all NIM LLMs are 100% OpenAI-compatible (change `base_url` only)
- **Nemotron 3 family** (Nano 30B available now, Super ~100B and Ultra ~500B coming H1 2026) brings 1M context and 3.3x throughput improvements
- **Parakeet ASR** holds #1 on HuggingFace Open-ASR Leaderboard (6.05% WER) — enables voice interview differentiation

---

## Table of Contents

1. [Complete Model Catalog](#1-complete-model-catalog)
2. [Detailed Model Profiles — HireLoop Relevant](#2-detailed-model-profiles)
3. [HireLoop Module Mapping (All 15 Modules)](#3-hireloop-module-mapping)
4. [Cost Comparison Matrix: NIM vs OpenAI](#4-cost-comparison-matrix)
5. [Implementation Priority (P0–P3)](#5-implementation-priority)
6. [Migration Guide](#6-migration-guide)
7. [Rate Limits & Infrastructure](#7-rate-limits--infrastructure)
8. [Appendix: Full Model List](#8-appendix-full-model-list)

---

## 1. Complete Model Catalog

### 1A. Large Language Models (LLMs)

| Model | ID | Params | Context | Price (Input/Output per M) | Key Strengths | OpenAI Compatible |
|-------|----|--------|---------|---------------------------|---------------|-------------------|
| **Nemotron Super 49B v1.5** | `llama-3.3-nemotron-super-49b-v1.5` | 49B | 128K | $0.10 / $0.40 | Reasoning, tool calling, chat, instruction following. Tops Artificial Analysis Intelligence Index. | ✅ Yes |
| **Nemotron Super 49B v1** | `llama-3.3-nemotron-super-49b-v1` | 49B | 128K | $0.10 / $0.40 | Previous version, same architecture | ✅ Yes |
| **Nemotron Ultra 253B v1** | `llama-3.1-nemotron-ultra-253b-v1` | 253B | 128K | $0.60 / $1.80 | Best accuracy for scientific reasoning, math, coding. Matches DeepSeek-R1. | ✅ Yes |
| **Nemotron Nano 9B v2** | `nvidia-nemotron-nano-9b-v2` | 9B | 128K | $0.04 / $0.16 | Hybrid Transformer-Mamba. High efficiency for reasoning and agentic tasks. | ✅ Yes |
| **Nemotron Nano 8B v1** | `llama-3.1-nemotron-nano-8b-v1` | 8B | 128K | ~$0.04 / ~$0.16 | Leading edge/PC model for reasoning and agents | ✅ Yes |
| **Nemotron Nano 4B v1.1** | `llama-3.1-nemotron-nano-4b-v1.1` | 4B | 128K | ~$0.02 / ~$0.08 | Edge agents, reasoning, code, math, tool calling | ✅ Yes |
| **Nemotron Mini 4B Instruct** | `nemotron-mini-4b-instruct` | 4B | 4K | ~$0.02 / ~$0.08 | Roleplay, RAG, function calling. On-device optimized. | ✅ Yes |
| **Nemotron 3 Nano 30B-A3B** | `nemotron-3-nano-30b-a3b` | 30B (3.5B active) | **1M** | TBD (new) | MoE architecture. 3.3x throughput. Coding, reasoning, tool calling. | ✅ Yes |
| **ChatQA 1.5 8B** | `llama3-chatqa-1.5-8b` | 8B | 128K | ~$0.04 / ~$0.16 | Context-aware chatbot/search responses | ✅ Yes |
| **Nemotron Hindi 4B** | `nemotron-4-mini-hindi-4b-instruct` | 4B | 4K | ~$0.02 / ~$0.08 | Bilingual Hindi-English for on-device | ✅ Yes |
| **Mistral Nemo Minitron 8B** | `mistral-nemo-minitron-8b-base` | 8B | 128K | ~$0.04 / ~$0.16 | Chatbot and virtual assistant accuracy | ✅ Yes |
| **Teuken 7B** | `teuken-7b-instruct-commercial-v0.4` | 7B | 8K | ~$0.04 / ~$0.16 | 24 EU languages, culturally aligned | ✅ Yes |
| **USD Code** | `usdcode` | — | — | — | OpenUSD code generation (specialized) | ✅ Yes |

#### Third-Party LLMs on NIM (Notable)

| Model | ID | Params | Context | Price (Input/Output per M) | Key Strengths |
|-------|----|--------|---------|---------------------------|---------------|
| DeepSeek V3.2 | `deepseek-v3_2` | 685B | 128K | ~$0.50 / $2.00 | State-of-the-art reasoning, sparse attention |
| DeepSeek V3.1 Terminus | `deepseek-v3.1-terminus` | — | 128K | — | Hybrid think/non-think, function calling |
| Mistral Large 3 675B | `mistral-large-3-675b-instruct-2512` | 675B | 128K | — | MoE VLM, chat, agentic |
| Ministral 14B | `ministral-14b-instruct-2512` | 14B | 128K | — | General purpose VLM |
| Devstral 2 123B | `devstral-2-123b-instruct-2512` | 123B | 256K | — | Code model, deep reasoning |
| MiniMax M2.1 | `minimax-m2_1` | — | — | — | Multi-language coding, agent integration |
| MiniMax M2 | `minimax-m2` | 230B (10B active) | — | — | MoE reasoning, coding, tool-use |
| Step 3.5 Flash | `step-3.5-flash` | 200B | — | — | MoE reasoning engine for agentic AI |
| Kimi K2.5 | `kimi-k2.5` | 1T | — | — | Multimodal MoE, video/image understanding |
| Kimi K2 Thinking | `kimi-k2-thinking` | — | 256K | — | Open reasoning, INT4, tool use |
| Kimi K2 Instruct | `kimi-k2-instruct-0905` | — | 256K+ | — | Enhanced reasoning, longer context |
| GLM 4.7 | `glm4_7` | — | — | — | Agentic coding, tool use |
| Qwen3 Next 80B-A3B | `qwen3-next-80b-a3b-instruct` | 80B (3B active) | — | — | MoE, ultra-long context |
| Qwen3 Coder 480B-A35B | `qwen3-coder-480b-a35b-instruct` | 480B (35B active) | 256K | — | Agentic coding, browser use |
| Seed OSS 36B | `seed-oss-36b-instruct` | 36B | — | — | ByteDance. Long-context, reasoning, agents |
| GPT-OSS 20B | `gpt-oss-20b` | 20B | — | — | MoE text-only, math reasoning |
| GPT-OSS 120B | `gpt-oss-120b` | 120B | — | — | MoE reasoning LLM, fits 80GB GPU |
| Stockmark 2 100B | `stockmark-2-100b-instruct` | 100B | — | — | Japanese enterprise documents |
| Bielik 11B | `bielik-11b-v2.6-instruct` | 11B | — | — | Polish language specialist |
| Sarvam M | `sarvam-m` | — | — | — | Indian languages, hybrid reasoning |

### 1B. Vision Language Models (VLMs)

| Model | ID | Params | Key Capabilities | HireLoop Relevance |
|-------|----|--------|-----------------|-------------------|
| **Nemotron Nano 12B v2 VL** | `nemotron-nano-12b-v2-vl` | 12B | Multi-image/video understanding, visual Q&A, summarization | Resume/document scanning, video interview analysis |
| **Nemotron Parse** | `nemotron-parse` | — | Text/metadata extraction from images, OCR, table extraction | Resume parsing, HR document processing |
| **Nemotron Nano VL 8B** | `llama-3.1-nemotron-nano-vl-8b-v1` | 8B | Text+image understanding, informative responses | Document analysis, visual content |
| **Cosmos Reason2 8B** | `cosmos-reason2-8b` | 8B | Physical world understanding, structured reasoning on videos/images | Not directly relevant |
| **Cosmos Reason1 7B** | `cosmos-reason1-7b` | 7B | Physical AI and robotics reasoning | Not relevant |
| **Cosmos Nemotron 34B** | `cosmos-nemotron-34b` | 34B | Text/image/video multimodal understanding | Video interview analysis (future) |

### 1C. Speech & Audio Models

| Model | ID | Params | Key Capabilities | HireLoop Relevance |
|-------|----|--------|-----------------|-------------------|
| **Parakeet TDT 0.6B v2** | `parakeet-tdt-0.6b-v2` | 0.6B | English ASR, #1 on HF leaderboard (6.05% WER), timestamps | **Voice interviews, real-time transcription** |
| **Parakeet CTC 1.1B** | `parakeet-ctc-1.1b-asr` | 1.1B | English transcription, record-setting accuracy | High-accuracy transcription |
| **Parakeet CTC 0.6B (English)** | `parakeet-ctc-0.6b-asr` | 0.6B | English STT, state-of-the-art accuracy and speed | Lightweight English ASR |
| **Parakeet CTC 0.6B (Spanish)** | `parakeet-ctc-0.6b-es` | 0.6B | Spanish+English transcription with timestamps | Multilingual interviews |
| **Parakeet CTC 0.6B (Vietnamese)** | `parakeet-ctc-0.6b-vi` | 0.6B | Vietnamese+English transcription | Multilingual interviews |
| **Parakeet CTC 0.6B (Mandarin-TW)** | `parakeet-ctc-0.6b-zh-tw` | 0.6B | Mandarin/Taiwanese/English transcription | Multilingual interviews |
| **Parakeet CTC 0.6B (Mandarin-CN)** | `parakeet-ctc-0.6b-zh-cn` | 0.6B | Mandarin/English transcription | Multilingual interviews |
| **Parakeet Multilingual 1.1B** | `parakeet-1.1b-rnnt-multilingual-asr` | 1.1B | 25-language transcription | Multilingual support |
| **Canary 1B ASR** | `canary-1b-asr` | 1B | Multi-lingual speech-to-text recognition + translation | Multilingual interviews |
| **Magpie TTS Flow** | `magpie-tts-flow` | — | Expressive TTS from short audio sample | AI coaching voice feedback |
| **Magpie TTS Multilingual** | `magpie-tts-multilingual` | — | Natural TTS in multiple languages | Voice agents, brand ambassadors |
| **Magpie TTS Zero-shot** | `magpie-tts-zeroshot` | — | TTS from short audio sample | Voice cloning for coaching |
| **Maxine Speech Enhancement** | Background Noise Removal | — | Removes unwanted noise from audio | Interview audio cleanup |
| **StudioVoice** | `studiovoice` | — | Corrects audio degradations to studio quality | Interview recording enhancement |
| **Audio2Face 3D** | `audio2face-3d` | — | Audio to facial blendshapes for lip-sync | AI avatar (future) |

### 1D. Embedding & Retrieval Models

| Model | ID | Params | Dimensions | Key Capabilities | HireLoop Relevance |
|-------|----|--------|-----------|-----------------|-------------------|
| **NV-Embed-v1** | `nv-embed-v1` | 7.1B | 4096 | #1 on MTEB (score 69.32), 56-task generalist, 32K context | **Premium candidate matching** |
| **NV-EmbedQA-E5-v5** | `nv-embedqa-e5-v5` | ~335M | 1024 | English text QA retrieval, optimized for question-answering | **Standard candidate matching, search** |
| **NV-EmbedQA 1B v2** | `llama-3.2-nv-embedqa-1b-v2` | 1B | 4096 | Multilingual, cross-lingual, long context, optimized storage | **Primary embedding model for matching** |
| **NemoRetriever Embed 300M v2** | `llama-3_2-nemoretriever-300m-embed-v2` | 300M | — | Multilingual, 26 languages, long-document QA | Multilingual job matching |
| **NemoRetriever Embed 300M v1** | `llama-3_2-nemoretriever-300m-embed-v1` | 300M | — | Multilingual, 26 languages | Multilingual matching |
| **Nemotron Embed VL 1B v2** | `llama-nemotron-embed-vl-1b-v2` | 1B | — | Multimodal QA retrieval (text queries → image documents) | Document image retrieval |
| **NemoRetriever VLM Embed 1B** | `llama-3.2-nemoretriever-1b-vlm-embed-v1` | 1B | — | Multimodal question-answer retrieval | Visual document retrieval |
| **NV-EmbedCode 7B** | `nv-embedcode-7b-v1` | 7B | 4096 | Code retrieval (text, code, hybrid queries) | Tech assessment code search |
| **NV-CLIP** | `nvclip` | — | — | Multimodal embeddings (image + text) | Profile photo matching (edge) |

### 1E. Reranking Models

| Model | ID | Params | Key Capabilities | HireLoop Relevance |
|-------|----|--------|-----------------|-------------------|
| **NV-RerankQA 1B v2** | `llama-3.2-nv-rerankqa-1b-v2` | 1B | Multilingual, cross-lingual reranking, long context | **Search result reranking** |
| **NemoRetriever Rerank 500M v2** | `llama-3.2-nemoretriever-500m-rerank-v2` | 500M | Passage relevance scoring for QA | Job/candidate reranking |
| **Rerank QA Mistral 4B** | `rerank-qa-mistral-4b` | 4B | GPU-accelerated passage relevance scoring | Premium reranking |

### 1F. OCR & Document Processing Models

| Model | ID | Key Capabilities | HireLoop Relevance |
|-------|----|-----------------|-------------------|
| **NemoRetriever OCR v1** | `nemoretriever-ocr-v1` | End-to-end OCR: detection, recognition, layout analysis. Real-world images. | **Resume parsing, document extraction** |
| **NemoRetriever OCR** (legacy) | `nemoretriever-ocr` | Earlier version of OCR model | Resume parsing |
| **NemoRetriever Parse** | `nemoretriever-parse` | VLM for text/metadata extraction from images | Document intelligence |
| **NemoRetriever Page Elements v3** | `nemoretriever-page-elements-v3` | Detects charts, tables, titles in documents | Document structure analysis |
| **NemoRetriever Page Elements v2** | `nemoretriever-page-elements-v2` | Earlier version | Document structure |
| **NV-YOLOX Page Elements** | `nv-yolox-page-elements-v1` | Object detection for document elements | Document structure |
| **NemoRetriever Graphic Elements** | `nemoretriever-graphic-elements-v1` | Detects charts, tables, titles | Document graphics |
| **NemoRetriever Table Structure** | `nemoretriever-table-structure-v1` | Table detection and structure analysis | Table extraction from resumes |
| **OCDR-Net** | `ocdrnet` | Optical character detection and recognition | Text detection |
| **Grounding DINO** | `nv-grounding-dino` | Zero-shot object detection | Document element detection |

### 1G. Safety & Guardrails Models

| Model | ID | Params | Key Capabilities | HireLoop Relevance |
|-------|----|--------|-----------------|-------------------|
| **Nemotron Content Safety Reasoning 4B** | `nemotron-content-safety-reasoning-4b` | 4B | Context-aware safety with reasoning, domain-specific policies | **Content moderation for interviews/chat** |
| **NemoGuard Safety 8B v3** | `llama-3.1-nemotron-safety-guard-8b-v3` | 8B | Leading multilingual content safety for LLMs | Safety layer for all AI outputs |
| **NemoGuard Content Safety 8B** | `llama-3.1-nemoguard-8b-content-safety` | 8B | Content safety and moderation | Backup safety model |
| **NemoGuard Topic Control 8B** | `llama-3.1-nemoguard-8b-topic-control` | 8B | Keeps conversations on approved topics | Interview topic guardrails |
| **NemoGuard Jailbreak Detect** | `nemoguard-jailbreak-detect` | — | Adversarial attack detection | Security for AI endpoints |

### 1H. Translation Models

| Model | ID | Params | Languages | HireLoop Relevance |
|-------|----|--------|----------|-------------------|
| **Riva Translate 4B v1.1** | `riva-translate-4b-instruct-v1_1` | 4B | 12 languages, few-shot | Multilingual job postings |
| **Riva Translate 1.6B** | `riva-translate-1.6b` | 1.6B | 36 languages | Broader language support |
| **Megatron 1B NMT** | `megatron-1b-nmt` | 1B | 36 languages | Translation service |

### 1I. Image Generation Models

| Model | ID | Key Capabilities | HireLoop Relevance |
|-------|----|-----------------|-------------------|
| Stable Diffusion 3.5 Large | `stable-diffusion-3.5-large` | Text-to-image generation | Low (profile avatars, branding) |
| FLUX.1 Kontext Dev | `flux_1-kontext-dev` | In-context image gen/editing | Low |
| TRELLIS | `trellis` | 3D asset generation | Not relevant |

### 1J. Specialized / Domain Models

| Model | ID | Category | HireLoop Relevance |
|-------|----|---------|-------------------|
| OpenFold3 | `openfold3` | Protein structure prediction | Not relevant |
| CuOpt | `cuopt` | Route optimization | Not relevant |
| CorrDiff | `corrdiff` | Weather prediction | Not relevant |
| FourCastNet | `fourcastnet` | Weather prediction | Not relevant |
| VISTA-3D | `vista-3d` | Medical imaging | Not relevant |
| MAISI | `maisi` | Medical imaging | Not relevant |
| GenMol | `genmol` | Molecule generation | Not relevant |
| MolMIM | `molmim` | Molecule generation | Not relevant |
| StreamPETR | `streampetr` | Autonomous driving | Not relevant |
| SparseDrive | `sparsedrive` | Autonomous driving | Not relevant |
| BEVFormer | `bevformer` | Autonomous driving | Not relevant |
| Visual ChangeNet | `visual-changenet` | Change detection | Not relevant |
| Retail Object Detection | `retail-object-detection` | Retail detection | Not relevant |
| EyeContact | `eyecontact` | Gaze correction in video | **Video interviews (P3)** |
| Cosmos Predict1 5B | `cosmos-predict1-5b` | Video generation | Not relevant |
| Cosmos Transfer1 7B | `cosmos-transfer1-7b` | Video world state generation | Not relevant |
| USD Search/Validate | `usdsearch` / `usdvalidate` | 3D asset search/validation | Not relevant |
| NV-DINOv2 | `nv-dinov2` | Visual embeddings | Low |

### 1K. Reward Models

| Model | ID | Params | Key Capabilities | HireLoop Relevance |
|-------|----|--------|-----------------|-------------------|
| **Nemotron 70B Reward** | `llama-3.1-nemotron-70b-reward` | 70B | RLHF reward model, leaderboard-topping | Fine-tuning alignment (advanced) |

---

## 2. Detailed Model Profiles — HireLoop Relevant

### 2A. Nemotron Super 49B v1.5 — PRIMARY BRAIN

**The workhorse.** This model handles all complex AI tasks in HireLoop.

| Attribute | Value |
|-----------|-------|
| **Model ID** | `llama-3.3-nemotron-super-49b-v1.5` |
| **Parameters** | 49B (pruned from 70B via NAS) |
| **Context Window** | 128K tokens |
| **Price** | $0.10 input / $0.40 output per M tokens |
| **vs GPT-4o** | **25x cheaper input, 25x cheaper output** |
| **Architecture** | Llama 3.3 derivative, Neural Architecture Search optimized |
| **Fits on** | Single H200 GPU |
| **OpenAI Compatible** | ✅ Full streaming, tool calling, function calling |
| **Reasoning Mode** | Supports think/non-think toggle |

**Benchmarks:**
- Intelligence Index: 14/20 (Artificial Analysis) — #10 overall
- Arena Hard: 92.7 (multi-agent system)
- Tops Artificial Analysis Intelligence Index leaderboard (v1.5)
- Outperforms GPT-4o on Arena Hard, AlpacaEval, MT-Bench
- Competitive on GPQA Diamond, AIME 2024/2025, MATH-500, BFCL

**Best for:** Mock interviews, AI coaching, document generation, complex assessment grading, offer letter drafting, analytics insights.

### 2B. Nemotron Nano 9B v2 — FAST WORKER

**The efficiency king.** Handles high-volume, lower-complexity tasks.

| Attribute | Value |
|-----------|-------|
| **Model ID** | `nvidia-nemotron-nano-9b-v2` |
| **Parameters** | 9B |
| **Context Window** | 128K tokens |
| **Price** | $0.04 input / $0.16 output per M tokens |
| **vs GPT-4o** | **63x cheaper input, 63x cheaper output** |
| **Architecture** | Hybrid Transformer-Mamba design |
| **OpenAI Compatible** | ✅ Full streaming support |

**Best for:** Resume screening, JD generation, onboarding Q&A, bulk candidate communications, analytics summaries, form auto-fill.

### 2C. Nemotron 3 Nano 30B-A3B — NEXT-GEN EFFICIENCY

**New.** Best throughput-to-intelligence ratio. Only 3.5B active parameters with 30B total MoE.

| Attribute | Value |
|-----------|-------|
| **Model ID** | `nemotron-3-nano-30b-a3b` |
| **Parameters** | 30B total / 3.5B active (MoE) |
| **Context Window** | **1,000,000 tokens** |
| **Price** | TBD (just released Dec 2025) |
| **Architecture** | Hybrid Mamba-2 + Transformer MoE (128 routed experts + 1 shared, 6 active/token) |
| **Throughput** | 3.3x faster than comparable models |
| **OpenAI Compatible** | ✅ Yes |

**Why it matters:** 1M context window means entire candidate profiles + job descriptions + interview transcripts in a single call. Future candidate for replacing Nano 9B.

### 2D. NV-EmbedQA 1B v2 — MATCHMAKER

**Candidate-job matching engine.**

| Attribute | Value |
|-----------|-------|
| **Model ID** | `llama-3.2-nv-embedqa-1b-v2` |
| **Parameters** | 1B |
| **Dimensions** | 4096 |
| **Context** | Long-document support |
| **Languages** | Multilingual, cross-lingual (26+ languages) |
| **Price** | Minimal (embedding calls are very cheap) |
| **OpenAI Compatible** | ✅ (embeddings endpoint) |

**Best for:** Candidate-job matching, semantic search across resumes/JDs, document retrieval.

### 2E. NemoRetriever OCR v1 — DOCUMENT READER

| Attribute | Value |
|-----------|-------|
| **Model ID** | `nemoretriever-ocr-v1` |
| **Architecture** | Detector (RegNetY-8GF) + Transformer recognizer + Relational model |
| **Capabilities** | Multi-line, multi-block, scene text, layout analysis, reading order |
| **Price** | Included in NIM tier |

**Best for:** Resume PDF parsing, HR document extraction, certificate/credential scanning.

### 2F. Parakeet TDT 0.6B v2 — VOICE ENGINE

| Attribute | Value |
|-----------|-------|
| **Model ID** | `parakeet-tdt-0.6b-v2` |
| **Parameters** | 0.6B |
| **WER** | 6.05% (#1 on HuggingFace Open-ASR Leaderboard) |
| **Speed** | RTFx 3386 (56 min of audio per second) |
| **Features** | Punctuation, capitalization, word timestamps |
| **Language** | English |

**Best for:** Real-time voice interview transcription, AI mock interview audio processing.

### 2G. Safety Models

| Model | Best Use |
|-------|---------|
| **Nemotron Content Safety Reasoning 4B** | Context-aware moderation (newest, best for domain policies) |
| **NemoGuard Safety Guard 8B v3** | Multilingual content safety layer |
| **NemoGuard Topic Control 8B** | Keep interview conversations on-topic |
| **NemoGuard Jailbreak Detect** | Prevent prompt injection attacks |

---

## 3. HireLoop Module Mapping (All 15 Modules)

### Module 1: Job Listings & Search

| Aspect | Recommendation |
|--------|---------------|
| **Primary Model** | Nemotron Nano 9B v2 |
| **Use Cases** | JD generation, search query understanding, job categorization |
| **Embedding** | NV-EmbedQA 1B v2 (semantic job search) |
| **Reranker** | NV-RerankQA 1B v2 (search result ordering) |
| **Why** | JD generation is templated/structured — doesn't need 49B intelligence. Nano 9B handles this at 63x cheaper than GPT-4o. |
| **Est. Monthly Cost** | ~$2–5 (vs ~$50–125 with GPT-4o) |
| **Migration** | Simple — swap base_url for JD generation endpoint |

### Module 2: Application Submission

| Aspect | Recommendation |
|--------|---------------|
| **Primary Model** | Nemotron Nano 9B v2 |
| **OCR** | NemoRetriever OCR v1 (resume parsing) |
| **Use Cases** | Resume parsing, form auto-fill, application validation |
| **Why** | Bulk processing (every application). OCR handles document extraction, Nano 9B structures the data. |
| **Est. Monthly Cost** | ~$3–8 (vs ~$75–200 with GPT-4o) |
| **Migration** | Medium — need to add OCR pipeline alongside LLM swap |

### Module 3: Candidate Dashboard

| Aspect | Recommendation |
|--------|---------------|
| **Primary Model** | Nemotron Nano 9B v2 |
| **Use Cases** | Status summaries, application tips, personalized insights |
| **Why** | Low-complexity text generation. Nano 9B is more than sufficient. |
| **Est. Monthly Cost** | ~$1–3 |
| **Migration** | Simple — base_url swap |

### Module 4: Recruiter Dashboard

| Aspect | Recommendation |
|--------|---------------|
| **Primary Model** | Nemotron Super 49B v1.5 |
| **Fallback** | Nemotron Nano 9B v2 (for simple summaries) |
| **Use Cases** | Candidate ranking insights, pipeline analysis, smart filters, comparative analysis |
| **Why** | Recruiters need nuanced analysis — Super 49B's reasoning capability matters here. |
| **Est. Monthly Cost** | ~$5–15 |
| **Migration** | Simple — base_url swap |

### Module 5: Offer Management

| Aspect | Recommendation |
|--------|---------------|
| **Primary Model** | Nemotron Super 49B v1.5 |
| **Use Cases** | Offer letter generation, salary benchmarking analysis, negotiation coaching, compliance checks |
| **Why** | Legal/financial precision requires stronger reasoning. Super 49B handles nuance well. |
| **Est. Monthly Cost** | ~$2–5 |
| **Migration** | Simple — base_url swap |

### Module 6: Interview Scheduling

| Aspect | Recommendation |
|--------|---------------|
| **Primary Model** | Nemotron Nano 9B v2 |
| **Use Cases** | Natural language scheduling, availability parsing, reminder generation |
| **Why** | Structured task, doesn't need heavy reasoning. |
| **Est. Monthly Cost** | ~$1–2 |
| **Migration** | Simple — base_url swap |

### Module 7: Video Communication

| Aspect | Recommendation |
|--------|---------------|
| **Primary Model** | Nemotron Super 49B v1.5 (analysis) |
| **ASR** | Parakeet TDT 0.6B v2 (real-time transcription) |
| **Speech Enhancement** | Maxine Background Noise Removal |
| **Future** | EyeContact (gaze correction), Audio2Face 3D (AI avatar) |
| **Use Cases** | Live transcription, meeting summaries, noise reduction |
| **Why** | Parakeet's 6.05% WER and 50x real-time speed enable live interview transcription. Super 49B generates meeting summaries. |
| **Est. Monthly Cost** | ~$5–15 (mainly compute for ASR) |
| **Migration** | Complex — new ASR pipeline needed |

### Module 8: AI Mock Interview & Coaching ⭐ P0

| Aspect | Recommendation |
|--------|---------------|
| **Primary Model** | **Nemotron Super 49B v1.5** |
| **ASR** | Parakeet TDT 0.6B v2 (voice interviews) |
| **TTS** | Magpie TTS Flow (voice feedback) |
| **Safety** | NemoGuard Topic Control 8B |
| **Use Cases** | Question generation, real-time feedback, behavioral analysis, scoring, coaching tips |
| **Why** | **This is HireLoop's differentiator.** Needs the best reasoning model. Super 49B matches GPT-4o quality at 25x less cost. Also fixes existing token limit/truncation bugs (128K context vs current limits). |
| **Est. Monthly Cost** | ~$10–30 (vs ~$250–750 with GPT-4o) |
| **Migration** | Simple for text — base_url swap. Medium for voice — new ASR/TTS pipeline. |

### Module 9: Onboarding (AI-automated)

| Aspect | Recommendation |
|--------|---------------|
| **Primary Model** | Nemotron Nano 9B v2 |
| **OCR** | NemoRetriever OCR v1 (document processing) |
| **Use Cases** | Onboarding checklist generation, document verification, Q&A chatbot, training material summaries |
| **Why** | Structured, repetitive tasks. Nano 9B with OCR covers everything. |
| **Est. Monthly Cost** | ~$2–5 |
| **Migration** | Simple for chat, Medium for document pipeline |

### Module 10: Payroll

| Aspect | Recommendation |
|--------|---------------|
| **Primary Model** | Nemotron Nano 9B v2 |
| **Use Cases** | Pay stub explanations, tax form assistance, payroll FAQ, calculation verification |
| **Why** | Mostly structured data + templates. Doesn't need heavy reasoning. |
| **Est. Monthly Cost** | ~$1–3 |
| **Migration** | Simple — base_url swap |

### Module 11: Assessments/Skill Tests

| Aspect | Recommendation |
|--------|---------------|
| **Primary Model** | Nemotron Super 49B v1.5 (grading + generation) |
| **Code Embedding** | NV-EmbedCode 7B (code similarity search) |
| **Fallback** | Nemotron Nano 9B v2 (multiple choice grading) |
| **Use Cases** | Test question generation, code evaluation, essay grading, skill gap analysis |
| **Why** | Grading requires nuanced understanding. Super 49B for open-ended, Nano 9B for structured. |
| **Est. Monthly Cost** | ~$5–15 |
| **Migration** | Simple — base_url swap |

### Module 12: Profile Management

| Aspect | Recommendation |
|--------|---------------|
| **Primary Model** | Nemotron Nano 9B v2 |
| **Embedding** | NV-EmbedQA 1B v2 (profile search) |
| **Use Cases** | Profile suggestions, skill tagging, bio generation, duplicate detection |
| **Why** | Low-complexity text processing. Embeddings handle deduplication/search. |
| **Est. Monthly Cost** | ~$1–3 |
| **Migration** | Simple — base_url swap |

### Module 13: HR Document Tracking

| Aspect | Recommendation |
|--------|---------------|
| **Primary Model** | Nemotron Nano 9B v2 |
| **OCR** | NemoRetriever OCR v1 |
| **Document Layout** | NemoRetriever Page Elements v3 |
| **Use Cases** | Document classification, expiry tracking, compliance checks, data extraction |
| **Why** | OCR + layout models handle extraction. Nano 9B classifies and summarizes. |
| **Est. Monthly Cost** | ~$2–5 |
| **Migration** | Medium — new OCR/document pipeline |

### Module 14: AI Matching/Ranking ⭐ P1

| Aspect | Recommendation |
|--------|---------------|
| **Primary Model** | NV-EmbedQA 1B v2 (embeddings) |
| **Reranker** | NV-RerankQA 1B v2 |
| **Analysis** | Nemotron Super 49B v1.5 (explanation generation) |
| **Use Cases** | Candidate-job matching, ranking, match explanation, skills gap analysis |
| **Why** | Embedding-based matching is faster and more accurate than pure LLM matching. Reranker refines results. Super 49B explains why. |
| **Est. Monthly Cost** | ~$5–10 |
| **Migration** | Medium — new embedding pipeline + reranker integration |

### Module 15: Analytics & Reporting

| Aspect | Recommendation |
|--------|---------------|
| **Primary Model** | Nemotron Nano 9B v2 |
| **Fallback** | Nemotron Super 49B v1.5 (complex analysis) |
| **Use Cases** | Report narratives, trend analysis, KPI explanations, predictive insights |
| **Why** | Standard reporting uses Nano 9B. Deep analysis escalates to Super 49B. |
| **Est. Monthly Cost** | ~$2–5 |
| **Migration** | Simple — base_url swap |

---

## 4. Cost Comparison Matrix

### Per-Model Pricing: NIM vs OpenAI

| Model | Input / M Tokens | Output / M Tokens | vs GPT-4o Savings |
|-------|-----------------|-------------------|-------------------|
| **GPT-4o** (current) | $2.50 | $10.00 | Baseline |
| **GPT-4o-mini** (current) | $0.15 | $0.60 | 94% cheaper |
| **Nemotron Super 49B v1.5** | $0.10 | $0.40 | **96% cheaper** |
| **Nemotron Nano 9B v2** | $0.04 | $0.16 | **98.4% cheaper** |
| **Nemotron Ultra 253B** | $0.60 | $1.80 | 76% cheaper |
| **Nemotron Nano 12B VL** | $0.20 | $0.60 | 92% cheaper |

### Estimated Monthly Cost by Module

| Module | Current (GPT-4o est.) | NIM (Primary) | NIM (Full Stack) | Savings |
|--------|----------------------|---------------|-------------------|---------|
| 1. Job Listings & Search | $50–125 | $2–5 | $3–7 | ~95% |
| 2. Application Submission | $75–200 | $3–8 | $5–12 | ~94% |
| 3. Candidate Dashboard | $25–60 | $1–3 | $1–3 | ~96% |
| 4. Recruiter Dashboard | $50–150 | $5–15 | $5–15 | ~90% |
| 5. Offer Management | $25–75 | $2–5 | $2–5 | ~93% |
| 6. Interview Scheduling | $15–40 | $1–2 | $1–2 | ~95% |
| 7. Video Communication | $50–150 | $5–15 | $8–20 | ~87% |
| 8. **Mock Interview & Coaching** | **$250–750** | **$10–30** | **$15–40** | **~95%** |
| 9. Onboarding | $30–80 | $2–5 | $3–8 | ~93% |
| 10. Payroll | $15–40 | $1–3 | $1–3 | ~95% |
| 11. Assessments/Skill Tests | $50–150 | $5–15 | $5–15 | ~90% |
| 12. Profile Management | $15–40 | $1–3 | $1–3 | ~95% |
| 13. HR Document Tracking | $25–75 | $2–5 | $3–8 | ~92% |
| 14. **AI Matching/Ranking** | **$75–200** | **$5–10** | **$8–15** | **~93%** |
| 15. Analytics & Reporting | $25–75 | $2–5 | $2–5 | ~95% |
| **TOTAL ESTIMATED** | **$775–2,210/mo** | **$47–129/mo** | **$63–161/mo** | **~93%** |

> **Note:** Estimates assume moderate usage (1,000–10,000 active users). Actual costs depend on token volume. NIM "Full Stack" includes OCR, ASR, and embedding model costs.

### Cost Example: Mock Interview Session

| Step | GPT-4o Cost | NIM Cost | Model Used |
|------|------------|----------|------------|
| Generate 10 questions (~2K tokens out) | $0.020 | $0.0008 | Super 49B |
| Process 10 answers (~5K tokens in) | $0.013 | $0.0005 | Super 49B |
| Generate feedback (~3K tokens out) | $0.030 | $0.0012 | Super 49B |
| **Total per session** | **$0.063** | **$0.0025** | — |
| **1,000 sessions/month** | **$63** | **$2.50** | — |

---

## 5. Implementation Priority

### P0 — Immediate (Week 1–2)

**Mock Interview & Quick Practice Coaching → Nemotron Super 49B v1.5**

- **Why P0:** This is HireLoop's core differentiator AND has active token limit/truncation bugs that the 128K context window fixes.
- **Effort:** Simple base_url swap
- **Risk:** Low — OpenAI-compatible, same streaming behavior
- **Impact:** 95% cost reduction on highest-volume AI module + bug fix

**Migration steps:**
1. Change `base_url` from `https://api.openai.com/v1` to `https://integrate.api.nvidia.com/v1`
2. Change `model` from `gpt-4o` to `nvidia/llama-3.3-nemotron-super-49b-v1.5`
3. Set `NVIDIA_API_KEY` environment variable
4. Test streaming, tool calling, and response quality
5. A/B test for 48 hours before full cutover

### P1 — Near-term (Week 3–4)

**AI Matching/Ranking + Resume Parsing**

- **Matching:** Add NV-EmbedQA 1B v2 embeddings + NV-RerankQA 1B v2
- **OCR:** Add NemoRetriever OCR v1 pipeline for resume parsing
- **Effort:** Medium — new embedding pipeline + OCR integration
- **Why P1:** Matching quality improvement + OCR accuracy boost

### P2 — Mid-term (Month 2)

**All remaining LLM modules → Nemotron Nano 9B v2 / Super 49B v1.5**

Modules: Job Listings, Application Submission, Candidate Dashboard, Recruiter Dashboard, Offer Management, Interview Scheduling, Onboarding, Payroll, Assessments, Profile Management, HR Document Tracking, Analytics & Reporting.

- **Effort:** Simple per module — just base_url + model swaps
- **Strategy:** Route complex tasks to Super 49B, bulk tasks to Nano 9B

### P3 — Future (Month 3+)

**Voice Interviews + Content Safety + Advanced Features**

- **Parakeet TDT 0.6B v2** for real-time voice interview transcription
- **Magpie TTS** for AI coaching voice feedback
- **NemoGuard** safety models as moderation layer
- **EyeContact** for gaze correction in video interviews
- **Nemotron 3 Nano 30B-A3B** evaluation (1M context, 3.3x throughput)
- **Nemotron 3 Super/Ultra** when released (H1 2026)

---

## 6. Migration Guide

### 6A. The One-Line Migration (LLM Modules)

All NVIDIA NIM LLM endpoints are **100% OpenAI-compatible**. Migration is literally a configuration change:

```javascript
// BEFORE (OpenAI)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: 'https://api.openai.com/v1'
});
const response = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [...],
  stream: true
});

// AFTER (NVIDIA NIM)
const openai = new OpenAI({
  apiKey: process.env.NVIDIA_API_KEY,
  baseURL: 'https://integrate.api.nvidia.com/v1'
});
const response = await openai.chat.completions.create({
  model: 'nvidia/llama-3.3-nemotron-super-49b-v1.5',
  messages: [...],
  stream: true
});
```

**What stays the same:**
- ✅ Chat completions API format
- ✅ Streaming (SSE)
- ✅ Tool/function calling
- ✅ System/user/assistant message roles
- ✅ Temperature, top_p, max_tokens parameters
- ✅ JSON mode

**What changes:**
- 🔄 `base_url` → `https://integrate.api.nvidia.com/v1`
- 🔄 `apiKey` → NVIDIA API key
- 🔄 `model` → NVIDIA model ID (e.g., `nvidia/llama-3.3-nemotron-super-49b-v1.5`)

### 6B. Embedding Migration

```javascript
// BEFORE (OpenAI)
const embedding = await openai.embeddings.create({
  model: 'text-embedding-3-small',
  input: 'candidate resume text...'
});

// AFTER (NVIDIA NIM)
const nvidia = new OpenAI({
  apiKey: process.env.NVIDIA_API_KEY,
  baseURL: 'https://integrate.api.nvidia.com/v1'
});
const embedding = await nvidia.embeddings.create({
  model: 'nvidia/llama-3.2-nv-embedqa-1b-v2',
  input: 'candidate resume text...'
});
```

**Note:** Embedding dimensions differ (OpenAI text-embedding-3-small: 1536, NV-EmbedQA 1B v2: 4096). Re-indexing of vector database required.

### 6C. Smart Router Pattern

Recommended architecture: route requests to the right model based on complexity.

```javascript
function selectModel(task) {
  switch(task.complexity) {
    case 'high':   // Mock interviews, assessments, offers
      return 'nvidia/llama-3.3-nemotron-super-49b-v1.5';
    case 'medium': // Recruiter analysis, matching explanations
      return 'nvidia/llama-3.3-nemotron-super-49b-v1.5';
    case 'low':    // Screening, JDs, summaries, Q&A
      return 'nvidia/nvidia-nemotron-nano-9b-v2';
    default:
      return 'nvidia/nvidia-nemotron-nano-9b-v2';
  }
}
```

### 6D. Environment Variables

```env
# Add to .env
NVIDIA_API_KEY=nvapi-xxxxx
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
NVIDIA_MODEL_SMART=nvidia/llama-3.3-nemotron-super-49b-v1.5
NVIDIA_MODEL_FAST=nvidia/nvidia-nemotron-nano-9b-v2
NVIDIA_MODEL_EMBED=nvidia/llama-3.2-nv-embedqa-1b-v2
```

---

## 7. Rate Limits & Infrastructure

### Cloud API (NVIDIA API Catalog)

| Metric | Limit |
|--------|-------|
| Requests per minute | ~40 RPM (trial/free tier) |
| Tokens per minute | Not explicitly documented |
| Rate limit errors | 429 Too Many Requests |
| Free credits | Yes (developer program) |

### Self-Hosted NIM

| Metric | Limit |
|--------|-------|
| Requests per minute | **Unlimited** (user-managed) |
| Tokens per minute | **Hardware-limited only** |
| Licensing | NVIDIA AI Enterprise: $4,500/GPU/year or ~$1/GPU/hour cloud |

### Recommendations for HireLoop

1. **Start with Cloud API** — free credits for prototyping, then pay-per-use via providers like DeepInfra
2. **Move to self-hosted** when volume justifies it (likely at 50,000+ monthly users)
3. **Use DeepInfra** as primary provider — cheapest per-token pricing, reliable infrastructure
4. **Set up retry logic** for 429 errors with exponential backoff

### Provider Options

| Provider | Super 49B Price | Nano 9B Price | Pros |
|----------|----------------|---------------|------|
| **DeepInfra** | $0.10 / $0.40 | $0.04 / $0.16 | Cheapest, reliable |
| **NVIDIA API Catalog** | Free (credits) | Free (credits) | Direct, free prototyping |
| **Self-hosted (NVAIE)** | ~$1/GPU/hour | ~$1/GPU/hour | Unlimited throughput |
| **Together AI** | ~$0.12 / $0.48 | ~$0.05 / $0.20 | Good alternative |
| **Fireworks AI** | ~$0.15 / $0.60 | ~$0.06 / $0.24 | Low latency |

---

## 8. Appendix: Full Model List

### Summary Statistics

| Category | Count | HireLoop Relevant |
|----------|-------|-------------------|
| LLMs (NVIDIA) | 13+ | ✅ 6 directly useful |
| LLMs (Third-party on NIM) | 20+ | ⚡ Alternatives available |
| Vision Language Models | 6 | ✅ 3 useful |
| Speech & Audio | 15+ | ✅ 8 useful |
| Embeddings & Retrieval | 9 | ✅ 5 critical |
| Reranking | 3 | ✅ 2 useful |
| OCR & Document | 10 | ✅ 4 critical |
| Safety & Guardrails | 5 | ✅ 4 useful |
| Translation | 3 | ✅ All useful |
| Image Generation | 3 | ⚡ Low priority |
| Specialized/Domain | 15+ | ❌ Not relevant |
| Reward Models | 1 | ⚡ Advanced use |
| **TOTAL** | **82+** | **~40 directly useful** |

### Key Model IDs for Engineering (Copy-Paste Ready)

```
# Primary Stack (covers 95% of use cases)
nvidia/llama-3.3-nemotron-super-49b-v1.5    # Complex tasks
nvidia/nvidia-nemotron-nano-9b-v2             # Bulk tasks
nvidia/llama-3.2-nv-embedqa-1b-v2            # Embeddings
nvidia/llama-3.2-nv-rerankqa-1b-v2           # Reranking

# Document Processing
nvidia/nemoretriever-ocr-v1                   # Resume/document OCR
nvidia/nemoretriever-page-elements-v3         # Document layout
nvidia/nemotron-parse                         # Image → text/metadata

# Speech (P3)
nvidia/parakeet-tdt-0.6b-v2                  # English ASR (#1 accuracy)
nvidia/parakeet-1.1b-rnnt-multilingual-asr   # 25-language ASR

# Safety
nvidia/nemotron-content-safety-reasoning-4b  # Content moderation
nvidia/llama-3.1-nemoguard-8b-topic-control  # Topic guardrails

# Future Evaluation
nvidia/nemotron-3-nano-30b-a3b               # 1M context, MoE
nvidia/llama-3.1-nemotron-ultra-253b-v1      # Maximum accuracy
```

---

## Sources

- [NVIDIA NIM API Catalog — build.nvidia.com/models](https://build.nvidia.com/models)
- [NVIDIA NIM for LLMs Documentation](https://docs.nvidia.com/nim/large-language-models/latest/models.html)
- [DeepInfra NVIDIA Nemotron Pricing Guide 2026](https://deepinfra.com/blog/nvidia-nemotron-api-pricing-guide-2026)
- [Artificial Analysis — Llama Nemotron Super 49B](https://artificialanalysis.ai/models/llama-3-3-nemotron-super-49b)
- [Artificial Analysis — Nemotron Ultra 253B](https://artificialanalysis.ai/models/llama-3-1-nemotron-ultra-253b-v1-reasoning)
- [NVIDIA Nemotron 3 Research Page](https://research.nvidia.com/labs/nemotron/Nemotron-3/)
- [NVIDIA Parakeet TDT 0.6B v2 — HuggingFace](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2)
- [NVIDIA NIM API Reference](https://docs.nvidia.com/nim/large-language-models/latest/api-reference.html)
- [OpenAI API Pricing](https://openai.com/api/pricing/)
- [NVIDIA Developer Blog — Nemotron Super v1.5](https://developer.nvidia.com/blog/build-more-accurate-and-efficient-ai-agents-with-the-new-nvidia-llama-nemotron-super-v1-5/)
- [NVIDIA NIM NeMo Retriever Text Embedding](https://docs.nvidia.com/nim/nemo-retriever/text-embedding/latest/overview.html)
- [NVIDIA NemoRetriever OCR v1](https://build.nvidia.com/nvidia/nemoretriever-ocr-v1)
- [NVIDIA Speech AI Models Blog](https://developer.nvidia.com/blog/nvidia-speech-ai-models-deliver-industry-leading-accuracy-and-performance/)

---

*Research compiled from NVIDIA NIM API Catalog (build.nvidia.com) and provider documentation, February 2026.*
