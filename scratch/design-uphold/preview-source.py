from pathlib import Path
import re, urllib.request, sys
sys.stdout.reconfigure(encoding='utf-8')
root=Path(__file__).resolve().parents[2]
source=(root/'design/signature-uphold-inspired-2026-11-15.html').read_text(encoding='utf-8')
source=re.sub(r'@font-face\{[^}]+\}','',source)
source=re.sub(r'<!--.*?-->','',source,flags=re.S)
css=urllib.request.urlopen(urllib.request.Request('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;700&display=swap',headers={'User-Agent':'Mozilla/5.0'})).read().decode()
print(source.replace('<style>','<style>'+css,1))
