/**
 * S-096 / #820 — candidate Kanban truthfulness.
 *
 * Before: drag-end called PUT /candidate/applications/:id/status with a
 * recruiter-owned status (COLUMN_STATUS_MAP), and STATUS_TO_COLUMN had no
 * rejected/withdrawn entry, so terminal applications silently rendered
 * under `applied` via the `|| 'applied'` fallback.
 *
 * After: drag is board-local (no status API write from the board), and
 * rejected/withdrawn map to an explicit `closed` column.
 */
import fs from 'fs';
import path from 'path';
import { describe, expect, test } from 'vitest';

describe('candidate applications Kanban (#820)', () => {
	const pageSource = fs.readFileSync(
		path.join(__dirname, '../../pages/candidate/applications.tsx'),
		'utf8',
	);
	const columnSource = fs.readFileSync(
		path.join(__dirname, '../../components/candidate/kanban-column.tsx'),
		'utf8',
	);

	test('drag no longer writes a status to the server', () => {
		expect(pageSource).not.toMatch(/applications\/\$\{app\.id\}\/status/);
		expect(pageSource).not.toContain('COLUMN_STATUS_MAP');
	});

	test('terminal states map to an explicit closed column, never the applied fallback', () => {
		expect(pageSource).toMatch(/rejected:\s*'closed'/);
		expect(pageSource).toMatch(/withdrawn:\s*'closed'/);
		expect(pageSource).not.toMatch(/\|\|\s*'applied'/);
	});

	test('the board defines a closed column for terminal applications', () => {
		expect(columnSource).toMatch(/id:\s*'closed'/);
	});
});
