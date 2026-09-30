"""Datei-Register paralleler Chats (genutzt von pre_tool_guard.py und post_edit_check.py).

Jeder Chat (session_id) fuehrt eine Liste der Workspace-Dateien, die er geaendert hat:
CLAIMS/<session_id>.json mit Titel (erste Nachricht des Users), PID, Start, Dateien.
Will ein Chat eine Datei aendern oder committen, die laut git uncommittete Aenderungen hat,
die von einem anderen Chat (oder unbekannter Quelle) stammen, gibt es einen Hinweis
(einmal je Datei + Quelle + Art). Ein Eintrag zaehlt nur, solange die Datei seit dieser
Aenderung nicht committet wurde (sonst stammen die offenen Aenderungen von jemand anderem).
"""
import functools
import json
import os
import subprocess
import tempfile
import time
from pathlib import Path

WS = Path(__file__).resolve().parents[2]
STAMPS = Path(tempfile.gettempdir()) / f'stele_hook_stamps_{os.getuid()}'
CLAIMS = STAMPS / 'claims'
IGNORE = set()  # Dateien ohne Register-Pruefung (z. B. Live-Config), derzeit keine
MAX_AGE = 7 * 86400   # Register aelter als das wird geloescht
ALIVE_NO_PID = 12 * 3600


def dirty_files():
    """Workspace-relative Pfade mit uncommitteten Aenderungen (inkl. neuer Dateien)."""
    r = subprocess.run(['git', 'status', '--porcelain', '-z', '-uall'], cwd=WS,
                       capture_output=True, text=True, timeout=10)
    out, entries, i = set(), r.stdout.split('\0'), 0
    while i < len(entries):
        entry = entries[i]
        i += 1
        if len(entry) > 3:
            out.add(entry[3:])
            if entry[0] in 'RC':
                i += 1  # bei Umbenennung folgt der alte Name
    return out - IGNORE


def staged_files():
    r = subprocess.run(['git', 'diff', '--cached', '--name-only', '-z'], cwd=WS,
                       capture_output=True, text=True, timeout=10)
    return {p for p in r.stdout.split('\0') if p} - IGNORE


def _title(transcript):
    """Erste echte Nachricht des Users (ohne IDE-/System-Kontext), gekuerzt."""
    try:
        with open(transcript, encoding='utf-8', errors='replace') as f:
            for line in f:
                try:
                    entry = json.loads(line)
                except ValueError:
                    continue
                if entry.get('type') != 'user' or entry.get('isMeta'):
                    continue
                content = (entry.get('message') or {}).get('content')
                if isinstance(content, list):
                    content = ' '.join(x.get('text', '') for x in content
                                       if isinstance(x, dict) and x.get('type') == 'text'
                                       and not x.get('text', '').lstrip().startswith('<'))
                if isinstance(content, str) and content.strip() \
                        and not content.lstrip().startswith('<'):
                    return ' '.join(content.split())[:80]
    except OSError:
        pass
    return '?'


def _file(sid):
    return CLAIMS / f'{sid}.json'


def _own(data):
    sid = data.get('session_id') or 'unknown'
    try:
        return sid, json.loads(_file(sid).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return sid, {'title': _title(data.get('transcript_path') or ''),
                     'pid': int(os.environ.get('CLAUDE_PID') or 0),
                     'started': time.time(), 'files': {}, 'warned': []}


def _files(claim):
    """{Datei: Zeit der letzten Aenderung}; aeltere Register hatten nur eine Liste."""
    files = claim.get('files') or {}
    if isinstance(files, list):
        files = dict.fromkeys(files, claim.get('updated', 0))
    return files


@functools.lru_cache(maxsize=None)
def _last_commit(rel):
    r = subprocess.run(['git', 'log', '-1', '--format=%ct', '--', rel], cwd=WS,
                       capture_output=True, text=True, timeout=10)
    return int(r.stdout.strip() or 0)


def _owns(claim, rel):
    """Hat der Chat die Datei nach ihrem letzten Commit geaendert?"""
    edited = _files(claim).get(rel)
    return edited is not None and edited >= _last_commit(rel)


def _save(sid, claim):
    claim['updated'] = time.time()
    CLAIMS.mkdir(parents=True, exist_ok=True)
    tmp = _file(sid).with_suffix(f'.{os.getpid()}.tmp')
    tmp.write_text(json.dumps(claim, ensure_ascii=False), encoding='utf-8')
    tmp.replace(_file(sid))


def _others(sid):
    now = time.time()
    for path in CLAIMS.glob('*.json') if CLAIMS.is_dir() else []:
        if path.stem == sid:
            continue
        try:
            claim = json.loads(path.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            continue
        if claim.get('updated', 0) < now - MAX_AGE:
            path.unlink(missing_ok=True)
            continue
        yield path.stem, claim


def _alive(claim):
    pid = claim.get('pid')
    if pid:
        return Path(f'/proc/{pid}').exists()
    return claim.get('updated', 0) > time.time() - ALIVE_NO_PID


def record(data, rels):
    """Merkt sich Dateien, die dieser Chat geaendert hat."""
    rels = {r for r in rels if r not in IGNORE}
    if not rels:
        return
    sid, claim = _own(data)
    now = time.time()
    claim['files'] = {**_files(claim), **dict.fromkeys(rels, now)}
    _save(sid, claim)


def conflicts(data, rels, dirty, committing=False):
    """Hinweise fuer uncommittete Dateien in rels, die nicht (nur) von diesem Chat stammen."""
    rels = [r for r in dict.fromkeys(rels) if r in dirty]
    if not rels:
        return []
    sid, claim = _own(data)
    warned, warns = set(claim['warned']), []
    peers = list(_others(sid))
    todo = ('→ nur eigene Aenderungen stagen oder den Chat per SendMessage fragen (Skill commit)'
            if committing else
            '→ ListAgents, Chat per SendMessage abstimmen; gleiche Datei: Scratchpad + '
            '3-Wege-Merge (Memory parallel-chats-merge), nichts ueberschreiben')
    for rel in rels:
        owners = [(s, c) for s, c in peers if _owns(c, rel)]
        if not owners and not _owns(claim, rel):
            owners = [('?', None)]
        for s, c in owners:
            key = f'{rel}|{s}|{int(committing)}'
            if key in warned:
                continue
            warned.add(key)
            if c is None:
                who = 'unbekannter Quelle (User, aelterer Chat oder vor dem Datei-Register)'
            else:
                who = (f'Chat „{c.get("title", "?")}“ '
                       f'({"laeuft" if _alive(c) else "beendet"}, Start '
                       f'{time.strftime("%H:%M", time.localtime(c.get("started", 0)))}, zuletzt '
                       f'{time.strftime("%H:%M", time.localtime(c.get("updated", 0)))})')
            warns.append(f'{rel}: uncommittete Aenderungen von {who} {todo}.')
    if warns:
        claim['warned'] = sorted(warned)
        _save(sid, claim)
    return warns
