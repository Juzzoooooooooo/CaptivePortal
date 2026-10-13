(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  let current = null;
  let busy = false;
  const dateFormat = new Intl.DateTimeFormat('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' });
  const timeFormat = new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' });
  $('header-date').textContent = dateFormat.format(new Date());

  function text(id, value) { $(id).textContent = value; }
  function bps(value) {
    const n = Number(value) || 0;
    if (n >= 1e9) return [(n / 1e9).toFixed(2), 'Gbps'];
    if (n >= 1e6) return [(n / 1e6).toFixed(2), 'Mbps'];
    if (n >= 1e3) return [(n / 1e3).toFixed(1), 'Kbps'];
    return [Math.round(n).toString(), 'bps'];
  }
  function bytes(value) {
    const n = Number(value) || 0;
    if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)} KB`;
    return `${Math.round(n)} B`;
  }
  function rateMetric(id, value) {
    const [num, unit] = bps(value);
    $(id).textContent = num;
    const small = document.createElement('small');
    small.textContent = unit;
    $(id).append(small);
  }
  function make(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = String(content);
    return node;
  }

  function renderChart(history) {
    const items = (Array.isArray(history) ? history : []).slice(-36);
    const max = Math.max(1e6, ...items.map(p => Math.max(Number(p.inbound) || 0, Number(p.outbound) || 0)));
    const rounded = Math.ceil(max / 1e6 / 2) * 2;
    text('axis-max', rounded);
    text('axis-mid', rounded / 2);
    const ceiling = rounded * 1e6;
    const x = i => items.length < 2 ? 0 : i * 600 / (items.length - 1);
    const y = n => Math.max(8, 215 - Math.min(1, n / ceiling) * 197);
    const points = key => items.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(Number(p[key]) || 0).toFixed(1)}`).join(' ');
    const inPoints = points('inbound');
    $('in-path').setAttribute('d', inPoints);
    $('out-path').setAttribute('d', points('outbound'));
    $('area-path').setAttribute('d', items.length ? `${inPoints} L600 220 L0 220 Z` : '');
    text('chart-start', items.length ? timeFormat.format(new Date(items[0].time)) : '—');
    text('chart-end', items.length ? timeFormat.format(new Date(items[items.length - 1].time)) : 'Now');
  }

  function renderSessions(sessions) {
    const query = $('session-search').value.trim().toLowerCase();
    const rows = sessions.filter(s => `${s.user} ${s.ip}`.toLowerCase().includes(query));
    const body = $('session-rows');
    body.replaceChildren();
    if (!rows.length) {
      const tr = make('tr');
      const td = make('td', 'empty-row', query ? 'No matching sessions.' : 'No active sessions found.');
      td.colSpan = 4;
      tr.append(td);
      body.append(tr);
      return;
    }
    rows.forEach(session => {
      const tr = make('tr');
      const userCell = make('td');
      const wrapper = make('div', 'user-cell');
      wrapper.append(make('span', 'user-initial', (session.user || '?').charAt(0).toUpperCase()), make('span', '', session.user));
      userCell.append(wrapper);
      tr.append(userCell, make('td', 'ip-cell', session.ip || '—'), make('td', '', session.started ? timeFormat.format(new Date(session.started * 1000)) : '—'), make('td', 'usage-cell', bytes((session.bytesIn || 0) + (session.bytesOut || 0))));
      body.append(tr);
    });
  }

  function renderHosts(hosts, configured) {
    const list = $('host-list');
    list.replaceChildren();
    text('host-count', configured ? `${hosts.length} HOSTS` : 'NOT LINKED');
    if (!configured) return list.append(make('p', 'empty-text', 'Connect Zabbix to show monitored devices.'));
    if (!hosts.length) return list.append(make('p', 'empty-text', 'No monitored hosts returned.'));
    hosts.slice(0, 5).forEach(host => {
      const row = make('div', 'list-row');
      const dot = make('span', `host-dot ${host.status}`);
      const main = make('div', 'list-row-main');
      main.append(make('strong', '', host.name), make('small', '', 'Zabbix monitored host'));
      row.append(dot, main, make('span', `list-status ${host.status}`, host.status));
      list.append(row);
    });
  }

  function renderProblems(problems, configured) {
    const list = $('problem-list');
    list.replaceChildren();
    if (!configured) return list.append(make('p', 'empty-text', 'Connect Zabbix to show active alerts.'));
    if (!problems.length) return list.append(make('p', 'empty-text', 'No unresolved alerts.'));
    const severity = ['Info', 'Info', 'Warning', 'Average', 'High', 'Critical'];
    problems.slice(0, 5).forEach(problem => {
      const row = make('div', 'list-row');
      const main = make('div', 'list-row-main');
      main.append(make('strong', '', problem.name), make('small', '', problem.time ? timeFormat.format(new Date(problem.time * 1000)) : 'Recent alert'));
      row.append(make('span', 'alert-symbol', '!'), main, make('span', 'alert-level', severity[problem.severity] || 'Alert'));
      list.append(row);
    });
  }

  function render(data) {
    current = data;
    const demo = data.mode === 'demo';
    const banner = $('mode-banner');
    banner.className = demo ? 'mode-banner' : 'mode-banner live';
    banner.textContent = demo
      ? 'DEMO DATA — This preview uses simulated traffic, users, devices, and alerts. Configure OPNsense and Zabbix to monitor the real network.'
      : `LIVE DATA — Reading ${data.interface} on OPNsense${data.zabbixConfigured ? ' and device alerts from Zabbix' : '. Connect Zabbix for device health and alerts'}.`;
    text('sidebar-mode', demo ? 'Demo preview' : 'OPNsense connected');
    rateMetric('metric-in', data.rates.inbound);
    rateMetric('metric-out', data.rates.outbound);
    text('metric-interface', data.interface);
    text('metric-interface-out', data.interface);
    text('metric-sessions', data.sessions.length);
    text('metric-zone', data.zone);
    text('metric-alerts', data.zabbixConfigured ? data.problems.length : '—');
    text('alerts-caption', data.zabbixConfigured ? 'Unresolved Zabbix problems' : 'Zabbix not configured');
    text('session-count', data.sessions.length);
    text('update-time', `Updated ${timeFormat.format(new Date(data.timestamp))}`);
    renderChart(data.history);
    renderSessions(data.sessions);
    renderHosts(data.hosts, data.zabbixConfigured);
    renderProblems(data.problems, data.zabbixConfigured);
    const errors = $('error-banner');
    errors.hidden = !data.errors?.length;
    errors.textContent = data.errors?.length ? data.errors.join(' · ') : '';
  }

  async function refresh() {
    if (busy) return;
    busy = true;
    $('refresh-button').disabled = true;
    try {
      const response = await fetch('/api/overview', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Monitoring service returned HTTP ${response.status}`);
      render(await response.json());
    } catch (error) {
      $('error-banner').hidden = false;
      $('error-banner').textContent = `Unable to refresh network data: ${error.message}`;
    } finally {
      busy = false;
      $('refresh-button').disabled = false;
    }
  }

  $('refresh-button').addEventListener('click', refresh);
  $('session-search').addEventListener('input', () => { if (current) renderSessions(current.sessions); });
  document.querySelectorAll('[data-nav]').forEach(link => link.addEventListener('click', () => {
    document.querySelectorAll('[data-nav]').forEach(other => other.classList.remove('active'));
    link.classList.add('active');
  }));
  refresh();
  setInterval(refresh, 5000);
})();
