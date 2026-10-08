/**
 * C2: Sending a screening invite auto-advances the application pipeline status
 * from 'applied' to 'screening' (but does not override manual moves).
 *
 * RED: send only sets screening_status='invited', pipeline status stays 'applied'.
 * GREEN: status auto-advances to 'screening' when it was 'applied'.
 */
const fs = require('fs');
const path = require('path');

describe('screening send auto-advances pipeline status', () => {
	const source = fs.readFileSync(
		path.join(__dirname, '../../../routes/interviews.js'),
		'utf8'
	);

	test('send endpoint updates job_applications.status to screening', () => {
		// Find the screening-status update query in the send handler
		// It must set BOTH screening_status and pipeline status
		const match = source.match(
			/UPDATE job_applications SET screening_status = 'invited'[^;]+;/
		);
		expect(match).toBeTruthy();

		const updateSQL = match[0];
		// Must update screening_status
		expect(updateSQL).toMatch(/screening_status\s*=\s*'invited'/);
		// Must also auto-advance pipeline status (only from 'applied')
		expect(updateSQL).toMatch(/status\s*=\s*CASE WHEN status = 'applied' THEN 'screening'/);
	});
});
