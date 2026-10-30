import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PageText } from '../../../shared/book';
import type { Transcription } from '../../../shared/pdfMusic';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface PageSource { width: number; height: number; render: (canvas: HTMLCanvasElement, cssWidth: number) => Promise<void> }

const cache = new Map<string, Promise<PageSource[]>>();

/** Carga un PDF o una imagen y devuelve sus páginas listas para renderizar a cualquier tamaño. */
export function loadPages(url: string, kind: 'pdf' | 'image'): Promise<PageSource[]> {
  const key = `${kind}:${url}`;
  if (!cache.has(key)) cache.set(key, kind === 'pdf' ? loadPdf(url) : loadImage(url));
  const p = cache.get(key)!;
  p.catch(() => cache.delete(key));
  return p;
}

async function loadPdf(url: string): Promise<PageSource[]> {
  const doc = await pdfjs.getDocument({ url, withCredentials: true }).promise;
  const pages: PageSource[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    let task: any = null;
    pages.push({
      width: vp.width, height: vp.height,
      render: async (canvas, cssWidth) => {
        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        const scale = (cssWidth / vp.width) * dpr;
        const v = page.getViewport({ scale });
        canvas.width = Math.floor(v.width); canvas.height = Math.floor(v.height);
        task?.cancel?.();
        task = page.render({ canvasContext: canvas.getContext('2d')!, viewport: v });
        try { await task.promise; } catch { /* cancelado por un nuevo zoom */ }
      },
    });
  }
  return pages;
}

async function loadImage(url: string): Promise<PageSource[]> {
  const img = new Image();
  img.src = url;
  await img.decode();
  return [{
    width: img.naturalWidth, height: img.naturalHeight,
    render: async (canvas, cssWidth) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      canvas.width = Math.floor(cssWidth * dpr); canvas.height = Math.floor((cssWidth * dpr * img.naturalHeight) / img.naturalWidth);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    },
  }];
}

/** Recorta una zona (coordenadas normalizadas) de un canvas ya renderizado → PNG. */
export function cropCanvas(canvas: HTMLCanvasElement, r: { x: number; y: number; w: number; h: number }, pad = 0.01): Promise<Blob | null> {
  const x = Math.max(0, r.x - pad), y = Math.max(0, r.y - pad);
  const w = Math.min(1 - x, r.w + pad * 2), h = Math.min(1 - y, r.h + pad * 2);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(w * canvas.width)); out.height = Math.max(1, Math.round(h * canvas.height));
  out.getContext('2d')!.drawImage(canvas, x * canvas.width, y * canvas.height, out.width, out.height, 0, 0, out.width, out.height);
  return new Promise((res) => out.toBlob(res, 'image/png'));
}

/** Textos de cada página de un PDF local, con su posición (y desde arriba) y tamaño de letra. */
export async function readPdfText(file: File): Promise<PageText[]> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const out: PageText[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    out.push({
      width: vp.width, height: vp.height,
      items: tc.items.filter((it): it is any => 'str' in it).map((it) => {
        // se pasa a coordenadas de la página tal como se ve (incluye páginas giradas)
        const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
        return { str: it.str, x, y, size: Math.hypot(it.transform[2], it.transform[3]) };
      }),
    });
  }
  await doc.destroy();
  return out;
}

/**
 * Lee las notas de una parte en PDF vectorial (Sibelius) y devuelve la transcripción revisable.
 * Todo ocurre en el navegador: el servidor solo recibe el resultado.
 */
export async function transcribePdf(source: string | ArrayBuffer, opts: { title: string; transposition: number; range?: [number, number] | null }): Promise<Transcription> {
  const { shapesFromOperatorList, transcribe } = await import('../../../shared/pdfMusic');
  const base = { disableFontFace: true, fontExtraProperties: true };
  const doc = await pdfjs.getDocument(typeof source === 'string' ? { ...base, url: source, withCredentials: true } : { ...base, data: new Uint8Array(source) }).promise;
  try {
    const pages = [];
    const [from, to] = opts.range ?? [1, doc.numPages];
    for (let i = from; i <= Math.min(to, doc.numPages); i++) {
      const page = await doc.getPage(i);
      const ol = await page.getOperatorList();
      // en el navegador las fuentes se registran de forma asíncrona: se espera a tener el nombre de cada una
      const names = new Map<string, string>();
      const ids = new Set<string>(ol.fnArray.flatMap((f, k) => (f === pdfjs.OPS.setFont ? [ol.argsArray[k][0] as string] : [])));
      await Promise.all([...ids].map((id) => new Promise<void>((resolve) => {
        const done = (font: any) => { names.set(id, font?.name ?? ''); resolve(); };
        try { (page.commonObjs as any).get(id, done); } catch { resolve(); }
        setTimeout(resolve, 3000);
      })));
      const [x0, y0, x1, y1] = page.view;
      pages.push(shapesFromOperatorList(ol as any, pdfjs.OPS as any, { width: x1 - x0, height: y1 - y0, x0, y0 }, (id) => names.get(id) ?? ''));
    }
    return transcribe(pages, opts);
  } finally { await doc.destroy(); }
}
