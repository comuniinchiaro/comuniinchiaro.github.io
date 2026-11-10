'use strict';

const DATA = 'https://cruscotto-italia.dati.gov.it/data';
const PAL = ['#0066CC', '#008055', '#A66300', '#CC334D', '#5C6F82', '#7B4FBF', '#00A3A3', '#D9822B', '#004C99', '#8A95A1', '#B3478F', '#4C9A2A'];

const S = { comuni: [], byIstat: new Map(), charts: [], dash: new Map(), map: null };

// ---------- Utilità DOM e formati ----------

function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return e;
}
const $ = s => document.querySelector(s);
const isNum = v => typeof v === 'number' && isFinite(v);

const nf0 = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0, useGrouping: 'always' });
const nf1 = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1, useGrouping: 'always' });
const nf2 = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2, useGrouping: 'always' });
const nf3 = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const nfc = new Intl.NumberFormat('it-IT', { notation: 'compact', maximumFractionDigits: 1 });
const F = {
  n: v => isNum(v) ? nf0.format(v) : '—',
  d1: v => isNum(v) ? nf1.format(v) : '—',
  d2: v => isNum(v) ? nf2.format(v) : '—',
  pct: v => isNum(v) ? nf1.format(v) + '%' : '—',
  eur: v => isNum(v) ? nf0.format(v) + ' €' : '—',
  eurc: v => isNum(v) ? nfc.format(v) + ' €' : '—',
  price: v => isNum(v) ? nf3.format(v) + ' €/l' : '—',
  compact: v => isNum(v) ? nfc.format(v) : '—',
  date: v => {
    if (!v || typeof v !== 'string' || v.startsWith('9999')) return '—';
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : v;
  },
  auto: v => {
    if (v == null || v === '') return '—';
    if (typeof v === 'boolean') return v ? 'Sì' : 'No';
    if (isNum(v)) return Number.isInteger(v) ? nf0.format(v) : nf2.format(v);
    return String(v);
  }
};
const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const cut = (s, n = 42) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const label = k => { const s = String(k).replace(/^_+/, '').replace(/_/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1); };
const sum = a => a.reduce((x, y) => x + (isNum(y) ? y : 0), 0);

// ---------- Ponte verso l'applicazione desktop ----------

const pending = new Map();
let seq = 0;
const hasHost = !!(window.chrome && window.chrome.webview);
if (hasHost) {
  window.chrome.webview.addEventListener('message', e => {
    const m = e.data, p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    m.ok ? p.res(m.result) : p.rej(new Error(m.error));
  });
}
function host(cmd, args) {
  if (!hasHost) return webHost(cmd, args);
  return new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    window.chrome.webview.postMessage({ id, cmd, args });
  });
}

// ---------- Versione web: le stesse funzioni, senza applicazione desktop ----------

async function webHost(cmd, args) {
  if (cmd === 'amministratori') return webAmministratori(args.nome, args.prov);
  if (cmd === 'exportXlsx') {
    XLSX.download(args.fileName, args.sheet, args.headers, args.rows);
    return { saved: true, path: args.fileName, rows: args.rows.length };
  }
  if (cmd === 'openExternal') { window.open(args.url, '_blank', 'noopener'); return {}; }
  throw new Error('Funzione non disponibile nella versione web.');
}

