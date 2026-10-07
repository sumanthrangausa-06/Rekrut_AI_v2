/**
 * C4: Candidates page shows error state on API failure.
 *
 * The loadCandidates catch block (candidates.tsx:318-320) was empty except
 * for console.error — page shows empty with no feedback.
 *
 * RED: no error state in component
 * GREEN: error state exists and catch sets it.
 */
import fs from 'fs';
import path from 'path';

describe('candidates page error handling', () => {
	const source = fs.readFileSync(
		path.join(__dirname, '../../pages/recruiter/candidates.tsx'),
		'utf8'
	);

	test('has error state variable', () => {
		expect(source).toMatch(/const \[loadError,\s*setLoadError\] = useState/);
	});

	test('catch block sets error state (not just console.error)', () => {
		// Find the loadCandidates catch block
		const catchMatch = source.match(
			/catch\s*\(err\)\s*\{[^}]*console\.error\('Failed to load candidates:'[^}]*\}/
		);
		expect(catchMatch).toBeTruthy();
		// The catch must also set error state
		expect(catchMatch[0]).toMatch(/set[A-Za-z]*Error/);
	});

	test('renders error UI when error state is set', () => {
		// Error UI should be conditionally rendered
		expect(source).toMatch(/loadError \?/);
	});
});
