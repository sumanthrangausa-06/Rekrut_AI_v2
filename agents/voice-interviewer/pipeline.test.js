/**
 * Task 3 (#323) — voice agent worker: pipeline unit tests.
 *
 * The pipeline is pure logic (no LiveKit imports): STT/TTS/engine are
 * injected, so every test runs with mocked boundaries and no network.
 * The LiveKit wiring lives in worker.mjs (thin adapter, tested on staging).
 */

const {
	VAD_CONFIG,
	REPROMPT_TEXT,
	createInterviewerPipeline,
	createObserverPipeline,
	pcmToWavBuffer,
	getAgentName,
	parseDispatchMetadata,
} = require('./pipeline');

const SESSION = {
	id: 7,
	conversation: [],
	config: {
		question_source: 'personalized',
		base_questions: ['Tell me about yourself'],
		current_question_index: 0,
	},
};

function makeDeps(overrides = {}) {
	return {
		transcribe: jest.fn(async () => 'I led a team of five engineers'),
		synthesize: jest.fn(async (text) => Buffer.from(`audio:${text}`)),
		conductTurn: jest.fn(async () => ({
			ai_message: 'Great, tell me more about that project.',
			phase: 'interview',
			is_complete: false,
		})),
		persistSession: jest.fn(async () => {}),
		...overrides,
	};
}

describe('VAD_CONFIG', () => {
	test('yield delay is conservative (>= 300ms of trailing silence before cutting in)', () => {
		expect(VAD_CONFIG.minSilenceDuration).toBeGreaterThanOrEqual(300);
	});

	test('ignores sub-100ms blips so noise does not start a turn', () => {
		expect(VAD_CONFIG.minSpeechDuration).toBeGreaterThanOrEqual(100);
	});
});

