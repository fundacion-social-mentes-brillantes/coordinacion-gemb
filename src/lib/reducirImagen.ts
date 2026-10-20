/**
 * Deja una imagen lista para guardarla en Firestore (máximo 1 MB por
 * documento): a lo sumo 1080 px de ancho, en JPEG, bajando la calidad hasta
 * que pese menos de ~850 KB. Las piezas de la coordinación vienen en PNG de
 * 3 MB y se ven igual en WhatsApp a este tamaño.
 *
 * Devuelve el base64 (sin el "data:image/jpeg;base64,").
 */
const ANCHO_MAX = 1080;
const PESO_MAX = 850_000; // caracteres de base64

export async function reducirImagen(archivo: File): Promise<string> {
  if (!archivo.type.startsWith('image/')) throw new Error('Eso no es una imagen.');
  const bitmap = await createImageBitmap(archivo);
  const escala = Math.min(1, ANCHO_MAX / bitmap.width);
  const ancho = Math.round(bitmap.width * escala);
  const alto = Math.round(bitmap.height * escala);
  const canvas = document.createElement('canvas');
  canvas.width = ancho;
  canvas.height = alto;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('El navegador no pudo preparar la imagen.');
  // Fondo blanco: un PNG con partes transparentes no queda negro en JPEG.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, ancho, alto);
  ctx.drawImage(bitmap, 0, 0, ancho, alto);
  bitmap.close();
  for (const calidad of [0.9, 0.85, 0.8, 0.72, 0.64, 0.55]) {
    const url = canvas.toDataURL('image/jpeg', calidad);
    const b64 = url.slice(url.indexOf(',') + 1);
    if (b64.length <= PESO_MAX) return b64;
  }
  throw new Error('La imagen es demasiado pesada. Prueba con una más pequeña.');
}

/** base64 de JPEG → Blob (para compartir o descargar). */
export function blobDeJpeg(dataUrl: string): Blob {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: 'image/jpeg' });
}
