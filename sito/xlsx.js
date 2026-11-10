'use strict';
// Scrittura di un file .xlsx direttamente nel browser (versione web, senza applicazione desktop).
// Un solo foglio, intestazioni in grassetto, nessuna dipendenza esterna.

const XLSX = (() => {
  const enc = new TextEncoder();
  const esc = s => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /** Archivio ZIP senza compressione: sufficiente per fogli di poche migliaia di righe. */
  function zip(files) {
    const parts = [], central = [];
    let offset = 0;
    for (const [name, text] of files) {
      const nameB = enc.encode(name), data = enc.encode(text), crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
      local.setUint16(8, 0, true); local.setUint32(10, 0x00210000, true);
      local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true);
      local.setUint16(26, nameB.length, true);
      parts.push(new Uint8Array(local.buffer), nameB, data);

      const cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true);
      cen.setUint16(10, 0, true); cen.setUint32(12, 0x00210000, true);
      cen.setUint32(16, crc, true); cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true);
      cen.setUint16(28, nameB.length, true); cen.setUint32(42, offset, true);
      central.push(new Uint8Array(cen.buffer), nameB);
      offset += 30 + nameB.length + data.length;
    }
    const cenSize = central.reduce((s, p) => s + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cenSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)],
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  const colName = i => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; };

  function cell(v, r, c, style) {
    const ref = colName(c) + r, st = style ? ` s="${style}"` : '';
    if (v == null || v === '') return '';
    if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"${st}><v>${v}</v></c>`;
    if (typeof v === 'boolean') v = v ? 'Sì' : 'No';
    return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  }

  function build(sheetName, headers, rows) {
    const name = esc(String(sheetName || 'Foglio1').replace(/[\[\]:*?\/\\]/g, ' ').slice(0, 31));
    const widths = headers.map((hd, i) => Math.min(60, Math.max(String(hd).length,
      ...rows.slice(0, 200).map(r => String(r[i] ?? '').length)) + 2));
    const xml = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>',
      widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join(''),
      '</cols><sheetData>',
      `<row r="1">${headers.map((v, c) => cell(v, 1, c, 1)).join('')}</row>`];
    rows.forEach((row, i) => xml.push(`<row r="${i + 2}">${row.map((v, c) => cell(v, i + 2, c)).join('')}</row>`));
    xml.push('</sheetData></worksheet>');
    const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    return zip([
      ['[Content_Types].xml', head + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
      ['_rels/.rels', head + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml', head + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        `<sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
      ['xl/_rels/workbook.xml.rels', head + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
      ['xl/styles.xml', head + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>'],
      ['xl/worksheets/sheet1.xml', xml.join('')]
    ]);
  }

  function download(fileName, sheetName, headers, rows) {
    const url = URL.createObjectURL(build(sheetName, headers, rows));
    const a = document.createElement('a');
    a.href = url; a.download = fileName;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  return { build, download };
})();
