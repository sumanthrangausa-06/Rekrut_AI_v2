/**
 * #1476 — lib/pdf-extract corpus + copy-semantics tests.
 *
 * pdf-parse 1.1.4 (pdf.js v1.10.100) fails 'bad XRef entry' on valid PDFs
 * whose bytes arrive as a pooled Node Buffer slice (byteOffset != 0).
 * lib/pdf-extract hands pdf-parse a standalone bounded Uint8Array COPY.
 * These tests use the REAL pdf-parse (no mocks — a mocked parser proves
 * nothing about this defect) over the §5 corpus fixtures. Corpus outcomes
 * for F3 (reportlab) and F4 (genuine xref-stream) were MEASURED on
 * 2026-10-19: both extract in bounded form (see issue #1476 red/green
 * matrix comments), so they are asserted as extracting.
 */
const fs = require('fs');
const path = require('path');
const { parsePdf, extractPdfText, toBoundedCopy } = require('../../../lib/pdf-extract');

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'pdf-extract-1476');
const load = (name) => fs.readFileSync(path.join(FIXTURE_DIR, name));

describe('toBoundedCopy (#1476)', () => {
	test('returns a standalone Uint8Array whose ArrayBuffer is exactly the file length', () => {
		const pooled = load('F2-fpdf2-small.pdf');
		const copy = toBoundedCopy(pooled);
		expect(copy).toBeInstanceOf(Uint8Array);
		expect(Buffer.isBuffer(copy)).toBe(false);
		expect(copy.byteOffset).toBe(0);
		expect(copy.buffer.byteLength).toBe(pooled.length);
		expect(copy.length).toBe(pooled.length);
		expect(Buffer.from(copy).equals(pooled)).toBe(true);
	});

	test('copy does not alias the source pool (mutating the source does not leak in)', () => {
		const pooled = load('F2-fpdf2-small.pdf');
		const copy = toBoundedCopy(pooled);
		const before = copy[10];
		pooled[10] = before === 0 ? 1 : 0;
		expect(copy[10]).toBe(before);
	});

	test('rejects non-binary input', () => {
		expect(() => toBoundedCopy('not a buffer')).toThrow(TypeError);
		expect(() => toBoundedCopy(null)).toThrow(TypeError);
	});
});

describe('pdf-extract corpus (#1476 §5)', () => {
	// fs.readFileSync buffers for these small files are pooled slices
	// (byteOffset != 0) — the exact input form that failed on pristine dev.
	const EXTRACTS = [
		['F1-libreoffice.pdf', 1000], // LibreOffice 24.2, classic xref
		['F2-fpdf2-small.pdf', 1000], // fpdf2 1,699 B — failed in-app via multer
		['F3-reportlab.pdf', 1000], // reportlab train-2 fixture — measured: extracts bounded
		['F4-xref-stream.pdf', 1000], // genuine xref stream + object streams — measured: extracts bounded
		['F5-fpdf2-large.pdf', 20000], // offset-0 control — passed before, must still pass
		['F6-chrome-print.pdf', 300], // Chromium print-to-PDF (Skia/PDF)
	];

	test.each(EXTRACTS)('%s extracts >= %i chars from a pooled fs buffer', async (name, min) => {
		const text = await extractPdfText(load(name));
		expect(text.length).toBeGreaterThanOrEqual(min);
		expect(text).toMatch(/QUINN TEST CANDIDATE|Quinn Test Resume/);
	});

	test('F7 corrupt PDF fails honestly (throws, no fabricated text)', async () => {
		await expect(extractPdfText(load('F7-corrupt.pdf'))).rejects.toThrow();
	});

	test('parsePdf returns metadata for the document-verification seam (F3 producer)', async () => {
		const data = await parsePdf(load('F3-reportlab.pdf'));
		expect(data.info).toBeDefined();
		expect(String(data.info.Producer || '')).toMatch(/ReportLab/i);
		expect(data.text.length).toBeGreaterThanOrEqual(1000);
	});
});
