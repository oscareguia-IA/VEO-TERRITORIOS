#!/usr/bin/env python3
"""Regenera public/assets/corredores-trazos.json desde OpenStreetMap (Overpass).

Sólo dibuja el corredor principal, no calles pequeñas que comparten el nombre:
  1. La vía debe llamarse como el corredor (mismos alias que geoverificacion.js).
  2. Debe ser vía principal en OSM: motorway, trunk, primary, secondary o tertiary
     (y sus enlaces). Se descartan residential, service, unclassified, etc.
  3. De los tramos conectados que quedan, se conserva el más largo y cualquier otro
     de al menos MIN_TRAMO_M; los fragmentos sueltos más cortos se descartan.

Uso:  python3 scripts/trazos_corredores.py            (descarga de Overpass)
      python3 scripts/trazos_corredores.py --cache DIR (usa DIR/<id>.json ya descargados)
"""
import json, math, re, sys, time, urllib.parse, urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'public/assets/corredores-trazos.json'
SRC = (ROOT / 'public/assets/trazados.js').read_text(encoding='utf-8')
GEO = (ROOT / 'public/assets/geoverificacion.js').read_text(encoding='utf-8')

PRINCIPALES = {'motorway', 'trunk', 'primary', 'secondary', 'tertiary',
               'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link'}
# Municipios donde el corredor NO debe entrar (relación OSM). Garza Sada sigue por la
# Carretera Nacional hasta el Puente El Barro, que es el límite con Santiago.
EXCLUIR_MUNICIPIO = {2: ('Santiago, N.L.', 5606346)}
MIN_TRAMO_M = 1500   # tramo desconectado más corto que esto = calle homónima, se descarta
UNION_M = 60         # extremos a menos de esto se consideran el mismo tramo
NOMBRES = ['name', 'name:es', 'official_name', 'alt_name', 'short_name', 'loc_name']

# Cajas y patrones de búsqueda: los mismos de trazados.js
BOX = {int(k): [float(x) for x in v.split(',')] for k, v in re.findall(r'(\d+):\[([-\d.,]+)\]', SRC.split('const P=')[0])}
PAT = {int(k): v for k, v in re.findall(r"(\d+):'([^']+)'", SRC.split('const P=')[1].split(';')[0])}
# Alias de nombre: los mismos de geoverificacion.js
ALIAS_SRC = GEO.split('const aliases=')[1].split('};')[0]
ALIAS = {int(k): re.findall(r"'([^']+)'", v) for k, v in re.findall(r'(\d+):\[([^\]]*)\]', ALIAS_SRC)}


def fold(s):
    import unicodedata
    s = unicodedata.normalize('NFKD', str(s or ''))
    s = ''.join(c for c in s if not unicodedata.combining(c)).lower()
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9]+', ' ', s)).strip()


def dist(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))


def largo(linea):
    return sum(dist(linea[i], linea[i + 1]) for i in range(len(linea) - 1))


def tramos(lineas):
    """Agrupa líneas conectadas (un extremo cerca de cualquier punto de la otra)."""
    padre = list(range(len(lineas)))

    def raiz(x):
        while padre[x] != x:
            padre[x] = padre[padre[x]]
            x = padre[x]
        return x
    for i, a in enumerate(lineas):
        for j in range(i + 1, len(lineas)):
            if raiz(i) == raiz(j):
                continue
            b = lineas[j]
            if any(dist(e, p) <= UNION_M for e in (a[0], a[-1]) for p in b) or \
               any(dist(e, p) <= UNION_M for e in (b[0], b[-1]) for p in a):
                padre[raiz(i)] = raiz(j)
    grupos = {}
    for i in range(len(lineas)):
        grupos.setdefault(raiz(i), []).append(i)
    return sorted(grupos.values(), key=lambda g: -sum(largo(lineas[k]) for k in g))


def descargar(cid):
    q = f'[out:json][timeout:90];way["highway"]["name"~"{PAT[cid]}",i]({",".join(map(str, BOX[cid]))});out tags geom;'
    servidores = ('https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter',
                  'https://maps.mail.ru/osm/tools/overpass/api/interpreter')
    for intento in range(3):  # Overpass público se satura: reintentar con pausa creciente
        if intento:
            time.sleep(30 * intento)
        for base in servidores:
            r = _pedir(base, q, cid)
            if r is not None:
                return r
    raise SystemExit(f'No se pudo descargar el corredor {cid}')


