// #1634: the Job Board's JobFilterBar sends company-size BUCKET labels
// (startup/small/medium/large), while companies.company_size stores
// RANGES (the recruiter company form's select: 1-10, 11-50, 51-200,
// 201-500, 501-1000, 1001-5000, 5001+). Exact equality between a bucket
// label and a stored range can never match, so every company-size
// selection returned zero jobs. Translate buckets to their range sets
// server-side; a value that is not a bucket (e.g. a raw stored range
// from another caller) returns null and keeps exact-match behaviour.
//
// Bucket boundaries follow the JobFilterBar labels exactly:
//   startup "Startup (1-50)"  -> 1-10, 11-50
//   small   "Small (51-200)"  -> 51-200
//   medium  "Medium (201-1000)" -> 201-500, 501-1000
//   large   "Large (1000+)"   -> 1001-5000, 5001+, 1000+
// The '1000+' entry is a real stored value, not a typo: the candidate
// company-profile form offers a single '1000+' option instead of the
// recruiter form's 1001-5000/5001+ split (#1634 follow-up BLOCK — a
// '1000+' company originally matched no bucket at all).
const COMPANY_SIZE_BUCKETS = {
	startup: ['1-10', '11-50'],
	small: ['51-200'],
	medium: ['201-500', '501-1000'],
	large: ['1001-5000', '5001+', '1000+'],
};

function companySizeRanges(value) {
	if (typeof value !== 'string') return null;
	return COMPANY_SIZE_BUCKETS[value] || null;
}

module.exports = { COMPANY_SIZE_BUCKETS, companySizeRanges };
