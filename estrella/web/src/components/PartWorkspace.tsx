import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ZoomIn, ZoomOut, Maximize, Minimize, Hand, PenTool, Highlighter, Minus, MoveUpRight, Square, Circle, Type, Stamp, Eraser, MousePointer2,
  Undo2, Redo2, MessageCircleQuestion, PanelRight, Download, Layers, Hash, AlertTriangle, ScanLine, Play, Pause, Trash2, History, Music, Save,
} from './icons';
import ScoreCanvas, { type Tool, type Ann, type MeasureBox, type Highlight } from './ScoreCanvas';
import { useAnnotations } from '../lib/annotations';
import { get, put, upload, fileUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLoad, Modal, Field, Notice, Spinner, ErrorBox, useToast, Tabs } from './ui';
import { useRealtime, useChannel } from '../lib/realtime';
import DoubtThread from './DoubtThread';
import Recorder from './Recorder';
import { cropCanvas } from '../lib/pdf';
import { fmtDateTime } from '../lib/format';

const COLORS = ['#dc2626', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#111827'];
const SYMBOLS = [
  { s: '𝄐', l: 'Calderón' }, { s: '’', l: 'Respirar' }, { s: '>', l: 'Acento' }, { s: '!', l: 'Atención' }, { s: '✓', l: 'Bien' },
  { s: '✗', l: 'Error' }, { s: '↻', l: 'Repetir' }, { s: '♩=', l: 'Tempo' }, { s: 'p', l: 'Piano' }, { s: 'f', l: 'Forte' }, { s: '👁', l: 'Mirar al director' },
];
const QUICK_TEXT = ['Más suave', 'Atención a la entrada', 'Respirar aquí', 'Repetir', 'No acelerar', 'Mantener el pulso', 'Entramos todos juntos'];

export interface LiveOverlay {
  measure: number | null; loop: { from: number; to: number } | null; sectionName?: string | null; follow: boolean; showAnnotations: boolean; key: number;
}

interface Props {
  partId: string;
  live?: LiveOverlay | null;
  header?: ReactNode;
  initialMeasure?: number | null;
  initialDoubt?: string | null;
  eventId?: string | null;
  height?: string;
  panelDefault?: boolean;
}

export default function PartWorkspace({ partId, live, header, initialMeasure, initialDoubt, eventId, height, panelDefault }: Props) {
  const { me, can, canSection } = useAuth();
  const toast = useToast();
  const part = useLoad(() => get(`/library/parts/${partId}`), [partId]);
  const p = part.data;
  const sectionId: number | null = null;
  const canOfficial = can('annotate.official') || canSection('annotate');
  const canManage = can('library.manage');
  const manageDoubts = can('scores.publish') || canSection('doubts');

  const [zoom, setZoom] = useState(() => Number(localStorage.getItem('estrella.zoom') || 1));
  const [tool, setTool] = useState<Tool>('none');
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(3);
  const [symbol, setSymbol] = useState(SYMBOLS[0].s);
  const [layer, setLayer] = useState<'personal' | 'official'>('personal');
  const [audienceScope, setAudienceScope] = useState<'all' | 'mine'>('all');
  const [show, setShow] = useState({ official: true, personal: true, doubts: true });
  const [panel, setPanel] = useState(() => panelDefault ?? (window.innerWidth > 1100 || !!initialDoubt));
  const [tab, setTab] = useState<'indicaciones' | 'dudas' | 'compases' | 'capas'>(initialDoubt ? 'dudas' : 'indicaciones');
  const [selected, setSelected] = useState<string | null>(null);
  const [scrollTarget, setScrollTarget] = useState<{ page: number; y: number; key: number } | null>(null);
  const [jump, setJump] = useState<{ measure: number; key: number } | null>(initialMeasure ? { measure: initialMeasure, key: 1 } : null);
  const [textAt, setTextAt] = useState<{ page: number; x: number; y: number } | null>(null);
  const [doubtDraft, setDoubtDraft] = useState<{ page: number; rect: any; blob: Blob | null; url: string; measure: number | null } | null>(null);
  const [regionMode, setRegionMode] = useState<'doubt' | 'map'>('doubt');
  const [mapDraft, setMapDraft] = useState<MeasureBox[] | null>(null);
  const [openDoubt, setOpenDoubt] = useState<string | null>(initialDoubt ?? null);
  const [measureAnn, setMeasureAnn] = useState(false);
  const [penOnly, setPenOnly] = useState(() => localStorage.getItem('estrella.penonly') === '1');
  const [autoScroll, setAutoScroll] = useState(0);
  const shell = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [fs, setFs] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(() => window.innerWidth > 700);

  useEffect(() => { localStorage.setItem('estrella.zoom', String(zoom)); }, [zoom]);
  useEffect(() => { localStorage.setItem('estrella.penonly', penOnly ? '1' : '0'); }, [penOnly]);
  useChannel(p ? `marcha:${p.marcha_id}` : null);

  const anns = useAnnotations(p?.marcha_id, partId, {
    onConflict: (m) => toast({ kind: 'error', title: 'Conflicto de edición', text: m }),
    onError: (m) => toast({ kind: 'error', text: m }),
  });
  const doubts = useLoad(() => (p ? get<any[]>(`/doubts?marcha=${p.marcha_id}&part=${partId}`) : Promise.resolve([])), [p?.marcha_id, partId]);
  useRealtime((m) => {
    if (m.t?.startsWith('doubt:')) doubts.reload();
    if (m.t === 'part:measures' && m.partId === partId) part.reload();
    if (m.t === 'parts:changed' && m.replaces === partId) { part.reload(); toast({ kind: 'info', title: 'Nueva versión de la partitura', text: 'La dirección ha sustituido esta partitura. Ábrela desde la ficha de la marcha.' }); }
  }, [partId]);

  const measureMap: MeasureBox[] = mapDraft ?? p?.measures_map ?? [];
  const boxOf = useCallback((n: number) => measureMap.find((m) => m.measure === n), [measureMap]);

  // salto a compás (manual o del director)
  const targetMeasure = live?.measure ?? jump?.measure ?? null;
  useEffect(() => {
    const n = live ? (live.follow ? live.measure : null) : jump?.measure;
    if (n == null) return;
    const b = boxOf(n);
    if (b) setScrollTarget({ page: b.page, y: b.y, key: Date.now() });
  }, [live?.key, live?.follow, jump?.key, boxOf]); // eslint-disable-line

  // abrir duda: ir a su página y zona
  const doubtList: any[] = doubts.data ?? [];
  const openDoubtRow = doubtList.find((d) => d.id === openDoubt);
  useEffect(() => { if (openDoubtRow) setScrollTarget({ page: openDoubtRow.page, y: openDoubtRow.rect.y, key: Date.now() }); }, [openDoubtRow?.id]); // eslint-disable-line

  // desplazamiento automático
  useEffect(() => {
    if (!autoScroll || !scroller.current) return;
    let raf = 0; let last = performance.now();
    const step = (t: number) => { scroller.current!.scrollTop += (autoScroll * (t - last)) / 1000; last = t; raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [autoScroll]);

  useEffect(() => {
    const f = () => setFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', f);
    return () => document.removeEventListener('fullscreenchange', f);
  }, []);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? anns.redo() : anns.undo(); }
      if (e.key === 'Escape') { setTool('none'); setSelected(null); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [anns]);

  const highlights: Highlight[] = useMemo(() => {
    const out: Highlight[] = [];
    if (live?.loop) for (let n = live.loop.from; n <= live.loop.to; n++) { const b = boxOf(n); if (b) out.push({ ...b, variant: 'loop' }); }
    if (targetMeasure != null) { const b = boxOf(targetMeasure); if (b) out.push({ ...b, variant: 'current', label: `${live ? 'Director · ' : ''}Compás ${targetMeasure}${live?.sectionName ? ` · ${live.sectionName}` : ''}` }); }
    if (openDoubtRow) out.push({ page: openDoubtRow.page, ...openDoubtRow.rect, variant: 'doubt', label: 'Fragmento de la duda' });
    return out;
  }, [live?.loop, targetMeasure, boxOf, openDoubtRow, live?.sectionName, live]); // eslint-disable-line

  const visible = anns.list.filter((a) => (a.layer === 'official' ? show.official && (live ? live.showAnnotations : true) : show.personal));

  if (part.error) return <div className="page"><ErrorBox error={part.error} retry={part.reload} /></div>;
  if (!p) return <Spinner label="Cargando partitura…" />;

  const audience = () => {
    if (layer === 'personal' || audienceScope === 'all') return { scope: 'all' };
    const mine = me?.leaderOf.filter((l) => l.permissions.includes('annotate')).map((l) => l.section_id) ?? [];
    return { scope: 'sections', sections: mine };
  };
  const effectiveLayer = layer === 'official' && canOfficial ? 'official' : 'personal';
  const officialNeedsSection = effectiveLayer === 'official' && !can('annotate.official');

  const onDraft = (a: { page: number; kind: string; data: any }) => {
    anns.create({ marcha_id: p.marcha_id, part_id: partId, page: a.page, layer: effectiveLayer, kind: a.kind, data: a.data, color, measure: null, audience: officialNeedsSection ? { scope: 'sections', sections: me!.leaderOf.filter((l) => l.permissions.includes('annotate')).map((l) => l.section_id) } : audience(), event_id: eventId ?? null } as any);
  };

  const onRegion = async (page: number, rect: any, canvas: HTMLCanvasElement) => {
    if (regionMode === 'map') {
      const n = Number(prompt('¿Qué número de compás has marcado?', String((measureMap.filter((m) => m.page <= page).map((m) => m.measure).sort((a, b) => b - a)[0] ?? 0) + 1)));
      if (!n) return;
      setMapDraft([...measureMap.filter((m) => m.measure !== n), { measure: n, page, ...rect }].sort((a, b) => a.measure - b.measure));
      return;
    }
    const blob = await cropCanvas(canvas, rect);
    // el compás solo se propone si el mapa de compases lo identifica; nunca se inventa
    const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
    const hit = measureMap.find((m) => m.page === page && cx >= m.x && cx <= m.x + m.w && cy >= m.y && cy <= m.y + m.h);
    setDoubtDraft({ page, rect, blob, url: blob ? URL.createObjectURL(blob) : '', measure: hit?.measure ?? null });
    setTool('none');
  };

  const selectedAnn = anns.list.find((a) => a.id === selected);
  const canEditAnn = (a: Ann) => (a.layer === 'personal' ? a.owner_id === me?.id || a.owner_id === 'yo' : canOfficial);
  const tools: { t: Tool; icon: any; label: string }[] = [
    { t: 'none', icon: Hand, label: 'Desplazar' }, { t: 'pen', icon: PenTool, label: 'Lápiz' }, { t: 'highlighter', icon: Highlighter, label: 'Resaltador' },
    { t: 'line', icon: Minus, label: 'Subrayar' }, { t: 'arrow', icon: MoveUpRight, label: 'Flecha' }, { t: 'rect', icon: Square, label: 'Rectángulo' },
    { t: 'circle', icon: Circle, label: 'Círculo' }, { t: 'text', icon: Type, label: 'Texto' }, { t: 'symbol', icon: Stamp, label: 'Símbolo' },
    { t: 'eraser', icon: Eraser, label: 'Borrar' }, { t: 'select', icon: MousePointer2, label: 'Seleccionar' },
  ];
  const unmapped = targetMeasure != null && !boxOf(targetMeasure);
  const measureAnns = visible.filter((a) => !a.part_id && a.measure != null).sort((a, b) => (a.measure ?? 0) - (b.measure ?? 0));
  const pageAnnsOfficial = visible.filter((a) => a.part_id && a.layer === 'official');

  const download = async () => {
    try {
      await fetch(fileUrl(p.file_id), { credentials: 'same-origin' });
      await get(`/annotations?marcha=${p.marcha_id}&part=${partId}`);
      toast({ kind: 'ok', text: 'Partitura guardada para usar sin conexión en este dispositivo.' });
    } catch { toast({ kind: 'error', text: 'No se pudo descargar.' }); }
  };

  return (
    <div className="score-shell" ref={shell} style={{ height: height ?? undefined, display: 'flex', flexDirection: 'column' }} data-testid="part-workspace" data-part-id={partId} data-file-id={p.file_id}>
      {header}
      <div className="score-toolbar" role="toolbar" aria-label="Herramientas de partitura">
        <button className="btn icon sm" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.15).toFixed(2)))} aria-label="Alejar"><ZoomOut size={16} /></button>
        <button className="btn sm" style={{ minWidth: 58 }} onClick={() => setZoom(1)} title="Ajustar al ancho">{Math.round(zoom * 100)}%</button>
        <button className="btn icon sm" onClick={() => setZoom((z) => Math.min(3, +(z + 0.15).toFixed(2)))} aria-label="Acercar"><ZoomIn size={16} /></button>
        <button className="btn icon sm" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : shell.current?.requestFullscreen())} aria-label="Pantalla completa">{fs ? <Minimize size={16} /> : <Maximize size={16} />}</button>
        <span className="sep-v" />
        {!toolsOpen && <button className={`btn sm ${tool !== 'none' ? 'on' : ''}`} onClick={() => setToolsOpen(true)} data-testid="open-tools"><PenTool size={15} /> Anotar</button>}
        {toolsOpen && <>
        {tools.map(({ t, icon: I, label }) => (
          <button key={t} className={`btn icon sm ${tool === t ? 'on' : ''}`} onClick={() => setTool(t)} title={label} aria-label={label} aria-pressed={tool === t} data-tool={t}><I size={16} /></button>
        ))}
        {tool === 'symbol' && <select className="input" style={{ width: 'auto', minHeight: 32, padding: '3px 8px' }} value={symbol} onChange={(e) => setSymbol(e.target.value)}>{SYMBOLS.map((s) => <option key={s.s} value={s.s}>{s.s} {s.l}</option>)}</select>}
        <span className="sep-v" />
        {COLORS.map((c) => <button key={c} className={`color-swatch ${color === c ? 'on' : ''}`} style={{ background: c, width: 22, height: 22 }} onClick={() => setColor(c)} aria-label={`Color ${c}`} />)}
        <select className="input" style={{ width: 'auto', minHeight: 32, padding: '3px 8px' }} value={width} onChange={(e) => setWidth(Number(e.target.value))} aria-label="Grosor"><option value={2}>Fino</option><option value={3}>Medio</option><option value={6}>Grueso</option></select>
        <span className="sep-v" />
        <button className="btn icon sm" onClick={anns.undo} disabled={!anns.canUndo} aria-label="Deshacer" title="Deshacer (Ctrl+Z)"><Undo2 size={16} /></button>
        <button className="btn icon sm" onClick={anns.redo} disabled={!anns.canRedo} aria-label="Rehacer" title="Rehacer"><Redo2 size={16} /></button>
        <span className="sep-v" />
        {canOfficial ? (
          <select className="input" style={{ width: 'auto', minHeight: 32, padding: '3px 8px', fontWeight: 650, color: layer === 'official' ? 'var(--accent)' : undefined }} value={layer} onChange={(e) => setLayer(e.target.value as any)} aria-label="Capa de escritura" data-testid="layer-select">
            <option value="personal">Capa: mis notas (privadas)</option>
            <option value="official">Capa: oficial{can('annotate.official') ? '' : ' (mi sección)'}</option>
          </select>
        ) : <span className="badge"><Layers size={12} /> Mis notas privadas</span>}
        {layer === 'official' && can('annotate.official') && me?.leaderOf.length ? (
          <select className="input" style={{ width: 'auto', minHeight: 32, padding: '3px 8px' }} value={audienceScope} onChange={(e) => setAudienceScope(e.target.value as any)}><option value="all">Para toda la banda</option><option value="mine">Solo mis secciones</option></select>
        ) : null}
        {window.innerWidth <= 700 && <button className="btn sm ghost" onClick={() => { setToolsOpen(false); setTool('none'); }}>Ocultar</button>}
        </>}
        <span className="grow" />
        <button className={`btn sm ${tool === 'region' && regionMode === 'doubt' ? 'on' : ''}`} onClick={() => { setRegionMode('doubt'); setTool(tool === 'region' ? 'none' : 'region'); }} data-testid="ask-doubt">
          <MessageCircleQuestion size={16} /> Tengo una duda
        </button>
        {canOfficial && <button className="btn sm" onClick={() => setMeasureAnn(true)} data-testid="measure-note"><Hash size={16} /> Indicación en compás</button>}
        <button className={`btn icon sm ${panel ? 'on' : ''}`} onClick={() => setPanel(!panel)} aria-label="Panel lateral"><PanelRight size={16} /></button>
      </div>

      {tool === 'region' && <div className="notice info" style={{ borderRadius: 0, border: 0 }}><ScanLine size={18} /><span className="small">{regionMode === 'doubt' ? 'Dibuja un rectángulo sobre la nota, el compás o la zona que quieres consultar.' : 'Marca un compás con un rectángulo e indica su número.'}</span><button className="btn sm ghost" onClick={() => setTool('none')}>Cancelar</button></div>}
      {!p.active && <Notice kind="warn" title="Estás viendo una versión anterior de esta partitura">{p.newer ? <Link to={`/partitura/${p.newer.id}`} className="btn sm" style={{ marginTop: 6 }}>Abrir la versión vigente (v{p.newer.version})</Link> : 'Ha sido retirada por la dirección.'}</Notice>}
      {unmapped && live && <div className="notice warn" style={{ borderRadius: 0, border: 0 }} data-testid="unmapped-measure"><AlertTriangle size={18} /><span className="small">La dirección está en el <strong>compás {targetMeasure}</strong>. Tu partitura no tiene ese compás vinculado: localízalo manualmente (no se adivina la posición).</span></div>}

      <div className="score-body">
        <div className="score-scroll" ref={scroller}>
          <ScoreCanvas url={fileUrl(p.file_id)} range={p.page_from ? [p.page_from, p.page_to] : null} kind={p.file_kind === 'image' ? 'image' : 'pdf'} zoom={zoom} tool={tool} color={color} width={width} symbol={symbol}
            annotations={visible} measureMap={measureMap} highlights={highlights} ink={anns.ink} selectedId={selected}
            doubtMarkers={show.doubts ? doubtList.map((d) => ({ id: d.id, page: d.page, rect: d.rect, label: d.text, mine: d.author_id === me?.id })) : []}
            onDraft={onDraft} onTextAt={(page, x, y) => setTextAt({ page, x, y })} penOnly={penOnly}
            onErase={(id) => { const a = anns.list.find((x) => x.id === id); if (a && canEditAnn(a)) anns.remove(a); else toast({ kind: 'error', text: 'No puedes borrar esa anotación.' }); }}
            onSelectAnn={(id) => { setSelected(id); if (id) { setPanel(true); setTab('indicaciones'); } }}
            onRegion={onRegion} onInk={effectiveLayer === 'official' ? anns.sendInk : undefined}
            onDoubtClick={(id) => { setOpenDoubt(id); setPanel(true); setTab('dudas'); }} scrollTarget={scrollTarget} />
        </div>

        {panel && (
          <aside className="side-panel">
            <div className="row between"><div><div style={{ fontWeight: 700 }}>{p.marcha.title}</div><div className="xs muted">{p.label} · v{p.version}{p.arrangement ? ` · ${p.arrangement}` : ''}</div></div></div>
            <Tabs value={tab} onChange={setTab} items={[{ value: 'indicaciones', label: 'Notas' }, { value: 'dudas', label: `Dudas${doubtList.length ? ` (${doubtList.length})` : ''}` }, { value: 'compases', label: 'Compases' }, { value: 'capas', label: 'Capas' }]} />

            {tab === 'indicaciones' && (
              <div className="stack sm">
                {selectedAnn && (
                  <div className="card flat tight stack sm" style={{ borderColor: 'var(--accent)' }}>
                    <div className="row between"><strong className="small">{selectedAnn.layer === 'official' ? 'Anotación oficial' : 'Mi anotación'}</strong><span className="xs faint">v{selectedAnn.version}</span></div>
                    <div className="xs muted">{selectedAnn.owner_name ?? 'Yo'} · {selectedAnn.updated_at ? fmtDateTime(selectedAnn.updated_at) : 'pendiente de enviar'}</div>
                    {(selectedAnn.kind === 'text' || selectedAnn.kind === 'measure' || selectedAnn.data?.text !== undefined) && canEditAnn(selectedAnn) && (
                      <EditText initial={selectedAnn.data?.text ?? ''} onSave={(t) => anns.update(selectedAnn, { data: { ...selectedAnn.data, text: t } })} />
                    )}
                    {canEditAnn(selectedAnn) && <div className="row">{COLORS.map((c) => <button key={c} className="color-swatch" style={{ background: c, width: 20, height: 20 }} onClick={() => anns.update(selectedAnn, { color: c })} />)}</div>}
                    <div className="row">
                      {canEditAnn(selectedAnn) && <button className="btn sm danger" onClick={() => { anns.remove(selectedAnn); setSelected(null); }}><Trash2 size={14} /> Borrar</button>}
                      <AnnHistory id={selectedAnn.id} />
                    </div>
                  </div>
                )}
                <div className="xs faint" style={{ textTransform: 'uppercase', letterSpacing: '.1em' }}>Indicaciones de la dirección por compás</div>
                {!measureAnns.length && <p className="small muted">Sin indicaciones por compás.</p>}
                {measureAnns.map((a) => (
                  <button key={a.id} className="list-item btn ghost" style={{ justifyContent: 'flex-start', textAlign: 'left', whiteSpace: 'normal' }} onClick={() => { setJump({ measure: a.measure!, key: Date.now() }); setSelected(a.id); }} data-testid="measure-annotation">
                    <span className="badge accent">c.{a.measure}</span><span className="grow small">{a.data?.text}</span>{!boxOf(a.measure!) && <span className="badge warn" title="Compás no vinculado en tu partitura">sin ubicar</span>}
                  </button>
                ))}
                <div className="xs faint" style={{ textTransform: 'uppercase', letterSpacing: '.1em', marginTop: 8 }}>Sobre esta partitura</div>
                <p className="small muted">{pageAnnsOfficial.length} anotaciones oficiales · {visible.filter((a) => a.layer === 'personal').length} personales</p>
              </div>
            )}

            {tab === 'dudas' && (
              <div className="stack sm">
                {openDoubt ? (
                  <><button className="btn sm ghost" onClick={() => setOpenDoubt(null)}>← Todas las dudas</button><DoubtThread id={openDoubt} /></>
                ) : (
                  <>
                    <button className="btn sm primary" onClick={() => { setRegionMode('doubt'); setTool('region'); }}><MessageCircleQuestion size={15} /> Preguntar al director</button>
                    {!doubtList.length && <p className="small muted">No hay dudas visibles sobre esta partitura.</p>}
                    {doubtList.map((d) => (
                      <button key={d.id} className="list-item btn ghost" style={{ justifyContent: 'flex-start', textAlign: 'left', whiteSpace: 'normal' }} onClick={() => setOpenDoubt(d.id)}>
                        <span className={`badge ${d.status === 'respondida' ? 'ok' : 'warn'}`}>{d.status}</span>
                        <span className="grow small"><strong>{d.author_id === me?.id ? 'Tú' : d.author_name}</strong>: {d.text}</span>
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}

            {tab === 'compases' && (
              <div className="stack sm">
                <form className="row nowrap" onSubmit={(e) => { e.preventDefault(); const n = Number(new FormData(e.currentTarget).get('m')); if (n) setJump({ measure: n, key: Date.now() }); }}>
                  <input className="input" name="m" type="number" min={1} placeholder="Ir al compás…" />
                  <button className="btn">Ir</button>
                </form>
                <p className="small muted">{measureMap.length ? `${measureMap.length} compases vinculados en esta parte.` : 'Esta partitura no tiene compases vinculados: el salto automático a compases no está disponible.'}</p>
                <div className="row">
                  <span className="small">Desplazamiento automático</span>
                  <button className={`btn sm ${autoScroll ? 'on' : ''}`} onClick={() => setAutoScroll(autoScroll ? 0 : 25)}>{autoScroll ? <Pause size={14} /> : <Play size={14} />}</button>
                  {autoScroll > 0 && <input type="range" min={5} max={120} value={autoScroll} onChange={(e) => setAutoScroll(Number(e.target.value))} />}
                </div>
                {canManage && (
                  <div className="card flat tight stack sm">
                    <strong className="small">Vincular compases (dirección)</strong>
                    <p className="xs muted">Marca cada compás con un rectángulo e indica su número. Así cada músico salta al mismo compás en su propia parte, aunque la página sea distinta.</p>
                    <div className="row">
                      <button className={`btn sm ${tool === 'region' && regionMode === 'map' ? 'on' : ''}`} onClick={() => { setRegionMode('map'); setMapDraft(mapDraft ?? [...measureMap]); setTool('region'); }}><ScanLine size={14} /> Marcar compases</button>
                      {mapDraft && <button className="btn sm primary" onClick={async () => { try { await put(`/library/parts/${partId}/measures`, mapDraft); setMapDraft(null); setTool('none'); part.reload(); toast({ kind: 'ok', text: 'Mapa de compases guardado' }); } catch (e) { toast({ kind: 'error', text: (e as Error).message }); } }}><Save size={14} /> Guardar ({mapDraft.length})</button>}
                      {mapDraft && <button className="btn sm ghost" onClick={() => { setMapDraft(null); setTool('none'); }}>Descartar</button>}
                    </div>
                  </div>
                )}
              </div>
            )}

            {tab === 'capas' && (
              <div className="stack sm">
                <label className="checkbox"><input type="checkbox" checked={show.official} onChange={(e) => setShow({ ...show, official: e.target.checked })} /> Anotaciones oficiales de la dirección</label>
                <label className="checkbox"><input type="checkbox" checked={show.personal} onChange={(e) => setShow({ ...show, personal: e.target.checked })} /> Mis anotaciones personales (privadas)</label>
                <label className="checkbox"><input type="checkbox" checked={show.doubts} onChange={(e) => setShow({ ...show, doubts: e.target.checked })} /> Dudas y respuestas</label>
                <label className="checkbox"><input type="checkbox" checked={penOnly} onChange={(e) => setPenOnly(e.target.checked)} /> Dibujar solo con lápiz (el dedo desplaza)</label>
                <div className="sep" />
                <Notice kind="info" title="Partitura original protegida">Las anotaciones se guardan en capas separadas: el PDF original nunca se modifica.</Notice>
                <p className="xs muted">Colores de notas (rojo en línea / azul fuera de las líneas): disponibles en la versión editable cuando la marcha tiene datos musicales estructurados. Un PDF no se colorea de forma arbitraria.</p>
                <Link className="btn sm" to={`/marchas/${p.marcha_id}`}><Music size={14} /> Ficha de la marcha y versión editable</Link>
                <button className="btn sm" onClick={download}><Download size={14} /> Disponible sin conexión</button>
              </div>
            )}
          </aside>
        )}
      </div>

      {textAt && <TextModal quick={QUICK_TEXT} onClose={() => setTextAt(null)} onSave={(text) => { onDraft({ page: textAt.page, kind: 'text', data: { x: textAt.x, y: textAt.y, text, fontSize: 20 } }); setTextAt(null); }} />}
      {measureAnn && <MeasureAnnModal canAll={can('annotate.official')} me={me} onClose={() => setMeasureAnn(false)} initialMeasure={targetMeasure}
        onSave={(measure, text, aud, c) => { anns.create({ marcha_id: p.marcha_id, part_id: null, page: null, layer: 'official', kind: 'measure', data: { text }, color: c, measure, audience: aud, event_id: eventId ?? null } as any); setMeasureAnn(false); }} />}
      {doubtDraft && <DoubtModal draft={doubtDraft} partId={partId} onClose={() => { URL.revokeObjectURL(doubtDraft.url); setDoubtDraft(null); }}
        onSent={(id) => { setDoubtDraft(null); doubts.reload(); setOpenDoubt(id); setPanel(true); setTab('dudas'); toast({ kind: 'ok', text: 'Duda enviada a la dirección' }); }} />}
    </div>
  );
}

function EditText({ initial, onSave }: { initial: string; onSave: (t: string) => void }) {
  const [t, setT] = useState(initial);
  useEffect(() => setT(initial), [initial]);
  return <div className="row nowrap"><input className="input" value={t} onChange={(e) => setT(e.target.value)} /><button className="btn sm" onClick={() => onSave(t)} disabled={t === initial}>Guardar</button></div>;
}

function AnnHistory({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const h = useLoad(() => (open ? get<any[]>(`/annotations/${id}/history`) : Promise.resolve([])), [open, id]);
  return <>
    <button className="btn sm ghost" onClick={() => setOpen(!open)}><History size={14} /> Historial</button>
    {open && <div className="stack sm" style={{ width: '100%' }}>{(h.data ?? []).map((x, i) => <div key={i} className="xs muted">{fmtDateTime(x.at)} · {x.name} · {x.action} (v{x.version})</div>)}</div>}
  </>;
}

function TextModal({ onClose, onSave, quick }: { onClose: () => void; onSave: (t: string) => void; quick: string[] }) {
  const [t, setT] = useState('');
  return (
    <Modal title="Escribir en la partitura" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={!t.trim()} onClick={() => onSave(t.trim())}>Añadir</button></>}>
      <div className="stack">
        <div className="chips">{quick.map((q) => <button key={q} className="chip" onClick={() => setT(q)}>{q}</button>)}</div>
        <textarea className="input" autoFocus value={t} onChange={(e) => setT(e.target.value)} placeholder="Texto…" />
      </div>
    </Modal>
  );
}

function MeasureAnnModal({ onClose, onSave, initialMeasure, canAll, me }: { onClose: () => void; onSave: (m: number, t: string, aud: any, color: string) => void; initialMeasure: number | null; canAll: boolean; me: any }) {
  const struct = useLoad(() => get<any[]>('/org/structure'), []);
  const [m, setM] = useState(initialMeasure ? String(initialMeasure) : '');
  const [t, setT] = useState('');
  const [c, setC] = useState('#dc2626');
  const mine: number[] = me?.leaderOf.filter((l: any) => l.permissions.includes('annotate')).map((l: any) => l.section_id) ?? [];
  const [secs, setSecs] = useState<number[]>(canAll ? [] : mine);
  const options = (struct.data ?? []).filter((s) => canAll || mine.includes(s.id));
  return (
    <Modal title="Indicación en un compás" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={!Number(m) || !t.trim() || (!canAll && !secs.length)} onClick={() => onSave(Number(m), t.trim(), secs.length ? { scope: 'sections', sections: secs } : { scope: 'all' }, c)} data-testid="measure-note-save">Publicar</button></>}>
      <div className="stack">
        <p className="small muted">La indicación aparece en la parte de cada músico, en ese mismo compás (según el mapa de compases de su partitura).</p>
        <div className="form-grid"><Field label="Compás"><input className="input" type="number" min={1} value={m} onChange={(e) => setM(e.target.value)} data-testid="measure-note-measure" /></Field>
          <Field label="Color"><div className="row">{COLORS.slice(0, 5).map((x) => <button key={x} type="button" className={`color-swatch ${c === x ? 'on' : ''}`} style={{ background: x }} onClick={() => setC(x)} />)}</div></Field></div>
        <div className="chips">{QUICK_TEXT.map((q) => <button key={q} className="chip" onClick={() => setT(q)}>{q}</button>)}</div>
        <Field label="Indicación"><textarea className="input" value={t} onChange={(e) => setT(e.target.value)} data-testid="measure-note-text" /></Field>
        <Field label="Destinatarios">
          <div className="chips">
            {canAll && <button className={`chip ${!secs.length ? 'on' : ''}`} onClick={() => setSecs([])}>Toda la banda</button>}
            {options.map((s) => <button key={s.id} className={`chip ${secs.includes(s.id) ? 'on' : ''}`} onClick={() => setSecs(secs.includes(s.id) ? secs.filter((x) => x !== s.id) : [...secs, s.id])}>{s.name}</button>)}
          </div>
        </Field>
      </div>
    </Modal>
  );
}

function DoubtModal({ draft, partId, onClose, onSent }: { draft: { page: number; rect: any; blob: Blob | null; url: string; measure: number | null }; partId: string; onClose: () => void; onSent: (id: string) => void }) {
  const [text, setText] = useState('');
  const [measure, setMeasure] = useState(draft.measure ? String(draft.measure) : '');
  const [audio, setAudio] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const send = async () => {
    setBusy(true); setErr('');
    try {
      const fd = new FormData();
      fd.append('payload', JSON.stringify({ part_id: partId, page: draft.page, rect: draft.rect, measure: measure ? Number(measure) : null, text }));
      if (draft.blob) fd.append('crop', draft.blob, 'fragmento.png');
      if (audio) fd.append('audio', audio, 'duda.webm');
      const r = await upload('/doubts', fd);
      onSent(r.id);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal title="Preguntar al director" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy || text.trim().length < 3} onClick={send} data-testid="doubt-send">Enviar duda</button></>}>
      <div className="stack">
        {err && <Notice kind="danger">{err}</Notice>}
        {draft.url && <div className="staff-paper" style={{ padding: 6 }}><img src={draft.url} alt="Fragmento seleccionado" style={{ maxWidth: '100%', maxHeight: 200, display: 'block', margin: '0 auto' }} /></div>}
        <div className="form-grid">
          <Field label="Página"><input className="input" value={draft.page} readOnly /></Field>
          <Field label="Compás" hint={draft.measure ? 'Detectado con el mapa de compases' : 'Opcional: si no lo sabes, se guarda la zona exacta.'}><input className="input" type="number" min={1} value={measure} onChange={(e) => setMeasure(e.target.value)} placeholder="Desconocido" /></Field>
        </div>
        <Field label="Tu duda"><textarea className="input" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Emilio, ¿esta entrada la hacemos más corta o mantenemos la duración escrita?" data-testid="doubt-text" /></Field>
        <Recorder onChange={setAudio} />
        <p className="xs muted">Se enviarán automáticamente tu nombre, instrumento y voz, la marcha, la página y la imagen del fragmento. Solo la verán tú y los responsables autorizados, salvo que la dirección decida compartirla.</p>
      </div>
    </Modal>
  );
}
