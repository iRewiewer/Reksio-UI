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

test('Nemo database lookup is case-insensitive without changing default profile', () => {
    const database = new Database({ compat: createEngineCompat('nemo') });
    database.content = [{ GETFIELD: () => ({ getValue: () => 'game_status' }) }];
    assert.equal(database.FIND('NAME', 'GAME_STATUS', 0), 0);
    database.engine.compat = createEngineCompat();
    assert.equal(database.FIND('NAME', 'GAME_STATUS', 0), -1);
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
