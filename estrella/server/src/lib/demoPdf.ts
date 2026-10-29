// Generador mínimo de PDF para las partituras DE DEMOSTRACIÓN.
// No reproduce ninguna marcha real: dibuja una parte ficticia a partir de un ScoreDoc
// y devuelve también la posición de cada compás (para el mapa de compases).
import { staffPosition, type ScoreDoc } from '../../../shared/music.ts';

const W = 595, H = 842;

function esc(s: string) {
  // WinAnsi: los caracteres latinos con tilde caben en un byte
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

export interface DemoLayout { measure: number; page: number; x: number; y: number; w: number; h: number }

export function demoPartPdf(title: string, subtitle: string, doc: ScoreDoc, measuresPerSystem: number, systemsPerPage: number): { pdf: Buffer; layout: DemoLayout[] } {
  const pages: string[] = [];
  const layout: DemoLayout[] = [];
  const left = 50, right = W - 40, gap = 7; // separación entre líneas
  const perPage = measuresPerSystem * systemsPerPage;
  const total = doc.measures.length;
  const pageCount = Math.ceil(total / perPage);
  for (let p = 0; p < pageCount; p++) {
    let s = '';
    const text = (x: number, y: number, size: number, str: string, bold = false) => { s += `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x} ${y} Td (${esc(str)}) Tj ET\n`; };
    if (p === 0) {
      text(left, H - 60, 18, title, true);
      text(left, H - 80, 11, subtitle);
      s += '0.75 0.1 0.1 rg\n';
      text(left, H - 98, 9, 'DOCUMENTO DE DEMOSTRACIÓN - no es una partitura real de la banda', true);
      s += '0 0 0 rg\n';
    } else text(left, H - 50, 10, `${title} - ${subtitle} (pág. ${p + 1})`);
    const top0 = p === 0 ? H - 150 : H - 100;
    for (let sys = 0; sys < systemsPerPage; sys++) {
      const first = p * perPage + sys * measuresPerSystem;
      if (first >= total) break;
      const bottom = top0 - sys * 150 - 4 * gap; // y de la 1ª línea (inferior)
      s += '0.6 w\n';
      for (let l = 0; l < 5; l++) s += `${left} ${bottom + l * gap} m ${right} ${bottom + l * gap} l S\n`;
      // clave (rótulo simplificado)
      text(left + 2, bottom + 9, 9, doc.clef === 'bass' ? 'Fa' : doc.clef === 'percussion' ? '||' : 'Sol', true);
      if (sys === 0 && p === 0) text(left + 22, bottom + 8, 11, `${doc.time[0]}/${doc.time[1]}`, true);
      const mStart = left + 45;
      const mw = (right - mStart) / measuresPerSystem;
      for (let k = 0; k < measuresPerSystem; k++) {
        const idx = first + k;
        if (idx >= total) break;
        const m = doc.measures[idx];
        const x0 = mStart + k * mw;
        s += `${x0 + mw} ${bottom} m ${x0 + mw} ${bottom + 4 * gap} l S\n`;
        text(x0 + 2, bottom + 4 * gap + 8, 7, String(m.n));
        if (m.mark) { s += '0.2 0.2 0.6 rg\n'; text(x0 + 14, bottom + 4 * gap + 16, 9, `[${m.mark}]`, true); s += '0 0 0 rg\n'; }
        const n = m.notes.length;
        m.notes.forEach((note, j) => {
          const x = x0 + 12 + (j + 0.5) * ((mw - 16) / n);
          if (note.rest) { s += `${x - 3} ${bottom + 2 * gap - 2} 6 3 re f\n`; return; }
          const pos = staffPosition(note.step!, note.octave!, doc.clef === 'bass' ? 'bass' : 'treble');
          const y = bottom + pos * (gap / 2);
          // líneas adicionales
          for (let lp = -2; lp >= pos; lp -= 2) s += `${x - 7} ${bottom + lp * (gap / 2)} m ${x + 7} ${bottom + lp * (gap / 2)} l S\n`;
          for (let lp = 10; lp <= pos; lp += 2) s += `${x - 7} ${bottom + lp * (gap / 2)} m ${x + 7} ${bottom + lp * (gap / 2)} l S\n`;
          const rx = 4.2, ry = 3.1, c = 0.5523;
          const filled = note.dur !== 'w' && note.dur !== 'h';
          s += `${x + rx} ${y} m ${x + rx} ${y + ry * c} ${x + rx * c} ${y + ry} ${x} ${y + ry} c ${x - rx * c} ${y + ry} ${x - rx} ${y + ry * c} ${x - rx} ${y} c ${x - rx} ${y - ry * c} ${x - rx * c} ${y - ry} ${x} ${y - ry} c ${x + rx * c} ${y - ry} ${x + rx} ${y - ry * c} ${x + rx} ${y} c ${filled ? 'f' : 'S'}\n`;
          if (note.dur !== 'w') {
            const up = pos < 4;
            s += up ? `${x + rx - 0.4} ${y} m ${x + rx - 0.4} ${y + 24} l S\n` : `${x - rx + 0.4} ${y} m ${x - rx + 0.4} ${y - 24} l S\n`;
            if (note.dur === '8' || note.dur === '16') s += up ? `${x + rx - 0.4} ${y + 24} m ${x + rx + 6} ${y + 16} l S\n` : `${x - rx + 0.4} ${y - 24} m ${x - rx + 6} ${y - 16} l S\n`;
          }
          if (note.dots) s += `${x + 7} ${y + 1} 1.6 1.6 re f\n`;
          if (note.alter) text(x - 12, y - 3, 9, note.alter > 0 ? '#' : 'b', true);
        });
        layout.push({ measure: m.n, page: p + 1, x: x0 / W, y: (H - (bottom + 4 * gap + 20)) / H, w: mw / W, h: (4 * gap + 34) / H });
      }
      s += `${left} ${bottom} m ${left} ${bottom + 4 * gap} l S\n`;
    }
    text(left, 30, 8, `ESTRELLA · datos de demostración generados automáticamente · página ${p + 1} de ${pageCount}`);
    pages.push(s);
  }

  // ensamblado del PDF
  const objs: string[] = [];
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  const pageIds = pages.map((_, i) => 5 + i * 2);
  objs.push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  pages.forEach((content, i) => {
    const contentId = 6 + i * 2;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`);
    const bytes = Buffer.from(content, 'latin1');
    objs.push(`<< /Length ${bytes.length} >>\nstream\n${content}endstream`);
  });
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return { pdf: Buffer.from(out, 'latin1'), layout };
}
