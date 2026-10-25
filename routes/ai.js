// ─── General AI Assistant chat ─────────────────────────────────────────────
// Powers the floating AI Assistant (client/src/components/domain/ai-chat-fab.tsx
// via client/src/hooks/use-ai-chat.ts → POST /api/ai/chat).
//
// The frontend expects { message: string }. Previously no route was mounted at
// /api/ai, so every request 404'd and the UI showed "Request failed."

const express = require('express');
const { authMiddleware } = require('../lib/auth');
const polsiaAI = require('../lib/polsia-ai');

const router = express.Router();

// Keep user input bounded — the FAB sends short questions, not documents.
const MAX_MESSAGE_LENGTH = 2000;

// Friendly fallback shown only when the AI service genuinely fails.
const SERVICE_UNAVAILABLE_MESSAGE =
	"I'm having trouble reaching the AI service right now. Please try again in a moment.";

// POST /api/ai/chat — send a message, get the assistant's reply
router.post('/chat', authMiddleware, async (req, res) => {
	try {
		const { message, context } = req.body;

		if (!message || typeof message !== 'string' || !message.trim()) {
			return res.status(400).json({ error: 'Message is required' });
		}
		if (message.length > MAX_MESSAGE_LENGTH) {
			return res
				.status(400)
				.json({ error: `Message must be under ${MAX_MESSAGE_LENGTH} characters` });
		}

		const pageContext =
			context && context.page ? `\nThe user is currently on the "${context.page}" page.` : '';
		const userName = req.user?.name || 'there';

		const systemPrompt =
			`You are Rekrut AI's friendly assistant. You help job seekers with their job search, ` +
			`applications, interviews, resumes, and career advice. ` +
			`Be concise, practical, and encouraging. If you don't know something, say so honestly.${pageContext}\n\n` +
			`User's name: ${userName}`;

		let aiResponse;
		try {
			aiResponse = await polsiaAI.chat(
				[
					{ role: 'system', content: systemPrompt },
					{ role: 'user', content: message.trim() },
				],
				{ max_tokens: 512, module: 'assistant', feature: 'ai_assistant_chat' },
			);
		} catch (aiErr) {
			console.error('[ai-assistant] AI provider failed:', aiErr?.message || aiErr);
			return res.status(503).json({ error: SERVICE_UNAVAILABLE_MESSAGE });
		}

		if (!aiResponse || typeof aiResponse !== 'string' || !aiResponse.trim()) {
			return res.status(503).json({ error: SERVICE_UNAVAILABLE_MESSAGE });
		}

		res.json({ message: aiResponse });
	} catch (err) {
		console.error('[ai-assistant] Unexpected error:', err);
		res.status(500).json({ error: 'Something went wrong. Please try again.' });
	}
});

module.exports = router;
