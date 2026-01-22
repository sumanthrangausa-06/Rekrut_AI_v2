# OpenAI Proxy - Utility AI Only

The OpenAI proxy is for **utility AI tasks** only - NOT for the product's AI features.

## When to Use This

- Embeddings (vector search, similarity)
- Image generation (DALL-E)
- OCR / document extraction
- Image analysis

## When NOT to Use This

If your AI feature is the **core product** (analyzing, recommending, generating content for users), use the **Polsia Agent API** instead. See the Agent SDK skill.

## Setup

```javascript
const OpenAI = require('openai');
const openai = new OpenAI(); // Uses OPENAI_BASE_URL and OPENAI_API_KEY from env
```

## Embeddings

```javascript
const embedding = await openai.embeddings.create({
  model: 'text-embedding-3-small',
  input: 'Text to embed'
});

const vector = embedding.data[0].embedding;
```

## Image Generation

```javascript
const image = await openai.images.generate({
  model: 'dall-e-3',
  prompt: 'A cute cat',
  size: '1024x1024'
});

const imageUrl = image.data[0].url;
```

## OCR / Document Extraction

```javascript
const response = await openai.chat.completions.create({
  model: 'gpt-4',
  task: 'ocr',  // or 'document-extraction'
  messages: [{
    role: 'user',
    content: [{
      type: 'image_url',
      image_url: { url: imageUrl }
    }]
  }]
});

const extractedText = response.choices[0].message.content;
```

## Image Analysis

```javascript
const response = await openai.chat.completions.create({
  model: 'gpt-4-vision-preview',
  messages: [{
    role: 'user',
    content: [
      { type: 'text', text: 'What is in this image?' },
      { type: 'image_url', image_url: { url: imageUrl } }
    ]
  }]
});
```

## DO NOT

```javascript
// WRONG - Don't use for product AI features
const response = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Analyze this startup...' }]
});
```

For product AI features, use the Polsia Agent API (see Agent SDK skill).
