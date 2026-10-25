/**
 * #1354: public surfaces must not claim achieved SOC 2 Type II
 * compliance. No certification exists; the truthful statement —
 * already used on the landing Security section — is
 * "SOC 2 Type II in progress". Login/register claimed
 * "SOC 2 Type II compliant" and privacy claimed compliant
 * infrastructure providers.
 *
 * Source guard in the LandingHonestClaims / AboutHonestClaims
 * pattern. Also guards the /signup -> /register redirect added
 * in the same fix (/signup previously 404'd; real route is
 * /register).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => fs.readFileSync(path.join(__dirname, rel), 'utf8');

const login = read('../../pages/login.tsx');
const register = read('../../pages/register.tsx');
const privacy = read('../../pages/privacy.tsx');
const landing = read('../../pages/landing.tsx');
const app = read('../../App.tsx');

const SURFACES: Array<[string, string]> = [
	['login.tsx', login],
	['register.tsx', register],
	['privacy.tsx', privacy],
	['landing.tsx', landing],
];

describe('SOC 2 claims honesty (#1354)', () => {
	it.each(SURFACES)('%s does not claim achieved SOC 2 Type II compliance', (_name, source) => {
		expect(source).not.toContain('SOC 2 Type II compliant');
		expect(source).not.toMatch(/soc 2 type ii compliant/i);
	});

	it.each([
		['login.tsx', login],
		['register.tsx', register],
		['landing.tsx', landing],
	])('%s states the truthful in-progress wording', (_name, source) => {
		expect(source).toContain('SOC 2 Type II in progress');
	});

	it('App routes /signup to the real /register route', () => {
		expect(app).toContain('path="/signup"');
		expect(app).toMatch(/to=\{`\/register\$\{search\}`\}|to="\/register"/);
	});
});
