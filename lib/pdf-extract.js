// Shared PDF extraction seam (#1476).
//
// pdf-parse 1.1.4 hands the caller's object straight to pdf.js v1.10.100,
// whose xref reader misreads offsets when the bytes live inside a larger
// pooled ArrayBuffer (Node Buffers for small files are slices of a 64 KB
// pool at byteOffset != 0 — fs.readFileSync results and multer's assembled
// upload buffers alike). Valid PDFs then fail with 'bad XRef entry'.
// A plain Buffer.from(buf) copy does NOT fix it: small Buffer copies
// re-pool. The proven fix is to hand pdf-parse a standalone Uint8Array
// COPY — a fresh ArrayBuffer whose byteLength equals the file length
// (Rex, STOP 1 §5b: copy, not a view, so no aliasing of the caller's pool).
const pdfParse = require('pdf-parse');

function toBoundedCopy(buffer) {
	if (!(buffer instanceof Uint8Array)) {
		throw new TypeError('pdf-extract: expected a Buffer or Uint8Array');
	}
	// Uint8Array.from copies element-by-element into a fresh ArrayBuffer
	// with byteLength === buffer.length, regardless of the source's
	// byteOffset or pool size.
	return Uint8Array.from(buffer);
}

async function parsePdf(buffer) {
	return pdfParse(toBoundedCopy(buffer));
}

async function extractPdfText(buffer) {
	const data = await parsePdf(buffer);
	return data.text || '';
}

module.exports = { parsePdf, extractPdfText, toBoundedCopy };
