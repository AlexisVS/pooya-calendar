import { AuthError, createAuth } from './auth.js';
import { buildMonthGrid, dateKey, dayState, groupEventsByDay, monthOf, sameMonth, shiftMonth } from './calendar.js';
import { CalendarError, fetchEvents } from './google-calendar.js';
import { demoEvents } from './demo.js';

const config = window.CALENDAR_CONFIG ?? {};
const params = new URLSearchParams(location.search);
const isDemo = params.has('demo');
const calendarId = config.calendarId || 'primary';
const REFRESH_MS = Math.max(1, Number(config.refreshMinutes) || 5) * 60_000;
const TICK_MS = 15_000;
const RETURN_HOME_MS = 2 * 60_000;
const IDLE_CURSOR_MS = 3_000;
const CACHE_KEY = 'pooya-calendar.events';

const CONNECT_MESSAGES = {
  disconnected: '',
  expired: "La connexion à Google a expiré ou a été révoquée. Reconnectez-vous pour reprendre l'affichage.",
  denied: 'Connexion annulée. Vous pouvez recommencer quand vous voulez.',
  scope: "L'accès aux événements de l'agenda n'a pas été autorisé. Recommencez en cochant cette autorisation.",
  failed: "La connexion n'a pas abouti. Réessayez.",
  config: "Configuration incomplète : renseignez clientId et clientSecret dans config.js (voir README.md). Pour un aperçu sans compte Google, ajoutez ?demo à l'adresse.",
  insecure: "Google exige une adresse sécurisée : ouvrez l'application en https:// ou sur http://localhost.",
};
const BLOCKING_REASONS = new Set(['config', 'insecure']);

const fmt = {
  monthYear: new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }),
  monthShort: new Intl.DateTimeFormat('fr-FR', { month: 'short' }),
  time: new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }),
};

const $ = (id) => document.getElementById(id);
const els = {
  app: $('app'),
  badge: $('today-badge'),
  title: $('month-title'),
  navToday: $('nav-today'),
  navPrev: $('nav-prev'),
  navNext: $('nav-next'),
  clock: $('clock'),
  status: $('sync-status'),
  grid: $('grid'),
  connect: $('connect'),
  connectMessage: $('connect-message'),
  connectButton: $('connect-button'),
  connectNote: $('connect-note'),
};

const pinnedView = parseMonthParam(params.get('month'));
const state = {
  view: pinnedView ?? monthOf(new Date()),
  events: [],
  lastSync: null,
  error: null,
  syncing: false,
  renderedDay: null,
};

// Événements déjà chargés, par mois : revenir sur un mois vu s'affiche sans attendre Google.
const monthCache = new Map();
const monthKey = ({ year, month }) => `${year}-${month}`;

let auth = null;
let syncSeq = 0;
let returnHomeTimer = null;
let bootedAt = Date.now();

// ---------------------------------------------------------------- utilitaires

function parseMonthParam(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(value ?? '');
  return match ? { year: Number(match[1]), month: Number(match[2]) - 1 } : null;
}

function homeView(now = new Date()) {
  return pinnedView ?? monthOf(now);
}

function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const time = (date) => fmt.time.format(date);

// ---------------------------------------------------------------- rendu

function render(now = new Date()) {
  state.renderedDay = dateKey(now);
  renderHeader(now);
  renderGrid(now);
  renderStatus();
}

function renderHeader(now) {
  els.badge.textContent = now.getDate();
  els.title.textContent = capitalize(fmt.monthYear.format(new Date(state.view.year, state.view.month, 1)));
  els.clock.textContent = time(now);
}

function renderGrid(now) {
  const grid = buildMonthGrid(state.view.year, state.view.month, now);
  const byDay = groupEventsByDay(state.events);
  const maxChips = grid.weeks >= 6 ? 2 : 3;
  els.grid.style.setProperty('--weeks', grid.weeks);
  els.grid.innerHTML = grid.days.map((day) => dayHtml(day, byDay.get(day.key) ?? [], maxChips)).join('');
}

