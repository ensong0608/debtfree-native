from pathlib import Path
root = Path(__file__).resolve().parents[2]
text = (root / 'design/signature-rounded-fonts-2026-11-15.html').read_text(encoding='utf-8')
for name, direction in [('nunito','signature'),('quicksand','ledger'),('rubik','studio')]:
    for page in ['home','accounts','strategy']:
        variant = text.replace("let direction='signature'; let page='home';", f"let direction='{direction}'; let page='{page}';")
        (Path(__file__).parent / f'{name}-{page}.html').write_text(variant, encoding='utf-8')
print('Prepared nine font/page views.')
