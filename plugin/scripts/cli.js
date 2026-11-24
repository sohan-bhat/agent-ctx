#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/core/paths.ts
import os from "node:os";
import path from "node:path";
function claudeDir(env = process.env) {
  const v = env.CLAUDE_CONFIG_DIR;
  return v ? path.resolve(v) : path.join(os.homedir(), ".claude");
}
function ctxHome(env = process.env) {
  const v = env.CLAUDE_CTX_HOME;
  return v ? path.resolve(v) : path.join(os.homedir(), ".claude-ctx");
}
function store(home3 = ctxHome()) {
  const j = (p) => path.join(home3, p);
  return {
    home: home3,
    cards: j("cards.jsonl"),
    index: j("index.json"),
    queue: j("queue.jsonl"),
    pins: j("pins.jsonl"),
    log: j("claude-ctx.log"),
    sessions: j("sessions"),
    pending: j("pending.jsonl"),
    lock: j("lock"),
    seen: j("seen"),
    last: j("last-hook.json"),
    trace: j("worker-trace.log")
  };
}
function projectsDir(dir = claudeDir()) {
  return path.join(dir, "projects");
}
function scratchRoots() {
  const env = process.env.CLAUDE_CTX_SCRATCH ?? "";
  if (tmpRoots && env === tmpKey) return tmpRoots;
  tmpKey = env;
  if (env) {
    tmpRoots = env.split(":").filter(Boolean).map((r) => r.endsWith("/") ? r : r + "/");
    return tmpRoots;
  }
  const roots = /* @__PURE__ */ new Set(["/tmp/", "/private/tmp/", "/var/folders/", "/private/var/folders/"]);
  try {
    roots.add(path.resolve(os.tmpdir()) + "/");
  } catch {
  }
  tmpRoots = [...roots];
  return tmpRoots;
}
function isScratchPath(p, claude = claudeDir()) {
  if (p.startsWith(claude + "/")) return true;
  return scratchRoots().some((r) => p.startsWith(r));
}
var tmpRoots, tmpKey;
var init_paths = __esm({
  "src/core/paths.ts"() {
    "use strict";
    tmpRoots = null;
    tmpKey = "";
  }
});

// src/core/limits.ts
function budgetBytes(env = process.env) {
  const v = Number(env.CLAUDE_CTX_BUDGET_MB);
  return Math.round((v > 0 ? v : DEFAULT_BUDGET_MB) * MB);
}
function shares(budget = budgetBytes()) {
  return {
    log: Math.min(LOG_MAX, Math.floor(budget * 0.02)),
    cards: Math.floor(budget * 0.3),
    sessions: Math.floor(budget * 0.3)
  };
}
var WORKER_LIMIT_MS, MB, DEFAULT_BUDGET_MB, LOG_MAX;
var init_limits = __esm({
  "src/core/limits.ts"() {
    "use strict";
    WORKER_LIMIT_MS = 3e4;
    MB = 1e6;
    DEFAULT_BUDGET_MB = 50;
    LOG_MAX = 256 * 1024;
  }
});

// src/core/fsx.ts
import fs from "node:fs";
import path2 from "node:path";
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}
function atomicWrite(file, data) {
  ensureDir(path2.dirname(file));
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {
    }
    throw e;
  }
}
function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}
function readJson(file) {
  const t = readText(file);
  if (t == null) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}