function dayHtml(day, events, maxChips) {
  const kind = dayState(day, events);
  const shown = events.slice(0, maxChips);
  const hidden = events.length - shown.length;
  const date = day.date;
  const label = date.getDate() === 1 ? `1 ${fmt.monthShort.format(date)}` : String(date.getDate());
  const classes = ['day', `day--${kind}`, day.inMonth ? '' : 'day--outside'].filter(Boolean).join(' ');

  return `<div class="${classes}">
    <span class="day__num">${esc(label)}</span>
    ${shown.map((event) => chipHtml(event, day)).join('')}
    ${hidden > 0 ? `<span class="day__more">+${hidden} ${hidden > 1 ? 'autres' : 'autre'}</span>` : ''}
  </div>`;
}

function chipHtml(event, day) {
  if (event.allDay) return `<span class="chip chip--allday">${esc(event.title)}</span>`;
  // L'heure ne s'affiche que le jour où l'événement commence.
  const startsHere = dateKey(event.start) === day.key;
  return `<span class="chip">
    <span class="chip__dot"></span>
    ${startsHere ? `<span class="chip__time">${time(event.start)}</span>` : ''}
    <span class="chip__title">${esc(event.title)}</span>
  </span>`;
}

function renderStatus() {
  let text;
  let isError = false;
  if (isDemo) {
    text = 'Données de démonstration';
  } else if (state.error) {
    isError = true;
    const since = state.lastSync ? `, données de ${time(state.lastSync)}` : '';
    text = state.error instanceof CalendarError ? `${state.error.message}${since}` : `Hors ligne${since}`;
  } else if (state.lastSync) {
    text = `Synchronisé à ${time(state.lastSync)}`;
  } else {
    text = 'Synchronisation…';
  }
  els.status.textContent = text;
  els.status.classList.toggle('is-error', isError);
}

// ---------------------------------------------------------------- écrans

function showCalendar() {
  els.connect.hidden = true;
  els.app.hidden = false;
  render();
}

function showConnect(reason) {
  els.app.hidden = true;
  els.connect.hidden = false;
  const message = CONNECT_MESSAGES[reason] ?? CONNECT_MESSAGES.failed;
  els.connectMessage.textContent = message;
  els.connectMessage.hidden = !message;
  const blocking = BLOCKING_REASONS.has(reason);
  els.connectButton.hidden = blocking;
  els.connectNote.hidden = blocking;
  if (!blocking) els.connectButton.focus();
}

// ---------------------------------------------------------------- synchronisation

async function sync() {
  if (!els.connect.hidden) return;
  const seq = ++syncSeq;
  const now = new Date();
  const view = state.view;
  const grid = buildMonthGrid(view.year, view.month, now);
  state.syncing = true;
  try {
    const events = isDemo
      ? demoEvents(now)
      : await fetchEvents({ calendarId, timeMin: grid.start, timeMax: grid.end, auth });
    if (seq !== syncSeq) return;
    state.events = events;
    state.lastSync = new Date();
    state.error = null;
    monthCache.set(monthKey(view), events);
    if (sameMonth(view, monthOf(now))) saveCache();
  } catch (error) {
    if (seq !== syncSeq) return;
    if (error instanceof AuthError) return showConnect(error.reason);
    if (error instanceof CalendarError && error.code === 'scope') {
      await auth.logout();
      return showConnect('scope');
    }
    console.error('[calendrier]', error);
    state.error = error;
  } finally {
    if (seq === syncSeq) state.syncing = false;
  }
  render();
}

function saveCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ calendarId, savedAt: state.lastSync, events: state.events }));
  } catch { /* stockage indisponible : pas de cache hors ligne */ }
}

function loadCache() {
  try {
    const cache = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null');
    if (!cache || cache.calendarId !== calendarId) return;
    state.events = cache.events.map((e) => ({ ...e, start: new Date(e.start), end: new Date(e.end) }));
    state.lastSync = new Date(cache.savedAt);
  } catch { /* cache illisible : ignoré */ }
}

function clearCache() {
  try { localStorage.removeItem(CACHE_KEY); } catch { /* idem */ }
}

// ---------------------------------------------------------------- navigation et horloge

