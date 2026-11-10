'use strict';
// Scheda di dettaglio del singolo comune. Usa le utilità definite in app.js.

const nomeComune = istat => S.byIstat.get(istat)?.n || istat;
const has = o => o && typeof o === 'object' && Object.keys(o).length > 0;

/** Esegue il disegno di una sezione; se il dato manca mostra un avviso invece di interrompere la pagina. */
function section(parent, title, data, fn) {
  parent.append(h('h2', { class: 'section-title' }, title));
  if (!has(data)) { parent.append(h('div', { class: 'card empty' }, 'Dato non disponibile per questo comune.')); return; }
  try {
    const out = fn(data);
    parent.append(...[out].flat(Infinity).filter(Boolean));
  } catch (e) {
    console.error(title, e);
    parent.append(h('div', { class: 'card empty' }, 'Dato non disponibile o incompleto per questo comune.'));
  }
}

async function viewComune(main, istat) {
  const c = S.byIstat.get(istat);
  main.replaceChildren(h('div', { class: 'wrap' }, h('div', { class: 'loading' }, `Caricamento di ${c.n}…`)));
  let d;
  try { d = await getDashboard(istat); }
  catch (e) {
    main.replaceChildren(h('div', { class: 'wrap' }, h('div', { class: 'error' }, `Impossibile caricare i dati di ${c.n}: ${e.message}`)));
    return;
  }
  if (location.hash !== '#/comune/' + istat) return;

  const an = d.anagrafica || {};
  const inConfronto = () => confronto.get().includes(istat);
  const btnC = h('button', { class: 'btn ghost' });
  const syncBtn = () => { btnC.textContent = inConfronto() ? '✓ Nel confronto' : 'Aggiungi al confronto'; };
  btnC.onclick = () => { inConfronto() ? confronto.remove(istat) : confronto.add(istat); syncBtn(); };
  syncBtn();

  // Export a livello di ente: tutti gli indicatori chiave del comune.
  const btnX = h('button', { class: 'btn' }, 'Esporta scheda (Excel)');
  btnX.onclick = () => {
    const rows = [['Anagrafica', 'Comune', c.n], ['Anagrafica', 'Provincia', c.p], ['Anagrafica', 'Regione', c.r],
      ['Anagrafica', 'Codice ISTAT', istat], ['Anagrafica', 'Codice catastale (Belfiore)', c.c || '']];
    for (const [grp, o] of Object.entries(d.kpi_summary || {})) {
      if (grp === 'anagrafica' || !has(o)) continue;
      for (const [key, v] of Object.entries(o)) if (!key.startsWith('_') && v !== null && typeof v !== 'object') rows.push([label(grp), label(key), v]);
    }
    exportXlsx(btnX, `Scheda_${c.n.replace(/[^\p{L}\p{N}]+/gu, '_')}.xlsx`, 'Indicatori', ['Area', 'Indicatore', 'Valore'], rows);
  };

  const TABS = [
    ['Sintesi', tabSintesi], ['Demografia', tabDemografia], ['Economia', tabEconomia], ['Finanza pubblica', tabFinanza],
    ['Territorio e ambiente', tabTerritorio], ['Servizi', tabServizi], ['Mappa', tabMappa], ['Indirizzi e catasto', tabIndirizzi], ['Indicazioni', tabIndicazioni], ['Amministrazione', tabAmministrazione]
  ];
  const panel = h('div');
  const buttons = TABS.map(([name, fn], i) => h('button', { onclick: () => show(i) }, name));
  S.showTab = name => { const i = TABS.findIndex(t => t[0] === name); if (i >= 0) show(i); };
  function show(i) {
    fermaNavigazione();
    buttons.forEach((b, k) => b.classList.toggle('active', k === i));
    S.charts.forEach(ch => ch.destroy()); S.charts = [];
    if (S.map) { S.map.remove(); S.map = null; }
    panel.replaceChildren();
    try { TABS[i][1](panel, d, c); }
    catch (e) { console.error(e); panel.append(h('div', { class: 'error' }, 'Errore nella visualizzazione: ' + e.message)); }
  }

  main.replaceChildren(h('div', { class: 'wrap' },
    h('div', { class: 'page-head' },
      h('div', null, h('h1', null, c.n), h('div', { class: 'sub' }, `Provincia di ${c.p} · ${c.r}`),
        h('div', { class: 'chips' },
          h('span', { class: 'chip' }, 'ISTAT ', h('b', null, istat)),
          h('span', { class: 'chip' }, 'Catastale (Belfiore) ', h('b', null, an.codice_catastale || c.c || '—')),
          an.codice_fiscale && h('span', { class: 'chip' }, 'Cod. fiscale ', h('b', null, an.codice_fiscale)),
          an.codice_ipa && h('span', { class: 'chip' }, 'IPA ', h('b', null, an.codice_ipa)),
          has(d._missing) && h('span', { class: 'chip' }, 'Sezioni mancanti: ', h('b', null, d._missing.join(', '))))),
      h('div', { class: 'actions' }, btnX, btnC)),
    h('div', { class: 'tabs' }, buttons), panel));
  show(0);
}

// ================= Sintesi =================

function tabSintesi(p, d, c) {
  const k = d.kpi_summary || {};
  const g = (a, b) => k[a]?.[b];
  p.append(tiles(
    tile('Popolazione', F.n(g('demografia', 'popolazione')), g('demografia', 'riferimento')),
    tile('Età media', F.d1(g('demografia', 'eta_media')), 'anni'),
    tile('Saldo naturale', F.n(g('demografia', 'saldo_naturale')), g('demografia', 'anno_dinamica') && `nati − morti, ${g('demografia', 'anno_dinamica')}`),
    tile('Reddito medio', F.eur(g('redditi_mef', 'reddito_medio_eur')), g('redditi_mef', 'anno_fiscale') && `anno d'imposta ${g('redditi_mef', 'anno_fiscale')}`),
    tile('Tasso di occupazione', F.pct(g('lavoro_profilo', 'tasso_occupazione')), '25-64 anni'),
    tile('Imprese (unità locali)', F.n(g('imprese_asia', 'ul_totali')), isNum(g('imprese_asia', 'addetti_totali')) && F.n(g('imprese_asia', 'addetti_totali')) + ' addetti'),
    tile('Uscite di cassa', F.eurc(g('siope', 'totale_uscite_eur')), isNum(g('siope', 'uscite_per_abitante_eur')) && F.eur(g('siope', 'uscite_per_abitante_eur')) + ' per abitante'),
    tile('PNRR assegnato', F.eurc(g('pnrr', 'importo_assegnato_eur')), isNum(g('pnrr', 'n_progetti')) && F.n(g('pnrr', 'n_progetti')) + ' progetti'),
    tile('Contratti pubblici', F.eurc(g('contratti_anac', 'importo_totale_eur')), isNum(g('contratti_anac', 'n_aggiudicazioni')) && F.n(g('contratti_anac', 'n_aggiudicazioni')) + ' aggiudicazioni'),
    tile('Raccolta differenziata', F.pct(g('ambiente', 'raccolta_differenziata_pct'))),
    tile('Copertura FTTH', F.pct(g('banda_larga_agcom', 'copertura_ftth_pct')), 'famiglie raggiunte'),
    tile('Quotazione residenziale', isNum(g('quotazioni_omi', 'residenziale_medio')) ? F.n(g('quotazioni_omi', 'residenziale_medio')) + ' €/mq' : '—', 'valore medio OMI')));

  const sind = card('Sindaco', 'Ministero dell\'Interno – Anagrafe Amministratori Locali', h('div', { class: 'loading' }, 'Caricamento…'));
  host('amministratori', { nome: c.n, prov: c.p }).then(r => {
    sind.lastChild.replaceWith(h('div', null, h('div', { class: 'big-name' }, r.sindaco || 'Dato non disponibile'),
      h('div', { class: 'src' }, `Anagrafe aggiornata al ${r.aggiornamento} · dettaglio nella scheda «Amministrazione»`)));
  }).catch(e => sind.lastChild.replaceWith(h('div', { class: 'empty' }, e.message)));

  const m = d.meteo;
  const meteo = has(m) ? card('Meteo', `${m.fonte || 'ItaliaMeteo'} · previsione per ${new Date(m.valid_time_utc).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}`,
    h('div', { class: 'big-name' }, `${F.d1(m.t2m_c)} °C · ${m.ww_desc || ''}`),
    kv([['Minima / massima 24h', `${F.d1(m.t2m_min24h_c)} / ${F.d1(m.t2m_max24h_c)} °C`], ['Precipitazioni 24h', F.d1(m.prec_24h_mm) + ' mm'],
      ['Umidità', F.pct(m.umidita_pct)], ['Vento', F.d1(m.vento_kmh) + ' km/h'], ['Raffica massima 24h', F.d1(m.raffica_max24h_kmh) + ' km/h'],
      ['Nuvolosità', F.pct(m.nuvolosita_pct)], m.neve_cm ? ['Neve al suolo', F.d1(m.neve_cm) + ' cm'] : null])) : null;
  p.append(grid(sind, meteo));

  const tbody = h('tbody');
  for (const [grp, o] of Object.entries(k)) {
    if (!has(o)) continue;
    const rows = Object.entries(o).filter(([key, v]) => !key.startsWith('_') && (v === null || typeof v !== 'object'));
    if (!rows.length) continue;
    tbody.append(h('tr', { class: 'group' }, h('td', { colspan: 2 }, label(grp))));
    rows.forEach(([key, v]) => tbody.append(h('tr', null, h('td', null, label(key)), h('td', { class: 'num' }, F.auto(v)))));
  }
  p.append(h('div', { class: 'card' }, h('h3', null, 'Tutti gli indicatori chiave'),
    h('div', { class: 'src' }, 'Sintesi di tutte le aree tematiche della piattaforma'), h('div', { class: 'tbl-wrap' }, h('table', null, tbody))));
}

