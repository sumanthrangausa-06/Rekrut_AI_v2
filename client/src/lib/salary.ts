// FS-013 (#1019) — the single salary entry→display formatter.
//
// The salary a recruiter enters is the salary a candidate sees: same
// amount, same currency, on every surface (list, detail, public detail,
// saved, applications). Before this module each surface hand-rolled its
// own formatting — most hard-coded USD/$ and dropped the currency_code
// the API already returns, so an INR job displayed as dollars.
//
// Contract:
// - salary_range text entered by the recruiter renders verbatim.
// - min+max renders "¤X - ¤Y" in the entered currency.
// - min-only renders "¤X+"; max-only renders "Up to ¤X" (a bare figure
//   would read as a fixed salary).
// - no salary renders "Salary not specified" — never an invented figure
//   or an ungrounded label.
// Amounts arrive from the API as numbers or numeric strings
// ("150000.00"); both are coerced. 0 / non-numeric counts as absent,
// matching the surfaces' historic truthiness semantics.

export interface JobSalaryFields {
	salary_min?: number | string | null;
	salary_max?: number | string | null;
	salary_range?: string | null;
	currency_code?: string | null;
}

export function toAmount(value: number | string | null | undefined): number | null {
	if (value == null || value === '') return null;
	const n = Number(value);
	return Number.isFinite(n) && n > 0 ? n : null;
}

export function formatJobSalary(
	job: JobSalaryFields,
	opts?: { period?: 'year' | 'month' | 'hour' },
): string {
	if (job.salary_range) return job.salary_range;

	const min = toAmount(job.salary_min);
	const max = toAmount(job.salary_max);
	if (min == null && max == null) return 'Salary not specified';

	const currency = (job.currency_code || 'USD').toUpperCase();
	let fmt: Intl.NumberFormat;
	try {
		fmt = new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
			style: 'currency',
			currency,
			maximumFractionDigits: 0,
		});
	} catch {
		fmt = new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency: 'USD',
			maximumFractionDigits: 0,
		});
	}

	const suffix = opts?.period === 'month' ? '/mo' : opts?.period === 'hour' ? '/hr' : opts?.period === 'year' ? '/yr' : '';
	if (min != null && max != null) return `${fmt.format(min)} - ${fmt.format(max)}${suffix}`;
	if (min != null) return `${fmt.format(min)}+${suffix}`;
	return `Up to ${fmt.format(max ?? 0)}${suffix}`;
}

export function hasJobSalary(job: JobSalaryFields): boolean {
	return Boolean(job.salary_range) || toAmount(job.salary_min) != null || toAmount(job.salary_max) != null;
}
