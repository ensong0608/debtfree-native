import urllib.request
import re
import sys
sys.stdout.reconfigure(encoding='utf-8')
url='https://uphold.design/'
page=urllib.request.urlopen(url).read().decode()
styles=re.findall(r'<link[^>]+href=["\']([^"\']+\.css[^"\']*)',page)
for css_url in styles:
    css=urllib.request.urlopen(css_url).read().decode()
    faces=re.findall(r'@font-face\s*\{[^}]+\}',css)
    for face in faces:
        if 'roxima' in face:
            print(face)