// ================= Demografia =================

function tabDemografia(p, d) {
  section(p, 'Popolazione residente', d.demografia, x => {
    const f = x.fasce_eta || {};
    const out = [tiles(
      tile('Popolazione', F.n(x.popolazione_totale), x._riferimento),
      tile('Maschi', F.n(x.maschi), F.pct(x.pct_maschi)), tile('Femmine', F.n(x.femmine), F.pct(x.pct_femmine)),
      tile('Età media', F.d1(x.eta_media)), tile('Indice di vecchiaia', F.d1(x.indice_vecchiaia), 'over 65 ogni 100 under 15'),
      tile('Indice di dipendenza', F.d1(x.indice_dipendenza)))];
    const cards = [];
    if (has(x.piramide)) {
      const cls = [];
      for (const r of x.piramide) {
        const i = Math.min(Math.floor(r.eta / 5), 20);
        cls[i] ??= { l: i === 20 ? '100+' : `${i * 5}-${i * 5 + 4}`, m: 0, f: 0 };
        cls[i].m += r.m || 0; cls[i].f += r.f || 0;
      }
      const rev = cls.filter(Boolean).reverse();
      cards.push(card('Piramide delle età', 'ISTAT POSAS', mkChart({
        type: 'bar',
        data: { labels: rev.map(r => r.l), datasets: [
          { label: 'Maschi', data: rev.map(r => -r.m), backgroundColor: PAL[0] }, { label: 'Femmine', data: rev.map(r => r.f), backgroundColor: PAL[3] }] },
        options: { indexAxis: 'y', _abs: true, scales: { x: { stacked: true, ticks: { callback: v => nfc.format(Math.abs(v)) } }, y: { stacked: true, grid: { display: false } } } }
      }, true)));
    }
    if (has(f)) cards.push(card('Grandi classi di età', 'ISTAT POSAS',
      pieChart(['0-14 anni', '15-64 anni', '65 anni e più'], [f['0_14']?.n, f['15_64']?.n, f['65_piu']?.n]),
      f['85_piu'] && h('div', { class: 'src' }, `di cui 85 anni e più: ${F.n(f['85_piu'].n)} (${F.pct(f['85_piu'].pct)})`)));
    const ss = x.serie_storica?.punti;
    if (has(ss)) cards.push(card('Popolazione al 1° gennaio', x.serie_storica._fonte,
      lineChart(ss.map(r => r.anno + (r.stima ? '*' : '')), [{ label: 'Popolazione', data: ss.map(r => r.popolazione) }]),
      ss.some(r => r.stima) && h('div', { class: 'src' }, '* stima')));
    const dn = x.dinamica?.anni;
    if (has(dn)) {
      cards.push(card('Nati e morti', 'ISTAT – bilancio demografico', barChart(dn.map(r => r.anno), [
        { label: 'Nati', data: dn.map(r => r.nati), backgroundColor: PAL[1] }, { label: 'Morti', data: dn.map(r => r.morti), backgroundColor: PAL[4] }])));
      cards.push(card('Saldi demografici', 'ISTAT – bilancio demografico', barChart(dn.map(r => r.anno), [
        { label: 'Saldo naturale', data: dn.map(r => r.saldo_naturale) }, { label: 'Saldo migratorio interno', data: dn.map(r => r.saldo_migratorio_interno) },
        { label: 'Saldo migratorio estero', data: dn.map(r => r.saldo_migratorio_estero) }])));
    }
    out.push(grid(cards));
    return out;
  });

  section(p, 'Istruzione, lavoro e famiglie', d.profilo, x => {
    const i = x.istruzione || {}, l = x.lavoro || {}, fa = x.famiglie || {}, ci = x.cittadinanza || {}, mo = x.mobilita || {};
    return [tiles(
      tile('Laureati (25-64 anni)', F.pct(i.terziario_pct), i.anno), tile('Almeno il diploma', F.pct(i.diploma_oltre_pct), i.anno),
      tile('Tasso di occupazione', F.pct(l.tasso_occupazione), l.anno), tile('Tasso di disoccupazione', F.pct(l.tasso_disoccupazione), l.anno),
      tile('Famiglie', F.n(fa.n_famiglie), isNum(fa.dim_media_famiglia) && `${F.d2(fa.dim_media_famiglia)} componenti in media`),
      tile('Stranieri residenti', F.n(ci.stranieri_n), F.pct(ci.stranieri_pct))),
    grid(
      has(i.dettaglio) && card('Titolo di studio (25-64 anni)', x.fonte, objBar(i.dettaglio)),
      has(l) && card('Condizione lavorativa (25-64 anni)', x.fonte, kv([
        ['Popolazione di riferimento', F.n(l.pop_riferimento_25_64)], ['Occupati', F.n(l.occupati_n)], ['In cerca di occupazione', F.n(l.in_cerca_n)],
        ['Forze di lavoro', F.n(l.forze_lavoro_n)], ['Tasso di attività', F.pct(l.tasso_attivita)]])),
      has(mo) && card(`Mobilità quotidiana (${mo.anno})`, x.fonte, kv([
        ['Pendolari totali', F.n(mo.pendolari_totale_n)], ['Fuori comune', `${F.n(mo.fuori_comune_n)} (${F.pct(mo.fuori_comune_pct)})`],
        ['Per lavoro', `${F.n(mo.per_lavoro_n)} (${F.pct(mo.per_lavoro_pct)})`], ['Per studio', `${F.n(mo.per_studio_n)} (${F.pct(mo.per_studio_pct)})`]])),
      has(ci) && card('Cittadinanza', x.fonte, pieChart(['Italiani', 'Stranieri'], [ci.italiani_n, ci.stranieri_n])))];
  });

  section(p, 'Censimento permanente', d.censimento, x => {
    const k = x.kpi_comune || {}, ds = x.distribuzioni_comune || {};
    return [tiles(
      tile('Sezioni di censimento', F.n(k.n_sezioni)), tile('Famiglie', F.n(k.famiglie_totali)),
      tile('Abitazioni', F.n(k.abitazioni_totali), isNum(k.abitazioni_vuote) && F.n(k.abitazioni_vuote) + ' non occupate'),
      tile('Stranieri', F.n(k.stranieri_totali), isNum(k.stranieri_ue) && `${F.n(k.stranieri_ue)} UE · ${F.n(k.stranieri_extra_ue)} extra UE`),
      tile('Occupati 15-64', F.n(k.occupati_15_64))),
    grid(
      has(ds.eta_5anni) && card('Popolazione per classi quinquennali', x._source, objBar(ds.eta_5anni, { raw: true })),
      has(ds.famiglie_componenti) && card('Famiglie per numero di componenti', x._source, objBar(ds.famiglie_componenti, { raw: true, colors: PAL[1] })),
      has(ds.titolo_studio_9plus) && card('Titolo di studio (9 anni e più)', x._source, objBar(ds.titolo_studio_9plus, { colors: PAL[5] })),
      isNum(k.abitazioni_occupate) && card('Abitazioni', x._source, pieChart(['Occupate', 'Non occupate'], [k.abitazioni_occupate, k.abitazioni_vuote])))];
  });
}