describe('createInterviewerPipeline', () => {
	test('empty STT transcript -> re-prompts via TTS, conductTurn NOT called', async () => {
		const deps = makeDeps({ transcribe: jest.fn(async () => '   ') });
		const pipeline = createInterviewerPipeline(deps);

		const result = await pipeline.processUtterance({
			audioBuffer: Buffer.from('pcm'),
			session: SESSION,
		});

		expect(deps.conductTurn).not.toHaveBeenCalled();
		expect(deps.synthesize).toHaveBeenCalledTimes(1);
		expect(deps.synthesize).toHaveBeenCalledWith(REPROMPT_TEXT, expect.anything());
		expect(result.type).toBe('reprompt');
		expect(result.text).toBe(REPROMPT_TEXT);
		expect(Buffer.isBuffer(result.audioBuffer)).toBe(true);
		// Nothing persisted: an empty attempt is not a conversation turn.
		expect(deps.persistSession).not.toHaveBeenCalled();
	});

	test('null STT result -> re-prompts (same as empty)', async () => {
		const deps = makeDeps({ transcribe: jest.fn(async () => null) });
		const pipeline = createInterviewerPipeline(deps);

		const result = await pipeline.processUtterance({
			audioBuffer: Buffer.from('pcm'),
			session: SESSION,
		});

		expect(result.type).toBe('reprompt');
		expect(deps.conductTurn).not.toHaveBeenCalled();
	});

	test('valid transcript -> conductTurn called with (session, text, null), reply sent to TTS', async () => {
		const deps = makeDeps();
		// Snapshot the conversation at call time: the pipeline keeps appending to
		// the same array afterwards, so post-hoc inspection would see aliasing.
		let seenAtCallTime = null;
		deps.conductTurn.mockImplementation(async (session) => {
			seenAtCallTime = [...session.conversation];
			return { ai_message: 'Great, tell me more about that project.', phase: 'interview', is_complete: false };
		});
		const pipeline = createInterviewerPipeline(deps);

		const result = await pipeline.processUtterance({
			audioBuffer: Buffer.from('pcm'),
			session: SESSION,
		});

		expect(deps.conductTurn).toHaveBeenCalledTimes(1);
		const [sessionArg, textArg, framesArg] = deps.conductTurn.mock.calls[0];
		expect(textArg).toBe('I led a team of five engineers');
		expect(framesArg).toBeNull();
		// The engine receives the conversation WITH the candidate turn already
		// appended (same contract as the HTTP route in routes/interview-sessions.js).
		const lastTurn = seenAtCallTime[seenAtCallTime.length - 1];
		expect(lastTurn).toMatchObject({ role: 'candidate', text: 'I led a team of five engineers' });
		expect(sessionArg).toBeTruthy();
		expect(deps.synthesize).toHaveBeenCalledWith(
			'Great, tell me more about that project.',
			expect.anything(),
		);
		expect(result.type).toBe('reply');
		expect(result.text).toBe('Great, tell me more about that project.');
		expect(result.isComplete).toBe(false);
	});

	test('persists the candidate answer BEFORE the engine call (crash-resume safety)', async () => {
		const order = [];
		const deps = makeDeps({
			persistSession: jest.fn(async (s) => {
				order.push(s.conversation[s.conversation.length - 1].role);
			}),
			conductTurn: jest.fn(async () => {
				order.push('engine');
				return { ai_message: 'ok', phase: 'interview', is_complete: false };
			}),
		});
		const pipeline = createInterviewerPipeline(deps);

		await pipeline.processUtterance({ audioBuffer: Buffer.from('pcm'), session: SESSION });

		expect(order).toEqual(['candidate', 'engine', 'interviewer']);
	});

	test('updatedSession appends candidate + interviewer turns and advances personalized config', async () => {
		const deps = makeDeps();
		const pipeline = createInterviewerPipeline(deps);

		const result = await pipeline.processUtterance({
			audioBuffer: Buffer.from('pcm'),
			session: SESSION,
		});

		const conv = result.updatedSession.conversation;
		expect(conv).toHaveLength(2);
		expect(conv[0]).toMatchObject({ role: 'candidate', text: 'I led a team of five engineers' });
		expect(conv[0].timestamp).toBeTruthy();
		expect(conv[1]).toMatchObject({
			role: 'interviewer',
			text: 'Great, tell me more about that project.',
			phase: 'interview',
		});
		expect(result.updatedSession.config.current_question_index).toBe(1);
	});

	test('screening sessions advance current_phase instead of the question index', async () => {
		const deps = makeDeps();
		const pipeline = createInterviewerPipeline(deps);
		const screening = {
			id: 9,
			conversation: [],
			config: { question_source: 'template', current_phase: 'intro' },
		};

		const result = await pipeline.processUtterance({
			audioBuffer: Buffer.from('pcm'),
			session: screening,
		});

		expect(result.updatedSession.config.current_phase).toBe('interview');
		expect(result.updatedSession.config.current_question_index).toBeUndefined();
	});

	test('is_complete from the engine surfaces on the result', async () => {
		const deps = makeDeps({
			conductTurn: jest.fn(async () => ({
				ai_message: 'Thanks, we are done.',
				phase: 'wrap_up',
				is_complete: true,
			})),
		});
		const pipeline = createInterviewerPipeline(deps);

		const result = await pipeline.processUtterance({
			audioBuffer: Buffer.from('pcm'),
			session: SESSION,
		});

		expect(result.isComplete).toBe(true);
	});
});

