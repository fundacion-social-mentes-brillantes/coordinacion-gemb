"""Saca de lo público del calendario quién lo cambió (17 oct 2026).

Antes, programacion/config y cada programacion_dias/{día} guardaban updatedBy y
updatedByName, y esos documentos se leen sin iniciar sesión. Ahora esa firma
vive en programacion_cambios/{día o "config"}, que solo lee el equipo.

Este script, para cada documento público que todavía tenga firma:
  1. la copia a programacion_cambios (si allí no hay ya una más nueva), y
  2. la borra del documento público, en el MISMO lote (o las dos o ninguna).

Uso (desde la carpeta del proyecto, con la cuenta de servicio activa en gcloud):
  python scripts/mudar-firmas-calendario.py --proyecto coordinacion-gemb            # solo cuenta
  python scripts/mudar-firmas-calendario.py --proyecto coordinacion-gemb --aplicar  # muda

  # contra el emulador (pruebas):
  FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 python scripts/mudar-firmas-calendario.py --proyecto demo-gemb --aplicar

El token nunca se imprime.
"""

import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

CUENTA = 'clara-agente@clara-gemb.iam.gserviceaccount.com'


def token():
    if os.environ.get('FIRESTORE_EMULATOR_HOST'):
        return 'owner'  # emulador local: pruebas, nunca la base real
    r = subprocess.run(['gcloud', 'auth', 'print-access-token', f'--account={CUENTA}'],
                       capture_output=True, text=True, shell=sys.platform == 'win32')
    t = r.stdout.strip()
    if not t:
        raise SystemExit('No hay token de la cuenta de servicio en gcloud.')
    return t


def pedir(metodo, url, tok, cuerpo=None):
    datos = json.dumps(cuerpo).encode() if cuerpo is not None else None
    req = urllib.request.Request(url, data=datos, method=metodo,
                                 headers={'Authorization': f'Bearer {tok}', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise SystemExit(f'{metodo} {url.split("/documents")[-1]} → {e.code}: {e.read().decode()[:300]}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--proyecto', required=True)
    ap.add_argument('--aplicar', action='store_true')
    a = ap.parse_args()
    raiz = f'projects/{a.proyecto}/databases/(default)/documents'
    emu = os.environ.get('FIRESTORE_EMULATOR_HOST')
    api = f'http://{emu}/v1' if emu else 'https://firestore.googleapis.com/v1'
    base = f'{api}/{raiz}'
    tok = token()

    docs = []
    config = pedir('GET', f'{base}/programacion/config', tok)
    if config:
        docs.append(('config', config))
    pagina = None
    while True:
        url = f'{base}/programacion_dias?pageSize=300' + (f'&pageToken={pagina}' if pagina else '')
        r = pedir('GET', url, tok) or {}
        for d in r.get('documents', []):
            docs.append((d['name'].rsplit('/', 1)[1], d))
        pagina = r.get('nextPageToken')
        if not pagina:
            break

    con_firma = [(i, d) for i, d in docs if {'updatedBy', 'updatedByName'} & set(d.get('fields', {}))]
    print(f'Documentos públicos: {len(docs)}; con firma (quién lo cambió): {len(con_firma)}')
    if not a.aplicar:
        print('Solo se contó. Para mudar: --aplicar')
        return

    movidos = copiados = 0
    for ident, d in con_firma:
        f = d['fields']
        destino = f'{raiz}/programacion_cambios/{ident}'
        escrituras = []
        if pedir('GET', f'{api}/{destino}', tok) is None:
            firma = {k: f[k] for k in ('updatedBy', 'updatedByName', 'updatedAt') if k in f}
            escrituras.append({'update': {'name': destino, 'fields': firma},
                               'currentDocument': {'exists': False}})
            copiados += 1
        # Borrar solo esos dos campos, y solo si el documento no cambió desde que se leyó.
        escrituras.append({'update': {'name': d['name'], 'fields': {}},
                           'updateMask': {'fieldPaths': ['updatedBy', 'updatedByName']},
                           'currentDocument': {'updateTime': d['updateTime']}})
        pedir('POST', f'{base}:commit', tok, {'writes': escrituras})
        movidos += 1
    print(f'Listo: {movidos} documentos sin firma pública; {copiados} firmas copiadas a programacion_cambios.')


if __name__ == '__main__':
    main()
