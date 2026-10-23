'use strict';

const launcherParams = new URLSearchParams(window.location.search);

const state = {
  games: [],
  notes: [],
  snapshots: [],
  snapshotBusy: false,
  selectedId: null,
  selectedNoteId: null,
  loadedId: null,
  traceEnabled:
    launcherParams.get('trace') === '1' ||
    launcherParams.get('trace') === 'true' ||
    localStorage.getItem('reksioLauncher.traceEnabled') === 'true',
  filter: 'all',
  search: ''
};

const nodes = {
  addGameButton: document.getElementById('addGameButton'),
  closeDialogButton: document.getElementById('closeDialogButton'),
  closeSnapshotsDialogButton: document.getElementById('closeSnapshotsDialogButton'),
  addGameDialog: document.getElementById('addGameDialog'),
  clearLogsButton: document.getElementById('clearLogsButton'),
  createSnapshotButton: document.getElementById('createSnapshotButton'),
  deleteGameButton: document.getElementById('deleteGameButton'),
  detailCover: document.getElementById('detailCover'),
  detailNotes: document.getElementById('detailNotes'),
  detailTitle: document.getElementById('detailTitle'),
  filterButtons: document.querySelectorAll('.filter-button'),
  fullscreenButton: document.getElementById('fullscreenButton'),
  gameFrame: document.getElementById('gameFrame'),
  gameList: document.getElementById('gameList'),
  hideCursorButton: document.getElementById('hideCursorButton'),
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
  refreshButton: document.getElementById('refreshButton'),
  resetSaveButton: document.getElementById('resetSaveButton'),
  saveLogsButton: document.getElementById('saveLogsButton'),
  searchInput: document.getElementById('searchInput'),
  selectedBadges: document.getElementById('selectedBadges'),
  selectedSource: document.getElementById('selectedSource'),
  selectedTitle: document.getElementById('selectedTitle'),
  serverStatus: document.getElementById('serverStatus'),
  snapshotList: document.getElementById('snapshotList'),
  snapshotSummary: document.getElementById('snapshotSummary'),
  snapshotsButton: document.getElementById('snapshotsButton'),
  snapshotsDialog: document.getElementById('snapshotsDialog'),
  stageEmpty: document.getElementById('stageEmpty'),
  tabs: document.querySelectorAll('.dialog-tab'),
  toast: document.getElementById('toast'),
  traceButton: document.getElementById('traceButton'),
  uploadProgress: document.getElementById('uploadProgress')
};

let selectedIsoFile = null;
let saveSyncTimer = null;
let logSessionId = null;
let logSessionPromise = null;
let logFlushTimer = null;
let logQueue = [];
let toastTimer = null;
let snapshotDbPromise = null;
const MAX_LOG_QUEUE_ENTRIES = 1000;
const MAX_LOG_MESSAGE_CHARS = 4000;
const MAX_LOG_DETAIL_CHARS = 8000;
const LOG_FLUSH_BATCH_SIZE = 250;
const LOG_FLUSH_INTERVAL_MS = 300;
const SNAPSHOT_DB_NAME = 'reksio-launcher';
const SNAPSHOT_DB_VERSION = 1;
const SNAPSHOT_STORE_NAME = 'snapshots';
const SNAPSHOT_GAME_INDEX = 'gameId';
const ENGINE_DB_NAME = 'reksio';
const ENGINE_FILESYSTEM_STORE_NAME = 'filesystem';
const GAME_CURSOR_STYLE_ID = 'reksio-launcher-hide-cursor-style';

function icon(name) {
  return `<svg><use href="#icon-${name}"></use></svg>`;
}

function requireIndexedDb() {
  if (!window.indexedDB) {
    throw new Error('IndexedDB is not available in this browser.');
  }
}

function openDatabase(name, version, upgradeCallback) {
  requireIndexedDb();

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);

    request.onupgradeneeded = (event) => {
      if (upgradeCallback) {
        upgradeCallback(request.result, event);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error(`Failed to open IndexedDB database ${name}.`));
    request.onblocked = () => reject(new Error(`IndexedDB database ${name} is blocked by another tab.`));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed.'));
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted.'));
  });
}

