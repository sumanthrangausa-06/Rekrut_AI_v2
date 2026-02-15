/**
 * null-guard.js — Preloaded via NODE_OPTIONS=-r ./lib/null-guard.js
 *
 * BUG FIX (Feb 15, 2026): Content analysis always returned 0/10 because some
 * AI providers in the fallback chain return null content when response_format:
 * { type: 'json_object' } is unsupported. Since the parallel race (Promise.any)
 * accepts any fulfillment — including null content — the fast-but-broken provider
 * wins the race before OpenAI responds with valid content.
 *
 * This module patches the AI provider's chatCompletion and execute methods to:
 * 1. Reject null/empty content at the provider level (so race continues)
 * 2. Retry with different options if all providers return null
 *
 * Safe: only activates when content is actually null. No effect on working calls.
 */
'use strict';

const Module = require('module');
const originalLoad = Module._load;
let patched = false;

Module._load = function(request, parent, isMain) {
  const result = originalLoad.apply(this, arguments);

  // Intercept ai-provider module after it's first loaded
  if (!patched && typeof request === 'string' && request.includes('ai-provider') &&
      !request.includes('node_modules') && result && typeof result === 'object') {

    // Patch chatCompletion if it exists
    if (typeof result.chatCompletion === 'function') {
      patched = true;
      const originalChat = result.chatCompletion.bind(result);

      result.chatCompletion = async function patchedChatCompletion(messages, options = {}) {
        let response;
        try {
          response = await originalChat(messages, options);
        } catch (err) {
          // Let errors propagate normally — they're handled by callers
          throw err;
        }

        // If response is valid, return it immediately
        if (response != null && response !== '') {
          return response;
        }

        // Response is null/empty — retry without response_format and with different module
        console.warn('[null-guard] chatCompletion returned null/empty. Retrying without response_format...');
        const retryOpts = { ...options };
        delete retryOpts.response_format;
        // Switch module to use a different provider chain variant
        if (retryOpts.module === 'mock_interview') {
          retryOpts.module = 'coaching';
        } else if (retryOpts.module) {
          retryOpts.module = 'onboarding'; // uses 'efficient' chain — different providers
        }
        retryOpts.feature = (retryOpts.feature || '') + '_retry';

        try {
          const retryResponse = await originalChat(messages, retryOpts);
          if (retryResponse != null && retryResponse !== '') {
            console.log('[null-guard] \u2705 Retry succeeded — got valid content');
            return retryResponse;
          }
        } catch (retryErr) {
          console.error('[null-guard] Retry also failed:', retryErr.message);
        }

        // Second retry: absolute minimum options, no module routing
        console.warn('[null-guard] Second retry with minimal options...');
        try {
          const minimalOpts = {
            system: options.system,
            maxTokens: options.maxTokens || options.max_tokens || 4096,
          };
          const minimalResponse = await originalChat(messages, minimalOpts);
          if (minimalResponse != null && minimalResponse !== '') {
            console.log('[null-guard] \u2705 Minimal retry succeeded');
            return minimalResponse;
          }
        } catch (minErr) {
          console.error('[null-guard] Minimal retry failed:', minErr.message);
        }

        // All retries exhausted — throw so callers can use their fallback logic
        throw new Error('All AI providers returned empty/null content after 3 attempts');
      };

      console.log('[null-guard] \u2705 Patched chatCompletion with null-content retry (3 attempts)');
    }

    // Also patch visionAnalysis if it exists (for consistency)
    if (typeof result.visionAnalysis === 'function') {
      const originalVision = result.visionAnalysis.bind(result);
      result.visionAnalysis = async function patchedVisionAnalysis(images, prompt, options = {}) {
        const response = await originalVision(images, prompt, options);
        if (response == null || response === '') {
          console.warn('[null-guard] visionAnalysis returned null/empty — throwing to trigger fallback');
          throw new Error('Vision analysis returned empty content');
        }
        return response;
      };
    }
  }

  return result;
};

console.log('[null-guard] Module loaded — waiting to patch ai-provider on first require');
