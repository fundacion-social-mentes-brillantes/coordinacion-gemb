// Utilidades de exportación a Excel y PDF, reutilizables en todo el panel.
//
// Las librerías (xlsx, jsPDF) pesan cientos de KB y solo las usa la
// administración al exportar: se cargan en ese momento, no al abrir el Panel.

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

/**
 * Exporta un arreglo de objetos a un Excel de verdad (.xlsx).
 *
 * Antes era un CSV separado por comas: en un Excel configurado para Colombia
 * (separador ";") cada fila quedaba entera en la columna A. Además, en un CSV
 * un nombre que empiece por = + - @ se ejecuta como fórmula; aquí cada celda
 * se escribe como texto o número, nunca como fórmula.
 *
 * `columns` fija el orden de las columnas y hace que, aunque no haya filas,
 * el archivo traiga los encabezados (antes salía completamente vacío).
 */
export async function exportExcel(
  filename: string,
  rows: Record<string, unknown>[],
  columns?: string[],
) {
  const XLSX = await import('xlsx');
  const cols = columns ?? (rows[0] ? Object.keys(rows[0]) : []);
  const celda = (v: unknown) =>
    typeof v === 'number' ? v : v == null ? '' : String(v);
  const aoa = [cols, ...rows.map((r) => cols.map((c) => celda(r[c])))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Ancho de columna según el contenido (máx. 45 caracteres).
  ws['!cols'] = cols.map((c, i) => ({
    wch: Math.min(
      45,
      Math.max(c.length, ...aoa.slice(1).map((r) => String(r[i] ?? '').length)) + 2,
    ),
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Asistencia');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  downloadBlob(
    out,
    ensureExt(filename, 'xlsx'),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
}

export interface PdfOptions {
  title: string;
  subtitle?: string;
  columns: string[];
  rows: (string | number)[][];
  filename: string;
}

/** Exporta una tabla a PDF con encabezado y estilo de la marca. */
export async function exportPDF({
  title,
  subtitle,
  columns,
  rows,
  filename,
}: PdfOptions) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const marginX = 40;
  const ancho = doc.internal.pageSize.getWidth() - 2 * marginX;

  // Título y subtítulo se parten en líneas: con un nombre o una lista de
  // coordinadoras larga se salían por el borde derecho de la hoja.
  doc.setFontSize(16);
  doc.setTextColor(31, 120, 98); // primary-600
  const lineasTitulo: string[] = doc.splitTextToSize(title, ancho);
  doc.text(lineasTitulo, marginX, 46);
  let startY = 46 + lineasTitulo.length * 18 - 2;

  doc.setFontSize(10);
  doc.setTextColor(90, 90, 90);
  const stamp = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
  doc.text(`Generado: ${stamp}`, marginX, startY);
  startY += 14;
  if (subtitle) {
    const lineas: string[] = doc.splitTextToSize(subtitle, ancho);
    doc.text(lineas, marginX, startY);
    startY += lineas.length * 13;
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