// Amministratori locali: file statici per provincia, generati da tools/build_web.py a partire
// dagli open data del Ministero dell'Interno.
const AMM = new Map();
const normAmm = s => String(s).toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]/g, '').replace(/J/g, 'I');
function descriviVertice(righe) {
  const nome = a => `${a.cognome} ${a.nome}`.trim();
  const sindaco = righe.find(a => /^sindaco$/i.test(a.carica));
  if (sindaco) return nome(sindaco);
  const reggente = righe.find(a => /reggente/i.test(a.incarico) || /vicesindaco/i.test(a.carica));
  if (reggente) return `${nome(reggente)} (vicesindaco reggente)`;
  const comm = righe.filter(a => /^commiss/i.test(a.carica));
  return comm.length ? `${comm.map(nome).join(', ')} (${comm[0].carica})` : '';
}
async function webAmministratori(comune, prov) {
  prov = String(prov).toUpperCase();
  if (!AMM.has(prov)) {
    const p = fetch(`data/amministratori/${encodeURIComponent(prov)}.json`).then(r => {
      if (!r.ok) throw new Error('Elenco degli amministratori non disponibile per questa provincia.');
      return r.json();
    });
    p.catch(() => AMM.delete(prov));
    AMM.set(prov, p);
  }
  const j = await AMM.get(prov);
  const k = normAmm(comune);
  let rows = j.comuni[k];
  if (!rows) {
    // Denominazioni bilingui o varianti: corrispondenza per prefisso nella stessa provincia.
    const best = Object.keys(j.comuni).filter(x => x.length >= 6 && k.length >= 6 && (k.startsWith(x) || x.startsWith(k)))
      .sort((a, b) => b.length - a.length)[0];
    rows = best ? j.comuni[best] : [];
  }
  const righe = rows.map(r => ({
    cognome: r[0], nome: r[1], sesso: r[2], carica: r[3], incarico: r[4], dataElezione: r[5],
    dataEntrataInCarica: r[6], lista: r[7], titoloStudio: r[8], professione: r[9]
  }));
  return { aggiornamento: j.aggiornamento, sindaco: descriviVertice(righe), righe };
}

