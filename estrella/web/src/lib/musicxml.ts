// Importación/exportación MusicXML (subconjunto: una parte, una voz) ↔ modelo interno.
import { uid, DURS, type ScoreDoc, type Measure, type Note, type Dur, type Step, type Articulation, type Dynamic, keyAlter, STEPS } from '../../../shared/music';

const TYPE_TO_DUR: Record<string, Dur> = { whole: 'w', half: 'h', quarter: 'q', eighth: '8', '16th': '16', '32nd': '32' };
const DUR_TO_TYPE: Record<Dur, string> = { w: 'whole', h: 'half', q: 'quarter', '8': 'eighth', '16': '16th', '32': '32nd' };
const DUR_DIV: Record<Dur, number> = { w: 64, h: 32, q: 16, '8': 8, '16': 4, '32': 2 }; // divisiones con divisions=16

export function parseMusicXML(xml: string, title: string): { doc: ScoreDoc; warnings: string[] } {
  const dom = new DOMParser().parseFromString(xml, 'application/xml');
  if (dom.querySelector('parsererror')) throw new Error('El archivo no es un XML válido.');
  if (dom.documentElement.nodeName === 'score-timewise') throw new Error('Formato «timewise» no admitido: exporta en formato «partwise».');
  const parts = dom.querySelectorAll('score-partwise > part');
  if (!parts.length) throw new Error('No se han encontrado partes en el MusicXML.');
  const warnings = new Set<string>();
  if (parts.length > 1) warnings.add(`El archivo tiene ${parts.length} partes: se importa solo la primera (crea una partitura editable por voz).`);
  const part = parts[0];
  let divisions = 1, key = 0, time: [number, number] = [4, 4], clef: ScoreDoc['clef'] = 'treble', tempo = 0, transposition = 0;
  const measures: Measure[] = [];
  let pendingDyn: Dynamic | undefined;
  let n = 0;
  for (const mEl of Array.from(part.querySelectorAll(':scope > measure'))) {
    n++;
    const meas: Measure = { id: uid(), n, notes: [] };
    for (const child of Array.from(mEl.children)) {
      const tag = child.nodeName;
      if (tag === 'attributes') {
        const d = child.querySelector('divisions'); if (d) divisions = Number(d.textContent) || 1;
        const f = child.querySelector('key > fifths'); if (f) key = Number(f.textContent) || 0;
        const b = child.querySelector('time > beats'), bt = child.querySelector('time > beat-type');
        if (b && bt) { if (n > 1 && (Number(b.textContent) !== time[0] || Number(bt.textContent) !== time[1])) warnings.add('Hay cambios de compás a mitad de la obra: se mantiene el compás inicial.'); if (n === 1) time = [Number(b.textContent) || 4, Number(bt.textContent) || 4]; }
        const sign = child.querySelector('clef > sign')?.textContent;
        if (sign && n === 1) clef = sign === 'F' ? 'bass' : sign === 'percussion' ? 'percussion' : 'treble';
        const chrom = child.querySelector('transpose > chromatic'); if (chrom) transposition = Number(chrom.textContent) || 0;
      } else if (tag === 'direction') {
        const reh = child.querySelector('rehearsal'); if (reh?.textContent) meas.mark = reh.textContent.trim();
        const words = child.querySelector('words')?.textContent?.trim();
        if (!meas.mark && words && /^(intro|introducci[oó]n|trío|trio|coda|final|[A-Z])$/i.test(words)) meas.mark = words;
        const dyn = child.querySelector('dynamics > *'); if (dyn) { const v = dyn.nodeName as Dynamic; if (['pp', 'p', 'mp', 'mf', 'f', 'ff', 'sfz'].includes(v)) pendingDyn = v; }
        const met = child.querySelector('metronome > per-minute'); if (met && !tempo) tempo = Number(met.textContent) || 0;
        const snd = child.querySelector('sound[tempo]'); if (snd && !tempo) tempo = Number(snd.getAttribute('tempo')) || 0;
      } else if (tag === 'sound' && child.getAttribute('tempo') && !tempo) tempo = Number(child.getAttribute('tempo'));
      else if (tag === 'barline') {
        const rep = child.querySelector('repeat');
        if (rep?.getAttribute('direction') === 'forward') meas.repeatStart = true;
        if (rep?.getAttribute('direction') === 'backward') meas.repeatEnd = true;
      } else if (tag === 'note') {
        const voice = child.querySelector('voice')?.textContent;
        if (voice && voice !== '1') { warnings.add('Se han ignorado notas de voces secundarias.'); continue; }
        if (child.querySelector('grace')) { warnings.add('Se han ignorado notas de adorno (appoggiaturas).'); continue; }
        if (child.querySelector('chord')) { warnings.add('Acordes: se conserva solo la primera nota.'); continue; }
        const type = child.querySelector('type')?.textContent ?? '';
        let dur: Dur | undefined = TYPE_TO_DUR[type];
        const dots = child.querySelectorAll('dot').length;
        if (!dur) {
          const q = Number(child.querySelector('duration')?.textContent || 0) / divisions;
          dur = (DURS.find((d) => Math.abs({ w: 4, h: 2, q: 1, '8': 0.5, '16': 0.25, '32': 0.125 }[d] - q) < 1e-6) ?? 'q') as Dur;
          if (child.querySelector('rest[measure="yes"]')) { warnings.add('Silencios de compás completo convertidos a figuras.'); }
        }
        const isRest = !!child.querySelector('rest');
        const note: Note = { id: uid(), dur, ...(dots ? { dots: Math.min(2, dots) } : {}) };
        if (isRest) note.rest = true;
        else {
          const p = child.querySelector('pitch') ?? child.querySelector('unpitched');
          const step = (p?.querySelector('step, display-step')?.textContent ?? 'B') as Step;
          const octave = Number(p?.querySelector('octave, display-octave')?.textContent ?? 4);
          note.step = STEPS.includes(step) ? step : 'B';
          note.octave = octave;
          note.alter = Number(p?.querySelector('alter')?.textContent ?? 0) || 0;
          if (child.querySelector('tie[type="start"]')) note.tie = true;
          const art: Articulation[] = [];
          if (child.querySelector('articulations staccato')) art.push('staccato');
          if (child.querySelector('articulations accent')) art.push('accent');
          if (child.querySelector('articulations tenuto')) art.push('tenuto');
          if (child.querySelector('articulations strong-accent')) art.push('marcato');
          if (child.querySelector('fermata')) art.push('fermata');
          if (art.length) note.artic = art;
          if (pendingDyn) { note.dyn = pendingDyn; pendingDyn = undefined; }
        }
        if (child.querySelector('time-modification')) warnings.add('Tresillos/grupos irregulares: se aproximan a figuras normales (revisa esos compases).');
        meas.notes.push(note);
      } else if (tag === 'backup' || tag === 'forward') {
        // voces adicionales: ignoradas
      }
    }
    measures.push(meas);
  }
  if (!measures.length) throw new Error('La parte no contiene compases.');
  const doc: ScoreDoc = { schema: 1, title, clef, key, time, tempo: tempo ? Math.round(Math.min(300, Math.max(20, tempo))) : 80, transposition, measures };
  return { doc, warnings: [...warnings] };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export function toMusicXML(doc: ScoreDoc): string {
  const clef = doc.clef === 'bass' ? '<sign>F</sign><line>4</line>' : doc.clef === 'percussion' ? '<sign>percussion</sign>' : '<sign>G</sign><line>2</line>';
  const measures = doc.measures.map((m, i) => {
    const attrs = i === 0 ? `<attributes><divisions>16</divisions><key><fifths>${doc.key}</fifths></key><time><beats>${doc.time[0]}</beats><beat-type>${doc.time[1]}</beat-type></time><clef>${clef}</clef>${doc.transposition ? `<transpose><diatonic>${Math.round(doc.transposition * 7 / 12)}</diatonic><chromatic>${doc.transposition}</chromatic></transpose>` : ''}</attributes><direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${doc.tempo}</per-minute></metronome></direction-type><sound tempo="${doc.tempo}"/></direction>` : '';
    const mark = m.mark ? `<direction placement="above"><direction-type><rehearsal>${esc(m.mark)}</rehearsal></direction-type></direction>` : '';
    const left = m.repeatStart ? '<barline location="left"><repeat direction="forward"/></barline>' : '';
    const right = m.repeatEnd ? '<barline location="right"><bar-style>light-heavy</bar-style><repeat direction="backward"/></barline>' : '';
    const notes = m.notes.map((n) => {
      const d = DUR_DIV[n.dur] * (n.dots === 1 ? 1.5 : n.dots === 2 ? 1.75 : 1);
      const dyn = n.dyn && !['cresc', 'dim'].includes(n.dyn) ? `<direction placement="below"><direction-type><dynamics><${n.dyn}/></dynamics></direction-type></direction>` : '';
      const pitch = n.rest ? '<rest/>' : `<pitch><step>${n.step}</step>${n.alter ? `<alter>${n.alter}</alter>` : ''}<octave>${n.octave}</octave></pitch>`;
      const acc = !n.rest && n.step && (n.alter ?? 0) !== keyAlter(n.step, doc.key) ? `<accidental>${n.alter === 1 ? 'sharp' : n.alter === -1 ? 'flat' : n.alter === 2 ? 'double-sharp' : n.alter === -2 ? 'flat-flat' : 'natural'}</accidental>` : '';
      const arts = (n.artic ?? []).filter((a) => a !== 'fermata').map((a) => (a === 'marcato' ? '<strong-accent/>' : `<${a}/>`)).join('');
      const notations = (arts || n.artic?.includes('fermata') || n.tie) ? `<notations>${n.tie ? '<tied type="start"/>' : ''}${arts ? `<articulations>${arts}</articulations>` : ''}${n.artic?.includes('fermata') ? '<fermata/>' : ''}</notations>` : '';
      return `${dyn}<note>${pitch}<duration>${Math.round(d)}</duration>${n.tie ? '<tie type="start"/>' : ''}<voice>1</voice><type>${DUR_TO_TYPE[n.dur]}</type>${'<dot/>'.repeat(n.dots ?? 0)}${acc}${notations}</note>`;
    }).join('');
    return `<measure number="${m.n}">${left}${attrs}${mark}${notes}${right}</measure>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1"><work><work-title>${esc(doc.title)}</work-title></work>
<identification><encoding><software>ESTRELLA</software></encoding></identification>
<part-list><score-part id="P1"><part-name>${esc(doc.title)}</part-name></score-part></part-list>
<part id="P1">
${measures}
</part></score-partwise>`;
}