// ================= Economia =================

function tabEconomia(p, d) {
  section(p, 'Redditi IRPEF', d.redditi, x => {
    const anni = x.anni_disponibili || Object.keys(x.anni || {});
    const last = x.anni?.[anni[anni.length - 1]] || {};
    const tr = x.trend || [];
    const tp = last.tipologie || {};
    const fasce = Object.values(last.fasce || {});
    return [tiles(
      tile('Contribuenti', F.n(last.contribuenti), 'anno d\'imposta ' + anni[anni.length - 1]), tile('Reddito medio', F.eur(last.reddito_complessivo?.medio)),
      tile('Reddito complessivo', F.eurc(last.reddito_complessivo?.tot)), tile('Imposta netta media', F.eur(last.imposta_netta?.medio)),
      tile('Addizionale comunale media', F.eur(last.addizionale_comunale?.medio))),
    grid(
      has(tr) && card('Reddito medio per anno d\'imposta', x.fonte, lineChart(tr.map(r => r.anno), [{ label: 'Reddito medio (€)', data: tr.map(r => r.reddito_medio) }])),
      has(fasce) && card('Contribuenti per fascia di reddito', x.fonte, barChart(fasce.map(f => f.label), fasce.map(f => f.freq), { label: 'Contribuenti' })),
      has(tp) && card('Reddito medio per tipologia', x.fonte, barChart(Object.keys(tp).map(label), Object.values(tp).map(t => t.medio), { colors: PAL[1], label: 'Reddito medio (€)' })),
      has(tp) && card('Contribuenti per tipologia di reddito', x.fonte, barChart(Object.keys(tp).map(label), Object.values(tp).map(t => t.freq), { colors: PAL[5], label: 'Contribuenti' })))];
  });

  section(p, 'Imprese e addetti', d.asia, x => {
    const k = x.kpi || {}, s = x.serie_storica || {};
    return [tiles(
      tile('Unità locali', F.n(k.ul_totali), 'anno ' + x._latest_year), tile('Addetti', F.n(k.addetti_totali)),
      tile('Addetti per unità locale', F.d2(k.addetti_per_ul)), tile('Variazione annua UL', F.pct(k.ul_yoy_pct))),
    grid(
      has(s.anni) && card('Unità locali e addetti', x._source, lineChart(s.anni, [{ label: 'Unità locali', data: s.ul }, { label: 'Addetti', data: s.addetti, yAxisID: 'y2' }])),
      has(k.mix_classe_addetti) && card('Unità locali per classe di addetti (%)', x._source, pieChart(
        ['0-9 addetti', '10-49', '50-249', '250 e oltre'], ['W0_9', 'W10_49', 'W50_249', 'W_GE250'].map(c => k.mix_classe_addetti[c]))),
      has(k.top_settori_ul) && card('Primi settori per unità locali', x._source, barChart(k.top_settori_ul.map(r => r.label), k.top_settori_ul.map(r => r.ul), { horizontal: true, label: 'Unità locali' })),
      has(k.top_settori_addetti) && card('Primi settori per addetti', x._source, barChart(k.top_settori_addetti.map(r => r.label), k.top_settori_addetti.map(r => r.addetti), { horizontal: true, colors: PAL[1], label: 'Addetti' })))];
  });

  section(p, 'Turismo', d.turismo, x => {
    const c = x.capacita_comune || {}, fl = x.flussi_provincia || {};
    const tipi = [];
    for (const [k, v] of Object.entries({ ...(c.alberghi || {}), ...(c.extra_alberghiero || {}) }))
      if (v && typeof v === 'object' && isNum(v.letti)) tipi.push([label(k), v.strutture, v.letti]);
    return [tiles(
      tile('Strutture ricettive', F.n(c.totale_strutture), c.anno), tile('Posti letto', F.n(c.totale_letti)),
      tile('Alberghi', F.n(c.alberghi?.totale_strutture), isNum(c.alberghi?.totale_letti) && F.n(c.alberghi.totale_letti) + ' letti'),
      tile('Extra-alberghiero', F.n(c.extra_alberghiero?.totale_strutture), isNum(c.extra_alberghiero?.totale_letti) && F.n(c.extra_alberghiero.totale_letti) + ' letti'),
      tile('Indice di turisticità', F.d1(c.indice_turisticita_per_100ab), 'letti ogni 100 abitanti')),
    grid(
      has(tipi) && card('Posti letto per tipologia', x.fonte, barChart(tipi.map(t => t[0]), tipi.map(t => t[2]), { horizontal: true, label: 'Posti letto' })),
      has(tipi) && card('Strutture per tipologia', x.fonte, barChart(tipi.map(t => t[0]), tipi.map(t => t[1]), { horizontal: true, colors: PAL[1], label: 'Strutture' })),
      has(fl) && card(`Flussi turistici – provincia di ${fl.provincia_nome || ''} (${fl.anno})`, x.fonte, kv([
        ['Arrivi', F.n(fl.arrivi_totali)], ['di cui stranieri', F.n(fl.arrivi_stranieri)], ['Presenze', F.n(fl.presenze_totali)],
        ['di cui straniere', F.n(fl.presenze_straniere)], ['Permanenza media', F.d1(fl.permanenza_media) + ' notti'], ['Quota stranieri', F.pct(fl.stranieri_pct)]]),
        note('Dato a livello provinciale: ISTAT non pubblica i flussi per singolo comune.')))];
  });

  section(p, 'Pendolarismo per lavoro', d.pendolarismo, x => {
    const k = x.kpi || {};
    const b = (list, color) => barChart(list.map(r => nomeComune(r.istat)), list.map(r => r.count), { horizontal: true, colors: color, label: 'Pendolari' });
    return [tiles(
      tile('In uscita', F.n(k.uscenti_totali), 'verso ' + F.n(k.n_destinazioni) + ' comuni'), tile('In entrata', F.n(k.entranti_totali), 'da ' + F.n(k.n_origini) + ' comuni'),
      tile('Saldo netto', F.n(k.saldo_netto)), tile('Autocontenimento', F.pct(k.auto_contenimento_pct), 'lavora nel comune di residenza')),
    grid(
      has(k.top_destinazioni) && card('Principali destinazioni', x._source, b(k.top_destinazioni, PAL[0])),
      has(k.top_origini) && card('Principali origini', x._source, b(k.top_origini, PAL[1])))];
  });

  section(p, 'Quotazioni immobiliari OMI', d.omi, x => {
    const k = x.kpi || {};
    const rows = (x.zone || []).map(z => {
      const res = z.destinazioni?.Residenziale || [];
      const a = res.find(t => /civili/i.test(t.tipologia) && t.stato === 'NORMALE') || res.find(t => /abitazioni|ville/i.test(t.tipologia)) || {};
      return { zona: z.zona, fascia: z.fascia, dizione: z.dizione, tip: a.tipologia, cvmin: a.cv_min, cvmax: a.cv_max, locmin: a.loc_min, locmax: a.loc_max,
        n: Object.values(z.destinazioni || {}).reduce((s, l) => s + l.length, 0) };
    });
    return [tiles(
      tile('Zone OMI', F.n(k.n_zone), 'semestre ' + (x._data_period || '')), tile('Residenziale medio', isNum(k.residenziale_medio) ? F.n(k.residenziale_medio) + ' €/mq' : '—'),
      tile('Minimo – massimo', isNum(k.residenziale_min) ? `${F.n(k.residenziale_min)} – ${F.n(k.residenziale_max)} €/mq` : '—'),
      tile('Zona più cara', k.zona_piu_cara?.zona || '—', k.zona_piu_cara?.dizione), tile('Zona più economica', k.zona_piu_economica?.zona || '—', k.zona_piu_economica?.dizione)),
    h('div', { class: 'card' }, h('h3', null, 'Zone omogenee'), h('div', { class: 'src' }, 'Fonte: ' + (x._attribution || x._source)),
      dataTable([
        { t: 'Zona', k: 'zona' }, { t: 'Fascia', k: 'fascia' }, { t: 'Descrizione', k: 'dizione' }, { t: 'Tipologia di riferimento', k: 'tip' },
        { t: 'Compravendita min €/mq', k: 'cvmin', num: true, fmt: F.n }, { t: 'Compravendita max €/mq', k: 'cvmax', num: true, fmt: F.n },
        { t: 'Locazione min €/mq mese', k: 'locmin', num: true, fmt: F.d1 }, { t: 'Locazione max €/mq mese', k: 'locmax', num: true, fmt: F.d1 },
        { t: 'Quotazioni', k: 'n', num: true }], rows, { size: 15 }),
      k.sup_mista && note('In questo comune convivono quotazioni riferite a superficie lorda e netta: i valori al mq non sono confrontabili fra zone.'),
      h('div', { class: 'src' }, 'Valori di larga massima, non sostituiscono la stima di un tecnico. I perimetri delle zone sono nella scheda «Mappa».'))];
  });
}

