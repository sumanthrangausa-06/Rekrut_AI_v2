/**
 * AI Provider Fallback Service
 *
 * Provides automatic failover between AI providers per modality.
 * When a provider fails (401, 402, 429, timeout), automatically
 * switches to the next provider in the chain. No manual intervention.
 *
 * Modalities: LLM, TTS, ASR, Vision, Embedding
 * Providers: Polsia/Anthropic, Polsia/OpenAI, NVIDIA NIM (multiple models)
 */

const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const fetch = require('node-fetch');
const FormData = require('form-data');

// Circuit breaker: skip providers that failed recently
const CIRCUIT_BREAK_MS = 5 * 60 * 1000; // 5 minutes

// HTTP status codes that indicate provider-level issues (retryable)
const RETRYABLE_STATUS = new Set([401, 402, 429, 500, 502, 503, 504]);

// NIM model defaults (overridable via env)
const NIM_MODELS = {
  llm_primary: process.env.NIM_LLM_MODEL || 'nvidia/llama-3.3-nemotron-super-49b-v1',
  llm_secondary: process.env.NIM_LLM_FALLBACK_MODEL || 'deepseek-ai/deepseek-v3p2',
  llm_tertiary: process.env.NIM_LLM_TERTIARY_MODEL || 'moonshot-ai/kimi-k2.5',
  vision_primary: process.env.NIM_VISION_MODEL || 'nvidia/cosmos-reason2-8b',
  vision_secondary: process.env.NIM_VISION_FALLBACK_MODEL || 'nvidia/nemotron-nano-12b-v2-vl',
  asr: process.env.NIM_ASR_MODEL || 'nvidia/parakeet-tdt-0.6b-v2',
  embedding: process.env.NIM_EMBED_MODEL || 'nvidia/llama-3.2-nv-embedqa-1b-v2',
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

  getChain(modality) {
    const chains = {
      llm: [
        'anthropic',       // Polsia/Claude — current primary
        'openai',          // Polsia/OpenAI GPT-4o-mini
        'nim_nemotron',    // NIM Nemotron Super 49B
        'nim_kimi',        // NIM Kimi K2.5
        'nim_deepseek',    // NIM DeepSeek V3.2
      ],
      vision: [
        'openai_vision',   // Polsia/OpenAI GPT-4o
        'nim_cosmos',      // NIM Cosmos Reason2 8B
        'nim_nemotron_vl', // NIM Nemotron Nano 12B VL
      ],
      tts: [
        'openai_tts',      // Polsia/OpenAI TTS-1
        // Browser Web Speech API handled at frontend level
      ],
      asr: [
        'openai_whisper',  // Polsia/OpenAI Whisper
        'nim_parakeet',    // NIM Parakeet TDT 0.6B v2
      ],
      embedding: [
        'openai_embed',    // Polsia/OpenAI text-embedding-3-small
        'nim_embed',       // NIM NV-EmbedQA 1B v2
      ],
    };
    return chains[modality] || [];
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
      case 'nim_nemotron':
      case 'nim_kimi':
      case 'nim_deepseek':
      case 'nim_cosmos':
      case 'nim_nemotron_vl':
      case 'nim_parakeet':
      case 'nim_embed':
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

  recordSuccess(providerKey, modality) {
    this.activeProviders[modality] = providerKey;
    const key = `${providerKey}:${modality}`;
    delete this.failures[key];

    this.stats.totalCalls++;
    this.stats.providerCalls[providerKey] = (this.stats.providerCalls[providerKey] || 0) + 1;
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

  // Get available providers for a modality (skipping unavailable + circuit-broken)
  getAvailableChain(modality) {
    return this.getChain(modality).filter(key =>
      this.isProviderAvailable(key) && !this.isCircuitOpen(key, modality)
    );
  }

  // ─── Core Execution with Fallback ────────────────────────────

  /**
   * Execute an AI call with automatic fallback.
   * @param {string} modality - 'llm', 'vision', 'tts', 'asr', 'embedding'
   * @param {Function} executeFn - async (providerKey) => result
   * @returns {*} Result from the first successful provider
   */
  async execute(modality, executeFn) {
    const chain = this.getAvailableChain(modality);

    if (chain.length === 0) {
      const allChain = this.getChain(modality);
      const reasons = allChain.map(k => {
        if (!this.isProviderAvailable(k)) return `${k}: not configured`;
        if (this.isCircuitOpen(k, modality)) return `${k}: circuit open`;
        return `${k}: unknown`;
      });
      throw new Error(`No available providers for ${modality}. ${reasons.join(', ')}`);
    }

    let lastError;
    for (const providerKey of chain) {
      try {
        const result = await executeFn(providerKey);
        this.recordSuccess(providerKey, modality);
        return result;
      } catch (err) {
        lastError = err;
        if (this.isRetryable(err)) {
          this.recordFailure(providerKey, modality, err);
          continue; // try next provider
        }
        // Non-retryable error (e.g., bad request, invalid input) — don't try others
        throw err;
      }
    }

    // All providers exhausted
    console.error(`[ai-provider] All ${modality} providers exhausted.`);
    throw lastError || new Error(`All ${modality} providers failed`);
  }

  // ─── LLM Chat Completion ─────────────────────────────────────

  /**
   * Chat completion with automatic provider fallback.
   * @param {Array} messages - Array of { role, content } messages
   * @param {Object} options - { system, maxTokens, max_tokens, temperature, subscriptionId, response_format }
   * @returns {string} The AI response text
   */
  async chatCompletion(messages, options = {}) {
    return this.execute('llm', async (providerKey) => {
      switch (providerKey) {
        case 'anthropic':
          return this._anthropicChat(messages, options);
        case 'openai':
          return this._openaiChat('gpt-4o-mini', messages, options, true);
        case 'nim_nemotron':
          return this._nimChat(NIM_MODELS.llm_primary, messages, options);
        case 'nim_kimi':
          return this._nimChat(NIM_MODELS.llm_tertiary, messages, options);
        case 'nim_deepseek':
          return this._nimChat(NIM_MODELS.llm_secondary, messages, options);
        default:
          throw new Error(`Unknown LLM provider: ${providerKey}`);
      }
    });
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
    return response.choices[0].message.content;
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
   * @param {Object} options - { maxTokens, subscriptionId, response_format }
   * @returns {string} The AI response text
   */
  async visionAnalysis(imageUrls, prompt, options = {}) {
    return this.execute('vision', async (providerKey) => {
      let client, model;

      switch (providerKey) {
        case 'openai_vision':
          client = this.clients.openai;
          model = 'gpt-4o';
          break;
        case 'nim_cosmos':
          client = this.clients.nim;
          model = NIM_MODELS.vision_primary;
          break;
        case 'nim_nemotron_vl':
          client = this.clients.nim;
          model = NIM_MODELS.vision_secondary;
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
      return response.choices[0].message.content;
    });
  }

  // ─── Text-to-Speech ──────────────────────────────────────────

  /**
   * Text-to-speech with automatic provider fallback.
   * @param {string} text - Text to convert to speech
   * @param {Object} options - { voice, speed, subscriptionId }
   * @returns {Buffer|null} Audio buffer (MP3) or null if all providers fail
   */
  async textToSpeech(text, options = {}) {
    try {
      return await this.execute('tts', async (providerKey) => {
        switch (providerKey) {
          case 'openai_tts':
            return this._openaiTTS(text, options);
          default:
            throw new Error(`Unknown TTS provider: ${providerKey}`);
        }
      });
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
    return Buffer.from(arrayBuffer);
  }

  // ─── Speech-to-Text (ASR) ────────────────────────────────────

  /**
   * Transcribe audio with automatic provider fallback.
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
          case 'nim_parakeet':
            return this._nimASR(audioBuffer, filename, contentType, options);
          default:
            throw new Error(`Unknown ASR provider: ${providerKey}`);
        }
      });
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

    return await res.json();
  }

  async _nimASR(audioBuffer, filename, contentType, options) {
    // NIM Parakeet uses OpenAI-compatible transcription endpoint
    const formData = new FormData();
    formData.append('file', audioBuffer, { filename, contentType });
    formData.append('model', NIM_MODELS.asr);
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
      const err = new Error(`NIM ASR error: ${res.status} ${errText.substring(0, 200)}`);
      err.status = res.status;
      throw err;
    }

    return await res.json();
  }

  // ─── Health Status ────────────────────────────────────────────

  getHealth() {
    const modalities = {};
    for (const modality of ['llm', 'vision', 'tts', 'asr', 'embedding']) {
      const chain = this.getChain(modality);
      modalities[modality] = {
        active: this.activeProviders[modality] || 'none',
        providers: chain.map(key => ({
          key,
          available: this.isProviderAvailable(key),
          circuitOpen: this.isCircuitOpen(key, modality),
          failures: this.failures[`${key}:${modality}`] || null,
        })),
      };
    }

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      nim_configured: this.nimAvailable,
      stats: this.stats,
      modalities,
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
