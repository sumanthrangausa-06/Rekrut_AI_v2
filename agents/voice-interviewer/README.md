# Voice Interviewer Agent (Phase 2, #323)

The ears-and-mouth for AI interviews. The brain stays in the Phase 1 engine
(`services/conversation-engine.js`) — this worker only hears, speaks, and
observes.

## Modes

| Mode | Who talks | Agent does |
|------|-----------|------------|
| `interviewer` (Track A) | Candidate + AI | VAD → Whisper STT → `conductTurn` → Cartesia TTS → room. Barge-in: candidate speech stops TTS. |
| `observer` (Track B) | Recruiter + candidate | Muted. Subscribes to both audio tracks, STT with speaker labels from LiveKit participant identities. **Never** publishes audio or calls TTS. |

The mode comes from Task 2's dispatch metadata:
`{"interview_session_id": <n>, "mode": "interviewer" | "observer"}`.

## Files

- `pipeline.js` — pure turn logic, zero LiveKit imports. STT/TTS/engine/
  persistence are injected. **This is what's unit-tested.**
- `pipeline.test.js` — 20 tests, all mocked (no network, no keys).
- `worker.mjs` — the thin LiveKit adapter: room join, Silero VAD loop, TTS
  playback via `AudioSource`, barge-in, session load/save via `lib/db`.
- `Dockerfile` — build context is the **repo root** (the worker imports
  `services/` and `lib/` via relative paths).
- `agent.env.example` — secrets template (never commit values).

## Environment

| Var | Source |
|-----|--------|
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Same as the backend (staging: Render env vars). Cloud injects these on deploy — do NOT put them in the secrets file. |
| `LIVEKIT_AGENT_NAME` | Optional. Default `rekrut-interviewer`. **Must match** `getVoiceAgentName()` in `server/services/livekit.js` — Task 2 dispatches to that name. |
| `DATABASE_URL` | Session load/save (`interview_sessions`). |
| `CARTESIA_API_KEY` | TTS. The worker requests **raw PCM** (`output_format: {container:'raw', encoding:'pcm_s16le', sample_rate:24000}`) for LiveKit publishing — see the `outputFormat` option on `services/tts-service.js` `synthesize()`. |
| `AI_KEYS_JSON` | LLM/STT provider keys, same JSON the backend reads. |

## Run locally (dev)

```bash
# From the repo root, with env vars set:
node agents/voice-interviewer/worker.mjs
```

Dispatch it to a room by name (the backend's Task 2 endpoint does this in
production):

```bash
lk dispatch create \
  --agent-name rekrut-interviewer \
  --room interview-7 \
  --metadata '{"interview_session_id":7,"mode":"interviewer"}'
```

## Deploy to LiveKit Cloud

```bash
# 1. Authenticate the CLI (once per machine)
lk cloud auth

# 2. From the REPOSITORY ROOT (the Docker build context — see Dockerfile),
#    create the agent. First run writes livekit.toml (per-project; gitignored).
cp agents/voice-interviewer/agent.env.example agents/voice-interviewer/agent.env
# ... fill in agent.env (no LIVEKIT_* keys — Cloud injects those) ...
lk agent create --name rekrut-interviewer --secrets-file agents/voice-interviewer/agent.env .
# ^ --name MUST be rekrut-interviewer (or match LIVEKIT_AGENT_NAME): Task 2's
#   dispatch targets that name (server/services/livekit.js getVoiceAgentName()).

# 3. Later deploys
lk agent deploy .

# 4. Observe
lk agent status
lk agent logs
```

One agent deployment serves both modes — the mode is per-dispatch, not
per-deployment. Deploy once per LiveKit project (dev project, then the
staging/production project).

## VAD tuning

Conservative barge-in (`pipeline.js` `VAD_CONFIG`, units are milliseconds —
verified against `@livekit/agents@1.9.1` source):

- `minSilenceDuration: 600` — the yield delay: 600ms of trailing silence
  before the agent treats speech as a finished utterance (spec requires ≥300ms).
- `minSpeechDuration: 100` — sub-100ms blips don't start a turn.
- `prefixPaddingDuration: 500`, `maxBufferedSpeech: 60000`, `sampleRate: 16000`.

## What was verified / not verified

- ✅ `pipeline.js`: 20/20 unit tests (RED then GREEN), mocked boundaries.
- ✅ `services/tts-service.js` `outputFormat` extension: 2/2 tests, default
  behavior unchanged for existing callers.
- ✅ LiveKit API usage (`defineAgent`, `cli.runApp`, `VAD.load`, `VADEventType`
  numeric values, `AudioStream`/`AudioSource`/`LocalAudioTrack`) checked
  against the installed `@livekit/agents@1.9.1` / `@livekit/agents-plugin-silero@1.9.1`
  package sources.
- ✅ New deps declared in root `package.json` (`@livekit/agents`,
  `@livekit/agents-plugin-silero` — both MIT, $0). `npm install` could not
  complete on this VM (proxy TLS resets); it must run wherever the worker is
  built/deployed.
- ❌ `worker.mjs` has no unit tests (thin LiveKit adapter) — verified live in
  Task 7 staging E2E: real voice call, barge-in, empty-STT re-prompt,
  observer transcript labels.
- ❌ `lk agent create` not run here (no CLI, no Cloud project access from this
  environment) — Task 7 owns the staging deploy.

## Notes for Task 5 (observer report)

On shutdown, the observer worker writes its speaker-labeled transcript to
`interview_sessions.config -> 'observer_transcript'` (`[{speaker, text, at}]`).
Task 5's Q&A extraction reads that key; promoting it to a dedicated column is
a reversible later upgrade.
