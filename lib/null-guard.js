/**
 * null-guard.js — Preloaded via NODE_OPTIONS=-r /opt/render/project/src/lib/null-guard.js
 * Patches chatCompletion to detect null/empty results and retry with alternative options.
 *
 * ROOT CAUSE: Some AI providers (NIM models) return null content when
 * response_format: { type: 'json_object' } is passed. The fastest provider to
 * respond wins the Promise.any parallel race, even with null content, causing
 * analyzeInterviewResponse() and generateInterviewCoaching() to fail with
 * "Content analysis failed".
 *
 * FIX: Wraps chatCompletion() to detect null/empty results and retry up to 3 times
 * with progressively simpler options.
 *
 * Deployed: Feb 15, 2026 — Task #32627
 */
'use strict';

const Module = require('module');
const originalLoad = Module._load;
let patched = false;

Module._load = function (request, parent, isMain) {
  const result = originalLoad.apply(this, arguments);

  if (
    !patched &&
    typeof request === 'string' &&
    request.includes('ai-provider') &&
    !request.includes('node_modules') &&
    result &&
    typeof result === 'object'
  ) {
    // Check for chatCompletion on the object itself
    const target = result;
    if (typeof target.chatCompletion === 'function') {
      patched = true;
      const originalChat = target.chatCompletion.bind(target);

      target.chatCompletion = async function patchedChatCompletion(
        messages,
        options = {}
      ) {
        let response;
        try {
          response = await originalChat(messages, options);
        } catch (err) {
          throw err;
        }

        // If we got a valid non-null, non-empty response, return it
        if (response != null && response !== '') {
          return response;
        }

        // === RETRY 1: Remove response_format, use different module chain ===
        console.warn(
          '[null-guard] chatCompletion returned null/empty. Retrying (attempt 1/2)...'
        );
        const retryOpts = { ...options };
        delete retryOpts.response_format;
        if (retryOpts.module === 'mock_interview') {
          retryOpts.module = 'coaching';
        } else if (retryOpts.module) {
          retryOpts.module = 'onboarding';
        }
        retryOpts.feature = (retryOpts.feature || '') + '_retry';

        try {
          const retryResponse = await originalChat(messages, retryOpts);
          if (retryResponse != null && retryResponse !== '') {
            console.log('[null-guard] ✅ Retry 1 succeeded');
            return retryResponse;
          }
        } catch (retryErr) {
          console.error('[null-guard] Retry 1 failed:', retryErr.message);
        }

        // === RETRY 2: Minimal options, no module routing ===
        console.warn(
          '[null-guard] Retrying (attempt 2/2) with minimal options...'
        );
        try {
          const minimalResponse = await originalChat(messages, {
            system: options.system,
            maxTokens: options.maxTokens || 4096,
          });
          if (minimalResponse != null && minimalResponse !== '') {
            console.log('[null-guard] ✅ Retry 2 succeeded');
            return minimalResponse;
          }
        } catch (minErr) {
          console.error('[null-guard] Retry 2 failed:', minErr.message);
        }

        throw new Error(
          'All AI providers returned empty/null content after 3 attempts'
        );
      };

      console.log(
        '[null-guard] ✅ Patched chatCompletion with null-content retry (3 attempts)'
      );
    }
  }

  return result;
};

console.log('[null-guard] Module loaded, waiting for ai-provider import...');
