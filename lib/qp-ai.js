const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const fetch = require('node-fetch');
const FormData = require('form-data');

// ISOLATED Quick Practice AI Provider — decoupled from Mock Interview (#32717)
// Changes to polsia-ai.js or ai-provider.js will NOT affect Quick Practice.
const aiProvider = require('./qp-provider');

const anthropic = new Anthropic({
  baseURL: process.env.POLSIA_API_URL || 'https://polsia.com/api/proxy/ai',
  apiKey: process.env.POLSIA_API_KEY,
});

// OpenAI client for vision tasks (Polsia AI proxy supports multimodal via OpenAI format)
const openai = new OpenAI(); // Uses OPENAI_BASE_URL and OPENAI_API_KEY from env

// Robust JSON parser — handles malformed LLM output (markdown fences, trailing commas, unescaped chars)
function safeParseJSON(text) {
  if (!text || typeof text !== 'string') return null;

  // Step 1: Strip markdown code fences
  let cleaned = text.replace(/```(?:json)?\s*/gi, '').replace(/```\s*/g, '');

  // Step 2: Extract the outermost JSON object or array
  const match = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (!match) return null;
  cleaned = match[0];

  // Step 3: Try direct parse first
  try { return JSON.parse(cleaned); } catch (e) { /* continue to repair */ }

  // Step 4: Remove trailing commas before } or ]
  let repaired = cleaned.replace(/,\s*([}\]])/g, '$1');

  // Step 5: Strip control characters (except \n \r \t) within strings
  repaired = repaired.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

  try { return JSON.parse(repaired); } catch (e) { /* continue */ }

  // Step 6: Fix unescaped newlines inside JSON strings (replace literal newlines with \n)
  repaired = repaired.replace(/"([^"]*?)"/g, (match, content) => {
    return '"' + content.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '"';
  });

  try { return JSON.parse(repaired); } catch (e) { /* continue */ }

  // Step 7: Last resort — try to fix common quote escaping issues
  // Replace curly/smart quotes with straight quotes
  repaired = repaired.replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"');
  repaired = repaired.replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'");

  try { return JSON.parse(repaired); } catch (e) {
    console.warn('[safeParseJSON] All repair attempts failed:', e.message);
    return null;
  }
}

// Upload a base64 image frame to R2 and return the CDN URL
// The Polsia OpenAI proxy only supports HTTP URLs for vision, NOT base64 data URIs
async function uploadFrameToR2(base64Data, index) {
  try {
    // Strip data URI prefix if present
    const raw = base64Data.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(raw, 'base64');

    const formData = new FormData();
    formData.append('file', buffer, {
      filename: `video-frame-${Date.now()}-${index}.jpg`,
      contentType: 'image/jpeg'
    });

    const res = await fetch('https://polsia.com/api/proxy/r2/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.POLSIA_API_KEY}`,
        ...formData.getHeaders()
      },
      body: formData
    });

    const result = await res.json();
    if (!result.success) {
      console.error(`R2 frame upload failed (frame ${index}):`, result.error);
      return null;
    }
    return result.file.url;
  } catch (err) {
    console.error(`R2 frame upload error (frame ${index}):`, err.message);
    return null;
  }
}

// ─── CORE CHAT: Now with automatic multi-provider fallback ─────
// Fallback chain: Anthropic → OpenAI → NIM Nemotron → NIM Kimi → NIM DeepSeek
async function chat(message, options = {}) {
  // Handle both string messages and arrays of message objects
  let messages;
  if (Array.isArray(message)) {
    // Filter out system messages and extract them
    const systemMessages = message.filter(m => m.role === 'system');
    const nonSystemMessages = message.filter(m => m.role !== 'system');

    // Use the first system message content as the system prompt if not already set
    if (systemMessages.length > 0 && !options.system) {
      options.system = systemMessages[0].content;
    }

    // Ensure messages have proper format (content must be string or array)
    messages = nonSystemMessages.map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : String(m.content)
    }));
  } else {
    // Simple string message
    messages = [{ role: 'user', content: String(message) }];
  }

  // Ensure we have at least one message
  if (messages.length === 0) {
    messages = [{ role: 'user', content: 'Hello' }];
  }

  // Use the provider service with automatic fallback
  return aiProvider.chatCompletion(messages, options);
}
// [REMOVED] generateInterviewQuestions — not used by Quick Practice (lives in polsia-ai.js)


async function analyzeInterviewResponse(question, response, keyPoints, options = {}) {
  const prompt = `Analyze this interview response:

Question: ${question}

Candidate's Response:
${response}

Key points to evaluate:
${keyPoints.map((p, i) => `${i + 1}. ${p}`).join('\n')}

Provide a JSON object with:
- score: 1-10 rating
- strengths: Array of 2-3 strengths
- improvements: Array of 2-3 areas for improvement
- covered_points: Array of which key points were addressed
- missed_points: Array of key points that were missed
- detailed_feedback: A 2-3 sentence constructive feedback paragraph

Only return the JSON object, no other text.`;

  const result = await chat(prompt, {
    system: 'You are an expert interview coach providing constructive, actionable feedback. Be encouraging but honest. Always return valid JSON.',
    subscriptionId: options.subscriptionId,
    module: 'mock_interview', feature: 'response_analysis',
    response_format: { type: 'json_object' },
  });

  // Use safeParseJSON (7 repair strategies) instead of raw JSON.parse — handles markdown
  // fences, trailing commas, control chars, smart quotes that LLMs sometimes emit
  const parsed = safeParseJSON(result);
  if (parsed && typeof parsed === 'object' && parsed.score !== undefined) {
    return parsed;
  }

  // Log the raw response for debugging when parsing fails
  console.error('[analysis] Content analysis parse failed. Raw LLM response:', typeof result, result ? String(result).substring(0, 500) : '(empty/null)');
  throw new Error('Failed to parse analysis');
}
// [REMOVED] generateOverallFeedback — not used by Quick Practice (lives in polsia-ai.js)

