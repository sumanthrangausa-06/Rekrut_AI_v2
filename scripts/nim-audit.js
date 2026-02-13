#!/usr/bin/env node
/**
 * NIM Model Audit Script — Tests ALL registered NIM models
 * Tests each model with a real API call and logs status, response time, errors
 */

const OpenAI = require('openai');
const fetch = require('node-fetch');
const FormData = require('form-data');

const NIM_API_KEY = process.env.NVIDIA_NIM_API_KEY;
const NIM_BASE = process.env.NIM_BASE_URL || 'https://integrate.api.nvidia.com/v1';

if (!NIM_API_KEY) {
  console.error('ERROR: NVIDIA_NIM_API_KEY not set');
  process.exit(1);
}

const nimClient = new OpenAI({ baseURL: NIM_BASE, apiKey: NIM_API_KEY });

// All LLM models to test
const LLM_MODELS = [
  { key: 'nemotron_super', model: 'nvidia/llama-3.3-nemotron-super-49b-v1', integrated: true },
  { key: 'nemotron_super_v1.5', model: 'nvidia/llama-3.3-nemotron-super-49b-v1.5', integrated: false },
  { key: 'deepseek_v3', model: 'deepseek-ai/deepseek-v3p2', integrated: true },
  { key: 'kimi_k2.5', model: 'moonshot-ai/kimi-k2.5', integrated: true },
  { key: 'step_flash', model: 'stepfun-ai/step-3.5-flash', integrated: true },
  { key: 'gpt_oss_120b', model: 'openai/gpt-oss-120b', integrated: true },
  { key: 'gpt_oss_20b', model: 'openai/gpt-oss-20b', integrated: false },
  { key: 'nano_9b', model: 'nvidia/nemotron-nano-8b-v2', integrated: true },
  { key: 'deepseek_v3_1', model: 'deepseek-ai/deepseek-v3p1', integrated: true },
  { key: 'mistral_small', model: 'mistralai/mistral-small-24b-instruct-2501', integrated: true },
  { key: 'qwen_72b', model: 'qwen/qwen2.5-72b-instruct', integrated: true },
  { key: 'deepseek_r1', model: 'deepseek-ai/deepseek-r1', integrated: true },
  { key: 'qwq_32b', model: 'qwen/qwq-32b', integrated: true },
  { key: 'llama_3.3_70b', model: 'meta/llama-3.3-70b-instruct', integrated: false },
  { key: 'llama_3.1_8b', model: 'meta/llama-3.1-8b-instruct', integrated: false },
  { key: 'llama_3.1_70b', model: 'meta/llama-3.1-70b-instruct', integrated: false },
  { key: 'llama_3.1_405b', model: 'meta/llama-3.1-405b-instruct', integrated: false },
  { key: 'gemma_3_27b', model: 'google/gemma-3-27b-it', integrated: true },
  { key: 'phi_4_mini', model: 'microsoft/phi-4-mini-instruct', integrated: false },
  { key: 'granite_3.3_8b', model: 'ibm/granite-3.3-8b-instruct', integrated: false },
  { key: 'nemotron_nano_30b', model: 'nvidia/nemotron-3-nano-30b-a3b', integrated: false },
  { key: 'minimax_m2', model: 'minimax/minimax-m2', integrated: false },
  { key: 'glm_4.7', model: 'zhipu-ai/glm-4.7', integrated: false },
  { key: 'nemotron_ultra_253b', model: 'nvidia/llama-3.1-nemotron-ultra-253b-v1', integrated: false },
  { key: 'kimi_k2_instruct', model: 'moonshot-ai/kimi-k2-instruct', integrated: false },
  { key: 'seed_oss_36b', model: 'bytedance/seed-oss-36b-instruct', integrated: false },
  { key: 'devstral_123b', model: 'mistralai/devstral-2-123b', integrated: false },
];

// Vision models to test
const VISION_MODELS = [
  { key: 'cosmos_reason2', model: 'nvidia/cosmos-reason2-8b', integrated: true },
  { key: 'nemotron_vl', model: 'nvidia/nemotron-nano-12b-v2-vl', integrated: true },
  { key: 'kimi_vision', model: 'moonshot-ai/kimi-k2.5', integrated: true },
  { key: 'gemma_vision', model: 'google/gemma-3-27b-it', integrated: true },
];

// Embedding models
const EMBED_MODELS = [
  { key: 'embed_qa', model: 'nvidia/llama-3.2-nv-embedqa-1b-v2', integrated: true },
  { key: 'embed_vl', model: 'nvidia/llama-nemotron-embed-vl-1b-v2', integrated: true },
];

