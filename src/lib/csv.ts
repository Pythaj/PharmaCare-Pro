/**
 * Minimal, dependency-free CSV helpers (single source of truth — Rule 18).
 *
 * Parses RFC-4180-style CSV (quoted fields, escaped quotes, embedded newlines,
 * BOM stripping) into array-of-objects keyed by normalized headers, and
 * serializes objects back into CSV for template downloads.
 */

/** Normalizes a header cell to a stable key: lower-case, no surrounding spaces. */
export function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

/** Splits a single CSV line into cells, honoring double-quoted segments. */
function splitLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

/**
 * Parses CSV text into an array of records keyed by normalized header.
 * Blank lines are ignored. Rows with fewer cells than the header are padded.
 */
export function parseCSV(text: string): Record<string, string>[] {
  const cleaned = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = cleaned.split('\n');
  const records: Record<string, string>[] = [];

  let headerCells: string[] | null = null;
  let i = 0;

  while (i < lines.length) {
    let line = lines[i];
    i++;

    // A CSV row continues onto following lines whenever quotes are unbalanced
    // (i.e. a quoted field contains an embedded newline).
    let quoteCount = (line.match(/"/g) ?? []).length;
    while (quoteCount % 2 !== 0 && i < lines.length) {
      line += '\n' + lines[i];
      i++;
      quoteCount = (line.match(/"/g) ?? []).length;
    }

    if (line.trim() === '') continue;

    const cells = splitLine(line);

    if (!headerCells) {
      headerCells = cells;
      if (headerCells.every((h) => h.trim() === '')) {
        headerCells = null;
      }
      continue;
    }

    const record: Record<string, string> = {};
    headerCells.forEach((headerName, index) => {
      record[normalizeHeader(headerName)] = (cells[index] ?? '').trim();
    });
    records.push(record);
  }

  return records;
}

/** Quotes a single value for CSV output when necessary. */
function quoteCell(value: string): string {
  if (/[",\n]/.test(value)) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

/**
 * Serializes an array of objects into CSV, using the given column order.
 * Any keys not listed in `order` are appended after the listed columns.
 */
export function toCSV(rows: Record<string, string | number | null | undefined>[], order: string[]): string {
  const allKeys = order.slice();
  rows.forEach((row) => {
    Object.keys(row).forEach((key) => {
      if (!allKeys.includes(key)) allKeys.push(key);
    });
  });

  const lines: string[] = [allKeys.map(quoteCell).join(',')];
  rows.forEach((row) => {
    lines.push(
      allKeys
        .map((key) => quoteCell(row[key] === undefined || row[key] === null ? '' : String(row[key])))
        .join(',')
    );
  });
  return lines.join('\n');
}

/** Downloads a string as a text file from the browser (anchor click). */
export function downloadText(filename: string, content: string, mime = 'text/csv'): void {
  const blob = new Blob([content], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Starter template for category bulk imports. */
export const CATEGORY_CSV_TEMPLATE = [
  'name,description',
  'Analgesics,Pain relief medicines',
  'Antibiotics,Antibacterial agents',
  'Vitamins & Supplements,Dietary supplements',
  'Antihistamines,Allergy relief medicines',
  'Diabetes Care,Glucose monitors and supplies',
].join('\n');

/** Starter template for product (item) bulk imports. */
export const PRODUCT_CSV_TEMPLATE = [
  'name,genericName,category,unit,reorderLevel,defaultCostPrice,defaultSellingPrice,batchNumber,quantity,costPrice,sellingPrice,expiryDate',
  'Paracetamol 500mg,Acetaminophen,Analgesics,tablets,50,2.50,5.00,PCM-2301,200,2.50,5.00,2027-12-31',
  'Amoxicillin 250mg,Amoxicillin,Antibiotics,capsules,30,8.00,15.00,AMX-1102,120,8.00,15.00,2027-06-30',
  'Vitamin C 1000mg,Ascorbic Acid,Vitamins & Supplements,tablets,40,12.00,25.00,VITC-881,80,12.00,25.00,2028-01-31',
].join('\n');