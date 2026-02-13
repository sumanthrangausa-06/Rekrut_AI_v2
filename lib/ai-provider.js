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

// Circuit breaker: skip providers that failed recently
const CIRCUIT_BREAK_MS = 5 * 60 * 1000; // 5 minutes

// HTTP status codes that indicate provider-level issues (retryable)
// 404 included: NIM audio endpoints return 404 (not available on cloud API),
// must not abort the entire fallback chain — try the next provider instead.
const RETRYABLE_STATUS = new Set([401, 402, 404, 429, 500, 502, 503, 504]);

// ─── NIM Model Registry ──────────────────────────────────────────
// Complete catalog of NIM models organized by capability tier
const NIM_MODELS = {
  // LLM Models — ordered by quality/cost ratio
  llm_super: process.env.NIM_LLM_MODEL || 'nvidia/llama-3.3-nemotron-super-49b-v1',
  llm_deepseek_v3: process.env.NIM_LLM_DEEPSEEK_V3 || 'deepseek-ai/deepseek-v3p2',
  llm_kimi: process.env.NIM_LLM_KIMI || 'moonshot-ai/kimi-k2.5',
  llm_step_flash: process.env.NIM_LLM_STEP_FLASH || 'stepfun-ai/step-3.5-flash',
  llm_gpt_oss: process.env.NIM_LLM_GPT_OSS || 'openai/gpt-oss-120b',
  llm_nano: process.env.NIM_LLM_NANO || 'nvidia/nemotron-nano-8b-v2',
  llm_deepseek_v3_1: process.env.NIM_LLM_DEEPSEEK_V3_1 || 'deepseek-ai/deepseek-v3p1',
  llm_mistral_small: process.env.NIM_LLM_MISTRAL_SMALL || 'mistralai/mistral-small-24b-instruct-2501',
  llm_qwen_72b: process.env.NIM_LLM_QWEN || 'qwen/qwen2.5-72b-instruct',

  // Reasoning Models — for assessments, complex evaluation
  reasoning_deepseek_r1: process.env.NIM_REASONING_R1 || 'deepseek-ai/deepseek-r1',
  reasoning_qwq: process.env.NIM_REASONING_QWQ || 'qwen/qwq-32b',

  // Vision Models — for body language, resume OCR, video analysis
  vision_cosmos: process.env.NIM_VISION_MODEL || 'nvidia/cosmos-reason2-8b',
  vision_nemotron_vl: process.env.NIM_VISION_FALLBACK_MODEL || 'nvidia/nemotron-nano-12b-v2-vl',
  vision_kimi: process.env.NIM_VISION_KIMI || 'moonshot-ai/kimi-k2.5',
  vision_gemma: process.env.NIM_VISION_GEMMA || 'google/gemma-3-27b-it',

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

  // Reranking Models — for search quality improvement
  rerank_qa: process.env.NIM_RERANK_MODEL || 'nvidia/llama-3.2-nv-rerankqa-1b-v2',
  rerank_vl: process.env.NIM_RERANK_VL || 'nvidia/llama-nemotron-rerank-vl-1b-v2',

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
  'mock-interview': {
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

    console.log('[ai-provider] Initialized. NIM available:', this.nimAvailable);
    console.log('[ai-provider] Providers:', Object.keys(this.clients).join(', '));
    console.log('[ai-provider] Modalities: llm, vision, tts, asr, embedding, reranking, safety');
  }

  _initClients() {
    // Anthropic client (Polsia proxy) — primary for LLM text
    if (process.env.POLSIA_API_URL && process.env.POLSIA_API_KEY) {
      this.clients.anthropic = new Anthropic({
        baseURL: process.env.POLSIA_API_URL,
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
      // ─── LLM Chains (7-10 providers deep) ────────────────
      llm: {
        // Default: balanced quality and cost
        default: [
          'anthropic',           // Polsia/Claude — current primary
          'openai',              // Polsia/OpenAI GPT-4o-mini
          'nim_nemotron_super',  // NIM Nemotron Super 49B — best value
          'nim_kimi',            // NIM Kimi K2.5 — 1T MoE multimodal
          'nim_deepseek_v3',     // NIM DeepSeek V3.2 — GPT-5 level
          'nim_deepseek_v3_1',   // NIM DeepSeek V3.1 — hybrid thinking + tool use
          'nim_step_flash',      // NIM Step 3.5 Flash — ultra efficient
          'nim_qwen_72b',        // NIM Qwen 2.5 72B — 95%+ GPT-4 parity
          'nim_gpt_oss',         // NIM GPT-OSS-120B — OpenAI open model
        ],
        // Quality: best models first for critical tasks (interviews, coaching)
        quality: [
          'anthropic',
          'openai',
          'nim_deepseek_v3',     // DeepSeek V3.2 — strongest open model
          'nim_kimi',            // Kimi K2.5 — multimodal reasoning
          'nim_deepseek_v3_1',   // DeepSeek V3.1 — hybrid thinking
          'nim_nemotron_super',  // Nemotron Super 49B
          'nim_qwen_72b',        // Qwen 2.5 72B — strong math
          'nim_step_flash',
          'nim_gpt_oss',
        ],
        // Efficient: cheapest models first for bulk/simple tasks
        efficient: [
          'anthropic',
          'openai',
          'nim_nano',            // Nemotron Nano 9B — $0.04/$0.16
          'nim_mistral_small',   // Mistral Small 24B — $0.20/$0.60
          'nim_nemotron_super',  // Nemotron Super 49B — $0.10/$0.40
          'nim_qwen_72b',        // Qwen 2.5 72B — ~$0.30/$0.30
          'nim_gpt_oss',
        ],
        // Reasoning: models with strong reasoning for assessments
        reasoning: [
          'anthropic',
          'openai',
          'nim_deepseek_r1',     // DeepSeek R1 — best open reasoning model
          'nim_qwq',             // QwQ-32B — dedicated reasoning model
          'nim_step_flash',      // Step 3.5 Flash — 97.3% AIME champion
          'nim_deepseek_v3',     // DeepSeek V3.2 — strong reasoning
          'nim_kimi',            // Kimi K2.5 — thinking mode
          'nim_nemotron_super',
        ],
      },

      // ─── Vision Chains (4-5 providers deep) ──────────────
      vision: {
        default: [
          'openai_vision',       // Polsia/OpenAI GPT-4o
          'nim_cosmos',          // NIM Cosmos Reason2 8B
          'nim_nemotron_vl',     // NIM Nemotron Nano 12B VL
          'nim_kimi_vision',     // NIM Kimi K2.5 (multimodal)
          'nim_gemma_vision',    // NIM Gemma 3 27B (140+ languages, multimodal)
        ],
        // Document/OCR chain for resume parsing
        document: [
          'openai_vision',       // Polsia/OpenAI GPT-4o
          'nim_nemotron_vl',     // NIM Nemotron Nano 12B VL — good at documents
          'nim_kimi_vision',     // NIM Kimi K2.5 — PDF native
          'nim_gemma_vision',    // NIM Gemma 3 27B — multilingual
          'nim_cosmos',          // NIM Cosmos Reason2 8B
        ],
      },

      // ─── TTS Chains (OpenAI + browser fallback) ───────────
      // NOTE: NIM audio models (Riva, Magpie, FastPitch) are NOT available on
      // NVIDIA's cloud API (integrate.api.nvidia.com). They require self-hosted
      // NIM containers. Removed from chain to avoid 40s of timeout waste.
      // To re-enable: deploy NIM containers and set NIM_TTS_BASE_URL env var.
      tts: {
        default: [
          'openai_tts',              // Polsia/OpenAI TTS-1 — primary (and only cloud provider)
          // Browser Web Speech API handled at frontend level as final fallback
        ],
      },

      // ─── ASR Chains (OpenAI only) ──────────────────────────
      // NOTE: NIM Parakeet ASR models are NOT available on NVIDIA's cloud API.
      // They require self-hosted NIM containers. Removed from chain to avoid timeouts.
      // To re-enable: deploy NIM containers and set NIM_ASR_BASE_URL env var.
      asr: {
        default: [
          'openai_whisper',      // Polsia/OpenAI Whisper — primary (and only cloud provider)
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

      // ─── Reranking Chains (2 providers) ──────────────────
      reranking: {
        default: [
          'nim_rerank_qa',       // NIM NV-RerankQA 1B v2 — text reranking
          'nim_rerank_vl',       // NIM Nemotron-Rerank-VL 1B — multimodal
        ],
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
      case 'nim_kimi':
      case 'nim_deepseek_v3':
      case 'nim_deepseek_v3_1':
      case 'nim_step_flash':
      case 'nim_gpt_oss':
      case 'nim_nano':
      case 'nim_mistral_small':
      case 'nim_qwen_72b':
      case 'nim_deepseek_r1':
      case 'nim_qwq':
      case 'nim_cosmos':
      case 'nim_nemotron_vl':
      case 'nim_kimi_vision':
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
      case 'nim_rerank_qa':
      case 'nim_rerank_vl':
      case 'nim_safety_guard':
      case 'nim_safety_reasoning':
        return this.nimAvailable;
      default:
        return false;
    }
  }

  // ─── Circuit Breaker ──────────────────────────────────────────

  isCircuitOpen(providerKey, modality) {
    const key = `${providerKey}:${modality}`;
    const failure = this.failures[key];
    if (!failure) return false;

    const elapsed = Date.now() - failure.lastFailure;
    if (elapsed > CIRCUIT_BREAK_MS) {
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
      // Log failed call
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
    const timeoutMs = modality === 'tts' || modality === 'asr' ? 8000
      : modality === 'llm' ? 15000
      : modality === 'vision' ? 30000
      : 10000;

    let lastError;
    let failedProvider = null;  // Track from→to for failover logging
    for (const providerKey of chain) {
      triedProviders.push(providerKey);
      try {
        // Wrap each provider call with a timeout to prevent hanging
        const result = await Promise.race([
          executeFn(providerKey),
          new Promise((_, reject) => setTimeout(() => {
            const err = new Error(`${providerKey} timed out after ${timeoutMs}ms for ${modality}`);
            err.code = 'ETIMEDOUT';
            reject(err);
          }, timeoutMs))
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
        const latencyMs = Date.now() - callStart;
        aiCallLogger.logCall({
          module: callMeta.module || 'unknown',
          feature: callMeta.feature || '',
          modality,
          provider: providerKey,
          model: callMeta.model || this._getModelName(providerKey) || providerKey,
          promptTokens: Math.round(tokenCount * 0.6),
          completionTokens: Math.round(tokenCount * 0.4),
          totalTokens: tokenCount,
          latencyMs,
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

    // All providers exhausted — log failure
    aiCallLogger.logCall({
      module: callMeta.module || 'unknown',
      feature: callMeta.feature || '',
      modality,
      provider: triedProviders[triedProviders.length - 1] || 'none',
      model: '',
      latencyMs: Date.now() - callStart,
      success: false,
      errorMessage: (lastError && lastError.message) || 'All providers exhausted',
      fallbackChain: triedProviders,
      userId: callMeta.userId || null,
    });

    console.error(`[ai-provider] All ${modality} providers exhausted.`);
    throw lastError || new Error(`All ${modality} providers failed`);
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
      'nim_nemotron_super': NIM_MODELS.llm_super,
      'nim_kimi': NIM_MODELS.llm_kimi,
      'nim_deepseek_v3': NIM_MODELS.llm_deepseek_v3,
      'nim_deepseek_v3_1': NIM_MODELS.llm_deepseek_v3_1,
      'nim_step_flash': NIM_MODELS.llm_step_flash,
      'nim_gpt_oss': NIM_MODELS.llm_gpt_oss,
      'nim_nano': NIM_MODELS.llm_nano,
      'nim_mistral_small': NIM_MODELS.llm_mistral_small,
      'nim_qwen_72b': NIM_MODELS.llm_qwen_72b,
      'nim_deepseek_r1': NIM_MODELS.reasoning_deepseek_r1,
      'nim_qwq': NIM_MODELS.reasoning_qwq,
      'nim_cosmos': NIM_MODELS.vision_cosmos,
      'nim_nemotron_vl': NIM_MODELS.vision_nemotron_vl,
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
        case 'nim_nemotron_super':
          return this._nimChat(NIM_MODELS.llm_super, messages, options);
        case 'nim_kimi':
          return this._nimChat(NIM_MODELS.llm_kimi, messages, options);
        case 'nim_deepseek_v3':
          return this._nimChat(NIM_MODELS.llm_deepseek_v3, messages, options);
        case 'nim_deepseek_v3_1':
          return this._nimChat(NIM_MODELS.llm_deepseek_v3_1, messages, options);
        case 'nim_step_flash':
          return this._nimChat(NIM_MODELS.llm_step_flash, messages, options);
        case 'nim_gpt_oss':
          return this._nimChat(NIM_MODELS.llm_gpt_oss, messages, options);
        case 'nim_nano':
          return this._nimChat(NIM_MODELS.llm_nano, messages, options);
        case 'nim_mistral_small':
          return this._nimChat(NIM_MODELS.llm_mistral_small, messages, options);
        case 'nim_qwen_72b':
          return this._nimChat(NIM_MODELS.llm_qwen_72b, messages, options);
        case 'nim_deepseek_r1':
          return this._nimChat(NIM_MODELS.reasoning_deepseek_r1, messages, options);
        case 'nim_qwq':
          return this._nimChat(NIM_MODELS.reasoning_qwq, messages, options);
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
        case 'nim_cosmos':
          client = this.clients.nim;
          model = NIM_MODELS.vision_cosmos;
          break;
        case 'nim_nemotron_vl':
          client = this.clients.nim;
          model = NIM_MODELS.vision_nemotron_vl;
          break;
        case 'nim_kimi_vision':
          client = this.clients.nim;
          model = NIM_MODELS.vision_kimi;
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
    const client = this.clients.nim;
    const truncated = text.substring(0, 8000);

    const response = await client.embeddings.create({
      model,
      input: truncated,
    });
    return response.data[0].embedding;
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
      total_models_registered: Object.keys(NIM_MODELS).length,
      stats: this.stats,
      token_budget: tokenBudget.getStatus(),
      modalities,
      module_chains: moduleInfo,
      recent_logs: this.logs.slice(-20),
    };
  }

  // ─── Reset (for testing) ──────────────────────────────────────

  resetCircuitBreakers() {
    this.failures = {};
    console.log('[ai-provider] All circuit breakers reset');
  }
}

// Singleton
const aiProvider = new AIProviderService();
module.exports = aiProvider;
