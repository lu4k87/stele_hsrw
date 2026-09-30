# Vorschau-Webseiten (.claude/skills/preview)

Einheitliches Template für Vorschauen von UI-Änderungen, Umbauten und Entscheidungen
(„mach mir eine Vorschau“). Ergebnis: eine Seite mit Sprungleiste, „Auf einen Blick“,
nummerierten Sections mit Icons und offenen Fragen – hell/dunkel, bis 390 px responsive.

Aussehen bewusst anders als das Stele CMS (warmes Papier/Graphit, Violett, Serif-Überschriften,
IBM Plex): Sections = Karten mit violettem Randstreifen; Projekt-Inhalte
(Screenshots, Ablauf-Bild, Live-Mockup) stehen in einem dunklen Rahmen mit Leiste **„Projekt-UI“**.

## Ablauf

```bash
S=<scratchpad>/vorschau                      # Ausgabe nie ins Repo
cp .claude/skills/preview/example/{spec,shots}.json $S/ # Vorlage kopieren, Texte ersetzen
.venv/bin/python .claude/skills/preview/capture.py $S/shots.json --out $S/shots      # Screenshots (isoliert)
.venv/bin/python .claude/skills/preview/build.py   $S/spec.json --img-dir $S/shots --out $S/site
```

Dann `$S/site/index.html` mit dem Artifact-Tool veröffentlichen, `files` = die von
`build.py` ausgegebene Map (`img/*.jpg`), **`capabilities: {"comments": {}}`** (für die
Rückmeldefelder). Update: gleicher Pfad → gleiche URL (Capabilities beim Update weglassen = bleiben).

## Rückmeldung an Claude

- Jede Section und „Fragen an dich“ haben unten ein Eingabefeld, am Ende „Rückmeldung an Claude“
  (Allgemein + **Alle senden (n)** = alle Einträge als eine Nachricht)
- **An Claude senden** → `comments.sendToClaude()`: Kommentar-Thread im Artifact, geht an die
  Claude-Sitzung, die die Vorschau veröffentlicht hat (bzw. per `ArtifactComments` beobachtet);
  Nachricht = „Änderungswunsch aus der Vorschau „Titel“ – bitte umsetzen: Abschnitt N „…“: Text“
- Ohne Sitzung / lokal geöffnet: Senden deaktiviert (Grund im Tooltip), **Kopieren** → im Chat einfügen
- Entwürfe bleiben pro Browser erhalten; Strg+Enter = senden
- Aus: `"feedback": false` (ganze Seite) bzw. pro Section; eigener Platzhalter: `feedback_hint`
- Claude antwortet im Kommentar-Thread, setzt um und veröffentlicht die Vorschau neu

## Spec (`spec.json`)

| Feld | Inhalt |
|---|---|
| `short`, `title`, `eyebrow`, `date` | Kopf (`short` = Sprungleiste + Tab-Titel) |
| `intro` | Liste von Stichpunkten zum Inhalt – **kein Fließtext, keine Erklärung, wie die Seite bedient wird** |
| `glance` | „Auf einen Blick“: `[{icon, value, label, tone}]` |
| `decided`, `how` | Kästen „Schon entschieden“ / „So funktioniert es“ |
| `sections` | `[{type, title, icon, nav, text, badge, …}]`, `text` = Stichpunkte (Liste), siehe unten |
| `questions` | „Fragen an dich“, nummeriert |
| `feedback` | `false` = keine Rückmeldefelder (Standard: an) |
| `images` | optional `{key: pfad}`; sonst alle Bilder aus `--img-dir` (key = Dateiname) |

Section-Typen:

| `type` | Felder | Wofür |
|---|---|---|
| `changes` | `items: [{kind, title, text, where, icon, tags}]`, `kind` = `new/changed/removed/moved/same/fix` | Liste der Änderungen mit Status-Badge |
| `options` | `items: [{key, title, text, img, pros, cons, recommended, tags}]` | Varianten zur Wahl |
| `compare` | `pairs: [{title, before, after, caption, before_label, after_label}]` | Vorher/Nachher |
| `figures` | `items: [{img, caption}]`, `min` (Spaltenbreite px) | Bildraster |
| `player` | `flows: [{title, group, icon, sub, steps: [{img, t, de, tags}]}]` | Abläufe Schritt für Schritt |
| `mockup` | `variants: [{label, html, css, height, note}]`, `css`, `height` | Live-HTML mit den Tokens aus `web/admin/css/tokens.css` (`--bg`, `--surface`, `--border`, `--text`, `--primary` …), folgt Hell/Dunkel |
| `notes` | `items` | Stichpunkte |

- Icons: Font-Awesome-6-Namen ohne Präfix (`display`, `bell`) oder volle Klasse (`fa-regular fa-clock`)
- Listen-Einträge: `"Text"` oder `{icon, text}`; Texte dürfen `<b>`, `<code>`, `<br>` enthalten
- Badges/Tags: `"Text"` oder `["Text", "info|ok|warn|bad|muted", "icon"]`
- Farben nach UX-Regeln: grau = unverändert, grün = entschieden/empfohlen, blau = neu/Info, gelb = Frage/Warnung, rot = entfällt

## Screenshots (`shots.json`)

`capture.py` startet eine eigene Testinstanz (Port 18096, Demo-Daten im Temp-Ordner) und einen eigenen
headless Chrome (CDP 19226, de-DE) mit den Bausteinen aus `docs/screenshots.py`; Port 8090 und `data/`
bleiben unberührt, Stelen-Schlüssel und Pfade werden ersetzt. Pro Shot: `page` (`admin` + `hash`, `show`,
`player`) oder `url`, `width`, `height`, `theme`, `user` (Demo-Konto), `js` (async, `await` erlaubt),
`css` (geplante Änderung vorab einspielen), `clip` + `pad` (nur ein Element), `wait`.
