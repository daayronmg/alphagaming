import { memo, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPE } from 'react';
import { loadPages, type PageSource } from '../lib/pdf';
import { Spinner, Notice } from './ui';

export type Tool = 'none' | 'pan' | 'pen' | 'highlighter' | 'line' | 'arrow' | 'rect' | 'circle' | 'text' | 'symbol' | 'eraser' | 'select' | 'region';
export interface Ann {
  id: string; marcha_id: string; part_id: string | null; page: number | null; layer: 'official' | 'personal'; kind: string; data: any;
  color: string; measure: number | null; version: number; owner_id: string; owner_name?: string; audience: any; deleted?: boolean; doubt_id?: string | null;
  updated_at?: string; pending?: boolean;
}
export interface Box { page: number; x: number; y: number; w: number; h: number }
export interface MeasureBox extends Box { measure: number }
export interface Highlight extends Box { label?: string; variant: 'current' | 'loop' | 'doubt' | 'flash' }
export interface InkStroke { page: number; points: [number, number][]; color: string; width: number }

interface Props {
  url: string; kind: 'pdf' | 'image'; zoom: number;
  tool: Tool; color: string; width: number; symbol: string;
  annotations: Ann[]; measureMap: MeasureBox[]; highlights: Highlight[];
  ink?: Record<string, InkStroke>;
  doubtMarkers?: { id: string; page: number; rect: { x: number; y: number; w: number; h: number }; label: string; mine?: boolean }[];
  selectedId?: string | null;
  onDraft?: (a: { page: number; kind: string; data: any }) => void;
  onTextAt?: (page: number, x: number, y: number) => void;
  onErase?: (id: string) => void;
  onSelectAnn?: (id: string | null) => void;
  onRegion?: (page: number, rect: { x: number; y: number; w: number; h: number }, canvas: HTMLCanvasElement) => void;
  onInk?: (s: { strokeId: string; page: number; points: [number, number][]; color: string; width: number; done: boolean }) => void;
  onDoubtClick?: (id: string) => void;
  scrollTarget?: { page: number; y: number; key: number } | null;
  onPages?: (n: number) => void;
  penOnly?: boolean;
}

const U = 1000; // unidades SVG del ancho de página
const DRAWING: Tool[] = ['pen', 'highlighter', 'line', 'arrow', 'rect', 'circle', 'region'];

function pathFrom(points: [number, number][], ar: number) {
  if (!points.length) return '';
  const p = points.map(([x, y]) => [x * U, y * U * ar]);
  if (p.length < 3) return `M${p[0][0]},${p[0][1]} ` + p.slice(1).map((q) => `L${q[0]},${q[1]}`).join(' ') + (p.length === 1 ? ` l0.1,0.1` : '');
  let d = `M${p[0][0]},${p[0][1]}`;
  for (let i = 1; i < p.length - 1; i++) {
    const mx = (p[i][0] + p[i + 1][0]) / 2, my = (p[i][1] + p[i + 1][1]) / 2;
    d += ` Q${p[i][0]},${p[i][1]} ${mx},${my}`;
  }
  const last = p[p.length - 1];
  return d + ` L${last[0]},${last[1]}`;
}

