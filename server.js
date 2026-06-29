'use strict';

const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const express = require('express');
const multer = require('multer');

const PORT = Number(process.env.PORT || 3030);
const DATA_DIR = path.resolve(process.env.REKSIO_DATA_DIR || path.join(process.cwd(), 'data'));
const GAMES_DIR = path.join(DATA_DIR, 'games');
const TMP_DIR = path.join(DATA_DIR, 'tmp');
const LOGS_DIR = path.join(DATA_DIR, 'logs');
const META_PATH = path.join(DATA_DIR, 'games.json');
const NOTES_PATH = path.join(DATA_DIR, 'notes.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const ENGINE_DIR = path.join(PUBLIC_DIR, 'engine');
const MAX_ISO_SIZE_BYTES = Number(process.env.MAX_ISO_SIZE_BYTES || 8 * 1024 * 1024 * 1024);
const MAX_LOG_BATCH_ENTRIES = 1000;
const MAX_LOG_READ_BYTES = 1024 * 1024;
const MAX_LOG_TAIL_ENTRIES = 1000;
const MAX_LOG_FILE_BYTES = Number(process.env.MAX_LOG_FILE_BYTES || 8 * 1024 * 1024);
const MAX_LOG_FILE_KEEP_BYTES = Math.max(1024, Math.floor(MAX_LOG_FILE_BYTES / 2));

const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

function textValue(value, fallback = '') {
  if (typeof value !== 'string') {
    return fallback;
  }

  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned || fallback;
}

function slugify(value) {
  const slug = textValue(value, 'game')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

  return slug || 'game';
}

function createGameId(title) {
  return `${slugify(title)}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
}

function createNoteId() {
  return `note-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
}

function createLogSessionId() {
  return `log-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}

function normalizeLocale(value, fallback = 'custom') {
  const cleaned = textValue(value, fallback).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 16);
  return cleaned || fallback;
}

function noteBodyValue(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().slice(0, 12000);
}

function hasNoteContent(body) {
  return Boolean(textValue(body.title) || noteBodyValue(body.body));
}

function isoPathFor(game) {
  return path.join(GAMES_DIR, game.id, game.isoFile || 'game.iso');
}

async function ensureDataDirs() {
  await fsp.mkdir(GAMES_DIR, { recursive: true });
  await fsp.mkdir(TMP_DIR, { recursive: true });
  await fsp.mkdir(LOGS_DIR, { recursive: true });

  try {
    await fsp.access(META_PATH, fs.constants.F_OK);
  } catch {
    await fsp.writeFile(META_PATH, '[]\n', 'utf8');
  }

  try {
    await fsp.access(NOTES_PATH, fs.constants.F_OK);
  } catch {
    await fsp.writeFile(NOTES_PATH, '[]\n', 'utf8');
  }
}

async function readUserGames() {
  await ensureDataDirs();

  const raw = await fsp.readFile(META_PATH, 'utf8');
  const parsed = JSON.parse(raw || '[]');

  if (!Array.isArray(parsed)) {
    throw new Error('Game metadata file is not an array.');
  }

  return parsed.filter((game) => game && game.type === 'iso');
}

async function writeUserGames(games) {
  await ensureDataDirs();

  const tmpPath = `${META_PATH}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmpPath, `${JSON.stringify(games, null, 2)}\n`, 'utf8');
  await fsp.rename(tmpPath, META_PATH);
}

async function readNotes() {
  await ensureDataDirs();

  const raw = await fsp.readFile(NOTES_PATH, 'utf8');
  const parsed = JSON.parse(raw || '[]');

  if (!Array.isArray(parsed)) {
    throw new Error('Notes metadata file is not an array.');
  }

  return parsed;
}

