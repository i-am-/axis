// The birth-data form (components/BirthForm.astro): the place combobox,
// validation, and the hand-off query string. Shared by /natal-chart/ and
// /astrocartography/.

import { searchPlaces, type Place } from './places';
import { birthQuery, readBirthQuery, type Birth } from './birth-query';

// Liwan's tracker, when analytics are on (components/Liwan.astro)
declare global {
  interface Window {
    liwan?: { event?: (name: string, options?: { properties?: Record<string, string> }) => Promise<void> };
  }
}

/** One analytics event: place names and dates only, never coordinates. */
export function track(name: string, properties: Record<string, string>) {
  window.liwan?.event?.(name, { properties }).catch(() => {});
}

// "Moscow, Russia", not "Moscow, Moscow, Russia"
// flags as SVG files: Windows draws flag emoji as bare letters
const FLAGS = import.meta.glob<string>('../../node_modules/flag-icons/flags/4x3/*.svg',
  { query: '?url', import: 'default', eager: true });
const flagURL = (cc: string) => FLAGS[`../../node_modules/flag-icons/flags/4x3/${cc.toLowerCase()}.svg`];

// 59.94° N, 30.31° E
export const coords = (p: Place) =>
  `${Math.abs(p.latitude).toFixed(2)}° ${p.latitude >= 0 ? 'N' : 'S'}, ` +
  `${Math.abs(p.longitude).toFixed(2)}° ${p.longitude >= 0 ? 'E' : 'W'}`;

export const placeName = (p: Place) =>
  [p.name, p.region !== p.name ? p.region : '', p.country].filter(Boolean).join(', ');

// ---- the place search: a combobox that narrows as the visitor types

export function initPlace(input: HTMLInputElement, list: HTMLUListElement, onPick: (p: Place | null) => void) {
  let places: Place[] = [];
  let active = -1;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let latest = '';                        // answers to older queries arriving late are dropped

  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };

  const highlight = (i: number) => {
    active = i;
    list.querySelectorAll('li').forEach((li, j) => li.setAttribute('aria-selected', String(j === i)));
    if (i >= 0) {
      input.setAttribute('aria-activedescendant', `${list.id}-opt-${i}`);
      list.children[i]?.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  };

  const pick = (i: number) => {
    const p = places[i];
    if (!p) return;
    input.value = placeName(p);
    onPick(p);
    close();
  };

  const render = () => {
    list.replaceChildren(...places.map((p, i) => {
      const li = document.createElement('li');
      li.id = `${list.id}-opt-${i}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      const flag = document.createElement('img');
      flag.className = 'place-flag';
      flag.alt = '';                      // the country is named in the text beside it
      flag.width = 24;
      flag.height = 18;
      const url = flagURL(p.country_code);
      if (url) flag.src = url;
      else flag.style.visibility = 'hidden';
      const name = document.createElement('span');
      name.className = 'place-name';
      name.textContent = p.name;
      const where = document.createElement('span');
      where.className = 'place-where';
      where.textContent = [p.matched_name !== p.name ? p.matched_name : '', p.region !== p.name ? p.region : '', p.country]
        .filter(Boolean).join(' · ');
      const at = document.createElement('span');
      at.className = 'place-coords';
      at.textContent = coords(p);
      li.append(flag, name, at, where);
      li.addEventListener('mousedown', (e) => { e.preventDefault(); pick(i); });
      return li;
    }));
    if (!places.length) {
      const li = document.createElement('li');
      li.className = 'place-empty';
      li.textContent = 'No town or city by that name. Try its spelling in another language.';
      list.replaceChildren(li);
    }
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    highlight(-1);
  };

  const search = async (q: string) => {
    latest = q;
    try {
      const found = await searchPlaces(q, 8);
      if (q !== latest) return;
      places = found;
      render();
    } catch {
      if (q === latest) close();
    }
  };

  input.addEventListener('input', () => {
    onPick(null);                         // typing again undoes the last choice
    clearTimeout(timer);
    const q = input.value.trim();
    if ([...q].length < (/[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Hangul}]/u.test(q) ? 1 : 2)) {
      latest = '';
      close();
      return;
    }
    timer = setTimeout(() => search(q), 120);
  });

  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); highlight(Math.min(active + 1, places.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(Math.max(active - 1, 0)); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(active); }
    else if (e.key === 'Escape') close();
  });
  input.addEventListener('blur', close);
}

export function initBirthForm(form: HTMLFormElement, onSubmit: (b: Birth) => Promise<void>) {
  const date = form.querySelector<HTMLInputElement>('#birth-date')!;
  const time = form.querySelector<HTMLInputElement>('#birth-time')!;
  const unknown = form.querySelector<HTMLInputElement>('#time-unknown');   // absent when the time is required
  const place = form.querySelector<HTMLInputElement>('#birth-place')!;
  const list = form.querySelector<HTMLUListElement>('#place-list')!;
  const status = form.querySelector<HTMLElement>('#birth-status')!;
  let chosen: Place | null = null;

  initPlace(place, list, (p) => { chosen = p; });

  // an unknown time is calculated for noon: the middle of the day keeps the
  // Moon, the fastest mover, within about 7° of where it really was
  const setUnknown = (on: boolean) => {
    if (!unknown) return;
    unknown.checked = on;
    time.disabled = on;
    if (on) time.value = '12:00';
  };
  unknown?.addEventListener('change', () => setUnknown(unknown.checked));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const noTime = unknown?.checked ?? false;
    if (!date.value) { status.textContent = 'Enter your date of birth.'; date.focus(); return; }
    if (!time.value && !noTime) {
      status.textContent = unknown ? 'Enter your time of birth, or tick that you don’t know it.' : 'Enter your time of birth.';
      time.focus();
      return;
    }
    if (!chosen) { status.textContent = 'Choose your place of birth from the list.'; place.focus(); return; }
    const birth: Birth = { date: date.value, time: noTime ? null : time.value, place: chosen };
    status.textContent = 'Calculating…';
    try {
      await onSubmit(birth);
    } catch (err) {
      status.textContent = (err as Error).message.replace(/^./, (c) => c.toUpperCase());
      return;
    }
    status.textContent = '';
    history.replaceState(null, '', location.pathname + birthQuery(birth, placeName(chosen)));
  });

  // a chart handed over in the URL fragment (or an old ?query) draws at once
  const handed = readBirthQuery(location.hash || location.search);
  if (handed) {
    date.value = handed.date;
    if (handed.time) { setUnknown(false); time.value = handed.time; } else setUnknown(true);
    place.value = placeName(handed.place);
    chosen = handed.place;
    if (handed.time || unknown) form.requestSubmit();
  }
}
