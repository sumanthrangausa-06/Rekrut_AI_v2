/**
 * AI Provider Fallback Service — Comprehensive Multi-Provider System
 *
 * Provides automatic failover between AI providers per modality.
 * When a provider fails (401, 402, 429, timeout), automatically
 * switches to the next provider in the chain. No manual intervention.
 *
 * Modalities: LLM, TTS, ASR, Vision, Embedding, Reranking, Safety
 * Providers: Polsia/Anthropic, Polsia/OpenAI, NVIDIA NIM (20+ models)
 *
 * Per-module routing: Different HireLoop modules can request specialized
 * chains optimized for their use case (e.g., reasoning models for assessments,
 * cheap models for bulk onboarding, multimodal for resume parsing).
 */

const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const fetch = require('node-fetch');
const FormData = require('form-data');
const tokenBudget = require('./token-budget');
const pool = require('./db');

let activityLogger;
try {
  activityLogger = require('./activity-logger');
} catch (e) {
  activityLogger = { logAICall: () => {}, logFailover: () => {}, logBudgetExhausted: () => {} };
}

let aiCallLogger;
try {
  aiCallLogger = require('./ai-call-logger');
} catch (e) {
  aiCallLogger = { logCall: () => {}, shouldThrottle: () => false };
}

let selfHostedAudio;
try {
  selfHostedAudio = require('./self-hosted-audio');
} catch (e) {
  selfHostedAudio = null;
}

// Circuit breaker: skip providers that failed recently
const CIRCUIT_BREAK_MS = 5 * 60 * 1000; // 5 minutes
// Extended circuit break for geo-blocked providers (30 min — these won't magically start working)
const GEO_BLOCK_CIRCUIT_MS = 30 * 60 * 1000;

// HTTP status codes that indicate provider-level issues (retryable)
// 400 included: Polsia proxy wraps upstream provider errors (e.g., Gemini "User location
// not supported") as 400 with code: 'proxy_error'. Must not abort the fallback chain.
// 404 included: NIM audio endpoints return 404 (not available on cloud API),
// must not abort the entire fallback chain — try the next provider instead.
const RETRYABLE_STATUS = new Set([400, 401, 402, 404, 429, 500, 502, 503, 504]);

// ─── TIMEOUT CASCADE FIX (Feb 15, 2026) ──────────────────────────
// BUG: Sequential fallback through 12 LLM providers × 15s timeout = 180s worst case.
// FIX: (1) Cap total wall-clock time per modality, (2) Race top N providers in parallel.

// Total cascade timeout — absolute max wall-clock time for the entire execute() call
const TOTAL_CASCADE_TIMEOUT = {
  llm: 30000,       // 30s max (was unlimited → 12×15s = 180s worst case)
  vision: 40000,     // 40s max (was unlimited → 3×30s = 90s worst case)
  tts: 20000,        // 20s
  asr: 20000,        // 20s
  embedding: 15000,  // 15s
  reranking: 10000,  // 10s
  safety: 10000,     // 10s
};

// Number of providers to race in parallel (first N in chain)
// Dramatically reduces latency when primary provider is slow/down
const PARALLEL_RACE_COUNT = {
  llm: 3,       // Race top 3 LLM providers simultaneously
  vision: 2,    // Race top 2 vision providers
  tts: 1,       // Sequential (only 3 providers, different audio formats)
  asr: 1,       // Sequential (only 4 providers)
  embedding: 2, // Race top 2 embedding providers
  reranking: 1,
  safety: 1,
};

// ─── NIM Model Registry ──────────────────────────────────────────
// Complete catalog of NIM models — AUDITED Feb 13, 2026
// Dead models removed: kimi-k2.5, deepseek-v3p2/v3p1/r1, nano-8b-v2,
//   mistral-small-24b, qwen2.5-72b, cosmos-reason2-8b
const NIM_MODELS = {
  // LLM Models — ordered by response time (fastest first, from audit)
  llm_llama_8b: process.env.NIM_LLM_LLAMA_8B || 'meta/llama-3.1-8b-instruct',           // 151ms ✅
  llm_llama_70b: process.env.NIM_LLM_LLAMA_70B || 'meta/llama-3.3-70b-instruct',         // 197ms ✅
  llm_gpt_oss_20b: process.env.NIM_LLM_GPT_OSS_20B || 'openai/gpt-oss-20b',             // 256ms ✅
  llm_step_flash: process.env.NIM_LLM_STEP_FLASH || 'stepfun-ai/step-3.5-flash',         // 257ms ✅
  llm_nano_30b: process.env.NIM_LLM_NANO_30B || 'nvidia/nemotron-3-nano-30b-a3b',        // 283ms ✅
  llm_gpt_oss: process.env.NIM_LLM_GPT_OSS || 'openai/gpt-oss-120b',                    // 312ms ✅
  llm_ultra: process.env.NIM_LLM_ULTRA || 'nvidia/llama-3.1-nemotron-ultra-253b-v1',     // 368ms ✅
  llm_gemma: process.env.NIM_LLM_GEMMA || 'google/gemma-3-27b-it',                       // 428ms ✅
  llm_super: process.env.NIM_LLM_MODEL || 'nvidia/llama-3.3-nemotron-super-49b-v1',      // 534ms ✅

  // Reasoning Models — for assessments, complex evaluation
  reasoning_qwq: process.env.NIM_REASONING_QWQ || 'qwen/qwq-32b',                        // 2146ms ✅ (slow but working)

  // Vision Models — for body language, resume OCR, video analysis
  vision_nemotron_vl: process.env.NIM_VISION_FALLBACK_MODEL || 'nvidia/nemotron-nano-12b-v2-vl', // 207ms ✅
  vision_gemma: process.env.NIM_VISION_GEMMA || 'google/gemma-3-27b-it',                  // 357ms ✅

  // TTS Models — for speech synthesis (all use /v1/audio/synthesize REST API)
  tts_magpie_multilingual: 'nvidia/magpie-tts-multilingual',  // Multi-language: en, es, fr, de, zh, vi, it
  tts_magpie_flow: 'nvidia/magpie-tts-flow',                  // English voice cloning (requires audio prompt + transcript)
  tts_magpie_zeroshot: 'nvidia/magpie-tts-zeroshot',          // English voice cloning (requires audio prompt, restricted access)
  tts_fastpitch: 'nvidia/fastpitch-hifigan-tts',              // Basic English TTS (lightweight)

  // ASR Models — for speech recognition
  asr_parakeet_v2: process.env.NIM_ASR_MODEL || 'nvidia/parakeet-tdt-0.6b-v2',
  asr_parakeet_v3: process.env.NIM_ASR_V3 || 'nvidia/parakeet-tdt-0.6b-v3',

  // Embedding Models — for job matching, profile similarity
  embed_qa: process.env.NIM_EMBED_MODEL || 'nvidia/llama-3.2-nv-embedqa-1b-v2',
  embed_vl: process.env.NIM_EMBED_VL || 'nvidia/llama-nemotron-embed-vl-1b-v2',

  // Reranking Models — REMOVED Feb 13, 2026 (both 404 on NIM cloud API)
  // rerank_qa: 'nvidia/llama-3.2-nv-rerankqa-1b-v2',   // 404 DEAD
  // rerank_vl: 'nvidia/llama-nemotron-rerank-vl-1b-v2', // 404 DEAD

  // Safety Models — for content moderation
  safety_guard: process.env.NIM_SAFETY_MODEL || 'nvidia/llama-3.1-nemotron-safety-guard-8b-v3',
  safety_reasoning: process.env.NIM_SAFETY_REASONING || 'nvidia/nemotron-content-safety-reasoning-4b',

  // Document/OCR Models — for resume parsing
  document_parse: process.env.NIM_DOCUMENT_MODEL || 'nvidia/nemotron-parse',
};

// ─── NIM TTS Model Configurations ──────────────────────────────────
// Each TTS model has specific API requirements and voice configurations.
// All use the /v1/audio/synthesize REST endpoint with form-data, but
// some require audio prompts (voice cloning) and have different voices.
const NIM_TTS_CONFIGS = {
  nim_magpie_multilingual: {
    name: 'Magpie TTS Multilingual',
    baseUrl: process.env.NIM_MAGPIE_MULTI_BASE_URL || null,  // null = use default NIM base
    defaultVoice: 'Magpie-Multilingual.EN-US.Aria',
    requiresAudioPrompt: false,
    languages: ['en-US', 'es-US', 'fr-FR', 'de-DE', 'zh-CN', 'vi-VN', 'it-IT'],
    outputFormat: 'wav',      // 22.05kHz mono PCM 16-bit
    maxTextLength: 4000,
  },
  nim_magpie_flow: {
    name: 'Magpie TTS Flow',
    baseUrl: process.env.NIM_MAGPIE_FLOW_BASE_URL || null,
    defaultVoice: null,
    requiresAudioPrompt: true,  // Requires audio_prompt + audio_prompt_transcript
    requiresTranscript: true,
    languages: ['en-US'],
    outputFormat: 'wav',
    maxTextLength: 4000,
  },
  nim_magpie_zeroshot: {
    name: 'Magpie TTS Zeroshot',
    baseUrl: process.env.NIM_MAGPIE_ZERO_BASE_URL || null,
    defaultVoice: null,
    requiresAudioPrompt: true,  // Requires audio_prompt for voice cloning
    requiresTranscript: false,
    languages: ['en-US'],
    outputFormat: 'wav',
    maxTextLength: 4000,
  },
  nim_fastpitch: {
    name: 'FastPitch HifiGAN',
    baseUrl: process.env.NIM_FASTPITCH_BASE_URL || null,
    defaultVoice: null,           // FastPitch has a single default voice
    requiresAudioPrompt: false,
    languages: ['en-US'],
    outputFormat: 'wav',
    maxTextLength: 4000,
  },
};

// ─── Module-Specific Chain Preferences ───────────────────────────
// Maps HireLoop modules to their optimal provider chain preferences
const MODULE_CHAINS = {
  // Mock Interview — needs quality LLM + TTS + ASR + Vision
  'mock_interview': {
    llm: 'quality',       // Best quality for evaluation
    tts: 'default',
    asr: 'default',
    vision: 'default',
  },
  // AI Coaching — needs quality LLM
  'coaching': {
    llm: 'quality',
  },
  // Resume Parsing — needs vision/OCR + LLM extraction
  'resume-parsing': {
    llm: 'default',
    vision: 'document',   // OCR-optimized chain
  },
  // Job Matching — needs embeddings + reranking
  'job-matching': {
    embedding: 'default',
    reranking: 'default',
    llm: 'efficient',     // Cheap LLM for explanation generation
  },
  // Onboarding — needs efficient LLM (simple Q&A)
  'onboarding': {
    llm: 'efficient',     // Cheap models for simple tasks
  },
  // Assessments — needs reasoning models for quality questions
  'assessments': {
    llm: 'reasoning',     // Reasoning models for complex evaluation
  },
  // Offer Management — needs efficient LLM for template generation
  'offer-management': {
    llm: 'efficient',
  },
  // Payroll — needs efficient LLM for calculations/Q&A
  'payroll': {
    llm: 'efficient',
  },
  // Interview Scheduling — needs efficient LLM
  'scheduling': {
    llm: 'efficient',
  },
  // Profile Management — needs embeddings
  'profile': {
    embedding: 'default',
    llm: 'efficient',
  },
  // Platform Safety — needs safety models
  'safety': {
    safety: 'default',
    llm: 'default',
  },
};


class AIProviderService {
  constructor() {
    this.failures = {};          // { 'provider:modality': { count, lastFailure, error, status } }
    this.activeProviders = {};   // { modality: providerKey }
    this.logs = [];              // Recent failover events (last 100)
    this.stats = {               // Cumulative stats
      totalCalls: 0,
      totalFailovers: 0,
      providerCalls: {},         // { providerKey: count }
    };

    // Initialize clients
    this.clients = {};
    this.nimAvailable = false;
    this._initClients();

    console.log('[ai-provider] Initialized. NIM:', this.nimAvailable, '| Groq:', this.groqAvailable, '| Cerebras:', this.cerebrasAvailable);
    console.log('[ai-provider] Providers:', Object.keys(this.clients).join(', '));
    console.log('[ai-provider] Modalities: llm, vision, tts, asr, embedding, reranking, safety');

    // Load persisted state from DB (non-blocking)
    this._loadPersistedState();
  }

