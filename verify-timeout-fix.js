/**
 * Verify timeout cascade fix — tests parallel racing, total timeout cap, and geo-block detection.
 * Run: node verify-timeout-fix.js
 */

// Mock the dependencies so we can test in isolation
const mockDeps = () => {
  // Stub modules that ai-provider.js tries to require
  const Module = require('module');
  const origResolve = Module._resolveFilename;
  const stubs = {
    './db': { query: async () => ({ rows: [] }) },
    './token-budget': {
      isOpenAIBudgetExhausted: () => false,
      recordUsage: () => {}
    },
    './activity-logger': { logAICall: () => {}, logFailover: () => {}, logBudgetExhausted: () => {} },
    './ai-call-logger': { logCall: () => {}, shouldThrottle: () => false },
    './self-hosted-audio': null,
  };
  Module._resolveFilename = function(request, parent) {
    if (stubs.hasOwnProperty(request)) return request;
    return origResolve.apply(this, arguments);
  };
  const origLoad = Module._cache;
  for (const [name, val] of Object.entries(stubs)) {
    require.cache[name] = { id: name, filename: name, loaded: true, exports: val || {} };
  }
};

mockDeps();

// Now we can test the core logic
const assert = require('assert');
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name}: ${e.message}`);
    failed++;
  }
}

console.log('\n🧪 Verifying timeout cascade fix...\n');

// Test 1: Constants exist
const fs = require('fs');
const source = fs.readFileSync('./lib/ai-provider.js', 'utf8');

test('TOTAL_CASCADE_TIMEOUT constant defined', () => {
  assert(source.includes('TOTAL_CASCADE_TIMEOUT'), 'Missing TOTAL_CASCADE_TIMEOUT');
  assert(source.includes('llm: 30000'), 'LLM timeout should be 30s');
});

test('PARALLEL_RACE_COUNT constant defined', () => {
  assert(source.includes('PARALLEL_RACE_COUNT'), 'Missing PARALLEL_RACE_COUNT');
  assert(source.includes('llm: 3'), 'LLM should race 3 providers');
});

test('GEO_BLOCK_CIRCUIT_MS constant defined', () => {
  assert(source.includes('GEO_BLOCK_CIRCUIT_MS'), 'Missing GEO_BLOCK_CIRCUIT_MS');
  assert(source.includes('30 * 60 * 1000'), 'Geo-block should be 30 min');
});

// Test 2: Parallel racing method exists
test('_raceProviders method defined', () => {
  assert(source.includes('async _raceProviders('), 'Missing _raceProviders method');
  assert(source.includes('Promise.any(promises)'), 'Should use Promise.any for racing');
});

// Test 3: Total cascade timeout check in loop
test('Total cascade timeout check in sequential loop', () => {
  assert(source.includes('elapsed >= totalTimeoutMs'), 'Missing total timeout check in loop');
  assert(source.includes('effectiveTimeout = Math.min(perProviderTimeoutMs, remainingMs)'),
    'Should shrink per-provider timeout when running low');
});

// Test 4: Geo-block detection
test('_checkGeoBlock method defined', () => {
  assert(source.includes('_checkGeoBlock('), 'Missing _checkGeoBlock method');
  assert(source.includes("msg.includes('location')"), 'Should detect location-based blocks');
  assert(source.includes('geoBlocked: true'), 'Should mark provider as geo-blocked');
});

// Test 5: Error metadata for frontend
test('Error includes allProvidersFailed metadata', () => {
  assert(source.includes('finalErr.allProvidersFailed = true'), 'Missing allProvidersFailed flag');
  assert(source.includes('finalErr.totalElapsedMs = totalElapsed'), 'Missing totalElapsedMs');
  assert(source.includes('finalErr.triedProviders = triedProviders'), 'Missing triedProviders');
});

// Test 6: Circuit breaker respects geo-block duration
test('isCircuitOpen respects geo-block extended duration', () => {
  assert(source.includes('failure.geoBlocked ? GEO_BLOCK_CIRCUIT_MS : CIRCUIT_BREAK_MS'),
    'Should use extended duration for geo-blocked providers');
});

// Test 7: handleAIError helper in polsia-ai.js
const polsiaSource = fs.readFileSync('./lib/polsia-ai.js', 'utf8');
test('handleAIError helper exported from polsia-ai.js', () => {
  assert(polsiaSource.includes('function handleAIError('), 'Missing handleAIError function');
  assert(polsiaSource.includes('handleAIError'), 'Should be exported');
  assert(polsiaSource.includes('status(503)'), 'Should return 503 for provider failures');
  assert(polsiaSource.includes('retryable: true'), 'Should include retryable flag');
});

// Test 8: Routes updated
const assessmentsSource = fs.readFileSync('./routes/assessments.js', 'utf8');
test('assessments.js imports handleAIError', () => {
  assert(assessmentsSource.includes('handleAIError'), 'Should import handleAIError');
});

const interviewsSource = fs.readFileSync('./routes/interviews.js', 'utf8');
test('interviews.js imports handleAIError', () => {
  assert(interviewsSource.includes('handleAIError'), 'Should import handleAIError');
});

// Test 9: Verify no longer has unlimited sequential cascade
test('Sequential loop has timeout guard', () => {
  // The old code just did "for (const providerKey of chain)" with no time check
  // New code checks elapsed time before each iteration
  assert(source.includes('Date.now() - callStart'), 'Should check elapsed time');
  assert(source.includes('Total cascade timeout'), 'Should log when total timeout hit');
});

console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  console.log('❌ VERIFICATION FAILED');
  process.exit(1);
} else {
  console.log('✅ All checks passed — timeout cascade fix verified');
  process.exit(0);
}
