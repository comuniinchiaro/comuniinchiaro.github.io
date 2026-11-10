#!/usr/bin/env python3
"""Aggiorna i dati degli amministratori locali del sito Comuni in Chiaro.

Scarica l'Anagrafe degli Amministratori Locali (open data del Ministero dell'Interno) e rigenera
i file  <sito>/data/amministratori/<PROVINCIA>.json  letti dal sito. Il resto del sito non viene toccato.

Pensato per essere eseguito periodicamente sull'hosting (cron). Richiede solo Python 3.6 o
successivo: nessuna libreria esterna.

Uso:
    python3 aggiorna_amministratori.py --sito /percorso/della/cartella/del/sito
    python3 aggiorna_amministratori.py --sito ... --forza      (rigenera anche se la data non è cambiata)
    python3 aggiorna_amministratori.py --sito ... --csv file   (usa un CSV già scaricato)

Se qualcosa va storto (download fallito, file incompleto, formato cambiato) i dati esistenti
restano al loro posto e lo script termina con codice 1.
"""
import argparse
import csv
import io
import json
import re
import shutil
import sys
import unicodedata
import urllib.request
from collections import defaultdict
from pathlib import Path

URL = "https://dait.interno.gov.it/documenti/ammcom.csv"
COLONNE = ["cognome", "nome", "sesso", "descrizione_carica", "incarico", "data_elezione",
           "data_entrata_in_carica", "lista_appartenenza/collegamento", "titolo_studio", "professione"]
# Soglie di plausibilità: il file completo ha circa 126.000 righe e 107 province.
MIN_RIGHE, MIN_PROVINCE = 80000, 95


class Errore(Exception):
    pass


def norm(s):
    """Stessa normalizzazione usata dal sito (normAmm in app.js)."""
    s = unicodedata.normalize("NFD", s.upper())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^A-Z0-9]", "", s).replace("J", "I")


def scarica():
    req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0 (ComuniInChiaro; aggiornamento dati)"})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            data = r.read()
    except Exception as e:
        raise Errore("download non riuscito da {}: {}".format(URL, e))
    if len(data) < 1000000:
        raise Errore("download incompleto ({} byte)".format(len(data)))
    return data


def converti(raw):
    righe = raw.decode("utf-8", errors="replace").splitlines()
    aggiornamento, inizio = "", None
    for i, r in enumerate(righe[:10]):
        m = re.search(r"Aggiornato al\s*([\d/]+)", r)
        if m:
            aggiornamento = m.group(1)
        if "denominazione_comune" in r:
            inizio = i
            break
    if inizio is None:
        raise Errore("formato inatteso: intestazione delle colonne non trovata")
    per_prov = defaultdict(lambda: defaultdict(list))
    n = 0
    for r in csv.DictReader(io.StringIO("\n".join(righe[inizio:])), delimiter=";"):
        prov = (r.get("sigla_provincia") or "").strip().upper()
        comune = norm(r.get("denominazione_comune") or "")
        if not re.match(r"^[A-Z]{2}$", prov) or not comune:
            continue
        per_prov[prov][comune].append([(r.get(c) or "").strip() for c in COLONNE])
        n += 1
    if n < MIN_RIGHE or len(per_prov) < MIN_PROVINCE:
        raise Errore("file non plausibile: {} righe, {} province".format(n, len(per_prov)))
    return aggiornamento, per_prov, n


def data_attuale(dest):
    """Data di aggiornamento dei file già pubblicati, se presenti."""
    for f in sorted(dest.glob("*.json"))[:1]:
        try:
            return json.loads(f.read_text(encoding="utf-8")).get("aggiornamento", "")
        except Exception:
            return ""
    return ""


def aggiorna(sito, csv_path=None, forza=False):
    """Rigenera <sito>/data/amministratori. Restituisce un messaggio per il log."""
    sito = Path(sito)
    if not sito.is_dir():
        raise Errore("cartella del sito non trovata: {}".format(sito))
    dest = sito / "data" / "amministratori"
    raw = Path(csv_path).read_bytes() if csv_path else scarica()
    aggiornamento, per_prov, n = converti(raw)

    if not forza and dest.is_dir() and data_attuale(dest) == aggiornamento:
        return "Nessuna novita': i dati pubblicati sono gia' quelli del {}.".format(aggiornamento)

    # Si scrive in una cartella provvisoria e si sostituisce quella pubblicata solo a lavoro finito.
    nuova, vecchia = dest.with_name("amministratori.nuova"), dest.with_name("amministratori.vecchia")
    for d in (nuova, vecchia):
        if d.exists():
            shutil.rmtree(str(d))
    nuova.mkdir(parents=True)
    for prov, comuni in per_prov.items():
        testo = json.dumps({"aggiornamento": aggiornamento, "comuni": comuni}, ensure_ascii=False, separators=(",", ":"))
        (nuova / (prov + ".json")).write_text(testo, encoding="utf-8")
    if dest.exists():
        dest.rename(vecchia)
    nuova.rename(dest)
    if vecchia.exists():
        shutil.rmtree(str(vecchia))
    return "Aggiornati {} amministratori di {} province (anagrafe del {}).".format(n, len(per_prov), aggiornamento)


def main():
    ap = argparse.ArgumentParser(description="Aggiorna i dati degli amministratori locali del sito.")
    ap.add_argument("--sito", required=True, help="cartella del sito (quella che contiene index.html)")
    ap.add_argument("--csv", help="usa un CSV gia' scaricato invece di scaricarlo dal Ministero")
    ap.add_argument("--forza", action="store_true", help="rigenera anche se la data di aggiornamento non e' cambiata")
    args = ap.parse_args()
    try:
        print(aggiorna(args.sito, args.csv, args.forza))
    except Errore as e:
        print("ERRORE: {}. I dati esistenti non sono stati modificati.".format(e), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