// ================= Finanza pubblica =================

function tabFinanza(p, d) {
  section(p, 'Cassa (SIOPE)', d.siope, x => {
    const anni = x.anni_disponibili || Object.keys(x.per_anno || {});
    const box = h('div');
    const sel = h('select', { onchange: () => draw(sel.value) }, anni.map(a => h('option', { value: a, selected: a == x.anno_default }, a)));
    const cumul = (voci, mesi) => mesi.map(m => voci.reduce((s, v) => {
      let last = 0;
      for (const mm of mesi) { if (mm > m) break; if (isNum(v.mensili?.[mm])) last = v.mensili[mm]; }
      return s + last;
    }, 0));
    function draw(a) {
      const y = x.per_anno[a] || {};
      const mesi = [...(y.mesi_disponibili || [])].sort();
      const usc = y.voci || [], ent = y.entrate?.voci || [];
      const perTitolo = {};
      usc.forEach(v => { perTitolo[v.desc_titolo] = (perTitolo[v.desc_titolo] || 0) + (v.importo_cumulato || 0); });
      const top = l => [...l].sort((m, n) => n.importo_cumulato - m.importo_cumulato).slice(0, 12);
      const vt = (l, color) => barChart(top(l).map(v => v.desc_gestionale), top(l).map(v => v.importo_cumulato), { horizontal: true, tall: true, colors: color, cut: 48, label: 'Importo (€)' });
      box.replaceChildren(tiles(
        tile('Pagamenti', F.eurc(y.totale_anno), `${mesi.length} mesi${y.parziale ? ' (anno parziale)' : ''}`), tile('Incassi', F.eurc(y.entrate?.totale_anno)),
        tile('Saldo di cassa', F.eurc(y.saldo_cassa), 'incassi − pagamenti'), tile('Voci di spesa', F.n(y.n_voci)), tile('Ente SIOPE', cut(y.ente_siope || '—', 30))),
      grid(
        has(mesi) && card('Andamento cumulato nell\'anno', x._source && 'MEF-RGS, SIOPE', lineChart(mesi.map(m => m.slice(5)), [
          { label: 'Pagamenti', data: cumul(usc, mesi), borderColor: PAL[3] }, { label: 'Incassi', data: cumul(ent, mesi), borderColor: PAL[1] }], { zero: true })),
        has(perTitolo) && card('Pagamenti per titolo', 'MEF-RGS, SIOPE', objPie(perTitolo, { raw: true })),
        has(usc) && card('Principali voci di pagamento', 'MEF-RGS, SIOPE', vt(usc, PAL[3])),
        has(ent) && card('Principali voci di incasso', 'MEF-RGS, SIOPE', vt(ent, PAL[1]))),
      h('div', { class: 'card' }, h('h3', null, 'Tutte le voci di pagamento'), dataTable([
        { t: 'Codice', k: 'codice_gestionale' }, { t: 'Voce', k: 'desc_gestionale' }, { t: 'Titolo', k: 'desc_titolo' },
        { t: 'Importo €', k: 'importo_cumulato', num: true, fmt: F.n }], usc, { sort: 3, dir: -1, size: 15 }),
        note('Movimenti di cassa, non di competenza: il saldo di cassa non è un avanzo di bilancio.')));
    }
    draw(sel.value);
    return [h('div', { class: 'filters' }, h('label', null, 'Anno', sel)), box];
  });

  section(p, 'Contratti pubblici (ANAC)', d.anac, x => {
    const cpv = [...(x.cpv || x.top_cpv || [])].sort((a, b) => b.importo - a.importo);
    return [tiles(
      tile('Aggiudicazioni', F.n(x.count), `${F.date(x.finestra_da)} – ${F.date(x.finestra_a)}`), tile('Importo totale', F.eurc(x.importo_totale)),
      tile('Categorie CPV', F.n(x.distinct_cpv)), tile('Ultima aggiudicazione', F.date(x.last_award_date)),
      tile('Anomalie segnalate', F.n(x.count_anomalie), isNum(x.importo_anomalie) && x.importo_anomalie > 0 ? F.eurc(x.importo_anomalie) : null)),
    grid(has(cpv) && wide(card('Principali categorie merceologiche (CPV) per importo', 'ANAC – BDNCP',
      barChart(cpv.slice(0, 12).map(c => c.desc), cpv.slice(0, 12).map(c => c.importo), { horizontal: true, tall: true, cut: 60, label: 'Importo (€)' })))),
    has(cpv) && h('div', { class: 'card' }, h('h3', null, 'Tutte le categorie CPV'), dataTable([
      { t: 'CPV', k: 'code' }, { t: 'Descrizione', k: 'desc' }, { t: 'Aggiudicazioni', k: 'count', num: true }, { t: 'Importo €', k: 'importo', num: true, fmt: F.n }],
      cpv, { sort: 3, dir: -1, size: 15 }))];
  });

  section(p, 'Opere pubbliche (BDAP-MOP)', has(d.bdap_kpi) ? d.bdap_kpi : d.opere, () => {
    const k = d.bdap_kpi || {}, t = k.totale || {}, o = d.opere || {};
    const fin = { Statali: t.finanz_statali, Europei: t.finanz_europei, 'Enti territoriali': t.finanz_enti_terr, Privati: t.finanz_privati, Altri: t.finanz_altri };
    const st = Object.entries(k.per_stato || {});
    return [tiles(
      tile('Progetti', F.n(t.count)), tile('Finanziamenti totali', F.eurc(sum(Object.values(fin)))), tile('Costo lavori effettivo', F.eurc(t.costo_lavori_eff)),
      st.map(([s, v]) => tile('Progetti ' + s.toLowerCase(), F.n(v.count)))),
    grid(
      sum(Object.values(fin)) > 0 && card('Finanziamenti per fonte', 'BDAP – MEF RGS', objPie(fin, { raw: true })),
      has(k.top_settori) && card('Progetti per settore', 'BDAP – MEF RGS', barChart(k.top_settori.map(s => s.settore), k.top_settori.map(s => s.count), { horizontal: true, label: 'Progetti' }))),
    has(o.progetti) && h('div', { class: 'card' }, h('h3', null, `Dettaglio delle opere (${F.n(o.n_progetti)})`), h('div', { class: 'src' }, 'Fonte: ' + (o._source || 'BDAP')),
      dataTable([
        { t: 'CUP', k: 'cup' }, { t: 'Descrizione', k: 'descrizione', fmt: v => cut(v, 110) }, { t: 'Stato', k: 'stato' }, { t: 'Settore', k: 'settore' },
        { t: 'Inizio', k: 'data_inizio', fmt: F.date }, { t: 'Costo effettivo €', k: 'costo_eff', num: true, fmt: F.n },
        { t: 'Finanz. statali €', k: 'fin_statali', num: true, fmt: F.n }, { t: 'Finanz. europei €', k: 'fin_europei', num: true, fmt: F.n }],
        o.progetti, { sort: 5, dir: -1, size: 12 }))];
  });

  section(p, 'PNRR', d.pnrr, x => {
    const k = x.kpi || {}, m = x.per_missione || [];
    return [tiles(
      tile('Progetti', F.n(k.n_progetti)), tile('Finanziamento PNRR', F.eurc(k.totale_finanziamento_pnrr)), tile('Finanziamento complessivo', F.eurc(k.totale_finanziamento_globale)),
      tile('In corso', F.n(k.n_in_corso)), tile('Conclusi', F.n(k.n_concluso))),
    grid(
      has(m) && card('Finanziamento PNRR per missione', x.fonte, barChart(m.map(r => `${r.missione} – ${r.descrizione}`), m.map(r => r.tot_pnrr), { horizontal: true, cut: 50, label: 'Finanziamento (€)' })),
      has(m) && card('Progetti per missione', x.fonte, pieChart(m.map(r => `${r.missione} – ${cut(r.descrizione, 30)}`), m.map(r => r.n_progetti)))),
    has(x.progetti) && h('div', { class: 'card' }, h('h3', null, 'Progetti'), h('div', { class: 'src' }, `Fonte: ${x.fonte} · estrazione del ${F.date(x.data_estrazione)}`),
      dataTable([
        { t: 'CUP', k: 'cup' }, { t: 'Titolo', k: 'titolo', fmt: v => cut(v, 100) }, { t: 'Missione', k: 'componente' }, { t: 'Soggetto attuatore', k: 'soggetto_attuatore', fmt: v => cut(v, 40) },
        { t: 'Stato', k: 'stato_avanzamento' }, { t: 'Fase', k: 'fase_iter', fmt: v => cut(v, 30) }, { t: 'Fine prevista', k: 'data_fine_prevista', fmt: F.date },
        { t: 'PNRR €', k: 'finanziamento_pnrr', num: true, fmt: F.n }], x.progetti, { sort: 7, dir: -1, size: 12 }))];
  });
}

