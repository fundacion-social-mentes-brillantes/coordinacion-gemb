import Papa from 'papaparse';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

// Utilidades de exportación a CSV y PDF, reutilizables en todo el panel.

/**
 * Descarga un archivo. En el iPhone con la app instalada el atributo
 * `download` no hace nada, así que allí se abre la hoja de Compartir
 * (permite "Guardar en Archivos" o enviarlo por WhatsApp).
 */
export function downloadBlob(content: BlobPart, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const nav = navigator as Navigator & {
    canShare?: (d: unknown) => boolean;
    share?: (d: unknown) => Promise<void>;
  };

  const isIOS =
    /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  const guardarLocal = () => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  if (isIOS && nav.share && nav.canShare) {
    try {
      const file = new File([blob], filename, { type });
      if (nav.canShare({ files: [file] })) {
        void nav.share({ files: [file] }).catch((e) => {
          // Si la usuaria cancela, no insistimos; si falló de verdad,
          // al menos intentamos la descarga normal.
          if (!(e instanceof DOMException && e.name === 'AbortError')) {
            guardarLocal();
          }
        });
        return;
      }
    } catch {
      /* seguimos con la descarga normal */
    }
  }

  guardarLocal();
}

function ensureExt(name: string, ext: string) {
  return name.toLowerCase().endsWith('.' + ext) ? name : `${name}.${ext}`;
}

/** Exporta un arreglo de objetos a CSV (con BOM para acentos en Excel). */
export function exportCSV(filename: string, rows: Record<string, unknown>[]) {
  const csv = Papa.unparse(rows);
  const BOM = String.fromCharCode(0xfeff); // ayuda a Excel a leer los acentos
  downloadBlob(BOM + csv, ensureExt(filename, 'csv'), 'text/csv;charset=utf-8;');
}

export interface PdfOptions {
  title: string;
  subtitle?: string;
  columns: string[];
  rows: (string | number)[][];
  filename: string;
}

/** Exporta una tabla a PDF con encabezado y estilo de la marca. */
export function exportPDF({
  title,
  subtitle,
  columns,
  rows,
  filename,
}: PdfOptions) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const marginX = 40;

  doc.setFontSize(16);
  doc.setTextColor(31, 120, 98); // primary-600
  doc.text(title, marginX, 46);

  let startY = 62;
  doc.setFontSize(10);
  doc.setTextColor(90, 90, 90);
  const stamp = new Date().toLocaleString('es');
  doc.text(`Generado: ${stamp}`, marginX, startY);
  startY += 14;
  if (subtitle) {
    doc.text(subtitle, marginX, startY);
    startY += 14;
  }

  autoTable(doc, {
    head: [columns],
    body: rows,
    startY: startY + 4,
    styles: { fontSize: 9, cellPadding: 5, overflow: 'linebreak' },
    headStyles: { fillColor: [43, 150, 120], textColor: 255 },
    alternateRowStyles: { fillColor: [242, 250, 247] },
    margin: { left: marginX, right: marginX },
  });

  // No se usa doc.save(): en el iPhone con la app instalada no descarga nada.
  // downloadBlob sí ofrece la hoja de Compartir como alternativa.
  downloadBlob(doc.output('blob'), ensureExt(filename, 'pdf'), 'application/pdf');
}
