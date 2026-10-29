import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Renderer, Stave, StaveNote, Voice, Formatter, Accidental, Beam, Dot, Articulation, Annotation, Barline, StaveTie, StaveText } from 'vexflow';
import { accidentalsFor, staffPosition, placement, measureFill, measureCapacity, type ScoreDoc, type Note } from '../../../shared/music';

const KEY_NAMES: Record<number, string> = { [-7]: 'Cb', [-6]: 'Gb', [-5]: 'Db', [-4]: 'Ab', [-3]: 'Eb', [-2]: 'Bb', [-1]: 'F', 0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#', 7: 'C#' };
const ART: Record<string, string> = { staccato: 'a.', accent: 'a>', tenuto: 'a-', marcato: 'a^', fermata: 'a@a' };
export const COLOR_LINE = '#dc2626';
export const COLOR_OUT = '#2563eb';

export interface MeasureRect { id: string; n: number; x: number; y: number; w: number; h: number }

interface Props {
  doc: ScoreDoc;
  colorMode?: boolean;
  selectedNoteId?: string | null;
  selectedMeasureId?: string | null;
  playingNoteId?: string | null;
  currentMeasure?: number | null;
  loop?: { from: number; to: number } | null;
  changedNoteIds?: Set<string>;
  onNoteClick?: (noteId: string, measureId: string) => void;
  onMeasureClick?: (measureId: string) => void;
  scale?: number;
  maxMeasures?: number;
  compact?: boolean;
}

function keyOf(n: Note, clef: string) {
  if (n.rest || !n.step) return clef === 'bass' ? 'd/3' : 'b/4';
  return `${n.step.toLowerCase()}/${n.octave}`;
}

export default function StaffView(p: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [rects, setRects] = useState<MeasureRect[]>([]);
  const scale = p.scale ?? 1;

  useLayoutEffect(() => {
    const el = host.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(300, el.clientWidth - 24)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const div = host.current;
    if (!div) return;
    div.innerHTML = '';
    const doc = p.doc;
    const renderer = new Renderer(div, Renderer.Backends.SVG);
    const usable = width / scale;
    const lineH = p.compact ? 120 : 140;
    const measures = doc.measures.slice(0, p.maxMeasures ?? doc.measures.length);
    // reparto en líneas
    const widths = measures.map((m) => Math.max(110, 34 + m.notes.length * 34 + (m.notes.some((n) => n.dots) ? 12 : 0)));
    const lines: number[][] = [];
    let cur: number[] = []; let acc = 0;
    measures.forEach((_, i) => {
      const extra = cur.length === 0 ? 70 + Math.abs(doc.key) * 11 + (lines.length === 0 ? 30 : 0) : 0;
      if (cur.length && acc + widths[i] + extra > usable - 10) { lines.push(cur); cur = []; acc = 0; }
      cur.push(i); acc += widths[i] + (cur.length === 1 ? 70 + Math.abs(doc.key) * 11 + (lines.length === 0 ? 30 : 0) : 0);
    });
    if (cur.length) lines.push(cur);
    const totalH = lines.length * lineH + 30;
    renderer.resize(width, totalH * scale);
    const ctx = renderer.getContext();
    ctx.scale(scale, scale);
    const out: MeasureRect[] = [];
    const accByMeasure = new Map(measures.map((m) => [m.id, accidentalsFor(m, doc.key)]));
    let prevLast: StaveNote | null = null; let prevTie = false;

    lines.forEach((line, li) => {
      const y = 20 + li * lineH;
      const first = 70 + Math.abs(doc.key) * 11 + (li === 0 ? 30 : 0);
      const natural = line.reduce((a, i) => a + widths[i], 0);
      const stretch = (usable - 10 - first) / natural;
      let x = 6;
      line.forEach((mi, k) => {
        const m = measures[mi];
        const w = widths[mi] * (li === lines.length - 1 && stretch > 1.6 ? 1.15 : stretch) + (k === 0 ? first : 0);
        const stave = new Stave(x, y, w);
        if (k === 0) {
          stave.addClef(doc.clef === 'percussion' ? 'percussion' : doc.clef);
          if (doc.clef !== 'percussion' && doc.key) stave.addKeySignature(KEY_NAMES[doc.key]);
          if (li === 0) stave.addTimeSignature(`${doc.time[0]}/${doc.time[1]}`);
        }
        stave.setMeasure(m.n);
        if (m.repeatStart) stave.setBegBarType(Barline.type.REPEAT_BEGIN);
        if (m.repeatEnd) stave.setEndBarType(Barline.type.REPEAT_END);
        if (mi === measures.length - 1 && !m.repeatEnd) stave.setEndBarType(Barline.type.END);
        if (m.mark) stave.addModifier(new StaveText(m.mark, 3 /* ABOVE */, { shift_y: -8, justification: 1 }));
        stave.setContext(ctx).draw();
        const accs = accByMeasure.get(m.id)!;
        const notes = m.notes.map((n, ni) => {
          const sn = new StaveNote({ keys: [keyOf(n, doc.clef)], duration: n.dur + (n.rest ? 'r' : ''), clef: doc.clef === 'percussion' ? 'percussion' : doc.clef, dots: n.dots ?? 0 } as any);
          sn.setAttribute('id', n.id);
          if (n.dots) Dot.buildAndAttach([sn], { all: true });
          if (accs[ni]) sn.addModifier(new Accidental(accs[ni]!), 0);
          for (const a of n.artic ?? []) { const ar = new Articulation(ART[a]); if (a === 'fermata') ar.setPosition(3); sn.addModifier(ar, 0); }
          if (n.dyn) { const an = new Annotation(n.dyn); an.setFont('Times', 13, 'bold', 'italic'); an.setVerticalJustification(Annotation.VerticalJustify.BOTTOM); sn.addModifier(an, 0); }
          let color: string | null = null;
          if (p.colorMode && !n.rest && n.step && doc.clef !== 'percussion') color = placement(staffPosition(n.step, n.octave!, doc.clef)) === 'linea' ? COLOR_LINE : COLOR_OUT;
          if (p.changedNoteIds?.has(n.id)) color = '#d97706';
          if (n.id === p.playingNoteId) color = '#16a34a';
          if (n.id === p.selectedNoteId) color = '#c9a227';
          if (color) sn.setStyle({ fillStyle: color, strokeStyle: color });
          return sn;
        });
        if (notes.length) {
          const voice = new Voice({ num_beats: doc.time[0], beat_value: doc.time[1] }).setMode(Voice.Mode.SOFT);
          voice.addTickables(notes);
          const beams = Beam.generateBeams(notes.filter((_, i) => !m.notes[i].rest), { maintain_stem_directions: false });
          new Formatter().joinVoices([voice]).format([voice], Math.max(40, w - (k === 0 ? first : 0) - 24));
          voice.draw(ctx, stave);
          beams.forEach((b) => b.setContext(ctx).draw());
          // ligaduras de prolongación (también entre compases)
          if (prevTie && prevLast && notes[0] && !m.notes[0].rest) new StaveTie({ first_note: prevLast, last_note: notes[0], first_indices: [0], last_indices: [0] }).setContext(ctx).draw();
          m.notes.forEach((n, i) => { if (n.tie && i < m.notes.length - 1 && !m.notes[i + 1].rest) new StaveTie({ first_note: notes[i], last_note: notes[i + 1], first_indices: [0], last_indices: [0] }).setContext(ctx).draw(); });
          prevLast = notes[notes.length - 1]; prevTie = !!m.notes[m.notes.length - 1].tie && !m.notes[m.notes.length - 1].rest;
        }
        const bad = Math.abs(measureFill(m) - measureCapacity(doc.time)) > 1e-6;
        out.push({ id: m.id, n: m.n, x: stave.getNoteStartX(), y: y + 18, w: x + w - stave.getNoteStartX(), h: 76, ...(bad ? { bad: true } : {}) } as any);
        x += w;
      });
    });
    setRects(out);
  }, [p.doc, width, p.colorMode, p.selectedNoteId, p.playingNoteId, scale, p.changedNoteIds, p.maxMeasures, p.compact]);

  const click = (e: React.MouseEvent) => {
    const g = (e.target as Element).closest('.vf-stavenote');
    const id = g?.id?.slice(3);
    const svg = host.current!.querySelector('svg');
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const x = (e.clientX - r.left) / scale, y = (e.clientY - r.top) / scale;
    const m = rects.find((q) => x >= q.x - 8 && x <= q.x + q.w && y >= q.y - 20 && y <= q.y + q.h + 20);
    const doc = p.doc;
    if (id && doc.measures.some((mm) => mm.notes.some((n) => n.id === id))) {
      const mm = doc.measures.find((mm) => mm.notes.some((n) => n.id === id))!;
      p.onNoteClick?.(id, mm.id);
    } else if (m) p.onMeasureClick?.(m.id);
  };

  const hl = (pred: (r: MeasureRect) => boolean, style: React.CSSProperties, key: string, label?: (r: MeasureRect) => string) =>
    rects.filter(pred).map((r) => (
      <div key={key + r.id} style={{ position: 'absolute', left: r.x * scale - 4, top: r.y * scale - 14, width: r.w * scale, height: r.h * scale + 10, borderRadius: 8, pointerEvents: 'none', transition: 'all .25s', ...style }} data-testid={key === 'cur' ? 'score-measure-highlight' : undefined}>
        {label && <span style={{ position: 'absolute', top: -18, left: 0, fontSize: 11, fontWeight: 700, background: style.borderColor as string, color: '#fff', borderRadius: 6, padding: '0 6px' }}>{label(r)}</span>}
      </div>
    ));

  return (
    <div style={{ position: 'relative' }}>
      <div ref={host} onClick={click} style={{ cursor: p.onNoteClick ? 'pointer' : 'default' }} />
      {p.loop && hl((r) => r.n >= p.loop!.from && r.n <= p.loop!.to, { background: 'rgba(168,85,247,.08)', border: '2px dashed #a855f7' }, 'loop')}
      {p.selectedMeasureId && hl((r) => r.id === p.selectedMeasureId, { border: '2px solid #c9a227', background: 'rgba(201,162,39,.08)' }, 'sel')}
      {p.currentMeasure != null && hl((r) => r.n === p.currentMeasure, { border: '3px solid #c9a227', background: 'rgba(201,162,39,.14)', borderColor: '#c9a227' }, 'cur', (r) => `Compás ${r.n}`)}
      {hl((r) => !!(r as any).bad, { borderBottom: '3px solid #ef4444' }, 'bad')}
    </div>
  );
}

export function ColorLegend() {
  return (
    <div className="legend" aria-label="Leyenda de colores">
      <span><i style={{ background: COLOR_LINE }} />Nota sobre una de las cinco líneas</span>
      <span><i style={{ background: COLOR_OUT }} />Nota fuera de las líneas (espacios y líneas adicionales)</span>
      <span className="faint">Se calcula con la posición escrita de la cabeza de nota, no con el sonido.</span>
    </div>
  );
}