async function writeNotes(notes) {
  await ensureDataDirs();

  const tmpPath = `${NOTES_PATH}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmpPath, `${JSON.stringify(notes, null, 2)}\n`, 'utf8');
  await fsp.rename(tmpPath, NOTES_PATH);
}

async function getAllGames() {
  return readUserGames();
}

function publicNote(note) {
  return {
    id: note.id,
    title: note.title || 'Untitled note',
    body: note.body || '',
    createdAt: note.createdAt || null,
    updatedAt: note.updatedAt || null
  };
}

function noteFromBody(body, existingNote = null) {
  const noteBody = noteBodyValue(body.body);
  const fallbackTitle = noteBody.split('\n').find(Boolean) || 'Untitled note';
  const title = textValue(body.title, fallbackTitle).slice(0, 100);
  const now = new Date().toISOString();

  return {
    id: existingNote ? existingNote.id : createNoteId(),
    title,
    body: noteBody,
    createdAt: existingNote ? existingNote.createdAt : now,
    updatedAt: now
  };
}

function validateLogSessionId(value) {
  const id = textValue(value).toLowerCase();

  if (!/^[a-z0-9][a-z0-9-]{2,80}$/.test(id)) {
    throw Object.assign(new Error('Invalid log session id.'), { statusCode: 400 });
  }

  return id;
}

function logPathFor(sessionId) {
  const resolvedLogsDir = path.resolve(LOGS_DIR);
  const resolvedPath = path.resolve(resolvedLogsDir, `${validateLogSessionId(sessionId)}.ndjson`);

  if (!resolvedPath.startsWith(`${resolvedLogsDir}${path.sep}`)) {
    throw Object.assign(new Error('Invalid log session path.'), { statusCode: 400 });
  }

  return resolvedPath;
}

function normalizeLogLevel(value) {
  return ['debug', 'info', 'warn', 'error'].includes(value) ? value : 'info';
}

function boundedString(value, maxLength) {
  if (Array.isArray(value)) {
    return value.map((entry) => boundedString(entry, maxLength)).join(' ');
  }

  if (typeof value === 'string') {
    return value.slice(0, maxLength);
  }

  if (value == null) {
    return '';
  }

  try {
    return JSON.stringify(value).slice(0, maxLength);
  } catch {
    return String(value).slice(0, maxLength);
  }
}

function normalizeLogEntry(entry) {
  const parsedTime = new Date(entry && entry.time);

  return {
    time: Number.isNaN(parsedTime.getTime()) ? new Date().toISOString() : parsedTime.toISOString(),
    source: boundedString(entry && entry.source, 32) || 'launcher',
    level: normalizeLogLevel(entry && entry.level),
    message: boundedString(entry && entry.message, 12000),
    detail: boundedString(entry && entry.detail, 24000)
  };
}

function parseLogLevels(value) {
  const levels = new Set(String(value || 'debug,info,warn,error').split(',').map((entry) => normalizeLogLevel(entry.trim())));
  return levels.size ? levels : new Set(['debug', 'info', 'warn', 'error']);
}

function parseBoundedInteger(value, fallback, min, max) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, parsed));
}

async function readLogChunk(filePath, query) {
  let stat;

  try {
    stat = await fsp.stat(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { entries: [], nextOffset: 0, size: 0, truncated: false };
    }

    throw error;
  }

  const hasOffset = query.offset !== undefined;
  const requestedOffset = parseBoundedInteger(query.offset, 0, 0, stat.size);
  const start = hasOffset ? requestedOffset : Math.max(0, stat.size - MAX_LOG_READ_BYTES);
  const bytesToRead = Math.min(MAX_LOG_READ_BYTES, stat.size - start);

  if (bytesToRead <= 0) {
    return { entries: [], nextOffset: stat.size, size: stat.size, truncated: false };
  }

  const handle = await fsp.open(filePath, 'r');

  try {
    const buffer = Buffer.alloc(bytesToRead);
    const result = await handle.read(buffer, 0, bytesToRead, start);
    let text = buffer.subarray(0, result.bytesRead).toString('utf8');
    let baseOffset = start;

    if (start > 0) {
      const firstNewline = text.indexOf('\n');

      if (firstNewline === -1) {
        return { entries: [], nextOffset: start + result.bytesRead, size: stat.size, truncated: true };
      }

      baseOffset += Buffer.byteLength(text.slice(0, firstNewline + 1));
      text = text.slice(firstNewline + 1);
    }

    const lastNewline = text.lastIndexOf('\n');

    if (lastNewline === -1) {
      return { entries: [], nextOffset: baseOffset, size: stat.size, truncated: start > 0 };
    }

    const completeText = text.slice(0, lastNewline);
    const nextOffset = baseOffset + Buffer.byteLength(text.slice(0, lastNewline + 1));
    const levels = parseLogLevels(query.levels);
    const limit = parseBoundedInteger(query.limit, 300, 1, MAX_LOG_TAIL_ENTRIES);
    const entries = completeText
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter((entry) => entry && levels.has(entry.level))
      .slice(-limit);

    return {
      entries,
      nextOffset,
      size: stat.size,
      truncated: start > 0 || nextOffset < stat.size
    };
  } finally {
    await handle.close();
  }
}

async function trimLogFileIfNeeded(filePath) {
  let stat;

  try {
    stat = await fsp.stat(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return;
    }

    throw error;
  }

  if (stat.size <= MAX_LOG_FILE_BYTES) {
    return;
  }

  const keepBytes = Math.min(MAX_LOG_FILE_KEEP_BYTES, stat.size);
  const handle = await fsp.open(filePath, 'r');
  let text;

  try {
    const buffer = Buffer.alloc(keepBytes);
    const result = await handle.read(buffer, 0, keepBytes, stat.size - keepBytes);
    text = buffer.subarray(0, result.bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }

  const firstNewline = text.indexOf('\n');

  if (firstNewline !== -1) {
    text = text.slice(firstNewline + 1);
  }

  const trimEntry = normalizeLogEntry({
    source: 'launcher',
    level: 'warn',
    message: `Log file was trimmed after exceeding ${formatBytes(MAX_LOG_FILE_BYTES)}.`,
    detail: `Kept latest ${formatBytes(keepBytes)} of ${formatBytes(stat.size)}.`
  });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.trim`;

  await fsp.writeFile(tmpPath, `${JSON.stringify(trimEntry)}\n${text}`, 'utf8');
  await fsp.rename(tmpPath, filePath);
}

