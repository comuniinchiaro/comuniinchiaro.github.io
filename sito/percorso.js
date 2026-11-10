'use strict';
// Scheda «Indicazioni»: percorso tra due punti e navigazione guidata con il GPS.
// Distanze, tempi e istruzioni arrivano esclusivamente dal motore di calcolo (Valhalla su dati
// OpenStreetMap): se il motore non risponde non viene mostrata alcuna stima sostitutiva.
// Usa le utilità definite in app.js.

const ROUTER = {
  url: 'https://valhalla1.openstreetmap.de/route',
  nome: 'Valhalla (server pubblico FOSSGIS) su dati OpenStreetMap'
};
const MODI = [['auto', 'In auto'], ['pedestrian', 'A piedi'], ['bicycle', 'In bicicletta']];

// Partenza e arrivo restano impostati passando da una scheda all'altra.
const ROUTE = { a: null, b: null, modo: 'auto' };
const NAV = { watch: null, wake: null };
const CIVICI = { istat: null, promise: null };

function fermaNavigazione() {
  if (NAV.watch != null) { navigator.geolocation.clearWatch(NAV.watch); NAV.watch = null; }
  if (NAV.wake) { NAV.wake.release().catch(() => { }); NAV.wake = null; }
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  document.body.classList.remove('navigando');
}

/** Pulsante da inserire in popup e risultati: imposta il punto come arrivo e apre la scheda Indicazioni. */
function linkIndicazioni(punto) {
  return h('button', { class: 'btn ghost small', onclick: () => { ROUTE.b = punto; S.showTab && S.showTab('Indicazioni'); } }, 'Indicazioni fino a qui');
}

const fmtDist = km => km >= 1 ? `${nf1.format(km)} km` : `${nf0.format(Math.round(km * 100) * 10)} m`;
const fmtMetri = m => m >= 1000 ? `${nf1.format(m / 1000)} km` : `${nf0.format(Math.max(10, Math.round(m / 10) * 10))} m`;
function fmtDurata(sec) {
  const min = Math.round(sec / 60);
  if (min < 1) return 'meno di 1 min';
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}

function decodePolyline6(str) {
  const out = []; let i = 0, lat = 0, lon = 0;
  while (i < str.length) {
    for (const k of [0, 1]) {
      let shift = 0, res = 0, b;
      do { b = str.charCodeAt(i++) - 63; res |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const d = res & 1 ? ~(res >> 1) : res >> 1;
      if (k === 0) lat += d; else lon += d;
    }
    out.push([lat / 1e6, lon / 1e6]);
  }
  return out;
}

/** Chiede il percorso al motore di calcolo. Solleva un errore se non è disponibile. */
async function calcolaPercorso(a, b, modo) {
  let r;
  try {
    r = await fetch(ROUTER.url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locations: [{ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon }],
        costing: modo, units: 'kilometers', language: 'it-IT'
      })
    });
  } catch (e) { throw new Error('Il servizio di calcolo dei percorsi non è raggiungibile.'); }
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || !j.trip || !j.trip.legs || !j.trip.legs.length) {
    throw new Error(j && j.error_code
      ? 'Il servizio non ha trovato un percorso stradale tra i due punti (dati stradali mancanti o punti non raggiungibili).'
      : 'Il servizio di calcolo dei percorsi ha risposto con un errore.');
  }
  const leg = j.trip.legs[0];
  const shape = decodePolyline6(leg.shape);
  // Lunghezza progressiva lungo la traccia, in metri: serve alla navigazione per sapere a che punto si è.
  const cum = [0];
  for (let i = 1; i < shape.length; i++) cum.push(cum[i - 1] + metri(shape[i - 1], shape[i]));
  return { km: j.trip.summary.length, sec: j.trip.summary.time, shape, cum, manovre: leg.maneuvers, pedaggi: j.trip.summary.has_toll, traghetti: j.trip.summary.has_ferry };
}

function metri(p, q) {
  const kx = 111320 * Math.cos((p[0] + q[0]) / 2 * Math.PI / 180), ky = 110540;
  return Math.hypot((q[1] - p[1]) * kx, (q[0] - p[0]) * ky);
}

/** Proietta la posizione sulla traccia: distanza percorsa lungo il percorso e scostamento laterale (metri). */
function proietta(perc, lat, lon) {
  const kx = 111320 * Math.cos(lat * Math.PI / 180), ky = 110540;
  let best = { fuori: Infinity, lungo: 0 };
  for (let i = 0; i < perc.shape.length - 1; i++) {
    const ax = (perc.shape[i][1] - lon) * kx, ay = (perc.shape[i][0] - lat) * ky;
    const bx = (perc.shape[i + 1][1] - lon) * kx, by = (perc.shape[i + 1][0] - lat) * ky;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best.fuori) best = { fuori: d, lungo: perc.cum[i] + t * Math.sqrt(l2) };
  }
  return best;
}

