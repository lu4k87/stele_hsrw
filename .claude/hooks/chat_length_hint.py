#!/usr/bin/env python3
"""UserPromptSubmit-Hook: erinnert an einen neuen Chat, wenn der Kontext groß wird.

Liest die Token-Nutzung der letzten Antwort aus dem Transkript (Hauptchat, keine
Subagenten) und gibt ab HINT_TOKENS einen Hinweis als Zusatzkontext aus. Claude
fragt dann im Block `⏭️ Offen`, ob ein neuer Chat sinnvoll ist (AGENTS.md §4).
Ab STRONG_TOKENS sieht auch der User direkt eine Meldung.
"""
import json
import os
import sys

HINT_TOKENS = int(os.environ.get('CHAT_HINT_TOKENS', 150_000))
STRONG_TOKENS = int(os.environ.get('CHAT_STRONG_TOKENS', 250_000))
TAIL_BYTES = 4 * 1024 * 1024


def context_tokens(path):
    """Kontextgröße der letzten Hauptchat-Antwort (Eingabe inkl. Cache) oder 0."""
    try:
        with open(path, 'rb') as f:
            f.seek(0, os.SEEK_END)
            f.seek(max(0, f.tell() - TAIL_BYTES))
            lines = f.read().splitlines()
    except OSError:
        return 0
    for raw in reversed(lines):
        try:
            entry = json.loads(raw)
        except ValueError:
            continue
        if entry.get('type') != 'assistant' or entry.get('isSidechain'):
            continue
        usage = (entry.get('message') or {}).get('usage') or {}
        total = sum(usage.get(k) or 0 for k in (
            'input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'))
        if total:
            return total
    return 0


def main():
    try:
        data = json.load(sys.stdin)
    except ValueError:
        return
    tokens = context_tokens(data.get('transcript_path') or '')
    if tokens < HINT_TOKENS:
        return
    k = tokens // 1000
    context = (f'Chat-Länge: Kontext ~{k}k Token (Schwelle {HINT_TOKENS // 1000}k). '
               'Prüfen, ob ein neuer Chat sinnvoll ist (anderes Thema, abgeschlossene Aufgabe, '
               'viel Ballast). Wenn ja: im Block `⏭️ Offen` fragen und Titel-Präfix vorschlagen '
               '(AGENTS.md §4); nicht selbst wechseln.')
    out = {'hookSpecificOutput': {'hookEventName': 'UserPromptSubmit',
                                  'additionalContext': context}}
    if tokens >= STRONG_TOKENS:
        out['systemMessage'] = (f'💬 Chat ist lang (~{k}k Token Kontext) – '
                                'für eine neue Aufgabe besser einen neuen Chat starten.')
    print(json.dumps(out, ensure_ascii=False))


if __name__ == '__main__':
    main()
