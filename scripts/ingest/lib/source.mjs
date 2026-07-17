/**
 * source.mjs — load a paper's text for extraction. Prefers open-access full text
 * (Europe PMC) when a PMID/DOI is given; falls back to a local file (PDF via
 * pdftotext, or .xml/.txt). Open-access XML is cleaner and cheaper than PDF OCR.
 */
import { readFile } from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
const run = promisify(execFile);

function stripTags(s) {
  return s.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Try Europe PMC open-access full-text XML for a PMID. Returns text or null. */
export async function europePmcFullText(pmid) {
  try {
    const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/PMC/${pmid}/fullTextXML`;
    // PMID → PMCID first.
    const s = await fetch(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:${pmid}&resultType=core&format=json`);
    if (!s.ok) return null;
    const j = await s.json();
    const pmcid = j.resultList?.result?.[0]?.pmcid;
    if (!pmcid) return null;
    const ft = await fetch(`https://www.ebi.ac.uk/europepmc/webservices/rest/${pmcid}/fullTextXML`);
    if (!ft.ok) return null;
    return stripTags(await ft.text());
  } catch {
    return null;
  }
}

/** Load a local source file: .pdf (needs pdftotext), .xml/.html, or .txt. */
export async function localFile(path) {
  if (/\.pdf$/i.test(path)) {
    try {
      const { stdout } = await run('pdftotext', ['-layout', path, '-']);
      return stdout;
    } catch (e) {
      throw new Error(`pdftotext failed (install poppler-utils): ${e.message}`);
    }
  }
  const raw = await readFile(path, 'utf8');
  return /\.(xml|html?)$/i.test(path) ? stripTags(raw) : raw;
}

/** Resolve a gold-set `source` descriptor to paper text. */
export async function loadSource(source) {
  if (!source) return null;
  if (source.file) return localFile(source.file);
  if (source.pmid) {
    const t = await europePmcFullText(source.pmid);
    if (t) return t;
  }
  return null;
}
