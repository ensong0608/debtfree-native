from pathlib import Path
import re
import urllib.request
import urllib.parse
import base64
import json

ROOT = Path(__file__).resolve().parents[2]
study = ROOT / 'design/signature-rounded-fonts-2026-11-15.html'
source = study.read_text(encoding='utf-8')
source = re.sub(r'@font-face\{[^}]+\}', '', source)
source = re.sub(r'<!-- Ubuntu Font Licence 1.0.*?-->', '', source, flags=re.S)
faces = []
licenses = []
for family in ['Nunito', 'Quicksand', 'Rubik']:
    folder = ROOT / 'design/assets/fonts' / family.lower()
    folder.mkdir(parents=True, exist_ok=True)
    css_url = 'https://fonts.googleapis.com/css2?family=' + urllib.parse.quote(family) + ':wght@400;500;700&display=swap'
    css = urllib.request.urlopen(urllib.request.Request(css_url, headers={'User-Agent': 'Mozilla/5.0'})).read().decode()
    for block in re.findall(r'@font-face\s*\{[^}]+\}', css):
        weight = re.search(r'font-weight:\s*([^;]+)', block)[1]
        url = re.search(r'url\(([^)]+)\)', block)[1]
        raw = urllib.request.urlopen(url).read()
        suffix = '.woff2' if '.woff2' in url else '.ttf'
        (folder / (family + '-' + weight.replace(' ', '-') + suffix)).write_bytes(raw)
        encoded = base64.b64encode(raw).decode()
        mime, fmt = ('font/woff2', 'woff2') if suffix == '.woff2' else ('font/ttf', 'truetype')
        faces.append(f"@font-face{{font-family:'{family}';font-style:normal;font-weight:{weight};font-display:swap;src:url(data:{mime};base64,{encoded}) format('{fmt}');}}")
    license_url = f'https://raw.githubusercontent.com/google/fonts/main/ofl/{family.lower()}/OFL.txt'
    license_text = urllib.request.urlopen(license_url).read().decode()
    (folder / 'OFL.txt').write_text(license_text, encoding='utf-8')
    licenses.append(f'<!-- {family}: SIL Open Font License 1.1\n{license_text}\n-->')
source = source.replace('<style>', '<style>' + ''.join(faces), 1)
source = source.replace('<body>', '<body>' + ''.join(licenses), 1)
source = source.replace('>Contour</button>', '>Nunito</button>').replace('>Facet</button>', '>Quicksand</button>').replace('>Silk</button>', '>Rubik</button>')
source = source.replace("phone.className='phone signature treatment-'+direction;", "phone.className='phone signature treatment-signature font-'+direction;")
source = source.replace('Green Signature treatment', 'Rounded font comparison')
study.write_text(source, encoding='utf-8')
manifest_path = ROOT / 'design/gallery-manifest.json'
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
for collection in manifest['collections']:
    if collection.get('latest'):
        collection['latest'] = False
        collection['title'] = collection['title'].replace('Latest · ', '')
manifest['collections'].insert(0, {
    'title': 'Latest · soft green / rounded fonts',
    'file': study.name,
    'variants': {'Nunito': 'signature', 'Quicksand': 'ledger', 'Rubik': 'studio'},
    'pages': ['Home', 'Accounts', 'Strategy'],
    'selector': 'data-design', 'pageSelector': 'data-screen', 'latest': True,
    'note': 'Visible swatch #416D55 is the darkest brand fill. Smaller bold headings and three rounded font alternatives. Shared Signature layout and Contour artwork keep typography comparable; Home composition and original blue + preserved.'
})
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('Embedded Nunito, Quicksand and Rubik; licenses retained; nine gallery entries registered.')