  async _loadPersistedState() {
    try {
      // Load last verification results
      const verification = await this._loadVerificationFromDb();
      if (verification) {
        this._lastVerification = verification;
        console.log(`[ai-provider] Loaded verification from DB: ${verification.totalWorking}/${verification.totalTested} working (from ${verification.timestamp})`);
      }

      // Load cumulative stats
      const statsResult = await pool.query(`SELECT stat_key, stat_value FROM ai_provider_stats`).catch(() => ({ rows: [] }));
      for (const row of statsResult.rows) {
        if (row.stat_key === 'totalCalls') this.stats.totalCalls = parseInt(row.stat_value, 10);
        else if (row.stat_key === 'totalFailovers') this.stats.totalFailovers = parseInt(row.stat_value, 10);
        else if (row.stat_key.startsWith('pc:')) {
          this.stats.providerCalls[row.stat_key.substring(3)] = parseInt(row.stat_value, 10);
        }
      }
      if (statsResult.rows.length > 0) {
        console.log(`[ai-provider] Loaded stats from DB: ${this.stats.totalCalls} calls, ${this.stats.totalFailovers} failovers`);
      }
    } catch (err) {
      // Tables may not exist yet — that's fine
      if (!err.message.includes('does not exist')) {
        console.warn('[ai-provider] Failed to load persisted state:', err.message);
      }
    }
  }

  _initClients() {
    // Anthropic client (Polsia proxy) — primary for LLM text
    // Use fallback URL if POLSIA_API_URL is not set (matches polsia-ai.js behavior)
    const polsiaApiUrl = process.env.POLSIA_API_URL || 'https://polsia.com/api/proxy/ai';
    if (polsiaApiUrl && process.env.POLSIA_API_KEY) {
      this.clients.anthropic = new Anthropic({
        baseURL: polsiaApiUrl,
        apiKey: process.env.POLSIA_API_KEY,
      });
    }

    // OpenAI client (Polsia proxy) — primary for vision, TTS, ASR
    if (process.env.OPENAI_BASE_URL && process.env.OPENAI_API_KEY) {
      this.clients.openai = new OpenAI({
        baseURL: process.env.OPENAI_BASE_URL,
        apiKey: process.env.OPENAI_API_KEY,
      });
      this.openaiBaseUrl = process.env.OPENAI_BASE_URL;
      this.openaiApiKey = process.env.OPENAI_API_KEY;
    }

    // NVIDIA NIM client — fallback for all modalities
    const nimKey = process.env.NVIDIA_NIM_API_KEY;
    const nimBase = process.env.NIM_BASE_URL || 'https://integrate.api.nvidia.com/v1';
    if (nimKey) {
      this.clients.nim = new OpenAI({
        baseURL: nimBase,
        apiKey: nimKey,
      });
      this.nimBaseUrl = nimBase;
      this.nimApiKey = nimKey;
      this.nimAvailable = true;
    }

    // Groq client — ultra-fast inference fallback (OpenAI-compatible)
    const groqKey = process.env.GROQ_API_KEY;
    if (groqKey) {
      this.clients.groq = new OpenAI({
        baseURL: 'https://api.groq.com/openai/v1',
        apiKey: groqKey,
      });
      this.groqApiKey = groqKey;
      this.groqAvailable = true;
      console.log('[ai-provider] Groq available for LLM/ASR fallback');
    } else {
      this.groqAvailable = false;
    }

    // Cerebras client — fastest inference (3000 t/s, OpenAI-compatible)
    const cerebrasKey = process.env.CEREBRAS_API_KEY;
    if (cerebrasKey) {
      this.clients.cerebras = new OpenAI({
        baseURL: 'https://api.cerebras.ai/v1',
        apiKey: cerebrasKey,
      });
      this.cerebrasAvailable = true;
      console.log('[ai-provider] Cerebras available for LLM fallback');
    } else {
      this.cerebrasAvailable = false;
    }

    // Deepgram client — independent fallback for TTS + ASR (pure REST, no SDK)
    // Provides real failover when OpenAI audio endpoints are down/rate-limited.
    // Sign up at https://deepgram.com (free $200 credit) and set DEEPGRAM_API_KEY.
    const dgKey = process.env.DEEPGRAM_API_KEY;
    if (dgKey) {
      this.deepgramApiKey = dgKey;
      this.deepgramAvailable = true;
      console.log('[ai-provider] Deepgram available for TTS/ASR fallback');
    } else {
      this.deepgramAvailable = false;
    }

    // Self-hosted audio — whisper.cpp (STT) + Piper (TTS), no API keys
    // Layer 2 fallback: OpenAI → Self-hosted → Deepgram
    this.selfHostedSTTAvailable = false;
    this.selfHostedTTSAvailable = false;
    if (selfHostedAudio) {
      try {
        const { sttAvailable, ttsAvailable } = selfHostedAudio.initialize();
        this.selfHostedSTTAvailable = sttAvailable;
        this.selfHostedTTSAvailable = ttsAvailable;
      } catch (e) {
        console.log('[ai-provider] Self-hosted audio init failed:', e.message);
      }
    }
  }

  // ─── Fallback Chain Definitions ───────────────────────────────

  /**
   * Get the fallback chain for a modality, optionally specialized per module.
   * @param {string} modality - 'llm', 'vision', 'tts', 'asr', 'embedding', 'reranking', 'safety'
   * @param {string} variant - Chain variant: 'default', 'quality', 'efficient', 'reasoning', 'document'
   * @returns {string[]} Array of provider keys to try in order
   */
  getChain(modality, variant = 'default') {
    const chains = {
      // ─── LLM Chains (up to 15 providers deep!) ────────────
      // AUDITED Feb 13, 2026 — dead models removed, new working models added
      // Order: Polsia → NIM (fastest first) → Groq → Cerebras
      llm: {
        // Default: balanced quality and cost (15 deep!)
        default: [
          'anthropic',           // Polsia/Claude — primary
          'openai',              // Polsia/OpenAI GPT-4o-mini
          'nim_llama_70b',       // NIM Llama 3.3 70B — 197ms ✅
          'nim_step_flash',      // NIM Step 3.5 Flash — 257ms ✅
          'nim_gpt_oss',         // NIM GPT-OSS-120B — 312ms ✅
          'nim_ultra',           // NIM Nemotron Ultra 253B — 368ms ✅
          'nim_gemma',           // NIM Gemma 3 27B — 428ms ✅
          'nim_nemotron_super',  // NIM Nemotron Super 49B — 534ms ✅
          'groq_llama_70b',      // Groq Llama 3.3 70B — 280 t/s
          'groq_gpt_oss',        // Groq GPT-OSS-120B — 500 t/s
          'cerebras_gpt_oss',    // Cerebras GPT-OSS-120B — 3000 t/s
          'cerebras_llama_8b',   // Cerebras Llama 3.1 8B — 2200 t/s
        ],
        // Quality: best models first for critical tasks (interviews, coaching)
        quality: [
          'anthropic',
          'openai',
          'nim_ultra',           // Nemotron Ultra 253B — best NIM quality
          'nim_llama_70b',       // Llama 3.3 70B — strong quality
          'nim_nemotron_super',  // Nemotron Super 49B
          'nim_step_flash',      // Step 3.5 Flash
          'nim_gpt_oss',         // GPT-OSS-120B
          'nim_gemma',           // Gemma 3 27B
          'groq_llama_70b',      // Groq Llama 3.3 70B
          'groq_gpt_oss',        // Groq GPT-OSS-120B
          'cerebras_gpt_oss',    // Cerebras GPT-OSS-120B
        ],
        // Efficient: cheapest/fastest models first for bulk/simple tasks
        efficient: [
          'anthropic',
          'openai',
          'nim_llama_8b',        // NIM Llama 3.1 8B — 151ms, cheapest
          'nim_gpt_oss_20b',     // NIM GPT-OSS-20B — 256ms, light
          'nim_nano_30b',        // NIM Nemotron Nano 30B — 283ms
          'nim_step_flash',      // Step 3.5 Flash — 257ms
          'nim_gemma',           // Gemma 3 27B — 428ms
          'groq_llama_8b',       // Groq Llama 3.1 8B — 560 t/s
          'cerebras_llama_8b',   // Cerebras Llama 3.1 8B — 2200 t/s
        ],
        // Reasoning: models with strong reasoning for assessments
        reasoning: [
          'anthropic',
          'openai',
          'nim_qwq',             // QwQ-32B — dedicated reasoning (2146ms but working)
          'nim_step_flash',      // Step 3.5 Flash — 97.3% AIME champion
          'nim_ultra',           // Nemotron Ultra 253B — strong reasoning
          'nim_llama_70b',       // Llama 3.3 70B — solid reasoning
          'nim_nemotron_super',  // Nemotron Super 49B
          'groq_llama_70b',      // Groq Llama 3.3 70B
          'cerebras_gpt_oss',    // Cerebras GPT-OSS-120B
        ],
      },

      // ─── Vision Chains (3 providers — dead ones removed) ──────
      // Removed: Cosmos Reason2 (404), Kimi K2.5 (404)
      vision: {
        default: [
          'openai_vision',       // Polsia/OpenAI GPT-4o
          'nim_nemotron_vl',     // NIM Nemotron Nano 12B VL — 207ms ✅
          'nim_gemma_vision',    // NIM Gemma 3 27B — 357ms ✅
        ],
        // Document/OCR chain for resume parsing
        document: [
          'openai_vision',       // Polsia/OpenAI GPT-4o
          'nim_nemotron_vl',     // NIM Nemotron Nano 12B VL — good at documents
          'nim_gemma_vision',    // NIM Gemma 3 27B — multilingual
        ],
      },

      // ─── TTS Chains (3-layer: OpenAI → Self-hosted → Deepgram) ─
      tts: {
        default: [
          'openai_tts',          // Layer 1: Polsia/OpenAI TTS-1
          'selfhosted_tts',      // Layer 2: Piper TTS (CPU, no API key)
          'deepgram_tts',        // Layer 3: Deepgram Aura (paid, $200 free credit)
        ],
      },

      // ─── ASR Chains (4-layer: OpenAI → Self-hosted → Groq Whisper → Deepgram) ─
      asr: {
        default: [
          'openai_whisper',      // Layer 1: Polsia/OpenAI Whisper
          'selfhosted_stt',      // Layer 2: whisper.cpp tiny.en (CPU, no API key)
          'groq_whisper',        // Layer 3: Groq whisper-large-v3-turbo (FREE!)
          'deepgram_stt',        // Layer 4: Deepgram Nova-2 (paid)
        ],
      },

      // ─── Embedding Chains (3 providers deep) ─────────────
      embedding: {
        default: [
          'openai_embed',        // Polsia/OpenAI text-embedding-3-small
          'nim_embed_qa',        // NIM NV-EmbedQA 1B v2 — 26 languages
          'nim_embed_vl',        // NIM Nemotron-Embed-VL 1B — multimodal
        ],
      },

      // ─── Reranking Chains (0 providers — NIM models 404, graceful passthrough) ─
      // Both NIM reranking models return 404 on cloud API (verified Feb 13, 2026).
      // Matching works without reranking — returns original order with default scores.
      reranking: {
        default: [],
      },

      // ─── Safety/Guardrails Chains (2 providers) ──────────
      safety: {
        default: [
          'nim_safety_guard',    // NIM NemoGuard Safety 8B — 23 categories
          'nim_safety_reasoning',// NIM Nemotron Content Safety 4B
        ],
      },
    };

    const modalityChains = chains[modality];
    if (!modalityChains) return [];
    return modalityChains[variant] || modalityChains.default || [];
  }

