'use strict';

const state = {
  games: [],
  selectedId: null,
  loadedId: null,
  filter: 'all',
  search: ''
};

const nodes = {
  addGameButton: document.getElementById('addGameButton'),
  closeDialogButton: document.getElementById('closeDialogButton'),
  addGameDialog: document.getElementById('addGameDialog'),
  deleteGameButton: document.getElementById('deleteGameButton'),
  detailCover: document.getElementById('detailCover'),
  detailNotes: document.getElementById('detailNotes'),
  detailTitle: document.getElementById('detailTitle'),
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
  uploadProgress: document.getElementById('uploadProgress'),
  volumeSlider: document.getElementById('volumeSlider'),
  volumeValue: document.getElementById('volumeValue')
};

let selectedIsoFile = null;
let saveSyncTimer = null;
const VOLUME_STORAGE_KEY = 'reksioLauncher.volume';

function icon(name) {
  return `<svg><use href="#icon-${name}"></use></svg>`;
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
    params.set('source', game.isoUrl);
  } else {
    params.set('loader', 'github');
    params.set('source', game.source);
  }

  params.set('volume', getVolume().toFixed(2));
  return `/engine/?${params.toString()}`;
}

function clampVolume(value) {
  return Math.max(0, Math.min(1, value));
}

function getVolume() {
  return clampVolume(Number(nodes.volumeSlider.value) / 100);
}

function setVolumeDisplay() {
  const value = Math.round(getVolume() * 100);
  nodes.volumeValue.textContent = `${value}%`;
  nodes.volumeSlider.setAttribute('aria-valuetext', `${value}%`);
}

function applyVolumeToFrame() {
  const volume = getVolume();
  setVolumeDisplay();
  localStorage.setItem(VOLUME_STORAGE_KEY, String(Math.round(volume * 100)));

  if (nodes.gameFrame.contentWindow) {
    nodes.gameFrame.contentWindow.postMessage(
      {
        type: 'reksio:set-volume',
        volume
      },
      window.location.origin
    );
  }
}

function restoreVolume() {
  const savedVolume = Number(localStorage.getItem(VOLUME_STORAGE_KEY));

  if (Number.isFinite(savedVolume)) {
    nodes.volumeSlider.value = String(Math.max(0, Math.min(100, Math.round(savedVolume))));
  }

  setVolumeDisplay();
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

function loadSelectedGame() {
  const game = getSelectedGame();

  if (!game) {
    return;
  }

  syncCurrentSave();
  prepareSaveSlot(game.id);
  nodes.gameFrame.src = buildLaunchUrl(game);
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
nodes.volumeSlider.addEventListener('input', applyVolumeToFrame);
nodes.deleteGameButton.addEventListener('click', () => {
  deleteSelectedGame().catch((error) => {
    nodes.serverStatus.textContent = error.message;
  });
});
nodes.resetSaveButton.addEventListener('click', resetSelectedSave);
nodes.gameFrame.addEventListener('load', () => {
  syncCurrentSave();
  applyVolumeToFrame();
});
window.addEventListener('beforeunload', syncCurrentSave);

restoreVolume();
loadGames();