// [REMOVED] parseResume — not used by Quick Practice (lives in polsia-ai.js)

// [REMOVED] generateSkillAssessment — not used by Quick Practice (lives in polsia-ai.js)

// [REMOVED] evaluateSkillAssessment — not used by Quick Practice (lives in polsia-ai.js)

// [REMOVED] generateJobMatchScore — not used by Quick Practice (lives in polsia-ai.js)


async function generateInterviewCoaching(question, response, feedback, options = {}) {
  const prompt = `Provide personalized coaching for this interview response:

QUESTION: ${question}

CANDIDATE'S RESPONSE: ${response}

INITIAL FEEDBACK: ${JSON.stringify(feedback)}

Provide detailed coaching:

Return a JSON object:
{
  "improved_response": "A better version of their response using the STAR method if applicable",
  "specific_tips": [
    "Specific tip 1 for this response",
    "Specific tip 2"
  ],
  "body_language_tips": ["Tip about delivery"],
  "common_mistake": "What mistake they made and how to avoid it",
  "practice_prompt": "A follow-up question they should practice"
}

Only return the JSON object.`;

  const result = await chat(prompt, {
    system: 'You are an expert interview coach. Be supportive, specific, and actionable. Always return valid JSON.',
    subscriptionId: options.subscriptionId,
    module: 'mock_interview', feature: 'coaching',
    response_format: { type: 'json_object' },
  });

  // Use safeParseJSON (7 repair strategies) instead of raw JSON.parse
  const parsed = safeParseJSON(result);
  if (parsed && typeof parsed === 'object') {
    return parsed;
  }

  // Log the raw response for debugging when parsing fails
  console.error('[coaching] Coaching parse failed. Raw LLM response:', typeof result, result ? String(result).substring(0, 500) : '(empty/null)');
  throw new Error('Failed to generate coaching');
}

// Normalize vision analysis result — different AI models use different field names
// Maps common variations to the expected field names
function normalizeVisionResult(parsed) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  const result = { ...parsed };

  // Normalize field name variations
  const fieldMappings = {
    eye_contact: ['eye_contact', 'eyeContact', 'eye_contact_score', 'gaze'],
    facial_expressions: ['facial_expressions', 'facialExpressions', 'expressions', 'facial_expression'],
    body_language: ['body_language', 'bodyLanguage', 'body_language_score', 'posture'],
    professional_appearance: ['professional_appearance', 'professionalAppearance', 'appearance', 'camera_setup'],
    overall_presentation: ['overall_presentation', 'overallPresentation', 'overall_score', 'overall'],
  };

  for (const [target, alternatives] of Object.entries(fieldMappings)) {
    if (!result[target]) {
      for (const alt of alternatives) {
        if (result[alt] !== undefined) {
          result[target] = result[alt];
          break;
        }
      }
    }
    // Normalize score-only values into {score, feedback} objects
    if (target !== 'overall_presentation' && result[target] !== undefined) {
      if (typeof result[target] === 'number') {
        result[target] = { score: result[target], feedback: '' };
      } else if (typeof result[target] === 'object' && result[target] !== null) {
        // Ensure score is a number
        if (result[target].score === undefined && result[target].rating !== undefined) {
          result[target].score = result[target].rating;
        }
        if (typeof result[target].score !== 'number') {
          result[target].score = parseInt(result[target].score) || 5;
        }
        result[target].feedback = result[target].feedback || result[target].assessment || result[target].comment || '';
      }
    }
  }

  // Normalize overall_presentation to a number
  if (typeof result.overall_presentation === 'object' && result.overall_presentation !== null) {
    result.overall_presentation = result.overall_presentation.score || result.overall_presentation.rating || 5;
  }
  if (typeof result.overall_presentation !== 'number') {
    result.overall_presentation = parseInt(result.overall_presentation) || 5;
  }

  // Ensure timestamped_notes is an array
  if (!Array.isArray(result.timestamped_notes)) {
    result.timestamped_notes = result.timestamped_notes ? [result.timestamped_notes] : [];
  }

  return result;
}

