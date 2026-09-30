---
name: commit
description: Git-Commits im Stele CMS im Stil des Repos (Conventional Commits auf Deutsch). Nutzen, wenn der User "commit", "committen" oder "einchecken" sagt, und am Ende jeder fertigen, geprüften Aufgabe (Commit + Push ohne Nachfrage, AGENTS.md §4).
---

# Commit im Stele CMS

0. Parallele Chats prüfen: `ListAgents` + `git status --short`. Fremde Änderungen gibt es oft → mit `git commit -- <pfade>` nur die eigenen Pfade committen. Hook-Hinweis „uncommittete Änderungen von Chat …“ beim `git add`/`git commit` → Datei enthält fremde Zeilen: nur eigene Hunks stagen (Patch aus eigenem Diff + `git apply --cached`) oder den Chat fragen.
1. `git status --short` und `git diff --stat` ansehen (nicht den vollen Diff, außer für die Beschreibung nötig – dann pro Datei gezielt).
2. Nach Thema aufteilen, ein Thema pro Commit:
   - `feat|fix|style|refactor(admin)`: `web/admin/`
   - `feat|fix(player)`: `web/player/`
   - `feat|fix|test(server)`: `server/` (Migrationen immer als neue Datei)
   - `feat|fix(agent)`: `stele_agent/`
   - `docs(readme)`: README, SPEC, `docs/img`, `docs/screenshots.py`
   - `chore(git)`: `.githooks/`, `.gitignore`, `.gitattributes`; `chore(agent)`: `AGENTS.md`, `.claude/`
3. Nachricht:
   - Betreff auf Deutsch, `typ(bereich): Beschreibung`, sagt, was sich ändert (≤ 72 Zeichen).
   - Body: kurze Stichpunkte, **alle** Änderungen (was + wo, bei Bedarf kurz warum), keine Füllsätze, keine Wiederholung des Betreffs.
   - Schluss mit der Attribution aus dem System-Hinweis (`Co-Authored-By: …`).
   - Vorher `git diff --cached --stat` gegen die Nachricht prüfen: vollständig, nichts Fremdes.
4. Nur gezielt stagen (`git add <dateien>`), nie `git add -A`/`.`. Nie `data/`, `.venv/`, `*.db`, `secret_key`, Scratchpad-Dateien.
5. Zeitpunkt und Peers (selbst entscheiden, nicht auf den User warten):
   - Nur fertige, geprüfte Stände (Definition of Done grün); nichts Halbfertiges.
   - Fremde uncommittete Änderungen in derselben Datei: den Peer per `SendMessage` fragen – mit seinem OK mitcommitten (im Body nennen) oder ihm die Datei überlassen.
   - Kein `stash`, `reset`, `checkout`, `rebase` oder `pull` mit Umbau des Arbeitsbaums, solange andere Chats laufen.
6. Pushen: `git push` (nur Fast-Forward, nie `--force`, nie `--no-verify` ohne Auftrag). Bei Ablehnung (Remote neuer) nicht selbst mergen, sondern melden. Der Pre-commit-Hook (`.githooks/pre-commit`) führt bei `server/`-Änderungen die Tests aus.
7. Stand am Ende der Antwort in der Spalte `📦 Push` der Status-Tabelle melden (Skill `answer-page`): `` `<Hash>` `` = gepusht, `` `<Hash>` (+2) `` bei mehreren Commits, `nicht committet` (Grund + welcher Chat übernimmt → Block `⚠️ HINWEISE`), `` `<Hash>` ❌ nicht gepusht ``.