function readJsonl(file) {
  const t = readText(file);
  if (!t) return [];
  const out2 = [];
  for (const line of t.split("\n")) {
    if (!line.trim()) continue;
    try {
      out2.push(JSON.parse(line));
    } catch {
    }
  }
  return out2;
}
function writeJsonl(file, rows) {
  atomicWrite(file, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
}
function logError(logFile, where, err) {
  try {
    ensureDir(path2.dirname(logFile));
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    const line = `${(/* @__PURE__ */ new Date()).toISOString()} ${where} ${msg.replace(/\s+/g, " ").slice(0, 500)}
`;
    fs.appendFileSync(logFile, line);
    cutFile(logFile, shares().log);
  } catch {
  }
}
function cutFile(file, max) {
  let size = 0;
  try {
    size = fs.statSync(file).size;
  } catch {
    return false;
  }
  if (size <= max) return false;
  const keep = Math.floor(max / 2);
  const buf = Buffer.alloc(keep);
  const fd = fs.openSync(file, "r");
  try {
    fs.readSync(fd, buf, 0, keep, size - keep);
  } finally {
    fs.closeSync(fd);
  }
  const nl = buf.indexOf(10);
  atomicWrite(file, nl >= 0 && nl < buf.length - 1 ? buf.subarray(nl + 1) : buf);
  return true;
}
var init_fsx = __esm({
  "src/core/fsx.ts"() {
    "use strict";
    init_limits();
  }
});

// src/core/bm25.ts
function buildBm25(docs) {
  const terms = /* @__PURE__ */ Object.create(null);
  const dl = [];
  let total = 0;
  docs.forEach((toks, i) => {
    dl.push(toks.length);
    total += toks.length;
    const tf = /* @__PURE__ */ new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    for (const [t, n] of tf) {
      let p = terms[t];
      if (!p) p = terms[t] = [];
      p.push(i, n);
    }
  });
  return { n: docs.length, avgdl: docs.length ? total / docs.length : 0, dl, terms };
}
function bucketOf(term, buckets) {
  let h = 2166136261;
  for (let i = 0; i < term.length; i++) {
    h ^= term.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % buckets;
}
function idf(n, df) {
  return Math.log(1 + (n - df + 0.5) / (df + 0.5));
}
function search(data, query, weights) {
  const q = /* @__PURE__ */ new Map();
  for (const t of query) q.set(t, (q.get(t) || 0) + (weights?.get(t) ?? 1));
  const n = data.n;
  const acc = new Float64Array(n);
  const hit = new Uint16Array(n);
  const touched = [];
  const avg = data.avgdl || 1;
  const dl = data.dl;
  let max = 0;
  for (const [t, qw] of q) {
    const p = data.get(t);
    if (!p) continue;
    const df = p.length / 2;
    if (n >= 20 && df / n > COMMON) continue;
    const w = idf(n, df) * qw;
    max += w * (K1 + 1);
    for (let i = 0; i < p.length; i += 2) {
      const doc = p[i];
      const tf = p[i + 1];
      const s = w * tf * (K1 + 1) / (tf + K1 * (1 - B + B * dl[doc] / avg));
      if (hit[doc] === 0) touched.push(doc);
      acc[doc] += s;
      hit[doc]++;
    }
  }
  const out2 = [];
  for (const doc of touched) out2.push({ doc, score: acc[doc], norm: max ? acc[doc] / max : 0, matched: hit[doc] });
  out2.sort((a, b) => b.score - a.score);
  return out2;
}
var K1, B, COMMON;
var init_bm25 = __esm({
  "src/core/bm25.ts"() {
    "use strict";
    K1 = 1.2;
    B = 0.75;
    COMMON = 0.5;
  }
});

// src/core/text.ts
function stem(w) {
  if (w.length <= 3) return w;
  if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y";
  if (w.endsWith("sses")) return w.slice(0, -2);
  if (w.endsWith("ing") && w.length > 5) return w.slice(0, -3);
  if (w.endsWith("ed") && w.length > 4 && !w.endsWith("eed")) return w.slice(0, -2);
  if (w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us") && !w.endsWith("is")) return w.slice(0, -1);
  return w;
}
function tokens(text) {
  if (!text) return [];
  const spaced = text.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  const out2 = [];
  for (const raw of spaced.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 2 || raw.length > 30) continue;
    if (/^\d+$/.test(raw) && raw.length > 4) continue;
    if (STOP.has(raw)) continue;
    out2.push(stem(raw));
  }
  return out2;
}
function fileTokens(file) {
  const parts = file.split("/").filter(Boolean);
  const base = parts[parts.length - 1] ?? "";
  const parent = parts[parts.length - 2] ?? "";
  const name = base.replace(/\.[a-z0-9]{1,6}$/i, "");
  return [...tokens(name), ...tokens(parent)];
}
var STOP;
var init_text = __esm({
  "src/core/text.ts"() {
    "use strict";
    STOP = new Set(
      "a an and are as at be been but by can could did do does doing done for from had has have having he her here hers him his how i if in into is it its just me more most my no nor not of off on once only or other our ours out over own same she should so some such than that the their them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours also about after again all am any because before below between both each few further let lets like make made need needs now ok okay please pls really get got go going want wants thing things way yes yeah sure still even every much many one two use used using new see look able sorry thanks thank right well back down same try tried src lib index util utils component components".split(" ")
    );
  }
});

// src/core/store.ts
import fs2 from "node:fs";
import path3 from "node:path";
function termsFile(st, name) {
  return path3.join(path3.dirname(st.index), path3.basename(name));
}
function cardTokens(c) {
  const out2 = [];
  const title = tokens(c.title || "");
  for (let i = 0; i < 3; i++) out2.push(...title);
  const proj = tokens(c.project);
  out2.push(...proj, ...proj);
  for (const s of c.summaries) out2.push(...tokens(s));
  if (c.firstPrompt) out2.push(...tokens(c.firstPrompt));
  for (const p of c.prompts) out2.push(...tokens(p));
  for (const f of c.files) {
    const ft = fileTokens(f);
    out2.push(...ft, ...ft);
  }
  return out2;
}
function loadCards(st) {
  return readJsonl(st.cards);
}
function writeCardsAndIndex(st, all, maxBytes = shares().cards) {
  all.sort((a, b) => (b.last || "").localeCompare(a.last || ""));
  const docs = [];
  const parts = [];
  const cards = [];
  let off = 0;
  for (const c of all) {
    const line = JSON.stringify(c) + "\n";
    const len = Buffer.byteLength(line);
    if (off + len > maxBytes && cards.length) break;
    cards.push(c);
    docs.push({
      id: c.id,
      s: c.session,
      o: off,
      l: len - 1,
      t: Date.parse(c.last || c.first || "") || 0,
      p: c.place,
      g: c.git ? 1 : 0,
      r: c.remote,
      n: c.project,
      d: 0
    });
    parts.push(line);
    off += len;
  }
  const body = parts.join("");
  atomicWrite(st.cards, body);
  const bm = buildBm25(cards.map(cardTokens));
  bm.dl.forEach((v, i) => docs[i].d = v);
  const nterms = Object.keys(bm.terms).length;
  const buckets = Math.max(64, 1 << Math.ceil(Math.log2(Math.max(1, nterms / 12))));
  const groups = Array.from({ length: buckets }, () => ({}));
  for (const t in bm.terms) groups[bucketOf(t, buckets)][t] = bm.terms[t];
  const offsets = [0];
  const lines = [];
  let at = 0;
  for (const g of groups) {
    const line = JSON.stringify(g) + "\n";
    lines.push(line);
    at += Buffer.byteLength(line);
    offsets.push(at);
  }
  const terms = `terms-${Date.now().toString(36)}${process.pid.toString(36)}.jsonl`;
  atomicWrite(termsFile(st, terms), lines.join(""));
  const file = { v: 2, terms, built: (/* @__PURE__ */ new Date()).toISOString(), size: Buffer.byteLength(body), n: bm.n, avgdl: bm.avgdl, buckets, offsets, docs };
  atomicWrite(st.index, JSON.stringify(file));
  try {
    for (const f of fs2.readdirSync(st.home)) if (/^terms-.*\.jsonl$/.test(f) && f !== terms) fs2.rmSync(path3.join(st.home, f), { force: true });
  } catch {
  }
  return attach(st, file);
}
function attach(st, file) {
  const dl = file.docs.map((d) => d.d);
  const cache = /* @__PURE__ */ new Map();
  let fd = null;
  const bucket = (b) => {
    let g = cache.get(b);
    if (g) return g;
    g = {};
    try {
      fd ??= fs2.openSync(termsFile(st, file.terms), "r");
      const len = file.offsets[b + 1] - file.offsets[b];
      const buf = Buffer.alloc(len);
      fs2.readSync(fd, buf, 0, len, file.offsets[b]);
      g = JSON.parse(buf.toString("utf8"));
    } catch {
    }
    cache.set(b, g);
    return g;
  };
  const bm25 = {
    n: file.n,
    avgdl: file.avgdl,
    dl,
    get: (t) => {
      const g = bucket(bucketOf(t, file.buckets));
      return Object.prototype.hasOwnProperty.call(g, t) ? g[t] : void 0;
    }
  };
  return { ...file, bm25 };
}
function loadIndex(st) {
  const ix = readJson(st.index);
  if (!ix || ix.v !== 2 || !Array.isArray(ix.docs) || !Array.isArray(ix.offsets)) return null;
  return attach(st, ix);
}
function readCards(st, ix, docIdx) {
  const out2 = [];
  let fd;
  try {
    fd = fs2.openSync(st.cards, "r");
  } catch {
    return out2;
  }
  try {
    let all = null;
    for (const i of docIdx) {
      const d = ix.docs[i];
      if (!d) continue;
      let card = null;
      try {
        const buf = Buffer.alloc(d.l);
        fs2.readSync(fd, buf, 0, d.l, d.o);
        const c = JSON.parse(buf.toString("utf8"));
        if (c.id === d.id) card = c;
      } catch {
      }
      if (!card) {
        all ??= loadCards(st);
        card = all.find((c) => c.id === d.id) ?? null;
      }
      if (card) out2.push(card);
    }
  } finally {
    fs2.closeSync(fd);
  }
  return out2;
}
function sessionFile(st, id) {
  return path3.join(st.sessions, id.replace(/[^A-Za-z0-9_-]/g, "_") + ".json");
}
function loadSession(st, id) {
  const s = readJson(sessionFile(st, id));
  return s && s.v === 2 ? s : null;
}
function saveSession(st, s) {
  ensureDir(st.sessions);
  atomicWrite(sessionFile(st, s.id), JSON.stringify(s));
}
function upsertCards(existing, session, fresh) {
  return [...existing.filter((c) => c.session !== session), ...fresh];
}
var init_store = __esm({
  "src/core/store.ts"() {
    "use strict";
    init_fsx();
    init_bm25();
    init_text();
    init_limits();
  }
});

// src/core/place.ts
import fs3 from "node:fs";
import os2 from "node:os";
import path4 from "node:path";
function hasMarker(dir) {
  for (const m of MARKERS) if (exists(path4.join(dir, m))) return true;
  return false;
}
function markerRoot(dir) {
  const visited = [];
  let d = path4.resolve(dir);
  let found = null;
  for (; ; ) {
    const c = rootCache.get(d);
    if (c !== void 0) {
      found = c;
      break;
    }
    visited.push(d);
    if (d === home || d === "/") break;
    if (hasMarker(d)) {
      found = d;
      break;
    }
    const up = path4.dirname(d);
    if (up === d) break;
    d = up;
  }
  for (const v of visited) rootCache.set(v, found);
  return found;
}
function gitTop(dir) {
  const start2 = path4.resolve(dir);
  const visited = [];
  let d = start2;
  let found = null;
  for (; ; ) {
    const c = topCache.get(d);
    if (c !== void 0) {
      found = c;
      break;
    }
    visited.push(d);
    if (d !== home && d !== "/" && exists(path4.join(d, ".git"))) {
      found = d;
      break;
    }
    const up = path4.dirname(d);
    if (up === d) break;
    d = up;
  }
  for (const v of visited) topCache.set(v, found);
  return found;
}
function exists(p) {
  try {
    fs3.statSync(p);
    return true;
  } catch {
    return false;
  }
}
function placeOfDir(cwd) {
  const top2 = gitTop(cwd);
  if (top2) return { path: top2, git: true };
  const root = markerRoot(cwd);
  return { path: root ?? path4.resolve(cwd), git: false };
}
function guessRoot(file, base) {
  const rel = path4.relative(base, file).split("/").filter(Boolean);
  if (rel.length <= 1 || rel[0] === "..") return base;
  let i = 0;
  while (i < rel.length - 2 && CONTAINERS.has(rel[i].toLowerCase())) i++;
  if (GENERIC.has(rel[i].toLowerCase())) return path4.join(base, ...rel.slice(0, i));
  return path4.join(base, ...rel.slice(0, i + 1));
}
function placeOfFile(file, cwd) {
  const dir = path4.dirname(file);
  const top2 = gitTop(dir);
  if (top2) return { path: top2, git: true };
  const root = markerRoot(dir);
  if (root) return { path: root, git: false };
  if (cwd && cwd !== "/" && file.startsWith(cwd + "/")) {
    const c = placeOfDir(cwd);
    if (c.git || c.path !== path4.resolve(cwd)) return c;
    const container = c.path === home || CONTAINERS.has(path4.basename(c.path).toLowerCase());
    return { path: container ? guessRoot(file, c.path) : c.path, git: false };
  }
  if (file.startsWith(home + "/")) return { path: guessRoot(file, home), git: false };
  return { path: dir, git: false };
}
function gitDir(top2) {
  const g = path4.join(top2, ".git");
  try {
    const st = fs3.statSync(g);
    if (st.isDirectory()) return g;
    const t = fs3.readFileSync(g, "utf8");
    const m = t.match(/gitdir:\s*(.+)/);
    if (!m) return null;
    const wt = path4.resolve(top2, m[1].trim());
    try {
      const common = fs3.readFileSync(path4.join(wt, "commondir"), "utf8").trim();
      return path4.resolve(wt, common);
    } catch {
      return wt;
    }
  } catch {
    return null;
  }
}
function remoteOf(top2) {
  const gd = gitDir(top2);
  if (!gd) return null;
  let cfg;
  try {
    cfg = fs3.readFileSync(path4.join(gd, "config"), "utf8");
  } catch {
    return null;
  }
  const sections = cfg.split(/^\[/m);
  let url = null;
  for (const s of sections) {
    const head = s.match(/^remote\s+"([^"]+)"\]/);
    if (!head) continue;
    const u = s.match(/^\s*url\s*=\s*(.+)$/m);
    if (!u) continue;
    if (head[1] === "origin" || url == null) url = u[1].trim();
    if (head[1] === "origin") break;
  }
  return url ? remoteName(url) : null;
}
function remoteName(url) {
  const u = url.replace(/\.git\/?$/, "").replace(/\/+$/, "");
  const m = u.match(/[:/]([^/:]+)\/([^/:]+)$/);
  if (!m) return null;
  return `${m[1]}/${m[2]}`.toLowerCase();
}
var topCache, rootCache, home, MARKERS, CONTAINERS, GENERIC;
var init_place = __esm({
  "src/core/place.ts"() {
    "use strict";
    topCache = /* @__PURE__ */ new Map();
    rootCache = /* @__PURE__ */ new Map();
    home = path4.resolve(os2.homedir());
    MARKERS = [
      "package.json",
      "Cargo.toml",
      "pyproject.toml",
      "setup.py",
      "go.mod",
      "Gemfile",
      "pom.xml",
      "build.gradle",
      "build.gradle.kts",
      "Package.swift",
      "deno.json",
      "composer.json",
      "mix.exs",
      "CMakeLists.txt"
    ];
    CONTAINERS = new Set(
      "code projects project repos repositories repo work dev developer development workspace workspaces sites apps packages documents desktop downloads github gitlab git ml labs lab experiments sandbox playground clients oss personal school archive extras practice".split(" ")
    );
    GENERIC = new Set(
      "src source lib app web test tests spec docs doc public components scripts pages assets styles server client bin cmd internal pkg include examples static config".split(" ")
    );
  }
});

// src/core/records.ts
function parseLine(text) {
  if (!text || text.charCodeAt(0) !== 123) return null;
  try {
    const r = JSON.parse(text);
    return r && typeof r === "object" && !Array.isArray(r) ? r : null;
  } catch {
    return null;
  }
}
function contentBlocks(r) {
  const c = r?.message?.content;
  if (Array.isArray(c)) return c;
  if (typeof c === "string") return [{ type: "text", text: c }];
  return [];
}
function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const out2 = [];
  for (const b of content) {
    if (typeof b === "string") out2.push(b);
    else if (b && typeof b === "object") {
      if (typeof b.text === "string") out2.push(b.text);
      else if (b.type === "tool_result") out2.push(textOf(b.content));
    }
  }
  return out2.join("\n");
}
function promptText(r) {
  if (r.type !== "user" || r.isMeta || r.isCompactSummary || r.isSidechain) return null;
  const c = r.message?.content;
  let text;
  if (typeof c === "string") text = c;
  else if (Array.isArray(c)) {
    if (c.some((b) => b && b.type === "tool_result")) return null;
    text = c.filter((b) => b && b.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n");
  } else return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (/^<[a-z][a-z0-9-]*>/.test(trimmed)) return null;
  const kind = r.origin?.kind;
  const src = r.promptSource;
  const human = kind === "human" || src && HUMAN_SOURCES.has(src);
  if (!human) {
    if (kind || src) return null;
    if (/^\[Request interrupted/i.test(trimmed)) return null;
  }
  const clean = trimmed.replace(/\[Image #\d+\]/g, "").replace(/\s+/g, " ").trim();
  return clean || null;
}
function isToolResultLine(text) {
  return text.includes('"sourceToolAssistantUUID"') && !text.includes('"isCompactSummary":true');
}
function mayHaveEdit(text) {
  return text.includes('"name":"Edit"') || text.includes('"name":"Write"') || text.includes('"name":"MultiEdit"') || text.includes('"name":"NotebookEdit"');
}
function editPaths(r) {
  if (r.type !== "assistant") return [];
  const out2 = [];
  for (const b of contentBlocks(r)) {
    if (!b || b.type !== "tool_use" || !EDIT_TOOLS.has(b.name)) continue;
    const p = b.input?.file_path ?? b.input?.notebook_path;
    if (typeof p === "string" && p.startsWith("/")) out2.push(p);
  }
  return out2;
}
function usageOf(r) {
  const u = r?.message?.usage;
  if (!u || typeof u !== "object") return null;
  const n = (v) => typeof v === "number" && Number.isFinite(v) ? v : 0;
  if (typeof u.input_tokens !== "number") return null;
  const input = n(u.input_tokens);
  const cacheRead = n(u.cache_read_input_tokens);
  const cacheWrite = n(u.cache_creation_input_tokens);
  return { input, cacheRead, cacheWrite, output: n(u.output_tokens), total: input + cacheRead + cacheWrite };
}
function isCompactBoundary(r) {
  return r.type === "system" && r.subtype === "compact_boundary";
}
function compactSummaryText(r) {
  if (r.type !== "user" || !r.isCompactSummary) return null;
  const t = textOf(r.message?.content);
  return t || null;
}
function stripMarkup(text) {
  let s = text.replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/\\u003c/gi, "<").replace(/\\u003e/gi, ">").replace(/\\([<>])/g, "$1");
  s = s.replace(/<analysis>[\s\S]*?(?:<\/analysis>|$)/gi, " ");
  const m = s.match(/<summary>([\s\S]*?)(?:<\/summary>|$)/i);
  if (m) s = m[1];
  s = s.replace(HARNESS_BLOCK, " ").replace(HARNESS_OPEN, " ").replace(ANY_TAG, " ");
  return s.split(PIECES).filter((p) => !BOILER.test(p)).join("");
}
function tidy(s) {
  return s.replace(/\s+/g, " ").replace(/^[\s\-*•:;,.]+/, "").replace(/(?:\s[-*•])+\s*$/, "").trim();
}
function cleanSummary(raw) {
  const s = stripMarkup(raw);
  const parts = [];
  for (const m of s.matchAll(HEADINGS)) parts.push({ head: m[1].toLowerCase(), at: m.index ?? 0, body: (m.index ?? 0) + m[0].length });
  if (!parts.length) return tidy(s);
  const section = (name) => {
    const i = parts.findIndex((p) => p.head === name);
    return i < 0 ? "" : tidy(s.slice(parts[i].body, i + 1 < parts.length ? parts[i + 1].at : s.length));
  };
  const lead = tidy(s.slice(0, parts[0].at));
  const first = section("primary request and intent") || lead || section("summary");
  const now = section("current work");
  return [first, now].filter(Boolean).join(" ").trim();
}
function summaryLine(text, max = 160) {
  const s = cleanSummary(text);
  if (!s) return "";
  const end = s.slice(30, max + 1).search(/[.!?](?:\s|$)/);
  return end >= 0 ? s.slice(0, 30 + end + 1) : cut(s, max);
}
function titleOf(r) {
  if (r.type === "ai-title" && typeof r.aiTitle === "string") return { ai: r.aiTitle };
  if (r.type === "custom-title" && typeof r.customTitle === "string") return { custom: r.customTitle };
  if (r.type === "summary" && typeof r.summary === "string") return { ai: r.summary };
  return null;
}
function cut(s, n) {
  if (s.length <= n) return s;
  const sl = s.slice(0, n);
  const sp = sl.lastIndexOf(" ");
  return (sp > n * 0.6 ? sl.slice(0, sp) : sl).trimEnd() + "\u2026";
}
var UNDERSTOOD, HUMAN_SOURCES, EDIT_TOOLS, HARNESS_BLOCK, HARNESS_OPEN, ANY_TAG, HEADINGS, BOILER, PIECES;
var init_records = __esm({
  "src/core/records.ts"() {
    "use strict";
    UNDERSTOOD = /* @__PURE__ */ new Set([
      "user",
      "assistant",
      "system",
      "attachment",
      "ai-title",
      "custom-title",
      "summary",
      "last-prompt",
      "api-request-shape"
    ]);
    HUMAN_SOURCES = /* @__PURE__ */ new Set(["typed", "queued", "suggestion_accepted", "sdk"]);
    EDIT_TOOLS = /* @__PURE__ */ new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
    HARNESS_BLOCK = /<([a-z][a-z0-9]*(?:[-_][a-z0-9]+)+)(?:\s[^<>]*)?>[\s\S]*?<\/\1\s*>/gi;
    HARNESS_OPEN = /<\/?[a-z][a-z0-9]*(?:[-_][a-z0-9]+)+(?:\s[^<>]*)?\/?>[^\n]*/gi;
    ANY_TAG = /<\/?[a-zA-Z][^<>\n]{0,200}>/g;
    HEADINGS = /(?:^|\s)(?:\d{1,2}\.\s*)?(Primary Request and Intent|Key Technical Concepts|Files and Code Sections|Errors and Fixes|Problem Solving|All User Messages|Pending Tasks|Current Work|Optional Next Step|Summary|Analysis)\s*:/gi;
    BOILER = /continued from a previous conversation|summary below covers|conversation is summarized below|read the full transcript at|please continue the conversation|continue with the last task|called the \w+ tool|result of calling the \w+ tool|tools used/i;
    PIECES = /(?<=[.!?])(?=\s)|(?<=\n)/;
  }
});

// src/core/format.ts
import os3 from "node:os";
function tilde(p) {
  return p === home2 ? "~" : p.startsWith(home2 + "/") ? "~" + p.slice(home2.length) : p;
}
function day(iso) {
  return iso ? iso.slice(0, 10) : "";
}
function shortFile(f, place) {
  if (f.startsWith(place + "/")) return f.slice(place.length + 1);
  return tilde(f);
}
function askedQuote(p) {
  return cut(stripMarkup(p).replace(/\s+/g, " ").trim(), 100);
}
function cardSummary(c) {
  for (let i = c.summaries.length - 1; i >= 0; i--) {
    const line = summaryLine(c.summaries[i]);
    if (line) return line;
  }
  return "";
}
function renderCard(c, budget) {
  const head = `## ${c.title ? cut(c.title, 90) : c.project} | ${c.project} | ${day(c.last)}`;
  const lines = [head, `Folder ${tilde(c.place)}${c.branch ? ` on ${c.branch}` : ""}`];
  const seen = /* @__PURE__ */ new Set([key(c.title || ""), key(c.project)]);
  const quotes = [];
  for (const p of [c.firstPrompt, c.prompts[c.prompts.length - 1]]) {
    if (!p) continue;
    const q = askedQuote(p);
    const k = key(q);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    quotes.push(`"${q}"`);
  }
  const askedLine = quotes.length ? `Asked ${quotes.join(" then ")}` : "";
  let sum = cardSummary(c);
  const sk = key(sum);
  if (!sk || seen.has(sk) || [...seen].some((k) => k.length > 20 && (k.includes(sk.slice(0, 60)) || sk.includes(k.slice(0, 60))))) sum = "";
  if (sum) lines.push(`Summary ${sum}`);
  if (askedLine) lines.push(askedLine);
  if (sum) {
    const files = c.files.slice(0, 5).map((f) => shortFile(f, c.place));
    if (files.length) lines.push(`Files ${files.join(", ")}`);
  }
  let out2 = lines.join("\n");
  if (out2.length > budget) out2 = cut(out2, budget);
  return out2;
}
var home2, key;
var init_format = __esm({
  "src/core/format.ts"() {
    "use strict";
    init_records();
    home2 = os3.homedir();
    key = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  }
});

// src/core/lines.ts
import fs4 from "node:fs";
async function* readLines(file, from = 0, to) {
  let size;
  try {
    size = fs4.statSync(file).size;
  } catch {
    return;
  }
  const stop = to == null ? size : Math.min(size, to);
  if (from >= stop) return;
  const stream = fs4.createReadStream(file, { start: from, end: stop - 1, highWaterMark: 1 << 20 });
  let parts = [];
  let partsLen = 0;
  let lineStart = from;
  for await (const chunk of stream) {
    let pos = 0;
    while (pos < chunk.length) {
      const nl = chunk.indexOf(10, pos);
      if (nl === -1) {
        parts.push(chunk.subarray(pos));
        partsLen += chunk.length - pos;
        break;
      }
      const piece = chunk.subarray(pos, nl);
      let buf;
      if (partsLen) {
        parts.push(piece);
        buf = Buffer.concat(parts, partsLen + piece.length);
        parts = [];
        partsLen = 0;
      } else {
        buf = piece;
      }
      const end = lineStart + buf.length + 1;
      yield { text: buf.toString("utf8"), start: lineStart, end };
      lineStart = end;
      pos = nl + 1;
    }
  }
}
var init_lines = __esm({
  "src/core/lines.ts"() {
    "use strict";
  }
});

// src/core/redact.ts
function looksOpaque(s) {
  const core = s.replace(/=+$/, "");
  if (/^[a-z]+(?:[-_][a-z]+)*$/i.test(core)) return false;
  const digits = (core.match(/[0-9]/g) || []).length;
  const upper = (core.match(/[A-Z]/g) || []).length;
  const lower = (core.match(/[a-z]/g) || []).length;
  const kinds = (digits > 0 ? 1 : 0) + (upper > 0 ? 1 : 0) + (lower > 0 ? 1 : 0);
  if (/^[0-9a-f]+$/i.test(core)) return core.length >= 32;
  return kinds >= 2 && digits >= 3;
}
function redact(text) {
  if (!text) return text;
  let out2 = text;
  for (const re of PATTERNS) out2 = out2.replace(re, DROPPED);
  out2 = out2.replace(KEYED, (_m, key2, sep, val) => {
    if (/^(?:the|a|an|is|was|for|and|to|of|in|on|with|from|that|this|it)$/i.test(val)) return _m;
    if (sep.trim() === "" && !/^bearer$|^authorization$/i.test(key2) && !looksOpaque(val)) return _m;
    return `${key2}${sep}${DROPPED}`;
  });
  out2 = out2.replace(OPAQUE, (m) => looksOpaque(m) ? DROPPED : m);
  return out2;
}
var PATTERNS, KEYED, OPAQUE, DROPPED;
var init_redact = __esm({
  "src/core/redact.ts"() {
    "use strict";
    PATTERNS = [
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g,
      /\b(?:sk|pk|rk)[-_](?:live|test|proj|ant|svcacct)[-_][A-Za-z0-9_-]{12,}/g,
      /\bsk-[A-Za-z0-9_-]{20,}/g,
      /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
      /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
      /\bglpat-[A-Za-z0-9_-]{16,}/g,
      /\bxox[abposr]-[A-Za-z0-9-]{10,}/g,
      /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
      /\bAIza[0-9A-Za-z_-]{30,}/g,
      /\bnpm_[A-Za-z0-9]{30,}/g,
      /\bhf_[A-Za-z0-9]{30,}/g,
      /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g,
      /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
      /\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@/g
    ];
    KEYED = /\b(bearer|authorization|token|access[_-]?token|refresh[_-]?token|api[_-]?key|apikey|secret|client[_-]?secret|password|passwd|pwd|private[_-]?key)\b(["'`]?\s*[:=]\s*["'`]?|\s+)([^\s"'`,;]{6,})/gi;
    OPAQUE = /(?<![A-Za-z0-9/_.-])[A-Za-z0-9+_=-]{32,}(?![A-Za-z0-9/_.-])/g;
    DROPPED = "[secret dropped]";
  }
});

// src/core/session.ts
import fs5 from "node:fs";
import path5 from "node:path";
function newState(id, transcript) {
  return { v: 2, id, transcript, offset: 0, turns: [], summaries: [], compactions: 0, gits: {} };
}
function summaryKey(text) {
  return text.slice(0, 160).toLowerCase().replace(/[^a-z0-9]+/g, "");
}
function addSummary(s, raw) {
  const text = cut(redact(cleanSummary(raw)), SUMMARY_CAP);
  if (!text) return false;
  const key2 = summaryKey(text);
  if (s.summaries.some((m) => m.key === key2)) return false;
  s.summaries.push({ text, at: s.turns.length, key: key2 });
  return true;
}
function currentTurn(s, t, cwd) {
  let turn = s.turns[s.turns.length - 1];
  if (!turn) {
    turn = { t, cwd, files: {} };
    s.turns.push(turn);
  }
  return turn;
}
function remember(s, p) {
  s.gits[p.path] = p.git;
  return p.path;
}
function turnEdits(s, t) {
  const out2 = {};
  for (const [f, n] of Object.entries(t.files)) {
    const key2 = remember(s, placeOfFile(f, t.cwd || void 0));
    out2[key2] = (out2[key2] || 0) + n;
  }
  return out2;
}
function wanted(text) {
  if (text.includes('"type":"api-request')) return false;
  if (isToolResultLine(text)) return false;
  if (text.includes('"type":"assistant"')) return mayHaveEdit(text);
  if (text.includes('"type":"attachment"')) return false;
  return text.includes('"type":"user"') || text.includes('"compact_boundary"') || text.includes('"type":"ai-title"') || text.includes('"type":"custom-title"') || text.includes('"type":"summary"');
}
async function scan(s, claude) {
  let lines = 0;
  let bad = 0;
  let size;
  try {
    size = fs5.statSync(s.transcript).size;
  } catch {
    return { lines, bad };
  }
  if (size < s.offset) {
    const fresh = newState(s.id, s.transcript);
    Object.assign(s, fresh);
  }
  for await (const line of readLines(s.transcript, s.offset)) {
    s.offset = line.end;
    lines++;
    const text = line.text;
    if (!text) continue;
    if (!wanted(text)) {
      const m = TS.exec(text);
      if (m) {
        if (!s.first || m[1] < s.first) s.first = m[1];
        if (!s.last || m[1] > s.last) s.last = m[1];
      }
      continue;
    }
    const r = parseLine(text);
    if (!r) {
      bad++;
      continue;
    }
    const ts = typeof r.timestamp === "string" ? r.timestamp : void 0;
    if (ts) {
      if (!s.first || ts < s.first) s.first = ts;
      if (!s.last || ts > s.last) s.last = ts;
    }
    if (typeof r.cwd === "string" && !s.cwd) s.cwd = r.cwd;
    if (typeof r.gitBranch === "string" && r.gitBranch && r.gitBranch !== "HEAD") s.branch = r.gitBranch;
    const ti = titleOf(r);
    if (ti) {
      if (ti.ai) s.title = cut(redact(ti.ai), 120);
      if (ti.custom) s.customTitle = cut(redact(ti.custom), 120);
      continue;
    }
    if (isCompactBoundary(r)) {
      s.compactions++;
      continue;
    }
    const sum = compactSummaryText(r);
    if (sum) {
      addSummary(s, sum);
      continue;
    }
    const cwd = typeof r.cwd === "string" ? r.cwd : s.cwd || "";
    const p = promptText(r);
    if (p) {
      s.turns.push({ t: ts || s.last || "", cwd, prompt: cut(redact(p), PROMPT_CAP), files: {} });
      if (cwd) remember(s, placeOfDir(cwd));
      continue;
    }
    if (r.type === "assistant") {
      for (const f of editPaths(r)) {
        if (isScratchPath(f, claude)) continue;
        const turn = currentTurn(s, ts || "", cwd);
        turn.files[f] = (turn.files[f] || 0) + 1;
      }
    }
  }
  return { lines, bad };
}
function placeStats(s) {
  const m = /* @__PURE__ */ new Map();
  const get = (p) => {
    let st = m.get(p);
    if (!st) {
      st = { path: p, git: !!s.gits[p], prompts: 0, edits: 0 };
      m.set(p, st);
    }
    return st;
  };
  for (const t of s.turns) {
    if (t.prompt && t.cwd) get(placeOfDirCached(s, t.cwd)).prompts++;
    for (const [p, n] of Object.entries(turnEdits(s, t))) get(p).edits += n;
  }
  return [...m.values()];
}
function placeOfDirCached(s, cwd) {
  const p = placeOfDir(cwd);
  s.gits[p.path] = p.git;
  return p.path;
}
function rankPlaces(stats) {
  return [...stats].sort((a, b) => b.edits - a.edits || b.prompts - a.prompts);
}
function assignTurns(s, qualified) {
  const q = new Set(qualified);
  const own = s.turns.map((t) => {
    let best = null;
    let bestN = 0;
    for (const [p, n] of Object.entries(turnEdits(s, t))) {
      if (q.has(p) && n > bestN) {
        best = p;
        bestN = n;
      }
    }
    if (best) return best;
    if (t.cwd) {
      const cp = placeOfDirCached(s, t.cwd);
      if (q.has(cp)) return cp;
    }
    return null;
  });
  const out2 = new Array(own.length);
  let prev = null;
  for (let i = 0; i < own.length; i++) {
    if (own[i]) prev = own[i];
    out2[i] = own[i] ?? prev;
  }
  let next = null;
  for (let i = own.length - 1; i >= 0; i--) {
    if (own[i]) next = own[i];
    if (!out2[i]) out2[i] = next ?? qualified[0];
  }
  return out2;
}
function summaryPlaces(s, owners, main2) {
  const res = [];
  let from = 0;
  for (const m of s.summaries) {
    const to = Math.min(m.at, owners.length);
    const set = /* @__PURE__ */ new Set();
    for (let i = from; i < to; i++) set.add(owners[i]);
    if (!set.size) set.add(owners[Math.max(0, to - 1)] ?? main2);
    res.push([...set]);
    from = Math.max(from, to);
  }
  return res;
}
function spread(items, n) {
  if (items.length <= n) return items;
  const out2 = [];
  for (let i = 0; i < n; i++) out2.push(items[Math.round(i * (items.length - 1) / (n - 1))]);
  return out2;
}
function deriveCards(s) {
  const stats = rankPlaces(placeStats(s));
  const fallback = s.cwd ? placeOfDirCached(s, s.cwd) : "";
  const main2 = stats[0]?.path ?? fallback;
  const qualified = stats.filter((p) => p.edits >= SPLIT_MIN_EDITS).map((p) => p.path);
  const split = qualified.length >= 2;
  const owners = split ? assignTurns(s, qualified) : s.turns.map(() => main2);
  const sumOwners = summaryPlaces(s, owners, main2);
  const groups = split ? qualified : [main2];
  const cards = [];
  groups.forEach((place, gi) => {
    const turns = s.turns.filter((_, i) => owners[i] === place);
    const prompts = turns.filter((t) => t.prompt).map((t) => t.prompt);
    const fileCount = /* @__PURE__ */ new Map();
    for (const t of turns) for (const [f, n] of Object.entries(t.files)) fileCount.set(f, (fileCount.get(f) || 0) + n);
    const files = [...fileCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, FILES_CAP).map(([f]) => f);
    const summaries = s.summaries.filter((_, i) => sumOwners[i]?.includes(place)).map((m) => m.text);
    const times = turns.map((t) => t.t).filter(Boolean).sort();
    const git = !!s.gits[place];
    cards.push({
      id: split ? `${s.id}:${gi + 1}` : s.id,
      session: s.id,
      part: gi + 1,
      parts: groups.length,
      place,
      git,
      project: path5.basename(place) || place,
      remote: git ? remoteOf(place) ?? void 0 : void 0,
      branch: s.branch,
      places: stats,
      first: (split ? times[0] : s.first) || s.first || "",
      last: (split ? times[times.length - 1] : s.last) || s.last || "",
      title: s.customTitle || s.title,
      summaries,
      firstPrompt: prompts[0],
      prompts: spread(prompts.slice(1), 5).map((p) => cut(p, LATER_CAP)),
      files,
      transcript: s.transcript,
      turns: prompts.length
    });
  });
  return cards.filter((c) => c.turns > 0 || c.summaries.length > 0 || c.files.length > 0 || c.title);
}
var PROMPT_CAP, LATER_CAP, SUMMARY_CAP, FILES_CAP, SPLIT_MIN_EDITS, TS;
var init_session = __esm({
  "src/core/session.ts"() {
    "use strict";
    init_lines();
    init_place();
    init_paths();
    init_records();
    init_redact();
    PROMPT_CAP = 300;
    LATER_CAP = 200;
    SUMMARY_CAP = 600;
    FILES_CAP = 30;
    SPLIT_MIN_EDITS = 3;
    TS = /"timestamp":"(\d{4}-\d\d-\d\dT[0-9:.]+Z?)"/;
  }
});

// src/core/update.ts
import fs6 from "node:fs";
import path6 from "node:path";
function listTranscripts(claude) {
  const root = projectsDir(claude);
  const out2 = [];
  let dirs;
  try {
    dirs = fs6.readdirSync(root);
  } catch {
    return out2;
  }
  for (const d of dirs) {
    const dp = path6.join(root, d);
    let ents;
    try {
      ents = fs6.readdirSync(dp);
    } catch {
      continue;
    }
    for (const f of ents) {
      if (!f.endsWith(".jsonl")) continue;
      const p = path6.join(dp, f);
      try {
        const stt = fs6.statSync(p);
        if (!stt.isFile()) continue;
        out2.push({ session: f.slice(0, -6), transcript: p, size: stt.size, mtime: stt.mtimeMs });
      } catch {
      }
    }
  }
  return out2;
}
async function applyJobs(st, claude, jobs, onProgress) {
  const merged = /* @__PURE__ */ new Map();
  for (const j of jobs) {
    if (!j || typeof j.session !== "string" || typeof j.transcript !== "string") continue;
    const m = merged.get(j.session) ?? { ...j, summaries: [] };
    if (j.summary) m.summaries.push(j.summary);
    m.transcript = j.transcript || m.transcript;
    merged.set(j.session, m);
  }
  let cards = loadCards(st);
  let lines = 0;
  let bad = 0;
  let done = 0;
  for (const j of merged.values()) {
    let s = loadSession(st, j.session);
    if (!s || s.transcript !== j.transcript) s = s ? { ...s, transcript: j.transcript } : newState(j.session, j.transcript);
    const r = await scan(s, claude);
    lines += r.lines;
    bad += r.bad;
    for (const sum of j.summaries) addSummary(s, sum);
    saveSession(st, s);
    cards = upsertCards(cards, s.id, deriveCards(s));
    done++;
    onProgress?.(done, merged.size);
  }
  const index = merged.size ? writeCardsAndIndex(st, cards) : null;
  return { sessions: merged.size, cards: index ? index.docs.length : cards.length, lines, bad, index };
}
var init_update = __esm({
  "src/core/update.ts"() {
    "use strict";
    init_paths();
    init_fsx();
    init_session();
    init_store();
  }
});

// src/core/lock.ts
import fs7 from "node:fs";
import path7 from "node:path";
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}
function readLock(dir) {
  try {
    return JSON.parse(fs7.readFileSync(path7.join(dir, "owner.json"), "utf8"));
  } catch {
    return null;
  }
}
function tryLock(dir, staleMs) {
  fs7.mkdirSync(path7.dirname(dir), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs7.mkdirSync(dir);
      fs7.writeFileSync(path7.join(dir, "owner.json"), JSON.stringify({ pid: process.pid, at: Date.now() }));
      return true;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      const info = readLock(dir);
      let stat = null;
      try {
        stat = fs7.statSync(dir);
      } catch {
        continue;
      }
      const at = info?.at ?? stat.mtimeMs;
      const stale = info && !alive(info.pid) || Date.now() - at > staleMs || !info && Date.now() - stat.mtimeMs > 2e3;
      if (!stale) return false;
      try {
        fs7.rmSync(dir, { recursive: true, force: true });
      } catch {
      }
    }
  }
  return false;
}
function releaseLock(dir) {
  const info = readLock(dir);
  if (info && info.pid !== process.pid) return;
  try {
    fs7.rmSync(dir, { recursive: true, force: true });
  } catch {
  }
}
async function waitLock(dir, staleMs, waitMs) {
  const end = Date.now() + waitMs;
  for (; ; ) {
    if (tryLock(dir, staleMs)) return true;
    if (Date.now() >= end) return false;
    await new Promise((r) => setTimeout(r, 25));
  }
}
function withQuickLock(dir, fn, waitMs = 40) {
  const end = Date.now() + waitMs;
  for (; ; ) {
    if (tryLock(dir, 5e3)) break;
    if (Date.now() >= end) return null;
    const t = Date.now() + 2;
    while (Date.now() < t) {
    }
  }
  try {
    return fn();
  } finally {
    releaseLock(dir);
  }
}
var init_lock = __esm({
  "src/core/lock.ts"() {
    "use strict";
  }
});

// src/core/items.ts
import fs9 from "node:fs";
import { randomUUID } from "node:crypto";
function makeItem(session, kind, label, text) {
  return {
    id: randomUUID(),
    session,
    kind,
    label: cut(redact(label), 200),
    text: cut(redact(text), ITEM_TEXT_CAP),
    at: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function edit(file, fn, waitMs = 40) {
  return withQuickLock(
    `${file}.lock`,
    () => {
      const rows = readJsonl(file);
      const next = fn(rows);
      if (next) writeJsonl(file, next);
      return rows;
    },
    waitMs
  );
}
function enqueue(st, item) {
  return edit(st.queue, (rows) => rows.some((r) => r.id === item.id) ? rows : [...rows, item], 500) !== null;
}
function queued(st, session) {
  const rows = readJsonl(st.queue);
  return session ? rows.filter((r) => r.session === session) : rows;
}
function pin(st, item) {
  return edit(st.pins, (rows) => rows.some((r) => r.session === item.session && r.label === item.label) ? rows : [...rows, item], 500) !== null;
}
function unpin(st, id) {
  return edit(st.pins, (rows) => rows.filter((r) => r.id !== id), 500) !== null;
}
function pruneItems(st, keep) {
  let dropped = 0;
  for (const file of [st.queue, st.pins]) {
    if (!fs9.existsSync(file)) continue;
    edit(
      file,
      (rows) => {
        const next = rows.filter(keep);
        dropped += rows.length - next.length;
        return next.length === rows.length ? null : next;
      },
      500
    );
  }
  return dropped;
}
function pinsFor(st, session) {
  return readJsonl(st.pins).filter((r) => r.session === session || r.session === "*");
}
var ITEM_TEXT_CAP;
var init_items = __esm({
  "src/core/items.ts"() {
    "use strict";
    init_fsx();
    init_lock();
    init_records();
    init_redact();
    ITEM_TEXT_CAP = 1500;
  }
});

// src/core/context.ts
import path10 from "node:path";
function catLabel(cat) {
  if (cat.startsWith("tool:")) return `Tool results, ${cat.slice(5)}`;
  return CAT_LABEL[cat] ?? cat;
}
function newAnalyzer(session, transcript) {
  return {
    ctx: { session, transcript, offset: 0, points: [], compactions: [], system: { tok: 0, measured: false }, prompts: 0, skipped: 0, unreadable: 0 },
    live: /* @__PURE__ */ new Map(),
    sums: /* @__PURE__ */ new Map(),
    tools: /* @__PURE__ */ new Map(),
    out: /* @__PURE__ */ new Map(),
    lastMsg: null,
    pending: null
  };
}
function add(a, item) {
  const key2 = item.id + "#" + item.cat + "#" + item.label;
  a.sums.set(item.cat, (a.sums.get(item.cat) || 0) + item.tok);
  const prev = a.live.get(key2);
  if (prev) {
    prev.tok += item.tok;
    if (item.text) prev.text = item.text;
    return;
  }
  a.live.set(key2, { ...item });
}
function remove2(a, key2) {
  const it = a.live.get(key2);
  if (!it) return;
  a.live.delete(key2);
  a.sums.set(it.cat, (a.sums.get(it.cat) || 0) - it.tok);
}
function renderedChars(r) {
  if (!Array.isArray(r.rendered)) return 0;
  let n = 0;
  for (const b of r.rendered) n += typeof b?.content === "string" ? b.content.length : JSON.stringify(b ?? "").length;
  return n;
}
function attachment(a, r) {
  const at = r.attachment ?? {};
  const type = String(at.type ?? "");
  if (type === "prompt_snapshot" && !a.ctx.system.measured) {
    const chars2 = JSON.stringify(at.systemPrompt ?? "").length + JSON.stringify(at.tools ?? "").length;
    if (chars2 > 2) a.ctx.system = { tok: tok(chars2), measured: true };
    return;
  }
  const chars = renderedChars(r);
  if (!chars) return;
  const id = String(r.uuid ?? "");
  if (MEMORY_ATTACH.has(type)) {
    const files = Array.isArray(at.files) ? at.files.length : 1;
    add(a, { id, cat: "memory", tok: tok(chars), kind: "other", label: files > 1 ? `${files} instruction files` : String(at.displayPath ?? at.path ?? "Instruction file") });
  } else if (FILE_ATTACH.has(type)) {
    const f = String(at.filename ?? at.displayPath ?? "file");
    add(a, { id, cat: "skills", tok: tok(chars), kind: "file", label: f });
  } else if (SYSTEM_ATTACH.has(type)) {
    add(a, { id, cat: "system", tok: tok(chars), kind: "other", label: type.replace(/_/g, " ") });
  } else {
    add(a, { id, cat: "skills", tok: tok(chars), kind: "other", label: type.replace(/_/g, " ") });
  }
}
function toolLabel(name, input) {
  if (!input || typeof input !== "object") return name;
  if (typeof input.file_path === "string") return input.file_path;
  if (typeof input.command === "string") return cut(redact(input.command.replace(/\s+/g, " ")), 160);
  if (typeof input.pattern === "string") return `${name} ${cut(redact(input.pattern), 80)}`;
  if (typeof input.url === "string") return cut(redact(input.url), 160);
  if (typeof input.description === "string") return `${name} ${cut(redact(input.description), 80)}`;
  return name;
}
function snapshot(a, r, u) {
  const est = {};
  let raw = 0;
  for (const [cat, v] of a.sums) if (v > 0) est[cat] = v;
  if (a.ctx.system.tok) est.system = (est.system || 0) + a.ctx.system.tok;
  for (const v of Object.values(est)) raw += v;
  a.ctx.points.push({
    n: a.ctx.points.length,
    t: String(r.timestamp ?? ""),
    total: u.total,
    input: u.input,
    read: u.cacheRead,
    write: u.cacheWrite,
    out: u.output,
    est,
    raw,
    prompt: a.ctx.prompts
  });
}
function assistant(a, r) {
  const msg = r.message ?? {};
  const id = typeof msg.id === "string" ? msg.id : String(r.uuid ?? "");
  if (id !== a.lastMsg) {
    a.lastMsg = id;
    const u2 = usageOf(r);
    if (u2 && !r.isApiErrorMessage) snapshot(a, r, u2);
    if (typeof msg.model === "string" && !msg.model.startsWith("<")) a.ctx.model = msg.model;
  }
  const uid = String(r.uuid ?? "");
  const u = usageOf(r);
  if (u) {
    const prev = a.out.get(id) ?? 0;
    if (u.output > prev) {
      add(a, { id: uid, cat: "replies", tok: u.output - prev, kind: "other", label: "Reply" });
      a.out.set(id, u.output);
    }
  }
  for (const b of contentBlocks(r)) {
    if (!b || typeof b !== "object" || b.type !== "tool_use") continue;
    const name = String(b.name ?? "tool").startsWith("mcp__") ? String(b.name).split("__").slice(0, 2).join("__") : String(b.name ?? "tool");
    a.tools.set(String(b.id ?? ""), { name, label: toolLabel(name, b.input) });
    const file = b.input?.file_path ?? b.input?.notebook_path;
    if (EDIT_TOOLS2.has(name) && typeof file === "string") add(a, { id: uid, cat: "replies", tok: 0, kind: "edit", label: file });
  }
}
function hasError(output, flagged) {
  return flagged || ERROR.test(output);
}
function user(a, r) {
  const uid = String(r.uuid ?? "");
  if (r.isCompactSummary) {
    const text = textOf(r.message?.content);
    finishCompaction(a, text, r);
    add(a, { id: uid, cat: "summary", tok: tok(text.length), kind: "other", label: "Compaction summary" });
    return;
  }
  const p = promptText(r);
  if (p) {
    a.ctx.prompts++;
    add(a, { id: uid, cat: "prompts", tok: tok(textOf(r.message?.content).length), kind: "prompt", label: cut(redact(p), 120), text: cut(redact(p), 2e3) });
    for (const b of contentBlocks(r)) if (b?.type === "image") add(a, { id: uid, cat: "prompts", tok: IMAGE_TOKENS, kind: "other", label: "Image" });
    return;
  }
  let other = 0;
  for (const b of contentBlocks(r)) {
    if (!b || typeof b !== "object") continue;
    if (b.type === "tool_result") {
      const info = a.tools.get(String(b.tool_use_id ?? "")) ?? { name: "tool", label: "tool" };
      const body = textOf(b.content);
      let images = 0;
      if (Array.isArray(b.content)) {
        for (const c of b.content) if (c?.type === "image") images++;
      }
      const t = tok(body.length) + images * IMAGE_TOKENS;
      const kind = info.name === "Read" ? "file" : info.name === "Bash" ? "command" : "other";
      const text = kind === "command" ? clipOutput(body) : void 0;
      const error = kind === "command" ? hasError(body, b.is_error === true) : void 0;
      add(a, { id: uid, cat: `tool:${info.name}`, tok: t, kind, label: info.label, text, error });
    } else if (b.type === "text" && typeof b.text === "string") other += b.text.length;
    else if (b.type === "image") other += IMAGE_TOKENS * CHARS_PER_TOKEN;
  }
  if (other) add(a, { id: uid, cat: "skills", tok: tok(other), kind: "other", label: r.isMeta ? "Injected note" : "Message" });
}
function clipOutput(s) {
  const red = redact(s);
  if (red.length <= OUTPUT_CAP) return red;
  return red.slice(0, 1e3) + "\n\u2026\n" + red.slice(-450);
}
function decisions(prompt) {
  const out2 = [];
  for (const s of prompt.split(/(?<=[.!?])\s+|\n+/)) {
    const t = s.trim();
    if (t.length < 12 || t.length > 300) continue;
    if (DECISION.test(t)) out2.push(t);
  }
  return out2;
}
function summaryWords(summary) {
  return new Set(tokens(summary));
}
function mentions(hay, needle, allowSlash = false) {
  if (!needle) return false;
  let from = 0;
  for (; ; ) {
    const i = hay.indexOf(needle, from);
    if (i < 0) return false;
    const before = i > 0 ? hay[i - 1] : " ";
    const after = hay[i + needle.length] ?? " ";
    const next = hay[i + needle.length + 1] ?? " ";
    const okBefore = !WORDISH.test(before) && before !== "." && (allowSlash || before !== "/");
    const okAfter = !WORDISH.test(after) && after !== "/" && !(after === "." && WORDISH.test(next));
    if (okBefore && okAfter) return true;
    from = i + 1;
  }
}
function fileNamed(file, summaryLower, root, uniqueBase = true) {
  const f = file.toLowerCase();
  const parts = f.split("/").filter(Boolean);
  if (!parts.length) return false;
  if (mentions(summaryLower, f, true)) return true;
  const r = root?.toLowerCase();
  if (r && f.startsWith(r + "/") && mentions(summaryLower, f.slice(r.length + 1), true)) return true;
  if (parts.length >= 2 && mentions(summaryLower, parts.slice(-2).join("/"), true)) return true;
  return uniqueBase && parts[parts.length - 1].includes(".") && mentions(summaryLower, parts[parts.length - 1]);
}
function normalizeCommand(cmd) {
  let c = cmd.replace(/\s+/g, " ").trim();
  for (; ; ) {
    const n = c.replace(/^cd \S+ (&&|;) /, "");
    if (n === c) break;
    c = n;
  }
  return c.replace(/ 2>&1\b/g, "").replace(/ \| (head|tail)( -n)? ?-?\d*$/, "").trim();
}
function commandNamed(label, summaryLower) {
  const cmd = normalizeCommand(label).toLowerCase();
  if (cmd.length < 4) return false;
  return mentions(summaryLower, cmd, true);
}
function decisionNamed(sentence, words) {
  const t = [...new Set(tokens(sentence))];
  if (!t.length) return true;
  const hit = t.filter((w) => words.has(w)).length;
  return hit / t.length >= 0.6;
}
function top(items, n) {
  return [...items].filter((i) => i.tok > 0).sort((x, y) => y.tok - x.tok).slice(0, n).map((i) => ({ label: i.label, cat: i.cat, tok: i.tok, kind: i.kind }));
}
function finishCompaction(a, rawSummary, r) {
  const p = a.pending ?? { n: a.ctx.points.length, t: String(r.timestamp ?? ""), trigger: "unknown", pre: 0, post: 0, preserved: /* @__PURE__ */ new Set(), before: [...a.live.values()] };
  a.pending = null;
  const summary = cleanSummary(rawSummary);
  const lower = summary.toLowerCase();
  const words = summaryWords(summary);
  const root = a.ctx.cwd;
  const bases = /* @__PURE__ */ new Map();
  for (const it of p.before) {
    if (it.kind !== "file" && it.kind !== "edit") continue;
    const b = path10.basename(it.label).toLowerCase();
    const set = bases.get(b) ?? /* @__PURE__ */ new Set();
    set.add(it.label);
    bases.set(b, set);
  }
  const unique = (f) => (bases.get(path10.basename(f).toLowerCase())?.size ?? 0) <= 1;
  const decided = [];
  const edits = /* @__PURE__ */ new Map();
  const reads = /* @__PURE__ */ new Map();
  const commands = /* @__PURE__ */ new Map();
  const seen = /* @__PURE__ */ new Set();
  const namedKeys = /* @__PURE__ */ new Set();
  let smallReads = 0;
  for (const it of p.before) {
    if (p.preserved.has(it.id)) continue;
    if (it.kind === "edit") {
      const key2 = "edit:" + it.label;
      if (namedKeys.has(key2)) continue;
      if (fileNamed(it.label, lower, root, unique(it.label))) {
        namedKeys.add(key2);
        continue;
      }
      const e = edits.get(key2);
      if (e) e.runs = (e.runs ?? 1) + 1;
      else edits.set(key2, { id: key2, kind: "edit", label: it.label, text: "", tok: 0, runs: 1 });
    } else if (it.kind === "file") {
      const key2 = "file:" + it.label;
      if (namedKeys.has(key2)) continue;
      if (fileNamed(it.label, lower, root, unique(it.label))) {
        namedKeys.add(key2);
        continue;
      }
      const prev = reads.get(key2);
      if (!prev || it.tok > prev.tok) reads.set(key2, { id: key2, kind: "file", label: it.label, text: "", tok: it.tok });
    } else if (it.kind === "command") {
      const norm = normalizeCommand(it.label);
      const key2 = "command:" + norm;
      if (namedKeys.has(key2)) continue;
      if (commandNamed(it.label, lower)) {
        namedKeys.add(key2);
        continue;
      }
      const prev = commands.get(key2);
      commands.set(key2, { id: key2, kind: "command", label: it.label, text: it.text ?? "", tok: it.tok, runs: (prev?.runs ?? 0) + 1, error: !!(prev?.error || it.error) });
    } else if (it.kind === "prompt" && it.text) {
      for (const d of decisions(it.text)) {
        const key2 = "decision:" + d.toLowerCase();
        if (seen.has(key2)) continue;
        seen.add(key2);
        if (decisionNamed(d, words)) {
          namedKeys.add(key2);
          continue;
        }
        decided.push({ id: key2, kind: "decision", label: "Decision", text: d, tok: tok(d.length) });
      }
    }
  }
  for (const k of edits.keys()) reads.delete("file:" + k.slice(5));
  const bigReads = [...reads.values()].filter((d) => {
    if (d.tok >= LARGE_READ) return true;
    smallReads++;
    return false;
  });
  const kept = [...commands.values()].filter((d) => d.error || (d.runs ?? 1) > 1);
  const dropped = [
    ...decided,
    ...[...edits.values()].sort((x, y) => (y.runs ?? 0) - (x.runs ?? 0)),
    ...bigReads.sort((x, y) => y.tok - x.tok),
    ...kept.sort((x, y) => Number(!!y.error) - Number(!!x.error) || (y.runs ?? 0) - (x.runs ?? 0) || y.tok - x.tok)
  ];
  const named = namedKeys.size;
  a.ctx.compactions.push({
    n: p.n,
    t: p.t,
    trigger: p.trigger,
    pre: p.pre,
    post: p.post,
    preserved: p.preserved.size,
    summary: cut(redact(summary), 4e3),
    dropped: dropped.slice(0, MAX_DROPPED),
    commands: commands.size,
    smallReads,
    named,
    before: top(p.before, 10)
  });
  for (const [k, v] of [...a.live]) if (!p.preserved.has(v.id)) remove2(a, k);
}
function boundary(a, r) {
  const m = r.compactMetadata ?? {};
  const ids = Array.isArray(m.preservedMessages?.allUuids) ? m.preservedMessages.allUuids : Array.isArray(m.preservedMessages?.uuids) ? m.preservedMessages.uuids : [];
  a.pending = {
    n: a.ctx.points.length,
    t: String(r.timestamp ?? ""),
    trigger: String(m.trigger ?? "auto"),
    pre: typeof m.preTokens === "number" ? m.preTokens : 0,
    post: typeof m.postTokens === "number" ? m.postTokens : 0,
    preserved: new Set(ids.map(String)),
    before: [...a.live.values()]
  };
}
function wantedLine(text) {
  if (text.includes('"type":"api-request-blob"') || text.includes('"type":"api-request"')) return false;
  return true;
}
function step(a, r) {
  if (r.isSidechain) return;
  if (typeof r.cwd === "string" && !a.ctx.cwd) a.ctx.cwd = r.cwd;
  switch (r.type) {
    case "assistant":
      return assistant(a, r);
    case "user":
      return user(a, r);
    case "attachment":
      return attachment(a, r);
    case "system":
      if (r.subtype === "compact_boundary") boundary(a, r);
      return;
    case "api-request-shape": {
      const sh = r.shape ?? {};
      const chars = JSON.stringify(sh.system ?? "").length + JSON.stringify(sh.tools ?? "").length;
      if (chars > 2) a.ctx.system = { tok: tok(chars), measured: true };
      return;
    }
    case "ai-title":
      if (typeof r.aiTitle === "string") a.ctx.title = cut(redact(r.aiTitle), 120);
      return;
    case "custom-title":
      if (typeof r.customTitle === "string") a.ctx.title = cut(redact(r.customTitle), 120);
      return;
    default:
      a.ctx.skipped++;
  }
}
async function advance(a, to) {
  let n = 0;
  for await (const line of readLines(a.ctx.transcript, a.ctx.offset, to)) {
    a.ctx.offset = line.end;
    if (!line.text || !wantedLine(line.text)) continue;
    const r = parseLine(line.text);
    if (!r) {
      a.ctx.unreadable++;
      continue;
    }
    step(a, r);
    n++;
  }
  return n;
}
function largest(a, n = 12) {
  const groups = /* @__PURE__ */ new Map();
  for (const it of a.live.values()) {
    if (it.tok <= 0) continue;
    const key2 = it.cat + "\0" + it.label;
    const g = groups.get(key2);
    if (g) {
      g.tok += it.tok;
      g.count++;
    } else groups.set(key2, { ...it, count: 1 });
  }
  const items = [...groups.values()];
  if (a.ctx.system.tok) items.push({ id: "system", cat: "system", tok: a.ctx.system.tok, kind: "other", label: a.ctx.system.measured ? "System prompt and tool definitions" : "System prompt", count: 1 });
  return items.sort((x, y) => y.tok - x.tok).slice(0, n).map((i) => ({ label: i.label, cat: i.cat, tok: i.tok, kind: i.kind, count: i.count }));
}
function categories(a) {
  const set = /* @__PURE__ */ new Set();
  for (const p of a.ctx.points) for (const k of Object.keys(p.est)) set.add(k);
  return [...set];
}
var CHARS_PER_TOKEN, IMAGE_TOKENS, OUTPUT_CAP, MAX_DROPPED, LARGE_READ, CAT_LABEL, tok, SYSTEM_ATTACH, MEMORY_ATTACH, FILE_ATTACH, EDIT_TOOLS2, ERROR, DECISION, WORDISH;
var init_context = __esm({
  "src/core/context.ts"() {
    "use strict";
    init_lines();
    init_records();
    init_redact();
    init_text();
    CHARS_PER_TOKEN = 2.6;
    IMAGE_TOKENS = 1600;
    OUTPUT_CAP = 1500;
    MAX_DROPPED = 80;
    LARGE_READ = 2e3;
    CAT_LABEL = {
      system: "System and tools",
      memory: "Memory and instruction files",
      skills: "Skills and attachments",
      prompts: "Your prompts",
      replies: "Claude's replies",
      summary: "Compaction summary"
    };
    tok = (chars) => Math.round(chars / CHARS_PER_TOKEN);
    SYSTEM_ATTACH = /* @__PURE__ */ new Set(["deferred_tools_delta", "mcp_instructions_delta", "agent_listing_delta"]);
    MEMORY_ATTACH = /* @__PURE__ */ new Set(["instructions", "nested_memory"]);
    FILE_ATTACH = /* @__PURE__ */ new Set(["file", "edited_text_file", "compact_file_reference"]);
    EDIT_TOOLS2 = /* @__PURE__ */ new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
    ERROR = /^(error|fatal)(\[[^\]]*\])?:|Traceback \(most recent call last\)|npm ERR!|command not found|panicked at|^\s*FAIL\s|^Exit code [1-9]/im;
    DECISION = /\b(use|using|don'?t|do not|never|always|must|should|instead|prefer|keep|switch to|go with|stick with|make sure|no more|stop|avoid|only|rather than|from now on|decid)/i;
    WORDISH = /[a-z0-9_\-]/;
  }
});

// src/server.ts
var server_exports = {};
__export(server_exports, {
  serve: () => serve,
  start: () => start
});
import fs11 from "node:fs";
import http from "node:http";
import path11 from "node:path";
import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
function webDir() {
  const here2 = path11.dirname(fileURLToPath(import.meta.url));
  for (const d of [path11.join(here2, "web"), path11.join(here2, "..", "dist", "web")]) if (fs11.existsSync(path11.join(d, "index.html"))) return d;
  return path11.join(here2, "web");
}
function firstCwd(file) {
  try {
    const fd = fs11.openSync(file, "r");
    const buf = Buffer.alloc(65536);
    const n = fs11.readSync(fd, buf, 0, buf.length, 0);
    fs11.closeSync(fd);
    const m = buf.subarray(0, n).toString("utf8").match(/"cwd":"((?:[^"\\]|\\.)*)"/);
    return m ? JSON.parse(`"${m[1]}"`) : null;
  } catch {
    return null;
  }
}
function sessionRows(st) {
  const cards = loadCards(st);
  const files = new Map(listTranscripts(claudeDir()).map((f) => [f.session, f]));
  const by = /* @__PURE__ */ new Map();
  for (const c of cards) {
    const l = by.get(c.session) ?? [];
    l.push(c);
    by.set(c.session, l);
  }
  const now = Date.now();
  const rows = [];
  for (const [session, cs] of by) {
    cs.sort((a, b) => a.part - b.part);
    const main2 = [...cs].sort((a, b) => b.turns - a.turns)[0];
    const f = files.get(session);
    rows.push({
      session,
      title: main2.title,
      place: main2.place,
      placeLabel: tilde(main2.place),
      project: main2.project,
      places: cs.map((c) => c.place),
      first: cs.map((c) => c.first).filter(Boolean).sort()[0] ?? "",
      last: cs.map((c) => c.last).filter(Boolean).sort().pop() ?? "",
      turns: cs.reduce((a, c) => a + c.turns, 0),
      files: cs.reduce((a, c) => a + c.files.length, 0),
      summaries: cs.reduce((a, c) => a + c.summaries.length, 0),
      live: !!f && now - f.mtime < 12e4,
      transcript: f ? f.transcript : null,
      size: f ? f.size : 0
    });
  }
  for (const [session, f] of files) {
    if (by.has(session)) continue;
    const cwd = firstCwd(f.transcript) ?? "";
    rows.push({
      session,
      place: cwd,
      placeLabel: tilde(cwd),
      project: path11.basename(cwd),
      places: cwd ? [cwd] : [],
      first: new Date(f.mtime).toISOString(),
      last: new Date(f.mtime).toISOString(),
      turns: 0,
      files: 0,
      summaries: 0,
      live: now - f.mtime < 12e4,
      transcript: f.transcript,
      size: f.size
    });
  }
  rows.sort((a, b) => b.last.localeCompare(a.last));
  return rows;
}
function sameToken(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
async function start(st, opts) {
  const token = randomBytes(18).toString("base64url");
  const web = webDir();
  const analyzers = /* @__PURE__ */ new Map();
  const clients = /* @__PURE__ */ new Set();
  const watched = /* @__PURE__ */ new Map();
  let port = 0;
  let indexing = null;
  const send = (res, code, body, type = "application/json") => {
    const data = type === "application/json" ? JSON.stringify(body) : body;
    res.writeHead(code, {
      "content-type": type,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "x-frame-options": "DENY",
      "content-security-policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      "cross-origin-resource-policy": "same-origin"
    });
    res.end(data);
  };
  const broadcast = (event, data, only) => {
    for (const c of clients) {
      if (only && c.watch !== only) continue;
      c.res.write(`event: ${event}
data: ${JSON.stringify(data)}

`);
    }
  };
  const transcriptOf = (session) => {
    const f = listTranscripts(claudeDir()).find((x) => x.session === session);
    if (f) return f.transcript;
    const c = loadCards(st).find((x) => x.session === session);
    return c && fs11.existsSync(c.transcript) ? c.transcript : null;
  };
  const analyze = async (session) => {
    let a = analyzers.get(session);
    const file = a?.ctx.transcript ?? transcriptOf(session);
    if (!file) return null;
    let size = 0;
    try {
      size = fs11.statSync(file).size;
    } catch {
      return a ?? null;
    }
    if (!a || a.ctx.offset > size) {
      a = newAnalyzer(session, file);
      analyzers.set(session, a);
      while (analyzers.size > 4) analyzers.delete(analyzers.keys().next().value);
    }
    await advance(a);
    return a;
  };
  const refresh = () => {
    if (indexing) return indexing;
    indexing = (async () => {
      if (!tryLock(st.lock, WORKER_LIMIT_MS + 5e3)) return;
      try {
        const files = listTranscripts(claudeDir());
        await applyJobs(st, claudeDir(), files.map((f) => ({ session: f.session, transcript: f.transcript })));
      } catch {
      } finally {
        releaseLock(st.lock);
      }
      broadcast("sessions", { at: Date.now() });
    })().finally(() => {
      indexing = null;
    });
    return indexing;
  };
  const watch = (session) => {
    const file = transcriptOf(session);
    if (!file) return;
    const w = watched.get(session);
    if (w) {
      w.count++;
      return;
    }
    const entry = { file, count: 1, size: 0 };
    watched.set(session, entry);
    fs11.watchFile(file, { interval: 700 }, (cur) => {
      if (cur.size !== entry.size) {
        entry.size = cur.size;
        broadcast("change", { session, size: cur.size }, session);
      }
    });
  };
  const unwatch = (session) => {
    if (!session) return;
    const w = watched.get(session);
    if (!w) return;
    w.count--;
    if (w.count <= 0) {
      fs11.unwatchFile(w.file);
      watched.delete(session);
    }
  };
  const readBody = (req) => new Promise((resolve, reject) => {
    let n = 0;
    const parts = [];
    req.on("data", (c) => {
      n += c.length;
      if (n > 64 * 1024) {
        reject(new Error("too large"));
        req.destroy();
        return;
      }
      parts.push(c);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(parts).toString("utf8") || "{}"));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
  const handler = async (req, res) => {
    const host = req.headers.host ?? "";
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return send(res, 421, { error: "host" });
    const origin = req.headers.origin;
    if (origin && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) return send(res, 403, { error: "origin" });
    if (req.headers["sec-fetch-site"] && req.headers["sec-fetch-site"] !== "same-origin" && req.headers["sec-fetch-site"] !== "none") return send(res, 403, { error: "site" });
    const u = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    const segs = u.pathname.split("/");
    if (segs.length < 2 || !sameToken(segs[1] ?? "", token)) return send(res, 404, { error: "not found" });
    if (segs.length === 2) {
      res.writeHead(308, { location: `/${token}/` });
      return res.end();
    }
    const rest = segs.slice(2).join("/");
    try {
      if (req.method === "GET" && (rest === "" || rest === "index.html")) {
        const f = path11.join(web, "index.html");
        if (!fs11.existsSync(f)) return send(res, 200, "<!doctype html><title>claude-ctx</title><p>The page is not built. Run npm run build.</p>", "text/html; charset=utf-8");
        return send(res, 200, fs11.readFileSync(f), MIME[".html"]);
      }
      if (req.method === "GET" && rest.startsWith("assets/")) {
        const f = path11.resolve(web, rest);
        if (!f.startsWith(path11.resolve(web) + path11.sep) || !fs11.existsSync(f)) return send(res, 404, { error: "not found" });
        res.setHeader("cache-control", "no-store");
        return send(res, 200, fs11.readFileSync(f), MIME[path11.extname(f)] ?? "application/octet-stream");
      }
      if (req.method === "GET" && rest === "api/sessions") {
        return send(res, 200, { sessions: sessionRows(st), indexing: !!indexing, home: tilde(st.home) });
      }
      if (req.method === "GET" && rest.startsWith("api/session/")) {
        const id = decodeURIComponent(rest.slice("api/session/".length));
        const since = Math.max(0, Number(u.searchParams.get("since")) || 0);
        const a = await analyze(id);
        if (!a) return send(res, 404, { error: "no transcript" });
        const pts = a.ctx.points;
        const from = since <= pts.length ? since : 0;
        const cats = categories(a);
        return send(res, 200, {
          session: id,
          title: a.ctx.title,
          cwd: a.ctx.cwd ? tilde(a.ctx.cwd) : void 0,
          root: a.ctx.cwd,
          model: a.ctx.model,
          offset: a.ctx.offset,
          system: a.ctx.system,
          ratio: CHARS_PER_TOKEN,
          from,
          count: pts.length,
          points: pts.slice(from),
          compactions: a.ctx.compactions,
          largest: largest(a),
          categories: cats.map((c) => ({ key: c, label: catLabel(c) })),
          queued: queued(st, id),
          pins: pinsFor(st, id)
        });
      }
      if (req.method === "GET" && rest === "api/events") {
        const watchId = u.searchParams.get("watch");
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-content-type-options": "nosniff" });
        res.write(`event: hello
data: {}

`);
        const client = { res, watch: watchId };
        clients.add(client);
        if (watchId) watch(watchId);
        const ping = setInterval(() => res.write(": ping\n\n"), 2e4);
        req.on("close", () => {
          clearInterval(ping);
          clients.delete(client);
          unwatch(watchId);
        });
        return;
      }
      if (req.method === "POST" && (rest === "api/putback" || rest === "api/pin" || rest === "api/unpin")) {
        if (!(req.headers["content-type"] ?? "").startsWith("application/json")) return send(res, 415, { error: "json only" });
        const b = await readBody(req);
        if (rest === "api/unpin") return send(res, 200, { ok: unpin(st, String(b.id ?? "")) });
        const kinds = ["file", "command", "decision", "note"];
        if (typeof b.session !== "string" || !b.session || !kinds.includes(b.kind)) return send(res, 400, { error: "bad item" });
        const item = makeItem(b.session, b.kind, String(b.label ?? ""), String(b.text ?? ""));
        const ok = rest === "api/putback" ? enqueue(st, item) : pin(st, item);
        broadcast("items", { session: b.session }, b.session);
        return send(res, ok ? 200 : 503, { ok, item });
      }
      if (req.method === "POST" && rest === "api/refresh") {
        void refresh();
        return send(res, 202, { ok: true });
      }
      return send(res, 404, { error: "not found" });
    } catch (e) {
      return send(res, 500, { error: e instanceof Error ? e.message : "error" });
    }
  };
  const server = http.createServer((req, res) => {
    void handler(req, res);
  });
  let want = opts.port && opts.port !== 4e3 ? opts.port : 0;
  await new Promise((resolve, reject) => {
    const tryListen = () => {
      server.once("error", (e) => {
        if (want && e.code === "EADDRINUSE") {
          want = 0;
          tryListen();
        } else reject(e);
      });
      server.listen(want, "127.0.0.1", () => resolve());
    };
    tryListen();
  });
  port = server.address().port;
  if (port === 4e3) {
    await new Promise((r) => server.close(() => r()));
    return start(st, { ...opts, port: 0 });
  }
  const url = `http://127.0.0.1:${port}/${token}/`;
  void refresh();
  const close = async () => {
    for (const c of clients) c.res.end();
    clients.clear();
    for (const w of watched.values()) fs11.unwatchFile(w.file);
    watched.clear();
    server.closeAllConnections?.();
    await new Promise((r) => server.close(() => r()));
  };
  return { url, port, token, close };
}
async function serve(st, opts) {
  const run = await start(st, opts);
  process.stdout.write(`The page is open at ${run.url}
Press Ctrl+C to close it.
`);
  if (opts.open) {
    const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
    try {
      spawn(cmd, [run.url], { stdio: "ignore", detached: true }).unref();
    } catch {
    }
  }
  await new Promise((resolve) => {
    const stop = () => {
      void run.close().then(resolve);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}
var MIME;
var init_server = __esm({
  "src/server.ts"() {
    "use strict";
    init_paths();
    init_store();
    init_update();
    init_lock();
    init_limits();
    init_context();
    init_items();
    init_format();
    MIME = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".woff2": "font/woff2",
      ".woff": "font/woff",
      ".json": "application/json",
      ".ico": "image/x-icon"
    };
  }
});

// src/cli.ts
init_paths();
init_store();
import fs12 from "node:fs";
import path12 from "node:path";
import readline from "node:readline";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// src/core/rank.ts
init_bm25();
init_text();
init_place();
var DAY = 864e5;
var PROMPT_BAR = 0.22;
var PROMPT_MIN_MATCH = 2;
var PROMPT_RARE = 0.05;
var PROMPT_COVER = 0.4;
var CHAT = new Set(
  "next done did fix fixed check checked continue carry ahead good great nice cool fine perfect awesome alright sound sounds think know mean said say tell told show give take put keep start stop finish finished run ran work works working worked wrong issue problem error bug change changes update updates add remove build test tests file files code page step steps part rest last first again better best idea plan point question answer help maybe probably actually today later time bit lot stuff something anything everything nothing little big small happen happened seem seems looks went come came thought ready wait hmm lol btw idk".split(" ").map(stem)
);
function promptTerms(ix, prompt) {
  const n = ix.bm25.n;
  const rareMax = Math.max(2, Math.ceil(PROMPT_RARE * n));
  const weight = /* @__PURE__ */ new Map();
  let total = 0;
  for (const t of new Set(tokens(prompt))) {
    if (CHAT.has(t)) continue;
    const df = (ix.bm25.get(t)?.length ?? 0) / 2;
    if (df > rareMax) continue;
    const w = idf(n, df);
    weight.set(t, w);
    total += w;
  }
  return { weight, total };
}
var REMOTE_BOOST = 1.3;
function recency(lastMs, now) {
  const age = Math.max(0, (now - lastMs) / DAY);
  return 0.4 + 0.6 * Math.exp(-age / 21);
}
function rankPrompt(ix, prompt, now = Date.now(), exclude = /* @__PURE__ */ new Set(), remote = null) {
  const { weight, total } = promptTerms(ix, prompt);
  if (weight.size < PROMPT_MIN_MATCH || !total) return [];
  const cover = /* @__PURE__ */ new Map();
  for (const [t, w] of weight) {
    const p = ix.bm25.get(t);
    if (!p) continue;
    for (let i = 0; i < p.length; i += 2) cover.set(p[i], (cover.get(p[i]) ?? 0) + w);
  }
  const hits = [];
  for (const s of search(ix.bm25, [...weight.keys()])) {
    const d = ix.docs[s.doc];
    if (!d || exclude.has(d.id) || exclude.has(d.s)) continue;
    if (s.matched < PROMPT_MIN_MATCH || (cover.get(s.doc) ?? 0) / total < PROMPT_COVER || s.norm < PROMPT_BAR) continue;
    let f = s.score * recency(d.t, now);
    if (remote && d.r === remote) f *= REMOTE_BOOST;
    hits.push({ ...s, final: f });
  }
  hits.sort((a, b) => b.final - a.final);
  return hits;
}

// src/cli.ts
init_format();
init_update();
init_lock();

// src/core/install.ts
init_fsx();
import fs8 from "node:fs";
import path8 from "node:path";
var HOOKS = [
  { event: "SessionStart", arg: "session-start", name: "Session start", does: "adds a short recall of your work in other folders" },
  { event: "UserPromptSubmit", arg: "prompt", name: "Your prompt", does: "adds past work that fits what you asked" },
  { event: "PreCompact", arg: "pre-compact", name: "Before a compact", does: "keeps what you pinned" },
  { event: "PostCompact", arg: "post-compact", name: "After a compact", does: "saves the new summary for later recall" },
  { event: "SessionEnd", arg: "session-end", name: "Session end", does: "saves the session for later recall" }
];
var EVENTS = HOOKS.map((h) => [h.event, h.arg]);
function hookName(arg) {
  return HOOKS.find((h) => h.arg === arg || h.event === arg)?.name ?? arg;
}
var ARGS = new Set(EVENTS.map(([, a]) => a));
function hookCommand(node, hookJs2, arg) {
  return `"${node}" "${hookJs2}" ${arg}`;
}
function isOurs(cmd, hookJs2) {
  if (typeof cmd !== "string") return false;
  if (hookJs2 && cmd.includes(`"${hookJs2}"`)) return true;
  const m = cmd.match(/"([^"]*claude-ctx[^"]*\/hook\.(?:js|ts))"\s+([a-z-]+)\s*$/);
  return !!m && ARGS.has(m[2]);
}
function inner(settings) {
  const out2 = [];
  const hooks = settings?.hooks;
  if (!hooks || typeof hooks !== "object") return out2;
  for (const event of Object.keys(hooks)) {
    const groups = hooks[event];
    if (!Array.isArray(groups)) continue;
    for (const g of groups) if (g && Array.isArray(g.hooks)) for (const h of g.hooks) out2.push({ event, command: h?.command });
  }
  return out2;
}
function countHooks(settings, hookJs2) {
  let ours = 0;
  let others = 0;
  const events = /* @__PURE__ */ new Set();
  for (const h of inner(settings)) {
    if (isOurs(h.command, hookJs2)) {
      ours++;
      events.add(h.event);
    } else others++;
  }
  return { ours, others, events };
}
function missingHooks(settings, hookJs2) {
  const have = countHooks(settings, hookJs2).events;
  return HOOKS.filter((h) => !have.has(h.event));
}
function withHooks(settings, node, hookJs2) {
  const next = structuredClone(settings);
  const missing = missingHooks(next, hookJs2);
  if (!missing.length) return next;
  if (!next.hooks || typeof next.hooks !== "object" || Array.isArray(next.hooks)) next.hooks = {};
  for (const h of missing) {
    const list = Array.isArray(next.hooks[h.event]) ? next.hooks[h.event] : [];
    list.push({ hooks: [{ type: "command", command: hookCommand(node, hookJs2, h.arg), timeout: h.event === "SessionEnd" ? 3 : 10 }] });
    next.hooks[h.event] = list;
  }
  return next;
}
function withoutHooks(settings, hookJs2) {
  const next = structuredClone(settings);
  const hooks = next.hooks;
  if (!hooks || typeof hooks !== "object") return next;
  for (const event of Object.keys(hooks)) {
    const groups = hooks[event];
    if (!Array.isArray(groups)) continue;
    const kept = [];
    for (const g of groups) {
      if (!g || !Array.isArray(g.hooks)) {
        kept.push(g);
        continue;
      }
      const inner2 = g.hooks.filter((h) => !isOurs(h?.command, hookJs2));
      if (inner2.length === g.hooks.length) kept.push(g);
      else if (inner2.length) kept.push({ ...g, hooks: inner2 });
    }
    if (kept.length) hooks[event] = kept;
    else delete hooks[event];
  }
  if (!Object.keys(hooks).length) delete next.hooks;
  return next;
}
function render(settings) {
  return JSON.stringify(settings, null, 2) + "\n";
}
function diffLines(a, b) {
  const x = a.split("\n");
  const y = b.split("\n");
  const n = x.length;
  const m = y.length;
  const lcs = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i2 = n - 1; i2 >= 0; i2--) for (let j2 = m - 1; j2 >= 0; j2--) lcs[i2][j2] = x[i2] === y[j2] ? lcs[i2 + 1][j2 + 1] + 1 : Math.max(lcs[i2 + 1][j2], lcs[i2][j2 + 1]);
  const out2 = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      out2.push({ sign: " ", text: x[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) out2.push({ sign: "-", text: x[i++] });
    else out2.push({ sign: "+", text: y[j++] });
  }
  while (i < n) out2.push({ sign: "-", text: x[i++] });
  while (j < m) out2.push({ sign: "+", text: y[j++] });
  return out2;
}
function readSettings(file) {
  let text = "";
  try {
    text = fs8.readFileSync(file, "utf8");
  } catch {
  }
  if (!text.trim()) return { text, data: {} };
  const data = JSON.parse(text);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("settings are not a JSON object");
  return { text, data };
}
function planInstall(file, node, hookJs2) {
  const { text, data } = readSettings(file);
  const missing = missingHooks(data, hookJs2);
  const counts = countHooks(data, hookJs2);
  const after = missing.length ? render(withHooks(data, node, hookJs2)) : text;
  const changes = missing.length ? diffLines(text, after).filter((d) => d.sign !== " ") : [];
  return { file, before: text, after, changes, exists: !!text.trim(), missing, ours: counts.ours, others: counts.others };
}
function planUninstall(file, hookJs2) {
  const { text, data } = readSettings(file);
  const cleaned = withoutHooks(data, hookJs2);
  const counts = countHooks(data, hookJs2);
  const after = text.trim() ? render(cleaned) : text;
  const same = JSON.stringify(cleaned) === JSON.stringify(data);
  return {
    file,
    before: text,
    after: same ? text : after,
    changes: same ? [] : diffLines(text, after).filter((d) => d.sign !== " "),
    exists: !!text.trim(),
    missing: missingHooks(data, hookJs2),
    ours: counts.ours,
    others: counts.others
  };
}
function backupPath(file) {
  return path8.join(path8.dirname(file), path8.basename(file) + ".claude-ctx-backup");
}
function apply(plan) {
  if (plan.before) atomicWrite(backupPath(plan.file), plan.before);
  atomicWrite(plan.file, plan.after);
}

// src/cli.ts
init_fsx();

// src/core/doctor.ts
init_lines();
init_records();
init_update();
async function doctor(claude, onFile) {
  const t0 = Date.now();
  const files = listTranscripts(claude);
  const rep = {
    transcripts: files.length,
    bytes: files.reduce((a, f) => a + f.size, 0),
    lines: 0,
    unreadable: 0,
    understood: {},
    skipped: {},
    checks: { replies: 0, usage: 0, compactions: 0, compactionsWithTokens: 0, summaries: 0, titles: 0, prompts: 0, edits: 0, shapes: 0 },
    ms: 0
  };
  const inc = (o, k) => o[k] = (o[k] || 0) + 1;
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
      const type = typeof r.type === "string" ? r.type : "(none)";
      const key2 = type === "system" && typeof r.subtype === "string" ? `system/${r.subtype}` : type;
      if (UNDERSTOOD.has(type)) inc(rep.understood, key2);
      else inc(rep.skipped, key2);
      if (type === "assistant") {
        rep.checks.replies++;
        if (usageOf(r)) rep.checks.usage++;
        rep.checks.edits += editPaths(r).length;
      } else if (isCompactBoundary(r)) {
        rep.checks.compactions++;
        const m = r.compactMetadata;
        if (m && typeof m.preTokens === "number" && typeof m.postTokens === "number") rep.checks.compactionsWithTokens++;
      } else if (compactSummaryText(r)) rep.checks.summaries++;
      else if (titleOf(r)) rep.checks.titles++;
      else if (promptText(r)) rep.checks.prompts++;
      else if (type === "api-request-shape" && r.shape && Array.isArray(r.shape.system)) rep.checks.shapes++;
    }
  }
  rep.ms = Date.now() - t0;
  return rep;
}

// src/cli.ts
init_bm25();
init_text();
init_limits();

// src/core/budget.ts
init_fsx();
init_lock();
init_items();
init_store();
init_limits();
import fs10 from "node:fs";
import path9 from "node:path";
var SEEN_DAYS = 7;
var ITEM_DAYS = 30;
var DAY2 = 864e5;
var LEFTOVER_MS = 10 * 6e4;
var QUICK_LOCK_MS = 6e4;
function storeSize(home3) {
  let total = 0;
  const walk = (dir) => {
    let ents;
    try {
      ents = fs10.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const p = path9.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else {
        try {
          total += fs10.statSync(p).size;
        } catch {
        }
      }
    }
  };
  walk(home3);
  return total;
}
function entries(dir) {
  const out2 = [];
  let names;
  try {
    names = fs10.readdirSync(dir);
  } catch {
    return out2;
  }
  for (const name of names) {
    const p = path9.join(dir, name);
    try {
      const s = fs10.statSync(p);
      out2.push({ path: p, name, size: s.size, mtime: s.mtimeMs, dir: s.isDirectory() });
    } catch {
    }
  }
  return out2;
}
function remove(p) {
  try {
    fs10.rmSync(p, { recursive: true, force: true });
  } catch {
  }
}
function sweepLeftovers(st, now = Date.now()) {
  let n = 0;
  const pendingBase = path9.basename(st.pending);
  const index = readJson(st.index);
  for (const dir of [st.home, st.sessions, st.seen]) {
    for (const e of entries(dir)) {
      if (!e.dir && e.name.endsWith(".tmp") && now - e.mtime > LEFTOVER_MS) {
        remove(e.path);
        n++;
      } else if (dir === st.home && !e.dir && e.name.startsWith(pendingBase + ".") && e.name.endsWith(".claim")) {
        const pid = Number(e.name.slice(pendingBase.length + 1, -".claim".length));
        if (pid === process.pid || alive(pid) && now - e.mtime < LEFTOVER_MS) continue;
        try {
          const text = fs10.readFileSync(e.path, "utf8");
          if (text.trim()) fs10.appendFileSync(st.pending, text.endsWith("\n") ? text : text + "\n");
        } catch {
        }
        remove(e.path);
        n++;
      } else if (dir === st.home && e.dir && e.name.endsWith(".lock") && now - e.mtime > QUICK_LOCK_MS) {
        remove(e.path);
        n++;
      } else if (dir === st.home && !e.dir && /^terms-.*\.jsonl$/.test(e.name) && index && e.name !== index.terms && now - e.mtime > LEFTOVER_MS) {
        remove(e.path);
        n++;
      }
    }
  }
  return n;
}
function sweepSeen(st, now) {
  for (const e of entries(st.seen)) if (now - e.mtime > SEEN_DAYS * DAY2) remove(e.path);
}
function sessionAges(st) {
  const ages = /* @__PURE__ */ new Map();
  const ix = readJson(st.index);
  for (const d of ix?.docs ?? []) ages.set(d.s, Math.max(ages.get(d.s) ?? 0, d.t));
  return ages;
}
function pruneSessions(st, max, ages) {
  const files = entries(st.sessions).filter((e) => !e.dir && e.name.endsWith(".json"));
  let total = files.reduce((a, e) => a + e.size, 0);
  if (total <= max) return 0;
  const key2 = (e) => ages.get(e.name.slice(0, -5)) ?? 0;
  files.sort((a, b) => key2(a) - key2(b) || a.mtime - b.mtime);
  let n = 0;
  for (const e of files) {
    if (total <= max) break;
    remove(e.path);
    total -= e.size;
    n++;
  }
  return n;
}
function enforce(st, opts = {}) {
  const budget = opts.budget ?? budgetBytes();
  const now = opts.now ?? Date.now();
  const share = shares(budget);
  const before = storeSize(st.home);
  const leftovers = sweepLeftovers(st, now);
  for (const f of [st.log, st.trace]) {
    try {
      cutFile(f, share.log);
    } catch {
    }
  }
  sweepSeen(st, now);
  const ages = sessionAges(st);
  const items = pruneItems(st, (it) => {
    if (it.session === "*") return true;
    const seen = Math.max(ages.get(it.session) ?? 0, Date.parse(it.at) || 0);
    return now - seen <= ITEM_DAYS * DAY2;
  });
  let sessions = pruneSessions(st, share.sessions, ages);
  let cards = 0;
  let cardBytes = 0;
  try {
    cardBytes = fs10.statSync(st.cards).size;
  } catch {
  }
  if (cardBytes > share.cards) {
    const all = loadCards(st);
    cards = all.length - writeCardsAndIndex(st, all, share.cards).docs.length;
  }
  let after = storeSize(st.home);
  if (after > budget) {
    sessions += pruneSessions(st, Math.max(0, share.sessions - (after - budget)), sessionAges(st));
    after = storeSize(st.home);
  }
  if (after > budget) {
    const all = loadCards(st);
    const room = Math.max(0, Math.floor(share.cards - (after - budget) * 0.8));
    cards += all.length - writeCardsAndIndex(st, all, room).docs.length;
    after = storeSize(st.home);
  }
  return { before, after, budget, leftovers, items, sessions, cards };
}

// src/cli.ts
var VERSION = "0.1.0";
var here = path12.dirname(fileURLToPath2(import.meta.url));
var ext = path12.extname(fileURLToPath2(import.meta.url));
var hookJs = path12.join(here, "hook" + ext);
var tty = !!process.stdout.isTTY && !!process.stdin.isTTY;
var interactive = tty || !!process.env.CLAUDE_CTX_TTY;
var bold = (s) => process.stdout.isTTY ? `\x1B[1m${s}\x1B[22m` : s;
var dim = (s) => process.stdout.isTTY ? `\x1B[2m${s}\x1B[22m` : s;
var out = (s = "") => process.stdout.write(s + "\n");
var num = (n) => n.toLocaleString("en-US");
var many = (n, one, more = one + "s") => `${num(n)} ${n === 1 ? one : more}`;
var NAME_W = Math.max(...HOOKS.map((h) => h.name.length)) + 2;
var COMMANDS = [
  ["claude-ctx", "open the page"],
  ["claude-ctx search <words>", "find past sessions"],
  ["claude-ctx index", "read new transcripts into cards"],
  ["claude-ctx install", "add the hooks to Claude Code"],
  ["claude-ctx uninstall", "take the hooks out again"],
  ["claude-ctx status", "show whether the hooks run"],
  ["claude-ctx doctor", "count each record type it understood"]
];
function commandList() {
  const w = Math.max(...COMMANDS.map(([c]) => c.length));
  return COMMANDS.map(([c, d]) => `  ${c.padEnd(w)}  ${dim(d)}`).join("\n");
}
async function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await new Promise((res) => rl.question(q, res));
  } finally {
    rl.close();
  }
}
async function cmdSearch(st, words) {
  let q = words.join(" ").trim();
  if (!q && tty) q = (await ask("Search for: ")).trim();
  const ix = loadIndex(st);
  if (!ix || !ix.docs.length) {
    out("No cards yet, so run claude-ctx index to read your past sessions.");
    return;
  }
  let docs;
  if (!q) {
    docs = ix.docs.map((_, i) => i).sort((a, b) => ix.docs[b].t - ix.docs[a].t).slice(0, 5);
    out(dim("Newest sessions first, and words narrow the list, like claude-ctx search heat map."));
  } else {
    const hits = rankPrompt(ix, q, Date.now(), /* @__PURE__ */ new Set(), null);
    docs = hits.slice(0, 8).map((h) => h.doc);
    if (!docs.length) docs = search(ix.bm25, tokens(q)).slice(0, 5).map((h) => h.doc);
    if (!docs.length) {
      out(`Nothing matches "${q}". Try fewer or different words.`);
      return;
    }
  }
  for (const c of readCards(st, ix, docs)) {
    out();
    out(renderCard(c, 900).replace(/^## (.*)$/m, (_m, h) => bold(h)));
    out(dim(`  ${c.id}`));
  }
}
async function cmdIndex(st, full, quiet = false) {
  const claude = claudeDir();
  const files = listTranscripts(claude);
  if (!files.length) {
    out(`No transcripts in ${tilde(path12.join(claude, "projects"))} yet.`);
    return;
  }
  if (!await waitLock(st.lock, WORKER_LIMIT_MS + 5e3, 6e4)) {
    out("Another claude-ctx update is running, so try again in a minute.");
    return;
  }
  const t0 = Date.now();
  try {
    if (full) {
      fs12.rmSync(st.sessions, { recursive: true, force: true });
      fs12.rmSync(st.cards, { force: true });
    }
    const total = files.reduce((a, f) => a + f.size, 0);
    if (!quiet) out(`Reading ${num(files.length)} transcripts, ${(total / 1e6).toFixed(0)} MB`);
    const res = await applyJobs(
      st,
      claude,
      files.map((f) => ({ session: f.session, transcript: f.transcript })),
      (done, n) => {
        if (process.stdout.isTTY) process.stdout.write(`\r${done} of ${n}`);
      }
    );
    if (process.stdout.isTTY) process.stdout.write("\r");
    enforce(st);
    out(`${num(res.cards)} card${res.cards === 1 ? "" : "s"} from ${num(res.sessions)} session${res.sessions === 1 ? "" : "s"} in ${((Date.now() - t0) / 1e3).toFixed(1)} s`);
    if (!quiet) out(dim(`Store ${tilde(st.home)}`));
  } finally {
    releaseLock(st.lock);
  }
}
function showPlan(p) {
  const paint = (code, t) => process.stdout.isTTY ? `\x1B[${code}m${t}\x1B[39m` : t;
  for (const d of p.changes) out(d.sign === "+" ? paint(32, `+ ${d.text}`) : paint(31, `- ${d.text}`));
}
async function confirm(q, yes, hint) {
  if (yes) return true;
  if (!interactive) {
    out(dim(hint));
    return false;
  }
  const ok = /^y(es)?$/i.test((await ask(q)).trim());
  if (!ok) out("Nothing was changed.");
  return ok;
}
function othersLine(p) {
  return p.others ? `Your ${many(p.others, "other hook")} and your settings stay as they are.` : "Your settings stay as they are.";
}
function listHooks(hooks) {
  const names = hooks.map((h) => h.name);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names.join("");
}
async function firstRead(st) {
  const claude = claudeDir();
  const files = listTranscripts(claude);
  if (!files.length) return;
  const label = "Reading your past sessions";
  out(label);
  const t0 = Date.now();
  let locked = false;
  try {
    locked = await waitLock(st.lock, WORKER_LIMIT_MS + 5e3, 6e4);
    if (!locked) throw new Error("the store stayed locked");
    const res = await applyJobs(
      st,
      claude,
      files.map((f) => ({ session: f.session, transcript: f.transcript })),
      (done, n) => {
        if (process.stdout.isTTY) process.stdout.write(`\r${done} of ${n}`);
      }
    );
    if (process.stdout.isTTY) process.stdout.write("\r\x1B[K");
    enforce(st);
    const secs = (Date.now() - t0) / 1e3;
    out(`${many(res.sessions, "session")} read in ${secs < 10 ? secs.toFixed(1) : secs.toFixed(0)} s`);
  } catch (e) {
    if (process.stdout.isTTY) process.stdout.write("\r\x1B[K");
    logError(st.log, "install index", e);
    out("Reading past sessions failed, so run claude-ctx index once.");
  } finally {
    if (locked) releaseLock(st.lock);
  }
}
async function cmdInstall(args, yes) {
  const file = path12.join(claudeDir(), "settings.json");
  if (!fs12.existsSync(hookJs)) {
    out(`The hook file ${hookJs} is missing, so run npm run build first.`);
    return;
  }
  let p;
  try {
    p = planInstall(file, process.execPath, hookJs);
  } catch {
    out(`Nothing was changed because ${tilde(file)} is not valid JSON, so fix the file and run claude-ctx install again.`);
    return;
  }
  const n = p.missing.length;
  if (!n) {
    out(`All ${HOOKS.length} claude-ctx hooks are already in place.`);
    return;
  }
  if (args.includes("--lines")) {
    out(`Lines for ${tilde(file)}`);
    showPlan(p);
  } else {
    out(bold(`claude-ctx adds ${many(n, "hook")} to Claude Code`));
    out();
    for (const h of p.missing) out(`  ${h.name.padEnd(NAME_W)}${h.does}`);
    out();
    out("Nothing is removed and your context is never cleared.");
    if (p.exists) {
      out(othersLine(p));
      out(`The current file is kept at ${tilde(backupPath(file))}`);
    } else out(`A new ${tilde(file)} is made to hold the hooks.`);
    out("Undo with claude-ctx uninstall");
  }
  out();
  if (!await confirm(n === 1 ? "Add the hook? y or n " : "Add the hooks? y or n ", yes, "Run claude-ctx install --yes to add the hooks.")) return;
  apply(p);
  const st = store(ctxHome());
  if (!loadIndex(st)) await firstRead(st);
  out(`${many(n, "hook")} added.`);
  out("Sessions already open miss the opening recall.");
  out("New Claude Code sessions in any folder open with a recall of your work elsewhere, and the claude-ctx command shows the page.");
}
async function cmdUninstall(args, yes) {
  const file = path12.join(claudeDir(), "settings.json");
  let p;
  try {
    p = planUninstall(file, hookJs);
  } catch {
    out(`Nothing was changed because ${tilde(file)} is not valid JSON.`);
    return;
  }
  if (!p.changes.length) {
    out("No claude-ctx hooks found.");
    return;
  }
  if (args.includes("--lines")) {
    out(`Lines to take out of ${tilde(file)}`);
    showPlan(p);
  } else {
    const home3 = tilde(ctxHome());
    out(bold(`claude-ctx removes ${many(p.ours, "hook")} from Claude Code`));
    out();
    out(othersLine(p));
    out(`Your cards stay in ${home3} until you run rm -r ${home3}`);
  }
  out();
  if (!await confirm(p.ours === 1 ? "Remove the hook? y or n " : "Remove the hooks? y or n ", yes, "Run claude-ctx uninstall --yes to remove the hooks.")) return;
  apply(p);
  out(`${many(p.ours, "hook")} removed.`);
}
async function cmdDoctor(st) {
  const claude = claudeDir();
  const rep = await doctor(claude, (i, n) => {
    if (process.stdout.isTTY) process.stdout.write(`\r${i + 1} of ${n}`);
  });
  if (process.stdout.isTTY) process.stdout.write("\r");
  out(`${num(rep.transcripts)} transcripts in ${tilde(path12.join(claude, "projects"))}, ${(rep.bytes / 1e6).toFixed(0)} MB, ${num(rep.lines)} records`);
  out(`${num(rep.unreadable)} records unreadable`);
  const block = (title, o) => {
    out();
    out(bold(title));
    const rows = Object.entries(o).sort((a, b) => b[1] - a[1]);
    const w = Math.max(0, ...rows.map(([k]) => k.length));
    for (const [k, v] of rows) out(`  ${k.padEnd(w)}  ${num(v)}`);
  };
  block("Understood", rep.understood);
  block("Skipped", rep.skipped);
  out();
  out(bold("Read from them"));
  const c = rep.checks;
  out(`  usage blocks         ${num(c.usage)} of ${num(c.replies)} replies`);
  out(`  compactions          ${num(c.compactions)}, ${num(c.compactionsWithTokens)} with token counts`);
  out(`  compaction summaries ${num(c.summaries)}`);
  out(`  AI titles            ${num(c.titles)}`);
  out(`  prompts              ${num(c.prompts)}`);
  out(`  file edits           ${num(c.edits)}`);
  out(`  request shapes       ${num(c.shapes)}`);
  const ix = loadIndex(st);
  out();
  out(ix ? `Store ${tilde(st.home)} holds ${num(ix.docs.length)} cards, indexed ${day(ix.built)}` : `Store ${tilde(st.home)} is empty, so run claude-ctx index.`);
}
function ago(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1e3);
  if (s < 90) return "just now";
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}
function cmdStatus(st) {
  const file = path12.join(claudeDir(), "settings.json");
  const rows = [];
  let settings = {};
  try {
    settings = JSON.parse(fs12.readFileSync(file, "utf8"));
  } catch {
  }
  const events = HOOKS.filter((hk) => Array.isArray(settings.hooks?.[hk.event]) && settings.hooks[hk.event].some((g) => (g?.hooks ?? []).some((h) => isOurs(h?.command, hookJs))));
  const missing = HOOKS.filter((hk) => !events.includes(hk));
  const plugin = Object.entries(settings.enabledPlugins ?? {}).some(([k, v]) => k.startsWith("ctx@") && v);
  if (events.length) rows.push(["Hooks", `${events.length} of ${HOOKS.length} in ${tilde(file)}${missing.length ? `, missing ${listHooks(missing)}` : ""}`]);
  else if (plugin) rows.push(["Hooks", "from the ctx plugin"]);
  else rows.push(["Hooks", "not installed, run claude-ctx install"]);
  const ix = loadIndex(st);
  const mb = (n) => `${n / MB < 10 ? (n / MB).toFixed(1) : Math.round(n / MB)} MB`;
  rows.push(["Store", `${mb(storeSize(st.home))} of ${mb(budgetBytes())}`]);
  rows.push(["Cards", ix ? `${num(ix.docs.length)}, indexed ${ago(Date.parse(ix.built))}` : "none yet, run claude-ctx index"]);
  let last = null;
  try {
    last = JSON.parse(fs12.readFileSync(st.last, "utf8"));
  } catch {
  }
  rows.push(["Last hook", last ? `${hookName(last.event)}, ${ago(last.at)}, printed ${num(last.chars)} characters in ${last.ms} ms` : "none has run yet"]);
  let err = "";
  try {
    const lines = fs12.readFileSync(st.log, "utf8").trim().split("\n");
    err = lines[lines.length - 1] ?? "";
  } catch {
  }
  rows.push(["Last error", err ? err.slice(0, 160) : "none"]);
  for (const [k, v] of rows) out(`${bold(k.padEnd(10))} ${v}`);
}
async function cmdOpen(st, args) {
  const ix = loadIndex(st);
  if ((!ix || !ix.docs.length) && listTranscripts(claudeDir()).length) {
    out("No cards yet, so reading past sessions into cards first.");
    await cmdIndex(st, false, true);
  }
  const { serve: serve2 } = await Promise.resolve().then(() => (init_server(), server_exports));
  await serve2(st, { open: !args.includes("--no-open") && !process.env.CLAUDE_CTX_NO_OPEN, port: Number(process.env.CLAUDE_CTX_PORT) || 0 });
}
async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const st = store(ctxHome());
  const yes = rest.includes("--yes") || rest.includes("-y");
  switch (cmd) {
    case void 0:
    case "open":
    case "--no-open":
      return cmdOpen(st, cmd === "--no-open" ? [cmd, ...rest] : rest);
    case "search":
    case "s":
      return cmdSearch(st, rest);
    case "index":
      return cmdIndex(st, rest.includes("--full"));
    case "install":
      return cmdInstall(rest, yes);
    case "uninstall":
      return cmdUninstall(rest, yes);
    case "doctor":
      return cmdDoctor(st);
    case "status":
      return cmdStatus(st);
    case "help":
    case "--help":
    case "-h":
      out(commandList());
      return;
    case "version":
    case "--version":
    case "-v":
      out(VERSION);
      return;
    default: {
      const near = COMMANDS.map(([c]) => c.split(" ")[1]).filter(Boolean).find((c) => c && (c.startsWith(cmd.slice(0, 2)) || cmd.startsWith(c.slice(0, 3))));
      out(near ? `There is no ${cmd} command, the closest is claude-ctx ${near}.` : `There is no ${cmd} command.`);
      out(commandList());
    }
  }
}
process.stdout.on("error", (e) => {
  if (e.code === "EPIPE") process.exit(0);
});
main().catch((e) => {
  process.stderr.write(`claude-ctx: ${e instanceof Error ? e.message : String(e)}
`);
  process.exitCode = 1;
});