function getSnapshotDb() {
  if (!snapshotDbPromise) {
    snapshotDbPromise = openDatabase(SNAPSHOT_DB_NAME, SNAPSHOT_DB_VERSION, (db, event) => {
      let store;

      if (!db.objectStoreNames.contains(SNAPSHOT_STORE_NAME)) {
        store = db.createObjectStore(SNAPSHOT_STORE_NAME, { keyPath: 'id' });
      } else {
        store = event.target.transaction.objectStore(SNAPSHOT_STORE_NAME);
      }

      if (!store.indexNames.contains(SNAPSHOT_GAME_INDEX)) {
        store.createIndex(SNAPSHOT_GAME_INDEX, SNAPSHOT_GAME_INDEX, { unique: false });
      }
    }).catch((error) => {
      snapshotDbPromise = null;
      throw error;
    });
  }

  return snapshotDbPromise;
}

function openEngineFilesystemDb(gameId = state.selectedId) {
  return openDatabase(gameId ? `reksio-${gameId}` : ENGINE_DB_NAME, undefined, (db) => {
    if (!db.objectStoreNames.contains(ENGINE_FILESYSTEM_STORE_NAME)) {
      db.createObjectStore(ENGINE_FILESYSTEM_STORE_NAME);
    }
  });
}

async function getSnapshotsForGame(gameId) {
  const db = await getSnapshotDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SNAPSHOT_STORE_NAME, 'readonly');
    const index = transaction.objectStore(SNAPSHOT_STORE_NAME).index(SNAPSHOT_GAME_INDEX);
    const request = index.getAll(gameId);

    request.onsuccess = () => {
      resolve(
        request.result
          .slice()
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      );
    };
    request.onerror = () => reject(request.error || new Error('Failed to load snapshots.'));
  });
}

async function getSnapshot(snapshotId) {
  const db = await getSnapshotDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SNAPSHOT_STORE_NAME, 'readonly');
    const request = transaction.objectStore(SNAPSHOT_STORE_NAME).get(snapshotId);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error('Failed to load snapshot.'));
  });
}

async function putSnapshot(snapshot) {
  const db = await getSnapshotDb();
  const transaction = db.transaction(SNAPSHOT_STORE_NAME, 'readwrite');

  transaction.objectStore(SNAPSHOT_STORE_NAME).put(snapshot);
  await transactionDone(transaction);
}

async function deleteSnapshotById(snapshotId) {
  const db = await getSnapshotDb();
  const transaction = db.transaction(SNAPSHOT_STORE_NAME, 'readwrite');

  transaction.objectStore(SNAPSHOT_STORE_NAME).delete(snapshotId);
  await transactionDone(transaction);
}

async function deleteSnapshotsForGame(gameId) {
  const snapshots = await getSnapshotsForGame(gameId);

  if (!snapshots.length) {
    return;
  }

  const db = await getSnapshotDb();
  const transaction = db.transaction(SNAPSHOT_STORE_NAME, 'readwrite');
  const store = transaction.objectStore(SNAPSHOT_STORE_NAME);

  snapshots.forEach((snapshot) => store.delete(snapshot.id));
  await transactionDone(transaction);
}

async function dumpEngineFilesystem() {
  const db = await openEngineFilesystemDb();

  try {
    if (!db.objectStoreNames.contains(ENGINE_FILESYSTEM_STORE_NAME)) {
      return [];
    }

    return await new Promise((resolve, reject) => {
      const entries = [];
      const transaction = db.transaction(ENGINE_FILESYSTEM_STORE_NAME, 'readonly');
      const request = transaction.objectStore(ENGINE_FILESYSTEM_STORE_NAME).openCursor();

      request.onsuccess = () => {
        const cursor = request.result;

        if (!cursor) {
          resolve(entries);
          return;
        }

        entries.push({
          key: cursor.key,
          value: cursor.value
        });
        cursor.continue();
      };
      request.onerror = () => reject(request.error || new Error('Failed to read engine filesystem.'));
    });
  } finally {
    db.close();
  }
}

