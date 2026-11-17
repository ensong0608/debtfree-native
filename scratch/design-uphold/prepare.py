from pathlib import Path
import re, urllib.request, base64, json

root = Path(__file__).resolve().parents[2]
study = root / 'design/signature-uphold-inspired-2026-11-15.html'
source = study.read_text(encoding='utf-8')
source = re.sub(r'@font-face\{[^}]+\}', '', source)
source = re.sub(r'<!-- Ubuntu Font Licence 1.0.*?-->', '', source, flags=re.S)
folder = root / 'design/assets/fonts/montserrat'
folder.mkdir(parents=True,exist_ok=True)
css = urllib.request.urlopen(urllib.request.Request('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;700&display=swap',headers={'User-Agent':'Mozilla/5.0'})).read().decode()
faces = []
for block in re.findall(r'@font-face\s*\{[^}]+\}',css):
    weight = re.search(r'font-weight:\s*([^;]+)',block)[1]
    url = re.search(r'url\(([^)]+)\)',block)[1]
    raw = urllib.request.urlopen(url).read()
    (folder / f'Montserrat-{weight}.ttf').write_bytes(raw)
    faces.append("@font-face{font-family:Montserrat;font-style:normal;font-weight:"+weight+";font-display:swap;src:url(data:font/ttf;base64,"+base64.b64encode(raw).decode()+") format('truetype');}")
license_text = urllib.request.urlopen('https://raw.githubusercontent.com/google/fonts/main/ofl/montserrat/OFL.txt').read().decode()
(folder/'OFL.txt').write_text(license_text,encoding='utf-8')
source = source.replace('<style>','<style>'+''.join(faces),1)
source = source.replace('<body>','<body><!-- Montserrat: SIL Open Font License 1.1\n'+license_text+'\n-->',1)
source = source.replace('>Contour</button>','>Fresh Light</button>').replace('>Facet</button>','>Ink &amp; Lime</button>').replace('>Silk</button>','>After Dark</button>')
source = source.replace("phone.className='phone signature treatment-'+direction;", "phone.className='phone signature uphold-'+direction;")
source = source.replace('Green Signature treatment','Uphold-inspired palette treatments')
source = source.replace('3 directions · 3 screens each','Proxima Nova unavailable · Montserrat preview stand-in')
study.write_text(source,encoding='utf-8')
manifest_path=root/'design/gallery-manifest.json'
manifest=json.loads(manifest_path.read_text(encoding='utf-8'))
for item in manifest['collections']:
    if item.get('latest'):
        item['latest']=False
        item['title']=item['title'].replace('Latest · ','')
manifest['collections'].insert(0,{
    'title':'Latest · Uphold-inspired palette', 'file':study.name,
    'variants':{'Fresh Light':'signature','Ink & Lime':'ledger','After Dark':'studio'},
    'pages':['Home','Accounts','Strategy'],'selector':'data-design','pageSelector':'data-screen','latest':True,
    'note':'Uphold official core colors #49CC68 / #84FB7F / #090D14 / white / black, with derived neutral surfaces. Proxima Nova is unavailable locally; Montserrat is the preview stand-in. BitLess identity, Signature composition and original blue + preserved. Brand reference: https://uphold.design/.'
})
manifest_path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Prepared Montserrat font embedding and registered nine new views.')
