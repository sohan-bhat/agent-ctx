import fs from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import dgram from 'node:dgram';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

const log = process.env.CLAUDE_CTX_NET_LOG;

function record(kind, detail) {
  if (log) fs.appendFileSync(log, `${process.pid} ${kind} ${String(detail).slice(0, 200)}\n`);
  const e = new Error(`blocked outgoing ${kind}`);
  e.code = 'ECTXNET';
  throw e;
}

const origConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const a = args[0];
  const target = typeof a === 'object' && a ? a.path ?? `${a.host ?? 'localhost'}:${a.port}` : `${args[1] ?? 'localhost'}:${a}`;
  if (typeof a === 'object' && a && a.path) return origConnect.apply(this, args);
  record('tcp', target);
};
net.connect = net.createConnection = (...args) => record('tcp', JSON.stringify(args[0]));
tls.connect = (...args) => record('tls', JSON.stringify(args[0]));
const local = (h) => typeof h === 'string' && (net.isIP(h) !== 0 || h === 'localhost');
const origLookup = dns.lookup;
dns.lookup = (...args) => (local(args[0]) ? origLookup.apply(dns, args) : record('dns', args[0]));
for (const k of ['resolve', 'resolve4', 'resolve6', 'resolveAny']) dns[k] = (...args) => record('dns', args[0]);
for (const k of ['lookup', 'resolve', 'resolve4', 'resolve6']) if (dns.promises) dns.promises[k] = async (...args) => record('dns', args[0]);
http.request = http.get = (...args) => record('http', typeof args[0] === 'string' ? args[0] : JSON.stringify(args[0]));
https.request = https.get = (...args) => record('https', typeof args[0] === 'string' ? args[0] : JSON.stringify(args[0]));
dgram.createSocket = (...args) => record('udp', JSON.stringify(args[0]));
globalThis.fetch = async (u) => record('fetch', u);
if (globalThis.WebSocket) globalThis.WebSocket = function (u) { record('websocket', u); };

const allowed = new Set([process.execPath]);
for (const k of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync', 'fork']) {
  const orig = cp[k];
  cp[k] = function (file, ...rest) {
    if (k === 'fork' || allowed.has(file)) return orig.call(this, file, ...rest);
    record('process', file);
  };
}
syncBuiltinESMExports();