async function replaceEngineFilesystem(entries) {
  const db = await openEngineFilesystemDb();

  try {
    const transaction = db.transaction(ENGINE_FILESYSTEM_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(ENGINE_FILESYSTEM_STORE_NAME);

    store.clear();
    entries.forEach((entry) => store.put(entry.value, entry.key));
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

function createSnapshotId() {
  const randomPart =
    window.crypto && typeof window.crypto.randomUUID === 'function'
      ? window.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  return `snapshot-${randomPart}`;
}

function storedValueSize(value) {
  if (value instanceof ArrayBuffer || Object.prototype.toString.call(value) === '[object ArrayBuffer]') {
    return value.byteLength;
  }

  if (ArrayBuffer.isView(value)) {
    return value.byteLength;
  }

  if (value instanceof Blob) {
    return value.size;
  }

  if (typeof value === 'string') {
    return new Blob([value]).size;
  }

  if (value == null) {
    return 0;
  }

  try {
    return new Blob([JSON.stringify(value)]).size;
  } catch {
    return 0;
  }
}

function estimateSnapshotSize(snapshot) {
  const filesystemBytes = (snapshot.filesystemEntries || []).reduce((total, entry) => total + storedValueSize(entry.value), 0);
  return filesystemBytes + storedValueSize(snapshot.saveContent || '');
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

function truncateLogText(value, maxLength) {
  const text = serializeLogValue(value);

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength)}... [truncated ${text.length - maxLength} chars]`;
}

function normalizeLogLevel(level) {
  return ['debug', 'info', 'warn', 'error'].includes(level) ? level : 'info';
}

function showToast(title, detail = '') {
  clearTimeout(toastTimer);
  nodes.toast.innerHTML = `
    <strong>${escapeHtml(title)}</strong>
    ${detail ? `<span>${escapeHtml(detail)}</span>` : ''}
  `;
  nodes.toast.hidden = false;
  nodes.toast.classList.add('visible');

  toastTimer = setTimeout(() => {
    nodes.toast.classList.remove('visible');
    nodes.toast.addEventListener(
      'transitionend',
      () => {
        if (!nodes.toast.classList.contains('visible')) {
          nodes.toast.hidden = true;
        }
      },
      { once: true }
    );
  }, 4200);
}

function createClientLogEntry(source, level, message, detail = '', time = new Date().toISOString()) {
  return {
    time,
    source: truncateLogText(source || 'launcher', 32),
    level: normalizeLogLevel(level),
    message: truncateLogText(
      Array.isArray(message) ? message.map((entry) => truncateLogText(entry, 1000)).join(' ') : message,
      MAX_LOG_MESSAGE_CHARS
    ),
    detail: detail ? truncateLogText(detail, MAX_LOG_DETAIL_CHARS) : ''
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

  const batch = logQueue.splice(0, LOG_FLUSH_BATCH_SIZE);

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

function renderTraceButton() {
  nodes.traceButton.setAttribute('aria-pressed', String(state.traceEnabled));
  nodes.traceButton.title = state.traceEnabled ? 'Engine trace enabled' : 'Enable engine trace';
}

function cursorHiddenKey(gameId) {
  return `reksioLauncher.hideCursor.${gameId}`;
}

function gamePrefersHiddenCursor(game) {
  const label = [game.id, game.title, game.originalTitle]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return /(magicien|magicians|czarodzieje)/.test(label);
}

function isGameCursorHidden(game) {
  const stored = localStorage.getItem(cursorHiddenKey(game.id));
  return stored === null ? gamePrefersHiddenCursor(game) : stored === 'true';
}

function setGameCursorHidden(game, isHidden) {
  localStorage.setItem(cursorHiddenKey(game.id), String(isHidden));
}

function applyCursorPreferenceToFrame(isHidden) {
  nodes.gameFrame.classList.toggle('cursor-hidden', isHidden);

  try {
    const doc = nodes.gameFrame.contentDocument;

    if (!doc) {
      return;
    }

    const existingStyle = doc.getElementById(GAME_CURSOR_STYLE_ID);

    if (!isHidden) {
      existingStyle?.remove();
      return;
    }

    if (existingStyle) {
      return;
    }

    const style = doc.createElement('style');
    style.id = GAME_CURSOR_STYLE_ID;
    style.textContent = 'html, body, body *, canvas { cursor: none !important; }';
    (doc.head || doc.documentElement).appendChild(style);
  } catch (error) {
    addLog('launcher', 'warn', 'Failed to apply game cursor preference', error);
  }
}

function renderHideCursorButton() {
  const game = getSelectedGame();
  const isHidden = Boolean(game && isGameCursorHidden(game));

  nodes.hideCursorButton.disabled = !game;
  nodes.hideCursorButton.setAttribute('aria-pressed', String(isHidden));
  const label = isHidden
    ? 'Show system cursor over game'
    : 'Hide system cursor over game';
  nodes.hideCursorButton.title = label;
  nodes.hideCursorButton.setAttribute('aria-label', label);
  applyCursorPreferenceToFrame(isHidden);
}

function toggleHiddenCursor() {
  const game = getSelectedGame();

  if (!game) {
    return;
  }

  const nextValue = !isGameCursorHidden(game);
  setGameCursorHidden(game, nextValue);
  renderHideCursorButton();
  addLog(
    'launcher',
    'info',
    nextValue ? 'System cursor hidden over game' : 'System cursor visible over game',
    game.title
  );
}

function toggleTrace() {
  state.traceEnabled = !state.traceEnabled;
  localStorage.setItem('reksioLauncher.traceEnabled', String(state.traceEnabled));
  renderTraceButton();
  addLog(
    'launcher',
    'info',
    state.traceEnabled ? 'Engine trace enabled' : 'Engine trace disabled',
    state.traceEnabled ? 'Next launch will include targeted engine trace logs.' : 'Next launch will use normal engine logging.'
  );
}

async function clearConsole() {
  await flushLogQueue();

  if (logSessionId) {
    await fetch(`/api/logs/${encodeURIComponent(logSessionId)}`, { method: 'DELETE' });
  }

  showToast('Logs cleared');
  addLog('launcher', 'info', 'Logs cleared');
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

async function copyTextToClipboard(text) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      /* Use the legacy fallback for non-secure hosts and older browsers. */
    }
  }

  if (!copyTextFallback(text)) {
    throw new Error('Clipboard API is unavailable in this browser context.');
  }
}

async function captureGameScreenshot() {
  if (!nodes.gameFrame.src || nodes.gameFrame.hidden) {
    throw new Error('No game is currently loaded.');
  }

  const bridge = nodes.gameFrame.contentWindow?.reksioSnapshots;
  if (bridge?.screenshot) return bridge.screenshot();

  let canvases;

  try {
    canvases = Array.from(nodes.gameFrame.contentDocument.querySelectorAll('canvas'));
  } catch {
    throw new Error('Game iframe is not accessible for screenshot capture.');
  }

  const canvas = canvases
    .filter((entry) => entry.width > 0 && entry.height > 0)
    .sort((a, b) => b.width * b.height - a.width * a.height)[0];

  if (!canvas) {
    throw new Error('No game canvas was found for screenshot capture.');
  }

  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
          return;
        }

        reject(new Error('Game canvas screenshot could not be encoded.'));
      }, 'image/png');
    } catch (error) {
      reject(error);
    }
  });
}

async function saveConsoleExport() {
  const previousHtml = nodes.saveLogsButton.innerHTML;
  nodes.saveLogsButton.disabled = true;
  nodes.saveLogsButton.innerHTML = `${icon('archive')}<span>Saving</span>`;

  try {
    const sessionId = await ensureLogSession();
    await flushLogQueue();

    let screenshotBlob = new Blob([], { type: 'image/png' });

    try {
      screenshotBlob = await captureGameScreenshot();
    } catch (error) {
      addLog('launcher', 'warn', 'Game screenshot unavailable', error);
      await flushLogQueue();
    }

    const exportParams = new URLSearchParams();
    if (state.traceEnabled) {
      exportParams.set('trace', '1');
    }
    const exportQuery = exportParams.toString();
    const exportUrl = `/api/logs/${encodeURIComponent(sessionId)}/export${exportQuery ? `?${exportQuery}` : ''}`;

    const response = await fetch(exportUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'image/png'
      },
      body: screenshotBlob
    });

    if (!response.ok) {
      throw new Error(`Log export failed with ${response.status}`);
    }

    const body = await response.json();
    const exportPath = body.exportDir || (body.files || [])[0] || '';
    let clipboardCopied = false;

    if (exportPath) {
      try {
        await copyTextToClipboard(exportPath);
        clipboardCopied = true;
      } catch (error) {
        addLog('launcher', 'warn', 'Console export path could not be copied', error);
      }
    }

    addLog(
      'launcher',
      'info',
      'Log export saved',
      `${body.exportDir}\n${(body.files || []).join('\n')}${body.screenshotSaved ? '' : '\nScreenshot not included.'}${clipboardCopied ? '\nPath copied to clipboard.' : ''}`
    );
    showToast(
      'Logs saved',
      clipboardCopied
        ? `${exportPath} copied`
        : body.screenshotSaved
          ? body.exportDir
          : `${body.exportDir} - screenshot unavailable`
    );
  } catch (error) {
    addLog('launcher', 'error', 'Failed to save log export', error);
  } finally {
    nodes.saveLogsButton.disabled = false;
    nodes.saveLogsButton.innerHTML = previousHtml;
  }
}

function getSelectedGame() {
  return state.games.find((game) => game.id === state.selectedId) || null;
}

function saveSlotKey(gameId) {
  return `reksioLauncher.save.${gameId}`;
}

function getSaveContentForGame(gameId) {
  if (state.loadedId === gameId) {
    syncCurrentSave();
    return localStorage.getItem('saveFile') || localStorage.getItem(saveSlotKey(gameId)) || '';
  }

  return localStorage.getItem(saveSlotKey(gameId)) || '';
}

function setSaveContentForGame(gameId, content) {
  if (content) {
    localStorage.setItem(saveSlotKey(gameId), content);
  } else {
    localStorage.removeItem(saveSlotKey(gameId));
  }

  if (state.loadedId === gameId || state.selectedId === gameId) {
    if (content) {
      localStorage.setItem('saveFile', content);
    } else {
      localStorage.removeItem('saveFile');
    }
  }
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

function stopLoadedGame() {
  clearInterval(saveSyncTimer);
  saveSyncTimer = null;
  state.loadedId = null;
  nodes.gameFrame.src = 'about:blank';
}

function defaultSnapshotName(game) {
  return `${game.title} - ${new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date())}`;
}

function formatDateTime(value) {
  if (!value) {
    return 'Unknown';
  }

  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

function setSnapshotStatus(message) {
  nodes.snapshotSummary.textContent = message;
}

function setSnapshotBusy(busy) {
  state.snapshotBusy = busy;
  nodes.createSnapshotButton.disabled = busy || !getSelectedGame();
  nodes.closeSnapshotsDialogButton.disabled = busy;
  nodes.snapshotList.querySelectorAll('button').forEach((button) => { button.disabled = busy; });
}

async function runSnapshotOperation(action, operation) {
  if (state.snapshotBusy) return;
  setSnapshotBusy(true);
  try {
    await operation();
  } catch (error) {
    addLog('launcher', 'error', `Snapshot ${action} failed`, error);
    setSnapshotStatus(error.message);
  } finally {
    setSnapshotBusy(false);
  }
}

function renderSnapshots() {
  const game = getSelectedGame();

  if (!game) {
    setSnapshotStatus('No game selected');
    nodes.snapshotList.innerHTML = '<div class="snapshot-empty">No game selected</div>';
    nodes.createSnapshotButton.disabled = true;
    return;
  }

  nodes.createSnapshotButton.disabled = state.snapshotBusy;
  setSnapshotStatus(`${state.snapshots.length} snapshot${state.snapshots.length === 1 ? '' : 's'} for ${game.title}`);

  if (!state.snapshots.length) {
    nodes.snapshotList.innerHTML = '<div class="snapshot-empty">No snapshots yet</div>';
    return;
  }

  nodes.snapshotList.innerHTML = state.snapshots
    .map(
      (snapshot) => `
        <article class="snapshot-item">
          <div class="snapshot-copy">
            <div class="snapshot-title">${escapeHtml(snapshot.name)}</div>
            <div class="snapshot-meta">
              ${escapeHtml(formatDateTime(snapshot.createdAt))} - ${escapeHtml(formatBytes(snapshot.sizeBytes || 0))} - ${escapeHtml(String(snapshot.filesystemEntryCount || 0))} files
              <br>${escapeHtml(snapshot.checkpoint ? `Scene entry: ${snapshot.checkpoint.scene}` : 'Legacy save files')}
            </div>
          </div>
          <div class="snapshot-actions">
            <button class="text-button" type="button" data-snapshot-action="restore" data-snapshot-id="${escapeHtml(snapshot.id)}">
              ${icon('refresh')}
              Restore
            </button>
            <button class="text-button" type="button" data-snapshot-action="rename" data-snapshot-id="${escapeHtml(snapshot.id)}">
              ${icon('note')}
              Rename
            </button>
            <button class="text-button danger" type="button" data-snapshot-action="delete" data-snapshot-id="${escapeHtml(snapshot.id)}">
              ${icon('trash')}
              Delete
            </button>
          </div>
        </article>
      `
    )
    .join('');
  setSnapshotBusy(state.snapshotBusy);
}

async function loadSnapshotsForSelectedGame() {
  const game = getSelectedGame();

  if (!game) {
    state.snapshots = [];
    renderSnapshots();
    return;
  }

  setSnapshotStatus('Loading snapshots');
  state.snapshots = await getSnapshotsForGame(game.id);
  renderSnapshots();
}

async function openSnapshotsDialog() {
  const game = getSelectedGame();

  if (!game) {
    return;
  }

  if (!nodes.snapshotsDialog.open) {
    nodes.snapshotsDialog.showModal();
  }

  try {
    await loadSnapshotsForSelectedGame();
  } catch (error) {
    addLog('launcher', 'error', 'Failed to open snapshots', error);
    setSnapshotStatus(error.message);
  }
}

function askSnapshotAction({ title, message = '', name, accept = 'Save' }) {
  const dialog = document.getElementById('snapshotActionDialog');
  if (dialog.open) return Promise.resolve(null);
  const input = document.getElementById('snapshotNameInput');
  document.getElementById('snapshotActionTitle').textContent = title;
  document.getElementById('snapshotActionMessage').textContent = message;
  document.getElementById('snapshotActionMessage').hidden = !message;
  document.getElementById('snapshotNameField').hidden = name === undefined;
  document.getElementById('snapshotActionAccept').textContent = accept;
  input.value = name ?? '';
  dialog.returnValue = '';
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => {
      resolve(dialog.returnValue === 'accept' ? (name === undefined ? true : input.value) : null);
    }, { once: true });
    dialog.showModal();
    if (name !== undefined) { input.focus(); input.select(); }
  });
}

async function createCurrentSnapshot() {
  const game = getSelectedGame();

  if (!game) {
    return;
  }

  syncCurrentSave();

  const fallbackName = defaultSnapshotName(game);
  const requestedName = await askSnapshotAction({ title: 'Create Snapshot', name: fallbackName });

  if (requestedName === null) {
    return;
  }

  const name = (requestedName.trim() || fallbackName).slice(0, 120);
  const previousHtml = nodes.createSnapshotButton.innerHTML;
  nodes.createSnapshotButton.disabled = true;
  nodes.createSnapshotButton.innerHTML = `${icon('archive')}<span>Saving</span>`;
  setSnapshotStatus('Saving snapshot');

  try {
    const bridge = nodes.gameFrame.contentWindow?.reksioSnapshots;
    if (!bridge || state.loadedId !== game.id) throw new Error('Start the game before creating a checkpoint.');
    const checkpoint = bridge.capture();
    const filesystemEntries = checkpoint.filesystemEntries;
    const saveContent = JSON.stringify(checkpoint.saveData);
    const snapshot = {
      checkpoint,
      id: createSnapshotId(),
      gameId: game.id,
      gameTitle: game.title,
      name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      saveContent,
      filesystemEntries,
      filesystemEntryCount: filesystemEntries.length,
      sizeBytes: 0
    };

    snapshot.sizeBytes = estimateSnapshotSize(snapshot);
    await putSnapshot(snapshot);
    await loadSnapshotsForSelectedGame();
    showToast('Checkpoint saved', `${name} - ${checkpoint.scene}`);
    addLog('launcher', 'info', 'Snapshot saved', `${name}\n${snapshot.filesystemEntryCount} filesystem entries`);
  } catch (error) {
    addLog('launcher', 'error', 'Failed to save snapshot', error);
    setSnapshotStatus(error.message);
  } finally {
    nodes.createSnapshotButton.disabled = false;
    nodes.createSnapshotButton.innerHTML = previousHtml;
  }
}

async function restoreSnapshot(snapshotId) {
  const snapshot = await getSnapshot(snapshotId);

  if (!snapshot) {
    throw new Error('Snapshot not found.');
  }

  const confirmed = await askSnapshotAction({ title: 'Restore Snapshot',
    message: `Restore "${snapshot.name}"? Current progress for this game will be overwritten.`, accept: 'Restore' });

  if (!confirmed) {
    return;
  }

  setSnapshotStatus('Restoring snapshot');

  if (snapshot.checkpoint) {
    if (state.loadedId !== snapshot.gameId) throw new Error('Load this game before restoring its checkpoint.');
    const bridge = nodes.gameFrame.contentWindow?.reksioSnapshots;
    if (!bridge) throw new Error('Reload the launcher to enable checkpoint restore.');
    await bridge.restore(snapshot.checkpoint);
    syncCurrentSave();
    nodes.snapshotsDialog.close();
    showToast('Checkpoint restored', `${snapshot.name} - ${snapshot.checkpoint.scene}`);
    addLog('launcher', 'info', 'Scene checkpoint restored', snapshot.checkpoint.scene);
    return;
  }

  if (state.loadedId) {
    syncCurrentSave();
    stopLoadedGame();
  } else {
    syncCurrentSave();
  }

  setSaveContentForGame(snapshot.gameId, snapshot.saveContent || '');
  await replaceEngineFilesystem(snapshot.filesystemEntries || []);
  showToast('Save files restored', 'Legacy snapshot: use the in-game Load menu to continue.');
  addLog('launcher', 'info', 'Snapshot restored', snapshot.name);

  if (state.games.some((game) => game.id === snapshot.gameId)) {
    selectGame(snapshot.gameId, true);
  } else {
    await loadSnapshotsForSelectedGame();
  }
}

async function renameSnapshot(snapshotId) {
  const snapshot = await getSnapshot(snapshotId);

  if (!snapshot) {
    throw new Error('Snapshot not found.');
  }

  const nextName = await askSnapshotAction({ title: 'Rename Snapshot', name: snapshot.name });

  if (nextName === null) {
    return;
  }

  const name = nextName.trim();

  if (!name) {
    return;
  }

  snapshot.name = name.slice(0, 120);
  snapshot.updatedAt = new Date().toISOString();
  await putSnapshot(snapshot);
  await loadSnapshotsForSelectedGame();
  showToast('Snapshot renamed', snapshot.name);
}

async function deleteSnapshot(snapshotId) {
  const snapshot = await getSnapshot(snapshotId);

  if (!snapshot) {
    throw new Error('Snapshot not found.');
  }

  const confirmed = await askSnapshotAction({ title: 'Delete Snapshot', message: `Delete "${snapshot.name}"?`, accept: 'Delete' });

  if (!confirmed) {
    return;
  }

  await deleteSnapshotById(snapshotId);
  await loadSnapshotsForSelectedGame();
  showToast('Snapshot deleted', snapshot.name);
}

function handleSnapshotListClick(event) {
  const button = event.target.closest && event.target.closest('[data-snapshot-action]');

  if (!button) {
    return;
  }

  const action = button.dataset.snapshotAction;
  const snapshotId = button.dataset.snapshotId;
  const handlers = {
    restore: restoreSnapshot,
    rename: renameSnapshot,
    delete: deleteSnapshot
  };

  if (!handlers[action] || !snapshotId) {
    return;
  }

  runSnapshotOperation(action, () => handlers[action](snapshotId));
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
    return 'Unknown';
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

  return 'Unsupported source';
}

function languageCode(game) {
  return (game.locale || game.language || 'custom').slice(0, 2).toUpperCase();
}

function compatProfileForGame(game) {
  const label = [game.id, game.title, game.originalTitle]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (/(magicien|magicians|czarodzieje)/.test(label)) {
    return 'magicienii';
  }
  if (/nemo/.test(label)) return 'nemo';
  if (/(timpului|time|wehikul)/.test(label)) return 'timpului';
  if (/(ozn|ufo)/.test(label)) return 'ozn';

  return '';
}

function buildLaunchUrl(game) {
  if (game.type !== 'iso') {
    throw new Error(`Unsupported game type: ${game.type}`);
  }

  const params = new URLSearchParams();
  if (game.listingUrl) {
    params.set('loader', 'listingjson');
    params.set('source', absoluteUrl(game.listingUrl));
  } else {
    params.set('loader', 'iso-remote');
    params.set('source', absoluteUrl(game.isoUrl));
  }

  const compatProfile = compatProfileForGame(game);
  params.set('storage', `reksio-${game.id}`);
  if (compatProfile) {
    params.set('compatProfile', compatProfile);
  }

  // A targeted scene override is useful for reproducing a bug without changing other games.
  if (launcherParams.get('game') === game.id && launcherParams.has('scene')) {
    params.set('scene', launcherParams.get('scene'));
    if (launcherParams.has('sceneObject')) params.set('sceneObject', launcherParams.get('sceneObject'));
  }

  if (state.traceEnabled) {
    params.set('trace', '1');
    params.set('traceScene', '*');
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
      return `
        <button class="game-item${active}" type="button" data-game-id="${game.id}">
          <span class="game-avatar">${initials(game.title)}</span>
          <span class="game-copy">
            <span class="game-title">${escapeHtml(game.title)}</span>
            <span class="game-meta">${escapeHtml(languageCode(game))} - ${escapeHtml(sourceLabel(game))}</span>
          </span>
          <span class="mini-tag">ISO</span>
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
    nodes.hideCursorButton.disabled = true;
    nodes.traceButton.disabled = true;
    nodes.fullscreenButton.disabled = true;
    nodes.snapshotsButton.disabled = true;
    nodes.resetSaveButton.disabled = true;
    nodes.deleteGameButton.disabled = true;
    renderHideCursorButton();
    return;
  }

  nodes.selectedTitle.textContent = game.title;
  nodes.selectedSource.textContent = sourceLabel(game);
  nodes.selectedBadges.innerHTML = `
    <span class="badge">${escapeHtml(languageCode(game))}</span>
    <span class="badge">ISO</span>
  `;
  nodes.detailTitle.textContent = game.title;
  nodes.detailNotes.textContent = game.notes || game.originalTitle || sourceLabel(game);
  nodes.detailCover.textContent = initials(game.title);

  const rows = [
    ['Source', sourceLabel(game)],
    ['Stored size', formatBytes(game.size)],
    ['Added', formatDate(game.createdAt)],
    ['Identifier', game.originalFilename || game.id]
  ];

  nodes.metaList.innerHTML = rows
    .map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`)
    .join('');

  nodes.stageEmpty.hidden = true;
  nodes.gameFrame.hidden = false;
  renderHideCursorButton();
  nodes.traceButton.disabled = false;
  nodes.fullscreenButton.disabled = false;
  nodes.snapshotsButton.disabled = false;
  nodes.resetSaveButton.disabled = false;
  nodes.deleteGameButton.disabled = false;
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
  if (url.searchParams.get('game') !== game.id) {
    for (const parameter of ['scene', 'sceneObject']) {
      url.searchParams.delete(parameter);
      launcherParams.delete(parameter);
    }
  }
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

async function logServerHealth() {
  try {
    const body = await apiFetch('/api/health');
    addLog(
      'launcher',
      body.enginePresent ? 'info' : 'warn',
      'Server health',
      [
        `Engine directory: ${body.engineDir || 'unknown'}`,
        `Engine present: ${body.enginePresent ? 'yes' : 'no'}`,
        `Engine updated: ${body.engineUpdatedAt || 'unknown'}`,
        `Extractor: ${body.extractorCommand || 'unknown'}`
      ].join('\n')
    );
  } catch (error) {
    addLog('launcher', 'warn', 'Failed to read server health', error);
  }
}

function openDialog() {
  nodes.isoForm.reset();
  nodes.isoForm.querySelector('[name="language"]').value = 'Custom';
  nodes.isoForm.querySelector('[name="locale"]').value = 'custom';
  selectedIsoFile = null;
  nodes.isoFileLabel.textContent = 'Select ISO file';
  nodes.uploadProgress.style.width = '0%';
  nodes.isoFormStatus.textContent = '';
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
      nodes.isoFormStatus.textContent = percent >= 100 ? 'Extracting ISO' : `Uploading ${percent}%`;
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

    nodes.isoFormStatus.textContent = 'Uploaded and extracted';
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

async function deleteSelectedGame() {
  const game = getSelectedGame();

  if (!game) {
    return;
  }

  const confirmed = window.confirm(`Remove "${game.title}" from this launcher?`);

  if (!confirmed) {
    return;
  }

  await apiFetch(`/api/games/${encodeURIComponent(game.id)}`, { method: 'DELETE' });
  localStorage.removeItem(saveSlotKey(game.id));
  await deleteSnapshotsForGame(game.id).catch((error) => addLog('launcher', 'warn', 'Failed to delete game snapshots', error));
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
nodes.clearLogsButton.addEventListener('click', () => {
  clearConsole().catch((error) => addLog('launcher', 'error', 'Failed to clear logs', error));
});
nodes.saveLogsButton.addEventListener('click', saveConsoleExport);
nodes.notesButton.addEventListener('click', openNotesDialog);
nodes.closeNotesDialogButton.addEventListener('click', () => nodes.notesDialog.close());
nodes.newNoteButton.addEventListener('click', startNewNote);
nodes.notesForm.addEventListener('submit', saveCurrentNote);
nodes.deleteNoteButton.addEventListener('click', deleteCurrentNote);
nodes.snapshotsButton.addEventListener('click', openSnapshotsDialog);
nodes.closeSnapshotsDialogButton.addEventListener('click', () => nodes.snapshotsDialog.close());
nodes.createSnapshotButton.addEventListener('click', () => runSnapshotOperation('save', createCurrentSnapshot));
nodes.snapshotsDialog.addEventListener('cancel', (event) => {
  if (state.snapshotBusy) event.preventDefault();
});
nodes.snapshotList.addEventListener('click', handleSnapshotListClick);
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
nodes.hideCursorButton.addEventListener('click', toggleHiddenCursor);
nodes.traceButton.addEventListener('click', toggleTrace);
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
  renderHideCursorButton();
  addLog('launcher', 'info', 'Game iframe loaded', nodes.gameFrame.src);
});
window.addEventListener('message', handleEngineMessage);
window.addEventListener('error', (event) => {
  addLog('launcher', 'error', event.message, `${event.filename}:${event.lineno}:${event.colno}`);
});
window.addEventListener('unhandledrejection', (event) => {
  addLog('launcher', 'error', 'Unhandled promise rejection', event.reason);
});
window.addEventListener('beforeunload', syncCurrentSave);

addLog('launcher', 'info', 'Launcher ready');
renderTraceButton();
logServerHealth();
loadGames();
