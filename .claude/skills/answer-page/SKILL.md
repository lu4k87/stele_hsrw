---
name: answer-page
description: Antwortformat (Log-Style) für JEDE Chat-Antwort im Stele CMS – ━-Blöcke, Status-Zeile, Status-Tabelle (Status/Dateien/Tests/Push), Chat-Status (AGENTS.md §1); vor dem Schreiben der finalen Nachricht laden.
---

# Antwortformat (.claude/skills/answer-page)

Gilt für **jede** Antwort. Keine Zusammenfassungsseite und keine Abschluss-Box: kein Artifact als Zusammenfassung,
kein Block `🌐 Zusammenfassung`, kein Block `📦 ABSCHLUSS`. Git-Stand und Tests stehen nur in der Status-Tabelle
am Ende (keine eigene Git- oder Test-Zeile, kein Status-Kopf oben).

## Schluss der Antwort
Nach dem letzten Inhaltsblock:
- Gehört eine Vorschau (Skill `preview`) zur Antwort: Trennlinie `---` + `🖼️ Vorschau: <URL>`.
- Gibt es Offenes: Trennlinie `---` + Block `### ⏭️ Offen`.
- Bei Vorschlag „Neuer Chat?“: Trennlinie + Block `### 📄 STARTTEXT FÜR DEN NEUEN CHAT`.

Dann, in dieser Reihenfolge, jeweils durch Leerzeile getrennt:
1. **Status-Zeile:** `🏁 **AUFGABE ERLEDIGT**` nur ohne Block `⏭️ Offen`, sonst `⏳ **AUFGABE OFFEN**`.
2. Trennlinie `---`.
3. **Status-Tabelle** `| ✅ Status | 🛠️ Dateien | 🧪 Tests | 📦 Push |` (immer, auch bei Kurzantworten; Werte + Sonderfälle unten), danach ein **Leerabsatz**: Leerzeile, Zeile `&nbsp;`, Leerzeile.
4. **Chat-Status-Zeile** als **allerletzte Zeile** – genau **eine** Variante, nie beide:
   `✅ **Aufgaben aus diesem Chat: fertig**` (nichts offen) oder `⏳ **Aufgaben aus diesem Chat: noch nicht fertig**` (bei `⏳ AUFGABE OFFEN`).

Vor **jeder** Trennlinie eine Leerzeile (sonst wird die Zeile davor zur Überschrift). Links nie selbst öffnen,
nicht nachfragen (kein Dialog „Seite öffnen?“, kein Artifact `open`).

## Muster
Blöcke mit `━`-Überschrift → Schluss:
````
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

---

| ✅ Status | 🛠️ Dateien | 🧪 Tests | 📦 Push |
|---|---|---|---|
| offen | 2 | pytest 151/151 | `a1b2c3d` |

&nbsp;   ← Leerabsatz unter der Tabelle (immer)

⏳ **Aufgaben aus diesem Chat: noch nicht fertig**   ← bei AUFGABE OFFEN; sonst ✅ **Aufgaben aus diesem Chat: fertig**
````

## Status-Tabelle: Werte und Sonderfälle
| Spalte | Normalfall | Sonderfälle |
|---|---|---|
| ✅ Status | `fertig` (bei 🏁) | `offen` (bei ⏳, Arbeit geht weiter) · `❓ Rückfrage` (wartet auf Auswahl) · `Vorschlag` (nur Vorschau/Plan, nichts umgesetzt) · `❌ blockiert` (Fehler, Test rot) · `Info` (reine Frage/Erklärung) |
| 🛠️ Dateien | Anzahl eigener geänderter Dateien | `0` wenn nichts geändert |
| 🧪 Tests | knapp was lief + Ergebnis, z. B. `pytest 151/151` · `UI hell + dunkel ok` · `Hook-Simulation ok` | `–` nicht getestet · `❌ pytest 149/151` · `❌ 2 Konsolenfehler` |
| 📦 Push | `` `a1b2c3d` `` = committet **und** gepusht | mehrere Commits: letzter Hash + Anzahl, `` `a1b2c3d` (+2) `` · `–` nichts geändert · `nicht committet` (Grund + welcher Chat übernimmt im Block `⚠️ HINWEISE`) · `` `a1b2c3d` ❌ nicht gepusht `` |

- Kein Build-Schritt im Projekt → keine Build-Zeile; bei Web-Änderungen im Block `⚠️ HINWEISE` auf Browser-Reload (Strg+Shift+R) hinweisen.

## Stilregeln
- **Blöcke:** Überschrift = Icon + Titel in GROSSBUCHSTABEN + Linie `━` (`🔍 ANALYSE`, `🛠️ ÄNDERUNGEN`, `✅ GEPRÜFT`, `⚠️ HINWEISE`); `⏭️ Offen` ohne Linie. Zwischen Blöcken `---`, davor und danach je eine Leerzeile.
- **Hinweise** (Risiken, Einschränkungen, Weggelassenes) und **Offen** (was noch zu tun ist) immer getrennte Blöcke.
- **Icons** sparsam, feste Bedeutung: ✅ erledigt · ❌ Fehler · ⚠️ Warnung · ❓ Rückfrage · 🛠️ Änderung · 📄 Datei · 🧪 Test · 🔍 Befund · 💡 Vorschlag · ⏭️ nächster Schritt · 📦 Push · 🖥️ Stele/Player · 🖼️ Vorschau · 🏁 Aufgabe erledigt · ⏳ Aufgabe offen. Block-Icon nicht im Stichpunkt wiederholen; am Stichpunkt höchstens ein abweichendes Icon; keine Deko-Icons.
- Geänderte Dateien als Tabelle `| 📄 Datei | Änderung |`, Vergleiche/Mehrfachergebnisse als kleine Tabelle, Dateien als klickbare Links.
- **Kurzantworten** (1–3 Zeilen): ohne Block-Überschriften; Status-Zeile, `---`, Status-Tabelle und Chat-Status-Zeile bleiben.
- **Rückfragen** (❓ im Block `⏭️ Offen`): nach der fertigen Antwort `AskUserQuestion` (max. 4 Fragen, 2–4 Optionen, Empfehlung zuerst mit „(Recommended)“); die Auswahl gilt als Antwort → direkt weiterarbeiten.
- **Block `⚠️ HINWEISE`:** oberste Punkte mit `✅` vorn = positiv, ohne Icon = Warnung, `❗`/`❌` vorn = Fehler/wichtig; Unterpunkte normal.
