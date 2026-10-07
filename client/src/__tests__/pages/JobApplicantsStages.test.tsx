/**
 * C1: Frontend kanban stages must match backend PIPELINE_STAGES exactly.
 *
 * Backend (routes/recruiter.js PIPELINE_STAGES + chk_job_applications_status):
 *   applied, screening, interviewed, offered, hired, rejected, withdrawn
 *
 * RED: frontend kanbanStages includes 'shortlisted'/'reviewing' (invalid per DB constraint)
 * GREEN: frontend matches backend exactly.
 */
import fs from 'fs';
import path from 'path';

const BACKEND_STAGES = [
	'applied',
	'screening',
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

	test('does not reference invalid stages shortlisted/reviewing', () => {
		// These stages violate the chk_job_applications_status CHECK constraint
		const kanbanStages = extractArray(source, 'kanbanStages');
		const statuses = extractArray(source, 'statuses');
		expect(kanbanStages).not.toContain('shortlisted');
		expect(kanbanStages).not.toContain('reviewing');
		expect(statuses).not.toContain('shortlisted');
		expect(statuses).not.toContain('reviewing');
	});
});
