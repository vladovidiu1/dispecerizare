import ExcelJS from "exceljs";
import yauzl from "yauzl";
const fail = (message) => Object.assign(new Error(message), { status: 400 });
async function inspectZip(buffer) {
  if (buffer.length > 10_000_000) throw fail("Excel peste 10 MB.");
  await new Promise((resolve, reject) =>
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(fail("Fișier XLSX invalid."));
      let size = 0,
        count = 0;
      zip.on("error", () => reject(fail("Arhivă XLSX invalidă.")));
      zip.on("entry", (e) => {
        size += e.uncompressedSize;
        count++;
        if (size > 40_000_000 || count > 2000) {
          zip.close();
          reject(fail("Excel prea mare după decomprimare."));
        } else zip.readEntry();
      });
      zip.on("end", resolve);
      zip.readEntry();
    }),
  );
}
export function cellText(cell) {
  const v = cell.value;
  if (v == null) return "";
  if (typeof v === "object") {
    if ("formula" in v || "sharedFormula" in v) return "";
    if (v.richText) return v.richText.map((t) => t.text).join("");
    if (v instanceof Date) return v.toISOString();
    return String(v.text || "");
  }
  return String(v).trim();
}
export async function readWorkbook(buffer) {
  await inspectZip(buffer);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw fail("Fișier XLSX invalid sau protejat.");
  }
  if (
    workbook.worksheets.some((s) => s.rowCount > 10000 || s.columnCount > 100)
  )
    throw fail("Maximum 10.000 rânduri și 100 coloane per foaie.");
  return workbook;
}
export function rowsFromSheet(workbook, rule) {
  const sheet = workbook.getWorksheet(rule.sheetName);
  if (!sheet) throw fail("Foaia configurată nu există în Excel.");
  const headers = [];
  sheet
    .getRow(rule.headerRow)
    .eachCell((cell, n) => headers.push({ name: cellText(cell), index: n }));
  const matches = headers.filter((h) => h.name === rule.codeColumn);
  if (matches.length !== 1)
    throw fail("Coloana codului lipsește sau apare de mai multe ori.");
  const rows = [];
  for (let n = rule.headerRow + 1; n <= sheet.rowCount; n++) {
    const row = sheet.getRow(n);
    const code = cellText(row.getCell(matches[0].index)).toUpperCase().trim();
    if (!code) continue;
    rows.push({
      row: n,
      code,
      body: headers
        .map(
          (h) => `${h.name}: ${cellText(row.getCell(h.index)).slice(0, 2000)}`,
        )
        .join("\n")
        .slice(0, 20000),
    });
  }
  return rows;
}
