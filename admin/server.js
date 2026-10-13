'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const port = Number(process.env.ADMIN_PORT || 8766);
const host = '127.0.0.1';
const root = path.join(__dirname, 'public');
const opnsenseUrl = process.env.OPNSENSE_URL || '';
const opnsenseKey = process.env.OPNSENSE_KEY || '';
const opnsenseSecret = process.env.OPNSENSE_SECRET || '';
const interfaceId = process.env.OPNSENSE_INTERFACE || 'wan';
const zoneId = process.env.OPNSENSE_ZONE || '0';
const zabbixUrl = process.env.ZABBIX_URL || '';
const zabbixToken = process.env.ZABBIX_TOKEN || '';
const live = !!(opnsenseUrl && opnsenseKey && opnsenseSecret);
const sampleHistory = [];
let lastCounters = null;

function requireHttps(value, label) {
  if (value && new URL(value).protocol !== 'https:') throw new Error(`${label} must use HTTPS`);
}
if (live) {
  requireHttps(opnsenseUrl, 'OPNSENSE_URL');
  if (!process.env.ADMIN_USER || !process.env.ADMIN_PASSWORD) throw new Error('Live mode requires ADMIN_USER and ADMIN_PASSWORD');
}
if (zabbixUrl || zabbixToken) {
  if (!live || !zabbixUrl || !zabbixToken) throw new Error('Zabbix requires live OPNsense mode, ZABBIX_URL, and ZABBIX_TOKEN');
  requireHttps(zabbixUrl, 'ZABBIX_URL');
}
if (!/^\d{1,2}$/.test(zoneId) || !/^[a-zA-Z0-9_-]+$/.test(interfaceId)) throw new Error('Invalid OPNsense interface or zone');

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'", 'Referrer-Policy': 'no-referrer' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

