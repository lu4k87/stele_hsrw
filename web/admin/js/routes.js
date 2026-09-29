// Navigation (Seitenleiste) und Routen. perm: Recht (String) oder Liste (eines genügt).
// Jede Ansicht ist ein ES-Modul in js/views/ mit `export default async function mount(root, ctx)`.

export const NAV = [
  { id: 'dashboard', label: 'Übersicht', icon: 'dashboard', href: '#/' },
  {
    group: 'Inhalte',
    items: [
      { id: 'media', label: 'Mediathek', icon: 'images', href: '#/media', perm: 'content.view' },
      { id: 'presentations', label: 'Präsentationen', icon: 'presentation', href: '#/presentations', perm: 'presentations.view', badge: 'reviews' },
      { id: 'touch-menus', label: 'Touch-Menüs', icon: 'touch', href: '#/touch-menus', perm: 'presentations.view' },
      { id: 'designs', label: 'Designs', icon: 'palette', href: '#/designs', perm: 'presentations.view' },
    ],
  },
  {
    group: 'Betrieb',
    items: [
      { id: 'steles', label: 'Stelen', icon: 'stele', href: '#/steles', perm: 'steles.view', badge: 'offline' },
      { id: 'schedule', label: 'Zeitplan', icon: 'calendar-clock', href: '#/schedule', perm: 'schedule.view' },
      { id: 'monitoring', label: 'Monitoring', icon: 'activity', href: '#/monitoring', perm: 'monitoring.view', badge: 'alerts' },
    ],
  },
  {
    group: 'Verwaltung',
    items: [
      { id: 'users', label: 'Benutzer', icon: 'users', href: '#/users', perm: 'users.view' },
      { id: 'roles', label: 'Rollen & Rechte', icon: 'shield', href: '#/roles', perm: ['users.view', 'roles.manage'] },
      { id: 'audit', label: 'Protokoll', icon: 'scroll', href: '#/audit', perm: 'audit.view' },
      { id: 'settings', label: 'Einstellungen', icon: 'settings', href: '#/settings', perm: 'settings.manage' },
    ],
  },
];

// parent: Brotkrumen-Eltern (Label + Link) vor dem aktuellen Titel
const P = {
  media: { label: 'Mediathek', href: '#/media' },
  presentations: { label: 'Präsentationen', href: '#/presentations' },
  touch: { label: 'Touch-Menüs', href: '#/touch-menus' },
  designs: { label: 'Designs', href: '#/designs' },
  steles: { label: 'Stelen', href: '#/steles' },
};

export const ROUTES = [
  { path: '/', nav: 'dashboard', title: 'Übersicht', load: () => import('./views/dashboard.js') },

  { path: '/media', nav: 'media', group: 'Inhalte', title: 'Mediathek', perm: 'content.view', load: () => import('./views/media.js') },
  { path: '/media/text/:id', nav: 'media', group: 'Inhalte', parent: P.media, title: 'Info-Folie', perm: 'content.view', load: () => import('./views/text-slide-editor.js') },
  { path: '/presentations', nav: 'presentations', group: 'Inhalte', title: 'Präsentationen', perm: 'presentations.view', load: () => import('./views/presentations.js') },
  { path: '/presentations/:id', nav: 'presentations', group: 'Inhalte', parent: P.presentations, title: 'Präsentation', perm: 'presentations.view', load: () => import('./views/presentation-editor.js') },
  { path: '/touch-menus', nav: 'touch-menus', group: 'Inhalte', title: 'Touch-Menüs', perm: 'presentations.view', load: () => import('./views/touch-menus.js') },
  { path: '/touch-menus/:id', nav: 'touch-menus', group: 'Inhalte', parent: P.touch, title: 'Touch-Menü', perm: 'presentations.view', load: () => import('./views/touch-menu-editor.js') },
  { path: '/designs', nav: 'designs', group: 'Inhalte', title: 'Designs', perm: 'presentations.view', load: () => import('./views/designs.js') },
  { path: '/designs/:id', nav: 'designs', group: 'Inhalte', parent: P.designs, title: 'Design', perm: 'presentations.view', load: () => import('./views/design-editor.js') },

  { path: '/steles', nav: 'steles', group: 'Betrieb', title: 'Stelen', perm: 'steles.view', load: () => import('./views/steles.js') },
  { path: '/steles/:id', nav: 'steles', group: 'Betrieb', parent: P.steles, title: 'Stele', perm: 'steles.view', load: () => import('./views/stele-detail.js') },
  { path: '/schedule', nav: 'schedule', group: 'Betrieb', title: 'Zeitplan', perm: 'schedule.view', load: () => import('./views/schedule.js') },
  { path: '/monitoring', nav: 'monitoring', group: 'Betrieb', title: 'Monitoring', perm: 'monitoring.view', load: () => import('./views/monitoring.js') },

  { path: '/users', nav: 'users', group: 'Verwaltung', title: 'Benutzer', perm: 'users.view', load: () => import('./views/users.js') },
  { path: '/roles', nav: 'roles', group: 'Verwaltung', title: 'Rollen & Rechte', perm: ['users.view', 'roles.manage'], load: () => import('./views/roles.js') },
  { path: '/audit', nav: 'audit', group: 'Verwaltung', title: 'Protokoll', perm: 'audit.view', load: () => import('./views/audit.js') },
  { path: '/settings', nav: 'settings', group: 'Verwaltung', title: 'Einstellungen', perm: 'settings.manage', load: () => import('./views/settings.js') },
  { path: '/profile', nav: null, title: 'Profil', load: () => import('./views/profile.js') },
];
