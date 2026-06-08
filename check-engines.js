const aiProvider = require('./lib/ai-provider');

const engines = {
  'Polsia/Anthropic': aiProvider.isProviderAvailable('anthropic'),
  'OpenAI': aiProvider.isProviderAvailable('openai'),
  'NVIDIA NIM': aiProvider.nimAvailable,
  'Groq': aiProvider.groqAvailable,
  'Cerebras': aiProvider.cerebrasAvailable,
  'Deepgram': aiProvider.deepgramAvailable,
  'Self-hosted TTS': aiProvider.selfHostedTTSAvailable,
  'Self-hosted STT': aiProvider.selfHostedSTTAvailable
};

console.log('=== Engine Status ===');
for (const [name, avail] of Object.entries(engines)) {
  console.log(name + ': ' + (avail ? 'AVAILABLE' : 'NOT CONFIGURED'));
}

console.log('\n=== Current Failures/Overloads ===');
if (Object.keys(aiProvider.failures).length === 0) {
  console.log('No active failures or overloads detected.');
} else {
  for (const [key, info] of Object.entries(aiProvider.failures)) {
    console.log(key + ': ' + info.count + ' failures, last: ' + new Date(info.lastFailure).toISOString());
  }
}