function safeEquals(a, b) {
  const left = Buffer.from(a || '');
  const right = Buffer.from(b || '');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function authorized(req) {
  if (!live) return true;
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  let pair;
  try { pair = Buffer.from(header.slice(6), 'base64').toString('utf8'); } catch { return false; }
  const split = pair.indexOf(':');
  if (split < 0) return false;
  return safeEquals(pair.slice(0, split), process.env.ADMIN_USER) && safeEquals(pair.slice(split + 1), process.env.ADMIN_PASSWORD);
}

function number(value) { const parsed = Number(value); return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0; }
function pushSample(sample) { sampleHistory.push(sample); if (sampleHistory.length > 36) sampleHistory.shift(); }

async function opn(pathname) {
  const url = new URL(pathname, opnsenseUrl.replace(/\/?$/, '/'));
  const response = await fetch(url, { headers: { Authorization: `Basic ${Buffer.from(`${opnsenseKey}:${opnsenseSecret}`).toString('base64')}`, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`OPNsense returned HTTP ${response.status}`);
  const data = await response.json();
  if (data === null || typeof data !== 'object') throw new Error('Unexpected OPNsense response');
  return data;
}

async function zbx(method, params) {
  const response = await fetch(zabbixUrl, { method: 'POST', headers: { Authorization: `Bearer ${zabbixToken}`, 'Content-Type': 'application/json-rpc' }, body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }), signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Zabbix returned HTTP ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || 'Zabbix API error');
  return data.result;
}

function normalizeSessions(raw) {
  const records = Array.isArray(raw) ? raw : Array.isArray(raw.rows) ? raw.rows : Array.isArray(raw.sessions) ? raw.sessions : Array.isArray(raw.clients) ? raw.clients : Object.values(raw || {}).filter(v => v && typeof v === 'object' && !Array.isArray(v));
  return records.map(item => ({
    user: String(item.userName || item.username || 'Unknown'),
    ip: String(item.ipAddress || ''),
    started: number(item.startTime),
    bytesIn: number(item.bytes_in),
    bytesOut: number(item.bytes_out),
    zone: String(item.zoneid ?? zoneId)
  })).filter(item => item.ip).sort((a, b) => b.bytesIn + b.bytesOut - a.bytesIn - a.bytesOut);
}

async function liveOverview() {
  const errors = [];
  const [trafficResult, sessionsResult, zonesResult] = await Promise.allSettled([
    opn('/api/diagnostics/traffic/interface'),
    opn(`/api/captiveportal/session/list/${zoneId}`),
    opn('/api/captiveportal/session/zones')
  ]);
  let interfaceName = interfaceId;
  let inbound = 0;
  let outbound = 0;
  let totalIn = 0;
  let totalOut = 0;
  if (trafficResult.status === 'fulfilled') {
    const intf = trafficResult.value.interfaces?.[interfaceId];
    if (intf) {
      interfaceName = String(intf.name || interfaceId);
      totalIn = number(intf['bytes received']);
      totalOut = number(intf['bytes transmitted']);
      const now = Date.now();
      if (lastCounters && now > lastCounters.time && totalIn >= lastCounters.in && totalOut >= lastCounters.out) {
        const seconds = (now - lastCounters.time) / 1000;
        inbound = Math.round((totalIn - lastCounters.in) * 8 / seconds);
        outbound = Math.round((totalOut - lastCounters.out) * 8 / seconds);
      }
      lastCounters = { in: totalIn, out: totalOut, time: now };
    } else errors.push(`Interface “${interfaceId}” was not returned by OPNsense.`);
  } else errors.push(`Traffic: ${trafficResult.reason.message}`);
  pushSample({ time: Date.now(), inbound, outbound });

  const sessions = sessionsResult.status === 'fulfilled' ? normalizeSessions(sessionsResult.value) : [];
  if (sessionsResult.status === 'rejected') errors.push(`Sessions: ${sessionsResult.reason.message}`);
  const zones = zonesResult.status === 'fulfilled' ? zonesResult.value : {};
  if (zonesResult.status === 'rejected') errors.push(`Zones: ${zonesResult.reason.message}`);

  let hosts = [];
  let problems = [];
  if (zabbixUrl) {
    const [hostResult, problemResult] = await Promise.allSettled([
      zbx('host.get', { output: ['hostid', 'name', 'status'], selectInterfaces: ['available'], monitored_hosts: true, sortfield: 'name', limit: 30 }),
      zbx('problem.get', { output: ['eventid', 'name', 'severity', 'clock'], recent: false, sortfield: ['eventid'], sortorder: 'DESC', limit: 6 })
    ]);
    if (hostResult.status === 'fulfilled') hosts = hostResult.value.map(h => ({ name: h.name, status: h.interfaces?.some(i => i.available === '1') ? 'online' : h.interfaces?.some(i => i.available === '2') ? 'offline' : 'unknown' }));
    else errors.push(`Zabbix hosts: ${hostResult.reason.message}`);
    if (problemResult.status === 'fulfilled') problems = problemResult.value.map(p => ({ name: p.name, severity: number(p.severity), time: number(p.clock) }));
    else errors.push(`Zabbix alerts: ${problemResult.reason.message}`);
  }
  return { mode: 'live', timestamp: Date.now(), interface: interfaceName, zone: String(zones[zoneId] || `Zone ${zoneId}`), rates: { inbound, outbound }, totals: { inbound: totalIn, outbound: totalOut }, history: sampleHistory, sessions, hosts, problems, zabbixConfigured: !!zabbixUrl, errors };
}

function demoOverview() {
  const t = Date.now();
  if (!sampleHistory.length) {
    for (let i = 35; i >= 1; i--) {
      const past = t - i * 5000;
      const p = past / 18000;
      pushSample({ time: past, inbound: Math.round((4.8 + Math.sin(p) * 1.7 + Math.sin(p * 2.4) * .55) * 1e6), outbound: Math.round((1.6 + Math.cos(p * .8) * .6 + Math.sin(p * 1.9) * .2) * 1e6) });
    }
  }
  const phase = t / 18000;
  const inbound = Math.round((4.8 + Math.sin(phase) * 1.7 + Math.sin(phase * 2.4) * .55) * 1e6);
  const outbound = Math.round((1.6 + Math.cos(phase * .8) * .6 + Math.sin(phase * 1.9) * .2) * 1e6);
  pushSample({ time: t, inbound, outbound });
  return { mode: 'demo', timestamp: t, interface: 'WAN · simulated', zone: 'School Wi-Fi · simulated', rates: { inbound, outbound }, totals: { inbound: 18.6e9, outbound: 6.4e9 }, history: sampleHistory, sessions: [
    { user: 'Demo student A', ip: '192.0.2.11', started: Math.floor(t / 1000) - 2100, bytesIn: 620e6, bytesOut: 72e6, zone: '0' },
    { user: 'Demo teacher B', ip: '192.0.2.12', started: Math.floor(t / 1000) - 4200, bytesIn: 312e6, bytesOut: 48e6, zone: '0' },
    { user: 'Demo staff C', ip: '192.0.2.13', started: Math.floor(t / 1000) - 860, bytesIn: 108e6, bytesOut: 15e6, zone: '0' }
  ], hosts: [ { name: 'OPNsense firewall · demo', status: 'online' }, { name: 'TP-Link switch · demo', status: 'online' }, { name: 'Access point 01 · demo', status: 'online' }, { name: 'Access point 02 · demo', status: 'offline' } ], problems: [{ name: 'Demo access point 02 is unreachable', severity: 3, time: Math.floor(t / 1000) - 300 }], zabbixConfigured: true, errors: [] };
}

const assets = { '/': ['index.html', 'text/html; charset=utf-8'], '/styles.css': ['styles.css', 'text/css; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'] };
const server = http.createServer(async (req, res) => {
  if (!authorized(req)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Ilaya IT Dashboard"', 'Cache-Control': 'no-store' });
    res.end('Administrator credentials required');
    return;
  }
  const pathname = new URL(req.url, `http://${host}`).pathname;
  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
  if (pathname === '/api/overview') {
    try { return send(res, 200, live ? await liveOverview() : demoOverview()); }
    catch (error) { return send(res, 502, { error: error.message }); }
  }
  const asset = assets[pathname];
  if (!asset) return send(res, 404, { error: 'Not found' });
  try { return send(res, 200, fs.readFileSync(path.join(root, asset[0])), asset[1]); }
  catch { return send(res, 500, { error: 'Could not load dashboard' }); }
});

server.listen(port, host, () => console.log(`Ilaya IT dashboard (${live ? 'live' : 'demo'}) at http://${host}:${port}/`));
