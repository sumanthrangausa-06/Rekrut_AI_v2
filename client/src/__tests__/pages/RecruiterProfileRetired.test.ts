import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// S-115 (#845): /recruiter/profile must NOT render the invented company
// ("TechCorp Solutions", 4.8★, 89 hires, local-state-only Save, zero API
// calls). Lead STOP 1 ruled RETIRE: the route redirects to the real editor
// at /recruiter/company and the fake component file is deleted.
//
// Honest-equivalent note: this repo has no App-level router-test pattern
// (no existing test imports App.tsx; page tests render components inside
// their own MemoryRouter). So this test makes source-level assertions
// against the real App.tsx / header.tsx / file tree — the production
// change that would break it is exactly re-adding the fake route, the
// fake file, or the header link to it.

const srcDir = path.resolve(__dirname, '../..');
const appSource = readFileSync(path.join(srcDir, 'App.tsx'), 'utf8');
const headerSource = readFileSync(
	path.join(srcDir, 'components/layout/header.tsx'),
	'utf8',
);
// Split so this test file does not itself contain the invented name.
const INVENTED_COMPANY = ['TechCorp', 'Solutions'].join(' ');

function walk(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const full = path.join(dir, name);
		return statSync(full).isDirectory() ? walk(full) : [full];
	});
}

describe('#845 — fake recruiter profile retired', () => {
	it('the fake component file is deleted from the tree', () => {
		expect(existsSync(path.join(srcDir, 'pages/recruiter-profile.tsx'))).toBe(false);
	});

	it('App.tsx no longer imports or renders the fake page', () => {
		expect(appSource).not.toContain('recruiter-profile');
		expect(appSource).not.toContain('RecruiterProfilePage');
	});

	it('/recruiter/profile route redirects to the real company editor', () => {
		// "profile" is also a candidate child route — check every occurrence
		// and require one of them to be the recruiter redirect.
		const blocks: string[] = [];
		for (
			let i = appSource.indexOf('path="profile"');
			i !== -1;
			i = appSource.indexOf('path="profile"', i + 1)
		) {
			blocks.push(appSource.slice(i, i + 400));
		}
		expect(blocks.length).toBeGreaterThan(0);
		expect(
			blocks.some((b) => b.includes('<Navigate to="/recruiter/company" replace />')),
		).toBe(true);
	});

	it('header profile link points recruiters at /recruiter/company', () => {
		expect(headerSource).toContain("isRecruiter ? '/recruiter/company' : '/candidate/profile'");
		expect(headerSource).not.toContain("'/recruiter/profile'");
	});

	it('no file under client/src renders the invented company', () => {
		const offenders = walk(srcDir)
			.filter((file) => file !== __filename)
			.filter((file) => /\.(ts|tsx)$/.test(file))
			.filter((file) => readFileSync(file, 'utf8').includes(INVENTED_COMPANY));
		expect(offenders).toEqual([]);
	});
});
