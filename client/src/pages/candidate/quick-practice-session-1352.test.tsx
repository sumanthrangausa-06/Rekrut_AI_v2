/**
 * #1352 — Quick Practice text mode: 'Get AI Coaching' was a silent no-op.
 *
 * submitTextResponse had no `else` for `!res.success` and showed thrown
 * errors only via alert() — there was no inline error state. Any failure
 * (HTTP 200 with success:false, or a thrown 500/503) rendered exactly like
 * "nothing happened". These tests pin the contract: a click produces a
 * coaching result OR a visible inline error — never silence.
 *
 * NOTE: apiCall is mocked at the network boundary, so these are unit /
 * regression pins only. They do NOT satisfy the Quinn E2E-on-dev gate.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const apiCallMock = vi.fn();
vi.mock('@/lib/api', () => ({ apiCall: (...args: unknown[]) => apiCallMock(...args) }));

vi.mock('react-router-dom', () => ({
	useParams: () => ({ questionId: 'beh-1' }),
	useNavigate: () => vi.fn(),
}));

vi.mock('@/hooks/useInterviewCamera', () => ({
	useInterviewCamera: () => ({
		cameraReady: false,
		cameraError: null,
		cameraStatus: 'idle',
		micActive: false,
		startCamera: vi.fn(),
		stopCamera: vi.fn(),
		getStream: () => null,
	}),
}));

vi.mock('@/components/QPBiometricConsent', () => ({ QPBiometricConsent: () => null }));

import { QuickPracticeSessionPage } from './quick-practice-session';

const QUESTION = {
	id: 'beh-1',
	category: 'behavioral',
	difficulty: 'Medium',
	question: 'Tell me about a time when you had to deal with a difficult team member.',
	key_points: ['Conflict resolution'],
};

const LONG_RESPONSE =
	'In my previous role I led a migration that was failing badly. I broke the work into ' +
	'small pieces, communicated daily with stakeholders, and delivered two weeks early.';

async function renderTextMode() {
	render(<QuickPracticeSessionPage />);
	// Question loads from the practice library, then pick text mode.
	const textModeBtn = await screen.findByText('Type Response');
	fireEvent.click(textModeBtn.closest('button') as HTMLElement);
	const textarea = await screen.findByPlaceholderText(/Take your time to craft/);
	fireEvent.change(textarea, { target: { value: LONG_RESPONSE } });
	return screen.getByRole('button', { name: /Get AI Coaching/ });
}

describe('#1352 Quick Practice text submit — result or visible error, never silence', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(window, 'alert').mockImplementation(() => {});
		apiCallMock.mockImplementation(async (url: string) => {
			if (url === '/interviews/practice/library')
				return { success: true, questions: [QUESTION] };
			throw new Error(`unexpected apiCall in setup: ${url}`);
		});
	});

	test('HTTP 200 with success:false shows a visible inline error (was: silent no-op)', async () => {
		apiCallMock.mockImplementation(async (url: string) => {
			if (url === '/interviews/practice/library')
				return { success: true, questions: [QUESTION] };
			if (url === '/interviews/practice/submit') return { success: false };
			throw new Error(`unexpected apiCall: ${url}`);
		});

		const button = await renderTextMode();
		fireEvent.click(button);

		expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't|could not|failed|unavailable/i);
	});

	test('thrown provider error (503) shows its truthful message inline, not only alert()', async () => {
		apiCallMock.mockImplementation(async (url: string) => {
			if (url === '/interviews/practice/library')
				return { success: true, questions: [QUESTION] };
			if (url === '/interviews/practice/submit')
				throw new Error('AI coaching is temporarily unavailable. Please try again in a moment.');
			throw new Error(`unexpected apiCall: ${url}`);
		});

		const button = await renderTextMode();
		fireEvent.click(button);

		expect(await screen.findByRole('alert')).toHaveTextContent(/temporarily unavailable/i);
	});

	test('success shows the coaching result', async () => {
		apiCallMock.mockImplementation(async (url: string) => {
			if (url === '/interviews/practice/library')
				return { success: true, questions: [QUESTION] };
			if (url === '/interviews/practice/submit')
				return {
					success: true,
					coaching: {
						score: 7,
						strengths: ['Clear structure'],
						improvements: ['Add metrics'],
						specific_tips: [],
					},
				};
			throw new Error(`unexpected apiCall: ${url}`);
		});

		const button = await renderTextMode();
		fireEvent.click(button);

		await waitFor(() => expect(screen.getByText('AI Coaching Feedback')).toBeInTheDocument());
		expect(screen.getByText('7/10')).toBeInTheDocument();
	});
});