// Reranking models — use REST /v1/ranking
const RERANK_MODELS = [
  { key: 'rerank_qa', model: 'nvidia/llama-3.2-nv-rerankqa-1b-v2', integrated: true },
  { key: 'rerank_vl', model: 'nvidia/llama-nemotron-rerank-vl-1b-v2', integrated: true },
];

// Safety models
const SAFETY_MODELS = [
  { key: 'safety_guard', model: 'nvidia/llama-3.1-nemotron-safety-guard-8b-v3', integrated: true },
  { key: 'safety_reasoning', model: 'nvidia/nemotron-content-safety-reasoning-4b', integrated: true },
];

const results = [];

async function testLLM(entry) {
  const start = Date.now();
  try {
    const response = await Promise.race([
      nimClient.chat.completions.create({
        model: entry.model,
        messages: [{ role: 'user', content: 'Say hello in one word.' }],
        max_tokens: 20,
        temperature: 0.1,
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT_12s')), 12000)),
    ]);
    const ms = Date.now() - start;
    const text = response.choices?.[0]?.message?.content || '';
    results.push({
      modality: 'LLM', key: entry.key, model: entry.model,
      status: '✅ Working', responseMs: ms, integrated: entry.integrated,
      note: text.substring(0, 50),
    });
  } catch (err) {
    const ms = Date.now() - start;
    const status = err.status || err.statusCode || 0;
    const msg = err.message || String(err);
    let verdict = '❌ Dead';
    if (msg.includes('TIMEOUT')) verdict = '⚠️ Slow (timeout)';
    else if (status === 404) verdict = '❌ 404 Not Found';
    else if (status === 429) verdict = '⚠️ Rate Limited';
    else if (status === 401 || status === 403) verdict = '❌ Auth Error';
    results.push({
      modality: 'LLM', key: entry.key, model: entry.model,
      status: verdict, responseMs: ms, integrated: entry.integrated,
      note: `[${status}] ${msg.substring(0, 100)}`,
    });
  }
}

async function testEmbedding(entry) {
  const start = Date.now();
  try {
    const response = await Promise.race([
      nimClient.embeddings.create({
        model: entry.model,
        input: 'Hello world test embedding',
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT_12s')), 12000)),
    ]);
    const ms = Date.now() - start;
    const dim = response.data?.[0]?.embedding?.length || 0;
    results.push({
      modality: 'Embedding', key: entry.key, model: entry.model,
      status: '✅ Working', responseMs: ms, integrated: entry.integrated,
      note: `${dim} dimensions`,
    });
  } catch (err) {
    const ms = Date.now() - start;
    const status = err.status || err.statusCode || 0;
    results.push({
      modality: 'Embedding', key: entry.key, model: entry.model,
      status: status === 404 ? '❌ 404 Not Found' : '❌ Dead',
      responseMs: ms, integrated: entry.integrated,
      note: `[${status}] ${(err.message || '').substring(0, 100)}`,
    });
  }
}

async function testReranking(entry) {
  const start = Date.now();
  try {
    const res = await Promise.race([
      fetch(`${NIM_BASE}/ranking`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${NIM_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: entry.model,
          query: { text: 'software engineer' },
          passages: [{ text: 'Looking for a developer' }, { text: 'Hiring sales rep' }],
          top_n: 2,
        }),
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT_12s')), 12000)),
    ]);
    const ms = Date.now() - start;
    if (!res.ok) {
      const errText = await res.text();
      results.push({
        modality: 'Reranking', key: entry.key, model: entry.model,
        status: res.status === 404 ? '❌ 404 Not Found' : `❌ ${res.status}`,
        responseMs: ms, integrated: entry.integrated,
        note: errText.substring(0, 100),
      });
      return;
    }
    const data = await res.json();
    results.push({
      modality: 'Reranking', key: entry.key, model: entry.model,
      status: '✅ Working', responseMs: ms, integrated: entry.integrated,
      note: `${data.rankings?.length || 0} results`,
    });
  } catch (err) {
    const ms = Date.now() - start;
    results.push({
      modality: 'Reranking', key: entry.key, model: entry.model,
      status: '❌ Dead', responseMs: ms, integrated: entry.integrated,
      note: (err.message || '').substring(0, 100),
    });
  }
}

async function testSafety(entry) {
  const start = Date.now();
  try {
    const response = await Promise.race([
      nimClient.chat.completions.create({
        model: entry.model,
        messages: [
          { role: 'system', content: 'You are a content safety classifier. Respond with JSON: {"safe": true}' },
          { role: 'user', content: 'Hello, how are you?' }
        ],
        max_tokens: 100,
        temperature: 0.1,
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT_12s')), 12000)),
    ]);
    const ms = Date.now() - start;
    results.push({
      modality: 'Safety', key: entry.key, model: entry.model,
      status: '✅ Working', responseMs: ms, integrated: entry.integrated,
      note: (response.choices?.[0]?.message?.content || '').substring(0, 50),
    });
  } catch (err) {
    const ms = Date.now() - start;
    const status = err.status || err.statusCode || 0;
    results.push({
      modality: 'Safety', key: entry.key, model: entry.model,
      status: status === 404 ? '❌ 404 Not Found' : '❌ Dead',
      responseMs: ms, integrated: entry.integrated,
      note: `[${status}] ${(err.message || '').substring(0, 100)}`,
    });
  }
}

async function main() {
  console.log('=== NIM Model Audit ===');
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`NIM Base: ${NIM_BASE}`);
  console.log(`Testing ${LLM_MODELS.length} LLM + ${VISION_MODELS.length} Vision + ${EMBED_MODELS.length} Embedding + ${RERANK_MODELS.length} Reranking + ${SAFETY_MODELS.length} Safety models\n`);

  // Test LLM models (batch of 4 at a time to avoid rate limits)
  console.log('--- Testing LLM models ---');
  for (let i = 0; i < LLM_MODELS.length; i += 4) {
    const batch = LLM_MODELS.slice(i, i + 4);
    await Promise.all(batch.map(m => testLLM(m)));
    // Print progress
    for (const r of results.slice(-batch.length)) {
      console.log(`  ${r.status} ${r.key} (${r.responseMs}ms) ${r.integrated ? '[INTEGRATED]' : '[NEW]'}`);
    }
  }

  // Test Vision models (use same chat completions, just mention image)
  console.log('\n--- Testing Vision models (text-only probe) ---');
  for (const m of VISION_MODELS) {
    await testLLM({ ...m, modality: 'Vision' });
    const r = results[results.length - 1];
    r.modality = 'Vision';
    console.log(`  ${r.status} ${r.key} (${r.responseMs}ms)`);
  }

  // Test Embedding models
  console.log('\n--- Testing Embedding models ---');
  await Promise.all(EMBED_MODELS.map(m => testEmbedding(m)));
  for (const r of results.slice(-EMBED_MODELS.length)) {
    console.log(`  ${r.status} ${r.key} (${r.responseMs}ms) - ${r.note}`);
  }

  // Test Reranking models
  console.log('\n--- Testing Reranking models ---');
  await Promise.all(RERANK_MODELS.map(m => testReranking(m)));
  for (const r of results.slice(-RERANK_MODELS.length)) {
    console.log(`  ${r.status} ${r.key} (${r.responseMs}ms) - ${r.note}`);
  }

  // Test Safety models
  console.log('\n--- Testing Safety models ---');
  await Promise.all(SAFETY_MODELS.map(m => testSafety(m)));
  for (const r of results.slice(-SAFETY_MODELS.length)) {
    console.log(`  ${r.status} ${r.key} (${r.responseMs}ms)`);
  }

  // Summary
  console.log('\n\n=== AUDIT SUMMARY ===');
  console.log('MODALITY | KEY | MODEL | STATUS | RESPONSE MS | INTEGRATED | NOTES');
  console.log('-'.repeat(120));
  for (const r of results) {
    console.log(`${r.modality.padEnd(10)} | ${r.key.padEnd(25)} | ${r.model.padEnd(50)} | ${r.status.padEnd(20)} | ${String(r.responseMs).padEnd(8)}ms | ${r.integrated ? 'Yes' : 'No '} | ${r.note || ''}`);
  }

  // Counts
  const working = results.filter(r => r.status.includes('Working'));
  const dead = results.filter(r => r.status.includes('Dead') || r.status.includes('404') || r.status.includes('Auth'));
  const slow = results.filter(r => r.status.includes('Slow') || r.status.includes('Rate'));
  console.log(`\n✅ Working: ${working.length}  ❌ Dead: ${dead.length}  ⚠️ Slow/Limited: ${slow.length}`);

  // Output JSON for parsing
  console.log('\n=== JSON_RESULTS_START ===');
  console.log(JSON.stringify(results, null, 2));
  console.log('=== JSON_RESULTS_END ===');
}

main().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