/** Dibujo de una anotación en coordenadas de página (normalizadas → unidades SVG). */
export const AnnShape = memo(function AnnShape({ a, ar, selected, eraser }: { a: { id: string; kind: string; data: any; color: string; layer?: string; pending?: boolean }; ar: number; selected?: boolean; eraser?: boolean }) {
  const d = a.data ?? {};
  const sw = (d.width ?? 3) * 1.4;
  const common = { 'data-ann': a.id, style: { cursor: eraser ? 'not-allowed' : undefined, opacity: a.pending ? 0.6 : 1 } } as any;
  const sel = selected ? { filter: 'drop-shadow(0 0 4px #c9a227)' } : {};
  switch (a.kind) {
    case 'pen':
      return <path {...common} d={pathFrom(d.points ?? [], ar)} fill="none" stroke={a.color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={{ ...common.style, ...sel }} />;
    case 'highlighter':
      return <path {...common} d={pathFrom(d.points ?? [], ar)} fill="none" stroke={a.color} strokeOpacity={0.35} strokeWidth={22} strokeLinecap="round" strokeLinejoin="round" style={{ ...common.style, mixBlendMode: 'multiply', ...sel }} />;
    case 'line':
    case 'arrow': {
      const [p0, p1] = d.points ?? [[0, 0], [0, 0]];
      const x1 = p0[0] * U, y1 = p0[1] * U * ar, x2 = p1[0] * U, y2 = p1[1] * U * ar;
      const ang = Math.atan2(y2 - y1, x2 - x1), L = 18;
      return (
        <g {...common} style={{ ...common.style, ...sel }}>
          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={a.color} strokeWidth={sw} strokeLinecap="round" />
          {a.kind === 'arrow' && <path d={`M${x2},${y2} L${x2 - L * Math.cos(ang - 0.45)},${y2 - L * Math.sin(ang - 0.45)} M${x2},${y2} L${x2 - L * Math.cos(ang + 0.45)},${y2 - L * Math.sin(ang + 0.45)}`} stroke={a.color} strokeWidth={sw} strokeLinecap="round" fill="none" />}
          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={24} />
        </g>
      );
    }
    case 'rect':
      return (
        <g {...common} style={{ ...common.style, ...sel }}>
          <rect x={d.x * U} y={d.y * U * ar} width={d.w * U} height={d.h * U * ar} rx={6} fill={d.text ? `${a.color}14` : 'transparent'} stroke={a.color} strokeWidth={sw} />
          {d.text && <TextBox x={d.x * U} y={d.y * U * ar - 6} text={d.text} color={a.color} size={d.fontSize ?? 18} anchorBottom />}
        </g>
      );
    case 'circle':
      return <ellipse {...common} cx={(d.x + d.w / 2) * U} cy={(d.y + d.h / 2) * U * ar} rx={(d.w / 2) * U} ry={(d.h / 2) * U * ar} fill="transparent" stroke={a.color} strokeWidth={sw} style={{ ...common.style, ...sel, pointerEvents: 'visibleStroke' }} />;
    case 'text':
      return <g {...common} style={{ ...common.style, ...sel }}><TextBox x={d.x * U} y={d.y * U * ar} text={d.text ?? ''} color={a.color} size={d.fontSize ?? 20} /></g>;
    case 'symbol':
      return <text {...common} x={d.x * U} y={d.y * U * ar} fontSize={(d.fontSize ?? 34)} fill={a.color} textAnchor="middle" dominantBaseline="central" fontWeight={700} style={{ ...common.style, ...sel }}>{d.symbol}</text>;
    default:
      return null;
  }
});

function TextBox({ x, y, text, color, size, anchorBottom }: { x: number; y: number; text: string; color: string; size: number; anchorBottom?: boolean }) {
  const lines = text.split('\n').slice(0, 6);
  const w = Math.min(560, Math.max(...lines.map((l) => l.length)) * size * 0.56 + 16);
  const h = lines.length * size * 1.25 + 10;
  const top = anchorBottom ? y - h : y;
  return (
    <g>
      <rect x={x} y={top} width={w} height={h} rx={8} fill="#fffef5" fillOpacity={0.93} stroke={color} strokeWidth={2} />
      {lines.map((l, i) => <text key={i} x={x + 8} y={top + 6 + size * (i + 1) * 1.15} fontSize={size} fill={color} fontWeight={650} fontFamily="Inter Variable, system-ui, sans-serif">{l}</text>)}
    </g>
  );
}

function Page({ src, index, width, props, registerCanvas }: { src: PageSource; index: number; width: number; props: Props; registerCanvas: (i: number, c: HTMLCanvasElement | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const ar = src.height / src.width;
  const page = index + 1;
  const [draft, setDraftState] = useState<{ kind: string; points: [number, number][] } | null>(null);
  const draftRef = useRef<{ kind: string; points: [number, number][] } | null>(null);
  const setDraft = (d: { kind: string; points: [number, number][] } | null) => { draftRef.current = d; setDraftState(d); };
  const strokeId = useRef('');
  const lastSend = useRef(0);
  const pointerType = useRef<string>('');

  useEffect(() => { if (canvasRef.current && width > 0) src.render(canvasRef.current, width); }, [src, width]);
  useEffect(() => { registerCanvas(index, canvasRef.current); return () => registerCanvas(index, null); }, [index, registerCanvas]);

  const norm = (e: RPE): [number, number] => {
    const r = svgRef.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };
  const active = DRAWING.includes(props.tool) || ['text', 'symbol', 'eraser', 'select'].includes(props.tool);

  const down = (e: RPE<SVGSVGElement>) => {
    if (!active) return;
    if (props.penOnly && e.pointerType === 'touch' && DRAWING.includes(props.tool)) return; // con «solo lápiz», el dedo desplaza
    const target = (e.target as Element).closest('[data-ann]');
    if (props.tool === 'eraser') { if (target) props.onErase?.(target.getAttribute('data-ann')!); return; }
    if (props.tool === 'select') { props.onSelectAnn?.(target ? target.getAttribute('data-ann') : null); return; }
    const p = norm(e);
    if (props.tool === 'text') { props.onTextAt?.(page, p[0], p[1]); return; }
    if (props.tool === 'symbol') { props.onDraft?.({ page, kind: 'symbol', data: { x: p[0], y: p[1], symbol: props.symbol } }); return; }
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointerType.current = e.pointerType;
    strokeId.current = crypto.randomUUID();
    setDraft({ kind: props.tool, points: [p] });
  };
  const move = (e: RPE<SVGSVGElement>) => {
    const d = draftRef.current;
    if (!d) return;
    const p = norm(e);
    const pts: [number, number][] = d.kind === 'pen' || d.kind === 'highlighter' ? [...d.points, p] : [d.points[0], p];
    setDraft({ ...d, points: pts });
    const now = performance.now();
    if ((d.kind === 'pen' || d.kind === 'highlighter') && props.onInk && now - lastSend.current > 50) {
      lastSend.current = now;
      props.onInk({ strokeId: strokeId.current, page, points: pts.slice(-400), color: props.color, width: props.width, done: false });
    }
  };
  const up = () => {
    const d = draftRef.current;
    if (!d) return;
    setDraft(null);
    const [a, b] = [d.points[0], d.points[d.points.length - 1]];
    const box = { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) };
    if (d.kind === 'region') {
      if (box.w > 0.01 && box.h > 0.005 && canvasRef.current) props.onRegion?.(page, box, canvasRef.current);
      return;
    }
    if (d.kind === 'pen' || d.kind === 'highlighter') {
      props.onInk?.({ strokeId: strokeId.current, page, points: [], color: props.color, width: props.width, done: true });
      // simplificación ligera de puntos
      const pts = d.points.filter((pt, i, arr) => i === 0 || i === arr.length - 1 || Math.hypot(pt[0] - arr[i - 1][0], pt[1] - arr[i - 1][1]) > 0.0015);
      props.onDraft?.({ page, kind: d.kind, data: { points: pts.map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)]), width: props.width } });
      return;
    }
    if (d.kind === 'line' || d.kind === 'arrow') {
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.01) return;
      props.onDraft?.({ page, kind: d.kind, data: { points: [a, b], width: props.width } });
      return;
    }
    if (box.w < 0.008 || box.h < 0.004) return;
    props.onDraft?.({ page, kind: d.kind, data: { ...box, width: props.width } });
  };

  const draftShape = draft && (() => {
    const [a, b] = [draft.points[0], draft.points[draft.points.length - 1]];
    const box = { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) };
    if (draft.kind === 'region') return <rect x={box.x * U} y={box.y * U * ar} width={box.w * U} height={box.h * U * ar} fill="rgba(37,99,235,.12)" stroke="#2563eb" strokeWidth={3} strokeDasharray="10 6" />;
    const data = draft.kind === 'pen' || draft.kind === 'highlighter' || draft.kind === 'line' || draft.kind === 'arrow' ? { points: draft.points, width: props.width } : { ...box, width: props.width };
    return <AnnShape a={{ id: 'draft', kind: draft.kind, data, color: props.color }} ar={ar} />;
  })();

  const hls = props.highlights.filter((h) => h.page === page);
  const pageAnns = props.annotations.filter((a) => a.page === page && a.part_id);
  const measureAnns = props.annotations.filter((a) => !a.part_id && a.measure != null).map((a) => ({ a, box: props.measureMap.find((m) => m.measure === a.measure) })).filter((x) => x.box?.page === page);
  const ink = Object.entries(props.ink ?? {}).filter(([, s]) => s.page === page);
  const markers = (props.doubtMarkers ?? []).filter((m) => m.page === page);

  return (
    <div className={`score-page ${active && props.tool !== 'select' ? 'drawing' : ''}`} style={{ width }} data-page={page}>
      <span className="page-no">pág. {page}</span>
      <canvas ref={canvasRef} style={{ aspectRatio: `${src.width} / ${src.height}` }} />
      {hls.map((h, i) => (
        <div key={i} className={`measure-hl ${h.variant === 'loop' ? 'loop' : ''}`} style={{ left: `${h.x * 100}%`, top: `${h.y * 100}%`, width: `${h.w * 100}%`, height: `${h.h * 100}%`, ...(h.variant === 'doubt' ? { borderColor: '#2563eb', background: 'rgba(37,99,235,.10)', boxShadow: 'none' } : {}) }} data-testid={h.variant === 'current' ? 'measure-highlight' : undefined}>
          {h.label && <span className="tag" style={h.variant === 'doubt' ? { background: '#2563eb', color: '#fff' } : undefined}>{h.label}</span>}
        </div>
      ))}
      <svg ref={svgRef} className="layer" viewBox={`0 0 ${U} ${U * ar}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDraft(null)}
        style={{ pointerEvents: active ? 'auto' : 'none' }}>
        {pageAnns.map((a) => <AnnShape key={a.id} a={a} ar={ar} selected={a.id === props.selectedId} eraser={props.tool === 'eraser'} />)}
        {measureAnns.map(({ a, box }) => (
          <g key={a.id} data-ann={a.id}>
            <rect x={box!.x * U} y={box!.y * U * ar} width={box!.w * U} height={box!.h * U * ar} rx={8} fill={`${a.color}10`} stroke={a.color} strokeWidth={3} strokeDasharray="2 6" />
            <TextBox x={box!.x * U} y={box!.y * U * ar - 4} text={`c.${a.measure} · ${a.data?.text ?? a.data?.symbol ?? ''}`} color={a.color} size={17} anchorBottom />
          </g>
        ))}
        {markers.map((m) => (
          <g key={m.id} style={{ cursor: 'pointer', pointerEvents: 'auto' }} onClick={() => props.onDoubtClick?.(m.id)} data-testid="doubt-marker">
            <rect x={m.rect.x * U} y={m.rect.y * U * ar} width={m.rect.w * U} height={m.rect.h * U * ar} rx={6} fill="rgba(37,99,235,.08)" stroke="#2563eb" strokeWidth={2.5} strokeDasharray="8 5" />
            <circle cx={(m.rect.x + m.rect.w) * U} cy={m.rect.y * U * ar} r={14} fill="#2563eb" />
            <text x={(m.rect.x + m.rect.w) * U} y={m.rect.y * U * ar + 1} fill="#fff" fontSize={18} fontWeight={800} textAnchor="middle" dominantBaseline="central">?</text>
          </g>
        ))}
        {ink.map(([id, s]) => <path key={id} d={pathFrom(s.points, ar)} fill="none" stroke={s.color} strokeWidth={(s.width ?? 3) * 1.4} strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />)}
        {draftShape}
      </svg>
    </div>
  );
}

export default function ScoreCanvas(props: Props) {
  const [pages, setPages] = useState<PageSource[] | null>(null);
  const [err, setErr] = useState('');
  const wrap = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(800);
  const canvases = useRef<(HTMLCanvasElement | null)[]>([]);
  const registerCanvas = useRef((i: number, c: HTMLCanvasElement | null) => { canvases.current[i] = c; }).current;

  useEffect(() => {
    setPages(null); setErr('');
    loadPages(props.url, props.kind).then((p) => { setPages(p); props.onPages?.(p.length); }).catch((e) => setErr(e?.message || 'No se pudo abrir la partitura'));
  }, [props.url, props.kind]); // eslint-disable-line

  useLayoutEffect(() => {
    const el = wrap.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => setAvail(Math.max(280, el.clientWidth - 36)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const width = Math.round(Math.min(avail, 1100) * props.zoom);

  useEffect(() => {
    if (!props.scrollTarget || !wrap.current) return;
    const el = wrap.current.querySelector(`[data-page="${props.scrollTarget.page}"]`) as HTMLElement | null;
    const scroller = wrap.current.parentElement;
    if (!el || !scroller) return;
    const top = el.offsetTop + el.offsetHeight * props.scrollTarget.y - scroller.clientHeight * 0.3;
    scroller.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }, [props.scrollTarget?.key, pages]); // eslint-disable-line

  if (err) return <Notice kind="danger" title="No se puede mostrar la partitura">{err}. Si estás sin conexión, solo están disponibles las partituras descargadas previamente.</Notice>;
  if (!pages) return <Spinner label="Abriendo partitura…" />;
  return (
    <div ref={wrap} data-testid="score-canvas">
      {pages.map((p, i) => <Page key={i} src={p} index={i} width={width} props={props} registerCanvas={registerCanvas} />)}
    </div>
  );
}
