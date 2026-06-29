'use strict';

const state = {
  games: [],
  notes: [],
  logs: [],
  consoleOffset: 0,
  consoleSize: 0,
  consoleTruncated: false,
  consoleFilters: {
    debug: false,
    info: true,
    warn: true,
    error: true
  },
  consoleAutoTail: true,
  selectedId: null,
  selectedNoteId: null,
  loadedId: null,
  filter: 'all',
  search: ''
};

const nodes = {
  addGameButton: document.getElementById('addGameButton'),
  closeDialogButton: document.getElementById('closeDialogButton'),
  closeConsoleDialogButton: document.getElementById('closeConsoleDialogButton'),
  addGameDialog: document.getElementById('addGameDialog'),
  clearConsoleButton: document.getElementById('clearConsoleButton'),
  consoleAutoTailCheckbox: document.getElementById('consoleAutoTailCheckbox'),
  consoleButton: document.getElementById('consoleButton'),
  consoleDialog: document.getElementById('consoleDialog'),
  consoleFilterInputs: document.querySelectorAll('[data-console-level]'),
  consoleLog: document.getElementById('consoleLog'),
  consoleSummary: document.getElementById('consoleSummary'),
  copyConsoleButton: document.getElementById('copyConsoleButton'),
  deleteGameButton: document.getElementById('deleteGameButton'),
  detailCover: document.getElementById('detailCover'),
  detailNotes: document.getElementById('detailNotes'),
  detailTitle: document.getElementById('detailTitle'),
  downloadConsoleButton: document.getElementById('downloadConsoleButton'),
  filterButtons: document.querySelectorAll('.filter-button'),
  fullscreenButton: document.getElementById('fullscreenButton'),
  gameFrame: document.getElementById('gameFrame'),
  gameList: document.getElementById('gameList'),
  githubForm: document.getElementById('githubForm'),
  githubFormStatus: document.getElementById('githubFormStatus'),
  isoDropZone: document.getElementById('isoDropZone'),
  isoFileInput: document.getElementById('isoFileInput'),
  isoFileLabel: document.getElementById('isoFileLabel'),
  isoForm: document.getElementById('isoForm'),
  isoFormStatus: document.getElementById('isoFormStatus'),
  isoTitleInput: document.getElementById('isoTitleInput'),
  metaList: document.getElementById('metaList'),
  closeNotesDialogButton: document.getElementById('closeNotesDialogButton'),
  deleteNoteButton: document.getElementById('deleteNoteButton'),
  newNoteButton: document.getElementById('newNoteButton'),
  noteBodyInput: document.getElementById('noteBodyInput'),
  noteTitleInput: document.getElementById('noteTitleInput'),
  notesButton: document.getElementById('notesButton'),
  notesDialog: document.getElementById('notesDialog'),
  notesForm: document.getElementById('notesForm'),
  notesList: document.getElementById('notesList'),
  notesStatus: document.getElementById('notesStatus'),
  openRawButton: document.getElementById('openRawButton'),
  playButton: document.getElementById('playButton'),
  refreshButton: document.getElementById('refreshButton'),
  resetSaveButton: document.getElementById('resetSaveButton'),
  searchInput: document.getElementById('searchInput'),
  selectedBadges: document.getElementById('selectedBadges'),
  selectedSource: document.getElementById('selectedSource'),
  selectedTitle: document.getElementById('selectedTitle'),
  serverStatus: document.getElementById('serverStatus'),
  stageEmpty: document.getElementById('stageEmpty'),
  tabs: document.querySelectorAll('.dialog-tab'),
  uploadProgress: document.getElementById('uploadProgress')
};

let selectedIsoFile = null;
let saveSyncTimer = null;
let logSessionId = null;
let logSessionPromise = null;
let logFlushTimer = null;
let logQueue = [];
let consolePollTimer = null;
let consolePollInFlight = false;
const MAX_RENDERED_LOG_ENTRIES = 180;
const MAX_LOG_QUEUE_ENTRIES = 5000;
const LOG_FLUSH_INTERVAL_MS = 300;
const CONSOLE_POLL_INTERVAL_MS = 900;

function icon(name) {
  return `<svg><use href="#icon-${name}"></use></svg>`;
}