// ================= Territorio e ambiente =================

function tabTerritorio(p, d) {
  section(p, 'Suolo, rifiuti e rischi naturali', d.territorio, x => {
    const k = x.kpi || {}, su = x.suolo || {}, ri = x.rifiuti || {}, rk = x.rischio_idrogeologico || {}, fr = rk.frane || {}, al = rk.alluvioni || {};
    const rs = ri.serie_storica || [];
    return [tiles(
      tile('Superficie', F.d1(k.ar_kmq) + ' km²'), tile('Suolo consumato', F.pct(k.suolo_consumato_pct), k.suolo_consumato_anno),
      tile('Incremento ultimo anno', F.d2(k.incremento_ultimo_ha) + ' ha'), tile('Zona sismica', x.classificazione_sismica?.zona_sismica ?? '—', '1 = pericolosità più alta'),
      tile('Raccolta differenziata', F.pct(k.rd_pct_ultimo_anno), k.rd_ultimo_anno), tile('Rifiuti urbani', F.n(k.kg_per_abitante_ultimo_anno) + ' kg/ab'),
      tile('Popolazione in aree a rischio frana', F.pct(k.popolazione_frane_p3p4_pct), 'pericolosità P3-P4')),
    grid(
      has(su.serie_storica) && card('Consumo di suolo netto (ettari)', 'ISPRA – SNPA', barChart(su.serie_storica.map(r => r.intervallo), su.serie_storica.map(r => r.netto_ha), { label: 'Consumo netto (ha)', colors: PAL[2] })),
      has(rs) && card('Rifiuti urbani', 'ISPRA – Catasto Rifiuti', lineChart(rs.map(r => r.anno), [
        { label: 'Raccolta differenziata (%)', data: rs.map(r => r.rd_pct), borderColor: PAL[1] }, { label: 'Kg per abitante', data: rs.map(r => r.kg_ab), borderColor: PAL[4], yAxisID: 'y2' }], { zero: true })),
      has(fr) && card('Popolazione in aree a pericolosità da frana', 'ISPRA – IdroGEO', barChart(['P4 molto elevata', 'P3 elevata', 'P2 media'], [fr.pop_p4, fr.pop_p3, fr.pop_p2], { label: 'Residenti', colors: PAL[3] }),
        kv([['Superficie P3+P4', F.d2(fr.ar_p3p4_kmq) + ' km² (' + F.pct(fr.ar_p3p4_pct) + ')'], ['Famiglie P3+P4', F.n(fr.fam_p3p4)], ['Edifici P3+P4', F.n(fr.ed_p3p4)], ['Beni culturali P3+P4', F.n(fr.bbcc_p3p4)]])),
      has(al) && card('Popolazione in aree a pericolosità idraulica', 'ISPRA – IdroGEO', barChart(['P3 elevata', 'P2 media', 'P1 bassa'], [al.pop_p3, al.pop_p2, al.pop_p1], { label: 'Residenti' }),
        kv([['Superficie P3', F.d2(al.ar_p3_kmq) + ' km² (' + F.pct(al.ar_p3_pct) + ')'], ['Famiglie P2', F.n(al.fam_p2)], ['Edifici P2', F.n(al.ed_p2)], ['Beni culturali P2', F.n(al.bbcc_p2)]])))];
  });

  section(p, 'Qualità dell\'aria', d.aria, x => {
    const u = x.ultimo_anno || {}, t = x.trend_decennale || {};
    if (!x.n_stazioni) return h('div', { class: 'card empty' }, 'Nessuna stazione di monitoraggio nel territorio comunale.');
    return [tiles(
      tile('Stazioni', F.n(x.n_stazioni)), tile('PM10', F.d1(u.pm10?.media) + ' µg/m³', 'media ' + (u.anno || '')),
      tile('PM2,5', F.d1(u.pm25?.media) + ' µg/m³'), tile('NO₂', F.d1(u.no2?.media) + ' µg/m³'),
      tile('Giorni PM10 > 50', F.n(u.pm10?.n_sup50_giorni_max), 'stazione peggiore')),
    grid(
      has(t.anni) && card('Medie annue (µg/m³)', 'ISPRA – SNPA', lineChart(t.anni, [
        { label: 'PM10', data: t.pm10_media }, { label: 'PM2,5', data: t.pm25_media }, { label: 'NO₂', data: t.no2_media }])),
      has(x.stazioni) && card('Stazioni di monitoraggio', 'ISPRA – SNPA', dataTable([
        { t: 'Codice', k: 'station_eu_code' }, { t: 'Nome', k: 'nome' }, { t: 'Zona', k: 'tipo_zona' }, { t: 'Tipo', k: 'tipo_stazione' }], x.stazioni)))];
  });

  section(p, 'Morfologia', d.morfologia, x => [tiles(
    tile('Quota media', F.n(x.elev_mean) + ' m'), tile('Quota min – max', `${F.n(x.elev_min)} – ${F.n(x.elev_max)} m`), tile('Pendenza media', F.d1(x.slope_mean) + '°'),
    tile('Superficie con pendenza > 15°', F.pct(x.slope_gt15_pct)), tile('Esposizione prevalente', x.aspect_dom || '—', F.pct(x.aspect_dom_pct)),
    tile('Irraggiamento solare medio', F.n(x.solar_mean), 'kWh/m² anno')),
  grid(
    has(x.aspect_dist) && card('Esposizione dei versanti (%)', 'CNR-IRPI', mkChart({
      type: 'radar', data: { labels: Object.keys(x.aspect_dist), datasets: [{ label: '% superficie', data: Object.values(x.aspect_dist), borderColor: PAL[0], backgroundColor: 'rgba(0,102,204,.2)' }] },
      options: { plugins: { legend: { display: false } }, scales: { r: { beginAtZero: true } } } })),
    has(x.geomorph) && card('Forme del rilievo (%)', 'CNR-IRPI', objBar(x.geomorph, { raw: true, sort: true, horizontal: true, colors: PAL[2] })))]);
}

// ================= Servizi =================

