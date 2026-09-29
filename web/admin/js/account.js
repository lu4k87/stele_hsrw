// Konto-Dialoge, die an mehreren Stellen gebraucht werden (Benutzer-Menü, Profil).
import { h } from './dom.js';
import { api, ApiError } from './api.js';
import { applySession } from './session.js';
import { openDialog } from './ui/dialog.js';
import { field, input, setFieldErrors } from './ui/form.js';
import { toast } from './ui/toast.js';
import { icon } from './icons.js';

/** Passwort ändern. forced = nach erster Anmeldung (ohne Abbrechen). Liefert Promise<boolean>. */
export function openPasswordDialog({ forced = false } = {}) {
  const current = input({ type: 'password', autocomplete: 'current-password', name: 'current_password' });
  const next = input({ type: 'password', autocomplete: 'new-password', name: 'new_password' });
  const repeat = input({ type: 'password', autocomplete: 'new-password' });
  const form = h('div', { class: 'form' },
    forced ? h('div', { class: 'alert alert--warning' }, icon('key'), h('div', { class: 'alert__body' },
      h('div', { class: 'alert__title' }, 'Bitte ein eigenes Passwort festlegen'),
      h('div', { class: 'alert__text' }, 'Das Startpasswort wurde von einer Administratorin oder einem Administrator vergeben und muss ersetzt werden.'))) : null,
    field({ label: 'Aktuelles Passwort', control: current, required: true, name: 'current_password' }),
    field({ label: 'Neues Passwort', control: next, required: true, name: 'new_password', hint: 'Mindestens 8 Zeichen. Tipp: ein kurzer Satz ist gut zu merken und sicher.' }),
    field({ label: 'Neues Passwort wiederholen', control: repeat, required: true, name: 'repeat' }),
  );
  const d = openDialog({
    title: 'Passwort ändern',
    dismissible: !forced,
    content: form,
    actions: [
      forced ? null : { label: 'Abbrechen', value: false },
      {
        label: 'Passwort speichern', variant: 'primary', icon: 'save',
        onClick: async () => {
          const errors = {};
          if (!current.value) errors.current_password = 'Bitte das aktuelle Passwort eingeben.';
          if (!next.value) errors.new_password = 'Bitte ein neues Passwort eingeben.';
          else if (next.value === current.value) errors.new_password = 'Das neue Passwort muss sich vom aktuellen unterscheiden.';
          if (next.value && repeat.value !== next.value) errors.repeat = 'Die Wiederholung stimmt nicht überein.';
          if (Object.keys(errors).length) { setFieldErrors(form, errors); return false; }
          try {
            const s = await api.post('/api/auth/password', { current_password: current.value, new_password: next.value });
            applySession(s);
            toast.success('Passwort geändert. Andere Sitzungen wurden abgemeldet.');
            return true;
          } catch (err) {
            if (err instanceof ApiError && Object.keys(err.fields || {}).length) { setFieldErrors(form, err.fields); return false; }
            if (err instanceof ApiError && err.code === 'invalid_credentials') { setFieldErrors(form, { current_password: 'Das aktuelle Passwort ist nicht korrekt.' }); return false; }
            throw err;
          }
        },
      },
    ].filter(Boolean),
  });
  return d.result.then((r) => r === true);
}
