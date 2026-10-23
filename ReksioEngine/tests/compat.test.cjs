const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Isolate format and script logic from PIXI's browser-only renderer and module cycles.
function loadModule(file, dependencies = {}) {
    const source = fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
    const code = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)((name) => {
        assert.ok(Object.hasOwn(dependencies, name), `Unmocked dependency: ${name}`);
        return dependencies[name];
    }, module, module.exports);
    return module.exports;
}

const { createEngineCompat, normalizeCompatProfile } = loadModule('engine/compat.ts');
const { readSoundArchive } = loadModule('fileFormats/archive/sound.ts');
const decorator = { method: () => (method) => method };
class FakeType {
    constructor(engine) { this.engine = engine; }
}
const { Database } = loadModule('engine/types/database.ts', {
    './index': { Type: FakeType },
    '../../common/types': decorator,
    '../../common/errors': { assert: assert.ok },
});
const { Sequence } = loadModule('engine/types/sequence.ts', {
    './index': { Type: FakeType },
    '../../filesystem/fileLoader': { FileNotFoundError: Error },
    '../../common/errors': { assert: assert.ok },
    './animo': { Animo: { Events: { ONFINISHED: 'finished' } } },
    '../../filesystem/assetsLoader': {},
    '../../filesystem/definitionLoader': {},
    '../../common/types': decorator,
    '../logging': { logger: { debug() {}, warn() {} } },
});

test('Pirates and unknown profiles retain all baseline compatibility flags', () => {
    for (const profile of [undefined, 'default', 'pirates', 'unknown']) {
        assert.ok(Object.values(createEngineCompat(profile)).every((value) => value === false));
    }
    assert.equal(normalizeCompatProfile('Reksio si Magicienii'), 'magicienii');
    assert.equal(createEngineCompat('magicienii').simpleWorldPathing, true);
    assert.equal(createEngineCompat('ozn').simpleWorldPathing, false);
    assert.equal(createEngineCompat('nemo').packedSounds, true);
    assert.equal(createEngineCompat('timpului').packedSounds, false);
});

