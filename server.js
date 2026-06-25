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
const META_PATH = path.join(DATA_DIR, 'games.json');
const NOTES_PATH = path.join(DATA_DIR, 'notes.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const ENGINE_DIR = path.join(PUBLIC_DIR, 'engine');
const MAX_ISO_SIZE_BYTES = Number(process.env.MAX_ISO_SIZE_BYTES || 8 * 1024 * 1024 * 1024);

const BUILTIN_GAMES = [
  {
    id: 'reksio-pirates-pl',
    title: 'Reksio and the Pirates',
    originalTitle: 'Reksio i Skarb Piratow',
    type: 'github',
    source: 'reksioiskarbpiratow',
    language: 'Polish',
    locale: 'pl',
    notes: 'Bundled GitHub source from ReksioEngine/GamesFiles.',
    builtin: true,
    createdAt: null,
    updatedAt: null
  },
  {
    id: 'reksio-ufo-pl',
    title: 'Reksio and the UFO',
    originalTitle: 'Reksio i UFO',
    type: 'github',
    source: 'reksioiufo',
    language: 'Polish',
    locale: 'pl',
    notes: 'Bundled GitHub source from ReksioEngine/GamesFiles.',
    builtin: true,
    createdAt: null,
    updatedAt: null
  }
];

const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

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

  return parsed.map((game) => ({ ...game, builtin: false }));
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
  const userGames = await readUserGames();
  return [...BUILTIN_GAMES, ...userGames];
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
    builtin: Boolean(game.builtin),
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

function validateGithubSource(source) {
  const cleaned = textValue(source);

  if (!cleaned || cleaned.length > 160 || !/^[A-Za-z0-9._/-]+$/.test(cleaned)) {
    throw Object.assign(new Error('GitHub source must be a ReksioEngine/GamesFiles branch or path name.'), {
      statusCode: 400
    });
  }

  return cleaned;
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
    maxIsoSizeBytes: MAX_ISO_SIZE_BYTES
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

app.post('/api/games', upload.single('iso'), async (req, res, next) => {
  let tempPath = req.file && req.file.path;

  try {
    if (!req.file) {
      throw Object.assign(new Error('Select an ISO file to upload.'), { statusCode: 400 });
    }

    const defaultTitle = path.basename(req.file.originalname, path.extname(req.file.originalname));
    const title = textValue(req.body.title, defaultTitle);
    const language = textValue(req.body.language, 'Romanian');
    const locale = normalizeLocale(req.body.locale, language.toLowerCase().startsWith('romanian') ? 'ro' : 'custom');
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

app.post('/api/games/github', async (req, res, next) => {
  try {
    const source = validateGithubSource(req.body.source);
    const title = textValue(req.body.title, source);
    const language = textValue(req.body.language, 'Polish');
    const locale = normalizeLocale(req.body.locale, language.toLowerCase().startsWith('polish') ? 'pl' : 'custom');
    const now = new Date().toISOString();
    const game = {
      id: createGameId(title),
      title,
      originalTitle: textValue(req.body.originalTitle),
      type: 'github',
      source,
      language,
      locale,
      notes: textValue(req.body.notes),
      createdAt: now,
      updatedAt: now
    };

    const games = await readUserGames();
    games.push(game);
    await writeUserGames(games);

    res.status(201).json({ game: publicGame(game) });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/games/:id', async (req, res, next) => {
  try {
    const id = req.params.id;

    if (BUILTIN_GAMES.some((game) => game.id === id)) {
      throw Object.assign(new Error('Bundled games cannot be removed.'), { statusCode: 403 });
    }

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