function serializeLogValue(value) {
  if (value instanceof Error) {
    return value.stack || value.message;
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeLogLevel(level) {
  return ['debug', 'info', 'warn', 'error'].includes(level) ? level : 'info';
}

function isConsoleOpen() {
  return Boolean(nodes.consoleDialog.open);
}

function createClientLogEntry(source, level, message, detail = '', time = new Date().toISOString()) {
  return {
    time,
    source: serializeLogValue(source || 'launcher').slice(0, 32),
    level: normalizeLogLevel(level),
    message: Array.isArray(message) ? message.map(serializeLogValue).join(' ') : serializeLogValue(message),
    detail: detail ? serializeLogValue(detail) : ''
  };
}

function createClientLogEntryFromPayload(payload, fallbackSource = 'engine') {
  return createClientLogEntry(
    payload && payload.source ? payload.source : fallbackSource,
    payload && payload.level ? payload.level : 'info',
    payload && payload.args ? payload.args : payload && payload.message ? payload.message : '',
    payload && payload.detail ? payload.detail : payload && payload.stack ? payload.stack : '',
    payload && payload.time ? payload.time : new Date().toISOString()
  );
}

function selectedConsoleLevels() {
  return Object.entries(state.consoleFilters)
    .filter(([, enabled]) => enabled)
    .map(([level]) => level);
}

function consoleLevelsQuery() {
  const levels = selectedConsoleLevels();
  return levels.length ? levels.join(',') : 'error';
}

function ensureLogSession() {
  if (logSessionId) {
    return Promise.resolve(logSessionId);
  }

  if (!logSessionPromise) {
    logSessionPromise = fetch('/api/logs/sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ title: 'Reksio UI session' })
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Log session failed with ${response.status}`);
        }

        return response.json();
      })
      .then((body) => {
        logSessionId = body.sessionId;
        return logSessionId;
      })
      .catch((error) => {
        logSessionPromise = null;
        console.warn('Failed to create log session', error);
        throw error;
      });
  }

  return logSessionPromise;
}

function trimLogQueue() {
  if (logQueue.length <= MAX_LOG_QUEUE_ENTRIES) {
    return;
  }

  const dropped = logQueue.length - MAX_LOG_QUEUE_ENTRIES;
  logQueue.splice(0, dropped);
  logQueue.unshift(createClientLogEntry('launcher', 'warn', `Dropped ${dropped} queued logs before they reached the server`));
}

function scheduleLogFlush(delay = LOG_FLUSH_INTERVAL_MS) {
  if (logFlushTimer) {
    return;
  }

  logFlushTimer = setTimeout(() => {
    logFlushTimer = null;
    flushLogQueue();
  }, delay);
}

async function flushLogQueue() {
  if (!logQueue.length) {
    return;
  }

  const batch = logQueue.splice(0, 1000);

  try {
    const sessionId = await ensureLogSession();
    const response = await fetch(`/api/logs/${encodeURIComponent(sessionId)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ entries: batch })
    });

    if (!response.ok) {
      throw new Error(`Log append failed with ${response.status}`);
    }

    if (isConsoleOpen()) {
      pollConsoleLogs();
    }
  } catch (error) {
    logQueue = batch.concat(logQueue).slice(-MAX_LOG_QUEUE_ENTRIES);
    console.warn('Failed to flush logs', error);
    scheduleLogFlush(2000);
    return;
  }

  if (logQueue.length) {
    scheduleLogFlush(0);
  }
}

function queueLogEntries(entries) {
  logQueue.push(...entries);
  trimLogQueue();
  scheduleLogFlush();
}

function addLog(source, level, message, detail = '') {
  queueLogEntries([createClientLogEntry(source, level, message, detail)]);
}

function formatLogTime(value) {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(value));
}

function formatLogBytes(bytes) {
  return bytes ? formatBytes(bytes) : '0 B';
}

