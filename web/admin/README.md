# Admin-Oberfläche – Aufbau und Bausteine

Vanilla-JS-SPA ohne Build. Einstieg `index.html` → `js/main.js`. Fachlicher Vertrag: `docs/SPEC.md` (§7 API, §11 UX).

## Verzeichnisse
| Pfad | Inhalt |
|---|---|
| `css/tokens.css` | Design-Tokens hell/dunkel – **nur diese Variablen** für Farben, Abstände, Radien, Schriftgrößen; Struktur-Tönung: `--tint`/`--tint-border` (Karten- und Tabellenköpfe), `--mark` (Kartenkopf-Icons, Akzentbalken vor Abschnittstiteln, KPI-Oberkante); Kartenköpfe neutral (`--tint`); Ton nur bei Abweichung (`.card--warning`, z. B. Liste mit offenen Punkten) oder bewusst per `.tone-1` … `.tone-5` (`--sec-1` … `--sec-5` + `-border`, `-mark`); feste Flächen: `--on-dark`, `--device-*`, `--sketch-*`, `--media-matte`, `--paper`, `--danger-solid` |
| `css/base.css` | Reset, Typografie, Fokus, Layout-Helfer (`.stack`, `.cluster`, `.grid-auto`, `.split`, `.truncate` …) |
| `css/components.css` | Knöpfe, Formulare, Karten, Chips, Tabellen, Tabs, Dialoge, Menüs, Toasts, Leer-/Ladezustände, Player-Rahmen |
| `css/shell.css`, `css/login.css` | App-Rahmen, Anmeldung |
| `css/views/<ansicht>.css` | Styles einer Ansicht, per `useStyles()` nachgeladen, Klassen mit Ansichts-Präfix |
| `js/main.js`, `shell.js`, `router.js`, `routes.js` | Start, Rahmen, Routing, Navigation |
| `js/api.js`, `session.js`, `bus.js`, `idle.js`, `theme.js`, `account.js` | Server, Sitzung/Rechte, Ereignisse, Leerlauf, Farbschema, Passwort-Dialog |
| `js/dom.js`, `format.js`, `icons.js` | Helfer |
| `js/ui/*.js` | Komponenten (s. u.) |
| `js/views/*.js` | Ansichten (eine Datei je Route aus `routes.js`) |
| `show-stele-index.html`, `js/show.js`, `js/show/*.js`, `css/views/show.css` | Vorführseite: Rundgang, Info-Folie + Präsentation anlegen, Galerie aller Bausteine (SPEC §11.1) |

## Ansicht (View) – Vertrag
```js
// js/views/beispiel.js
import { h, useStyles } from '../dom.js';
import { api } from '../api.js';
export default async function mount(root, ctx) {
  await useStyles('/admin/css/views/beispiel.css');
  // ctx.params (Routen-Parameter), ctx.query (Query-Objekt), ctx.signal (AbortSignal, endet beim Verlassen),
  // ctx.navigate(path, {query, replace}), ctx.setQuery({...}) (URL ohne Neuaufbau), ctx.setTitle(text) (Brotkrumen),
  // ctx.setDirty(msg|false) (Warnung beim Verlassen), ctx.refreshNav() (Badges/Stelen-Pille sofort aktualisieren)
  root.append(…);
  const timer = setInterval(refresh, 10000);
  return () => clearInterval(timer);   // Aufräumen beim Verlassen
}
```
- API-Aufrufe mit `{ signal: ctx.signal }`, damit sie beim Verlassen abbrechen. Fehler immer abfangen und verständlich zeigen (`errorState`, `toast.error(errorMessage(err))`, Feldfehler per `setFieldErrors`).
- Rechte: `can('presentations.publish')` aus `session.js` – Aktionen ohne Recht ausblenden; wo die Aktion erwartet wird, die erlaubte Alternative zeigen.
- Polling nur in sichtbaren Ansichten; Hintergrund-Abfragen mit `{ background: true }` (verlängern die Sitzung nicht). Das Dashboard-Polling der Shell sendet `bus.on('dashboard:update', d => …)`.