function tabServizi(p, d) {
  section(p, 'Scuole', d.scuole, x => {
    const k = x.kpi || {}, o = k.per_ordine || {};
    return [tiles(tile('Plessi scolastici', F.n(k.n_scuole), 'a.s. ' + (x.anno_scolastico || '')), tile('Sedi di dirigenza', F.n(k.n_sedi_direttivo))),
    grid(
      has(o) && card('Plessi per ordine', 'MIUR', barChart(['Infanzia', 'Primaria', 'Secondaria I grado', 'Secondaria II grado', 'Altro'], [o.infanzia, o.primaria, o.sec1, o.sec2, o.altro])),
      has(x.scuole) && card('Elenco', 'MIUR – Anagrafe scuole statali', dataTable([
        { t: 'Codice', k: 'codice_scuola' }, { t: 'Denominazione', k: 'denominazione' }, { t: 'Tipologia', k: 'tipologia' }, { t: 'Indirizzo', k: 'indirizzo' }], x.scuole, { size: 8 })))];
  });

  section(p, 'Sanità', d.sanita_mds, x => {
    const f = x.farmacie || {}, pf = x.parafarmacie || {}, o = x.ospedali || {}, ok = o.kpi || {};
    const disc = Object.entries(ok.mix_discipline || {}).filter(([, v]) => isNum(v)).sort((a, b) => b[1] - a[1]).slice(0, 12);
    return [tiles(
      tile('Farmacie', F.n(f.kpi?.n_totale)), tile('Parafarmacie', F.n(pf.kpi?.n_totale)), tile('Stabilimenti ospedalieri', F.n(ok.n_stabilimenti)),
      tile('Posti letto', F.n(ok.posti_letto_totali), isNum(ok.posti_letto_day_hospital) && F.n(ok.posti_letto_day_hospital) + ' in day hospital')),
    grid(
      has(o.stabilimenti) && card('Ospedali', 'Ministero della Salute', dataTable([
        { t: 'Struttura', k: 'denominazione' }, { t: 'Tipo', k: 'tipo_struttura' }, { t: 'Indirizzo', k: 'indirizzo' },
        { t: 'Discipline', get: r => (r.discipline || []).length, num: true }, { t: 'Posti letto', k: 'totale_posti_letto', num: true }], o.stabilimenti)),
      has(disc) && card('Posti letto per disciplina', 'Ministero della Salute', barChart(disc.map(e => e[0]), disc.map(e => e[1]), { horizontal: true, label: 'Posti letto' })),
      has(f.punti) && card('Farmacie', 'Ministero della Salute', dataTable([{ t: 'Nome', k: 'nome' }, { t: 'Tipo', k: 'tipo' }, { t: 'Indirizzo', k: 'indirizzo' }, { t: 'CAP', k: 'cap' }], f.punti, { size: 8 })),
      has(pf.punti) && card('Parafarmacie', 'Ministero della Salute', dataTable([{ t: 'Nome', k: 'nome' }, { t: 'Indirizzo', k: 'indirizzo' }, { t: 'CAP', k: 'cap' }], pf.punti, { size: 8 })))];
  });

  section(p, 'Banda ultralarga', d.agcom_bbmap, x => {
    const k = x.kpi || {};
    return [tiles(
      tile('Copertura FTTH', F.pct(k.copertura_ftth_desi_pct), 'rilevazione ' + (x._data_period || '')), tile('FTTH entro 20 m', F.pct(k.copertura_ftth_20m_pct)),
      tile('Famiglie residenti', F.n(k.famiglie_residenti)), tile('Famiglie raggiunte da FTTH', F.n(k.famiglie_ftth)), tile('Indice di confidenza', F.pct(k.confidenza_desi_pct))),
    grid(card('Celle 20×20 m raggiunte', 'AGCOM – Broadband Map', barChart(['Raggiunte da rete fissa', 'FTTH', 'FTTC'], [k.celle_20m_raggiunte, k.celle_20m_ftth, k.celle_20m_fttc])),
      card('Indirizzi e punti', 'AGCOM – Broadband Map', kv([
        ['Indirizzi postali distinti', F.n(k.indirizzi_postali_distinti)], ['di cui raggiunti da FTTH', F.n(k.indirizzi_postali_distinti_ftth)],
        ['Punti geografici distinti', F.n(k.punti_geo_distinti)], ['di cui raggiunti da FTTH', F.n(k.punti_geo_distinti_ftth)], ['Punti dichiarati dagli operatori', F.n(k.punti_dichiarati)]])))];
  });

  section(p, 'Veicoli e incidenti', d.veicoli, x => {
    const pv = x.parco_veicoli || {}, inc = x.incidenti || {}, isc = x.iscrizioni || {}, e = pv.euro || {}, iu = isc.ultimo_anno || {};
    const cat = ['autovetture', 'motocicli', 'autocarri', 'autobus', 'motocarri', 'motrici', 'rimorchi', 'altri'];
    const is = inc.serie_storica || {}, ss = isc.serie_storica || {};
    return [tiles(
      tile('Veicoli', F.n(pv.totale), pv.anno), tile('Autovetture', F.n(pv.autovetture)), tile('Tasso di motorizzazione', F.n(pv.tasso_motorizzazione_per_1000_ab), 'veicoli ogni 1.000 abitanti'),
      tile('Veicoli più inquinanti', F.pct(e.pct_inquinanti), 'Euro 0-3'), tile('Incidenti', F.n(inc.ultimo_anno?.incidenti), inc.ultimo_anno && `${F.n(inc.ultimo_anno.morti)} morti · ${F.n(inc.ultimo_anno.feriti)} feriti (${inc.ultimo_anno.anno})`),
      tile('Nuove iscrizioni', F.n(iu.totale), isNum(iu.pct_elettriche_ibride) && F.pct(iu.pct_elettriche_ibride) + ' elettriche o ibride')),
    grid(
      card('Parco veicoli per categoria', 'ACI / ISTAT', barChart(cat.map(label), cat.map(c => pv[c]))),
      has(e) && card('Autovetture per classe Euro', 'ACI / ISTAT', barChart([0, 1, 2, 3, 4, 5, 6].map(n => 'Euro ' + n), [0, 1, 2, 3, 4, 5, 6].map(n => e['euro_' + n]), { colors: PAL[4] })),
      has(is.anni) && card('Incidenti stradali', 'ACI / ISTAT', lineChart(is.anni, [
        { label: 'Incidenti', data: is.incidenti }, { label: 'Feriti', data: is.feriti, borderColor: PAL[2] }, { label: 'Morti', data: is.morti, borderColor: PAL[3], yAxisID: 'y2' }], { zero: true })),
      has(ss.anni) && card('Nuove iscrizioni', 'ACI', lineChart(ss.anni, [
        { label: 'Totale', data: ss.totale }, { label: 'Ibride', data: ss.ibride, borderColor: PAL[1] }, { label: 'Elettriche', data: ss.elettriche, borderColor: PAL[5] }], { zero: true })))];
  });

  section(p, 'Ricarica dei veicoli elettrici', d.pun, x => {
    const k = x.kpi || {};
    return [tiles(
      tile('Punti di ricarica', F.n(k.n_totale)), tile('Attivi', F.n(k.n_attivi), F.pct(k.pct_attivi)), tile('Potenza totale', F.n(k.potenza_tot_kw) + ' kW'),
      tile('Ricarica rapida', F.n(k.n_ricarica_rapida)), tile('Corrente continua (DC)', F.n(k.n_dc)), tile('Operatori', F.n((k.cpo_list || []).length))),
    grid(
      has(k.mix_potenza) && card('Punti per classe di potenza', 'GSE – Piattaforma Unica Nazionale', objPie(k.mix_potenza, { raw: true })),
      has(k.mix_connettori) && card('Punti per tipo di connettore', 'GSE – Piattaforma Unica Nazionale', objBar(k.mix_connettori, { raw: true, sort: true, horizontal: true })))];
  });

  section(p, 'Carburanti', d.carburanti, x => {
    const k = x.kpi || {}, pm = k.prezzo_medio || {};
    return [tiles(
      tile('Impianti', F.n(k.n_impianti), isNum(k.n_autostradali) && k.n_autostradali > 0 ? F.n(k.n_autostradali) + ' autostradali' : null),
      tile('Pompe bianche', F.n(k.n_pompe_bianche), F.pct(k.pct_pompe_bianche)), tile('Benzina self', F.price(pm.benzina_self), isNum(k.prezzo_min?.benzina_self) && 'minimo ' + F.price(k.prezzo_min.benzina_self)),
      tile('Gasolio self', F.price(pm.gasolio_self), isNum(k.prezzo_min?.gasolio_self) && 'minimo ' + F.price(k.prezzo_min.gasolio_self)), tile('GPL', F.price(pm.gpl)),
      tile('Prezzi aggiornati', F.pct(k.freshness_pct), 'negli ultimi 7 giorni')),
    grid(
      has(pm) && card('Prezzi medi (€/litro)', 'MIMIT', objBar(pm)),
      has(k.mix_bandiere) && card('Impianti per bandiera', 'MIMIT', objPie(k.mix_bandiere, { raw: true }))),
    has(x.punti) && h('div', { class: 'card' }, h('h3', null, 'Impianti'), h('div', { class: 'src' }, `Fonte: MIMIT · dati del ${F.date(x._data_last_modified)}`), dataTable([
      { t: 'Impianto', k: 'name' }, { t: 'Bandiera', k: 'brand' }, { t: 'Indirizzo', k: 'indirizzo', fmt: v => cut(v, 60) },
      { t: 'Benzina self', get: r => r.prezzi?.benzina_self, num: true, fmt: v => isNum(v) ? nf3.format(v) : '—' },
      { t: 'Gasolio self', get: r => r.prezzi?.gasolio_self, num: true, fmt: v => isNum(v) ? nf3.format(v) : '—' },
      { t: 'GPL', get: r => r.prezzi?.gpl, num: true, fmt: v => isNum(v) ? nf3.format(v) : '—' },
      { t: 'Metano', get: r => r.prezzi?.metano, num: true, fmt: v => isNum(v) ? nf3.format(v) : '—' },
      { t: 'Aggiornato', k: 'ultimo_aggiornamento', fmt: F.date }], x.punti, { size: 10 }))];
  });

  section(p, 'Terzo settore', d.runts, x => {
    const k = x.kpi || {};
    return [tiles(tile('Enti iscritti al RUNTS', F.n(k.n_totale)), tile('Iscritti al 5×1000', F.n(k.n_5x1000), F.pct(k.pct_5x1000)), tile('In rete associativa', F.n(k.n_rete_associativa))),
    grid(
      has(k.mix_sezione) && card('Enti per sezione', 'RUNTS – Ministero del Lavoro', objPie(k.mix_sezione, { raw: true })),
      has(k.iscrizioni_per_anno) && card('Iscrizioni per anno', 'RUNTS – Ministero del Lavoro', objBar(k.iscrizioni_per_anno, { raw: true, colors: PAL[1] }))),
    has(x.enti) && h('div', { class: 'card' }, h('h3', null, 'Enti'), dataTable([
      { t: 'Denominazione', k: 'denom' }, { t: 'Sezione', k: 'sez' }, { t: 'Codice fiscale', k: 'cf' }, { t: 'Legale rappresentante', k: 'rapp' },
      { t: '5×1000', k: 'x1000' }, { t: 'Iscrizione', k: 'data_iscr', fmt: F.date }], x.enti, { size: 10 }))];
  });

  section(p, 'Beni culturali', d.beni_culturali, x => {
    const k = x.kpi || {};
    const tbl = h('div', null, luoghiTable(x.luoghi || []));
    const more = x._luoghi_truncated && h('button', { class: 'btn ghost small', onclick: async e => {
      e.target.disabled = true;
      try { const full = await getJson(`${DATA}/beni_culturali_full/${d.anagrafica.istat_code}.json`); tbl.replaceChildren(luoghiTable(full.luoghi || [])); e.target.remove(); }
      catch (err) { toast(err.message, { error: true }); e.target.disabled = false; }
    } }, `Carica l'elenco completo (${F.n(x._luoghi_total)})`);
    return [tiles(tile('Beni immobili tutelati', F.n(k.n_totale)), tile('Luoghi visitabili', F.n(k.n_visitabili)), tile('Con fotografia', F.pct(k.pct_con_foto)), tile('Georeferenziati', F.n(k.n_con_coordinate))),
    grid(has(k.mix_categoria) && card('Beni per categoria', 'Ministero della Cultura', objBar(k.mix_categoria, { sort: true, horizontal: true, colors: PAL[5] })),
      card('Elenco', 'MiC – ArCo e Cultural-ON', tbl, more))];
  });

  section(p, 'Patrimonio immobiliare pubblico', d.immobili_pa, x => {
    const k = x.kpi || {};
    return [tiles(tile('Immobili', F.n(k.n_totale), 'rilevazione ' + (x.anno_rilevazione || '')), tile('Fabbricati', F.n(k.n_fabbricati)), tile('Terreni', F.n(k.n_terreni)),
      tile('Superficie totale', F.n(k.superficie_totale_mq) + ' m²'), tile('Con vincolo culturale', F.pct(k.pct_vincolo_culturale)), tile('In uso a terzi', F.pct(k.pct_uso_terzi))),
    grid(has(k.mix_categoria) && wide(card('Immobili per categoria', 'MEF – Censimento immobili pubblici', objBar(k.mix_categoria, { sort: true, horizontal: true, tall: true }))))];
  });

  section(p, 'Strade e numeri civici', d.anncsu, x => {
    const k = x.kpi || {};
    return [tiles(tile('Strade', F.n(k.n_strade)), tile('Numeri civici', F.n(k.n_civici)), tile('Georeferenziati', F.pct(k.pct_geo_ref)), tile('Aggiornamento', F.date(x._snapshot_date))),
    grid(has(k.top_10_strade) && wide(card('Strade con più numeri civici', 'ANNCSU – Agenzia delle Entrate e ISTAT',
      barChart(k.top_10_strade.map(s => s.odo), k.top_10_strade.map(s => s.acc), { horizontal: true, label: 'Civici' }))))];
  });
}