function renderConsole() {
  const renderedLogs = state.logs.slice(-MAX_RENDERED_LOG_ENTRIES);
  const truncatedCount = state.logs.length - renderedLogs.length;
  const counts = state.logs.reduce(
    (totals, entry) => {
      totals[entry.level] += 1;
      return totals;
    },
    { debug: 0, info: 0, warn: 0, error: 0 }
  );

  nodes.consoleSummary.textContent = state.logs.length
    ? `${state.logs.length} visible - ${counts.error} errors - ${counts.warn} warnings - ${formatLogBytes(state.consoleSize)} file`
    : logSessionId
      ? `No visible logs - ${formatLogBytes(state.consoleSize)} file`
      : 'Starting log session';

  nodes.consoleLog.innerHTML = state.logs.length
    ? [
        truncatedCount > 0
          ? `<div class="console-truncated">Showing latest ${MAX_RENDERED_LOG_ENTRIES} visible entries from the server log tail.</div>`
          : '',
        state.consoleTruncated ? '<div class="console-truncated">Earlier matching logs are available in the full log download.</div>' : '',
        ...renderedLogs.map(
          (entry) => `
            <article class="console-entry ${entry.level}">
              <div class="console-entry-meta">
                <span>${escapeHtml(formatLogTime(entry.time))}</span>
                <span>${escapeHtml(entry.source)}</span>
                <span>${escapeHtml(entry.level.toUpperCase())}</span>
              </div>
              <pre>${escapeHtml(entry.message)}${entry.detail ? `\n${escapeHtml(entry.detail)}` : ''}</pre>
            </article>
          `
        )
      ].join('')
    : '<div class="console-empty">Logs from the launcher and game iframe will appear here.</div>';

  nodes.consoleLog.scrollTop = nodes.consoleLog.scrollHeight;
}

async function pollConsoleLogs(reset = false) {
  if (consolePollInFlight) {
    return;
  }

  consolePollInFlight = true;

  try {
    const sessionId = await ensureLogSession();
    const params = new URLSearchParams({
      levels: consoleLevelsQuery(),
      limit: '500'
    });

    if (!reset) {
      params.set('offset', String(state.consoleOffset));
    }

    const body = await apiFetch(`/api/logs/${encodeURIComponent(sessionId)}?${params.toString()}`);

    if (reset) {
      state.logs = [];
    }

    if (body.entries.length) {
      state.logs.push(...body.entries);
      state.logs.splice(0, Math.max(0, state.logs.length - 500));
    }

    state.consoleOffset = body.nextOffset;
    state.consoleSize = body.size;
    state.consoleTruncated = body.truncated;
    renderConsole();
  } catch (error) {
    state.logs.push(createClientLogEntry('launcher', 'error', 'Failed to poll server log', error));
    state.logs.splice(0, Math.max(0, state.logs.length - 500));
    renderConsole();
  } finally {
    consolePollInFlight = false;
  }
}

function startConsoleTail(reset = false) {
  stopConsoleTail();
  pollConsoleLogs(reset);

  if (state.consoleAutoTail) {
    consolePollTimer = setInterval(() => pollConsoleLogs(), CONSOLE_POLL_INTERVAL_MS);
  }
}

function stopConsoleTail() {
  if (consolePollTimer) {
    clearInterval(consolePollTimer);
    consolePollTimer = null;
  }
}

function openConsoleDialog() {
  nodes.consoleDialog.showModal();
  startConsoleTail(true);
}

async function clearConsole() {
  await flushLogQueue();

  if (logSessionId) {
    await fetch(`/api/logs/${encodeURIComponent(logSessionId)}`, { method: 'DELETE' });
  }

  state.logs = [];
  state.consoleOffset = 0;
  state.consoleSize = 0;
  state.consoleTruncated = false;
  renderConsole();
  addLog('launcher', 'info', 'Console cleared');
}

function absoluteUrl(value) {
  return new URL(value, window.location.href).href;
}

function copyTextFallback(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    return document.execCommand('copy');
  } finally {
    textarea.remove();
  }
}

async function copyConsole() {
  const text = state.logs
    .map((entry) => `[${entry.time}] [${entry.source}] [${entry.level}] ${entry.message}${entry.detail ? `\n${entry.detail}` : ''}`)
    .join('\n');

  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(text);
      } catch (error) {
        if (!copyTextFallback(text)) {
          throw error;
        }
      }
    } else if (!copyTextFallback(text)) {
      throw new Error('Clipboard API is unavailable in this browser context.');
    }

    addLog('launcher', 'info', 'Console copied to clipboard');
  } catch (error) {
    addLog('launcher', 'error', 'Failed to copy console', error);
  }
}

function getSelectedGame() {
  return state.games.find((game) => game.id === state.selectedId) || null;
}

function saveSlotKey(gameId) {
  return `reksioLauncher.save.${gameId}`;
}

function syncCurrentSave() {
  if (!state.loadedId) {
    return;
  }

  const content = localStorage.getItem('saveFile');

  if (content) {
    localStorage.setItem(saveSlotKey(state.loadedId), content);
  }
}