def _pedir(base, q, cid):
    try:
        req = urllib.request.Request(base, data=urllib.parse.urlencode({'data': q}).encode(),
                                     headers={'User-Agent': 'veo-territorios-trazos/1.0'})
        return json.load(urllib.request.urlopen(req, timeout=180))
    except Exception as e:  # noqa: BLE001
        print(f'  corredor {cid}: {base} falló ({e})', file=sys.stderr, flush=True)
        time.sleep(3)
        return None


def poligono_municipio(rel_id, cache):
    f = cache / f'municipio_{rel_id}.json' if cache else None
    if f and f.exists():
        gj = json.loads(f.read_text())
    else:
        url = f'https://nominatim.openstreetmap.org/lookup?format=json&polygon_geojson=1&osm_ids=R{rel_id}'
        req = urllib.request.Request(url, headers={'User-Agent': 'veo-territorios-trazos/1.0'})
        gj = json.load(urllib.request.urlopen(req, timeout=60))[0]['geojson']
        if f:
            f.write_text(json.dumps(gj))
    polys = gj['coordinates'] if gj['type'] == 'MultiPolygon' else [gj['coordinates']]
    return [[(lat, lon) for lon, lat in poly[0]] for poly in polys]  # sólo anillo exterior


def dentro(p, polys):
    lat, lon = p
    for anillo in polys:
        c = False
        for (y1, x1), (y2, x2) in zip(anillo, anillo[1:] + anillo[:1]):
            if (y1 > lat) != (y2 > lat) and lon < (x2 - x1) * (lat - y1) / (y2 - y1) + x1:
                c = not c
        if c:
            return True
    return False


def recortar(lineas, polys):
    """Quita los puntos dentro del municipio excluido, partiendo las líneas donde cruzan."""
    out = []
    for l in lineas:
        actual = []
        for p in l:
            if dentro(p, polys):
                if len(actual) > 1:
                    out.append(actual)
                actual = []
            else:
                actual.append(p)
        if len(actual) > 1:
            out.append(actual)
    return out


def procesar(cid, data, cache=None):
    alias = [fold(a) for a in ALIAS[cid]]
    lineas = []
    for w in data.get('elements', []):
        tags = w.get('tags', {})
        if w.get('type') != 'way' or len(w.get('geometry') or []) < 2:
            continue
        if tags.get('highway') not in PRINCIPALES:
            continue
        if not any(a in fold(tags.get(k)) for k in NOMBRES for a in alias if tags.get(k)):
            continue
        lineas.append([[round(p['lat'], 5), round(p['lon'], 5)] for p in w['geometry']])
    if cid in EXCLUIR_MUNICIPIO:
        lineas = recortar(lineas, poligono_municipio(EXCLUIR_MUNICIPIO[cid][1], cache))
    if not lineas:
        return [], []
    grupos = tramos(lineas)
    largos = [sum(largo(lineas[k]) for k in g) for g in grupos]
    quedan = [g for i, g in enumerate(grupos) if i == 0 or largos[i] >= MIN_TRAMO_M]
    return [lineas[k] for g in quedan for k in g], [round(x) for x in largos]


def main():
    cache = Path(sys.argv[sys.argv.index('--cache') + 1]) if '--cache' in sys.argv else None
    salida = {'generated': datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
              'source': '© OpenStreetMap contributors (ODbL)', 'corridors': {}}
    for cid in sorted(BOX):
        f = cache / f'{cid}.json' if cache else None
        if f and f.exists():
            data = json.loads(f.read_text())
        else:
            data = descargar(cid)
            if cache:
                f.write_text(json.dumps(data))
        lineas, largos = procesar(cid, data, cache)
        if not lineas:
            raise SystemExit(f'Corredor {cid}: sin vías principales; revisa alias o clases')
        salida['corridors'][str(cid)] = lineas
        print(f'{cid:>2}: {len(lineas):>3} líneas · tramos (m) {largos[:6]} → se conservan {sum(1 for i, x in enumerate(largos) if i == 0 or x >= MIN_TRAMO_M)}')
    OUT.write_text(json.dumps(salida, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print('Escrito', OUT.relative_to(ROOT))


if __name__ == '__main__':
    main()