function luoghiTable(list) {
  return dataTable([
    { t: 'Denominazione', k: 'denom', cell: (r, v) => r.cis_link ? h('a', { href: r.cis_link, target: '_blank' }, cut(v, 70)) : cut(v, 70) },
    { t: 'Categoria', k: 'categoria', fmt: label }, { t: 'Indirizzo', k: 'indirizzo', fmt: v => cut(String(v || '').replace(/^ITALIA, /, ''), 60) }], list, { size: 8 });
}

// ================= Mappa =================

function tabMappa(p, d) {
  const istat = d.anagrafica?.istat_code;
  const info = h('span', { class: 'info' }, 'Attiva o disattiva i livelli dal pulsante in alto a destra sulla mappa.');
  const btnCens = h('button', { class: 'btn ghost small' }, 'Carica sezioni di censimento');
  const btnOmi = h('button', { class: 'btn ghost small' }, 'Carica zone OMI');
  const mapEl = h('div', { class: 'map' });
  p.append(h('div', { class: 'map-tools' }, btnCens, btnOmi, info), mapEl);

  const map = S.map = L.map(mapEl, { preferCanvas: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>'
  }).addTo(map);

  const ext = d.territorio?.geo?.extent, bb = d.anncsu?.kpi?.bbox;
  if (ext) map.fitBounds([[ext[0][1], ext[0][0]], [ext[1][1], ext[1][0]]]);
  else if (bb) map.fitBounds([[bb.lat_min, bb.lon_min], [bb.lat_max, bb.lon_max]]);
  else map.setView([42, 12.5], 6);

  const control = L.control.layers(null, null, { collapsed: false }).addTo(map);
  const popup = (title, rows) => h('div', { class: 'pop' }, h('b', null, title), rows.filter(r => r && r[1] != null && r[1] !== '' && r[1] !== '—').map(r => h('div', null, r[0] ? r[0] + ': ' : '', r[1])));

  function layer(name, points, color, pop, on, radius = 6) {
    const pts = (points || []).filter(q => isNum(q.lat) && isNum(q.lon));
    if (!pts.length) return;
    const g = L.layerGroup(pts.map(q => L.circleMarker([q.lat, q.lon], { radius, color: '#fff', weight: 1, fillColor: color, fillOpacity: .9 }).bindPopup(() => {
      const el = pop(q);
      el.append(linkIndicazioni({ lat: q.lat, lon: q.lon, label: el.querySelector('b')?.textContent || name }));
      return el;
    })));
    const lab = h('span', null, h('i', { style: `display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};margin-right:5px` }), `${name} (${nf0.format(pts.length)})`);
    control.addOverlay(g, lab.outerHTML);
    if (on) g.addTo(map);
  }
  const s = d.sanita_mds || {};
  layer('Farmacie', s.farmacie?.punti, '#008055', q => popup(q.nome, [['', q.indirizzo], ['Tipo', q.tipo]]), true);
  layer('Parafarmacie', s.parafarmacie?.punti, '#00A3A3', q => popup(q.nome, [['', q.indirizzo]]), false);
  layer('Distributori di carburante', d.carburanti?.punti, '#A66300', q => popup(q.name, [['Bandiera', q.brand], ['', q.indirizzo],
    ['Benzina self', isNum(q.prezzi?.benzina_self) ? F.price(q.prezzi.benzina_self) : null], ['Gasolio self', isNum(q.prezzi?.gasolio_self) ? F.price(q.prezzi.gasolio_self) : null]]), true);
  layer('Punti di ricarica elettrica', d.pun?.punti, '#7B4FBF', q => popup(q.indirizzo || q.id_evse, [['Stato', q.stato], ['Operatore', q.cpo],
    ['Potenza', isNum(q.potenza_w) ? F.d1(q.potenza_w / 1000) + ' kW ' + (q.corrente || '') : null], ['Classe', q.potenza_categoria]]), true);
  layer('Beni culturali', d.beni_culturali?.luoghi, '#CC334D', q => popup(q.denom, [['Categoria', label(q.categoria || '')], ['', q.indirizzo]]), true);
  layer('Stazioni qualità dell\'aria', d.aria?.stazioni, '#17324d', q => popup(q.nome, [['Zona', q.tipo_zona], ['Tipo', q.tipo_stazione]]), true, 8);
  layer('Immobili pubblici', d.immobili_pa?.punti, '#5C6F82', q => popup(q.tipo || 'Immobile pubblico', [['Categoria', label(q.cat || '')], ['Superficie', isNum(q.sup) ? F.n(q.sup) + ' m²' : null],
    ['Vincolo', q.vincolo ? 'Sì' : null]]), false, 5);
  layer('Numeri civici (campione)', d.anncsu?.punti, '#0066CC', q => popup(`${q.odo} ${q.civ}${q.esp ? '/' + q.esp : ''}`, []), false, 3);

  // Sezioni di censimento: densità abitativa.
  btnCens.onclick = async () => {
    btnCens.disabled = true; info.textContent = 'Scaricamento delle sezioni di censimento…';
    try {
      const gj = await getJson(`${DATA}/censimento_full/${istat}.geojson`);
      const dens = f => { const v = f.properties.vars, a = f.properties.area_mq; return v && isNum(v.P1) && a > 0 ? v.P1 / (a / 1e6) : null; };
      const vals = gj.features.map(dens).filter(v => v > 0).sort((a, b) => a - b);
      const brk = [.2, .4, .6, .8].map(q => vals[Math.floor(vals.length * q)] || 0);
      const cols = ['#E6F1FB', '#A9CDEE', '#5C9FDB', '#1F78C8', '#004C99'];
      const col = v => v == null ? '#F0F0F0' : cols[brk.filter(b => v > b).length];
      const lyr = L.geoJSON(gj, {
        style: f => ({ color: '#fff', weight: .5, fillColor: col(dens(f)), fillOpacity: .65 }),
        onEachFeature: (f, l) => l.bindPopup(() => {
          const v = f.properties.vars || {};
          return popup('Sezione ' + f.properties.sez, [['Popolazione', F.n(v.P1)], ['Famiglie', F.n(v.PF1)], ['Abitazioni', F.n(v.A8)], ['Stranieri', F.n(v.ST1)],
            ['Densità', isNum(dens(f)) ? F.n(dens(f)) + ' ab/km²' : 'area non residenziale'], ['Tipo località', label(f.properties.tipo_loc || '')]]);
        })
      }).addTo(map);
      lyr.bringToBack();
      control.addOverlay(lyr, 'Sezioni di censimento (densità)');
      const legend = L.control({ position: 'bottomright' });
      legend.onAdd = () => h('div', { class: 'legend' }, h('b', null, 'Abitanti per km²'),
        cols.map((c, i) => h('div', null, h('i', { style: 'background:' + c }), i === 0 ? `fino a ${F.n(brk[0])}` : i === 4 ? `oltre ${F.n(brk[3])}` : `${F.n(brk[i - 1])} – ${F.n(brk[i])}`)));
      legend.addTo(map);
      info.textContent = `${nf0.format(gj.features.length)} sezioni di censimento caricate (ISTAT, variabili censuarie 2023).`;
      btnCens.remove();
    } catch (e) { info.textContent = 'Sezioni di censimento non disponibili: ' + e.message; btnCens.disabled = false; }
  };

  // Zone OMI.
  btnOmi.onclick = async () => {
    btnOmi.disabled = true; info.textContent = 'Scaricamento delle zone OMI…';
    try {
      const gj = await getJson(`${DATA}/omi_full/${istat}.geojson`);
      const zone = new Map((d.omi?.zone || []).map(z => [z.zona, z]));
      const lyr = L.geoJSON(gj, {
        style: (f) => ({ color: PAL[(f.properties.zona || 'A').charCodeAt(0) % PAL.length], weight: 2, fillOpacity: .12 }),
        onEachFeature: (f, l) => {
          const z = zone.get(f.properties.zona) || {};
          const a = (z.destinazioni?.Residenziale || []).find(t => /civili/i.test(t.tipologia)) || (z.destinazioni?.Residenziale || [])[0];
          l.bindPopup(() => popup(`Zona OMI ${f.properties.zona}`, [['', z.dizione],
            a && [a.tipologia, `${F.n(a.cv_min)} – ${F.n(a.cv_max)} €/mq`], a && isNum(a.loc_min) && ['Locazione', `${F.d1(a.loc_min)} – ${F.d1(a.loc_max)} €/mq mese`]]));
          l.bindTooltip(String(f.properties.zona), { permanent: true, direction: 'center', opacity: .8 });
        }
      }).addTo(map);
      control.addOverlay(lyr, 'Zone OMI');
      info.textContent = `${gj.features.length} zone OMI caricate (Agenzia delle Entrate – OMI).`;
      btnOmi.remove();
    } catch (e) { info.textContent = 'Perimetri OMI non disponibili: ' + e.message; btnOmi.disabled = false; }
  };

  setTimeout(() => map.invalidateSize(), 50);
}

