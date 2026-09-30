# .claude – Hilfsmittel für Claude Code

Alles, was nur für die Arbeit mit Claude Code gebraucht wird (nicht für den Betrieb des CMS).
Projektregeln für jeden Chat: `AGENTS.md` in der Wurzel.

| Ort | Zweck |
|---|---|
| `settings.json` | Leseverbote (`data/`, `.venv/`, `secret_key`) + Hook-Einträge |
| `hooks/pre_tool_guard.py` | warnt vor Bash/Edit (blockiert nie): breites pkill/killall, CMS-Start ohne eigenen Port/`STELECMS_DATA`, ändernde Anfragen an 8090, Schreiben in `data/`/`.venv/`, bestehende Migrationen, `git --force`/`--no-verify`/`add -A` |
| `hooks/post_edit_check.py` | prüft nach jedem Edit die Datei: Python-Syntax (+ pyflakes, falls installiert), JSON, `cursor: help`, feste Farben außerhalb `tokens.css`, externe Skripte in `web/` |
| `hooks/chat_length_hint.py` | vor jeder Nachricht: ab ~150k Token Kontext Hinweis an Claude (neuen Chat vorschlagen), ab ~250k zusätzlich Meldung an den User; Schwellen per `CHAT_HINT_TOKENS`/`CHAT_STRONG_TOKENS` |
| `skills/<name>/SKILL.md` | `answer-page`, `commit`, `test-isolated`, `ui-change`, `docs`, `preview` |
| `skills/answer-page/` | Antwortformat (Log-Style) für jede Chat-Antwort |
| `skills/preview/` | Vorschau-Webseiten für UI-Änderungen/Entscheidungen: `capture.py` (Screenshots isoliert), `build.py` (Spec → Seite → Artifact), `example/`, siehe `skills/preview/README.md` |

- Übernommen und angepasst aus dem Workspace `dev_ws` (ohne ROS-/Roboter-Teile, ohne `build-pkg` – das CMS hat keinen Build).
- Skripte und Templates eines Skills liegen im Ordner des Skills.
- Ausgaben (Seiten, Screenshots) nur im Scratchpad, nie hier.
- `settings.local.json` ist persönlich und nicht im Git.