  /**
   * Get the optimal chain for a specific HireLoop module + modality.
   * Falls back to default chain if no module-specific config exists.
   */
  getModuleChain(module, modality) {
    const moduleConfig = MODULE_CHAINS[module];
    const variant = (moduleConfig && moduleConfig[modality]) || 'default';
    return this.getChain(modality, variant);
  }

  // Check if a provider is available (has required client/keys)
  isProviderAvailable(providerKey) {
    switch (providerKey) {
      case 'anthropic':
        return !!this.clients.anthropic;
      case 'openai':
      case 'openai_vision':
      case 'openai_tts':
      case 'openai_whisper':
      case 'openai_embed':
        return !!this.clients.openai;
      // All NIM providers require NIM API key
      case 'nim_nemotron_super':
      case 'nim_llama_8b':
      case 'nim_llama_70b':
      case 'nim_gpt_oss_20b':
      case 'nim_step_flash':
      case 'nim_gpt_oss':
      case 'nim_nano_30b':
      case 'nim_ultra':
      case 'nim_gemma':
      case 'nim_qwq':
      case 'nim_nemotron_vl':
      case 'nim_gemma_vision':
      case 'nim_riva_tts':
      case 'nim_magpie_multilingual':
      case 'nim_magpie_flow':
      case 'nim_magpie_zeroshot':
      case 'nim_fastpitch':
      case 'nim_parakeet_v2':
      case 'nim_parakeet_v3':
      case 'nim_embed_qa':
      case 'nim_embed_vl':
      case 'nim_safety_guard':
      case 'nim_safety_reasoning':
        return this.nimAvailable;
      // Reranking models removed — both 404 on NIM cloud API (verified Feb 13, 2026)
      case 'nim_rerank_qa':
      case 'nim_rerank_vl':
        return false;
      // Groq providers
      case 'groq_llama_70b':
      case 'groq_gpt_oss':
      case 'groq_llama_8b':
      case 'groq_whisper':
        return this.groqAvailable;
      // Cerebras providers
      case 'cerebras_gpt_oss':
      case 'cerebras_llama_8b':
        return this.cerebrasAvailable;
      // Self-hosted providers — CPU-based, no API keys
      case 'selfhosted_tts':
        return this.selfHostedTTSAvailable;
      case 'selfhosted_stt':
        return this.selfHostedSTTAvailable;
      // Deepgram providers — independent TTS/ASR fallback
      case 'deepgram_tts':
      case 'deepgram_stt':
        return this.deepgramAvailable;
      default:
        return false;
    }
  }

  // ─── Circuit Breaker ──────────────────────────────────────────

  isCircuitOpen(providerKey, modality) {
    const key = `${providerKey}:${modality}`;
    const failure = this.failures[key];
    if (!failure) return false;

    // Use extended duration for geo-blocked providers (30 min vs 5 min)
    const breakMs = failure.geoBlocked ? GEO_BLOCK_CIRCUIT_MS : CIRCUIT_BREAK_MS;
    const elapsed = Date.now() - failure.lastFailure;
    if (elapsed > breakMs) {
      // Circuit closed — enough time passed, allow retry
      delete this.failures[key];
      return false;
    }
    return true;
  }

  recordFailure(providerKey, modality, error) {
    const key = `${providerKey}:${modality}`;
    const existing = this.failures[key] || { count: 0 };
    const status = error.status || error.statusCode || null;

    this.failures[key] = {
      count: existing.count + 1,
      lastFailure: Date.now(),
      error: error.message || String(error),
      status,
    };

    this.stats.totalFailovers++;

    const logEntry = {
      timestamp: new Date().toISOString(),
      event: 'provider_failure',
      provider: providerKey,
      modality,
      error: error.message || String(error),
      status,
    };
    this.logs.push(logEntry);
    if (this.logs.length > 100) this.logs.shift();

    console.log(`[ai-provider] ❌ ${providerKey} failed for ${modality}: [${status || 'ERR'}] ${error.message || error}`);
  }