## Bausteine (Auszug der Signaturen)
**dom.js** – `h(tag, props, ...children)` (props: `class`, `style`, `dataset`, `onClick` …; nie innerHTML mit Benutzertext), `mount(el, ...children)`, `clear`, `useStyles(href)`, `debounce(fn, ms)` (`.flush()`), `uid(prefix)`, `copyText(text)`, `initials(name)`, `nextFrame()`.

**format.js** – `formatDateTime`, `formatDate`, `formatTime`, `formatWeekday`, `formatRelative`, `formatSince` („seit 5 Min.“, frisch „gerade eben“), `formatDuration(s)`, `formatBytes`, `formatNumber`, `formatPercent`, `plural(n, 'Folie', 'Folien')`, `formatDays([1..7])`, `WEEKDAYS_SHORT/LONG`.

**api.js** – `api.get/post/put/patch/del(path, body?, { query, signal, background, timeout })` (Standard 20 s, danach `ApiError` code `timeout`), `api.upload(path, formData, { onProgress, signal })`, `api.download(path, query)`, `ApiError {status, code, message, fields, details}`, `errorMessage(err)`.

**session.js** – `session` (user, permissions, app), `can(p)`, `canAny(...)`, `canAll(...)`, `isAdmin()`.

**router.js** – `navigate`, `href(path, query)`, `setQuery`, `setDirty`, `confirmLeave()`.

**icons.js** – `icon(name, { size, label })`, `TILE_ICONS`, `TILE_ICON_LABELS` (Namen in `/shared/icons.js`).

**ui/page.js** – `page({ wide, narrow }, ...children)`, `pageHeader({ title, description, actions, back: {href,label}, status, meta })`, `card({ title, subtitle, icon, actions, body, footer, flush })`, `sectionTitle(title, ...actions)`, `kpi({ label, value, meta, icon })`, `button({ label, icon, variant, size, onClick, href, ariaLabel, title, disabled })`.

**ui/form.js** – `field({ label, control, hint, required, optional, name })`, `input({...})`, `numberInput({ value, min, max, step, unit, onInput })` (Wrapper hat `.input`), `textarea`, `select({ value, options:[{value,label}|{group,options}], onChange })`, `checkbox({ label, checked, hint, onChange })`, `switchToggle({ label, checked, hint, onChange })`, `segmented({ value, options:[{value,label,icon}], onChange, ariaLabel })` (`.setValue`, `.getValue`), `colorInput({ value, onChange, label })`, `tagsInput({ value, suggestions, onChange })`, `searchInput({ value, placeholder, onInput })` (`.input`), `setFieldErrors(root, fields)`, `clearFieldErrors(root)`, `setFieldError(root, name, msg)`.

**ui/dialog.js** – `openDialog({ title, description, content, actions:[{label, variant, icon, onClick(d) → false = offen lassen, value, start}], size: sm|md|lg|xl|full, dismissible, closeOnBackdrop, initialFocus, onClose })` → `{ el, body, footer, result, close(v), setActions, setBusy, setTitle }`; `openDrawer({...width})`; `confirmDialog({ title, message, details, confirmLabel, danger })` → Promise<bool>; `promptDialog({ title, label, value, hint, confirmLabel, validate, multiline })` → Promise<string|null>.

**ui/menu.js** – `menuButton({ items, label, iconName, text, variant, size, align })`, `openMenu(anchor, items)`, `closeMenu()`; Einträge `{ label, icon, onClick, href, danger, disabled, hint, checked, heading, separator }`.

**ui/table.js** – `dataTable({ columns:[{key,label,render,sortable,sortValue,align:'num'|'actions',width,headerHidden,rowHeader}], rows, onRowClick, sort, onSort, empty, caption, rowClass })` → `{ el, update(rows), setSort }`; `pager({ offset, limit, total, onChange })`.

**ui/tabs.js** – `tabs({ items:[{id,label,icon,badge}], value, onChange, ariaLabel })` → `{ el, panel, set, value }`.

**ui/status.js** – `chip(kind, label, icon)`, `presentationStatus(p)`, `steleStatus(s)`, `validityChip(v)`, `warningList(warnings)`, `CONTENT_TYPES`, `contentTypeLabel/Icon(type)`, `PRESENTATION_STATUS`, `STELE_STATUS` (eine Tabelle für Chip, Karte, Tooltip, Stelen-Pille, Navi-Badge: `kind`, `label`, `icon`, `pill`, `alert`, `hint`), `steleState(s)`.

