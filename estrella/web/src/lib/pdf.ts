import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

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
