import { describe, expect, it } from 'vitest';
import { formatJobSalary, hasJobSalary } from '@/lib/salary';

// #2061 — follow-up to the #2059 / PR #2060 independent review.
// A whitespace-only salary_range ("   ") was truthy under the shared
// formatter's verbatim contract, so it counted as present and rendered
// as an empty-looking fragment (job-detail meta: "Salary:  .").
// Contract: a range that trims to empty counts as ABSENT everywhere —
// formatJobSalary falls through to the numeric bounds or the honest
// "Salary not specified", and hasJobSalary returns false. A real range
// with padding renders trimmed-verbatim (inner content unchanged).

describe('#2061 whitespace-only salary_range counts as absent', () => {
	it('whitespace-only range + INR min/max: renders the ₹ range, not blanks', () => {
		const job = { salary_range: '   ', salary_min: '800000.00', salary_max: '1200000.00', currency_code: 'INR' };
		expect(hasJobSalary(job)).toBe(true);
		const out = formatJobSalary(job);
		expect(out).toContain('₹');
		expect(out.replace(/[^0-9]/g, '')).toContain('800000');
		expect(out.replace(/[^0-9]/g, '')).toContain('1200000');
	});

	it('whitespace-only range + no numeric salary: honest "Salary not specified"', () => {
		const job = { salary_range: '   ', currency_code: 'USD' };
		expect(formatJobSalary(job)).toBe('Salary not specified');
	});

	it('whitespace-only range alone: hasJobSalary is false', () => {
		expect(hasJobSalary({ salary_range: '   ' })).toBe(false);
	});

	it('tab/newline-only range counts as absent too', () => {
		const job = { salary_range: '\t\n ', salary_min: '90000.00', currency_code: 'USD' };
		expect(formatJobSalary(job)).toContain('$90,000');
		expect(hasJobSalary({ salary_range: '\t\n ' })).toBe(false);
	});

	it('padded real text renders trimmed-verbatim (inner content unchanged)', () => {
		expect(formatJobSalary({ salary_range: '  ₹8–12 LPA  ', currency_code: 'INR' })).toBe('₹8–12 LPA');
	});

	// Guards — already true on base, must stay true.
	it('guard: plain text range still renders verbatim', () => {
		expect(formatJobSalary({ salary_range: '₹8–12 LPA', currency_code: 'INR' })).toBe('₹8–12 LPA');
		expect(hasJobSalary({ salary_range: '₹8–12 LPA' })).toBe(true);
	});

	it('guard: empty-string range + USD min-only still renders the $ figure', () => {
		const job = { salary_range: '', salary_min: '90000.00', currency_code: 'USD' };
		expect(formatJobSalary(job)).toContain('$90,000');
	});

	it('guard: null range + nothing still reads as no salary', () => {
		expect(formatJobSalary({ salary_range: null })).toBe('Salary not specified');
		expect(hasJobSalary({ salary_range: null })).toBe(false);
	});
});
