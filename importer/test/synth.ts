import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

process.env.CLAUDE_CTX_SCRATCH ??= '/private/tmp/:/tmp/';

const made: string[] = [];

export function removeScratch(): void {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

process.on('exit', removeScratch);

export function scratch(name: string): string {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), `claude-ctx-${name}-`));
  made.push(dir);
  return dir;
}

export function makeRepo(dir: string, remote?: string): string {
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  const cfg = remote ? `[core]\n\tbare = false\n[remote "origin"]\n\turl = ${remote}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n` : '[core]\n\tbare = false\n';
  fs.writeFileSync(path.join(dir, '.git', 'config'), cfg);
  return dir;
}

export function projectDirName(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-');
}

export interface Usage {
  input?: number;
  read?: number;
  write?: number;
  out?: number;
}

export class Transcript {
  id: string;
  cwd: string;
  branch = 'main';
  lines: string[] = [];
  clock: number;
  last: string | null = null;
  file: string;

  constructor(claudeDir: string, cwd: string, opts: { id?: string; start?: number } = {}) {
    this.id = opts.id ?? randomUUID();
    this.cwd = cwd;
    this.clock = opts.start ?? Date.parse('2026-11-01T10:00:00Z');
    const dir = path.join(claudeDir, 'projects', projectDirName(cwd));
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, `${this.id}.jsonl`);
  }

  ts(): string {
    this.clock += 7000;
    return new Date(this.clock).toISOString();
  }

  base(extra: Record<string, unknown>): Record<string, unknown> {
    const uuid = randomUUID();
    const r = {
      parentUuid: this.last,
      isSidechain: false,
      userType: 'external',
      cwd: this.cwd,
      sessionId: this.id,
      version: '2.1.330',
      gitBranch: this.branch,
      uuid,
      timestamp: this.ts(),
      ...extra,
    };
    this.last = uuid;
    return r;
  }

  push(r: Record<string, unknown>): string {
    this.lines.push(JSON.stringify(r));
    return String(r.uuid ?? '');
  }

  prompt(text: string, cwd?: string): string {
    if (cwd) this.cwd = cwd;
    return this.push(this.base({ type: 'user', message: { role: 'user', content: text }, promptSource: 'typed', origin: { kind: 'human' } }));
  }

  meta(text: string): string {
    return this.push(this.base({ type: 'user', isMeta: true, message: { role: 'user', content: text } }));
  }

  notification(text: string): string {
    return this.push(this.base({ type: 'user', message: { role: 'user', content: `<task-notification>${text}</task-notification>` }, promptSource: 'system', origin: { kind: 'task-notification' } }));
  }

  reply(text: string, u: Usage = {}, msgId?: string): string {
    return this.push(this.base({ type: 'assistant', message: this.msg([{ type: 'text', text }], u, msgId) }));
  }

  msg(content: unknown[], u: Usage, msgId?: string): Record<string, unknown> {
    return {
      id: msgId ?? `msg_${randomUUID().slice(0, 12)}`,
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5',
      content,
      stop_reason: 'end_turn',
      usage: {
        input_tokens: u.input ?? 6,
        cache_creation_input_tokens: u.write ?? 0,
        cache_read_input_tokens: u.read ?? 0,
        output_tokens: u.out ?? 40,
      },
    };
  }

  tool(name: string, input: Record<string, unknown>, result: string, u: Usage = {}, extra: Record<string, unknown> = {}): { use: string; result: string; toolId: string } {
    const toolId = `toolu_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const use = this.push(this.base({ type: 'assistant', message: this.msg([{ type: 'tool_use', id: toolId, name, input }], u) }));
    const res = this.push(
      this.base({
        type: 'user',
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolId, content: result }] },
        toolUseResult: { stdout: result, ...extra },
        sourceToolAssistantUUID: use,
      }),
    );
    return { use, result: res, toolId };
  }

  edit(file: string, u: Usage = {}): void {
    this.tool('Edit', { file_path: file, old_string: 'a', new_string: 'b' }, 'The file has been updated.', u, { filePath: file });
  }

  write(file: string, content: string, u: Usage = {}): void {
    this.tool('Write', { file_path: file, content }, 'File created.', u, { filePath: file });
  }

  read(file: string, content: string, u: Usage = {}): { use: string; result: string } {
    return this.tool('Read', { file_path: file }, content, u, { file: { filePath: file } });
  }

  bash(command: string, output: string, u: Usage = {}): { use: string; result: string } {
    return this.tool('Bash', { command, description: 'run' }, output, u);
  }

  title(text: string): void {
    this.push({ type: 'ai-title', aiTitle: text, sessionId: this.id });
  }

  attachment(attachment: Record<string, unknown>, rendered?: string): string {
    return this.push(this.base({ type: 'attachment', attachment, ...(rendered ? { rendered: [{ content: rendered }], renderedRole: 'system' } : {}) }));
  }

  shape(system: unknown[], tools: unknown[]): void {
    this.push({ type: 'api-request-shape', sessionId: this.id, shape: { system, tools }, shapeHash: randomUUID(), timestamp: this.ts(), version: 1 });
  }

  compact(pre: number, post: number, preserved: string[], summary: string, trigger = 'auto'): { boundary: string; summary: string } {
    const boundary = this.push(
      this.base({
        type: 'system',
        subtype: 'compact_boundary',
        content: 'Conversation compacted',
        isMeta: false,
        level: 'info',
        logicalParentUuid: this.last,
        compactMetadata: {
          trigger,
          preTokens: pre,
          postTokens: post,
          durationMs: 1000,
          preservedSegment: { headUuid: preserved[0] ?? '', anchorUuid: preserved[0] ?? '', tailUuid: preserved[preserved.length - 1] ?? '' },
          preservedMessages: { anchorUuid: preserved[0] ?? '', uuids: preserved, allUuids: preserved },
          cumulativeDroppedTokens: pre - post,
        },
      }),
    );
    const s = this.push(
      this.base({
        type: 'user',
        isCompactSummary: true,
        isVisibleInTranscriptOnly: true,
        message: {
          role: 'user',
          content: `This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n\nSummary:\n${summary}\n\nIf you need specific details from before compaction, read the full transcript at: /x.jsonl`,
        },
      }),
    );
    return { boundary, summary: s };
  }

  noise(): void {
    this.push({ type: 'queue-operation', operation: 'enqueue', sessionId: this.id, timestamp: this.ts() });
    this.push({ type: 'mode', mode: 'normal', sessionId: this.id });
    this.push({ type: 'future-record-kind', sessionId: this.id, data: { x: 1 } });
  }

  save(): string {
    fs.writeFileSync(this.file, this.lines.map((l) => l + '\n').join(''));
    return this.file;
  }

  append(): string {
    fs.writeFileSync(this.file, this.lines.map((l) => l + '\n').join(''));
    return this.file;
  }
}
