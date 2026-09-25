"""Bundle the app into one HTML file running in demo mode, handy for showing it around without hosting.
usage: python3 tools/bundle_demo.py out.html"""
import re, sys, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
html = (root / 'index.html').read_text(encoding='utf-8')
html = re.sub(r'<link rel="stylesheet" href="(css/[^"]+)">', lambda m: '<style>\n' + (root / m.group(1)).read_text(encoding='utf-8') + '</style>', html)
def script(m):
    if m.group(1) == 'js/config.js':
        return "<script>window.KILLER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };</script>"
    return '<script>\n' + (root / m.group(1)).read_text(encoding='utf-8') + '</script>'
html = re.sub(r'<script src="(js/[^"]+)"></script>', script, html)
pathlib.Path(sys.argv[1]).write_text(html, encoding='utf-8')
print(sys.argv[1], len(html) // 1024, 'kB')
