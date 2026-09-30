---
name: preview
description: Vorschau-Webseiten für UI-Änderungen, Umbauten und Entscheidungen im Stele CMS mit dem Template in .claude/skills/preview (shots.json → capture.py → spec.json → build.py → Artifact mit Kommentaren). Nutzen bei "Vorschau", "Mockup", "zeig mir vorher", vor jedem größeren UI-Umbau (Layout, Farbkonzept) und bei Entscheidungen mit mehreren Varianten.
---

# Vorschau bauen

Größere UI-Umbauten (Layout, Farbkonzept, neue Leisten) erst als Vorschau zeigen und abnehmen lassen, dann Code.

## Ablauf
1. Details (Spec-Felder, Section-Typen) in `.claude/skills/preview/README.md` – nur bei Bedarf lesen.
2. Ausgabe nur im Scratchpad:
   ```bash
   S=<scratchpad>/vorschau; mkdir -p $S
   cp .claude/skills/preview/example/{spec,shots}.json $S/
   .venv/bin/python .claude/skills/preview/capture.py $S/shots.json --out $S/shots   # isoliert, Port 18096
   .venv/bin/python .claude/skills/preview/build.py   $S/spec.json --img-dir $S/shots --out $S/site
   ```
   - Vorher/Nachher ohne Codeänderung: gleicher Shot zweimal, einmal mit `css` (geplante Änderung vorab eingespielt).
3. `$S/site/index.html` als Artifact veröffentlichen: `files` = Map aus `build.py` (`img/*`), **`capabilities: {"comments": {}}`**. Update = gleicher Pfad (Capabilities dann weglassen). Link in der Antwort ganz unten nach dem letzten Inhaltsblock als `🖼️ Vorschau: <URL>` (Skill `answer-page`). Nicht selbst öffnen, nicht nachfragen.
4. Rückmeldungen kommen als Artifact-Kommentar → im Thread antworten, umsetzen, gleiche Datei neu veröffentlichen.

## Inhalt
- Nur Stichpunkte (`intro` und Section-`text` sind Listen), kurz, Inhalt statt Erklärung.
- **Nicht beschreiben, wie die Seite bedient wird.**
- Übersicht: `glance`-Karten, `changes` mit Status-Badges, `options` mit „Empfohlen“, `compare` für Vorher/Nachher, `questions` am Ende.
- Das Vorschau-Template darf CDN-Schriften/Icons nutzen (Artifact, nicht Teil des Produkts); das Stele CMS selbst nie.
- Verbesserungen am Template direkt in `.claude/skills/preview/` einpflegen (wird mit committet), keine Einmal-Kopien.
