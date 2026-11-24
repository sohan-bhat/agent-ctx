import { readLines } from './lines.ts';
import { compactSummaryText, editPaths, isCompactBoundary, parseLine, promptText, titleOf, UNDERSTOOD, usageOf } from './records.ts';
import { listTranscripts } from './update.ts';

export interface DoctorReport {
  transcripts: number;
  bytes: number;
  lines: number;
  unreadable: number;
  understood: Record<string, number>;
  skipped: Record<string, number>;
  checks: {
    replies: number;
    usage: number;
    compactions: number;
    compactionsWithTokens: number;
    summaries: number;
    titles: number;
    prompts: number;
    edits: number;
    shapes: number;
  };
  ms: number;
}

export async function doctor(claude: string, onFile?: (i: number, n: number) => void): Promise<DoctorReport> {
  const t0 = Date.now();
  const files = listTranscripts(claude);
  const rep: DoctorReport = {
    transcripts: files.length,
    bytes: files.reduce((a, f) => a + f.size, 0),
    lines: 0,
    unreadable: 0,
    understood: {},
    skipped: {},
    checks: { replies: 0, usage: 0, compactions: 0, compactionsWithTokens: 0, summaries: 0, titles: 0, prompts: 0, edits: 0, shapes: 0 },
    ms: 0,
  };
  const inc = (o: Record<string, number>, k: string) => (o[k] = (o[k] || 0) + 1);
  let i = 0;
  for (const f of files) {
    onFile?.(i++, files.length);
    for await (const line of readLines(f.transcript)) {
      if (!line.text) continue;
      rep.lines++;
      const r = parseLine(line.text);
      if (!r) {
        rep.unreadable++;
        continue;
      }
      const type = typeof r.type === 'string' ? r.type : '(none)';
      const key = type === 'system' && typeof r.subtype === 'string' ? `system/${r.subtype}` : type;
      if (UNDERSTOOD.has(type)) inc(rep.understood, key);
      else inc(rep.skipped, key);
      if (type === 'assistant') {
        rep.checks.replies++;
        if (usageOf(r)) rep.checks.usage++;
        rep.checks.edits += editPaths(r).length;
      } else if (isCompactBoundary(r)) {
        rep.checks.compactions++;
        const m = r.compactMetadata;
        if (m && typeof m.preTokens === 'number' && typeof m.postTokens === 'number') rep.checks.compactionsWithTokens++;
      } else if (compactSummaryText(r)) rep.checks.summaries++;
      else if (titleOf(r)) rep.checks.titles++;
      else if (promptText(r)) rep.checks.prompts++;
      else if (type === 'api-request-shape' && r.shape && Array.isArray(r.shape.system)) rep.checks.shapes++;
    }
  }
  rep.ms = Date.now() - t0;
  return rep;
}
