'use strict';
// Scheda «Indirizzi e catasto»: ricerca dei numeri civici (ANNCSU) e individuazione di foglio e
// particella catastale del punto (cartografia INSPIRE dell'Agenzia delle Entrate).
// Usa le utilità definite in app.js.

/** Scarica un file .gz dagli open data e lo restituisce come JSON (decompressione lato client). */
async function getGzJson(url) {
  // Le risposte 404 del server non hanno intestazioni CORS: il browser le segnala come errore di rete.
  // "assente" copre entrambi i casi (file inesistente oppure non raggiungibile).
  let r;
  try { r = await fetch(url); }
  catch (err) { const e = new Error('File non disponibile o connessione assente'); e.assente = true; throw e; }
  if (!r.ok) { const e = new Error(`Dato non disponibile (${r.status})`); e.assente = r.status === 404; throw e; }
  const buf = new Uint8Array(await r.arrayBuffer());
  if (buf[0] !== 0x1f || buf[1] !== 0x8b) return JSON.parse(new TextDecoder().decode(buf));
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).json();
}

function ringContains(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const polyContains = (poly, x, y) => ringContains(poly[0], x, y) && !poly.slice(1).some(hole => ringContains(hole, x, y));
function geomContains(g, x, y) {
  if (g.type === 'Polygon') return polyContains(g.coordinates, x, y);
  if (g.type === 'MultiPolygon') return g.coordinates.some(p => polyContains(p, x, y));
  return false;
}
/** Aggiunge a ogni feature il rettangolo d'ingombro, per scartare in fretta quelle lontane dal punto. */
function withBbox(features) {
  for (const f of features) {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    const g = f.geometry || {};
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const p of polys) for (const pt of p[0]) {
      if (pt[0] < a) a = pt[0]; if (pt[0] > c) c = pt[0];
      if (pt[1] < b) b = pt[1]; if (pt[1] > d) d = pt[1];
    }
    f.bb = [a, b, c, d];
  }
  return features;
}
const findContaining = (features, x, y) =>
  features.filter(f => x >= f.bb[0] && x <= f.bb[2] && y >= f.bb[1] && y <= f.bb[3] && geomContains(f.geometry, x, y));

/** Distanza in metri del punto dal bordo del poligono più vicino della geometria. */
function distanzaMetri(g, x, y) {
  const kx = 111320 * Math.cos(y * Math.PI / 180), ky = 110540;
  let best = Infinity;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  for (const p of polys) for (const ring of p) for (let i = 0; i < ring.length - 1; i++) {
    const ax = (ring[i][0] - x) * kx, ay = (ring[i][1] - y) * ky, bx = (ring[i + 1][0] - x) * kx, by = (ring[i + 1][1] - y) * ky;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best) best = d;
  }
  return best;
}
/** Strade, acque e simili sono "particelle" di servizio: non identificano un immobile. */
const isServizio = f => /^(STRADA|ACQUA|FERROVIA|FIUME)/i.test(f.properties.LABEL || '') || /\.(STRADA|ACQUA)/i.test(f.properties.NATIONALCADASTRALREFERENCE || '');
function vicine(features, x, y, raggio = 40, n = 3) {
  const mx = raggio / (111320 * Math.cos(y * Math.PI / 180)), my = raggio / 110540;
  return features
    .filter(f => !isServizio(f) && f.bb[0] <= x + mx && f.bb[2] >= x - mx && f.bb[1] <= y + my && f.bb[3] >= y - my && !geomContains(f.geometry, x, y))
    .map(f => ({ f, d: distanzaMetri(f.geometry, x, y) }))
    .filter(o => o.d <= raggio).sort((a, b) => a.d - b.d).slice(0, n);
}

/** Riferimento catastale nazionale, es. "E506A026200.1": comune, sezione, foglio, allegato, sviluppo, particella. */
function parseCatasto(ref) {
  const m = String(ref || '').match(/^([A-Z]\d{3})(.)(\d{4})(.)(.)(?:\.(.+))?$/);
  if (!m) return null;
  return {
    comune: m[1], sezione: m[2] === '_' ? '' : m[2], foglio: String(parseInt(m[3], 10)),
    allegato: m[4] === '0' ? '' : m[4], sviluppo: m[5] === '0' ? '' : m[5], particella: m[6] || ''
  };
}

