/**
 * C1: Frontend kanban stages must match backend PIPELINE_STAGES exactly.
 *
 * Backend (routes/recruiter.js PIPELINE_STAGES + chk_job_applications_status via p4):
 *   applied, screening, shortlisted, reviewing, interviewed, offered, hired, rejected, withdrawn
 *
 * All three layers (DB constraint, backend, frontend) must have the identical 9-stage list.
 */
import fs from 'fs';
import path from 'path';

const BACKEND_STAGES = [
	'applied',
	'screening',
	'shortlisted',
	'reviewing',
	'interviewed',
	'offered',
	'hired',
	'rejected',
	'withdrawn',
];

function extractArray(source: string, varName: string): string[] {
	const match = source.match(
		new RegExp(`const ${varName} = \\[([\\s\\S]*?)\\];`)
	);
	if (!match) throw new Error(`${varName} not found in source`);
	return match[1]
		.split(',')
		.map((s) => s.trim().replace(/['"]/g, ''))
		.filter(Boolean);
}

describe('job-applicants stage alignment', () => {
	const source = fs.readFileSync(
		path.join(__dirname, '../../pages/recruiter/job-applicants.tsx'),
		'utf8'
	);

	test('kanbanStages matches backend PIPELINE_STAGES exactly', () => {
		const kanbanStages = extractArray(source, 'kanbanStages');
		expect(kanbanStages).toEqual(BACKEND_STAGES);
	});

	test('statuses array matches backend PIPELINE_STAGES exactly', () => {
		const statuses = extractArray(source, 'statuses');
		expect(statuses).toEqual(BACKEND_STAGES);
	});

	test('includes shortlisted/reviewing per p4 DB constraint', () => {
		// These stages are in chk_job_applications_status (migration p4) and must be supported
		const kanbanStages = extractArray(source, 'kanbanStages');
		const statuses = extractArray(source, 'statuses');
		expect(kanbanStages).toContain('shortlisted');
		expect(kanbanStages).toContain('reviewing');
		expect(statuses).toContain('shortlisted');
		expect(statuses).toContain('reviewing');
	});
});