// ─── VISION ANALYSIS: Real video frame analysis with text fallback ─────
// Primary: Upload frames to R2 → GPT-4o vision via Polsia proxy → NIM vision fallbacks
// Fallback: Text-based LLM coaching from speech metrics (if ALL vision providers fail)
async function analyzeVideoPresentation(frames, options = {}) {
  const defaultResult = {
    eye_contact: { score: 5, feedback: 'No video frames available for analysis' },
    facial_expressions: { score: 5, feedback: 'No video frames available for analysis' },
    body_language: { score: 5, feedback: 'No video frames available for analysis' },
    professional_appearance: { score: 5, feedback: 'No video frames available for analysis' },
    overall_presentation: 5,
    summary: 'Video analysis not available — submit with video for detailed presentation feedback.',
    timestamped_notes: []
  };

  if (!frames || frames.length === 0) return defaultResult;

  const transcription = options.transcription || '';
  const durationSeconds = options.durationSeconds || 60;
  const question = options.question || 'a practice interview question';
  const frameCount = frames.length;

  // ── Step 1: Try REAL vision analysis using actual video frames ──────
  try {
    // Select key frames (max 4 to control token costs — 320×240 JPEG each)
    const keyFrames = frames.length > 4 ? selectKeyFrames(frames, 4) : frames;

    // Upload frames to R2 in parallel (vision APIs need HTTP URLs, not base64)
    console.log(`[video-analysis] Uploading ${keyFrames.length} frames to R2 for vision analysis...`);
    const uploadResults = await Promise.all(
      keyFrames.map((frame, i) => uploadFrameToR2(frame, i))
    );
    const imageUrls = uploadResults.filter(url => url !== null);

    if (imageUrls.length > 0) {
      console.log(`[video-analysis] ${imageUrls.length}/${keyFrames.length} frames uploaded to R2. Calling vision API...`);

      const visionPrompt = `You are an expert interview presentation coach. Analyze these ${imageUrls.length} video frames captured during an interview practice recording.

**Interview Question:** "${question}"
**Response Duration:** ${durationSeconds} seconds
**Transcription excerpt:** "${transcription.substring(0, 500)}"

Look at the ACTUAL video frames and analyze:
1. **Eye Contact** — Is the candidate looking at the camera? Looking away? Consistent or sporadic?
2. **Facial Expressions** — Are they engaged, confident, nervous? Smiling appropriately? Tense jaw/brow?
3. **Body Language** — Posture (leaning in/slouching), hand gestures (natural/fidgeting/stiff), shoulder position
4. **Professional Appearance** — Camera framing, lighting, background, clothing visibility, camera angle

Be SPECIFIC about what you SEE in the frames. Reference actual visual details — don't guess from speech patterns.

Return a JSON object with this EXACT structure:
{
  "eye_contact": { "score": 1-10, "feedback": "specific feedback based on what you SEE in the frames" },
  "facial_expressions": { "score": 1-10, "feedback": "specific feedback about visible facial expressions" },
  "body_language": { "score": 1-10, "feedback": "specific feedback about visible posture, gestures" },
  "professional_appearance": { "score": 1-10, "feedback": "feedback about camera setup, lighting, background you can SEE" },
  "overall_presentation": 1-10,
  "summary": "2-3 sentence overall visual presentation assessment referencing what you observed",
  "timestamped_notes": [
    { "frame": 1, "note": "what you observe in the opening frame" },
    { "frame": ${Math.max(1, Math.ceil(imageUrls.length / 2))}, "note": "what you observe in the middle frame" },
    { "frame": ${imageUrls.length}, "note": "what you observe in the closing frame" }
  ]
}

Only return the JSON object, no other text.`;

      // 15s timeout for vision — leaves room for text fallback within the 25s overall budget
      const visionResult = await Promise.race([
        aiProvider.visionAnalysis(imageUrls, visionPrompt, {
          system: 'You are an expert interview coach specializing in body language, eye contact, and video interview presentation. Analyze the ACTUAL video frames provided. Be specific about what you see. Always return valid JSON.',
          maxTokens: 1024,
          response_format: { type: 'json_object' },
          module: 'quick_practice',
          feature: 'video_presentation',
          task: 'image-analysis',
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Vision analysis 15s timeout')), 15000))
      ]);

      const rawVision = typeof visionResult === 'string' ? visionResult : String(visionResult);
      const parsed = safeParseJSON(rawVision);
      if (parsed && typeof parsed === 'object') {
        // Normalize common field name variations from different vision models
        const normalized = normalizeVisionResult(parsed);
        if (normalized.eye_contact && normalized.body_language) {
          console.log('[video-analysis] ✅ REAL vision analysis successful — actual video frames analyzed!');
          return normalized;
        }
        console.warn('[video-analysis] Vision result missing expected fields after normalization. Keys:', Object.keys(parsed).join(', '));
      } else {
        console.warn('[video-analysis] Vision result could not be parsed. Raw (first 300 chars):', rawVision.substring(0, 300));
      }
      console.warn('[video-analysis] Falling back to text-based analysis');
    } else {
      console.warn('[video-analysis] All R2 uploads failed, falling back to text-based analysis');
    }
  } catch (visionErr) {
    console.warn(`[video-analysis] Vision analysis failed (${visionErr.message}), falling back to text-based coaching`);
  }

  // ── Step 2: Fallback — text-based LLM coaching from speech metrics ──────
  // (Working fallback from #32567 — gives personalized coaching when vision is unavailable)
  const words = transcription.trim().split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;
  const wpm = durationSeconds > 0 ? Math.round((wordCount / durationSeconds) * 60) : 0;

  const fillerList = ['um', 'uh', 'like', 'you know', 'so', 'basically', 'actually', 'literally', 'right', 'i mean'];
  const lowerText = transcription.toLowerCase();
  let totalFillers = 0;
  const fillerDetails = [];
  for (const filler of fillerList) {
    const regex = new RegExp(`\\b${filler}\\b`, 'gi');
    const matches = lowerText.match(regex);
    if (matches && matches.length > 0) {
      totalFillers += matches.length;
      fillerDetails.push(`"${filler}" (${matches.length}x)`);
    }
  }

  const fillerRate = wordCount > 0 ? ((totalFillers / wordCount) * 100).toFixed(1) : '0';
  const paceDesc = wpm < 100 ? 'very slow' : wpm < 120 ? 'slightly slow' : wpm <= 160 ? 'natural and well-paced' : wpm <= 180 ? 'slightly fast' : 'very fast';

  const textPrompt = `You are an expert interview presentation coach. A candidate just recorded a video response to a practice interview question. The video analysis system was unable to process the frames, so analyze their presentation based on speech patterns which correlate with non-verbal behavior.

**Interview Question:** "${question}"
**Response Duration:** ${durationSeconds} seconds
**Word Count:** ${wordCount} words
**Speaking Pace:** ${wpm} WPM (${paceDesc})
**Filler Words:** ${totalFillers} total (${fillerDetails.join(', ') || 'none detected'}) — filler rate: ${fillerRate}%
**Camera Active:** Yes (${frameCount} frames captured during recording)
**Transcription:** "${transcription.substring(0, 800)}"

Based on these speech patterns, infer likely presentation behaviors:
- A ${paceDesc} pace ${wpm < 120 ? 'often indicates uncertainty — candidates may appear hesitant' : wpm > 170 ? 'can signal nervousness — candidates tend to rush and fidget' : 'suggests confidence — candidates typically maintain better eye contact'}
- ${totalFillers > 5 ? 'High filler word usage suggests the candidate may appear distracted and show nervous micro-expressions' : totalFillers > 2 ? 'Moderate filler usage is normal but may coincide with brief breaks in eye contact' : 'Low filler usage indicates composure and likely steady eye contact'}

Return a JSON object with this EXACT structure:
{
  "eye_contact": { "score": 1-10, "feedback": "specific actionable feedback about eye contact during video interviews" },
  "facial_expressions": { "score": 1-10, "feedback": "specific feedback about facial engagement, confidence signals" },
  "body_language": { "score": 1-10, "feedback": "specific feedback about posture, gestures, and physical presence" },
  "professional_appearance": { "score": 1-10, "feedback": "tips about camera setup, lighting, background for video interviews" },
  "overall_presentation": 1-10,
  "summary": "2-3 sentence overall presentation assessment with key improvement area",
  "timestamped_notes": [
    { "frame": 1, "note": "coaching tip for the opening of the response" },
    { "frame": ${Math.max(1, Math.floor(frameCount / 2))}, "note": "coaching tip for the middle section" },
    { "frame": ${frameCount}, "note": "coaching tip for the closing" }
  ]
}

Only return the JSON object, no other text.`;

  try {
    console.log(`[video-analysis] Using text-based LLM fallback for presentation coaching (${frameCount} frames, ${wpm} WPM, ${totalFillers} fillers)`);

    const result = await aiProvider.chatCompletion([
      { role: 'system', content: 'You are an expert interview coach specializing in non-verbal communication, body language, and video interview presentation. Provide specific, actionable coaching. Always return valid JSON.' },
      { role: 'user', content: textPrompt }
    ], {
      module: 'quick_practice',
      feature: 'video_presentation',
      response_format: { type: 'json_object' },
      maxTokens: 1024,
      task: 'interview-coaching',
    });

    console.log('[video-analysis] Text-based presentation coaching received successfully (fallback)');
    const parsed = safeParseJSON(result);
    if (parsed && typeof parsed === 'object') {
      const normalized = normalizeVisionResult(parsed);
      if (normalized.eye_contact && normalized.body_language) return normalized;
      console.warn('[video-analysis] Text fallback missing expected fields after normalization. Keys:', Object.keys(parsed).join(', '));
    } else {
      console.warn('[video-analysis] Text fallback could not be parsed');
    }
    return defaultResult;
  } catch (err) {
    console.error('[video-analysis] Text-based fallback also failed:', err.message);
    return defaultResult;
  }
}

// Select evenly-spaced key frames from a larger set
function selectKeyFrames(frames, count) {
  const result = [];
  const step = (frames.length - 1) / (count - 1);
  for (let i = 0; i < count; i++) {
    result.push(frames[Math.round(i * step)]);
  }
  return result;
}

// Analyze speech transcription for communication quality
function analyzeSpeechPatterns(transcription, durationSeconds) {
  const words = transcription.trim().split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;
  const wpm = durationSeconds > 0 ? Math.round((wordCount / durationSeconds) * 60) : 0;

  // Filler word detection
  const fillerWords = ['um', 'uh', 'like', 'you know', 'so', 'basically', 'actually', 'literally', 'right', 'okay so', 'i mean'];
  const fillerCounts = {};
  let totalFillers = 0;
  const lowerTranscription = transcription.toLowerCase();

  for (const filler of fillerWords) {
    const regex = new RegExp(`\\b${filler}\\b`, 'gi');
    const matches = lowerTranscription.match(regex);
    if (matches && matches.length > 0) {
      fillerCounts[filler] = matches.length;
      totalFillers += matches.length;
    }
  }

  const fillerRate = wordCount > 0 ? (totalFillers / wordCount) * 100 : 0;

  // Pace analysis
  let paceAssessment = 'good';
  let paceFeedback = '';
  if (wpm < 100) {
    paceAssessment = 'too_slow';
    paceFeedback = 'Your speaking pace is quite slow. Try to speak more naturally and with more energy. Aim for 120-150 words per minute.';
  } else if (wpm < 120) {
    paceAssessment = 'slightly_slow';
    paceFeedback = 'Your pace is a bit slow. Try to increase your speaking speed slightly for more engaging delivery.';
  } else if (wpm <= 160) {
    paceAssessment = 'good';
    paceFeedback = 'Your speaking pace is natural and easy to follow. Well done!';
  } else if (wpm <= 180) {
    paceAssessment = 'slightly_fast';
    paceFeedback = 'You\'re speaking a bit quickly. Try to slow down slightly and pause between key points.';
  } else {
    paceAssessment = 'too_fast';
    paceFeedback = 'You\'re speaking too fast — this can signal nervousness. Take deliberate pauses between sentences and breathe.';
  }

  // Sentence structure analysis
  const sentences = transcription.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const avgSentenceLength = sentences.length > 0 ? Math.round(wordCount / sentences.length) : 0;

  // Communication score (1-10)
  let communicationScore = 7;
  // Penalize for filler words
  if (fillerRate > 5) communicationScore -= 2;
  else if (fillerRate > 3) communicationScore -= 1;
  // Penalize for bad pace
  if (paceAssessment === 'too_slow' || paceAssessment === 'too_fast') communicationScore -= 1.5;
  else if (paceAssessment === 'slightly_slow' || paceAssessment === 'slightly_fast') communicationScore -= 0.5;
  // Reward for good sentence structure
  if (avgSentenceLength >= 10 && avgSentenceLength <= 25) communicationScore += 0.5;
  // Penalize for very short responses
  if (wordCount < 50) communicationScore -= 2;
  else if (wordCount < 100) communicationScore -= 1;
  // Reward for substantial responses
  if (wordCount >= 150 && wordCount <= 400) communicationScore += 0.5;

  communicationScore = Math.max(1, Math.min(10, Math.round(communicationScore * 10) / 10));

  return {
    word_count: wordCount,
    duration_seconds: durationSeconds,
    words_per_minute: wpm,
    filler_words: fillerCounts,
    total_fillers: totalFillers,
    filler_rate: Math.round(fillerRate * 10) / 10,
    pace: {
      assessment: paceAssessment,
      wpm,
      feedback: paceFeedback
    },
    sentence_count: sentences.length,
    avg_sentence_length: avgSentenceLength,
    communication_score: communicationScore,
    tips: generateSpeechTips(fillerRate, wpm, wordCount, totalFillers, fillerCounts)
  };
}

function generateSpeechTips(fillerRate, wpm, wordCount, totalFillers, fillerCounts) {
  const tips = [];

  if (fillerRate > 3) {
    const topFillers = Object.entries(fillerCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([word, count]) => `"${word}" (${count}x)`);
    tips.push(`Reduce filler words — you used ${totalFillers} fillers: ${topFillers.join(', ')}. Try pausing silently instead.`);
  }

  if (wpm > 160) {
    tips.push('Slow down your pace. Take a breath between key points to let your message land.');
  } else if (wpm < 110) {
    tips.push('Pick up the pace slightly. A faster tempo projects confidence and engagement.');
  }

  if (wordCount < 80) {
    tips.push('Your response was quite short. Aim for 1-2 minutes of speaking time to give a comprehensive answer.');
  }

  if (tips.length === 0) {
    tips.push('Strong verbal delivery! Your pace and clarity are good. Keep practicing to maintain consistency.');
  }

  return tips;
}

// ─── ASR/WHISPER: Now with automatic multi-provider fallback ─────
// Fallback chain: OpenAI Whisper → NIM Parakeet TDT
async function transcribeAudioWithWhisper(audioBase64, options = {}) {
  try {
    // Strip full data URL prefix including codec params (e.g., data:audio/webm;codecs=opus;base64,)
    const base64Data = audioBase64.replace(/^data:audio\/[^;]+(?:;[^;]*)*;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    // Extract MIME type (e.g., audio/webm from data:audio/webm;codecs=opus;base64,)
    const mimeMatch = audioBase64.match(/^data:(audio\/[^;]+)/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'audio/webm';
    const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm';
    console.log(`[whisper] Audio format: ${mimeType}, ext: ${ext}, buffer size: ${buffer.length} bytes`);

    // Use provider service with automatic fallback (Whisper → Parakeet)
    return await aiProvider.transcribeAudio(buffer, `recording.${ext}`, mimeType, {
      subscriptionId: options.subscriptionId,
      module: 'mock_interview', feature: 'transcription',
    });
  } catch (err) {
    console.error('Whisper transcription error:', err.message || err);
    return null;
  }
}

// AI-powered voice quality analysis (tone, confidence, energy)
async function analyzeVoiceQuality(transcription, durationSeconds, options = {}) {
  try {
    const words = transcription.trim().split(/\s+/);
    const wpm = durationSeconds > 0 ? Math.round((words.length / durationSeconds) * 60) : 0;

    const prompt = `You are an expert interview speech coach. Analyze this candidate's vocal delivery based on their interview response transcription.

TRANSCRIPTION:
"${transcription.substring(0, 3000)}"

METRICS:
- Duration: ${durationSeconds} seconds
- Word count: ${words.length}
- Speaking pace: ${wpm} words per minute

Analyze the following vocal delivery dimensions based on the transcription patterns, language choice, and speech structure. Score each 1-10:

1. **Voice Confidence**: Look for hedging ("I think maybe", "sort of"), weak openers, qualifiers vs. decisive language
2. **Vocal Variety**: Sentence length variation, question marks, exclamations, rhetorical devices suggesting tonal changes
3. **Pacing & Rhythm**: Natural pauses (commas, periods), run-on sentences, appropriate breath points
4. **Articulation**: Word choice clarity, specificity, precise language vs. vague terms
5. **Energy & Enthusiasm**: Active voice, strong verbs, passion indicators, engagement level

Return ONLY valid JSON:
{
  "voice_confidence": { "score": 7, "feedback": "One sentence assessment" },
  "vocal_variety": { "score": 6, "feedback": "One sentence assessment" },
  "pacing_rhythm": { "score": 7, "feedback": "One sentence assessment" },
  "articulation": { "score": 8, "feedback": "One sentence assessment" },
  "energy": { "score": 7, "feedback": "One sentence assessment" },
  "overall_voice_score": 7,
  "voice_summary": "2-3 sentence overall vocal delivery assessment",
  "voice_tips": ["Specific actionable tip 1", "Specific actionable tip 2", "Specific actionable tip 3"]
}`;

    const result = await chat(prompt, {
      system: 'You are an expert interview coach specializing in vocal delivery and speech analysis. Return valid JSON only, no markdown.',
      maxTokens: 1024,
      subscriptionId: options.subscriptionId,
      module: 'mock_interview', feature: 'voice_analysis',
    });

    const parsed = safeParseJSON(result);
    if (parsed) {
      // Clamp all scores to 1-10
      for (const key of ['voice_confidence', 'vocal_variety', 'pacing_rhythm', 'articulation', 'energy']) {
        if (parsed[key]) parsed[key].score = Math.max(1, Math.min(10, parsed[key].score));
      }
      if (parsed.overall_voice_score) parsed.overall_voice_score = Math.max(1, Math.min(10, parsed.overall_voice_score));
      return parsed;
    }
    console.warn('[voice-quality] Failed to parse LLM response, returning null');
    return null;
  } catch (err) {
    console.error('Voice quality analysis error:', err.message || err);
    return null;
  }
}

// Comprehensive video interview analysis combining all signals
async function analyzeVideoInterviewResponse(question, transcription, frames, durationSeconds, keyPoints, options = {}) {
  const audioData = options.audioData || null;
  let finalTranscription = transcription;

  // Step 1: If audio data available, try Whisper for more accurate transcription
  // FIX (Feb 15, 2026): Cap Whisper at 5s — ASR cascade can take 20s, eating into
  // the analysis time budget and causing frontend timeout (35s). Browser transcription
  // is good enough as fallback.
  let whisperResult = null;
  if (audioData) {
    try {
      console.log('[ai] Transcribing audio with Whisper (5s cap)...');
      whisperResult = await Promise.race([
        transcribeAudioWithWhisper(audioData, options),
        new Promise((resolve) => setTimeout(() => {
          console.warn('[ai] Whisper 5s cap hit — using browser transcription');
          resolve(null);
        }, 5000))
      ]);
      if (whisperResult && whisperResult.text && whisperResult.text.trim().length > 20) {
        finalTranscription = whisperResult.text;
        console.log(`[ai] Whisper transcription: ${finalTranscription.length} chars (replaced browser transcription)`);
      } else {
        console.log('[ai] Whisper result too short or timed out, keeping browser transcription');
      }
    } catch (err) {
      console.warn('[ai] Whisper failed, using browser transcription:', err.message);
    }
  }

  // Step 2: Run all analyses in parallel with PER-PROMISE timeouts + MASTER timeout
  // BUG FIX (Feb 15, 2026 — Task #32681): Promise.allSettled was hanging forever when provider
  // API calls never settled (HTTP response streaming but never completing). With 4 parallel calls
  // each racing 3 providers (12 concurrent API requests from #32666), some providers become
  // unresponsive. Fix: (1) Lower per-promise timeout to 18s, (2) Add a 25s master timeout on
  // Promise.allSettled that force-resolves with partial results if any promise hangs.
  const PER_PROMISE_TIMEOUT_MS = 18000;
  const MASTER_TIMEOUT_MS = 25000;

  function withTimeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        console.warn(`[video-analysis] ${label} timed out after ${ms}ms`);
        reject(new Error(`${label} timeout after ${ms}ms`));
      }, ms);
      promise.then(
        val => { clearTimeout(timer); resolve(val); },
        err => { clearTimeout(timer); reject(err); }
      );
    });
  }

  // FIX (Feb 15, 2026): Pass transcription context to video presentation analysis
  // so the text-based LLM can generate personalized coaching from speech patterns
  const presentationOptions = {
    ...options,
    transcription: finalTranscription,
    durationSeconds,
    question,
  };

  const analysisPromises = [
    withTimeout(analyzeInterviewResponse(question, finalTranscription, keyPoints, options), PER_PROMISE_TIMEOUT_MS, 'contentAnalysis'),
    withTimeout(generateInterviewCoaching(question, finalTranscription, { score: 5, strengths: [], improvements: [] }, options), PER_PROMISE_TIMEOUT_MS, 'contentCoaching'),
    withTimeout(analyzeVideoPresentation(frames, presentationOptions), PER_PROMISE_TIMEOUT_MS, 'videoPresentation'),
    // FIX (Feb 15, 2026 — Task #32666): ALWAYS run voice quality analysis.
    // analyzeVoiceQuality() only analyzes transcription TEXT (not audio) — gating it behind
    // audioData was wrong because it skipped voice analysis entirely when MediaRecorder failed
    // (common on iOS). This caused the Voice & Tone Analysis section to disappear from the UI.
    withTimeout(analyzeVoiceQuality(finalTranscription, durationSeconds, options), PER_PROMISE_TIMEOUT_MS, 'voiceAnalysis')
  ];

  // FIX (Feb 15, 2026 — Task #32681): Track settlements individually so master timeout
  // can force-resolve with partial results instead of hanging forever.
  const partialResults = new Array(analysisPromises.length).fill(null);
  analysisPromises.forEach((p, i) => {
    p.then(
      val => { partialResults[i] = { status: 'fulfilled', value: val }; },
      err => { partialResults[i] = { status: 'rejected', reason: err }; }
    );
  });

  let settled;
  try {
    settled = await Promise.race([
      Promise.allSettled(analysisPromises),
      new Promise(resolve => setTimeout(() => {
        const settledCount = partialResults.filter(r => r !== null).length;
        console.warn(`[video-analysis] ⏱️ Master timeout (${MASTER_TIMEOUT_MS}ms) — ${settledCount}/${partialResults.length} settled, forcing response`);
        // Use whatever has settled so far; fill unsettled with rejections
        resolve(partialResults.map(r => r || { status: 'rejected', reason: new Error('Master timeout — analysis took too long') }));
      }, MASTER_TIMEOUT_MS))
    ]);
  } catch (err) {
    console.error('[video-analysis] Promise.allSettled unexpected error:', err.message);
    settled = partialResults.map(r => r || { status: 'rejected', reason: err });
  }

  // Extract results with fallbacks for any failed analyses
  // BUG FIX: Use helper function with multiple safety layers to prevent null crashes.
  // Previous null checks still let through edge cases where AI returned non-null truthy values
  // that were missing expected fields, causing TypeError: Cannot read properties of null.
  function safeExtract(index, fallback) {
    try {
      const s = settled[index];
      if (s && s.status === 'fulfilled' && s.value != null && typeof s.value === 'object') {
        return s.value;
      }
    } catch (e) {
      console.error(`[video-analysis] safeExtract(${index}) error:`, e.message);
    }
    return fallback;
  }

  const contentAnalysis = safeExtract(0, {
    score: 0, _failed: true, strengths: [], improvements: ['Content analysis failed — please try again'],
    covered_points: [], missed_points: [], detailed_feedback: 'AI content analysis could not be completed. Please record another answer to get detailed feedback on your response.'
  });
  const contentCoaching = safeExtract(1, {
    _failed: true, improved_response: '', specific_tips: ['Record another answer for personalized coaching tips'], body_language_tips: [],
    common_mistake: '', practice_prompt: ''
  });
  const videoAnalysis = safeExtract(2, {
    eye_contact: { score: 5, feedback: 'Video analysis unavailable' },
    facial_expressions: { score: 5, feedback: 'Video analysis unavailable' },
    body_language: { score: 5, feedback: 'Video analysis unavailable' },
    professional_appearance: { score: 5, feedback: 'Video analysis unavailable' },
    overall_presentation: 5, summary: 'Video analysis temporarily unavailable.', timestamped_notes: []
  });
  // FIX (Feb 15, 2026 — Task #32666): Always extract voice analysis (index 3).
  // Previously gated behind audioData which caused Voice & Tone section to vanish.
  const voiceAnalysis = safeExtract(3, null);

  // Log any failures for debugging
  settled.forEach((s, i) => {
    if (s.status === 'rejected') {
      const names = ['contentAnalysis', 'contentCoaching', 'videoAnalysis', 'voiceAnalysis'];
      console.error(`[video-analysis] ${names[i]} failed:`, s.reason?.message || s.reason);
    }
  });

  // Algorithmic speech analysis (always works — no AI calls)
  const speechAnalysis = analyzeSpeechPatterns(finalTranscription, durationSeconds);

  // BUG FIX: Wrap result assembly in try/catch — if ANY field access crashes, return a safe default
  try {
    // Calculate category scores — use 0 for failed analysis (don't inflate with default 5)
    const contentScore = contentAnalysis.score || 0;
    const contentFailed = contentAnalysis._failed === true;
    let communicationScore = speechAnalysis.communication_score || 5;
    const presentationScore = videoAnalysis.overall_presentation || 5;

    // If voice analysis available, blend its score into communication
    if (voiceAnalysis && voiceAnalysis.overall_voice_score) {
      communicationScore = Math.round(
        (communicationScore * 0.6 + voiceAnalysis.overall_voice_score * 0.4) * 10
      ) / 10;
      communicationScore = Math.max(1, Math.min(10, communicationScore));
    }

    // Weighted overall score — if content failed, only use communication + presentation
    let overallScore;
    if (contentFailed) {
      // Content analysis failed — compute from available scores only, don't let 0 drag down
      overallScore = Math.round(
        (communicationScore * 0.45 + presentationScore * 0.55) * 10
      ) / 10;
    } else {
      overallScore = Math.round(
        (contentScore * 0.45 + communicationScore * 0.25 + presentationScore * 0.30) * 10
      ) / 10;
    }

    return {
      overall_score: overallScore,
      _content_failed: contentFailed,
      // FIX (Feb 15, 2026 — Task #32666): Include transcription in response so frontend
      // has a fallback when browser SpeechRecognition state is lost
      transcription: finalTranscription,
      duration_seconds: durationSeconds,

      // Category breakdowns — use optional chaining (?) as final safety net
      content: {
        score: contentScore,
        _failed: contentFailed,
        strengths: contentAnalysis?.strengths || [],
        improvements: contentAnalysis?.improvements || [],
        covered_points: contentAnalysis?.covered_points || [],
        missed_points: contentAnalysis?.missed_points || [],
        detailed_feedback: contentAnalysis?.detailed_feedback || '',
        improved_response: contentCoaching?.improved_response || '',
        specific_tips: contentCoaching?.specific_tips || [],
        common_mistake: contentCoaching?.common_mistake || '',
        practice_prompt: contentCoaching?.practice_prompt || ''
      },

      communication: {
        score: communicationScore,
        word_count: speechAnalysis.word_count,
        words_per_minute: speechAnalysis.words_per_minute,
        duration_seconds: speechAnalysis.duration_seconds,
        filler_words: speechAnalysis.filler_words,
        total_fillers: speechAnalysis.total_fillers,
        filler_rate: speechAnalysis.filler_rate,
        pace: speechAnalysis.pace,
        tips: speechAnalysis.tips,
        // Voice analysis (only present when audio was recorded)
        ...(voiceAnalysis ? { voice_analysis: voiceAnalysis } : {})
      },

      presentation: {
        score: presentationScore,
        eye_contact: videoAnalysis?.eye_contact || { score: 5, feedback: '' },
        facial_expressions: videoAnalysis?.facial_expressions || { score: 5, feedback: '' },
        body_language: videoAnalysis?.body_language || { score: 5, feedback: '' },
        professional_appearance: videoAnalysis?.professional_appearance || { score: 5, feedback: '' },
        summary: videoAnalysis?.summary || '',
        timestamped_notes: videoAnalysis?.timestamped_notes || []
      }
    };
  } catch (assemblyErr) {
    // LAST RESORT: If result assembly itself crashes, return a complete safe default
    console.error('[video-analysis] Result assembly crashed — returning safe default:', assemblyErr.message);
    const speechFallback = analyzeSpeechPatterns(finalTranscription, durationSeconds);
    return {
      overall_score: 0,
      _content_failed: true,
      content: {
        score: 0, _failed: true, strengths: [], improvements: ['AI analysis encountered an error — please try again'],
        covered_points: [], missed_points: [], detailed_feedback: 'Analysis could not be completed due to a temporary error. Please record another answer.',
        improved_response: '', specific_tips: ['Record another answer for personalized coaching'],
        common_mistake: '', practice_prompt: ''
      },
      communication: {
        score: speechFallback.communication_score || 5,
        word_count: speechFallback.word_count, words_per_minute: speechFallback.words_per_minute,
        duration_seconds: speechFallback.duration_seconds, filler_words: speechFallback.filler_words,
        total_fillers: speechFallback.total_fillers, filler_rate: speechFallback.filler_rate,
        pace: speechFallback.pace, tips: speechFallback.tips
      },
      presentation: {
        score: 5, eye_contact: { score: 5, feedback: 'Analysis unavailable' },
        facial_expressions: { score: 5, feedback: 'Analysis unavailable' },
        body_language: { score: 5, feedback: 'Analysis unavailable' },
        professional_appearance: { score: 5, feedback: 'Analysis unavailable' },
        summary: 'Video analysis could not be completed. Your speech analysis is still available.',
        timestamped_notes: []
      }
    };
  }
}
// [REMOVED] generateQuestionBank — not used by Quick Practice (lives in polsia-ai.js)