function loadCivici(istat) {
  if (CIVICI.istat !== istat) {
    CIVICI.istat = istat;
    CIVICI.promise = getJson(`${DATA}/anncsu_full/${istat}.json`).then(j => (j.punti || []).filter(q => isNum(q.lat) && isNum(q.lon)));
    CIVICI.promise.catch(() => { CIVICI.istat = null; });
  }
  return CIVICI.promise;
}

function posizioneGps() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('Questo dispositivo non mette a disposizione la posizione.'));
    navigator.geolocation.getCurrentPosition(
      p => res({ lat: p.coords.latitude, lon: p.coords.longitude, label: `La mia posizione (precisione ±${nf0.format(p.coords.accuracy)} m)` }),
      e => rej(new Error(e.code === 1 ? 'Accesso alla posizione negato: consenti la posizione per questo sito e riprova.'
        : 'Posizione non disponibile: verifica che il GPS sia attivo e riprova.')),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 });
  });
}

function tabIndicazioni(p, d, c) {
  const istat = c.i;
  let scelta = null;      // 'a' | 'b' quando si sta scegliendo un punto sulla mappa
  let perc = null;        // ultimo percorso calcolato
  const esito = h('div');
  const banner = h('div', { class: 'nav-banner', hidden: true });
  const mapEl = h('div', { class: 'map', style: 'height:560px;min-height:0' });
  const avviso = h('div', { class: 'src' });

  // Luoghi georeferenziati del comune, proponibili come partenza o arrivo.
  const gruppi = [
    ['Farmacie', d.sanita_mds?.farmacie?.punti, q => q.nome], ['Parafarmacie', d.sanita_mds?.parafarmacie?.punti, q => q.nome],
    ['Distributori di carburante', d.carburanti?.punti, q => `${q.brand || ''} ${q.name || ''}`.trim()],
    ['Punti di ricarica elettrica', d.pun?.punti, q => `${q.indirizzo || q.id_evse}${q.cpo ? ' (' + q.cpo + ')' : ''}`],
    ['Beni culturali', d.beni_culturali?.luoghi, q => q.denom], ['Stazioni qualità dell\'aria', d.aria?.stazioni, q => q.nome]
  ].map(([g, l, f]) => [g, (l || []).filter(q => isNum(q.lat) && isNum(q.lon)).map(q => ({ lat: q.lat, lon: q.lon, label: cut(f(q), 60) }))])
    .filter(g => g[1].length);

  function selettore(chi, titolo) {
    const stato = h('div', { class: 'punto-stato' });
    const extra = h('div');
    const set = pt => { ROUTE[chi] = pt; scelta = null; extra.replaceChildren(); aggiorna(); };
    const bGps = h('button', { class: 'btn ghost small' }, 'La mia posizione');
    bGps.onclick = async () => {
      bGps.disabled = true; avviso.textContent = 'Lettura della posizione…';
      try { set(await posizioneGps()); avviso.textContent = ''; } catch (e) { avviso.textContent = e.message; }
      bGps.disabled = false;
    };
    const bMap = h('button', { class: 'btn ghost small', onclick: () => { scelta = chi; avviso.textContent = `Tocca la mappa per indicare ${titolo.toLowerCase()}.`; } }, 'Scegli sulla mappa');
    const bCiv = h('button', { class: 'btn ghost small' }, 'Cerca civico');
    bCiv.onclick = async () => {
      const inV = h('input', { class: 'input', type: 'search', placeholder: `Via e numero a ${c.n}…`, style: 'width:100%;margin-top:8px' });
      const lista = h('div', { class: 'src' }, 'Caricamento dello stradario…');
      extra.replaceChildren(inV, lista);
      let punti;
      try { punti = await loadCivici(istat); } catch { lista.textContent = 'Stradario con coordinate non disponibile per questo comune.'; return; }
      lista.textContent = 'Scrivi la via e, alla fine, il numero civico (es. «via taranto 10»).';
      inV.focus();
      inV.oninput = () => {
        const tok = norm(inV.value).split(' ').filter(Boolean);
        if (!tok.length) { lista.replaceChildren(); return; }
        const num = /^\d+$/.test(tok[tok.length - 1]) && tok.length > 1 ? tok.pop() : null;
        const trovati = [];
        for (const q of punti) {
          if (num && String(q.civ) !== num) continue;
          q.k ??= norm(q.odo);
          if (tok.every(t => q.k.includes(t))) { trovati.push(q); if (trovati.length >= 8) break; }
        }
        lista.replaceChildren(...(trovati.length ? trovati.map(q => {
          const nome = `${q.odo} ${q.civ}${q.esp ? '/' + q.esp : ''}`;
          return h('div', null, h('a', { href: '#', onclick: e => { e.preventDefault(); set({ lat: q.lat, lon: q.lon, label: `${nome}, ${c.n}` }); } }, nome));
        }) : ['Nessun civico trovato.']));
      };
    };
    const sel = gruppi.length ? h('select', { style: 'height:30px;max-width:230px', onchange: () => {
      const [g, i] = sel.value.split(':'); if (g !== '') set(gruppi[+g][1][+i]); sel.value = '';
    } }, h('option', { value: '' }, 'Luogo del comune…'),
      gruppi.map(([nome, l], gi) => h('optgroup', { label: nome }, l.map((pt, i) => h('option', { value: gi + ':' + i }, pt.label))))) : null;
    return {
      el: h('div', { class: 'punto' }, h('div', { class: 'lab' }, titolo), stato, h('div', { class: 'actions', style: 'margin-top:6px' }, bGps, bMap, bCiv, sel), extra),
      draw: () => {
        const pt = ROUTE[chi];
        stato.replaceChildren(pt ? h('b', null, pt.label) : 'non impostato', pt && h('span', { class: 'src' }, ` · ${pt.lat.toFixed(5)}, ${pt.lon.toFixed(5)}`));
      }
    };
  }
  const selA = selettore('a', 'Partenza'), selB = selettore('b', 'Arrivo');
  const selModo = h('select', { onchange: () => { ROUTE.modo = selModo.value; } }, MODI.map(([v, t]) => h('option', { value: v, selected: v === ROUTE.modo }, t)));
  const bCalc = h('button', { class: 'btn' }, 'Calcola percorso');
  const bInv = h('button', { class: 'btn ghost', title: 'Scambia partenza e arrivo', onclick: () => { [ROUTE.a, ROUTE.b] = [ROUTE.b, ROUTE.a]; aggiorna(); } }, '⇅ Inverti');

  p.append(banner, h('div', { class: 'split' },
    h('div', null,
      h('div', { class: 'card' }, h('h3', null, 'Indicazioni stradali'), h('div', { class: 'src' }, 'Percorso calcolato da ' + ROUTER.nome),
        selA.el, selB.el,
        h('div', { class: 'filters', style: 'margin:12px 0 4px' }, h('label', null, 'Mezzo', selModo), bInv, bCalc), avviso),
      esito),
    mapEl));

  const map = S.map = L.map(mapEl);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>'
  }).addTo(map);
  const ext = d.territorio?.geo?.extent, bb = d.anncsu?.kpi?.bbox;
  if (ext) map.fitBounds([[ext[0][1], ext[0][0]], [ext[1][1], ext[1][0]]]);
  else if (bb) map.fitBounds([[bb.lat_min, bb.lon_min], [bb.lat_max, bb.lon_max]]);
  else map.setView([42, 12.5], 6);
  const lPunti = L.layerGroup().addTo(map), lPerc = L.layerGroup().addTo(map), lPos = L.layerGroup().addTo(map);
  setTimeout(() => map.invalidateSize(), 50);

  map.on('click', e => {
    if (!scelta) return;
    ROUTE[scelta] = { lat: e.latlng.lat, lon: e.latlng.lng, label: 'Punto scelto sulla mappa' };
    scelta = null; avviso.textContent = ''; aggiorna();
  });

  function aggiorna() {
    selA.draw(); selB.draw();
    lPunti.clearLayers(); lPerc.clearLayers(); perc = null; esito.replaceChildren();
    const mk = (pt, color, lettera) => pt && L.marker([pt.lat, pt.lon], {
      icon: L.divIcon({ className: '', html: `<div class="pin" style="background:${color}">${lettera}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] })
    }).addTo(lPunti);
    mk(ROUTE.a, '#008055', 'A'); mk(ROUTE.b, '#CC334D', 'B');
    const pts = [ROUTE.a, ROUTE.b].filter(Boolean).map(q => [q.lat, q.lon]);
    if (pts.length === 2) map.fitBounds(pts, { padding: [40, 40], maxZoom: 17 });
    else if (pts.length === 1) map.setView(pts[0], Math.max(map.getZoom(), 15));
  }

  function mostraPercorso(nota) {
    lPerc.clearLayers();
    L.polyline(perc.shape, { color: '#0066CC', weight: 6, opacity: .85 }).addTo(lPerc);
    const bNav = h('button', { class: 'btn' }, 'Avvia navigazione');
    bNav.onclick = avviaNavigazione;
    esito.replaceChildren(h('div', { class: 'card', style: 'margin-top:16px' },
      h('div', { class: 'tiles', style: 'margin-bottom:10px' },
        tile('Distanza', fmtDist(perc.km), 'lungo il percorso'), tile('Durata', fmtDurata(perc.sec), 'stima del motore, senza traffico')),
      nota && h('div', { class: 'src' }, nota),
      (perc.pedaggi || perc.traghetti) && h('div', { class: 'note', style: 'margin:0 0 8px' }, [perc.pedaggi && 'Il percorso include tratti a pedaggio.', perc.traghetti && 'Il percorso include un traghetto.'].filter(Boolean).join(' ')),
      h('div', { class: 'actions', style: 'margin-bottom:12px' }, bNav),
      h('ol', { class: 'manovre' }, perc.manovre.map(m => h('li', null, h('span', null, m.instruction),
        m.length > 0 && h('small', null, fmtDist(m.length))))),
      h('div', { class: 'src', style: 'margin-top:10px' }, `Distanze, tempi e istruzioni: ${ROUTER.nome}. I tempi sono stime del motore di calcolo e non tengono conto di traffico, cantieri o chiusure.`)));
  }

  async function calcola(daNavigazione) {
    if (!ROUTE.a || !ROUTE.b) { avviso.textContent = 'Imposta sia la partenza sia l\'arrivo.'; return false; }
    bCalc.disabled = true; avviso.textContent = 'Calcolo del percorso…';
    try {
      perc = await calcolaPercorso(ROUTE.a, ROUTE.b, ROUTE.modo);
      if (!esito.isConnected) return false;
      avviso.textContent = '';
      mostraPercorso();
      if (!daNavigazione) map.fitBounds(L.polyline(perc.shape).getBounds(), { padding: [30, 30] });
      return true;
    } catch (e) {
      if (!esito.isConnected) return false;
      perc = null; lPerc.clearLayers(); avviso.textContent = '';
      // Nessun percorso documentato: si mostrano solo i dati certi, senza distanze o tempi stimati.
      esito.replaceChildren(h('div', { class: 'card', style: 'margin-top:16px' }, h('h3', null, 'Percorso non disponibile'),
        h('div', { class: 'empty', style: 'text-align:left;padding:8px 0' }, e.message),
        kv([['Partenza', `${ROUTE.a.label} (${ROUTE.a.lat.toFixed(5)}, ${ROUTE.a.lon.toFixed(5)})`], ['Arrivo', `${ROUTE.b.label} (${ROUTE.b.lat.toFixed(5)}, ${ROUTE.b.lon.toFixed(5)})`]]),
        h('div', { class: 'src', style: 'margin-top:8px' }, 'In assenza di un percorso calcolato non vengono indicate distanze né tempi di percorrenza.')));
      return false;
    } finally { bCalc.disabled = false; }
  }
  bCalc.onclick = () => { fermaNav(); calcola(false); };

  // ---------------- Navigazione guidata ----------------
  let ultimoRicalcolo = 0, ultimaVoce = '', ricalcolo = false, voce = true;

  // "chiave" identifica l'annuncio: ogni annuncio viene pronunciato una sola volta.
  function parla(testo, chiave = testo) {
    if (!voce || !window.speechSynthesis || chiave === ultimaVoce) return;
    ultimaVoce = chiave;
    const u = new SpeechSynthesisUtterance(testo); u.lang = 'it-IT';
    window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
  }
  function fermaNav() {
    fermaNavigazione();
    banner.hidden = true; lPos.clearLayers();
  }

  function avviaNavigazione() {
    if (!perc) return;
    if (!navigator.geolocation) { avviso.textContent = 'La navigazione richiede un dispositivo con GPS.'; return; }
    fermaNav();
    ultimaVoce = ''; ultimoRicalcolo = Date.now();
    document.body.classList.add('navigando');
    banner.hidden = false;
    banner.replaceChildren(h('div', { class: 'nav-istr' }, 'In attesa della posizione GPS…'));
    if (navigator.wakeLock) navigator.wakeLock.request('screen').then(w => { NAV.wake = w; }).catch(() => { });
    banner.scrollIntoView({ block: 'start' });
    NAV.watch = navigator.geolocation.watchPosition(suPosizione, e => {
      banner.replaceChildren(h('div', { class: 'nav-istr' }, e.code === 1 ? 'Accesso alla posizione negato.' : 'Segnale GPS non disponibile…'), pulsantiNav());
    }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 30000 });
  }
  const pulsantiNav = () => h('div', { class: 'actions' },
    h('button', { class: 'btn ghost small', onclick: e => { voce = !voce; if (!voce && window.speechSynthesis) window.speechSynthesis.cancel(); e.target.textContent = voce ? 'Voce attiva' : 'Voce spenta'; } }, voce ? 'Voce attiva' : 'Voce spenta'),
    h('button', { class: 'btn small', onclick: fermaNav }, 'Termina navigazione'));

  async function suPosizione(pos) {
    if (!banner.isConnected) { fermaNavigazione(); return; }
    if (!perc || ricalcolo) return;
    const lat = pos.coords.latitude, lon = pos.coords.longitude, acc = pos.coords.accuracy || 0;
    lPos.clearLayers();
    L.circle([lat, lon], { radius: acc, color: '#0066CC', weight: 1, fillOpacity: .12, interactive: false }).addTo(lPos);
    L.circleMarker([lat, lon], { radius: 8, color: '#fff', weight: 3, fillColor: '#0066CC', fillOpacity: 1, interactive: false }).addTo(lPos);
    map.setView([lat, lon], Math.max(map.getZoom(), 17), { animate: true });

    const pr = proietta(perc, lat, lon);
    const totale = perc.cum[perc.cum.length - 1];
    const residuo = totale - pr.lungo;

    // Fuori percorso (oltre la precisione del GPS): si chiede un nuovo percorso al motore.
    if (pr.fuori > Math.max(60, acc * 1.5) && Date.now() - ultimoRicalcolo > 15000) {
      ricalcolo = true; ultimoRicalcolo = Date.now();
      banner.replaceChildren(h('div', { class: 'nav-istr' }, 'Ricalcolo del percorso…'), pulsantiNav());
      parla('Ricalcolo del percorso');
      ROUTE.a = { lat, lon, label: 'La mia posizione' };
      selA.draw();
      const ok = await calcola(true);
      ricalcolo = false;
      if (!ok) { fermaNav(); avviso.textContent = 'Navigazione interrotta: non è stato possibile ricalcolare il percorso.'; }
      return;
    }

    if (residuo < 25) {
      banner.replaceChildren(h('div', { class: 'nav-istr' }, 'Sei arrivato a destinazione.'), pulsantiNav());
      parla('Sei arrivato a destinazione');
      fermaNavigazione();
      return;
    }

    // Manovra in corso e prossima manovra, in base al punto raggiunto lungo la traccia.
    const ms = perc.manovre;
    let i = 0;
    while (i < ms.length - 1 && perc.cum[ms[i + 1].begin_shape_index] <= pr.lungo) i++;
    const prossima = ms[i + 1];
    const mancano = prossima ? perc.cum[prossima.begin_shape_index] - pr.lungo : residuo;
    const inizio = perc.cum[ms[i].begin_shape_index], fine = perc.cum[ms[i].end_shape_index] || inizio;
    const quota = fine > inizio ? Math.min(1, Math.max(0, (fine - pr.lungo) / (fine - inizio))) : 0;
    // Tempo residuo: somma dei tempi forniti dal motore per le manovre ancora da compiere.
    const secResidui = ms[i].time * quota + ms.slice(i + 1).reduce((s, m) => s + m.time, 0);

    const testo = prossima ? prossima.instruction : 'Prosegui fino a destinazione.';
    banner.replaceChildren(
      h('div', { class: 'nav-dist' }, `tra ${fmtMetri(mancano)}`),
      h('div', { class: 'nav-istr' }, testo),
      h('div', { class: 'nav-info' }, `Restano ${fmtMetri(residuo)} · circa ${fmtDurata(secResidui)} (stima del motore) · GPS ±${nf0.format(acc)} m`),
      pulsantiNav());
    if (prossima) {
      if (mancano > 150) parla(`Tra ${fmtMetri(mancano).replace(' km', ' chilometri').replace(/ m$/, ' metri')}, ${testo}`, i + ':lontano');
      else parla(prossima.verbal_pre_transition_instruction || testo, i + ':vicino');
    }
  }

  aggiorna();
  if (ROUTE.a && ROUTE.b) calcola(false);
  else if (ROUTE.b && !ROUTE.a) avviso.textContent = 'Arrivo impostato: indica ora la partenza (per esempio «La mia posizione»).';
}