describe('createObserverPipeline', () => {
	test('utterance -> NO TTS call, transcript appended with speaker label', async () => {
		const deps = makeDeps();
		const pipeline = createObserverPipeline(deps);

		const entry = await pipeline.processUtterance({
			audioBuffer: Buffer.from('pcm'),
			speaker: 'recruiter-42',
		});

		expect(deps.synthesize).not.toHaveBeenCalled();
		expect(entry).toMatchObject({ speaker: 'recruiter-42', text: 'I led a team of five engineers' });
		expect(entry.at).toBeTruthy();
		expect(pipeline.getTranscript()).toHaveLength(1);
	});

	test('empty transcript -> skipped, not appended', async () => {
		const deps = makeDeps({ transcribe: jest.fn(async () => '  ') });
		const pipeline = createObserverPipeline(deps);

		const entry = await pipeline.processUtterance({
			audioBuffer: Buffer.from('pcm'),
			speaker: 'candidate-7',
		});

		expect(entry).toBeNull();
		expect(pipeline.getTranscript()).toHaveLength(0);
	});

	test('both sides accumulate in order with their LiveKit identities', async () => {
		const deps = makeDeps();
		deps.transcribe
			.mockResolvedValueOnce('Tell me about your background')
			.mockResolvedValueOnce('I am a data analyst');
		const pipeline = createObserverPipeline(deps);

		await pipeline.processUtterance({ audioBuffer: Buffer.from('a'), speaker: 'recruiter-42' });
		await pipeline.processUtterance({ audioBuffer: Buffer.from('b'), speaker: 'candidate-7' });

		const t = pipeline.getTranscript();
		expect(t.map((e) => e.speaker)).toEqual(['recruiter-42', 'candidate-7']);
		expect(t[1].text).toBe('I am a data analyst');
	});
});

describe('pcmToWavBuffer', () => {
	test('produces a valid 16-bit PCM WAV header', () => {
		const samples = new Int16Array([0, 1000, -1000, 32767]);
		const buf = pcmToWavBuffer(samples, 16000);

		expect(buf.subarray(0, 4).toString()).toBe('RIFF');
		expect(buf.subarray(8, 12).toString()).toBe('WAVE');
		expect(buf.readUInt32LE(24)).toBe(16000); // sample rate
		expect(buf.readUInt16LE(34)).toBe(16); // bits per sample
		expect(buf.readUInt32LE(40)).toBe(samples.length * 2); // data size
		expect(buf.length).toBe(44 + samples.length * 2);
	});
});

describe('getAgentName', () => {
	const OLD = process.env.LIVEKIT_AGENT_NAME;

	afterEach(() => {
		if (OLD === undefined) delete process.env.LIVEKIT_AGENT_NAME;
		else process.env.LIVEKIT_AGENT_NAME = OLD;
	});

	test('defaults to rekrut-interviewer (matches getVoiceAgentName in server/services/livekit.js)', () => {
		delete process.env.LIVEKIT_AGENT_NAME;
		expect(getAgentName()).toBe('rekrut-interviewer');
	});

	test('respects LIVEKIT_AGENT_NAME override', () => {
		process.env.LIVEKIT_AGENT_NAME = 'custom-agent';
		expect(getAgentName()).toBe('custom-agent');
	});
});

describe('parseDispatchMetadata', () => {
	test('parses interviewer dispatch metadata', () => {
		expect(
			parseDispatchMetadata(JSON.stringify({ interview_session_id: 7, mode: 'interviewer' })),
		).toEqual({ interviewSessionId: 7, mode: 'interviewer' });
	});

	test('parses observer dispatch metadata', () => {
		expect(
			parseDispatchMetadata(JSON.stringify({ interview_session_id: 9, mode: 'observer' })),
		).toEqual({ interviewSessionId: 9, mode: 'observer' });
	});

	test('rejects unknown modes', () => {
		expect(() =>
			parseDispatchMetadata(JSON.stringify({ interview_session_id: 7, mode: 'avatar' })),
		).toThrow(/mode/i);
	});

	test('rejects missing session id', () => {
		expect(() => parseDispatchMetadata(JSON.stringify({ mode: 'interviewer' }))).toThrow(
			/interview_session_id/i,
		);
	});

	test('rejects malformed JSON', () => {
		expect(() => parseDispatchMetadata('not-json')).toThrow();
	});
});
