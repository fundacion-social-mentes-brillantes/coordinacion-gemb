"""Sube la carpeta de coordinación (un PDF) para que el equipo la vea en la app.

La carpeta no va a un archivo público: se guarda en Firestore, donde las
reglas solo dejan leerla a quien tiene acceso a la app. Firestore no admite
documentos de más de 1 MB, así que se guarda por partes:

  carpeta/actual              versión, nombre, cuántas páginas
  carpeta/actual/paginas/{n}  cada página como imagen JPEG (para leerla)

El PDF original ya NO se sube (16 oct 2026): la carpeta es solo para leer en la
app, sin descargarla ni compartirla. Si quedan partes viejas en
carpeta/actual/pdf, este script las borra.

Las partes se escriben primero y la ficha `actual` al final: así nadie ve una
versión nueva a medio subir.

Uso (desde la carpeta del proyecto):

  python scripts/subir-carpeta.py "CARPETA DE COORDINACION.pdf" --proyecto coordinacion-gemb

  # contra el emulador (pruebas, nunca la base real):
  FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 python scripts/subir-carpeta.py carpeta.pdf --proyecto demo-gemb

Necesita PyMuPDF (`pip install pymupdf`). Para la base real usa el token de la
cuenta de servicio activa en gcloud (`gcloud auth print-access-token`); el
token nunca se imprime.
"""

import argparse
import base64
import datetime
import hashlib
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

import pymupdf

ANCHO_PX = 1100  # se lee bien en el celular y pesa poco
CALIDAD_JPEG = 74
MAX_LOTE = 7_000_000  # bytes por envío (Firestore admite hasta 10 MB)


def token() -> str:
    if os.environ.get('FIRESTORE_EMULATOR_HOST'):
        return 'owner'
    salida = subprocess.check_output(
        'gcloud auth print-access-token', shell=True, text=True, stderr=subprocess.DEVNULL
    )
    return salida.strip()


def base_url(proyecto: str) -> str:
    emu = os.environ.get('FIRESTORE_EMULATOR_HOST')
    raiz = f'http://{emu}' if emu else 'https://firestore.googleapis.com'
    return f'{raiz}/v1/projects/{proyecto}/databases/(default)/documents'


def pedir(metodo: str, url: str, tok: str, cuerpo=None):
    datos = json.dumps(cuerpo).encode('utf-8') if cuerpo is not None else None
    req = urllib.request.Request(url, data=datos, method=metodo)
    req.add_header('Authorization', f'Bearer {tok}')
    req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise SystemExit(f'Firestore respondió {e.code}: {e.read()[:400]!r}')


def campos(d: dict) -> dict:
    def valor(v):
        if isinstance(v, bool):
            return {'booleanValue': v}
        if isinstance(v, int):
            return {'integerValue': str(v)}
        if isinstance(v, datetime.datetime):
            return {'timestampValue': v.strftime('%Y-%m-%dT%H:%M:%S.%fZ')}
        return {'stringValue': str(v)}

    return {k: valor(v) for k, v in d.items()}


def main():
    ap = argparse.ArgumentParser(description='Sube la carpeta de coordinación a la app.')
    ap.add_argument('pdf')
    ap.add_argument('--proyecto', required=True)
    ap.add_argument('--nombre', default='Carpeta de coordinación')
    args = ap.parse_args()

    with open(args.pdf, 'rb') as f:
        bruto = f.read()
    version = hashlib.sha256(bruto).hexdigest()[:16]
    doc = pymupdf.open(stream=bruto, filetype='pdf')

    paginas = []
    for p in doc:
        zoom = ANCHO_PX / p.rect.width
        pix = p.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
        jpg = pix.tobytes('jpeg', jpg_quality=CALIDAD_JPEG)
        paginas.append(base64.b64encode(jpg).decode('ascii'))
    trozos = []  # el PDF ya no se sube: solo se borran sus partes viejas

    mayor = max(len(x) for x in paginas)
    if mayor > 1_000_000:
        raise SystemExit(f'Una parte quedó de {mayor} bytes: baja ANCHO_PX o CALIDAD_JPEG.')

    base = base_url(args.proyecto)
    nombre_doc = base.split('/v1/', 1)[1]
    tok = token()
    antes = pedir('GET', f'{base}/carpeta/actual', tok)
    viejas = {'paginas': 0, 'pdf': 0}
    if antes:
        f = antes.get('fields', {})
        viejas['paginas'] = int(f.get('paginas', {}).get('integerValue', 0))
        viejas['pdf'] = int(f.get('partesPdf', {}).get('integerValue', 0))

    escrituras = []
    for sub, lista in (('paginas', paginas), ('pdf', trozos)):
        for n, datos in enumerate(lista):
            escrituras.append({
                'update': {
                    'name': f'{nombre_doc}/carpeta/actual/{sub}/{n}',
                    'fields': campos({'n': n, 'version': version, 'datos': datos}),
                }
            })
        # Si la carpeta nueva tiene menos partes, se borran las que sobran.
        for n in range(len(lista), viejas[sub]):
            escrituras.append({'delete': f'{nombre_doc}/carpeta/actual/{sub}/{n}'})

    lote, tam = [], 0
    for e in escrituras:
        peso = len(json.dumps(e))
        if lote and tam + peso > MAX_LOTE:
            pedir('POST', f'{base}:commit', tok, {'writes': lote})
            lote, tam = [], 0
        lote.append(e)
        tam += peso
    if lote:
        pedir('POST', f'{base}:commit', tok, {'writes': lote})

    # La ficha al final: desde aquí las coordinadoras ven la versión nueva.
    meta = {
        'version': version,
        'nombre': args.nombre,
        'paginas': len(paginas),
        'partesPdf': len(trozos),
        'bytes': len(bruto),
        'actualizada': datetime.datetime.now(datetime.timezone.utc),
    }
    pedir('POST', f'{base}:commit', tok, {
        'writes': [{'update': {'name': f'{nombre_doc}/carpeta/actual', 'fields': campos(meta)}}]
    })
    kb = sum(len(x) for x in paginas) // 1024
    print(f'Listo: versión {version}, {len(paginas)} páginas ({kb} KB en imágenes).')


if __name__ == '__main__':
    sys.exit(main())
