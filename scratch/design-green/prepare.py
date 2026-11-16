from pathlib import Path
import base64
import json

root = Path(__file__).resolve().parents[2]
study = root / 'design/signature-green-ubuntu-2026-11-15.html'
source = study.read_text(encoding='utf-8')
rules = ''
for name, weight in [('Regular', 400), ('Medium', 500), ('Bold', 700)]:
    font = root / f'design/assets/fonts/ubuntu/Ubuntu-{name}.ttf'
    encoded = base64.b64encode(font.read_bytes()).decode()
    rules += f"@font-face{{font-family:Ubuntu;font-style:normal;font-weight:{weight};font-display:swap;src:url(data:font/ttf;base64,{encoded}) format('truetype');}}"
source = source.replace('<style>', '<style>' + rules, 1)
license_text = (root / 'design/assets/fonts/ubuntu/UFL.txt').read_text(encoding='utf-8')
source = source.replace('<body>', '<body><!-- Ubuntu Font Licence 1.0\n' + license_text + '\n-->', 1)
image = 'C:/Users/lawre/.t3/userdata/attachments/049903aa-e87d-460e-a2e3-8b0a9877939a-275c08c7-e144-4ae3-ba72-dbaa8b2ec359.jpg'
nav = '<div class="ubuntu-nav">'
for label in ['Home', 'Accounts', 'Transactions', 'Budget', 'Progress']:
    nav += f'<div class="nav-item"><span class="nav-symbol"><img src="{image}" alt=""></span><span>{label}</span></div>'
nav += '</div>'
anchor = 'alt="Existing five-tab navigation with Home selected"></div>'
assert anchor in source
source = source.replace(anchor, 'alt="Existing five-tab navigation with Home selected">' + nav + '</div>', 1)
study.write_text(source, encoding='utf-8')
manifest_path = root / 'design/gallery-manifest.json'
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
collection = {
    'title': 'Latest · Signature green / Ubuntu',
    'file': study.name,
    'variants': {'Contour': 'signature', 'Facet': 'ledger', 'Silk': 'studio'},
    'pages': ['Home', 'Accounts', 'Strategy'],
    'selector': 'data-design', 'pageSelector': 'data-screen', 'latest': True,
    'note': 'Owner-supplied green palette and Ubuntu. Home composition is shared; Accounts and Strategy have distinct background art and equal summary heights. Header separators removed. Original blue + retained.'
}
manifest['collections'].insert(0, collection)
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('Prepared three treatments, nine screens, embedded Ubuntu; added gallery collection.')