async function appendLogEntries(sessionId, entries) {
  const filePath = logPathFor(sessionId);
  const lines = entries.map((entry) => JSON.stringify(normalizeLogEntry(entry))).join('\n');
  await fsp.appendFile(filePath, `${lines}\n`, 'utf8');
  await trimLogFileIfNeeded(filePath);
}

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function publicGame(game) {
  const output = {
    id: game.id,
    title: game.title,
    originalTitle: game.originalTitle || '',
    type: game.type,
    source: game.source || '',
    language: game.language || 'Custom',
    locale: game.locale || 'custom',
    notes: game.notes || '',
    createdAt: game.createdAt || null,
    updatedAt: game.updatedAt || null,
    size: game.size || null,
    originalFilename: game.originalFilename || ''
  };

  if (game.type === 'iso') {
    output.isoUrl = `/api/games/${encodeURIComponent(game.id)}/iso`;
  }

  return output;
}

const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      fsp.mkdir(TMP_DIR, { recursive: true }).then(() => cb(null, TMP_DIR)).catch(cb);
    },
    filename(req, file, cb) {
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.iso.tmp`);
    }
  }),
  limits: {
    fileSize: MAX_ISO_SIZE_BYTES,
    files: 1
  },
  fileFilter(req, file, cb) {
    const extension = path.extname(file.originalname || '').toLowerCase();

    if (extension !== '.iso') {
      cb(Object.assign(new Error('Only .iso files are accepted.'), { statusCode: 400 }));
      return;
    }

    cb(null, true);
  }
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    enginePresent: fs.existsSync(path.join(ENGINE_DIR, 'index.html')),
    maxIsoSizeBytes: MAX_ISO_SIZE_BYTES,
    maxLogFileBytes: MAX_LOG_FILE_BYTES
  });
});

app.get('/api/games', async (req, res, next) => {
  try {
    const games = await getAllGames();
    res.json({ games: games.map(publicGame) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/notes', async (req, res, next) => {
  try {
    const notes = await readNotes();
    notes.sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
    res.json({ notes: notes.map(publicNote) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/notes', async (req, res, next) => {
  try {
    const body = req.body || {};

    if (!hasNoteContent(body)) {
      throw Object.assign(new Error('Add a title or note body.'), { statusCode: 400 });
    }

    const note = noteFromBody(body);
    const notes = await readNotes();
    notes.push(note);
    await writeNotes(notes);

    res.status(201).json({ note: publicNote(note) });
  } catch (error) {
    next(error);
  }
});

app.put('/api/notes/:id', async (req, res, next) => {
  try {
    const body = req.body || {};

    if (!hasNoteContent(body)) {
      throw Object.assign(new Error('Add a title or note body.'), { statusCode: 400 });
    }

    const notes = await readNotes();
    const index = notes.findIndex((note) => note.id === req.params.id);

    if (index === -1) {
      throw Object.assign(new Error('Note not found.'), { statusCode: 404 });
    }

    const note = noteFromBody(body, notes[index]);
    notes[index] = note;
    await writeNotes(notes);

    res.json({ note: publicNote(note) });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/notes/:id', async (req, res, next) => {
  try {
    const notes = await readNotes();
    const nextNotes = notes.filter((note) => note.id !== req.params.id);

    if (nextNotes.length === notes.length) {
      throw Object.assign(new Error('Note not found.'), { statusCode: 404 });
    }

    await writeNotes(nextNotes);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.post('/api/logs/sessions', async (req, res, next) => {
  try {
    const sessionId = createLogSessionId();
    const title = boundedString(req.body && req.body.title, 120) || 'Reksio UI session';
    const gameId = boundedString(req.body && req.body.gameId, 120);
    const initialEntry = normalizeLogEntry({
      source: 'launcher',
      level: 'info',
      message: 'Log session started',
      detail: gameId ? `game: ${gameId}\ntitle: ${title}` : `title: ${title}`
    });

    await appendLogEntries(sessionId, [initialEntry]);
    res.status(201).json({ sessionId });
  } catch (error) {
    next(error);
  }
});

app.post('/api/logs/:id', async (req, res, next) => {
  try {
    const sessionId = validateLogSessionId(req.params.id);
    const entries = Array.isArray(req.body && req.body.entries) ? req.body.entries : [];

    if (!entries.length) {
      res.json({ ok: true, written: 0 });
      return;
    }

    if (entries.length > MAX_LOG_BATCH_ENTRIES) {
      throw Object.assign(new Error(`Log batch too large. Maximum is ${MAX_LOG_BATCH_ENTRIES}.`), { statusCode: 413 });
    }

    await appendLogEntries(sessionId, entries);
    res.json({ ok: true, written: entries.length });
  } catch (error) {
    next(error);
  }
});

app.get('/api/logs/:id/download', async (req, res, next) => {
  try {
    const filePath = logPathFor(req.params.id);
    await fsp.access(filePath, fs.constants.F_OK);
    res.download(filePath, `${validateLogSessionId(req.params.id)}.ndjson`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      next(Object.assign(new Error('Log session not found.'), { statusCode: 404 }));
      return;
    }

    next(error);
  }
});

app.get('/api/logs/:id', async (req, res, next) => {
  try {
    const filePath = logPathFor(req.params.id);
    const result = await readLogChunk(filePath, req.query);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/logs/:id', async (req, res, next) => {
  try {
    await fsp.rm(logPathFor(req.params.id), { force: true });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.post('/api/games', upload.single('iso'), async (req, res, next) => {
  let tempPath = req.file && req.file.path;

  try {
    if (!req.file) {
      throw Object.assign(new Error('Select an ISO file to upload.'), { statusCode: 400 });
    }

    const defaultTitle = path.basename(req.file.originalname, path.extname(req.file.originalname));
    const title = textValue(req.body.title, defaultTitle);
    const language = textValue(req.body.language, 'Custom');
    const locale = normalizeLocale(req.body.locale, 'custom');
    const notes = textValue(req.body.notes);
    const id = createGameId(title);
    const gameDir = path.join(GAMES_DIR, id);
    const targetPath = path.join(gameDir, 'game.iso');

    await fsp.mkdir(gameDir, { recursive: true });
    await fsp.rename(req.file.path, targetPath);
    tempPath = null;

    const stat = await fsp.stat(targetPath);
    const now = new Date().toISOString();
    const game = {
      id,
      title,
      originalTitle: textValue(req.body.originalTitle),
      type: 'iso',
      isoFile: 'game.iso',
      language,
      locale,
      notes,
      originalFilename: req.file.originalname,
      size: stat.size,
      createdAt: now,
      updatedAt: now
    };

    const games = await readUserGames();
    games.push(game);
    await writeUserGames(games);

    res.status(201).json({ game: publicGame(game) });
  } catch (error) {
    if (tempPath) {
      fsp.unlink(tempPath).catch(() => {});
    }

    next(error);
  }
});

app.delete('/api/games/:id', async (req, res, next) => {
  try {
    const id = req.params.id;

    const games = await readUserGames();
    const index = games.findIndex((game) => game.id === id);

    if (index === -1) {
      throw Object.assign(new Error('Game not found.'), { statusCode: 404 });
    }

    const [removed] = games.splice(index, 1);
    await writeUserGames(games);

    if (removed.type === 'iso') {
      await fsp.rm(path.join(GAMES_DIR, removed.id), { recursive: true, force: true });
    }

    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

function parseRange(rangeHeader, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader || '');

  if (!match) {
    return null;
  }

  let start;
  let end;

  if (match[1] === '' && match[2] !== '') {
    const suffixLength = Number(match[2]);
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Number(match[2]);
  }

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) {
    return null;
  }

  return {
    start,
    end: Math.min(end, size - 1)
  };
}

app.get('/api/games/:id/iso', async (req, res, next) => {
  try {
    const games = await readUserGames();
    const game = games.find((entry) => entry.id === req.params.id && entry.type === 'iso');

    if (!game) {
      throw Object.assign(new Error('ISO game not found.'), { statusCode: 404 });
    }

    const filePath = isoPathFor(game);
    const stat = await fsp.stat(filePath);
    const headers = {
      'Accept-Ranges': 'bytes',
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'private, max-age=0'
    };

    if (req.headers.range) {
      const range = parseRange(req.headers.range, stat.size);

      if (!range) {
        res.status(416).set({ 'Content-Range': `bytes */${stat.size}` }).end();
        return;
      }

      res.status(206).set({
        ...headers,
        'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}`,
        'Content-Length': String(range.end - range.start + 1)
      });

      fs.createReadStream(filePath, range).pipe(res);
      return;
    }

    res.set({
      ...headers,
      'Content-Length': String(stat.size)
    });
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    next(error);
  }
});

app.use('/engine', (req, res, next) => {
  if (!fs.existsSync(path.join(ENGINE_DIR, 'index.html'))) {
    res
      .status(503)
      .type('text/plain')
      .send('ReksioEngine bundle is not installed. Build the Docker image or copy the engine output to public/engine.');
    return;
  }

  next();
});
app.use('/engine', express.static(ENGINE_DIR));
app.use(express.static(PUBLIC_DIR));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    next();
    return;
  }

  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use((error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const statusCode = error.statusCode || error.status || 500;

  if (statusCode >= 500) {
    console.error(error);
  }

  res.status(statusCode).json({
    error: error.message || 'Unexpected server error.'
  });
});

ensureDataDirs()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Reksio launcher listening on http://0.0.0.0:${PORT}`);
    });
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