let toastTimer;
function toast(msg, opts = {}) {
  const t = $('#toast');
  t.replaceChildren(h('span', null, msg));
  if (opts.action) t.append(h('button', { onclick: opts.action.fn }, opts.action.label));
  t.className = 'toast' + (opts.error ? ' err' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, opts.ms || 9000);
}

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Dato non disponibile (${r.status})`);
  return r.json();
}
function getDashboard(istat) {
  if (!S.dash.has(istat)) {
    const p = getJson(`${DATA}/dashboard/${istat}.json`);
    p.catch(() => S.dash.delete(istat));
    S.dash.set(istat, p);
  }
  return S.dash.get(istat);
}

// ---------- Componenti ----------

function tile(lab, val, sub) {
  return h('div', { class: 'tile' }, h('div', { class: 'lab' }, lab), h('div', { class: 'val' }, val), sub && h('div', { class: 'sub' }, sub));
}
const tiles = (...t) => h('div', { class: 'tiles' }, t);

function card(title, src, ...body) {
  return h('div', { class: 'card' }, h('h3', null, title), src && h('div', { class: 'src' }, 'Fonte: ' + src), body);
}
const wide = c => { c.classList.add('wide'); return c; };
const grid = (...c) => h('div', { class: 'grid' }, c);
const note = t => h('div', { class: 'note' }, t);

function kv(pairs) {
  return h('table', { class: 'kv' }, h('tbody', null,
    pairs.filter(p => p && p[1] != null && p[1] !== '—').map(([k, v]) => h('tr', null, h('td', null, k), h('td', null, v)))));
}

Chart.defaults.font.family = "'Titillium Web', 'Segoe UI', sans-serif";
Chart.defaults.font.size = 12;
Chart.defaults.color = '#455A72';
Chart.defaults.maintainAspectRatio = false;
Chart.defaults.animation.duration = 250;
Chart.defaults.plugins.legend.position = 'bottom';
Chart.defaults.plugins.legend.labels.boxWidth = 12;
Chart.defaults.plugins.tooltip.callbacks.label = ctx => {
  const v = ctx.chart.options.indexAxis === 'y' ? ctx.parsed.x : (ctx.parsed.y ?? ctx.parsed);
  const name = ctx.dataset.label || ctx.label || '';
  return `${name}: ${isNum(v) ? nf2.format(Math.abs(v) === v || !ctx.chart.options._abs ? v : Math.abs(v)) : v}`;
};

function mkChart(config, tall) {
  S.charts = S.charts.filter(c => c.canvas && c.canvas.isConnected ? true : (c.destroy(), false));
  const canvas = h('canvas');
  const box = h('div', { class: 'chart-box' + (tall ? ' tall' : '') }, canvas);
  // Il grafico viene creato quando il contenitore è nel documento, così prende le dimensioni giuste.
  requestAnimationFrame(() => { if (canvas.isConnected) S.charts.push(new Chart(canvas, config)); });
  return box;
}
const tickCompact = { callback: v => nfc.format(v) };

function barChart(labels, datasets, o = {}) {
  if (!datasets.length || typeof datasets[0] !== 'object' || datasets[0] === null) datasets = [{ label: o.label || '', data: datasets }];
  datasets.forEach((d, i) => { d.backgroundColor ??= o.colors || PAL[i % PAL.length]; d.borderRadius ??= 2; });
  const horiz = !!o.horizontal;
  const valAxis = { beginAtZero: true, stacked: !!o.stacked, ticks: tickCompact, grid: { color: '#EDEFF2' } };
  const catAxis = { stacked: !!o.stacked, grid: { display: false }, ticks: { autoSkip: !horiz } };
  return mkChart({
    type: 'bar',
    data: { labels: labels.map(l => cut(l, o.cut || 38)), datasets },
    options: {
      indexAxis: horiz ? 'y' : 'x',
      scales: horiz ? { x: valAxis, y: catAxis } : { x: catAxis, y: valAxis },
      plugins: { legend: { display: datasets.length > 1 } }
    }
  }, o.tall);
}
function lineChart(labels, datasets, o = {}) {
  datasets.forEach((d, i) => {
    d.borderColor ??= PAL[i % PAL.length]; d.backgroundColor ??= d.borderColor;
    d.tension ??= 0.25; d.pointRadius ??= 3; d.borderWidth ??= 2; d.spanGaps ??= true;
  });
  const scales = { x: { grid: { display: false } }, y: { beginAtZero: !!o.zero, ticks: tickCompact, grid: { color: '#EDEFF2' } } };
  if (datasets.some(d => d.yAxisID === 'y2')) scales.y2 = { position: 'right', beginAtZero: !!o.zero, ticks: tickCompact, grid: { display: false } };
  return mkChart({ type: 'line', data: { labels, datasets }, options: { scales, plugins: { legend: { display: datasets.length > 1 } } } }, o.tall);
}
function pieChart(labels, data, o = {}) {
  return mkChart({
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: o.colors || PAL, borderWidth: 1 }] },
    options: { cutout: '55%', plugins: { legend: { position: 'right' } } }
  }, o.tall);
}
/** Grafico a barre o torta a partire da un oggetto {chiave: valore}. */
function objBar(obj, o = {}) {
  let e = Object.entries(obj || {}).filter(([, v]) => isNum(v));
  if (o.sort) e.sort((a, b) => b[1] - a[1]);
  if (o.top) e = e.slice(0, o.top);
  return barChart(e.map(([k]) => o.raw ? k : label(k)), e.map(([, v]) => v), o);
}
function objPie(obj, o = {}) {
  const e = Object.entries(obj || {}).filter(([, v]) => isNum(v) && v > 0);
  return pieChart(e.map(([k]) => o.raw ? k : label(k)), e.map(([, v]) => v), o);
}

/** Tabella con ordinamento, filtro testuale e paginazione. */
function dataTable(cols, rows, o = {}) {
  const st = { sort: o.sort ?? null, dir: o.dir ?? 1, page: 0, q: '' };
  const size = o.size || 25;
  const info = h('span', { class: 'info' });
  const body = h('tbody');
  const pager = h('div', { class: 'pager' });
  const val = (r, c) => c.get ? c.get(r) : r[c.k];
  const heads = cols.map((c, i) => h('th', {
    class: 'sortable' + (c.num ? ' num' : ''),
    onclick: () => { if (st.sort === i) st.dir = -st.dir; else { st.sort = i; st.dir = c.num ? -1 : 1; } st.page = 0; draw(); }
  }, c.t));
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Filtra…', oninput: e => { st.q = norm(e.target.value); st.page = 0; draw(); } });

  function draw() {
    let list = rows;
    if (st.q) list = list.filter(r => norm(cols.map(c => val(r, c) ?? '').join(' ')).includes(st.q));
    if (st.sort != null) {
      const c = cols[st.sort];
      list = [...list].sort((a, b) => {
        const x = val(a, c), y = val(b, c);
        if (x == null) return 1; if (y == null) return -1;
        return (isNum(x) && isNum(y) ? x - y : String(x).localeCompare(String(y), 'it')) * st.dir;
      });
    }
    const pages = Math.max(1, Math.ceil(list.length / size));
    st.page = Math.min(st.page, pages - 1);
    heads.forEach((th, i) => { th.textContent = cols[i].t + (st.sort === i ? (st.dir > 0 ? ' ▲' : ' ▼') : ''); });
    body.replaceChildren(...list.slice(st.page * size, (st.page + 1) * size).map(r =>
      h('tr', { class: o.onRow ? 'clickable' : null, onclick: o.onRow ? () => o.onRow(r) : null },
        cols.map(c => {
          const v = val(r, c);
          return h('td', { class: c.num ? 'num' : null }, c.cell ? c.cell(r, v) : (c.fmt ? c.fmt(v) : F.auto(v)));
        }))));
    if (!list.length) body.append(h('tr', null, h('td', { colspan: cols.length, class: 'empty' }, 'Nessun risultato')));
    info.textContent = `${nf0.format(list.length)} righe`;
    pager.replaceChildren(
      h('button', { class: 'btn ghost small', disabled: st.page === 0, onclick: () => { st.page--; draw(); } }, '‹ Prec.'),
      h('span', null, `Pagina ${st.page + 1} di ${pages}`),
      h('button', { class: 'btn ghost small', disabled: st.page >= pages - 1, onclick: () => { st.page++; draw(); } }, 'Succ. ›'));
    pager.hidden = pages <= 1;
    o.onDraw && o.onDraw(list);
  }
  draw();
  return h('div', null,
    h('div', { class: 'tbl-tools' }, rows.length > 8 ? search : h('span'), info),
    h('div', { class: 'tbl-wrap' }, h('table', null, h('thead', null, h('tr', null, heads)), body)),
    pager);
}

async function exportXlsx(btn, fileName, sheet, headers, rows) {
  btn.disabled = true;
  try {
    const r = await host('exportXlsx', { fileName, sheet, headers, rows });
    if (r.saved) toast(`Esportate ${nf0.format(r.rows)} righe in ${r.path}`, hasHost ? { action: { label: 'Apri', fn: () => host('openFile') } } : {});
  } catch (e) { toast(e.message, { error: true }); }
  btn.disabled = false;
}

// ---------- Ricerca ----------

function initSearch() {
  const input = $('#search'), list = $('#search-results');
  let items = [], sel = 0;
  const close = () => { list.hidden = true; };
  const go = c => { input.value = ''; close(); input.blur(); location.hash = '#/comune/' + c.i; };
  function draw() {
    list.replaceChildren(...items.map((c, i) => h('li', { class: i === sel ? 'sel' : null, onmousedown: e => { e.preventDefault(); go(c); } },
      h('span', null, c.n), h('small', null, `${c.p} · ${c.r}`))));
    list.hidden = !items.length;
  }
  input.addEventListener('input', () => {
    const q = norm(input.value);
    if (q.length < 2) { items = []; return draw(); }
    const starts = [], contains = [];
    for (const c of S.comuni) {
      if (c.k.startsWith(q)) starts.push(c); else if (c.k.includes(q) || c.i === q || (c.c || '').toLowerCase() === q) contains.push(c);
    }
    starts.sort((a, b) => a.k.length - b.k.length || (b.pop || 0) - (a.pop || 0));
    items = [...starts, ...contains].slice(0, 12); sel = 0; draw();
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, items.length - 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); draw(); e.preventDefault(); }
    else if (e.key === 'Enter' && items[sel]) go(items[sel]);
    else if (e.key === 'Escape') close();
  });
  input.addEventListener('blur', close);
  input.addEventListener('focus', () => { if (items.length) list.hidden = false; });
}

// ---------- Vista nazionale ----------

const CLASSI = [['Fino a 1.000', 0, 1000], ['1.001 – 5.000', 1000, 5000], ['5.001 – 15.000', 5000, 15000],
  ['15.001 – 50.000', 15000, 50000], ['50.001 – 250.000', 50000, 250000], ['Oltre 250.000', 250000, Infinity]];
const filtro = { r: '', p: '' };

function viewItalia(main) {
  const regioni = [...new Set(S.comuni.map(c => c.r))].sort((a, b) => a.localeCompare(b, 'it'));
  const selR = h('select', { onchange: () => { filtro.r = selR.value; filtro.p = ''; draw(); } },
    h('option', { value: '' }, 'Tutte le regioni'), regioni.map(r => h('option', { value: r, selected: r === filtro.r }, r)));
  const selP = h('select', { onchange: () => { filtro.p = selP.value; draw(); } });
  const out = h('div');
  main.replaceChildren(h('div', { class: 'wrap' },
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Italia'),
      h('div', { class: 'sub' }, 'Vista nazionale dei comuni italiani · dati aperti Cruscotto Italia (AgID)'))),
    h('div', { class: 'filters' }, h('label', null, 'Regione', selR), h('label', null, 'Provincia', selP)), out));

  function draw() {
    const prov = [...new Set(S.comuni.filter(c => !filtro.r || c.r === filtro.r).map(c => c.p))].sort();
    selP.replaceChildren(h('option', { value: '' }, 'Tutte le province'), ...prov.map(p => h('option', { value: p, selected: p === filtro.p }, p)));
    const list = S.comuni.filter(c => (!filtro.r || c.r === filtro.r) && (!filtro.p || c.p === filtro.p));
    const scope = filtro.p ? `provincia di ${filtro.p}` : (filtro.r || 'Italia');
    const fileScope = (filtro.p || filtro.r || 'Italia').replace(/[^\p{L}\p{N}]+/gu, '_');
    const pop = sum(list.map(c => c.pop));
    const top = [...list].sort((a, b) => (b.pop || 0) - (a.pop || 0));
    const piccoli = list.filter(c => (c.pop || 0) <= 5000).length;

    const groupKey = filtro.p ? null : (filtro.r ? 'p' : 'r');
    const groups = new Map();
    if (groupKey) for (const c of list) {
      const g = groups.get(c[groupKey]) || { n: 0, pop: 0 };
      g.n++; g.pop += c.pop || 0; groups.set(c[groupKey], g);
    }
    const gs = [...groups.entries()].sort((a, b) => b[1].pop - a[1].pop);
    const gName = groupKey === 'r' ? 'regione' : 'provincia';

    const btnPop = h('button', { class: 'btn' }, 'Esporta popolazione (Excel)');
    btnPop.onclick = () => exportXlsx(btnPop, `Popolazione_${fileScope}.xlsx`, 'Popolazione',
      ['Nome ente', 'Provincia', 'Regione', 'Cod. ISTAT', 'Cod. Belfiore (catastale)', 'Popolazione'],
      list.map(c => [c.n, c.p, c.r, c.i, c.c, c.pop]));
    const btnSind = h('button', { class: 'btn' }, 'Esporta sindaci (Excel)');
    btnSind.onclick = async () => {
      btnSind.disabled = true;
      toast('Preparazione dell\'elenco dei sindaci (Ministero dell\'Interno)…', { ms: 60000 });
      try {
        const r = await host('exportSindaci', { fileName: `Sindaci_${fileScope}.xlsx`, comuni: list.map(c => ({ i: c.i, n: c.n, p: c.p, r: c.r, c: c.c })) });
        if (r.saved) toast(`Esportati ${nf0.format(r.rows)} comuni (${nf0.format(r.senza)} senza dato) · anagrafe aggiornata al ${r.aggiornamento}`,
          { action: { label: 'Apri', fn: () => host('openFile') } });
        else $('#toast').hidden = true;
      } catch (e) { toast(e.message, { error: true }); }
      btnSind.disabled = false;
    };

    const carb = card('Prezzi medi dei carburanti', 'MIMIT – Osservatorio Prezzi Carburanti', h('div', { class: 'loading' }, 'Caricamento…'));
    getJson(`${DATA}/carburanti/_nazionale.json`).then(j => {
      const keys = ['benzina_self', 'gasolio_self', 'benzina_serv', 'gasolio_serv', 'gpl', 'metano', 'hvo'];
      const ds = [{ label: 'Italia', data: keys.map(k => j.nazionale[k]) }];
      if (filtro.r && j.regionale[filtro.r]) ds.push({ label: filtro.r, data: keys.map(k => j.regionale[filtro.r][k]) });
      carb.lastChild.replaceWith(barChart(keys.map(label), ds));
      carb.append(h('div', { class: 'src' }, `€/litro (metano €/kg) · rilevazione del ${F.date(j._snapshot_date)}`));
    }).catch(e => carb.lastChild.replaceWith(h('div', { class: 'empty' }, e.message)));

    out.replaceChildren(
      tiles(
        tile('Comuni', F.n(list.length), scope),
        tile('Popolazione residente', F.n(pop)),
        tile('Popolazione media per comune', F.n(list.length ? pop / list.length : null)),
        tile('Comune più popoloso', top[0] ? top[0].n : '—', top[0] && F.n(top[0].pop) + ' abitanti'),
        tile('Comuni fino a 5.000 abitanti', F.n(piccoli), list.length ? F.pct(piccoli / list.length * 100) + ' del totale' : null)),
      grid(
        groupKey && card(`Popolazione per ${gName}`, 'ISTAT', barChart(gs.map(g => g[0]), gs.map(g => g[1].pop), { horizontal: true, tall: gs.length > 12, label: 'Popolazione' })),
        groupKey && card(`Numero di comuni per ${gName}`, 'ISTAT', barChart(gs.map(g => g[0]), gs.map(g => g[1].n), { horizontal: true, tall: gs.length > 12, label: 'Comuni', colors: PAL[1] })),
        card('Comuni per classe demografica', 'ISTAT', barChart(CLASSI.map(c => c[0]), [
          { label: 'Comuni', data: CLASSI.map(([, a, b]) => list.filter(c => (c.pop || 0) > a && (c.pop || 0) <= b).length) }])),
        card('Popolazione per classe demografica', 'ISTAT', pieChart(CLASSI.map(c => c[0]),
          CLASSI.map(([, a, b]) => sum(list.filter(c => (c.pop || 0) > a && (c.pop || 0) <= b).map(c => c.pop))))),
        card('I 15 comuni più popolosi', 'ISTAT', barChart(top.slice(0, 15).map(c => c.n), top.slice(0, 15).map(c => c.pop), { horizontal: true, tall: true, label: 'Popolazione' })),
        carb),
      h('div', { class: 'card' },
        h('div', { class: 'page-head' }, h('div', null, h('h3', null, `Elenco dei comuni – ${scope}`),
          h('div', { class: 'src' }, 'Clicca su una riga per aprire la scheda del comune.' +
            (hasHost ? ' Gli export riguardano i comuni selezionati dai filtri Regione/Provincia.' : ''))),
          // Gli export massivi esistono solo nell'applicazione desktop.
          hasHost && h('div', { class: 'actions' }, btnPop, btnSind)),
        dataTable([
          { t: 'Comune', k: 'n' }, { t: 'Prov.', k: 'p' }, { t: 'Regione', k: 'r' }, { t: 'Cod. ISTAT', k: 'i' },
          { t: 'Cod. catastale', k: 'c' }, { t: 'Popolazione', k: 'pop', num: true, fmt: F.n }
        ], list, { sort: 5, dir: -1, size: 20, onRow: c => { location.hash = '#/comune/' + c.i; } })));
  }
  draw();
}

// ---------- Confronto tra comuni ----------

const confronto = {
  get: () => { try { return JSON.parse(localStorage.getItem('confronto') || '[]').filter(i => S.byIstat.has(i)); } catch { return []; } },
  set: l => localStorage.setItem('confronto', JSON.stringify(l.slice(0, 6))),
  add(i) { const l = this.get(); if (!l.includes(i)) { l.push(i); this.set(l); } },
  remove(i) { this.set(this.get().filter(x => x !== i)); }
};

async function viewConfronto(main) {
  const ids = confronto.get();
  const out = h('div', null, ids.length ? h('div', { class: 'loading' }, 'Caricamento degli indicatori…') : null);
  main.replaceChildren(h('div', { class: 'wrap' },
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Confronto tra comuni'),
      h('div', { class: 'sub' }, 'Fino a 6 comuni affiancati sugli indicatori chiave. Aggiungi un comune dalla sua scheda con «Aggiungi al confronto».'))),
    h('div', { class: 'chips', style: 'margin-bottom:16px' }, ids.map(i => h('span', { class: 'chip' }, h('b', null, S.byIstat.get(i).n), ' ',
      h('a', { href: '#', title: 'Rimuovi', onclick: e => { e.preventDefault(); confronto.remove(i); viewConfronto(main); } }, '✕')))),
    out));
  if (!ids.length) { out.append(h('div', { class: 'card empty' }, 'Nessun comune selezionato. Cerca un comune in alto e usa «Aggiungi al confronto».')); return; }

  const res = await Promise.allSettled(ids.map(getDashboard));
  const ok = ids.map((i, k) => ({ c: S.byIstat.get(i), d: res[k].status === 'fulfilled' ? res[k].value : null })).filter(x => x.d && x.d.kpi_summary);
  if (!ok.length) { out.replaceChildren(h('div', { class: 'error' }, 'Indicatori non disponibili.')); return; }

  const groups = new Map();
  for (const x of ok) for (const [g, o] of Object.entries(x.d.kpi_summary)) {
    if (!o || typeof o !== 'object') continue;
    const set = groups.get(g) || new Set();
    Object.entries(o).forEach(([k, v]) => { if (!k.startsWith('_') && (v === null || typeof v !== 'object')) set.add(k); });
    groups.set(g, set);
  }
  const rowsX = [];
  const tbody = h('tbody');
  for (const [g, keys] of groups) {
    tbody.append(h('tr', { class: 'group' }, h('td', { colspan: ok.length + 1 }, label(g))));
    for (const k of keys) {
      const vals = ok.map(x => x.d.kpi_summary[g]?.[k]);
      const nums = vals.filter(isNum), max = nums.length > 1 ? Math.max(...nums) : null;
      tbody.append(h('tr', null, h('td', null, label(k)), vals.map(v => h('td', { class: 'num', style: isNum(v) && v === max && g !== 'anagrafica' ? 'font-weight:700' : null }, F.auto(v)))));
      rowsX.push([label(g), label(k), ...vals.map(v => v ?? null)]);
    }
  }
  const btn = h('button', { class: 'btn' }, 'Esporta confronto (Excel)');
  btn.onclick = () => exportXlsx(btn, 'Confronto_comuni.xlsx', 'Confronto', ['Area', 'Indicatore', ...ok.map(x => x.c.n)], rowsX);
  const pick = (g, k) => ok.map(x => x.d.kpi_summary[g]?.[k]);
  const names = ok.map(x => x.c.n);
  out.replaceChildren(
    grid(
      card('Popolazione', 'ISTAT', barChart(names, pick('demografia', 'popolazione'))),
      card('Reddito medio (€)', 'MEF', barChart(names, pick('redditi_mef', 'reddito_medio_eur'), { colors: PAL[1] })),
      card('Uscite di cassa per abitante (€)', 'SIOPE', barChart(names, pick('siope', 'uscite_per_abitante_eur'), { colors: PAL[2] })),
      card('PNRR per abitante (€)', 'Italia Domani', barChart(names, pick('pnrr', 'importo_per_abitante_eur'), { colors: PAL[5] }))),
    h('div', { class: 'card' }, h('div', { class: 'page-head' }, h('h3', null, 'Tutti gli indicatori'), hasHost && btn),
      h('div', { class: 'tbl-wrap' }, h('table', null,
        h('thead', null, h('tr', null, h('th', null, 'Indicatore'), ok.map(x => h('th', { class: 'num' }, h('a', { href: '#/comune/' + x.c.i }, x.c.n))))), tbody))));
}

// ---------- Fonti ----------

const FONTI = [
  ['ISTAT', 'Demografia (POSAS, bilancio demografico), censimento permanente, turismo, imprese ASIA, pendolarismo, basi territoriali', 'CC BY 4.0'],
  ['ANAC', 'Banca dati nazionale dei contratti pubblici: aggiudicazioni degli ultimi 12 mesi', 'CC BY 4.0'],
  ['MEF – RGS (BDAP, SIOPE)', 'Opere pubbliche BDAP-MOP; pagamenti e incassi di cassa SIOPE', 'IODL 2.0 / CC BY 4.0'],
  ['Italia Domani', 'Progetti PNRR (sistema ReGiS)', 'CC BY 4.0'],
  ['MEF – Dipartimento Finanze', 'Redditi IRPEF su base comunale', 'CC BY 3.0'],
  ['MEF – Dipartimento Economia', 'Censimento dei beni immobili pubblici', 'CC BY 4.0'],
  ['ISPRA / SNPA', 'Consumo di suolo, rischio idrogeologico, rifiuti urbani, qualità dell\'aria', 'CC BY 4.0'],
  ['Protezione Civile', 'Classificazione sismica dei comuni', 'CC BY 4.0'],
  ['MIUR', 'Anagrafe delle scuole statali', 'CC BY 4.0'],
  ['ACI', 'Parco veicoli, incidenti stradali, nuove iscrizioni', 'CC BY 4.0'],
  ['Agenzia delle Entrate', 'ANNCSU (numeri civici e strade), quotazioni immobiliari OMI', 'Open data HVD / CC BY 4.0'],
  ['Ministero della Salute', 'Farmacie, parafarmacie, posti letto ospedalieri', 'IODL 2.0'],
  ['GSE / MASE', 'Piattaforma Unica Nazionale dei punti di ricarica', 'CC BY 4.0'],
  ['AGCOM', 'Broadband Map: copertura FTTH', 'CC BY 4.0'],
  ['MIMIT', 'Osservatorio prezzi carburanti', 'IODL 2.0'],
  ['Ministero del Lavoro', 'Registro Unico Nazionale del Terzo Settore (RUNTS)', 'CC BY 4.0'],
  ['Ministero della Cultura', 'Beni culturali (ArCo) e luoghi della cultura', 'CC BY 4.0'],
  ['ItaliaMeteo', 'Previsioni ICON-2I', 'CC BY 4.0'],
  ['CNR-IRPI', 'Morfologia da modello digitale del terreno', '—'],
  ['Ministero dell\'Interno – DAIT', 'Anagrafe degli Amministratori Locali e Regionali (sindaco, giunta, consiglio). Fonte esterna a Cruscotto Italia.', 'CC BY 4.0'],
  ['OpenStreetMap', 'Cartografia di base delle mappe', 'ODbL']
];
function viewFonti(main) {
  main.replaceChildren(h('div', { class: 'wrap' },
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Fonti dei dati'),
      h('div', { class: 'sub' }, 'I dati sono letti in tempo reale dagli open data di Cruscotto Italia (AgID), ',
        h('a', { href: 'https://cruscotto-italia.dati.gov.it', target: '_blank' }, 'cruscotto-italia.dati.gov.it'), '.'))),
    h('div', { class: 'card' }, h('div', { class: 'tbl-wrap' }, h('table', null,
      h('thead', null, h('tr', null, h('th', null, 'Ente'), h('th', null, 'Dati'), h('th', null, 'Licenza'))),
      h('tbody', null, FONTI.map(f => h('tr', null, f.map(x => h('td', null, x))))))))));
}

// ---------- Navigazione ----------

function route() {
  const main = $('#main');
  if (typeof fermaNavigazione === 'function') fermaNavigazione();
  const [, view = 'italia', arg] = location.hash.split('/');
  S.charts.forEach(c => c.destroy()); S.charts = [];
  if (S.map) { S.map.remove(); S.map = null; }
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === view));
  main.scrollTop = 0;
  if (view === 'comune' && S.byIstat.has(arg)) viewComune(main, arg);
  else if (view === 'confronto') viewConfronto(main);
  else if (view === 'fonti') viewFonti(main);
  else viewItalia(main);
}

async function start() {
  try {
    const j = await getJson(`${DATA}/lookup/comuni-bundle.json`);
    S.comuni = Object.values(j.comuni).map(c => ({
      i: c.istat_code, n: c.denominazione, p: c.provincia, r: c.regione, c: c.codice_catastale,
      pop: c.kpi ? c.kpi.popolazione : null, k: norm(c.denominazione)
    })).sort((a, b) => a.n.localeCompare(b.n, 'it'));
    S.comuni.forEach(c => S.byIstat.set(c.i, c));
    initSearch();
    window.addEventListener('hashchange', route);
    route();
  } catch (e) {
    $('#main').replaceChildren(h('div', { class: 'wrap' }, h('div', { class: 'error' },
      'Impossibile scaricare i dati da Cruscotto Italia. Verifica la connessione a Internet e riprova. ', h('br'),
      h('small', null, e.message), h('br'), h('br'), h('button', { class: 'btn', onclick: () => location.reload() }, 'Riprova'))));
  }
}
start();