function goToMonth(view) {
  state.view = view;
  // Sans cache, on garde les événements déjà connus : les jours communs aux deux grilles restent justes.
  state.events = monthCache.get(monthKey(view)) ?? state.events;
  render();
  sync();
  clearTimeout(returnHomeTimer);
  if (!sameMonth(view, homeView())) {
    returnHomeTimer = setTimeout(() => goToMonth(homeView()), RETURN_HOME_MS);
  }
}

function onKeyDown(event) {
  if (!els.connect.hidden || event.altKey || event.ctrlKey || event.metaKey) return;
  const delta = { ArrowLeft: -1, PageUp: -1, ArrowRight: 1, PageDown: 1 }[event.key];
  if (delta) goToMonth(shiftMonth(state.view, delta));
  else if (['Home', 'Escape', 't', 'T'].includes(event.key)) goToMonth(monthOf(new Date()));
  else return;
  event.preventDefault();
}

function setupNavigation() {
  document.addEventListener('keydown', onKeyDown);
  els.navPrev.addEventListener('click', () => goToMonth(shiftMonth(state.view, -1)));
  els.navNext.addEventListener('click', () => goToMonth(shiftMonth(state.view, 1)));
  els.navToday.addEventListener('click', () => goToMonth(monthOf(new Date())));
}

function tick() {
  const now = new Date();
  if (dateKey(now) !== state.renderedDay) {
    // Passage à minuit : on suit le nouveau mois si l'écran affichait le mois en cours.
    const previous = new Date(now.getTime() - TICK_MS * 2);
    if (!pinnedView && sameMonth(state.view, monthOf(previous))) state.view = monthOf(now);
    render(now);
    sync();
    return;
  }
  els.clock.textContent = time(now);
  maybeDailyReload(now);
}

// Recharge la page une fois par nuit (vers 3 h) pour prendre les mises à jour, seulement si le site répond.
async function maybeDailyReload(now) {
  if (now.getHours() !== 3 || Date.now() - bootedAt < 2 * 3_600_000) return;
  bootedAt = Date.now();
  try {
    const response = await fetch(location.href, { method: 'HEAD', cache: 'no-store' });
    if (response.ok) location.reload();
  } catch { /* hors ligne : on garde la page actuelle */ }
}

// ---------------------------------------------------------------- kiosque

async function keepScreenAwake() {
  if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try {
    await navigator.wakeLock.request('screen');
  } catch { /* refusé par l'appareil : régler la mise en veille dans les paramètres */ }
}

function setupIdleCursor() {
  let timer;
  const wake = () => {
    document.body.classList.remove('is-idle');
    clearTimeout(timer);
    timer = setTimeout(() => document.body.classList.add('is-idle'), IDLE_CURSOR_MS);
  };
  addEventListener('pointermove', wake);
  wake();
}

function startLoops() {
  setInterval(tick, TICK_MS);
  setInterval(sync, REFRESH_MS);
  addEventListener('online', sync);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    keepScreenAwake();
    sync();
  });
}

// ---------------------------------------------------------------- démarrage

async function boot() {
  setupIdleCursor();
  keepScreenAwake();
  setupNavigation();
  els.connectButton.addEventListener('click', () => {
    auth.login().catch((error) => showConnect(error instanceof AuthError ? error.reason : 'failed'));
  });

  if (isDemo) {
    showCalendar();
    startLoops();
    return sync();
  }

  if (!window.isSecureContext) return showConnect('insecure');
  if (!config.clientId || !config.clientSecret || config.clientId.startsWith('XXXX')) return showConnect('config');
  auth = createAuth(config);

  if (params.has('deconnexion')) {
    await auth.logout();
    clearCache();
    history.replaceState(null, '', location.pathname);
  }

  try {
    await auth.completeLogin();
  } catch (error) {
    console.error('[calendrier]', error);
    return showConnect(error instanceof AuthError ? error.reason : 'failed');
  }
  if (!auth.isConnected()) return showConnect('disconnected');

  loadCache();
  showCalendar();
  startLoops();
  sync();
}

boot();
