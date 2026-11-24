import fs from 'node:fs';

export interface Line {
  text: string;
  start: number;
  end: number;
}

export async function* readLines(file: string, from = 0, to?: number): AsyncGenerator<Line> {
  let size: number;
  try {
    size = fs.statSync(file).size;
  } catch {
    return;
  }
  const stop = to == null ? size : Math.min(size, to);
  if (from >= stop) return;
  const stream = fs.createReadStream(file, { start: from, end: stop - 1, highWaterMark: 1 << 20 });
  let parts: Buffer[] = [];
  let partsLen = 0;
  let lineStart = from;
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    let pos = 0;
    while (pos < chunk.length) {
      const nl = chunk.indexOf(10, pos);
      if (nl === -1) {
        parts.push(chunk.subarray(pos));
        partsLen += chunk.length - pos;
        break;
      }
      const piece = chunk.subarray(pos, nl);
      let buf: Buffer;
      if (partsLen) {
        parts.push(piece);
        buf = Buffer.concat(parts, partsLen + piece.length);
        parts = [];
        partsLen = 0;
      } else {
        buf = piece;
      }
      const end = lineStart + buf.length + 1;
      yield { text: buf.toString('utf8'), start: lineStart, end };
      lineStart = end;
      pos = nl + 1;
    }
  }
}
