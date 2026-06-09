const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CACHE_DIR = '/tmp/cartesia-cache';

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

/**
 * POST /api/notifications/voice
 * Generate voice audio for a notification
 * Body: { text: string, emotion?: 'neutral' | 'enthusiastic' | 'calm' }
 */
router.post('/voice', async (req, res) => {
  try {
    const { text, emotion = 'neutral' } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: 'text is required' });
    }

    // Generate cache key from text + emotion
    const cacheKey = crypto.createHash('sha256').update(text + emotion).digest('hex');
    const cachePath = path.join(CACHE_DIR, `${cacheKey}.mp3`);

    // Check cache first
    if (fs.existsSync(cachePath)) {
      return res.json({
        audioUrl: `/api/notifications/voice/${cacheKey}`,
        cached: true,
        emotion
      });
    }

    // Call Cartesia API
    const apiKey = process.env.CARTESIA_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'CARTESIA_API_KEY not configured' });
    }

    const emotionMap = {
      neutral: 'neutral:',
      enthusiastic: 'enthusiastic:',
      calm: 'calm:',
      excited: 'excited:',
      serious: 'serious:'
    };

    const response = await fetch('https://api.cartesia.ai/tts/bytes', {
      method: 'POST',
      headers: {
        'Cartesia-Version': '2026-03-01',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model_id: 'sonic-3.5',
        transcript: text,
        voice: {
          mode: 'id',
          id: 'f786b574-daa5-4673-aa0c-cbe3e8534c02' // Katie voice
        },
        language: 'en',
        output_format: {
          container: 'mp3',
          sample_rate: 24000,
          bit_rate: 128000
        },
        generation_config: {
          speed: 1.0,
          volume: 1.0,
          emotion: emotionMap[emotion] || emotionMap.neutral
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Cartesia API error:', errorText);
      return res.status(502).json({ error: 'Cartesia API failed', details: errorText });
    }

    // Save audio to cache
    const audioBuffer = await response.arrayBuffer();
    fs.writeFileSync(cachePath, Buffer.from(audioBuffer));

    res.json({
      audioUrl: `/api/notifications/voice/${cacheKey}`,
      cached: false,
      emotion,
      duration: Math.ceil(text.length / 15) // Rough estimate
    });

  } catch (error) {
    console.error('Voice notification error:', error);
    res.status(500).json({ error: 'Failed to generate voice notification' });
  }
});

/**
 * GET /api/notifications/voice/:cacheKey
 * Serve cached audio file
 */
router.get('/voice/:cacheKey', (req, res) => {
  try {
    const { cacheKey } = req.params;
    
    // Validate cache key format (sha256 = 64 hex chars)
    if (!/^[a-f0-9]{64}$/.test(cacheKey)) {
      return res.status(400).json({ error: 'Invalid cache key' });
    }

    const cachePath = path.join(CACHE_DIR, `${cacheKey}.mp3`);

    if (!fs.existsSync(cachePath)) {
      return res.status(404).json({ error: 'Audio not found' });
    }

    // Set cache headers for 24 hours
    res.set('Cache-Control', 'public, max-age=86400');
    res.set('Content-Type', 'audio/mpeg');
    res.sendFile(cachePath);

  } catch (error) {
    console.error('Serve audio error:', error);
    res.status(500).json({ error: 'Failed to serve audio' });
  }
});

/**
 * GET /api/notifications/voice/status
 * Check Cartesia service status and cache stats
 */
router.get('/voice/status', (req, res) => {
  try {
    const cacheFiles = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.mp3'));
    const totalSize = cacheFiles.reduce((sum, f) => {
      return sum + fs.statSync(path.join(CACHE_DIR, f)).size;
    }, 0);

    res.json({
      status: 'ok',
      apiKeyConfigured: !!process.env.CARTESIA_API_KEY,
      cachedFiles: cacheFiles.length,
      cacheSizeMB: (totalSize / 1024 / 1024).toFixed(2),
      cacheDirectory: CACHE_DIR
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to check status' });
  }
});

module.exports = router;