  _logFailover(fromProvider, toProvider, modality) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      event: 'failover',
      from: fromProvider,
      to: toProvider,
      modality,
    };
    this.logs.push(logEntry);
    if (this.logs.length > 100) this.logs.shift();
    console.log(`[ai-provider] 🔄 ${modality} failover: ${fromProvider} → ${toProvider}`);
    activityLogger.logFailover(modality, fromProvider, toProvider);
  }

  recordSuccess(providerKey, modality, tokenCount = 0) {
    this.activeProviders[modality] = providerKey;
    const key = `${providerKey}:${modality}`;
    delete this.failures[key];

    this.stats.totalCalls++;
    this.stats.providerCalls[providerKey] = (this.stats.providerCalls[providerKey] || 0) + 1;

    // Persist stats to DB (debounced — every 10 calls)
    if (this.stats.totalCalls % 10 === 0) {
      this._persistStats().catch(() => {});
    }

    // Track OpenAI token usage for budget enforcement
    if (this._isOpenAIProvider(providerKey) && tokenCount > 0) {
      tokenBudget.recordUsage(modality, tokenCount);
    }
  }

  isRetryable(err) {
    // Network/timeout errors
    if (err.code === 'ETIMEDOUT' || err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET' || err.code === 'ENOTFOUND') return true;
    if (err.message && (err.message.includes('timeout') || err.message.includes('ETIMEDOUT'))) return true;

    // HTTP status codes
    const status = err.status || err.statusCode || (err.response && err.response.status);
    if (status && RETRYABLE_STATUS.has(status)) return true;

    // OpenAI SDK-specific error types
    if (err.type === 'insufficient_quota' || err.code === 'insufficient_quota') return true;
    if (err.type === 'rate_limit_exceeded' || err.code === 'rate_limit_exceeded') return true;

    // Anthropic-specific
    if (err.error && err.error.type === 'overloaded_error') return true;

    // Polsia proxy wraps upstream provider errors (e.g., Gemini location block) as proxy_error
    if (err.code === 'proxy_error' || (err.error && err.error.code === 'proxy_error')) return true;

    return false;
  }

  // Check if a provider key is an OpenAI provider (not Anthropic, not NIM)
  _isOpenAIProvider(providerKey) {
    return providerKey === 'openai' || providerKey.startsWith('openai_');
  }

  // Get available providers for a modality (skipping unavailable + circuit-broken + budget-exhausted OpenAI)
  getAvailableChain(modality, variant = 'default') {
    const budgetExhausted = tokenBudget.isOpenAIBudgetExhausted();
    // TTS and ASR are exempt from budget exhaustion — they use minimal tokens
    // (~50-100 per TTS call, ~30-50 per ASR call) and have NO working NIM fallbacks
    // (NVIDIA cloud API doesn't host audio models). Blocking them kills interviews.
    const budgetExemptModalities = new Set(['tts', 'asr']);
    const skipOpenAI = budgetExhausted && !budgetExemptModalities.has(modality);

    return this.getChain(modality, variant).filter(key => {
      if (!this.isProviderAvailable(key)) return false;
      if (this.isCircuitOpen(key, modality)) return false;
      // Skip OpenAI providers when daily token budget is exhausted (except TTS/ASR)
      if (skipOpenAI && this._isOpenAIProvider(key)) return false;
      return true;
    });
  }

  // ─── Core Execution with Fallback ────────────────────────────

  /**
   * Execute an AI call with automatic fallback.
   *
   * FEB 15, 2026 FIX: Parallel racing + total cascade timeout.
   * Before: Sequential through 12 providers × 15s = 180s worst case.
   * After: Race top 3, cap at 30s total. First success wins.
   *
   * @param {string} modality - 'llm', 'vision', 'tts', 'asr', 'embedding', 'reranking', 'safety'
   * @param {Function} executeFn - async (providerKey) => result
   * @param {string} variant - Chain variant (default, quality, efficient, reasoning)
   * @returns {*} Result from the first successful provider
   */
  async execute(modality, executeFn, variant = 'default', callMeta = {}) {
    const callStart = Date.now();
    const chain = this.getAvailableChain(modality, variant);
    const triedProviders = [];

    if (chain.length === 0) {
      const allChain = this.getChain(modality, variant);
      const reasons = allChain.map(k => {
        if (!this.isProviderAvailable(k)) return `${k}: not configured`;
        if (this.isCircuitOpen(k, modality)) return `${k}: circuit open`;
        return `${k}: unknown`;
      });
      const err = new Error(`No available providers for ${modality}. ${reasons.join(', ')}`);
      err.allProvidersFailed = true;
      err.triedProviders = [];
      err.totalElapsedMs = Date.now() - callStart;
      aiCallLogger.logCall({
        module: callMeta.module || 'unknown',
        feature: callMeta.feature || '',
        modality,
        provider: 'none',
        model: '',
        latencyMs: Date.now() - callStart,
        success: false,
        errorMessage: err.message,
        fallbackChain: allChain,
        userId: callMeta.userId || null,
      });
      throw err;
    }

    // Per-provider timeout: 8s for TTS/ASR, 15s for LLM, 30s for vision (multi-image), 10s default
    const perProviderTimeoutMs = modality === 'tts' || modality === 'asr' ? 8000
      : modality === 'llm' ? 15000
      : modality === 'vision' ? 30000
      : 10000;

    // Total cascade timeout — absolute wall-clock cap for entire fallback chain
    const totalTimeoutMs = TOTAL_CASCADE_TIMEOUT[modality] || 30000;

    // Number of providers to race in parallel
    const raceCount = PARALLEL_RACE_COUNT[modality] || 1;

    let lastError;
    let failedProvider = null;

    // ── Phase 1: Parallel Race (top N providers simultaneously) ──────
    // Dramatically reduces latency when primary provider is slow/down.
    // First success wins; if ALL raced providers fail, fall through to sequential.
    if (raceCount > 1 && chain.length >= 2) {
      const raceProviders = chain.slice(0, Math.min(raceCount, chain.length));

      try {
        const raceResult = await this._raceProviders(
          raceProviders, executeFn, perProviderTimeoutMs, modality, callMeta, callStart, triedProviders
        );
        return raceResult;
      } catch (raceErr) {
        // All raced providers failed — continue with remaining providers sequentially
        lastError = raceErr;
        failedProvider = raceProviders[raceProviders.length - 1];
        console.log(`[ai-provider] ⚡ Parallel race failed for ${modality} (${raceProviders.join(',')}), falling back to sequential`);
      }
    }

    // ── Phase 2: Sequential Fallback (remaining providers) ───────────
    // Skip providers already tried in the parallel race phase.
    const sequentialStart = (raceCount > 1 && chain.length >= 2) ? Math.min(raceCount, chain.length) : 0;

    for (let i = sequentialStart; i < chain.length; i++) {
      const providerKey = chain[i];

      // Check total cascade timeout before trying next provider
      const elapsed = Date.now() - callStart;
      if (elapsed >= totalTimeoutMs) {
        console.warn(`[ai-provider] ⏱️ Total cascade timeout (${totalTimeoutMs}ms) hit after ${elapsed}ms — tried: ${triedProviders.join(' → ')}`);
        break;
      }

      // Shrink per-provider timeout if we're running low on total time
      const remainingMs = totalTimeoutMs - elapsed;
      const effectiveTimeout = Math.min(perProviderTimeoutMs, remainingMs);

      triedProviders.push(providerKey);
      try {
        // Wrap each provider call with a timeout to prevent hanging
        const result = await Promise.race([
          executeFn(providerKey),
          new Promise((_, reject) => setTimeout(() => {
            const err = new Error(`${providerKey} timed out after ${effectiveTimeout}ms for ${modality}`);
            err.code = 'ETIMEDOUT';
            reject(err);
          }, effectiveTimeout))
        ]);
        // Log successful failover transition if we had a prior failure
        if (failedProvider) {
          this._logFailover(failedProvider, providerKey, modality);
        }
        // Extract token count if result is wrapped with _tokenCount
        let tokenCount = 0;
        let actualResult = result;
        if (result && typeof result === 'object' && result._tokenCount !== undefined) {
          tokenCount = result._tokenCount;
          actualResult = result._result;
        }
        this.recordSuccess(providerKey, modality, tokenCount);

        // Log successful call with full metadata
        aiCallLogger.logCall({
          module: callMeta.module || 'unknown',
          feature: callMeta.feature || '',
          modality,
          provider: providerKey,
          model: callMeta.model || this._getModelName(providerKey) || providerKey,
          promptTokens: Math.round(tokenCount * 0.6),
          completionTokens: Math.round(tokenCount * 0.4),
          totalTokens: tokenCount,
          latencyMs: Date.now() - callStart,
          success: true,
          fallbackChain: triedProviders.length > 1 ? triedProviders : null,
          userId: callMeta.userId || null,
        });

        return actualResult;
      } catch (err) {
        lastError = err;
        // Provider not applicable for this request (e.g., voice cloning TTS without audio prompt)
        // Skip silently without circuit-breaking — provider is fine, just wrong for this request
        if (err.notApplicable) {
          continue;
        }
        if (this.isRetryable(err)) {
          failedProvider = providerKey;
          this.recordFailure(providerKey, modality, err);
          // Detect geo-blocked providers and circuit-break them longer
          this._checkGeoBlock(providerKey, modality, err);
          continue; // try next provider
        }
        // Non-retryable error — log and throw
        aiCallLogger.logCall({
          module: callMeta.module || 'unknown',
          feature: callMeta.feature || '',
          modality,
          provider: providerKey,
          model: callMeta.model || this._getModelName(providerKey) || providerKey,
          latencyMs: Date.now() - callStart,
          success: false,
          errorMessage: err.message,
          fallbackChain: triedProviders,
          userId: callMeta.userId || null,
        });
        throw err;
      }
    }

    // ── All providers exhausted or total timeout hit ─────────────────
    const totalElapsed = Date.now() - callStart;
    const errorMsg = `All ${modality} providers failed after ${totalElapsed}ms (tried: ${triedProviders.join(' → ')})`;
    aiCallLogger.logCall({
      module: callMeta.module || 'unknown',
      feature: callMeta.feature || '',
      modality,
      provider: triedProviders[triedProviders.length - 1] || 'none',
      model: '',
      latencyMs: totalElapsed,
      success: false,
      errorMessage: errorMsg,
      fallbackChain: triedProviders,
      userId: callMeta.userId || null,
    });

    console.error(`[ai-provider] ${errorMsg}`);
    const finalErr = lastError || new Error(errorMsg);
    // Attach metadata so callers can return clear errors to frontend
    finalErr.allProvidersFailed = true;
    finalErr.totalElapsedMs = totalElapsed;
    finalErr.triedProviders = triedProviders;
    throw finalErr;
  }

  /**
   * Race multiple providers in parallel — first success wins.
   * Uses Promise.any: resolves with first fulfillment, only rejects when ALL reject.
   */
  async _raceProviders(providers, executeFn, perProviderTimeoutMs, modality, callMeta, callStart, triedProviders) {
    const promises = providers.map(providerKey => {
      triedProviders.push(providerKey);
      return Promise.race([
        executeFn(providerKey).then(result => ({ providerKey, result })),
        new Promise((_, reject) => setTimeout(() => {
          const err = new Error(`${providerKey} timed out after ${perProviderTimeoutMs}ms for ${modality}`);
          err.code = 'ETIMEDOUT';
          reject(err);
        }, perProviderTimeoutMs))
      ]).catch(err => {
        // Record failure but re-throw — Promise.any needs all to reject to fail
        if (!err.notApplicable) {
          this.recordFailure(providerKey, modality, err);
          this._checkGeoBlock(providerKey, modality, err);
        }
        throw err;
      });
    });

    // Promise.any: first fulfillment wins, only rejects if ALL providers fail
    const { providerKey, result } = await Promise.any(promises);

    // Extract token count if result is wrapped
    let tokenCount = 0;
    let actualResult = result;
    if (result && typeof result === 'object' && result._tokenCount !== undefined) {
      tokenCount = result._tokenCount;
      actualResult = result._result;
    }
    this.recordSuccess(providerKey, modality, tokenCount);

    // Log successful call
    aiCallLogger.logCall({
      module: callMeta.module || 'unknown',
      feature: callMeta.feature || '',
      modality,
      provider: providerKey,
      model: callMeta.model || this._getModelName(providerKey) || providerKey,
      promptTokens: Math.round(tokenCount * 0.6),
      completionTokens: Math.round(tokenCount * 0.4),
      totalTokens: tokenCount,
      latencyMs: Date.now() - callStart,
      success: true,
      fallbackChain: triedProviders.length > 1 ? triedProviders : null,
      userId: callMeta.userId || null,
    });

    return actualResult;
  }

  /**
   * Detect geo-blocked providers and circuit-break them for 30 min.
   * These providers consistently fail — no point retrying every 5 min.
   */
  _checkGeoBlock(providerKey, modality, err) {
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('location') || msg.includes('geo') || msg.includes('not supported') ||
        msg.includes('blocked') || msg.includes('region')) {
      const key = `${providerKey}:${modality}`;
      this.failures[key] = {
        ...(this.failures[key] || {}),
        lastFailure: Date.now(),
        geoBlocked: true,
        error: err.message || String(err),
      };
      console.warn(`[ai-provider] 🌍 ${providerKey} geo-blocked for ${modality} — circuit-broken for 30 min`);
    }
  }

  // Get human-readable model name from provider key
  _getModelName(providerKey) {
    const modelMap = {
      'anthropic': 'Claude (Polsia)',
      'openai': 'gpt-4o-mini',
      'openai_vision': 'gpt-4o',
      'openai_tts': 'tts-1',
      'openai_whisper': 'whisper-1',
      'openai_embed': 'text-embedding-3-small',
      // NIM models (audited Feb 13, 2026)
      'nim_llama_8b': NIM_MODELS.llm_llama_8b,
      'nim_llama_70b': NIM_MODELS.llm_llama_70b,
      'nim_gpt_oss_20b': NIM_MODELS.llm_gpt_oss_20b,
      'nim_step_flash': NIM_MODELS.llm_step_flash,
      'nim_nano_30b': NIM_MODELS.llm_nano_30b,
      'nim_gpt_oss': NIM_MODELS.llm_gpt_oss,
      'nim_ultra': NIM_MODELS.llm_ultra,
      'nim_gemma': NIM_MODELS.llm_gemma,
      'nim_nemotron_super': NIM_MODELS.llm_super,
      'nim_qwq': NIM_MODELS.reasoning_qwq,
      'nim_nemotron_vl': NIM_MODELS.vision_nemotron_vl,
      'nim_gemma_vision': NIM_MODELS.vision_gemma,
      // Groq models
      'groq_llama_70b': 'llama-3.3-70b-versatile',
      'groq_gpt_oss': 'openai/gpt-oss-120b',
      'groq_llama_8b': 'llama-3.1-8b-instant',
      'groq_whisper': 'whisper-large-v3-turbo',
      // Cerebras models
      'cerebras_gpt_oss': 'gpt-oss-120b',
      'cerebras_llama_8b': 'llama3.1-8b',
      // Other
      'deepgram_tts': 'Deepgram Aura',
      'deepgram_stt': 'Deepgram Nova-2',
    };
    return modelMap[providerKey] || providerKey;
  }

  // ─── LLM Chat Completion ─────────────────────────────────────

  /**
   * Chat completion with automatic provider fallback.
   * @param {Array} messages - Array of { role, content } messages
   * @param {Object} options - { system, maxTokens, max_tokens, temperature, subscriptionId, response_format, module }
   * @returns {string} The AI response text
   */
  async chatCompletion(messages, options = {}) {
    // Determine chain variant based on module
    const moduleConfig = MODULE_CHAINS[options.module];
    const variant = (moduleConfig && moduleConfig.llm) || 'default';

    // Check throttling — skip non-critical modules when budget is high
    if (options.module && aiCallLogger.shouldThrottle(options.module, tokenBudget.getStatus())) {
      throw new Error(`Module ${options.module} throttled — budget above threshold for priority level`);
    }

    return this.execute('llm', async (providerKey) => {
      switch (providerKey) {
        case 'anthropic':
          return this._anthropicChat(messages, options);
        case 'openai':
          return this._openaiChat('gpt-4o-mini', messages, options, true);
        // NIM models (audited Feb 13, 2026 — all confirmed working)
        case 'nim_llama_8b':
          return this._nimChat(NIM_MODELS.llm_llama_8b, messages, options);
        case 'nim_llama_70b':
          return this._nimChat(NIM_MODELS.llm_llama_70b, messages, options);
        case 'nim_gpt_oss_20b':
          return this._nimChat(NIM_MODELS.llm_gpt_oss_20b, messages, options);
        case 'nim_step_flash':
          return this._nimChat(NIM_MODELS.llm_step_flash, messages, options);
        case 'nim_nano_30b':
          return this._nimChat(NIM_MODELS.llm_nano_30b, messages, options);
        case 'nim_gpt_oss':
          return this._nimChat(NIM_MODELS.llm_gpt_oss, messages, options);
        case 'nim_ultra':
          return this._nimChat(NIM_MODELS.llm_ultra, messages, options);
        case 'nim_gemma':
          return this._nimChat(NIM_MODELS.llm_gemma, messages, options);
        case 'nim_nemotron_super':
          return this._nimChat(NIM_MODELS.llm_super, messages, options);
        case 'nim_qwq':
          return this._nimChat(NIM_MODELS.reasoning_qwq, messages, options);
        // Groq models — OpenAI-compatible, ultra-fast
        case 'groq_llama_70b':
          return this._groqChat('llama-3.3-70b-versatile', messages, options);
        case 'groq_gpt_oss':
          return this._groqChat('openai/gpt-oss-120b', messages, options);
        case 'groq_llama_8b':
          return this._groqChat('llama-3.1-8b-instant', messages, options);
        // Cerebras models — fastest inference (3000 t/s)
        case 'cerebras_gpt_oss':
          return this._cerebrasChat('gpt-oss-120b', messages, options);
        case 'cerebras_llama_8b':
          return this._cerebrasChat('llama3.1-8b', messages, options);
        default:
          throw new Error(`Unknown LLM provider: ${providerKey}`);
      }
    }, variant, { module: options.module || 'unknown', feature: options.feature || 'chat', userId: options.userId });
  }

  async _anthropicChat(messages, options) {
    const systemMsgs = messages.filter(m => m.role === 'system');
    const nonSystemMsgs = messages.filter(m => m.role !== 'system');

    const systemPrompt = options.system || (systemMsgs.length > 0 ? systemMsgs[0].content : undefined);
    const msgs = nonSystemMsgs.map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : String(m.content),
    }));
    if (msgs.length === 0) msgs.push({ role: 'user', content: 'Hello' });

    const response = await this.clients.anthropic.messages.create({
      max_tokens: options.maxTokens || options.max_tokens || 8192,
      messages: msgs,
      system: systemPrompt,
    }, {
      headers: options.subscriptionId ? { 'X-Subscription-ID': options.subscriptionId } : {},
    });

    return response.content[0].text;
  }

  async _openaiChat(model, messages, options, isPolsia = false) {
    const client = this.clients.openai;
    const msgs = [];

    if (options.system) {
      msgs.push({ role: 'system', content: options.system });
    }
    for (const m of messages) {
      if (m.role === 'system' && options.system) continue; // already added
      msgs.push({ role: m.role, content: typeof m.content === 'string' ? m.content : String(m.content) });
    }
    if (msgs.length === 0) msgs.push({ role: 'user', content: 'Hello' });

    const params = {
      model,
      messages: msgs,
      max_tokens: options.maxTokens || options.max_tokens || 8192,
      temperature: options.temperature || 0.7,
    };

    // Polsia proxy requires task field
    if (isPolsia) params.task = 'chat-fallback';
    if (options.response_format) params.response_format = options.response_format;

    const response = await client.chat.completions.create(params);
    const text = response.choices[0].message.content;
    // Track token usage from response or estimate
    const tokenCount = (response.usage && response.usage.total_tokens)
      ? response.usage.total_tokens
      : tokenBudget.estimateTokensFromText(text) + tokenBudget.estimateTokensFromText(msgs.map(m => m.content).join(' '));
    return { _result: text, _tokenCount: tokenCount };
  }

  async _nimChat(model, messages, options) {
    const client = this.clients.nim;
    const msgs = [];

    if (options.system) {
      msgs.push({ role: 'system', content: options.system });
    }
    for (const m of messages) {
      if (m.role === 'system' && options.system) continue;
      msgs.push({ role: m.role, content: typeof m.content === 'string' ? m.content : String(m.content) });
    }
    if (msgs.length === 0) msgs.push({ role: 'user', content: 'Hello' });

    const params = {
      model,
      messages: msgs,
      max_tokens: options.maxTokens || options.max_tokens || 8192,
      temperature: options.temperature || 0.7,
    };

    if (options.response_format) params.response_format = options.response_format;

    const response = await client.chat.completions.create(params);
    return response.choices[0].message.content;
  }

  // ─── Groq Chat (OpenAI-compatible, ultra-fast inference) ────
  async _groqChat(model, messages, options) {
    const client = this.clients.groq;
    const msgs = [];

    if (options.system) {
      msgs.push({ role: 'system', content: options.system });
    }
    for (const m of messages) {
      if (m.role === 'system' && options.system) continue;
      msgs.push({ role: m.role, content: typeof m.content === 'string' ? m.content : String(m.content) });
    }
    if (msgs.length === 0) msgs.push({ role: 'user', content: 'Hello' });

    const params = {
      model,
      messages: msgs,
      max_tokens: options.maxTokens || options.max_tokens || 8192,
      temperature: options.temperature || 0.7,
    };

    if (options.response_format) params.response_format = options.response_format;

    const response = await client.chat.completions.create(params);
    return response.choices[0].message.content;
  }

  // ─── Cerebras Chat (OpenAI-compatible, 3000 t/s fastest inference) ─
  async _cerebrasChat(model, messages, options) {
    const client = this.clients.cerebras;
    const msgs = [];

    if (options.system) {
      msgs.push({ role: 'system', content: options.system });
    }
    for (const m of messages) {
      if (m.role === 'system' && options.system) continue;
      msgs.push({ role: m.role, content: typeof m.content === 'string' ? m.content : String(m.content) });
    }
    if (msgs.length === 0) msgs.push({ role: 'user', content: 'Hello' });

    const params = {
      model,
      messages: msgs,
      max_tokens: options.maxTokens || options.max_tokens || 8192,
      temperature: options.temperature || 0.7,
    };

    if (options.response_format) params.response_format = options.response_format;

    const response = await client.chat.completions.create(params);
    return response.choices[0].message.content;
  }

  // ─── Vision Analysis ─────────────────────────────────────────

  /**
   * Vision analysis with automatic provider fallback.
   * @param {Array} imageUrls - Array of HTTP image URLs
   * @param {string} prompt - Analysis prompt
   * @param {Object} options - { maxTokens, subscriptionId, response_format, module }
   * @returns {string} The AI response text
   */
  async visionAnalysis(imageUrls, prompt, options = {}) {
    const moduleConfig = MODULE_CHAINS[options.module];
    const variant = (moduleConfig && moduleConfig.vision) || 'default';

    return this.execute('vision', async (providerKey) => {
      let client, model;

      switch (providerKey) {
        case 'openai_vision':
          client = this.clients.openai;
          model = 'gpt-4o';
          break;
        case 'nim_nemotron_vl':
          client = this.clients.nim;
          model = NIM_MODELS.vision_nemotron_vl;
          break;
        case 'nim_gemma_vision':
          client = this.clients.nim;
          model = NIM_MODELS.vision_gemma;
          break;
        default:
          throw new Error(`Unknown vision provider: ${providerKey}`);
      }

      // Build content array with text + images
      const content = [{ type: 'text', text: prompt }];
      for (const url of imageUrls) {
        content.push({
          type: 'image_url',
          image_url: { url, detail: 'low' },
        });
      }

      const params = {
        model,
        max_tokens: options.maxTokens || 2048,
        messages: [
          ...(options.system ? [{ role: 'system', content: options.system }] : []),
          { role: 'user', content },
        ],
      };

      // Polsia proxy needs task field
      if (providerKey === 'openai_vision') params.task = options.task || 'vision-analysis';
      if (options.response_format) params.response_format = options.response_format;

      const response = await client.chat.completions.create(params);
      const text = response.choices[0].message.content;
      // Track OpenAI vision token usage
      if (providerKey === 'openai_vision') {
        const visionTokens = (response.usage && response.usage.total_tokens)
          ? response.usage.total_tokens
          : tokenBudget.estimateVisionTokens(imageUrls.length, prompt.length);
        return { _result: text, _tokenCount: visionTokens };
      }
      return text;
    }, variant, { module: options.module || 'unknown', feature: options.feature || 'vision', userId: options.userId });
  }

  // ─── Text-to-Speech ──────────────────────────────────────────

  /**
   * Text-to-speech with automatic provider fallback.
   * Chain: OpenAI TTS → NIM Riva TTS → NIM Magpie Multilingual → NIM Magpie Flow →
   *        NIM Magpie Zeroshot → NIM FastPitch → null (browser Web Speech API)
   * @param {string} text - Text to convert to speech
   * @param {Object} options - { voice, speed, subscriptionId, audioPrompt, audioPromptTranscript, language }
   * @returns {Buffer|null} Audio buffer (MP3/WAV) or null if all providers fail
   */
  async textToSpeech(text, options = {}) {
    try {
      return await this.execute('tts', async (providerKey) => {
        switch (providerKey) {
          case 'openai_tts':
            return this._openaiTTS(text, options);
          case 'selfhosted_tts':
            return this._selfHostedTTS(text, options);
          case 'deepgram_tts':
            return this._deepgramTTS(text, options);
          case 'nim_riva_tts':
            return this._nimRivaTTS(text, options);
          case 'nim_magpie_multilingual':
            return this._nimMagpieTTS('nim_magpie_multilingual', text, options);
          case 'nim_magpie_flow':
            return this._nimMagpieTTS('nim_magpie_flow', text, options);
          case 'nim_magpie_zeroshot':
            return this._nimMagpieTTS('nim_magpie_zeroshot', text, options);
          case 'nim_fastpitch':
            return this._nimMagpieTTS('nim_fastpitch', text, options);
          default:
            throw new Error(`Unknown TTS provider: ${providerKey}`);
        }
      }, 'default', { module: options.module || 'mock-interview', feature: 'tts' });
    } catch (err) {
      // TTS has browser fallback — return null to signal frontend to use Web Speech API
      console.error('[ai-provider] All TTS providers failed, frontend will use browser fallback:', err.message);
      return null;
    }
  }

  async _openaiTTS(text, options) {
    const voice = options.voice || 'nova';
    const speed = options.speed || 1.0;
    const truncatedText = text.length > 4000 ? text.substring(0, 4000) : text;

    const baseUrl = this.openaiBaseUrl || 'https://api.openai.com/v1';
    const apiKey = this.openaiApiKey;

    const headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };
    if (options.subscriptionId) headers['X-Subscription-ID'] = options.subscriptionId;

    const res = await fetch(`${baseUrl}/audio/speech`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'tts-1',
        input: truncatedText,
        voice,
        response_format: 'mp3',
        speed,
        task: 'tts-interview',
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      const err = new Error(`TTS API error: ${res.status} ${errText.substring(0, 200)}`);
      err.status = res.status;
      throw err;
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    // Track TTS token usage
    const ttsTokens = tokenBudget.estimateTTSTokens(truncatedText);
    return { _result: buffer, _tokenCount: ttsTokens };
  }

  /**
   * Deepgram Aura TTS — Independent fallback for text-to-speech.
   * Simple REST API: POST text body, receive audio back. No SDK required.
   * Returns MP3 audio buffer (matches OpenAI TTS output format).
   * Voices: aura-asteria-en (warm female), aura-luna-en (calm female),
   *         aura-stella-en (bright female), aura-orion-en (deep male),
   *         aura-arcas-en (strong male), aura-perseus-en (confident male)
   */
  async _deepgramTTS(text, options) {
    const truncatedText = text.length > 4000 ? text.substring(0, 4000) : text;
    // Map OpenAI voice names to Deepgram equivalents for consistency
    const voiceMap = {
      'nova': 'aura-asteria-en',    // Warm, professional female (closest to OpenAI nova)
      'alloy': 'aura-orion-en',     // Neutral male
      'echo': 'aura-perseus-en',    // Confident male
      'fable': 'aura-luna-en',      // Calm female
      'onyx': 'aura-arcas-en',      // Deep male
      'shimmer': 'aura-stella-en',  // Bright female
    };
    const voice = voiceMap[options.voice] || options.deepgramVoice || 'aura-asteria-en';

    const res = await fetch(`https://api.deepgram.com/v1/speak?model=${voice}&encoding=mp3`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${this.deepgramApiKey}`,
        'Content-Type': 'text/plain',
      },
      body: truncatedText,
    });

    if (!res.ok) {
      const errText = await res.text();
      const err = new Error(`Deepgram TTS error: ${res.status} ${errText.substring(0, 200)}`);
      err.status = res.status;
      throw err;
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length < 100) {
      throw new Error('Deepgram TTS returned empty/invalid audio');
    }

    console.log(`[ai-provider] Deepgram TTS: ${truncatedText.length} chars → ${buffer.length} bytes MP3 (voice: ${voice})`);
    return buffer;
  }

  /**
   * NIM Riva TTS — NVIDIA's speech synthesis via OpenAI-compatible REST API.
   * Uses /v1/audio/speech endpoint (same as OpenAI) with NIM model parameter.
   * Returns audio buffer.
   */
  async _nimRivaTTS(text, options) {
    const truncatedText = text.length > 4000 ? text.substring(0, 4000) : text;

    // NIM TTS uses OpenAI-compatible /v1/audio/speech endpoint
    const nimTtsBase = process.env.NIM_TTS_BASE_URL || this.nimBaseUrl;
    const res = await fetch(`${nimTtsBase}/audio/speech`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.nimApiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'audio/wav',
      },
      body: JSON.stringify({
        model: 'nvidia/riva-tts',
        input: truncatedText,
        voice: options.nimVoice || 'default',
        response_format: 'wav',
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      const err = new Error(`NIM Riva TTS error: ${res.status} ${errText.substring(0, 200)}`);
      err.status = res.status;
      throw err;
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length < 100) {
      throw new Error('NIM Riva TTS returned empty/invalid audio');
    }

    return buffer;
  }

  /**
   * NIM Magpie/FastPitch TTS — Generic adapter for all NIM TTS models.
   * Uses OpenAI-compatible /v1/audio/speech endpoint with model parameter.
   * Voice-cloning models (Flow, Zeroshot) require an audio prompt — if not provided,
   * they throw a notApplicable error and the fallback system skips them silently.
   * @param {string} configKey - Key into NIM_TTS_CONFIGS
   * @param {string} text - Text to synthesize
   * @param {Object} options - { language, nimVoice, audioPrompt, audioPromptTranscript }
   * @returns {Buffer} Audio buffer (WAV format)
   */
  async _nimMagpieTTS(configKey, text, options) {
    const config = NIM_TTS_CONFIGS[configKey];
    if (!config) throw new Error(`Unknown NIM TTS config: ${configKey}`);

    // Voice-cloning models require audio prompts — skip gracefully if not provided
    if (config.requiresAudioPrompt && !options.audioPrompt) {
      const err = new Error(`${config.name} requires an audio prompt for voice cloning — skipping`);
      err.notApplicable = true;
      throw err;
    }

    const truncatedText = text.length > (config.maxTextLength || 4000)
      ? text.substring(0, config.maxTextLength || 4000)
      : text;

    // Map config keys to NIM model IDs
    const modelMap = {
      nim_magpie_multilingual: NIM_MODELS.tts_magpie_multilingual,
      nim_magpie_flow: NIM_MODELS.tts_magpie_flow,
      nim_magpie_zeroshot: NIM_MODELS.tts_magpie_zeroshot,
      nim_fastpitch: NIM_MODELS.tts_fastpitch,
    };
    const model = modelMap[configKey];
    if (!model) throw new Error(`No NIM model ID for TTS config: ${configKey}`);

    // Use model-specific base URL if configured, otherwise default NIM base
    const baseUrl = config.baseUrl || process.env.NIM_TTS_BASE_URL || this.nimBaseUrl;

    // Use OpenAI-compatible /v1/audio/speech endpoint (JSON body)
    const voice = config.defaultVoice || options.nimVoice || 'default';

    const res = await fetch(`${baseUrl}/audio/speech`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.nimApiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'audio/wav',
      },
      body: JSON.stringify({
        model,
        input: truncatedText,
        voice,
        response_format: 'wav',
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      const err = new Error(`NIM ${config.name} error: ${res.status} ${errText.substring(0, 200)}`);
      err.status = res.status;
      throw err;
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length < 100) {
      throw new Error(`NIM ${config.name} returned empty/invalid audio`);
    }

    return buffer;
  }

  // ─── Speech-to-Text (ASR) ────────────────────────────────────

  /**
   * Transcribe audio with automatic provider fallback.
   * Chain: OpenAI Whisper → NIM Parakeet v2 → NIM Parakeet v3
   * @param {Buffer} audioBuffer - Audio data buffer
   * @param {string} filename - Filename with extension
   * @param {string} contentType - MIME type
   * @param {Object} options - { subscriptionId }
   * @returns {Object|null} Transcription result or null
   */
  async transcribeAudio(audioBuffer, filename, contentType, options = {}) {
    try {
      return await this.execute('asr', async (providerKey) => {
        switch (providerKey) {
          case 'openai_whisper':
            return this._openaiWhisper(audioBuffer, filename, contentType, options);
          case 'selfhosted_stt':
            return this._selfHostedSTT(audioBuffer, filename, contentType, options);
          case 'groq_whisper':
            return this._groqWhisper(audioBuffer, filename, contentType, options);
          case 'deepgram_stt':
            return this._deepgramSTT(audioBuffer, filename, contentType, options);
          case 'nim_parakeet_v2':
            return this._nimASR(NIM_MODELS.asr_parakeet_v2, audioBuffer, filename, contentType, options);
          case 'nim_parakeet_v3':
            return this._nimASR(NIM_MODELS.asr_parakeet_v3, audioBuffer, filename, contentType, options);
          default:
            throw new Error(`Unknown ASR provider: ${providerKey}`);
        }
      }, 'default', { module: options.module || 'mock-interview', feature: 'asr' });
    } catch (err) {
      console.error('[ai-provider] All ASR providers failed:', err.message);
      return null;
    }
  }

  async _openaiWhisper(audioBuffer, filename, contentType, options) {
    const formData = new FormData();
    formData.append('file', audioBuffer, { filename, contentType });
    formData.append('model', 'whisper-1');
    formData.append('response_format', 'verbose_json');

    const baseUrl = this.openaiBaseUrl || 'https://api.openai.com/v1';
    const apiKey = this.openaiApiKey;

    const headers = {
      'Authorization': `Bearer ${apiKey}`,
      ...formData.getHeaders(),
    };
    if (options.subscriptionId) headers['X-Subscription-ID'] = options.subscriptionId;

    const res = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!res.ok) {
      const errText = await res.text();
      const err = new Error(`Whisper API error: ${res.status} ${errText.substring(0, 200)}`);
      err.status = res.status;
      throw err;
    }

    const result = await res.json();
    // Track ASR token usage based on audio buffer size
    const asrTokens = tokenBudget.estimateASRTokens(audioBuffer.length);
    return { _result: result, _tokenCount: asrTokens };
  }

  /**
   * Deepgram Nova-2 STT — Independent fallback for speech-to-text.
   * Simple REST API: POST audio body, receive JSON transcription.
   * Response is normalized to match OpenAI Whisper format for compatibility.
   * Nova-2 features: smart formatting, punctuation, utterance detection.
   */
  async _deepgramSTT(audioBuffer, filename, contentType, options) {
    // Map common audio MIME types to Deepgram-compatible content types
    const mimeMap = {
      'audio/webm': 'audio/webm',
      'audio/wav': 'audio/wav',
      'audio/mp3': 'audio/mpeg',
      'audio/mpeg': 'audio/mpeg',
      'audio/mp4': 'audio/mp4',
      'audio/ogg': 'audio/ogg',
      'audio/flac': 'audio/flac',
    };
    const dgContentType = mimeMap[contentType] || contentType || 'audio/webm';

    const res = await fetch('https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&punctuate=true&utterances=true', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${this.deepgramApiKey}`,
        'Content-Type': dgContentType,
      },
      body: audioBuffer,
    });

    if (!res.ok) {
      const errText = await res.text();
      const err = new Error(`Deepgram STT error: ${res.status} ${errText.substring(0, 200)}`);
      err.status = res.status;
      throw err;
    }

    const result = await res.json();

    // Extract transcript from Deepgram response
    const channel = result.results?.channels?.[0];
    const alternative = channel?.alternatives?.[0];
    const transcript = alternative?.transcript || '';
    const confidence = alternative?.confidence || 0;
    const detectedLang = channel?.detected_language || 'en';
    const duration = result.metadata?.duration || 0;

    if (!transcript || transcript.trim().length === 0) {
      throw new Error('Deepgram STT returned empty transcript');
    }

    console.log(`[ai-provider] Deepgram STT: ${audioBuffer.length} bytes → "${transcript.substring(0, 80)}..." (confidence: ${(confidence * 100).toFixed(1)}%)`);

    // Normalize to OpenAI Whisper verbose_json format for compatibility
    return {
      text: transcript,
      language: detectedLang,
      duration,
      segments: (result.results?.utterances || []).map((u, i) => ({
        id: i,
        start: u.start || 0,
        end: u.end || 0,
        text: u.transcript || '',
      })),
      _provider: 'deepgram',
      _confidence: confidence,
    };
  }

  // ─── Groq Whisper ASR (Layer 3: fast, free tier available) ──
  /**
   * Groq whisper-large-v3-turbo — Fast ASR fallback via Groq.
   * Uses OpenAI-compatible /audio/transcriptions endpoint.
   * Returns Whisper-compatible JSON for seamless integration.
   */
  async _groqWhisper(audioBuffer, filename, contentType, options) {
    const formData = new FormData();
    formData.append('file', audioBuffer, { filename, contentType });
    formData.append('model', 'whisper-large-v3-turbo');
    formData.append('response_format', 'verbose_json');

    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.groqApiKey}`,
        ...formData.getHeaders(),
      },
      body: formData,
    });

    if (!res.ok) {
      const errText = await res.text();
      const err = new Error(`Groq Whisper error: ${res.status} ${errText.substring(0, 200)}`);
      err.status = res.status;
      throw err;
    }

    const result = await res.json();
    console.log(`[ai-provider] Groq Whisper: ${audioBuffer.length} bytes → "${(result.text || '').substring(0, 80)}..."`);
    return result;
  }

  // ─── Self-hosted Audio (Layer 2: no API keys) ───────────────

  /**
   * Self-hosted TTS via Piper — CPU-only, no API key required.
   * Returns WAV audio buffer. Fallback chain skips if binaries not installed.
   */
  async _selfHostedTTS(text, options) {
    if (!selfHostedAudio || !this.selfHostedTTSAvailable) {
      throw new Error('Self-hosted TTS not available');
    }
    const buffer = await selfHostedAudio.synthesize(text, options);
    return buffer;
  }

  /**
   * Self-hosted STT via whisper.cpp — CPU-only, no API key required.
   * Returns OpenAI Whisper-compatible JSON. Skips if binaries not installed.
   */
  async _selfHostedSTT(audioBuffer, filename, contentType, options) {
    if (!selfHostedAudio || !this.selfHostedSTTAvailable) {
      throw new Error('Self-hosted STT not available');
    }
    const result = await selfHostedAudio.transcribe(audioBuffer, filename, contentType);
    return result;
  }

  async _nimASR(model, audioBuffer, filename, contentType, options) {
    // NIM Parakeet uses OpenAI-compatible transcription endpoint
    const formData = new FormData();
    formData.append('file', audioBuffer, { filename, contentType });
    formData.append('model', model);
    formData.append('response_format', 'verbose_json');

    const headers = {
      'Authorization': `Bearer ${this.nimApiKey}`,
      ...formData.getHeaders(),
    };

    const res = await fetch(`${this.nimBaseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!res.ok) {
      const errText = await res.text();
      const err = new Error(`NIM ASR (${model}) error: ${res.status} ${errText.substring(0, 200)}`);
      err.status = res.status;
      throw err;
    }

    return await res.json();
  }

  // ─── Embeddings ──────────────────────────────────────────────

  /**
   * Generate text embeddings with automatic provider fallback.
   * Chain: OpenAI text-embedding-3-small → NIM NV-EmbedQA → NIM Nemotron-Embed-VL
   * @param {string} text - Text to embed
   * @param {Object} options - { subscriptionId }
   * @returns {number[]} Embedding vector
   */
  async generateEmbedding(text, options = {}) {
    if (!text || text.trim().length === 0) {
      throw new Error('Cannot generate embedding for empty text');
    }

    return this.execute('embedding', async (providerKey) => {
      switch (providerKey) {
        case 'openai_embed':
          return this._openaiEmbedding(text, options);
        case 'nim_embed_qa':
          return this._nimEmbedding(NIM_MODELS.embed_qa, text, options);
        case 'nim_embed_vl':
          return this._nimEmbedding(NIM_MODELS.embed_vl, text, options);
        default:
          throw new Error(`Unknown embedding provider: ${providerKey}`);
      }
    }, 'default', { module: options.module || 'job-matching', feature: 'embedding' });
  }

  async _openaiEmbedding(text, options) {
    const client = this.clients.openai;
    const truncated = text.substring(0, 8000);

    const params = {
      model: 'text-embedding-3-small',
      input: truncated,
    };
    if (options.subscriptionId) params.task = 'embedding';

    const response = await client.embeddings.create(params);
    const embedding = response.data[0].embedding;
    // Track embedding token usage
    const embedTokens = (response.usage && response.usage.total_tokens)
      ? response.usage.total_tokens
      : tokenBudget.estimateTokensFromText(truncated);
    return { _result: embedding, _tokenCount: embedTokens };
  }

  async _nimEmbedding(model, text, options) {
    const truncated = text.substring(0, 8000);

    // NIM embedding models (v2) require input_type for asymmetric models.
    // Using raw fetch instead of OpenAI SDK because NIM's strict Pydantic
    // validation rejects SDK's extra_body parameter (400 extra_forbidden).
    const res = await fetch(`${this.nimBaseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.nimApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: truncated,
        input_type: options.inputType || 'query',
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      const err = new Error(`NIM Embedding (${model}) error: ${res.status} ${errText.substring(0, 200)}`);
      err.status = res.status;
      throw err;
    }

    const data = await res.json();
    return data.data[0].embedding;
  }

  // ─── Reranking ───────────────────────────────────────────────

  /**
   * Rerank search results for quality improvement.
   * Uses NIM NV-RerankQA model to reorder candidate/job matches.
   * @param {string} query - The search query
   * @param {string[]} documents - Array of document texts to rerank
   * @param {Object} options - { topN }
   * @returns {Array} Reranked results with scores
   */
  async rerank(query, documents, options = {}) {
    if (!this.nimAvailable) {
      // No NIM = return original order with default scores
      console.log('[ai-provider] Reranking skipped (NIM not available), returning original order');
      return documents.map((doc, i) => ({ index: i, score: 1 - (i * 0.01), text: doc }));
    }

    try {
      return await this.execute('reranking', async (providerKey) => {
        let model;
        switch (providerKey) {
          case 'nim_rerank_qa':
            model = NIM_MODELS.rerank_qa;
            break;
          case 'nim_rerank_vl':
            model = NIM_MODELS.rerank_vl;
            break;
          default:
            throw new Error(`Unknown reranking provider: ${providerKey}`);
        }

        const topN = options.topN || documents.length;

        // NIM reranking endpoint
        const res = await fetch(`${this.nimBaseUrl}/ranking`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.nimApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            query: { text: query },
            passages: documents.map(doc => ({ text: doc })),
            top_n: topN,
          }),
        });

        if (!res.ok) {
          const errText = await res.text();
          const err = new Error(`NIM Reranking error: ${res.status} ${errText.substring(0, 200)}`);
          err.status = res.status;
          throw err;
        }

        const result = await res.json();
        return (result.rankings || []).map(r => ({
          index: r.index,
          score: r.logit || r.score || 0,
          text: documents[r.index],
        }));
      }, 'default', { module: options.module || 'job-matching', feature: 'reranking' });
    } catch (err) {
      console.error('[ai-provider] Reranking failed, returning original order:', err.message);
      return documents.map((doc, i) => ({ index: i, score: 1 - (i * 0.01), text: doc }));
    }
  }

  // ─── Safety / Content Moderation ─────────────────────────────

  /**
   * Check content for safety violations using NIM NemoGuard.
   * @param {string} content - Text to check
   * @param {Object} options - { categories }
   * @returns {Object} { safe: boolean, categories: {...}, reason: string }
   */
  async moderateContent(content, options = {}) {
    if (!this.nimAvailable) {
      // No NIM = allow all (no moderation available)
      return { safe: true, categories: {}, reason: 'Moderation not available (NIM not configured)' };
    }

    try {
      return await this.execute('safety', async (providerKey) => {
        let model;
        switch (providerKey) {
          case 'nim_safety_guard':
            model = NIM_MODELS.safety_guard;
            break;
          case 'nim_safety_reasoning':
            model = NIM_MODELS.safety_reasoning;
            break;
          default:
            throw new Error(`Unknown safety provider: ${providerKey}`);
        }

        // NemoGuard uses chat completions format with safety-specific system prompt
        const response = await this.clients.nim.chat.completions.create({
          model,
          messages: [
            {
              role: 'system',
              content: 'You are a content safety classifier. Analyze the following text for safety violations including: harassment, hate speech, violence, sexual content, self-harm, dangerous content, and professional misconduct. Return a JSON object: {"safe": true/false, "categories": {"harassment": false, "hate_speech": false, "violence": false, "sexual_content": false, "self_harm": false, "dangerous": false, "unprofessional": false}, "reason": "explanation if unsafe"}'
            },
            { role: 'user', content: content.substring(0, 4000) }
          ],
          max_tokens: 512,
          temperature: 0.1,
        });

        const text = response.choices[0].message.content;
        try {
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) return JSON.parse(jsonMatch[0]);
        } catch (e) { /* fall through */ }

        // Default safe if parsing fails
        return { safe: true, categories: {}, reason: 'Safety check completed (parse fallback)' };
      }, 'default', { module: options.module || 'safety', feature: 'content-moderation' });
    } catch (err) {
      console.error('[ai-provider] Safety moderation failed:', err.message);
      return { safe: true, categories: {}, reason: 'Safety check failed (allowing by default)' };
    }
  }

  // ─── Health Status ────────────────────────────────────────────

  getHealth() {
    const allModalities = ['llm', 'vision', 'tts', 'asr', 'embedding', 'reranking', 'safety'];
    const modalities = {};

    // Modalities with graceful degradation when no providers available
    const gracefulDegradation = {
      reranking: 'Passthrough — returns original order with default scores. No NIM reranking models available on cloud API (verified Feb 13, 2026).',
    };

    for (const modality of allModalities) {
      const chain = this.getChain(modality);
      modalities[modality] = {
        active: this.activeProviders[modality] || 'none',
        chain_depth: chain.length,
        providers: chain.map(key => ({
          key,
          available: this.isProviderAvailable(key),
          circuitOpen: this.isCircuitOpen(key, modality),
          failures: this.failures[`${key}:${modality}`] || null,
        })),
        // If chain is empty but has graceful degradation, mark it
        graceful_degradation: chain.length === 0 ? (gracefulDegradation[modality] || null) : null,
      };
    }

    // Module-specific chain info
    const moduleInfo = {};
    for (const [module, config] of Object.entries(MODULE_CHAINS)) {
      moduleInfo[module] = {};
      for (const [modality, variant] of Object.entries(config)) {
        const chain = this.getChain(modality, variant);
        const available = chain.filter(k => this.isProviderAvailable(k) && !this.isCircuitOpen(k, modality));
        moduleInfo[module][modality] = {
          variant,
          chain_depth: chain.length,
          available_count: available.length,
          providers: chain.map(k => k),
        };
      }
    }

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      nim_configured: this.nimAvailable,
      groq_configured: this.groqAvailable,
      cerebras_configured: this.cerebrasAvailable,
      deepgram_configured: this.deepgramAvailable,
      selfhosted_stt: this.selfHostedSTTAvailable,
      selfhosted_tts: this.selfHostedTTSAvailable,
      total_models_registered: Object.keys(NIM_MODELS).length,
      stats: this.stats,
      token_budget: tokenBudget.getStatus(),
      modalities,
      module_chains: moduleInfo,
      recent_logs: this.logs.slice(-20),
    };
  }

  // ─── Active Model Verification ──────────────────────────────
  // Makes REAL API calls to verify EVERY provider across ALL modalities.
  // Call on-demand from /api/ai-health/verify or every 30 min via auto-verify.
  // ~40 tokens total per full cycle. Each test tagged module='health_verify'.

  async verifyModels() {
    const results = [];
    const VERIFY_TIMEOUT = 10000;
    const timeoutPromise = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), ms));

    // ── Helper: test LLM provider (1-token chat) ──
    const testLLM = async (key, client, model, extraParams = {}) => {
      const start = Date.now();
      try {
        const params = {
          model,
          messages: [{ role: 'user', content: 'Say hi' }],
          max_tokens: 2,
          temperature: 0,
          ...extraParams,
        };
        const res = await Promise.race([
          client.chat.completions.create(params),
          timeoutPromise(VERIFY_TIMEOUT),
        ]);
        const text = (res.choices?.[0]?.message?.content || '').substring(0, 40);
        results.push({ modality: 'llm', key, model, status: 'working', ms: Date.now() - start, note: text });
      } catch (err) {
        results.push({ modality: 'llm', key, model, status: 'dead', ms: Date.now() - start, error: `${err.status || err.name}: ${(err.message || '').substring(0, 100)}` });
      }
    };

    // ── Helper: test embedding provider ──
    const testEmbed = async (key, model, useNim = true) => {
      const start = Date.now();
      try {
        if (useNim) {
          // NIM embedding: raw fetch (Pydantic rejects SDK extra_body)
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT);
          const res = await fetch(`${this.nimBaseUrl}/embeddings`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${this.nimApiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, input: 'test', input_type: 'query' }),
            signal: controller.signal,
          });
          clearTimeout(timer);
          if (!res.ok) {
            const errText = await res.text();
            results.push({ modality: 'embedding', key, model, status: 'dead', ms: Date.now() - start, error: `${res.status}: ${errText.substring(0, 100)}` });
            return;
          }
          const data = await res.json();
          const dim = data.data?.[0]?.embedding?.length || 0;
          results.push({ modality: 'embedding', key, model, status: 'working', ms: Date.now() - start, note: `${dim}d` });
        } else {
          // OpenAI embedding via SDK
          const res = await Promise.race([
            this.clients.openai.embeddings.create({ model, input: 'test', task: 'health-verify' }),
            timeoutPromise(VERIFY_TIMEOUT),
          ]);
          const dim = res.data?.[0]?.embedding?.length || 0;
          results.push({ modality: 'embedding', key, model, status: 'working', ms: Date.now() - start, note: `${dim}d` });
        }
      } catch (err) {
        results.push({ modality: 'embedding', key, model, status: 'dead', ms: Date.now() - start, error: `${err.name}: ${(err.message || '').substring(0, 100)}` });
      }
    };

    // ── Helper: test safety model (NIM chat) ──
    const testSafety = async (key, model) => {
      const start = Date.now();
      try {
        const res = await Promise.race([
          this.clients.nim.chat.completions.create({
            model,
            messages: [
              { role: 'system', content: 'Classify safety. Respond: {"safe": true}' },
              { role: 'user', content: 'Hello' },
            ],
            max_tokens: 20,
            temperature: 0.1,
          }),
          timeoutPromise(VERIFY_TIMEOUT),
        ]);
        results.push({ modality: 'safety', key, model, status: 'working', ms: Date.now() - start, note: (res.choices?.[0]?.message?.content || '').substring(0, 40) });
      } catch (err) {
        results.push({ modality: 'safety', key, model, status: 'dead', ms: Date.now() - start, error: `${err.status || err.name}: ${(err.message || '').substring(0, 100)}` });
      }
    };

    // ── Helper: test TTS provider (tiny text) ──
    const testTTS = async (key, provider) => {
      const start = Date.now();
      try {
        if (provider === 'openai') {
          const baseUrl = this.openaiBaseUrl || 'https://api.openai.com/v1';
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT);
          const res = await fetch(`${baseUrl}/audio/speech`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${this.openaiApiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'tts-1', input: 'ok', voice: 'nova', response_format: 'mp3', task: 'health-verify' }),
            signal: controller.signal,
          });
          clearTimeout(timer);
          if (!res.ok) {
            const errText = await res.text();
            results.push({ modality: 'tts', key, model: 'tts-1', status: 'dead', ms: Date.now() - start, error: `${res.status}: ${errText.substring(0, 100)}` });
            return;
          }
          const buf = await res.arrayBuffer();
          results.push({ modality: 'tts', key, model: 'tts-1', status: 'working', ms: Date.now() - start, note: `${buf.byteLength}B audio` });
        } else if (provider === 'deepgram') {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT);
          const res = await fetch('https://api.deepgram.com/v1/speak?model=aura-asteria-en&encoding=mp3', {
            method: 'POST',
            headers: { 'Authorization': `Token ${this.deepgramApiKey}`, 'Content-Type': 'text/plain' },
            body: 'ok',
            signal: controller.signal,
          });
          clearTimeout(timer);
          if (!res.ok) {
            const errText = await res.text();
            results.push({ modality: 'tts', key, model: 'deepgram-aura', status: 'dead', ms: Date.now() - start, error: `${res.status}: ${errText.substring(0, 100)}` });
            return;
          }
          const buf = await res.arrayBuffer();
          results.push({ modality: 'tts', key, model: 'deepgram-aura', status: 'working', ms: Date.now() - start, note: `${buf.byteLength}B audio` });
        } else if (provider === 'selfhosted') {
          if (!selfHostedAudio || !this.selfHostedTTSAvailable) {
            results.push({ modality: 'tts', key, model: 'piper', status: 'dead', ms: Date.now() - start, error: 'Not installed' });
            return;
          }
          const buf = await Promise.race([selfHostedAudio.synthesize('ok', {}), timeoutPromise(VERIFY_TIMEOUT)]);
          results.push({ modality: 'tts', key, model: 'piper', status: buf && buf.length > 50 ? 'working' : 'dead', ms: Date.now() - start, note: buf ? `${buf.length}B` : 'empty' });
        }
      } catch (err) {
        results.push({ modality: 'tts', key, model: provider, status: 'dead', ms: Date.now() - start, error: `${err.name}: ${(err.message || '').substring(0, 100)}` });
      }
    };

    // ── Helper: test ASR provider (tiny silent WAV) ──
    const testASR = async (key, provider) => {
      const start = Date.now();
      try {
        // Generate minimal valid WAV header (44 bytes header + 1600 bytes of silence = ~0.1s mono 16kHz)
        const sampleRate = 16000;
        const numSamples = 1600;
        const dataSize = numSamples * 2;
        const headerBuf = Buffer.alloc(44 + dataSize);
        headerBuf.write('RIFF', 0);
        headerBuf.writeUInt32LE(36 + dataSize, 4);
        headerBuf.write('WAVE', 8);
        headerBuf.write('fmt ', 12);
        headerBuf.writeUInt32LE(16, 16);
        headerBuf.writeUInt16LE(1, 20); // PCM
        headerBuf.writeUInt16LE(1, 22); // mono
        headerBuf.writeUInt32LE(sampleRate, 24);
        headerBuf.writeUInt32LE(sampleRate * 2, 28);
        headerBuf.writeUInt16LE(2, 32);
        headerBuf.writeUInt16LE(16, 34);
        headerBuf.write('data', 36);
        headerBuf.writeUInt32LE(dataSize, 40);
        // Silence: all zeros already

        if (provider === 'openai') {
          const fd = new FormData();
          fd.append('file', headerBuf, { filename: 'test.wav', contentType: 'audio/wav' });
          fd.append('model', 'whisper-1');
          fd.append('response_format', 'json');
          const baseUrl = this.openaiBaseUrl || 'https://api.openai.com/v1';
          const res = await Promise.race([
            fetch(`${baseUrl}/audio/transcriptions`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${this.openaiApiKey}`, ...fd.getHeaders() },
              body: fd,
            }),
            timeoutPromise(VERIFY_TIMEOUT),
          ]);
          if (!res.ok) {
            const errText = await res.text();
            results.push({ modality: 'asr', key, model: 'whisper-1', status: 'dead', ms: Date.now() - start, error: `${res.status}: ${errText.substring(0, 100)}` });
            return;
          }
          await res.json();
          results.push({ modality: 'asr', key, model: 'whisper-1', status: 'working', ms: Date.now() - start, note: 'transcription OK' });
        } else if (provider === 'groq') {
          const fd = new FormData();
          fd.append('file', headerBuf, { filename: 'test.wav', contentType: 'audio/wav' });
          fd.append('model', 'whisper-large-v3-turbo');
          fd.append('response_format', 'json');
          const res = await Promise.race([
            fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${this.groqApiKey}`, ...fd.getHeaders() },
              body: fd,
            }),
            timeoutPromise(VERIFY_TIMEOUT),
          ]);
          if (!res.ok) {
            const errText = await res.text();
            results.push({ modality: 'asr', key, model: 'whisper-large-v3-turbo', status: 'dead', ms: Date.now() - start, error: `${res.status}: ${errText.substring(0, 100)}` });
            return;
          }
          await res.json();
          results.push({ modality: 'asr', key, model: 'whisper-large-v3-turbo', status: 'working', ms: Date.now() - start, note: 'transcription OK' });
        } else if (provider === 'deepgram') {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT);
          const res = await fetch('https://api.deepgram.com/v1/listen?model=nova-2', {
            method: 'POST',
            headers: { 'Authorization': `Token ${this.deepgramApiKey}`, 'Content-Type': 'audio/wav' },
            body: headerBuf,
            signal: controller.signal,
          });
          clearTimeout(timer);
          if (!res.ok) {
            const errText = await res.text();
            results.push({ modality: 'asr', key, model: 'deepgram-nova-2', status: 'dead', ms: Date.now() - start, error: `${res.status}: ${errText.substring(0, 100)}` });
            return;
          }
          await res.json();
          results.push({ modality: 'asr', key, model: 'deepgram-nova-2', status: 'working', ms: Date.now() - start, note: 'transcription OK' });
        } else if (provider === 'selfhosted') {
          if (!selfHostedAudio || !this.selfHostedSTTAvailable) {
            results.push({ modality: 'asr', key, model: 'whisper.cpp', status: 'dead', ms: Date.now() - start, error: 'Not installed' });
            return;
          }
          const result = await Promise.race([selfHostedAudio.transcribe(headerBuf, 'test.wav', 'audio/wav'), timeoutPromise(VERIFY_TIMEOUT)]);
          results.push({ modality: 'asr', key, model: 'whisper.cpp', status: result ? 'working' : 'dead', ms: Date.now() - start, note: result?.text ? 'STT OK' : 'empty' });
        }
      } catch (err) {
        results.push({ modality: 'asr', key, model: provider, status: 'dead', ms: Date.now() - start, error: `${err.name}: ${(err.message || '').substring(0, 100)}` });
      }
    };

    // ═══════════════════════════════════════════════════
    // Run ALL verifications in parallel by modality group
    // ═══════════════════════════════════════════════════
    const tasks = [];

    // ─── LLM providers ───
    if (this.clients.openai) {
      tasks.push(testLLM('openai', this.clients.openai, 'gpt-4o-mini', { task: 'health-verify' }));
    }
    if (this.nimAvailable) {
      // Test 3 representative NIM LLM models (fastest, mid, largest)
      tasks.push(testLLM('nim_llama_8b', this.clients.nim, NIM_MODELS.llm_llama_8b));
      tasks.push(testLLM('nim_llama_70b', this.clients.nim, NIM_MODELS.llm_llama_70b));
      tasks.push(testLLM('nim_gpt_oss', this.clients.nim, NIM_MODELS.llm_gpt_oss));
    }
    if (this.groqAvailable) {
      tasks.push(testLLM('groq_llama_70b', this.clients.groq, 'llama-3.3-70b-versatile'));
      tasks.push(testLLM('groq_llama_8b', this.clients.groq, 'llama-3.1-8b-instant'));
    }
    if (this.cerebrasAvailable) {
      tasks.push(testLLM('cerebras_llama_8b', this.clients.cerebras, 'llama3.1-8b'));
    }

    // ─── Embedding providers ───
    if (this.clients.openai) {
      tasks.push(testEmbed('openai_embed', 'text-embedding-3-small', false));
    }
    if (this.nimAvailable) {
      tasks.push(testEmbed('nim_embed_qa', NIM_MODELS.embed_qa, true));
      tasks.push(testEmbed('nim_embed_vl', NIM_MODELS.embed_vl, true));
    }

    // ─── Safety providers ───
    if (this.nimAvailable) {
      tasks.push(testSafety('nim_safety_guard', NIM_MODELS.safety_guard));
      tasks.push(testSafety('nim_safety_reasoning', NIM_MODELS.safety_reasoning));
    }

    // ─── TTS providers ───
    if (this.clients.openai) {
      tasks.push(testTTS('openai_tts', 'openai'));
    }
    if (this.deepgramAvailable) {
      tasks.push(testTTS('deepgram_tts', 'deepgram'));
    }
    tasks.push(testTTS('selfhosted_tts', 'selfhosted'));

    // ─── ASR providers ───
    if (this.clients.openai) {
      tasks.push(testASR('openai_whisper', 'openai'));
    }
    if (this.groqAvailable) {
      tasks.push(testASR('groq_whisper', 'groq'));
    }
    if (this.deepgramAvailable) {
      tasks.push(testASR('deepgram_stt', 'deepgram'));
    }
    tasks.push(testASR('selfhosted_stt', 'selfhosted'));

    await Promise.all(tasks);

    // Sort results by modality for clean output
    results.sort((a, b) => a.modality.localeCompare(b.modality) || a.key.localeCompare(b.key));

    // Cache results for dashboard + auto-verify
    const working = results.filter(r => r.status === 'working').length;
    this._lastVerification = {
      timestamp: new Date().toISOString(),
      totalTested: results.length,
      totalWorking: working,
      totalDead: results.length - working,
      results,
    };

    // Log the verify calls themselves as module 'health_verify' for token tracking
    try {
      aiCallLogger.logCall({
        module: 'health_verify',
        feature: 'full-verification',
        modality: 'system',
        provider: 'multi',
        model: 'verify-all',
        totalTokens: results.length * 3, // ~3 tokens per test
        latencyMs: 0,
        success: true,
      });
    } catch (e) { /* non-critical */ }

    console.log(`[ai-provider] ✅ Full verification complete: ${working}/${results.length} working (${results.length - working} dead)`);

    // Persist verification results to DB so they survive deploy restarts
    this._saveVerificationToDb(this._lastVerification).catch(err => {
      console.warn('[ai-provider] Failed to persist verification to DB:', err.message);
    });

    return this._lastVerification;
  }

  async _saveVerificationToDb(verification) {
    try {
      // Save metadata
      await pool.query(
        `INSERT INTO ai_verification_meta (total_tested, total_working, total_dead, verified_at)
         VALUES ($1, $2, $3, $4)`,
        [verification.totalTested, verification.totalWorking, verification.totalDead, verification.timestamp]
      );

      // Upsert each provider result
      for (const r of verification.results) {
        await pool.query(
          `INSERT INTO ai_provider_verification (provider_key, modality, model, status, latency_ms, note, error_message, verified_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (provider_key, modality) DO UPDATE SET
             model = EXCLUDED.model, status = EXCLUDED.status, latency_ms = EXCLUDED.latency_ms,
             note = EXCLUDED.note, error_message = EXCLUDED.error_message, verified_at = EXCLUDED.verified_at`,
          [r.key, r.modality, r.model || '', r.status, r.ms || 0, r.note || null, r.error || null, verification.timestamp]
        );
      }
      console.log('[ai-provider] Verification results persisted to DB');
    } catch (err) {
      if (!err.message.includes('does not exist')) throw err;
      // Table not created yet — will be available after next migration
    }
  }

  async _loadVerificationFromDb() {
    try {
      // Load latest verification metadata
      const metaResult = await pool.query(
        `SELECT * FROM ai_verification_meta ORDER BY verified_at DESC LIMIT 1`
      );
      if (metaResult.rows.length === 0) return null;

      const meta = metaResult.rows[0];

      // Load all provider results
      const resultsResult = await pool.query(
        `SELECT provider_key as key, modality, model, status, latency_ms as ms, note, error_message as error, verified_at
         FROM ai_provider_verification ORDER BY modality, provider_key`
      );

      return {
        timestamp: meta.verified_at,
        totalTested: meta.total_tested,
        totalWorking: meta.total_working,
        totalDead: meta.total_dead,
        results: resultsResult.rows.map(r => ({
          key: r.key,
          modality: r.modality,
          model: r.model,
          status: r.status,
          ms: r.ms,
          note: r.note,
          error: r.error,
        })),
      };
    } catch (err) {
      if (!err.message.includes('does not exist')) {
        console.warn('[ai-provider] Failed to load verification from DB:', err.message);
      }
      return null;
    }
  }

  getLastVerification() {
    return this._lastVerification || null;
  }

  // ─── Reset (for testing) ──────────────────────────────────────

  resetCircuitBreakers() {
    this.failures = {};
    console.log('[ai-provider] All circuit breakers reset');
  }

  async _persistStats() {
    try {
      const upsert = async (key, value) => {
        await pool.query(
          `INSERT INTO ai_provider_stats (stat_key, stat_value, updated_at) VALUES ($1, $2, NOW())
           ON CONFLICT (stat_key) DO UPDATE SET stat_value = $2, updated_at = NOW()`,
          [key, value]
        );
      };
      await upsert('totalCalls', this.stats.totalCalls);
      await upsert('totalFailovers', this.stats.totalFailovers);
      for (const [provider, count] of Object.entries(this.stats.providerCalls)) {
        await upsert(`pc:${provider}`, count);
      }
    } catch (err) {
      // Table may not exist yet
      if (!err.message.includes('does not exist')) {
        console.warn('[ai-provider] Stats persist failed:', err.message);
      }
    }
  }
}

// Singleton
const aiProvider = new AIProviderService();
module.exports = aiProvider;
