from pathlib import Path
import re
import urllib.request
import sys
sys.stdout.reconfigure(encoding='utf-8')
root = Path(__file__).resolve().parents[2]
text = (root / 'design/signature-rounded-fonts-2026-11-15.html').read_text(encoding='utf-8')
text = re.sub(r'@font-face\{[^}]+\}', '', text)
text = re.sub(r'<!--.*?-->', '', text, flags=re.S)
faces = []
for name in ['Nunito','Quicksand','Rubik']:
    url = 'https://fonts.googleapis.com/css2?family='+name+':wght@400;500;700&display=swap'
    faces.append(urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'})).read().decode())
text = text.replace('<style>', '<style>'+''.join(faces),1)
print(text)