// [REMOVED] conductInterviewTurn — not used by Quick Practice (lives in polsia-ai.js)

// [REMOVED] generateSessionFeedback — not used by Quick Practice (lives in polsia-ai.js)

// [REMOVED] textToSpeech — not used by Quick Practice (lives in polsia-ai.js)


/**
 * Helper for route handlers to return clear errors when AI providers fail.
 * Returns 503 (retryable) for provider cascade failures, 500 for other errors.
 */
function handleAIError(res, err, featureName = 'AI feature') {
  if (err.allProvidersFailed) {
    return res.status(503).json({
      error: `${featureName} temporarily unavailable`,
      message: 'AI providers are experiencing issues. Please try again in a moment.',
      retryable: true,
      retryAfterMs: 5000,
      totalElapsedMs: err.totalElapsedMs || 0,
    });
  }
  console.error(`[${featureName}] Error:`, err.message || err);
  return res.status(500).json({ error: `Failed: ${featureName}` });
}

// ─── QUICK PRACTICE EXPORTS ONLY ───────────────────────────────
// This module is ISOLATED from Mock Interview. Only export functions
// that Quick Practice actually uses. Mock Interview functions removed.
module.exports = {
  chat,
  analyzeInterviewResponse,
  generateInterviewCoaching,
  analyzeVideoPresentation,
  analyzeSpeechPatterns,
  transcribeAudioWithWhisper,
  analyzeVoiceQuality,
  analyzeVideoInterviewResponse,
  uploadFrameToR2,
  safeParseJSON,
  handleAIError,
  aiProvider,
};