function prepareSaveSlot(gameId) {
  const content = localStorage.getItem(saveSlotKey(gameId));

  if (content) {
    localStorage.setItem('saveFile', content);
  } else {
    localStorage.removeItem('saveFile');
  }
}

function formatBytes(bytes) {
  if (!bytes) {
    return 'Not stored';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDate(value) {
  if (!value) {
    return 'Bundled';
  }

  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  }).format(new Date(value));
}

function initials(title) {
  return title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('') || 'R';
}

function sourceLabel(game) {
  if (game.type === 'iso') {
    return 'Local ISO';
  }

  return game.builtin ? 'Bundled GitHub' : 'GitHub source';
}

function languageCode(game) {
  return (game.locale || game.language || 'custom').slice(0, 2).toUpperCase();
}

function buildLaunchUrl(game) {
  const params = new URLSearchParams();

  if (game.type === 'iso') {
    params.set('loader', 'iso-remote');
    params.set('source', absoluteUrl(game.isoUrl));
  } else {
    params.set('loader', 'github');
    params.set('source', game.source);
  }

  return `/engine/?${params.toString()}`;
}

function handleEngineMessage(event) {
  if (event.origin !== window.location.origin) {
    return;
  }

  const data = event.data;

  if (!data || typeof data !== 'object') {
    return;
  }

  if (data.type === 'reksio:console-batch') {
    const entries = Array.isArray(data.entries) ? data.entries : [];
    queueLogEntries(entries.map((entry) => createClientLogEntryFromPayload(entry)));
  }

  if (data.type === 'reksio:console') {
    addLog(data.source || 'engine', data.level || 'info', data.args || data.message || '');
  }

  if (data.type === 'reksio:error') {
    addLog(data.source || 'engine', 'error', data.message || 'Unhandled engine error', data.stack || '');
  }
}

