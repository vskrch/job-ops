import { inflateRawSync } from "node:zlib";

const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50;

function readUInt16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUInt32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  );
}

function parseZipEntries(buffer: Uint8Array): Map<string, Uint8Array> {
  const entries = new Map<string, Uint8Array>();

  const searchStart = Math.max(0, buffer.length - 22 - 65535);
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= searchStart; i--) {
    if (readUInt32(buffer, i) === ZIP_EOCD_SIGNATURE) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error("Invalid xlsx: ZIP end-of-central-directory not found");
  }

  const entryCount = readUInt16(buffer, eocdOffset + 10);
  let cursor = readUInt32(buffer, eocdOffset + 16);

  for (let i = 0; i < entryCount; i++) {
    if (readUInt32(buffer, cursor) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error("Invalid xlsx: corrupt central directory entry");
    }
    const method = readUInt16(buffer, cursor + 10);
    const compressedSize = readUInt32(buffer, cursor + 20);
    const nameLength = readUInt16(buffer, cursor + 28);
    const extraLength = readUInt16(buffer, cursor + 30);
    const commentLength = readUInt16(buffer, cursor + 32);
    const localOffset = readUInt32(buffer, cursor + 42);
    const name = new TextDecoder("utf-8").decode(
      buffer.subarray(cursor + 46, cursor + 46 + nameLength),
    );

    if (readUInt32(buffer, localOffset) !== ZIP_LOCAL_FILE_SIGNATURE) {
      throw new Error("Invalid xlsx: corrupt local file header");
    }
    const localNameLength = readUInt16(buffer, localOffset + 26);
    const localExtraLength = readUInt16(buffer, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);

    let data: Uint8Array;
    if (method === 0) {
      data = raw;
    } else if (method === 8) {
      data = inflateRawSync(raw);
    } else {
      throw new Error(`Invalid xlsx: unsupported compression method ${method}`);
    }

    entries.set(name, data);
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_match, dec: string) =>
      String.fromCodePoint(Number.parseInt(dec, 10)),
    )
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  const siPattern = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  const textPattern = /<t\b[^>]*>([\s\S]*?)<\/t>/g;

  for (const siMatch of xml.matchAll(siPattern)) {
    let value = "";
    for (const textMatch of siMatch[1].matchAll(textPattern)) {
      value += decodeXmlEntities(textMatch[1]);
    }
    strings.push(value);
  }

  return strings;
}

function columnIndexToNumber(column: string): number {
  let index = 0;
  for (const char of column) {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return index - 1;
}

/**
 * Minimal XLSX reader for workbooks that use a shared-strings table and a
 * single data sheet (`xl/worksheets/sheet1.xml`). Returns rows as arrays of
 * cell values (strings or numbers), padded with empty strings for gaps.
 */
export function parseXlsxFirstSheet(buffer: Uint8Array): (string | number)[][] {
  const entries = parseZipEntries(buffer);

  const sharedStringsEntry = entries.get("xl/sharedStrings.xml");
  const sharedStrings = sharedStringsEntry
    ? parseSharedStrings(new TextDecoder("utf-8").decode(sharedStringsEntry))
    : [];

  const sheetEntry = entries.get("xl/worksheets/sheet1.xml");
  if (!sheetEntry) {
    throw new Error("Invalid xlsx: sheet1 not found in workbook");
  }

  const xml = new TextDecoder("utf-8").decode(sheetEntry);
  const rows: (string | number)[][] = [];
  const rowPattern = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  const cellPattern = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;

  for (const rowMatch of xml.matchAll(rowPattern)) {
    const cells: (string | number)[] = [];

    for (const cellMatch of rowMatch[1].matchAll(cellPattern)) {
      const attributes = cellMatch[1];
      const reference = /r="([A-Z]+)\d+"/.exec(attributes);
      const column = reference
        ? columnIndexToNumber(reference[1])
        : cells.length;
      const typeMatch = /t="([^"]+)"/.exec(attributes);
      const cellType = typeMatch?.[1] ?? "n";
      const inner = cellMatch[2] ?? "";
      const valuePattern = /<v>([\s\S]*?)<\/v>/.exec(inner);

      let value: string | number = "";
      if (cellType === "s") {
        const index = valuePattern ? Number(valuePattern[1]) : NaN;
        value = Number.isInteger(index) ? (sharedStrings[index] ?? "") : "";
      } else if (cellType === "inlineStr") {
        const inlineText = /<t\b[^>]*>([\s\S]*?)<\/t>/.exec(inner);
        value = inlineText ? decodeXmlEntities(inlineText[1]) : "";
      } else if (valuePattern) {
        const raw = valuePattern[1].trim();
        value = raw === "" ? "" : Number(raw);
      }

      while (cells.length < column) {
        cells.push("");
      }
      cells.push(value);
    }

    rows.push(cells);
  }

  return rows;
}
