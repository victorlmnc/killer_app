"""Assemble l'app en un seul fichier HTML (mode démo), pratique pour la montrer sans rien héberger.
usage : python3 tools/build_demo.py sortie.html"""
import re, sys, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
html = (root / 'index.html').read_text(encoding='utf-8')
html = re.sub(r'<link rel="stylesheet" href="(css/[^"]+)">', lambda m: '<style>\n' + (root / m.group(1)).read_text(encoding='utf-8') + '</style>', html)
def script(m):
    if m.group(1) == 'js/config.js':
        return "<script>window.KILLER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };</script>"
    return '<script>\n' + (root / m.group(1)).read_text(encoding='utf-8') + '</script>'
html = re.sub(r'<script src="(js/[^"]+)"></script>', script, html)
html = html.replace('<title>QG Killer</title>', '<title>QG Killer (démo)</title>')
pathlib.Path(sys.argv[1]).write_text(html, encoding='utf-8')
print(sys.argv[1], len(html) // 1024, 'Ko')
