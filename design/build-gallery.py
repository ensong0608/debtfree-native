"""Rebuild the portable gallery. Uses only Python's standard library."""
import argparse
import base64
import hashlib
import html
import json
import mimetypes
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
manifest = json.loads((ROOT / 'gallery-manifest.json').read_text(encoding='utf-8'))
assets, documents, entries, collections_out, missing = {}, {}, [], [], set()

parser = argparse.ArgumentParser(description='Build portable BitLess design gallery (design/index.html).')
parser.add_argument('--include-archive', action='store_true', help='Also embed pre-2026-11-17 studies and historical boards.')
args = parser.parse_args()


def embed_reference(value, source):
    if value.startswith(('data:', 'http:', 'https:', '#', 'blob:', 'javascript:')):
        return value
    candidate = Path(value.removeprefix('file:///'))
    if not candidate.is_absolute():
        candidate = source.parent / candidate
    if candidate.suffix.lower() not in {'.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'}:
        return value
    if not candidate.is_file():
        missing.add(str(candidate))
        return value
    raw = candidate.read_bytes()
    key = 'gallery-asset-' + hashlib.sha256(raw).hexdigest()[:18]
    if key not in assets:
        mime = mimetypes.guess_type(candidate.name)[0] or 'application/octet-stream'
        assets[key] = 'data:' + mime + ';base64,' + base64.b64encode(raw).decode('ascii')
    return key


def document(path):
    key = path.relative_to(ROOT).as_posix()
    if key in documents:
        return key
    text = path.read_text(encoding='utf-8-sig')
    text = re.sub(r'(?i)(\bsrc\s*=\s*)([\"\'])(.*?)(\2)',
                  lambda m: m[1] + m[2] + embed_reference(m[3], path) + m[4], text)
    text = re.sub(r'url\(\s*([\"\']?)([^)\"\']+)\1\s*\)',
                  lambda m: 'url(' + m[1] + embed_reference(m[2], path) + m[1] + ')', text)
    documents[key] = text
    return key


for collection in manifest['collections']:
    if not args.include_archive and not collection.get('includeInIndex', True):
        continue
    key = document(ROOT / collection['file'])
    col_id = collection.get('id') or ('col-' + hashlib.sha256(key.encode()).hexdigest()[:10])
    variants_list = [{'name': name, 'value': value} for name, value in collection['variants'].items()]
    collections_out.append({
        'id': col_id,
        'title': collection['title'],
        'shortTitle': collection.get('shortTitle', collection['title']),
        'badge': collection.get('badge', ''),
        'date': collection.get('date', ''),
        'file': key,
        'palette': collection.get('palette', []),
        'variants': variants_list,
        'pages': collection['pages'],
        'selector': collection['selector'],
        'pageSelector': collection.get('pageSelector'),
        'note': collection.get('note', ''),
        'latest': collection.get('latest', False),
        'archive': not collection.get('includeInIndex', True),
    })
    for name, value in collection['variants'].items():
        for page in collection['pages']:
            entries.append({
                'id': 'view-' + hashlib.sha256((key + '|' + value + '|' + page).encode()).hexdigest()[:12],
                'collectionId': col_id,
                'title': name,
                'page': page,
                'group': collection['title'],
                'file': key,
                'variant': value,
                'selector': collection['selector'],
                'pageSelector': collection.get('pageSelector'),
                'note': collection.get('note', ''),
                'latest': collection.get('latest', key.startswith('bitless-three-page')),
                'archive': not collection.get('includeInIndex', True)
            })

if args.include_archive:
    excluded = {'index.html', 'gallery-shell.html'} | set(documents)
    for path in sorted(ROOT.rglob('*.html')):
        key = path.relative_to(ROOT).as_posix()
        if key in excluded:
            continue
        document(path)
        title_match = re.search(r'<title[^>]*>(.*?)</title>', documents[key], re.I | re.S)
        title = html.unescape(title_match[1].strip()) if title_match else path.stem.replace('-', ' ').title()
        reference = key.startswith('approved-reference-pages/')
        col_id = 'col-' + hashlib.sha256(key.encode()).hexdigest()[:10]
        page_lbl = 'Reference' if reference else 'Board'
        collections_out.append({
            'id': col_id,
            'title': title,
            'shortTitle': title,
            'badge': page_lbl,
            'date': '',
            'file': key,
            'palette': [],
            'variants': [{'name': title, 'value': ''}],
            'pages': [page_lbl],
            'selector': '',
            'pageSelector': None,
            'note': 'Original historical study. Its internal controls remain available; current owner preferences supersede older concepts.',
            'latest': False,
            'archive': True,
        })
        entries.append({
            'id': 'view-' + hashlib.sha256(key.encode()).hexdigest()[:12],
            'collectionId': col_id,
            'title': title,
            'page': page_lbl,
            'group': 'Saved reference screens' if reference else 'Earlier design boards',
            'file': key,
            'note': 'Original historical study. Its internal controls remain available; current owner preferences supersede older concepts.',
            'archive': True,
            'latest': False
        })

payload = json.dumps({'collections': collections_out, 'entries': entries, 'documents': documents, 'assets': assets}, ensure_ascii=False)
payload = payload.replace('<', '\\u003c').replace('\u2028', '\\u2028').replace('\u2029', '\\u2029')
shell = (ROOT / 'gallery-shell.html').read_text(encoding='utf-8')
if shell.count('__GALLERY_DATA__') != 1:
    raise ValueError('Gallery template must contain exactly one data marker')
output = ROOT / 'index.html'
output.write_text(shell.replace('__GALLERY_DATA__', payload), encoding='utf-8')
report = {'studies': len(documents), 'collections': len(collections_out), 'views': len(entries),
          'embedded_assets': len(assets), 'bytes': output.stat().st_size, 'missing_assets': sorted(missing)}
(ROOT / 'gallery-build-report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report))
