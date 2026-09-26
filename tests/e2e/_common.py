"""Shared helpers for the browser tests."""
import os, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[2]
URL = 'file://' + str(ROOT / 'index.html')

def context(browser, **kw):
    ctx = browser.new_context(**kw)
    ctx.route('**/fonts.g*/**', lambda r: r.abort())          # no network in CI
    ctx.route('**/js/config.js', lambda r: r.fulfill(body="window.KILLER_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };", content_type='text/javascript'))   # demo mode
    return ctx

def collect_errors(page, errors):
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'net::' not in m.text and '403' not in m.text else None)
