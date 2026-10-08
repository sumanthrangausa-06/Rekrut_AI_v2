/**
 * C3: Applicant card renders screening status and score.
 *
 * The API returns screening_status and screening_score, but the frontend
 * never displays them on the applicant card.
 *
 * RED: card does not reference app.screening_status
 * GREEN: card renders screening badge with status and score.
 */
import fs from 'fs';
import path from 'path';

describe('applicant card screening display', () => {
	const source = fs.readFileSync(
		path.join(__dirname, '../../pages/recruiter/job-applicants.tsx'),
		'utf8'
	);

	test('card renders screening_status badge', () => {
		// The card must reference app.screening_status for display
		expect(source).toMatch(/app\.screening_status/);
	});

	test('card renders screening_score when available', () => {
		expect(source).toMatch(/app\.screening_score/);
	});
});
