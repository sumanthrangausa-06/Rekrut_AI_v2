/**
 * FS-144 (#1099) — public dead ends guard.
 *
 * Two dishonest surfaces, both verified first-hand on dev @ 1dd1d4f6f:
 *  1. The authenticated dashboard footer linked Privacy / Terms / Help Center
 *     to href="#" — dead ends — although /privacy and /terms routes exist.
 *  2. The public contact form "sent" nothing: handleSubmit validated, fired an
 *     analytics event and showed "Message sent" without any delivery. Per the
 *     story AC (remove-branch, team decision on #1099 STOP 1), the form is
 *     removed; the honest mailto path stays.
 *
 * Source-scan guard in the style of the other honesty guards: it fails if
 * either dead end is reintroduced.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const layout = fs.readFileSync(
	path.join(root, 'client/src/components/layout/dashboard-layout.tsx'),
	'utf8',
);
const contact = fs.readFileSync(path.join(root, 'client/src/pages/contact.tsx'), 'utf8');

describe('FS-144 dashboard footer links resolve to real routes', () => {
	test('dashboard layout contains no href="#" dead links', () => {
		expect(layout).not.toMatch(/href="#"/);
	});

	test('Privacy links to the real /privacy route', () => {
		expect(layout).toMatch(/to="\/privacy"/);
	});

	test('Terms links to the real /terms route', () => {
		expect(layout).toMatch(/to="\/terms"/);
	});

	test('Help Center links to the real /contact page', () => {
		expect(layout).toMatch(/to="\/contact"/);
	});
});

describe('FS-144 contact page has no fake-send form', () => {
	test('no <form> element remains on the contact page', () => {
		expect(contact).not.toMatch(/<form[\s>]/);
	});

	test('no fake submitted/success state remains', () => {
		expect(contact).not.toMatch(/setSubmitted\(true\)/);
		expect(contact).not.toMatch(/Message sent/);
	});

	test('the honest mailto contact path is present', () => {
		expect(contact).toMatch(/mailto:hello@rekrutai\.co/);
	});
});