// Cartografia catastale del comune aperto: resta in memoria finché non si cambia comune.
const CAT = { istat: null, fogli: null, ple: null, split: false, perFoglio: new Map() };

async function cercaParticella(istat, lon, lat, onStatus) {
  if (CAT.istat !== istat) Object.assign(CAT, { istat, fogli: null, ple: null, split: false, perFoglio: new Map() });
  const base = `${DATA}/catasto_full/${istat}`;
  if (!CAT.fogli) {
    onStatus('Scaricamento dei fogli di mappa catastali…');
    CAT.fogli = withBbox((await getGzJson(`${base}_map.geojson.gz`)).features);
  }
  const fogli = findContaining(CAT.fogli, lon, lat);
  if (!CAT.ple && !CAT.split) {
    onStatus('Scaricamento delle particelle catastali (nei comuni grandi può richiedere qualche decina di secondi)…');
    try { CAT.ple = withBbox((await getGzJson(`${base}_ple.geojson.gz`)).features); }
    catch (e) { if (e.assente) CAT.split = true; else throw e; }
  }
  let particelle = [], tutte = CAT.ple || [];
  if (CAT.ple) particelle = findContaining(CAT.ple, lon, lat);
  else for (const f of fogli) {
    // Comuni molto grandi (es. Roma): un file di particelle per ciascun foglio.
    const ref = f.properties.NATIONALCADASTRALZONINGREFERENCE;
    if (!CAT.perFoglio.has(ref)) {
      onStatus(`Scaricamento delle particelle del foglio ${f.properties.LABEL}…`);
      try { CAT.perFoglio.set(ref, withBbox((await getGzJson(`${base}_ple/${ref}.geojson.gz`)).features)); }
      catch (e) { if (e.assente) CAT.perFoglio.set(ref, []); else throw e; }
    }
    particelle.push(...findContaining(CAT.perFoglio.get(ref), lon, lat));
    tutte = tutte.concat(CAT.perFoglio.get(ref));
  }
  // Il civico cade spesso sulla sede stradale: in quel caso si propongono le particelle più vicine.
  const prossime = particelle.some(f => !isServizio(f)) ? [] : vicine(tutte, lon, lat);
  return { fogli, particelle, prossime };
}