async function apiFetch(url, options = {}) {
  const response = await fetch(url, options);

  if (!response.ok) {
    let message = `Request failed with ${response.status}`;

    try {
      const body = await response.json();
      message = body.error || message;
    } catch {
      /* ignore non-json error bodies */
    }

    throw new Error(message);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

function getSelectedNote() {
  return state.notes.find((note) => note.id === state.selectedNoteId) || null;
}

function notePreview(note) {
  return (note.body || '').replace(/\s+/g, ' ').trim() || 'No note body yet.';
}

function setNotesStatus(message) {
  nodes.notesStatus.textContent = message;
}

function renderNotes() {
  if (!state.notes.length) {
    nodes.notesList.innerHTML = '<div class="notes-empty">No notes yet</div>';
  } else {
    nodes.notesList.innerHTML = state.notes
      .map((note) => {
        const active = note.id === state.selectedNoteId ? ' active' : '';
        return `
          <button class="note-item${active}" type="button" data-note-id="${note.id}">
            <span class="note-title">${escapeHtml(note.title)}</span>
            <span class="note-preview">${escapeHtml(notePreview(note))}</span>
          </button>
        `;
      })
      .join('');
  }

  nodes.notesList.querySelectorAll('.note-item').forEach((button) => {
    button.addEventListener('click', () => selectNote(button.dataset.noteId));
  });

  renderNoteEditor();
}

function renderNoteEditor() {
  const note = getSelectedNote();

  if (!note) {
    nodes.noteTitleInput.value = '';
    nodes.noteBodyInput.value = '';
    nodes.deleteNoteButton.disabled = true;
    setNotesStatus(state.notes.length ? 'Select a note or create a new one.' : 'Create your first note.');
    return;
  }

  nodes.noteTitleInput.value = note.title;
  nodes.noteBodyInput.value = note.body;
  nodes.deleteNoteButton.disabled = false;
  setNotesStatus(`Last saved ${formatDate(note.updatedAt)}`);
}

function selectNote(noteId) {
  state.selectedNoteId = noteId;
  renderNotes();
}

function startNewNote() {
  state.selectedNoteId = null;
  nodes.noteTitleInput.value = '';
  nodes.noteBodyInput.value = '';
  nodes.deleteNoteButton.disabled = true;
  nodes.noteTitleInput.focus();
  setNotesStatus('New note');
  renderNotes();
}

async function loadNotes() {
  setNotesStatus('Loading notes');
  const body = await apiFetch('/api/notes');
  state.notes = body.notes;

  if (state.selectedNoteId && !state.notes.some((note) => note.id === state.selectedNoteId)) {
    state.selectedNoteId = null;
  }

  if (!state.selectedNoteId && state.notes.length) {
    state.selectedNoteId = state.notes[0].id;
  }

  renderNotes();
}

async function openNotesDialog() {
  nodes.notesDialog.showModal();

  try {
    await loadNotes();
  } catch (error) {
    addLog('launcher', 'error', 'Failed to open notes', error);
    setNotesStatus(error.message);
  }
}

async function saveCurrentNote(event) {
  event.preventDefault();

  const payload = {
    title: nodes.noteTitleInput.value,
    body: nodes.noteBodyInput.value
  };
  const selectedNote = getSelectedNote();
  const url = selectedNote ? `/api/notes/${encodeURIComponent(selectedNote.id)}` : '/api/notes';
  const method = selectedNote ? 'PUT' : 'POST';

  try {
    setNotesStatus('Saving');
    const result = await apiFetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    await loadNotes();
    state.selectedNoteId = result.note.id;
    renderNotes();
    setNotesStatus('Saved');
  } catch (error) {
    addLog('launcher', 'error', 'Failed to save note', error);
    setNotesStatus(error.message);
  }
}

async function deleteCurrentNote() {
  const note = getSelectedNote();

  if (!note) {
    return;
  }

  const confirmed = window.confirm(`Delete "${note.title}"?`);

  if (!confirmed) {
    return;
  }

  try {
    setNotesStatus('Deleting');
    await apiFetch(`/api/notes/${encodeURIComponent(note.id)}`, { method: 'DELETE' });
    state.selectedNoteId = null;
    await loadNotes();
  } catch (error) {
    addLog('launcher', 'error', 'Failed to delete note', error);
    setNotesStatus(error.message);
  }
}

function filteredGames() {
  const term = state.search.toLowerCase();

  return state.games.filter((game) => {
    const matchesFilter =
      state.filter === 'all' ||
      (state.filter === 'local' && game.type === 'iso') ||
      game.locale === state.filter;

    const matchesSearch =
      !term ||
      game.title.toLowerCase().includes(term) ||
      (game.originalTitle || '').toLowerCase().includes(term) ||
      (game.source || '').toLowerCase().includes(term) ||
      game.language.toLowerCase().includes(term);

    return matchesFilter && matchesSearch;
  });
}

function renderGames() {
  const games = filteredGames();

  if (!games.length) {
    nodes.gameList.innerHTML = '<div class="list-empty">No matching games</div>';
    return;
  }

  nodes.gameList.innerHTML = games
    .map((game) => {
      const active = game.id === state.selectedId ? ' active' : '';
      const userTag = game.builtin ? '' : '<span class="mini-tag">Added</span>';

      return `
        <button class="game-item${active}" type="button" data-game-id="${game.id}">
          <span class="game-avatar">${initials(game.title)}</span>
          <span class="game-copy">
            <span class="game-title">${escapeHtml(game.title)}</span>
            <span class="game-meta">${escapeHtml(languageCode(game))} - ${escapeHtml(sourceLabel(game))}</span>
          </span>
          ${userTag}
        </button>
      `;
    })
    .join('');

  nodes.gameList.querySelectorAll('.game-item').forEach((button) => {
    button.addEventListener('click', () => selectGame(button.dataset.gameId, true));
  });
}

function renderDetails() {
  const game = getSelectedGame();

  if (!game) {
    nodes.selectedTitle.textContent = 'No game selected';
    nodes.selectedSource.textContent = 'Library';
    nodes.selectedBadges.innerHTML = '';
    nodes.detailTitle.textContent = 'Game details';
    nodes.detailNotes.textContent = 'Your library is empty.';
    nodes.detailCover.textContent = 'R';
    nodes.metaList.innerHTML = '';
    nodes.stageEmpty.hidden = false;
    nodes.gameFrame.hidden = true;
    nodes.playButton.disabled = true;
    nodes.openRawButton.disabled = true;
    nodes.fullscreenButton.disabled = true;
    nodes.resetSaveButton.disabled = true;
    nodes.deleteGameButton.disabled = true;
    return;
  }

  nodes.selectedTitle.textContent = game.title;
  nodes.selectedSource.textContent = sourceLabel(game);
  nodes.selectedBadges.innerHTML = `
    <span class="badge">${escapeHtml(languageCode(game))}</span>
    <span class="badge">${game.type === 'iso' ? 'ISO' : 'GitHub'}</span>
  `;
  nodes.detailTitle.textContent = game.title;
  nodes.detailNotes.textContent = game.notes || game.originalTitle || sourceLabel(game);
  nodes.detailCover.textContent = initials(game.title);

  const rows = [
    ['Source', sourceLabel(game)],
    ['Stored size', game.type === 'iso' ? formatBytes(game.size) : 'Remote assets'],
    ['Added', formatDate(game.createdAt)],
    ['Identifier', game.type === 'iso' ? game.originalFilename || game.id : game.source]
  ];

  nodes.metaList.innerHTML = rows
    .map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`)
    .join('');

  nodes.stageEmpty.hidden = true;
  nodes.gameFrame.hidden = false;
  nodes.playButton.disabled = false;
  nodes.openRawButton.disabled = false;
  nodes.fullscreenButton.disabled = false;
  nodes.resetSaveButton.disabled = false;
  nodes.deleteGameButton.disabled = game.builtin;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function selectGame(gameId, shouldLoad) {
  const game = state.games.find((entry) => entry.id === gameId);

  if (!game) {
    return;
  }

  state.selectedId = game.id;
  renderGames();
  renderDetails();

  const url = new URL(window.location.href);
  url.searchParams.set('game', game.id);
  window.history.replaceState(null, '', url);

  if (shouldLoad) {
    loadSelectedGame();
  }
}

async function logIsoEndpoint(game) {
  if (game.type !== 'iso' || !game.isoUrl) {
    return;
  }

  const isoUrl = absoluteUrl(game.isoUrl);

  try {
    const response = await fetch(isoUrl, {
      cache: 'no-store',
      headers: {
        Range: 'bytes=0-0'
      }
    });
    const sample = await response.arrayBuffer();
    const statusText = [response.status, response.statusText].filter(Boolean).join(' ');
    const detail = [
      `url: ${isoUrl}`,
      `accept-ranges: ${response.headers.get('accept-ranges') || 'missing'}`,
      `content-range: ${response.headers.get('content-range') || 'missing'}`,
      `content-length: ${response.headers.get('content-length') || 'missing'}`,
      `content-type: ${response.headers.get('content-type') || 'missing'}`,
      `sample-bytes: ${sample.byteLength}`
    ].join('\n');

    addLog('launcher', response.ok || response.status === 206 ? 'info' : 'warn', `ISO probe ${statusText}`, detail);
  } catch (error) {
    addLog('launcher', 'error', 'ISO probe failed', error);
  }
}

function loadSelectedGame() {
  const game = getSelectedGame();

  if (!game) {
    return;
  }

  syncCurrentSave();
  prepareSaveSlot(game.id);
  const launchUrl = buildLaunchUrl(game);
  addLog('launcher', 'info', `Loading ${game.title}`, launchUrl);
  logIsoEndpoint(game);
  nodes.gameFrame.src = launchUrl;
  state.loadedId = game.id;
  renderDetails();

  clearInterval(saveSyncTimer);
  saveSyncTimer = setInterval(syncCurrentSave, 2000);
}

async function loadGames(preferredId) {
  nodes.serverStatus.textContent = 'Loading library';

  try {
    const body = await apiFetch('/api/games');
    state.games = body.games;
    nodes.serverStatus.textContent = `${state.games.length} games available`;

    const queryGame = new URLSearchParams(window.location.search).get('game');
    const nextId =
      preferredId ||
      (queryGame && state.games.some((game) => game.id === queryGame) ? queryGame : null) ||
      (state.selectedId && state.games.some((game) => game.id === state.selectedId) ? state.selectedId : null) ||
      (state.games[0] && state.games[0].id);

    renderGames();

    if (nextId) {
      selectGame(nextId, state.loadedId === null);
    } else {
      renderDetails();
    }
  } catch (error) {
    addLog('launcher', 'error', 'Failed to load games', error);
    nodes.serverStatus.textContent = error.message;
    nodes.gameList.innerHTML = `<div class="list-empty">${escapeHtml(error.message)}</div>`;
    renderDetails();
  }
}

function openDialog() {
  nodes.isoForm.reset();
  nodes.githubForm.reset();
  nodes.githubForm.querySelector('[name="language"]').value = 'Polish';
  nodes.githubForm.querySelector('[name="locale"]').value = 'pl';
  nodes.isoForm.querySelector('[name="language"]').value = 'Romanian';
  nodes.isoForm.querySelector('[name="locale"]').value = 'ro';
  selectedIsoFile = null;
  nodes.isoFileLabel.textContent = 'Select ISO file';
  nodes.uploadProgress.style.width = '0%';
  nodes.isoFormStatus.textContent = '';
  nodes.githubFormStatus.textContent = '';
  setDialogTab('iso');
  nodes.addGameDialog.showModal();
}

function setDialogTab(tabName) {
  nodes.tabs.forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === tabName);
  });

  document.querySelectorAll('.dialog-pane').forEach((pane) => {
    pane.classList.toggle('active', pane.id === `${tabName}Form`);
  });
}

function setIsoFile(file) {
  selectedIsoFile = file || null;

  if (!selectedIsoFile) {
    nodes.isoFileLabel.textContent = 'Select ISO file';
    return;
  }

  nodes.isoFileLabel.textContent = `${selectedIsoFile.name} - ${formatBytes(selectedIsoFile.size)}`;

  if (!nodes.isoTitleInput.value.trim()) {
    nodes.isoTitleInput.value = selectedIsoFile.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
  }
}

function uploadIso(event) {
  event.preventDefault();

  if (!selectedIsoFile) {
    nodes.isoFormStatus.textContent = 'Select an ISO first.';
    return;
  }

  const formData = new FormData(nodes.isoForm);
  formData.set('title', formData.get('title') || selectedIsoFile.name.replace(/\.[^.]+$/, ''));
  formData.set('iso', selectedIsoFile, selectedIsoFile.name);

  const request = new XMLHttpRequest();
  nodes.isoFormStatus.textContent = 'Uploading';
  nodes.uploadProgress.style.width = '0%';

  request.upload.addEventListener('progress', (progressEvent) => {
    if (progressEvent.lengthComputable) {
      const percent = Math.round((progressEvent.loaded / progressEvent.total) * 100);
      nodes.uploadProgress.style.width = `${percent}%`;
      nodes.isoFormStatus.textContent = `Uploading ${percent}%`;
    }
  });

  request.addEventListener('load', async () => {
    let body = {};

    try {
      body = JSON.parse(request.responseText || '{}');
    } catch {
      body = {};
    }

    if (request.status < 200 || request.status >= 300) {
      nodes.isoFormStatus.textContent = body.error || `Upload failed with ${request.status}`;
      return;
    }

    nodes.isoFormStatus.textContent = 'Uploaded';
    nodes.addGameDialog.close();
    await loadGames(body.game && body.game.id);
    selectGame(body.game.id, true);
  });

  request.addEventListener('error', () => {
    nodes.isoFormStatus.textContent = 'Upload failed.';
  });

  request.open('POST', '/api/games');
  request.send(formData);
}

async function addGithubSource(event) {
  event.preventDefault();
  nodes.githubFormStatus.textContent = 'Adding';

  try {
    const formData = new FormData(nodes.githubForm);
    const body = Object.fromEntries(formData.entries());
    const result = await apiFetch('/api/games/github', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    nodes.githubFormStatus.textContent = 'Added';
    nodes.addGameDialog.close();
    await loadGames(result.game.id);
    selectGame(result.game.id, true);
  } catch (error) {
    addLog('launcher', 'error', 'Failed to add GitHub source', error);
    nodes.githubFormStatus.textContent = error.message;
  }
}

async function deleteSelectedGame() {
  const game = getSelectedGame();

  if (!game || game.builtin) {
    return;
  }

  const confirmed = window.confirm(`Remove "${game.title}" from this launcher?`);

  if (!confirmed) {
    return;
  }

  await apiFetch(`/api/games/${encodeURIComponent(game.id)}`, { method: 'DELETE' });
  localStorage.removeItem(saveSlotKey(game.id));
  state.selectedId = null;
  state.loadedId = state.loadedId === game.id ? null : state.loadedId;
  await loadGames();
}

function resetSelectedSave() {
  const game = getSelectedGame();

  if (!game) {
    return;
  }

  const confirmed = window.confirm(`Reset save data for "${game.title}"?`);

  if (!confirmed) {
    return;
  }

  localStorage.removeItem(saveSlotKey(game.id));

  if (state.loadedId === game.id) {
    localStorage.removeItem('saveFile');
    loadSelectedGame();
  }
}

nodes.addGameButton.addEventListener('click', openDialog);
nodes.closeDialogButton.addEventListener('click', () => nodes.addGameDialog.close());
nodes.consoleButton.addEventListener('click', openConsoleDialog);
nodes.closeConsoleDialogButton.addEventListener('click', () => {
  nodes.consoleDialog.close();
  stopConsoleTail();
});
nodes.clearConsoleButton.addEventListener('click', () => {
  clearConsole().catch((error) => addLog('launcher', 'error', 'Failed to clear console', error));
});
nodes.copyConsoleButton.addEventListener('click', copyConsole);
nodes.downloadConsoleButton.addEventListener('click', async () => {
  const sessionId = await ensureLogSession();
  window.open(`/api/logs/${encodeURIComponent(sessionId)}/download`, '_blank', 'noopener');
});
nodes.consoleAutoTailCheckbox.addEventListener('change', (event) => {
  state.consoleAutoTail = event.target.checked;

  if (isConsoleOpen()) {
    startConsoleTail();
  }
});
nodes.consoleFilterInputs.forEach((input) => {
  state.consoleFilters[input.dataset.consoleLevel] = input.checked;
  input.addEventListener('change', () => {
    state.consoleFilters[input.dataset.consoleLevel] = input.checked;

    if (isConsoleOpen()) {
      startConsoleTail(true);
    }
  });
});
nodes.notesButton.addEventListener('click', openNotesDialog);
nodes.closeNotesDialogButton.addEventListener('click', () => nodes.notesDialog.close());
nodes.newNoteButton.addEventListener('click', startNewNote);
nodes.notesForm.addEventListener('submit', saveCurrentNote);
nodes.deleteNoteButton.addEventListener('click', deleteCurrentNote);
nodes.refreshButton.addEventListener('click', () => loadGames());
nodes.searchInput.addEventListener('input', (event) => {
  state.search = event.target.value;
  renderGames();
});

nodes.filterButtons.forEach((button) => {
  button.addEventListener('click', () => {
    state.filter = button.dataset.filter;
    nodes.filterButtons.forEach((entry) => entry.classList.toggle('active', entry === button));
    renderGames();
  });
});

nodes.tabs.forEach((button) => {
  button.addEventListener('click', () => setDialogTab(button.dataset.tab));
});

nodes.isoFileInput.addEventListener('change', (event) => {
  setIsoFile(event.target.files && event.target.files[0]);
});

nodes.isoDropZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  nodes.isoDropZone.classList.add('dragging');
});

nodes.isoDropZone.addEventListener('dragleave', () => {
  nodes.isoDropZone.classList.remove('dragging');
});

nodes.isoDropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  nodes.isoDropZone.classList.remove('dragging');
  setIsoFile(event.dataTransfer.files && event.dataTransfer.files[0]);
});

nodes.isoForm.addEventListener('submit', uploadIso);
nodes.githubForm.addEventListener('submit', addGithubSource);
nodes.playButton.addEventListener('click', loadSelectedGame);
nodes.openRawButton.addEventListener('click', () => {
  if (nodes.gameFrame.src) {
    window.open(nodes.gameFrame.src, '_blank', 'noopener');
  }
});
nodes.fullscreenButton.addEventListener('click', () => {
  if (nodes.gameFrame.requestFullscreen) {
    nodes.gameFrame.requestFullscreen();
  }
});
nodes.deleteGameButton.addEventListener('click', () => {
  deleteSelectedGame().catch((error) => {
    addLog('launcher', 'error', 'Failed to delete game', error);
    nodes.serverStatus.textContent = error.message;
  });
});
nodes.resetSaveButton.addEventListener('click', resetSelectedSave);
nodes.gameFrame.addEventListener('load', () => {
  syncCurrentSave();
  addLog('launcher', 'info', 'Game iframe loaded', nodes.gameFrame.src);
});
nodes.consoleDialog.addEventListener('close', stopConsoleTail);
window.addEventListener('message', handleEngineMessage);
window.addEventListener('error', (event) => {
  addLog('launcher', 'error', event.message, `${event.filename}:${event.lineno}:${event.colno}`);
});
window.addEventListener('unhandledrejection', (event) => {
  addLog('launcher', 'error', 'Unhandled promise rejection', event.reason);
});
window.addEventListener('beforeunload', syncCurrentSave);

addLog('launcher', 'info', 'Launcher ready');
loadGames();
