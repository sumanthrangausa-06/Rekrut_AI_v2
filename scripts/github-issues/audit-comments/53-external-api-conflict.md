**Audit 2026-08-08** - verified against `origin/dev` at `9eaa2af`.

**This appears to be already implemented, contrary to its open status:**

- `services/cartesia-voice.js`
- `services/tts-service.js`
- `routes/tts.js`, `routes/voice.js`, `routes/voice-notifications.js`
- `client/src/components/voice-features.tsx`
- `migrations/046_voice_notifications.js`
- Config key in `.env.example`

There is also a `kimi-cartesia-phase2` branch with further work, and #65 covering the same scope was closed as completed on 2026-08-06.

**Two decisions are needed.**

First, whether this issue should simply be closed as done.

Second, and more important: Cartesia is a third-party API, which conflicts with the all-in-one, no-external-dependency principle locked in the CEO review and recorded in #94. Because the integration already ships, this is not a hypothetical conflict. It needs either a documented exception or a plan to replace it with self-hosted TTS.