function tabIndirizzi(p, d, c) {
  const istat = c.i;
  const k = d.anncsu?.kpi || {};
  let punti = d.anncsu?.punti || [];
  let filtrati = [];
  const status = h('div', { class: 'src' }, 'Caricamento dello stradario completo…');
  const inVia = h('input', { class: 'input', type: 'search', placeholder: 'Via, piazza, località…', style: 'width:300px' });
  const inCiv = h('input', { class: 'input', type: 'search', placeholder: 'Civico', style: 'width:110px' });
  const results = h('div');
  const esito = h('div', { class: 'card', style: 'margin-top:16px' }, h('h3', null, 'Riferimento catastale'),
    h('div', { class: 'empty' }, 'Seleziona un civico dall\'elenco oppure clicca un punto sulla mappa per trovare foglio e particella.'));
  const mapEl = h('div', { class: 'map', style: 'height:520px;min-height:0' });
  const btnX = h('button', { class: 'btn ghost' }, 'Esporta civici trovati (Excel)');
  btnX.onclick = () => exportXlsx(btnX, `Civici_${c.n.replace(/[^\p{L}\p{N}]+/gu, '_')}.xlsx`, 'Civici',
    ['Comune', 'Odonimo', 'Civico', 'Esponente', 'Latitudine', 'Longitudine'],
    filtrati.map(q => [c.n, q.odo, q.civ, q.esp, q.lat, q.lon]));

  p.append(
    tiles(tile('Strade', F.n(k.n_strade)), tile('Numeri civici', F.n(k.n_civici)), tile('Georeferenziati', F.pct(k.pct_geo_ref)),
      tile('Aggiornamento ANNCSU', F.date(d.anncsu?._snapshot_date))),
    h('div', { class: 'split' },
      h('div', { class: 'card' }, h('h3', null, 'Ricerca dei numeri civici'), h('div', { class: 'src' }, 'Fonte: ANNCSU – Agenzia delle Entrate e ISTAT'),
        h('div', { class: 'filters', style: 'margin-bottom:8px' }, h('label', null, 'Indirizzo', inVia), h('label', null, 'Numero', inCiv), btnX),
        status, results),
      h('div', null, mapEl, esito)));

  const map = S.map = L.map(mapEl, { preferCanvas: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>'
  }).addTo(map);
  const ext = d.territorio?.geo?.extent, bb = k.bbox;
  if (ext) map.fitBounds([[ext[0][1], ext[0][0]], [ext[1][1], ext[1][0]]]);
  else if (bb) map.fitBounds([[bb.lat_min, bb.lon_min], [bb.lat_max, bb.lon_max]]);
  else map.setView([42, 12.5], 6);
  const overlay = L.layerGroup().addTo(map);
  setTimeout(() => map.invalidateSize(), 50);

  let run = 0;
  async function localizza(lat, lon, titolo) {
    const my = ++run;
    overlay.clearLayers();
    L.circleMarker([lat, lon], { radius: 7, color: '#fff', weight: 2, fillColor: '#CC334D', fillOpacity: 1 }).addTo(overlay);
    const body = h('div', { class: 'loading' }, 'Ricerca in corso…');
    esito.replaceChildren(h('h3', null, 'Riferimento catastale'),
      h('div', { class: 'src' }, `${titolo} · ${lat.toFixed(6)}, ${lon.toFixed(6)}`),
      h('div', { style: 'margin-bottom:10px' }, linkIndicazioni({ lat, lon, label: titolo })), body);
    try {
      const r = await cercaParticella(istat, lon, lat, t => { if (my === run) body.textContent = t; });
      if (my !== run || !esito.isConnected) return;
      r.fogli.forEach(f => L.geoJSON(f, { interactive: false, style: { color: '#0066CC', weight: 2, fillOpacity: .04, dashArray: '6 4' } }).addTo(overlay));
      // Le particelle di servizio (rete stradale) possono essere enormi: si disegnano leggere e non guidano l'inquadratura.
      r.particelle.forEach(f => L.geoJSON(f, { interactive: false, style: isServizio(f)
        ? { color: '#CC334D', weight: 1, fillOpacity: .06 } : { color: '#CC334D', weight: 3, fillOpacity: .25 } }).addTo(overlay));
      const mirate = [...r.particelle.filter(f => !isServizio(f)), ...r.prossime.map(o => o.f)];
      if (mirate.length) map.fitBounds(L.featureGroup(mirate.map(f => L.geoJSON(f))).getBounds().pad(.8), { maxZoom: 19 });
      else map.setView([lat, lon], 18);
      const scheda = (f, sotto) => {
        const ref = f.properties.NATIONALCADASTRALREFERENCE, x = parseCatasto(ref) || {};
        return h('div', { style: 'margin-bottom:12px' },
          h('div', { class: 'big-name' }, `Foglio ${x.foglio || '—'} · Particella ${x.particella || f.properties.LABEL}`),
          sotto && h('div', { class: 'src' }, sotto),
          kv([['Comune catastale (Belfiore)', x.comune || f.properties.ADMINISTRATIVEUNIT], ['Sezione', x.sezione || null], ['Foglio', x.foglio],
            ['Allegato', x.allegato || null], ['Sviluppo', x.sviluppo || null], ['Particella', x.particella || f.properties.LABEL],
            ['Riferimento catastale nazionale', ref]]));
      };
      const parts = [];
      if (r.particelle.length) parts.push(r.particelle.map(f => scheda(f, isServizio(f) ? 'Il punto cade su una particella di servizio (sede stradale o acque), non su un immobile.' : null)));
      else {
        const fg = r.fogli.map(f => f.properties.LABEL).join(', ');
        parts.push(h('div', { class: 'empty' }, fg
          ? `Il punto ricade nel foglio ${fg} ma non in una particella (strada, acque o area non censita).`
          : 'Il punto non ricade in alcun foglio catastale di questo comune.'));
      }
      if (r.prossime.length) {
        r.prossime.forEach(o => L.geoJSON(o.f, { interactive: false, style: { color: '#A66300', weight: 2, fillOpacity: .15 } }).addTo(overlay));
        parts.push(h('h3', { style: 'margin:14px 0 8px' }, 'Particelle più vicine'),
          h('div', { class: 'note', style: 'margin:0 0 10px' }, `Il numero civico è spesso posizionato sull'accesso dalla strada: l'immobile è con ogni probabilità una di queste particelle (in arancione sulla mappa). Per scegliere con certezza clicca sull'edificio nella mappa.`),
          r.prossime.map(o => scheda(o.f, `a circa ${nf1.format(o.d)} m dal punto`)));
      }
      body.replaceWith(h('div', null, parts, h('div', { class: 'src' }, 'Fonte: Agenzia delle Entrate – Cartografia catastale INSPIRE (Catasto Terreni). ' +
        'La particella è individuata geometricamente dalla posizione del punto: per usi ufficiali va confermata con una visura.')));
    } catch (e) {
      if (my !== run || !esito.isConnected) return;
      body.replaceWith(h('div', { class: 'empty' }, e.assente
        ? 'Cartografia catastale non disponibile per questo comune (in Trentino-Alto Adige il catasto è gestito dalle Province Autonome). Se il comune è di altra regione, verifica la connessione a Internet.'
        : 'Ricerca non riuscita: ' + e.message));
    }
  }
  map.on('click', e => localizza(e.latlng.lat, e.latlng.lng, 'Punto selezionato sulla mappa'));

  function cerca() {
    const tv = norm(inVia.value).split(' ').filter(Boolean), cv = norm(inCiv.value);
    if (!tv.length && !cv) {
      filtrati = [];
      results.replaceChildren(h('div', { class: 'empty' }, 'Scrivi una via (anche parziale) e, se vuoi, il numero civico.'));
      return;
    }
    filtrati = punti.filter(q => {
      if (cv && norm(q.civ) !== cv) return false;
      if (!tv.length) return true;
      q.k ??= norm(q.odo);
      return tv.every(t => q.k.includes(t));
    });
    results.replaceChildren(dataTable([
      { t: 'Odonimo', k: 'odo' },
      { t: 'Civico', get: q => parseInt(q.civ, 10) || 0, cell: q => q.civ, num: true },
      { t: 'Esp.', k: 'esp' },
      { t: 'Coordinate', get: q => isNum(q.lat) ? 1 : 0, cell: q => isNum(q.lat) ? `${q.lat.toFixed(5)}, ${q.lon.toFixed(5)}` : 'non georeferenziato' }],
      filtrati, {
        size: 12, sort: 1, dir: 1, onRow: q => {
          if (!isNum(q.lat) || !isNum(q.lon)) { toast('Questo civico non ha coordinate: indica il punto cliccando sulla mappa.'); return; }
          localizza(q.lat, q.lon, `${q.odo} ${q.civ}${q.esp ? '/' + q.esp : ''}`);
        }
      }));
  }
  let timer;
  [inVia, inCiv].forEach(i => i.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(cerca, 250); }));
  cerca();

  getJson(`${DATA}/anncsu_full/${istat}.json`).then(j => {
    if (!status.isConnected) return;
    punti = j.punti || [];
    status.textContent = `Stradario completo caricato: ${nf0.format(punti.length)} numeri civici georeferenziati.`;
    cerca();
  }).catch(() => {
    if (!status.isConnected) return;
    status.textContent = punti.length
      ? `Stradario completo non disponibile: la ricerca usa un campione di ${nf0.format(punti.length)} civici.`
      : 'Per questo comune ANNCSU non pubblica civici georeferenziati: per il catasto clicca un punto sulla mappa.';
  });
}