function archiveEntry(name, payload) {
    const encodedName = Buffer.from(name + '\0');
    const header = Buffer.alloc(12);
    header.writeUInt32LE(payload.length, 4);
    header.writeUInt32LE(encodedName.length, 8);
    return Buffer.concat([header, encodedName, payload]);
}
function arrayBuffer(bytes) {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
test('SND indexes multiple names and preserves payload boundaries', () => {
    const input = arrayBuffer(Buffer.concat([
        archiveEntry('FIRST.WAV', Buffer.from('OggS123')),
        archiveEntry('second.wav', Buffer.from('RIFF456')),
    ]));
    const entries = readSoundArchive(input);
    assert.deepEqual(entries.map((entry) => entry.name), ['first.wav', 'second.wav']);
    assert.deepEqual(entries.map(({ offset, length }) => Buffer.from(input, offset, length).toString()), ['OggS123', 'RIFF456']);
    assert.throws(() => readSoundArchive(input.slice(0, input.byteLength - 1)), /bounds/);
    assert.throws(() => readSoundArchive(new ArrayBuffer(4)), /header/);
});

test('Nemo database lookup is case-insensitive without changing default profile', async () => {
    const database = new Database({ compat: createEngineCompat('nemo') });
    database.content = [{ GETFIELD: () => ({ getValue: () => 'game_status' }) }];
    assert.equal(await database.FIND('NAME', 'GAME_STATUS', 0), 0);
    database.engine.compat = createEngineCompat();
    assert.equal(database.FIND('NAME', 'GAME_STATUS', 0), -1);
});

test('Magicienii database lookup awaits INTEGER fields', async () => {
    const database = new Database({ compat: createEngineCompat('magicienii') });
    database.content = [101, 102, 104, 108].map((value) => ({ GETFIELD: () => ({ getValue: async () => value }) }));
    assert.equal(await database.FIND('TYPE', 102, 0), 1);
    assert.equal(await database.FIND('TYPE', 108, 0), 3);
    assert.equal(await database.FIND('TYPE', 999, 0), -1);
});

test('Nemo cutscene table accepts an absent optional last column', async () => {
    const rows = [];
    const database = new Database({
        compat: createEngineCompat('nemo'),
        currentScene: { getRelativePath: async (path) => path },
        filesystem: { getFile: async () => new TextEncoder().encode('scene|setmusic|intro\r\ntytul.ann|play\r\n').buffer },
    });
    database.baseStruct = {
        structure: new Map([['OBJ', 'STRING'], ['ACTION', 'STRING'], ['ARG', 'STRING']]),
        clone: async () => {
            const row = {};
            rows.push(row);
            return { setField: async (name, value) => { row[name] = value; } };
        },
    };
    database.updateCursorValue = () => {};
    await database.LOAD('scene.txt');
    assert.deepEqual(rows, [
        { OBJ: 'scene', ACTION: 'setmusic', ARG: 'intro' },
        { OBJ: 'tytul.ann', ACTION: 'play', ARG: '' },
    ]);
});

test('subsequence completion may pause until an external animation resumes it', async () => {
    const sequence = new Sequence({ compat: createEngineCompat('timpului') });
    const events = [];
    let advances = 0;
    sequence.runningSubSequence = { NAME: 'N2', TYPE: 'SPEAKING' };
    sequence.callbacks = { run: async (event, name) => { events.push([event, name]); sequence.PAUSE(); } };
    sequence.advanceQueue = async () => { advances++; };
    await sequence.progressNext();
    assert.deepEqual(events, [['ONFINISHED', 'N2']]);
    assert.equal(advances, 0);
    await sequence.RESUME();
    assert.equal(advances, 1);
    assert.equal(events.length, 1);
});

test('baseline sequences do not emit new subsection callbacks', async () => {
    const sequence = new Sequence({ compat: createEngineCompat() });
    sequence.runningSubSequence = { NAME: 'N2' };
    sequence.callbacks = { run: () => assert.fail('Unexpected new callback') };
    let advances = 0;
    sequence.advanceQueue = async () => { advances++; };
    await sequence.progressNext();
    assert.equal(advances, 1);
});

const { World } = loadModule('engine/types/world.ts', {
    './index': { Type: FakeType },
    '../../common/types': decorator,
    '../../common/errors': { NotImplementedError: Error },
});

test('Magicienii path movement reaches its target and signals it only once', async () => {
    const positions = [];
    const signals = [];
    const actor = {
        SETPOSITION: (x, y) => { positions.push([x, y]); },
        SIGNAL: (signal) => { signals.push(signal); },
        GETPOSITIONX: () => 400,
        GETPOSITIONY: () => 300,
    };
    const world = new World({ compat: createEngineCompat('magicienii'),
        getObject: () => actor, diagnostics: { worldState() {} } });
    world.LINK(100, 'ANNREX');
    world.START();
    world.FINDPATH(100, 9000, 200, 300, 0, false, false);
    for (let i = 0; i < 90; i++) {
        world.tick(1000 / 60);
        await world.FOLLOWPATH(100, 20, 0.5, 300);
    }
    assert.deepEqual(positions.at(-1), [200, 300]);
    assert.deepEqual(signals, ['ATGOAL']);
    assert.equal(world.GETMOVEDISTANCE(100), 0);
    const baseline = new World({ compat: createEngineCompat() });
    assert.throws(() => baseline.START());
});

test('Magicienii double division preserves fractional directions', async () => {
    class Value extends FakeType {
        value = 0;
        setValue(value) { this.value = value; }
        __call() { return 'unsupported'; }
    }
    const { Double } = loadModule('engine/types/double.ts', {
        './index': { ValueType: Value }, '../../common/types': decorator,
    });
    const value = new Double({ compat: createEngineCompat('magicienii') });
    await value.SET(22.5);
    await value.DIV(45);
    assert.equal(value.GET(), 0.5);
    value.engine.compat = createEngineCompat();
    assert.equal(await value.DIV(45), 'unsupported');
});

test('Magicienii entrance arrays match NULL fields and script string names', () => {
    const { ArrayObject } = loadModule('engine/types/array.ts', {
        './index': { ValueType: FakeType },
        '../../common/errors': { assert: assert.ok },
        '../../common/types': { ...decorator, valueAsString: (value) => value === null ? 'NULL' : String(value) },
        '../../filesystem/fileLoader': { FileNotFoundError: Error },
        '../../fileFormats/archive/array': {},
        '../logging': { logger: {} },
    });
    const entries = new ArrayObject({ compat: createEngineCompat('magicienii') });
    entries.value = [null, 'LUSTRO', null];
    assert.equal(entries.FIND('NULL'), 0);
    assert.equal(entries.REVERSEFIND('NULL'), 2);
    assert.equal(entries.FIND('lustro'), 1);
    assert.equal(entries.FIND('missing'), -1);
    entries.engine.compat = createEngineCompat();
    assert.equal(entries.FIND('NULL'), -1);
});

test('Magicienii dialogue sequences resolve dynamically loaded SOUND objects', async () => {
    const sequence = new Sequence({ compat: createEngineCompat('magicienii') });
    const entry = { NAME: 'GADABLANK', TYPE: 'SPEAKING', ANIMOFN: 'ANNCHARACTER', WAVFN: 'SNDATGOAL', PREFIX: 'GADA' };
    const actor = { definition: { FILENAME: 'ANNCHARACTER' }, hasEvent: () => false };
    let onEnd;
    let finished;
    sequence.activeAnimo = actor;
    sequence.sequenceName = 'GADABLANK';
    sequence.queue = [entry];
    sequence.getObject = (name) => name === 'SNDATGOAL' ? {
        definition: { TYPE: 'SOUND' }, playForSequence: (callback) => { onEnd = callback; return { stop() {} }; },
    } : null;
    sequence.callbacks = { run: async (event, name) => { finished = [event, name]; } };
    await sequence.advanceQueue();
    assert.equal(typeof onEnd, 'function');
    assert.equal(sequence.ISPLAYING(), true);
    onEnd();
    await sequence.tick(16);
    assert.equal(sequence.ISPLAYING(), false);
    assert.deepEqual(finished, ['ONFINISHED', 'GADABLANK']);
});
