/**
 * S-D15 (#1917) AC-5 repo half (BR-10): Desert Ant Labs credit in the
 * repository documentation. The public-page half is BLOCKED — no legal /
 * acknowledgements page exists in the app (see STOP 1 on #1917) — so this
 * test pins only the repository credit.
 */
const fs = require('node:fs');
const path = require('node:path');

const README = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'README.md'), 'utf8');

describe('S-D15 AC-5 (repo half) — Desert Ant Labs attribution in README', () => {
	test('README credits Desert Ant Labs with a link to desertant.com', () => {
		expect(README).toMatch(/Desert Ant Labs/);
		expect(README).toMatch(/\(https:\/\/desertant\.com\)/);
	});

	test('credit names the Who diarization SDK / speaker labelling', () => {
		expect(README).toMatch(/Who/i);
		expect(README).toMatch(/speaker labelling/i);
	});
});