**ui/empty.js** – `emptyState({ icon, title, text, actions })`, `loadingBlock(text)`, `errorState({ title, error, onRetry })`, `skeletonLines(n)`, `skeletonGrid(n, min)`.

**ui/presentation-actions.js** – `removePresentation(p, { beforeDelete })` (in Verwendung → Hinweis statt Löschen), `publishPresentation(id, body)` (Rückfrage bei 409 `changed_since_review`), `affectedPresentations(list, { what, onPublished })` (Hinweis „Änderungen offen in n Präsentationen“ mit Veröffentlichen).

**ui/edit-conflict.js** – `isEditConflict(err)`, `editConflictAlert(err, { onReload })` (409 `edit_conflict`: Hinweis mit „Neu laden“).

**ui/editor-save.js** – `editorSave({ ctx, ro, formRoot, snapshot, validate, send, onSaved(res, untouched), fieldMap, fieldToast, onReload, emphasize, stateClass, dirtyMessage })` → `{ saveBtn, saveState, conflictBox, changed(preview), isDirty, save, markSaved(snap), destroy }`: Speichern per Knopf/Strg+S (Touch-Menü, Design, Info-Folie) mit „Ungespeicherte Änderungen“, Feldfehlern und Bearbeitungskonflikt.

**ui/autosave.js** – `autosave({ ctx, enabled, className, parts: { name: send }, fieldMessage, onConflict, conflictMessage })` → `{ el, paint, queue(part), flush(), conflict, drop(), settle(), destroy() }`: Entwurf automatisch in Teilen speichern (Präsentations-Editor), Wiederholen bei Netzfehlern.

**ui/stele-ui.js** – u. a. `steleCard`, `steleMirror(steleId)` (aufklappbare Live-Ansicht), `presentationOptions(list)`, `defaultPresentationPicker({ steleId, current, presentations, onSaved })` (Standard-Präsentation wählen; Zeitplan, Stele-Detail).

**ui/toast.js** – `toast.success/info/warning/error(msg, { action: { label, onClick } })`.

**ui/player-frame.js** – `playerFrame({ src, width, height, label, maxHeight })` → `{ el, send(msg), on(type, fn), ready, reload, destroy }`; `playerUrls.preview(id, { source, slide, autoplay, touch })`, `playerUrls.slide()`, `playerUrls.mirror(steleId)`. Nachrichten nach SPEC §9.2 (`render`, `goto`, `play`, `pause`, `showItem` …). `destroy()` im Cleanup aufrufen.

## UX-Regeln (Kurzfassung, verbindlich – Details SPEC §11.2)
- Seitenaufbau: `pageHeader` (Titel, ein Satz Beschreibung, **eine** Hauptaktion rechts als `primary`), Werkzeugleiste (`.toolbar`), Inhalt in `card`s.
- Status = Icon + Text (`chip`), nie Farbe allein. Farben: Grün läuft/ok, Blau Aktion/Info, Gelb Warnung/offen, Rot Fehler/Löschen, Neutral Entwurf/aus.
- Zerstörendes immer mit `confirmDialog({ danger: true, confirmLabel: '<Objekt> löschen' })` und benannten Folgen; wo möglich „Rückgängig“ im Toast.
- Rückmeldung nach jeder Aktion (Toast oder sichtbarer Speicherstatus). Fehler am Feld, verständlich.
- Leere Zustände erklären + nächste Aktion; Laden mit Skelett/`loadingBlock`.
- Tastatur: alles erreichbar, sichtbarer Fokus, Dialoge mit Esc; Klickziele ≥ 32 px; Schrift ≥ 14 px; keine hellgraue Schrift (nur `--text`, `--text-2`, `--text-3`).
- Responsiv 390 px – 2560 px ohne waagrechtes Scrollen der Seite (breite Tabellen in `.table-wrap`). Hell und Dunkel prüfen.
- Texte Deutsch, neutral formuliert, keine Fachbegriffe ohne Erklärung.
