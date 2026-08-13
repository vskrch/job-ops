/**
 * Standalone PDF text extractor, spawned as a child process by
 * `resume-parser.ts`. Keeps the memory-heavy pdf.js parse out of the web
 * server process: on the constrained production container this spike was
 * enough to crash the dyno (Heroku R14 -> V8 OOM).
 */

import { readFileSync } from "node:fs";
import { PDFParse } from "pdf-parse";

const MAX_PAGES = 6;
const MAX_TEXT_CHARS = 60_000;

const filePath = process.argv[2];
if (!filePath) {
  process.stdout.write(JSON.stringify({ ok: false, error: "no input file" }));
  process.exit(0);
}

try {
  const buffer = readFileSync(filePath);
  // TypedArray views are transferred to pdf-parse's worker (no main-thread
  // copy). The buffer from readFileSync owns its backing store.
  const data = new Uint8Array(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength,
  );
  const parser = new PDFParse({ data });
  // Cap the parse to the first MAX_PAGES pages so pathological PDFs cannot
  // balloon memory.
  const result = await parser.getText({ first: MAX_PAGES });
  await parser.destroy();
  process.stdout.write(
    JSON.stringify({ ok: true, text: result.text.slice(0, MAX_TEXT_CHARS) }),
  );
} catch (error) {
  const message = error instanceof Error ? error.message : "PDF parse failed";
  process.stdout.write(
    JSON.stringify({ ok: false, error: message.slice(0, 500) }),
  );
}
