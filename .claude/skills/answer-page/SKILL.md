---
name: answer-page
description: Antwortformat (Log-Style) für JEDE Chat-Antwort im Stele CMS – Status-Kopf, ━-Blöcke, Status-Zeile, Git-Zeile, Test-Zeile, Chat Done (AGENTS.md §1); vor dem Schreiben der finalen Nachricht laden.
---

# Antwortformat (.claude/skills/answer-page)

Gilt für **jede** Antwort. Keine Zusammenfassungsseite und keine Abschluss-Box: kein Artifact als Zusammenfassung,
kein Block `🌐 Zusammenfassung`, kein Block `📦 ABSCHLUSS`; Git-Stand steht in der Git-Zeile, Tests im Status-Kopf
und in der Test-Zeile.

## Schluss der Antwort
Nach dem letzten Inhaltsblock, in dieser Reihenfolge:
1. Gehört eine Vorschau (Skill `preview`) zur Antwort: Trennlinie `---` + `🖼️ Vorschau: <URL>`.
2. Gibt es Offenes: Trennlinie `---` + Block `### ⏭️ Offen`.
3. Bei Vorschlag „Neuer Chat?“: Trennlinie + Block `### 📄 STARTTEXT FÜR DEN NEUEN CHAT`.
4. (Leerzeile) Status-Zeile: `🏁 **AUFGABE ERLEDIGT**` nur ohne Block `⏭️ Offen`, sonst `⏳ **AUFGABE OFFEN**`.
5. (Leerzeile) Git-Zeile `📦 **Git Status:** <kurzer Text>`.
6. (Leerzeile) nur wenn getestet wurde: Test-Zeile `🧪 **Tests:** <kurzer Text>`.
7. (Leerzeile) als **allerletzte Zeile** `✅ **Chat Done**`, bei `⏳ AUFGABE OFFEN` als `✅ **Chat Done** · ⏳ Chat noch nicht fertig`.

Vor **jeder** Trennlinie eine Leerzeile (sonst wird die Zeile davor zur Überschrift). Links nie selbst öffnen,
nicht nachfragen (kein Dialog „Seite öffnen?“, kein Artifact `open`).

## Muster
Status-Kopf (nicht bei Kurzantworten) → Blöcke mit `━`-Überschrift → Schluss:
````
| ✅ Status | 🛠️ Dateien | 🧪 Tests | 📦 Commit |
|---|---|---|---|
| fertig | 2 | 151/151 | `a1b2c3d` |

---

### 🛠️ ÄNDERUNGEN ━━━━━━━━━━━━━
| 📄 Datei | Änderung |
|---|---|
| [show.css](web/admin/css/views/show.css#L12) | Abschnittsköpfe getönt |

---

### ✅ GEPRÜFT ━━━━━━━━━━━━━
- Testinstanz 18090, Headless Chrome: keine Konsolenfehler, hell + dunkel, 1920–390 px

---

### ⚠️ HINWEISE ━━━━━━━━━━━━━
- ✅ <positiv>
- <Warnung / Einschränkung / bewusst Weggelassenes>

---

### ⏭️ Offen
- ❓ <nur wenn etwas offen ist>

⏳ **AUFGABE OFFEN**   ← Block ⏭️ Offen vorhanden; nichts offen → 🏁 **AUFGABE ERLEDIGT**

📦 **Git Status:** `a1b2c3d` gepusht   ← immer

🧪 **Tests:** pytest 151/151 · UI hell + dunkel ok   ← nur wenn getestet wurde

✅ **Chat Done** · ⏳ Chat noch nicht fertig   ← nur bei AUFGABE OFFEN; sonst nur ✅ **Chat Done**
````
- **Git-Zeile** (immer, auch bei Kurzantworten): `📦 **Git Status:**` + max. ~6 Wörter, z. B. `` `a1b2c3d` gepusht `` · `nicht committet – <Grund>` · `nichts geändert` · `❌ Push fehlgeschlagen`.
- **Test-Zeile** (nur wenn etwas getestet/geprüft wurde): `🧪 **Tests:**` + was lief und Ergebnis, z. B. `pytest 151/151` · `Headless Chrome hell + dunkel ok` · `❌ pytest 2 Fehler`.
- Kein Build-Schritt im Projekt → keine Build-Zeile; bei Web-Änderungen im Block `⚠️ HINWEISE` auf Browser-Reload (Strg+Shift+R) hinweisen.
- Nicht committet: Grund als Stichpunkt im Block `⚠️ HINWEISE`.

## Stilregeln
- **Status-Kopf** ganz oben (nicht bei Kurzantworten): eine Tabellenzeile `| ✅ Status | 🛠️ Dateien | 🧪 Tests | 📦 Commit |`, Werte knapp (`fertig`/`Vorschlag`/`❌ blockiert` · Anzahl · `151/151`/`–` · Hash/`–`), danach `---`.
- **Blöcke:** Überschrift = Icon + Titel in GROSSBUCHSTABEN + Linie `━` (`🔍 ANALYSE`, `🛠️ ÄNDERUNGEN`, `✅ GEPRÜFT`, `⚠️ HINWEISE`); `⏭️ Offen` ohne Linie. Zwischen Blöcken `---`, davor und danach je eine Leerzeile.
- **Hinweise** (Risiken, Einschränkungen, Weggelassenes) und **Offen** (was noch zu tun ist) immer getrennte Blöcke.
- **Icons** sparsam, feste Bedeutung: ✅ erledigt · ❌ Fehler · ⚠️ Warnung · ❓ Rückfrage · 🛠️ Änderung · 📄 Datei · 🧪 Test · 🔍 Befund · 💡 Vorschlag · ⏭️ nächster Schritt · 📦 Commit · 🖥️ Stele/Player · 🖼️ Vorschau · 🏁 Aufgabe erledigt · ⏳ Aufgabe offen. Block-Icon nicht im Stichpunkt wiederholen; am Stichpunkt höchstens ein abweichendes Icon; keine Deko-Icons.
- Geänderte Dateien als Tabelle `| 📄 Datei | Änderung |`, Vergleiche/Mehrfachergebnisse als kleine Tabelle, Dateien als klickbare Links.
- **Kurzantworten** (1–3 Zeilen): ohne Status-Kopf und Überschriften; Status-Zeile, Git-Zeile, ggf. Test-Zeile und `✅ **Chat Done**` bleiben.
- **Rückfragen** (❓ im Block `⏭️ Offen`): nach der fertigen Antwort `AskUserQuestion` (max. 4 Fragen, 2–4 Optionen, Empfehlung zuerst mit „(Recommended)“); die Auswahl gilt als Antwort → direkt weiterarbeiten.
- **Block `⚠️ HINWEISE`:** oberste Punkte mit `✅` vorn = positiv, ohne Icon = Warnung, `❗`/`❌` vorn = Fehler/wichtig; Unterpunkte normal.
