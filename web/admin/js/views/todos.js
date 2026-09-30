// To-dos (#/todos): offene und geklärte Punkte der Content-Strategie (Stand: Papier von Caroline, 10.09.2026,
// inkl. Kommentare). Vorläufige, statische Übersicht – wird später wieder entfernt.
import { h, useStyles } from '../dom.js';
import { icon } from '../icons.js';
import { page, pageHeader, card } from '../ui/page.js';
import { chip } from '../ui/status.js';

// note: Kommentar aus dem Papier bzw. Vorschlag
const OPEN = [
  { title: 'Ziel & Takt', icon: 'calendar-clock', items: [
    { text: 'Aktualität: tagesaktuell, wöchentlich oder monatlich?', note: 'Vorschlag: wöchentlich' },
    { text: 'Wer pflegt die wöchentlichen Updates ein?' },
  ] },
  { title: 'Funktion', icon: 'lightbulb', items: [
    { text: 'Nur Information oder auch Inspiration (Denkanstöße)?' },
    { text: 'Wie sieht ein Denkanstoß konkret aus?' },
  ] },
  { title: 'Content-Lieferung', icon: 'mail', items: [
    { text: 'Lieferanten festlegen', note: 'FKU-Dekanat; interessiert: Hochschulsport, Bibliothek' },
    { text: 'Wie sammeln wir den Content – einfach per E-Mail?' },
    { text: 'Wer bringt den Content auf die Folien?' },
  ] },
  { title: 'Technik & Gestaltung – für unsere Stele', icon: 'stele', items: [
    { text: 'Kontrast: dunkel auf hell oder umgekehrt?', note: 'Abhängig vom Panel-Typ – für unser Panel konkret beantworten' },
    { text: 'Optimale Sichthöhe unserer Stele bestimmen', note: 'Wichtige Infos nicht ganz oben oder ganz unten' },
  ] },
  { title: 'Redaktion & Governance', icon: 'users', items: [
    { text: 'Haupt-Inhalte (Website, Rubrik Veranstaltungen?) automatisch per Schnittstelle übernehmen – wer macht das?' },
    { text: 'Wer ist die Zentrale (Freigabe)?', note: 'Aktuell MGK, perspektivisch nicht realistisch' },
  ] },
];

const DONE = [
  { text: 'Was läuft auf der Stele?', result: 'Aktuell eine Präsentation, keine Hochschul-Website' },
  { text: 'Medientyp (Text, Bild, Audio, Audiovisuell, Interaktiv)', result: 'Alles möglich, da Präsentation' },
  { text: 'QR-Codes als Call to Action', result: 'Bereits im Einsatz' },
  { text: 'Rubrik „Image“ (Erfolge, Projekte, Auszeichnungen)', result: 'Nötig – „Tu Gutes und sprich darüber“' },
  { text: 'Content-Loop und Folienzeit', result: 'Eingestellt: 7 s pro Folie (Vorschlag: Loop 60–90 s, Folie 5–7 s)' },
  { text: 'Zielgruppe', result: 'Externe Besucher, Hochschulangehörige, Studierende' },
];

const GUIDE = [
  { title: 'Pflichtangaben', icon: 'check-circle', items: ['Für wen?', 'Wann?', 'Wo?', 'Worum geht es?', 'Eintritt frei'] },
  { title: 'Inhaltsgestaltung', icon: 'type', items: [
    '„3-Sekunden“-Visuals: Bilder, Icons, kurze Videos',
    'Max. ein prägnanter Satz pro Screen (Headline + max. 1–2 Stichpunkte)',
    'Große Typografie: lesbar aus 3–5 m und bei Sonnenlicht',
    'Keine feinen Schriftarten',
    'QR-Codes groß genug, auf Augenhöhe (z. B. Anmeldung, Lageplan)',
  ] },
  { title: 'Rubriken (Content-Mix)', icon: 'layers', items: [
    'Campus-Leben & Events: Hochschulsport, Partys, Gastvorträge, Karrieremessen, Ausstellungen',
    'Service & Orientierung: Lagepläne (v. a. Semesterstart), Öffnungszeiten Mensa/Bibliothek, Website',
    'Eilmeldungen & News: Raumänderungen, Fristen (Rückmeldung, Prüfungsanmeldung), Unwetterwarnungen',
    'Image: Erfolge Forschender, studentische Projekte, Auszeichnungen',
  ] },
  { title: 'Redaktionsprozess', icon: 'send', items: [
    'Zentral: Haupt-Inhalte automatisiert über Schnittstellen',
    'Dezentral: Einheiten reichen Folien über Templates ein → zentrale Freigabe',
    'Aktualität über automatisches Ablaufdatum pro Inhalt',
  ] },
];

const CONTEXT = [
  'Outdoor-Stele am Campus Kamp-Lintfort, bei Gebäude 1',
  'Passanten in Bewegung, kommen um die Ecke → Inhalte schnell erfassbar',
  'Wechselnde Lichtverhältnisse',
];

function openGroup(g) {
  return h('section', { class: 'td-group' },
    h('h3', { class: 'td-group__title' }, icon(g.icon), g.title),
    h('ul', { class: 'td-list' }, g.items.map((it) => h('li', { class: 'td-item' },
      h('span', { class: 'td-item__mark td-item__mark--open' }, icon('help-circle', { size: 18 })),
      h('div', { class: 'td-item__body' },
        h('span', { class: 'td-item__text' }, it.text),
        it.note ? h('span', { class: 'td-item__note' }, it.note) : null,
      ),
    ))),
  );
}

export default async function mount(root) {
  await useStyles('/admin/css/views/todos.css');
  const openCount = OPEN.reduce((n, g) => n + g.items.length, 0);

  root.append(page({ wide: true },
    pageHeader({
      title: 'To-dos',
      description: 'Content-Strategie der Stele: offene und geklärte Punkte. Grundlage: Papier von Caroline (10.09.2026) mit Kommentaren.',
      meta: h('div', { class: 'cluster' },
        chip('warning', `${openCount} offen`, 'help-circle'),
        chip('success', `${DONE.length} geklärt`, 'check-circle'),
      ),
    }),
    h('div', { class: 'td-columns' },
      card({ title: 'Offen', icon: 'help-circle', subtitle: 'Noch zu klären', className: 'td-open',
        body: h('div', { class: 'td-groups' }, OPEN.map(openGroup)) }),
      h('div', { class: 'stack' },
        card({ title: 'Geklärt', icon: 'check-circle', subtitle: 'Entschieden oder bereits umgesetzt',
          body: h('ul', { class: 'td-list' }, DONE.map((it) => h('li', { class: 'td-item' },
            h('span', { class: 'td-item__mark td-item__mark--done' }, icon('check', { size: 18 })),
            h('div', { class: 'td-item__body' },
              h('span', { class: 'td-item__text' }, it.text),
              h('span', { class: 'td-item__note' }, it.result),
            ),
          ))) }),
        card({ title: 'Rahmen', icon: 'info',
          body: h('ul', { class: 'td-bullets' }, CONTEXT.map((t) => h('li', {}, t))) }),
      ),
    ),
    card({ title: 'Vorgaben pro Beitrag', icon: 'file-text', subtitle: 'Vorschlag aus dem Papier, noch nicht kommentiert',
      body: h('div', { class: 'td-guide' }, GUIDE.map((g) => h('section', { class: 'td-group' },
        h('h3', { class: 'td-group__title' }, icon(g.icon), g.title),
        h('ul', { class: 'td-bullets' }, g.items.map((t) => h('li', {}, t))),
      ))) }),
  ));
}
