from pathlib import Path
root = Path(__file__).resolve().parents[2]
text = (root / 'design/signature-green-ubuntu-2026-11-15.html').read_text(encoding='utf-8')
for name, direction in [('contour', 'signature'), ('facet', 'ledger'), ('silk', 'studio')]:
    for page in ['accounts', 'strategy']:
        variant = text.replace("let direction='signature'; let page='home';", f"let direction='{direction}'; let page='{page}';")
        (Path(__file__).parent / f'{name}-{page}.html').write_text(variant, encoding='utf-8')
print('Prepared six page previews; embedded Ubuntu present:', text.count('@font-face') == 3)
