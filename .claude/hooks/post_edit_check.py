#!/usr/bin/env python3
"""PostToolUse-Hook für Claude Code: schnelle Prüfung der gerade bearbeiteten Datei.

Läuft nach jedem Edit/Write (Einstellung in .claude/settings.json), braucht < 0,5 s:
  .py                     Syntax (py_compile), mit pyflakes zusätzlich undefinierte Namen
  .json                   gültig?
  web/**/*.css|js|html    kein `cursor: help`
  web/admin/css/**/*.css  keine neuen festen Farben außerhalb von tokens.css (nur Tokens, AGENTS.md §3)
  web/**/*.html           keine externen Skripte/CDNs (AGENTS.md §2)
Stilregeln nur für den neu geschriebenen Text (Zeilennummern relativ, „Z. +n“).
Fehler → Exit 2, die Meldung geht an Claude zurück; sonst still.
"""
import json
import py_compile
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SKIP = re.compile(r'^(data|\.venv)/|/__pycache__/')
HEX = re.compile(r'(?<![\w-])#[0-9a-fA-F]{3,8}\b|\brgba?\(\s*\d')
EXTERNAL = re.compile(r'<(script|link)[^>]+(src|href)=["\']https?://', re.I)


def lines(path):
    return path.read_text(encoding='utf-8', errors='replace').splitlines()


def check(rel, path, new_text):
    """new_text = neu geschriebener Text (Edit: new_string, Write: content) – Stilregeln nur dort prüfen."""
    errors = []
    new_lines = new_text.splitlines() if new_text is not None else lines(path)
    if rel.endswith('.py'):
        try:
            py_compile.compile(str(path), doraise=True)
        except py_compile.PyCompileError as e:
            errors.append(f'Syntaxfehler: {e.msg}')
        else:
            r = subprocess.run([sys.executable, '-m', 'pyflakes', rel], cwd=ROOT, capture_output=True, text=True, timeout=20)
            undefined = [ln for ln in r.stdout.splitlines() if 'undefined name' in ln]
            if undefined:
                errors.append('pyflakes:\n' + '\n'.join(undefined[:10]))
    if rel.endswith('.json'):
        try:
            json.loads(path.read_text(encoding='utf-8'))
        except ValueError as e:
            errors.append(f'Ungültiges JSON: {e}')
    if rel.startswith('web/') and rel.endswith(('.css', '.js', '.html')):
        hits = [f'  Z. +{i}: {ln.strip()}' for i, ln in enumerate(new_lines, 1) if re.search(r'cursor\s*:\s*help', ln)]
        if hits:
            errors.append('`cursor: help` ist verboten, Tooltip nur per title:\n' + '\n'.join(hits[:5]))
    if rel.startswith('web/admin/css/') and rel.endswith('.css') and not rel.endswith('tokens.css'):
        # Nur Zeilen mit festen Farben, die nicht als Rückfall in var(--x, #…) stehen
        hits = [f'  Z. +{i}: {ln.strip()}' for i, ln in enumerate(new_lines, 1)
                if HEX.search(re.sub(r'var\([^)]*\)', '', ln)) and not ln.strip().startswith(('/*', '*'))]
        if hits:
            errors.append('Feste Farben außerhalb von tokens.css (nur Variablen aus css/tokens.css, AGENTS.md §3) – '
                          'bei bewusster Ausnahme (z. B. Player-Rahmen) im Chat begründen:\n' + '\n'.join(hits[:8]))
    if rel.startswith('web/') and rel.endswith('.html'):
        hits = [f'  Z. +{i}: {ln.strip()[:120]}' for i, ln in enumerate(new_lines, 1) if EXTERNAL.search(ln)]
        if hits:
            errors.append('Externe Skripte/Stylesheets sind verboten (kein CDN, alles aus web/):\n' + '\n'.join(hits[:5]))
    return errors


def main():
    try:
        data = json.load(sys.stdin)
    except ValueError:
        return 0
    inp = data.get('tool_input') or {}
    fp = inp.get('file_path')
    if not fp:
        return 0
    path = Path(fp).resolve()
    try:
        rel = path.relative_to(ROOT).as_posix()
    except ValueError:
        return 0  # außerhalb des Repos (z. B. Scratchpad)
    if SKIP.search(rel) or not path.is_file():
        return 0
    new_text = inp.get('new_string') if 'new_string' in inp else inp.get('content')
    errors = check(rel, path, new_text)
    if errors:
        print(f'Prüfung nach Änderung an {rel}:\n' + '\n\n'.join(errors), file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())
