#!/usr/bin/env node
/**
 * Focused NIM verification — test Embedding, Reranking, Safety models
 * with REAL API calls to determine what's actually working vs cosmetic green.
 */

const NIM_API_KEY = process.env.NVIDIA_NIM_API_KEY;
const NIM_BASE = process.env.NIM_BASE_URL || 'https://integrate.api.nvidia.com/v1';

if (!NIM_API_KEY) {
  console.error('ERROR: NVIDIA_NIM_API_KEY not set');
  process.exit(1);
}

const results = [];

async function fetchWithTimeout(url, opts, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  opts.signal = controller.signal;
  try {
    const res = await fetch(url, opts);
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

async function testEmbedding(key, model, useInputType) {
  const start = Date.now();
  try {
    const body = {
      model,
      input: 'Software engineer with 5 years experience in React and Node.js',
    };
    if (useInputType) {
      body.input_type = 'query';
    }

    const res = await fetchWithTimeout(`${NIM_BASE}/embeddings`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NIM_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const ms = Date.now() - start;
    if (!res.ok) {
      const errText = await res.text();
      results.push({ modality: 'Embedding', key, model, status: `DEAD (${res.status})`, ms, note: errText.substring(0, 200), inputType: useInputType });
      return;
    }

    const data = await res.json();
    const dim = data.data?.[0]?.embedding?.length || 0;
    results.push({ modality: 'Embedding', key, model, status: 'WORKING', ms, note: `${dim} dimensions`, inputType: useInputType });
  } catch (err) {
    const ms = Date.now() - start;
    results.push({ modality: 'Embedding', key, model, status: `DEAD (${err.name})`, ms, note: err.message?.substring(0, 200), inputType: useInputType });
  }
}

async function testReranking(key, model) {
  const start = Date.now();
  try {
    const res = await fetchWithTimeout(`${NIM_BASE}/ranking`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NIM_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        query: { text: 'software engineer with React experience' },
        passages: [
          { text: 'Looking for a senior React developer with 5 years experience' },
          { text: 'Hiring a sales representative for our team' },
          { text: 'Frontend developer needed, must know JavaScript and React' },
        ],
        top_n: 3,
      }),
    });

    const ms = Date.now() - start;
    if (!res.ok) {
      const errText = await res.text();
      results.push({ modality: 'Reranking', key, model, status: `DEAD (${res.status})`, ms, note: errText.substring(0, 200) });
      return;
    }

    const data = await res.json();
    const rankings = data.rankings || [];
    results.push({ modality: 'Reranking', key, model, status: 'WORKING', ms, note: `${rankings.length} results ranked` });
  } catch (err) {
    const ms = Date.now() - start;
    results.push({ modality: 'Reranking', key, model, status: `DEAD (${err.name})`, ms, note: err.message?.substring(0, 200) });
  }
}

async function testSafety(key, model) {
  const start = Date.now();
  try {
    const res = await fetchWithTimeout(`${NIM_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NIM_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You are a content safety classifier. Respond with JSON: {"safe": true/false}' },
          { role: 'user', content: 'Hello, how are you today?' },
        ],
        max_tokens: 100,
        temperature: 0.1,
      }),
    });

    const ms = Date.now() - start;
    if (!res.ok) {
      const errText = await res.text();
      results.push({ modality: 'Safety', key, model, status: `DEAD (${res.status})`, ms, note: errText.substring(0, 200) });
      return;
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';
    results.push({ modality: 'Safety', key, model, status: 'WORKING', ms, note: text.substring(0, 100) });
  } catch (err) {
    const ms = Date.now() - start;
    results.push({ modality: 'Safety', key, model, status: `DEAD (${err.name})`, ms, note: err.message?.substring(0, 200) });
  }
}

async function main() {
  console.log('=== NIM Model Verification (Embedding/Reranking/Safety) ===');
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`NIM Base: ${NIM_BASE}\n`);

  // Test Embedding models — with and without input_type
  console.log('--- Embedding Models ---');
  await testEmbedding('embed_qa (no input_type)', 'nvidia/llama-3.2-nv-embedqa-1b-v2', false);
  await testEmbedding('embed_qa (with input_type)', 'nvidia/llama-3.2-nv-embedqa-1b-v2', true);
  await testEmbedding('embed_vl (no input_type)', 'nvidia/llama-nemotron-embed-vl-1b-v2', false);
  await testEmbedding('embed_vl (with input_type)', 'nvidia/llama-nemotron-embed-vl-1b-v2', true);

  // Test Reranking models
  console.log('\n--- Reranking Models ---');
  await testReranking('rerank_qa', 'nvidia/llama-3.2-nv-rerankqa-1b-v2');
  await testReranking('rerank_vl', 'nvidia/llama-nemotron-rerank-vl-1b-v2');

  // Test Safety models
  console.log('\n--- Safety Models ---');
  await testSafety('safety_guard', 'nvidia/llama-3.1-nemotron-safety-guard-8b-v3');
  await testSafety('safety_reasoning', 'nvidia/nemotron-content-safety-reasoning-4b');

  // Print results table
  console.log('\n=== RESULTS ===');
  for (const r of results) {
    const statusIcon = r.status === 'WORKING' ? '✅' : '❌';
    console.log(`${statusIcon} ${r.modality.padEnd(12)} | ${r.key.padEnd(35)} | ${r.status.padEnd(15)} | ${r.ms}ms | ${r.note || ''}`);
  }

  // Summary
  const working = results.filter(r => r.status === 'WORKING');
  const dead = results.filter(r => r.status !== 'WORKING');
  console.log(`\nWorking: ${working.length}/${results.length}  |  Dead: ${dead.length}/${results.length}`);

  if (dead.length > 0) {
    console.log('\nDEAD MODELS (need removal or replacement):');
    for (const r of dead) {
      console.log(`  - ${r.modality}: ${r.key} — ${r.status} — ${r.note}`);
    }
  }

  console.log('\n=== JSON ===');
  console.log(JSON.stringify(results, null, 2));
}

main().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