// ================= Amministrazione =================

function tabAmministrazione(p, d, c) {
  const box = h('div', null, h('div', { class: 'loading' }, 'Caricamento dell\'anagrafe degli amministratori (al primo utilizzo può richiedere alcuni secondi)…'));
  p.append(box);
  host('amministratori', { nome: c.n, prov: c.p }).then(r => {
    if (!box.isConnected) return;
    const righe = r.righe || [];
    if (!righe.length) { box.replaceChildren(h('div', { class: 'card empty' }, 'Nessun amministratore presente nell\'anagrafe del Ministero dell\'Interno per questo comune.')); return; }
    const is = re => a => re.test(a.carica);
    const giunta = righe.filter(a => /^(assessore|vicesindaco)/i.test(a.carica));
    const consiglio = righe.filter(is(/^consigliere/i));
    const commissari = righe.filter(is(/commiss/i));
    const sindaco = righe.find(a => /^sindaco$/i.test(a.carica));
    const donne = righe.filter(a => a.sesso === 'F').length;
    const nome = a => `${a.cognome} ${a.nome}`;
    const cols = [
      { t: 'Nominativo', get: nome }, { t: 'Carica', k: 'carica' }, { t: 'Incarico', k: 'incarico' }, { t: 'Lista', k: 'lista', fmt: v => cut(v || '—', 60) },
      { t: 'Elezione', k: 'dataElezione' }, { t: 'In carica dal', k: 'dataEntrataInCarica' }, { t: 'Titolo di studio', k: 'titoloStudio' }];
    const btn = h('button', { class: 'btn' }, 'Esporta amministratori (Excel)');
    btn.onclick = () => exportXlsx(btn, `Amministratori_${c.n.replace(/[^\p{L}\p{N}]+/gu, '_')}.xlsx`, 'Amministratori',
      ['Comune', 'Provincia', 'Cognome', 'Nome', 'Sesso', 'Carica', 'Incarico', 'Lista', 'Data elezione', 'In carica dal', 'Titolo di studio', 'Professione'],
      righe.map(a => [c.n, c.p, a.cognome, a.nome, a.sesso, a.carica, a.incarico, a.lista, a.dataElezione, a.dataEntrataInCarica, a.titoloStudio, a.professione]));
    box.replaceChildren(
      h('div', { class: 'page-head' }, h('div', { class: 'src' }, `Fonte: Ministero dell'Interno – Anagrafe degli Amministratori Locali e Regionali · aggiornamento ${r.aggiornamento}`), btn),
      tiles(
        tile(sindaco ? 'Sindaco' : 'Vertice dell\'ente', r.sindaco || '—', sindaco && sindaco.dataElezione ? 'eletto il ' + sindaco.dataElezione : null),
        tile('Giunta', F.n(giunta.length), 'assessori'), tile('Consiglio', F.n(consiglio.length), 'consiglieri'),
        tile('Donne', F.pct(donne / righe.length * 100), `${donne} su ${righe.length}`)),
      sindaco && h('div', { class: 'card', style: 'margin-bottom:16px' }, h('h3', null, 'Sindaco'), h('div', { class: 'big-name' }, nome(sindaco)),
        kv([['Lista / coalizione', sindaco.lista || null], ['Data elezione', sindaco.dataElezione], ['In carica dal', sindaco.dataEntrataInCarica],
          ['Titolo di studio', sindaco.titoloStudio || null], ['Professione', sindaco.professione ? cut(sindaco.professione, 70) : null]])),
      has(commissari) && h('div', { class: 'card', style: 'margin-bottom:16px' }, h('h3', null, 'Gestione commissariale'), dataTable(cols, commissari)),
      has(giunta) && h('div', { class: 'card', style: 'margin-bottom:16px' }, h('h3', null, 'Giunta comunale'), dataTable(cols, giunta)),
      has(consiglio) && h('div', { class: 'card' }, h('h3', null, 'Consiglio comunale'), dataTable(cols, consiglio, { size: 40 })));
  }).catch(e => { if (box.isConnected) box.replaceChildren(h('div', { class: 'error' }, e.message)); });
}
