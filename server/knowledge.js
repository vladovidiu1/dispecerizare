import { randomUUID, createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { transaction } from "./db.js";
const fail = (status, message) => Object.assign(new Error(message), { status });
const stop = new Set(
  "este sunt pentru acest aceasta care fost unui unei din prin sau mail email buna ziua salut multumesc va rog avem avem atasat solicitare problema".split(
    " ",
  ),
);
export function searchTerms(text, limit = 40) {
  return [
    ...new Set(
      (text.toLowerCase().match(/[\p{L}\p{N}_-]{3,40}/gu) || []).filter(
        (t) => !stop.has(t),
      ),
    ),
  ].slice(0, limit);
}
export function createKnowledge(
  db,
  { dataDir = process.env.RELAY_DATA_DIR || ".relay" } = {},
) {
  async function add(org, filename, buffer) {
    if (
      buffer.length > 20_000_000 ||
      buffer.subarray(0, 5).toString() !== "%PDF-"
    )
      throw fail(400, "Este necesar un PDF de maximum 20 MB.");
    const hash = createHash("sha256").update(buffer).digest("hex");
    if (
      (
        await db.query(
          "SELECT id FROM knowledge_documents WHERE organization_id=$1 AND sha256=$2",
          [org, hash],
        )
      ).rowCount
    )
      return { duplicate: true };
    let pdf, loading;
    const chunks = [];
    let chars = 0,
      pages = 0;
    try {
      loading = getDocument({
        data: new Uint8Array(buffer),
        standardFontDataUrl: fileURLToPath(
          new URL(
            "./standard_fonts/",
            import.meta.resolve("pdfjs-dist/package.json"),
          ),
        ).replaceAll("\\", "/"),
        isEvalSupported: false,
        useSystemFonts: false,
        disableFontFace: true,
        stopAtErrors: true,
      });
      pdf = await loading.promise;
      pages = pdf.numPages;
      if (pdf.numPages > 500)
        throw fail(
          400,
          "PDF-ul depășește limita de 500 pagini. Împarte documentul.",
        );
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        const content = await page.getTextContent();
        const body = content.items
          .map((i) => i.str + (i.hasEOL ? "\n" : " "))
          .join("")
          .trim();
        chars += body.length;
        if (chars > 800_000)
          throw fail(400, "PDF-ul conține prea mult text. Împarte documentul.");
        for (let i = 0; i < body.length; i += 1800)
          chunks.push({ page: n, body: body.slice(i, i + 2200) });
        page.cleanup();
      }
    } catch (e) {
      if (e.status) throw e;
      throw fail(
        400,
        "PDF-ul nu poate fi citit. Verifică dacă este valid și fără parolă.",
      );
    } finally {
      await loading?.destroy();
    }
    if (chars < 40)
      throw fail(
        400,
        "PDF fără text suficient. Pentru documente scanate este necesar OCR înainte de import.",
      );
    return transaction(db, async (c) => {
      const id = randomUUID();
      const inserted = await c.query(
        "INSERT INTO knowledge_documents(id,organization_id,filename,title,sha256,content) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(organization_id,sha256) DO NOTHING",
        [id, org, filename, filename.replace(/\.pdf$/i, ""), hash, buffer],
      );
      if (!inserted.rowCount) return { duplicate: true };
      for (const chunk of chunks)
        await c.query(
          "INSERT INTO knowledge_chunks(id,organization_id,document_id,page,body) VALUES($1,$2,$3,$4,$5)",
          [randomUUID(), org, id, chunk.page, chunk.body],
        );
      return { id, pages, chunks: chunks.length };
    });
  }
  return {
    add,
    async list(org) {
      return (
        await db.query(
          `SELECT d.id,d.filename,d.title,d.created_at AS "createdAt",count(c.id)::int AS chunks FROM knowledge_documents d LEFT JOIN knowledge_chunks c ON c.document_id=d.id WHERE d.organization_id=$1 GROUP BY d.id ORDER BY d.created_at DESC`,
          [org],
        )
      ).rows;
    },
    async remove(org, id) {
      await db.query(
        "DELETE FROM knowledge_documents WHERE id=$1 AND organization_id=$2",
        [id, org],
      );
      return { ok: true };
    },
    async scan(org) {
      const folder = resolve(dataDir, "itl", org);
      await mkdir(folder, { recursive: true });
      const result = {
        imported: 0,
        duplicates: 0,
        errors: [],
        folder: "itl/" + org,
      };
      const files = (await readdir(folder, { withFileTypes: true })).filter(
        (f) => f.isFile() && /\.pdf$/i.test(f.name),
      );
      if (files.length > 100)
        throw fail(400, "Maximum 100 PDF-uri la o indexare.");
      for (const f of files) {
        try {
          const path = join(folder, f.name);
          if ((await stat(path)).size > 20_000_000)
            throw fail(400, "PDF peste 20 MB");
          const r = await add(org, f.name, await readFile(path));
          r.duplicate ? result.duplicates++ : result.imported++;
        } catch (e) {
          result.errors.push({
            filename: f.name,
            error: e.status ? e.message : "Document indisponibil",
          });
        }
      }
      return result;
    },
    async match(org, m) {
      const terms = searchTerms(m.subject + " " + m.body.slice(0, 5000));
      if (!terms.length) return [];
      const query = terms
        .map((t) => "'" + t.replace(/'/g, "") + "'")
        .join(" | ");
      const rows = (
        await db.query(
          `SELECT c.id,c.document_id AS "documentId",d.title,c.page,c.body,ts_rank_cd(to_tsvector('simple',c.body),to_tsquery('simple',$2)) AS score FROM knowledge_chunks c JOIN knowledge_documents d ON d.id=c.document_id WHERE c.organization_id=$1 AND to_tsvector('simple',c.body) @@ to_tsquery('simple',$2) ORDER BY score DESC,c.page LIMIT 12`,
          [org, query],
        )
      ).rows;
      return rows
        .filter((c) => {
          const words = new Set(searchTerms(c.body, 1000));
          return terms.filter((t) => words.has(t)).length >= 2;
        })
        .slice(0, 3);
    },
    async document(org, id) {
      return (
        await db.query(
          "SELECT filename,content FROM knowledge_documents WHERE organization_id=$1 AND id=$2",
          [org, id],
        )
      ).rows[0];
    },
  };
}
