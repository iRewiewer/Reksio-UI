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
const { OznMatrixSimulation } = loadModule('engine/compat/oznMatrix.ts');
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
    assert.equal(createEngineCompat('timpului').simpleWorldPathing, true);
    assert.equal(createEngineCompat('ozn').simpleWorldPathing, false);
    assert.equal(createEngineCompat('nemo').packedSounds, true);
    assert.equal(createEngineCompat('timpului').packedSounds, false);
});

function matrixFromRows(rows) {
    const model = new OznMatrixSimulation(rows[0].length, rows.length);
    rows.forEach((row, y) => model.setRow(y, row));
    return model;
}

test('live trace toggles immediately and resets cached diagnostic queries', async () => {
    const { EngineDiagnostics } = loadModule('engine/diagnostics.ts');
    const messages = [];
    const original = console.info;
    console.info = (message) => messages.push(message);
    try {
        const diagnostics = new EngineDiagnostics({
            options: {}, currentScene: { name: 'ARCADE', scope: { objects: [] } },
        }, false, 'CIEMNOSC');
        diagnostics.hitTests.set('query', 'old-result');
        diagnostics.mousePositions.set('mouse', 'old-position');
        await diagnostics.setTrace(true);
        assert.equal(diagnostics.enabled, true);
        assert.equal(diagnostics.hitTests.size, 0);
        assert.equal(diagnostics.mousePositions.size, 0);
        assert.match(messages.pop(), /"label":"trace-enabled"/);
        diagnostics.sceneChanging('ARCADE');
        assert.match(messages.pop(), /trace:scene-changing/);
        await diagnostics.setTrace(false);
        diagnostics.sceneChanging('ARCADE');
        assert.deepEqual(messages, []);
        await diagnostics.setTrace(true, 'OTHER');
        diagnostics.behaviour({ name: 'BEHCLICK' }, 'RUN');
        assert.deepEqual(messages, []);
    } finally {
        console.info = original;
    }
});

test('live trace updates the options used by player restarts and checkpoint restores', async () => {
    const { GamePlayerInstance } = loadModule('index.ts', {
        './engine': {}, 'pixi.js': {}, './filesystem/fileLoader': {},
        './engine/saveFile': {}, './filesystem/fileStorage': {},
    });
    const calls = [];
    const engine = { options: { trace: false, traceScene: 'CIEMNOSC' },
        diagnostics: { setTrace: async (...args) => calls.push(args) } };
    const player = new GamePlayerInstance(engine);
    await player.setTrace(true);
    assert.deepEqual(calls.pop(), [true, '*']);
    assert.equal(engine.options.trace, true);
    assert.equal(engine.options.traceScene, '*');
    await player.setTrace(false);
    assert.equal(engine.options.trace, false);
    assert.deepEqual(calls.pop(), [false, '*']);
});

test('Magicienii checkpoint restore clears transient page overlays without emitting completion callbacks', () => {
    const { restoreMagicieniiTransitionState } = loadModule('engine/patches/magicienii.ts');
    const calls = [];
    const objects = Object.fromEntries(['G_ANNPAGE', 'G_STLPAGE', 'G_IMGPAGE'].map((name) => [name, {
        STOP: (signal) => calls.push([name, 'stop', signal]), HIDE: () => calls.push([name, 'hide']),
    }]));
    restoreMagicieniiTransitionState({ getObject: (name) => objects[name] });
    assert.deepEqual(calls, [
        ['G_ANNPAGE', 'stop', false], ['G_ANNPAGE', 'hide'],
        ['G_STLPAGE', 'stop', false], ['G_STLPAGE', 'hide'], ['G_IMGPAGE', 'hide'],
    ]);
    restoreMagicieniiTransitionState({ getObject: () => null });
});

test('Magicienii inventory opacity queries return byte values without changing other profiles', () => {
    const { DisplayType } = loadModule('engine/types/index.ts', {
        '../components/callbacks': {}, '../../common/errors': { assert: assert.ok },
        '../components/events': {}, '../../common/types': decorator, '../logging': {},
    });
    const sprite = { alpha: 1 };
    const object = { engine: { compat: createEngineCompat('magicienii') },
        getRenderObject: () => sprite, __call: () => 'unsupported' };
    assert.equal(DisplayType.prototype.GETOPACITY.call(object), 255);
    sprite.alpha = 0;
    assert.equal(DisplayType.prototype.GETOPACITY.call(object), 0);
    sprite.alpha = 128 / 255;
    assert.equal(DisplayType.prototype.GETOPACITY.call(object), 128);
    for (const profile of ['default', 'ozn', 'nemo', 'timpului']) {
        object.engine.compat = createEngineCompat(profile);
        assert.equal(DisplayType.prototype.GETOPACITY.call(object), 'unsupported');
    }
});

function matrixTick(model) {
    model.tick();
    const moves = [];
    let move;
    while ((move = model.next())) moves.push(move);
    return moves;
}

test('OZN MATRIX drops only the bottom of a stone stack per tick', () => {
    const model = matrixFromRows([
        [6, 6, 6, 6, 6], [6, 0, 2, 0, 6], [6, 0, 2, 0, 6],
        [6, 0, 0, 0, 6], [6, 0, 0, 0, 6], [6, 6, 6, 6, 6],
    ]);
    assert.deepEqual(matrixTick(model), [{ x: 2, y: 2, code: 1, latest: true, result: 0 }]);
    assert.equal(model.get(7), 2);
    assert.equal(model.get(12), 0);
    assert.equal(model.get(17), 2);
    assert.deepEqual(matrixTick(model), [
        { x: 2, y: 3, code: 1, latest: false, result: 1 },
        { x: 2, y: 1, code: 1, latest: true, result: 0 },
    ]);
});

test('OZN MATRIX rolls left first and only when supported by another stone', () => {
    const model = matrixFromRows([
        [6, 6, 6, 6, 6], [6, 0, 2, 0, 6], [6, 0, 2, 0, 6], [6, 6, 6, 6, 6],
    ]);
    assert.deepEqual(matrixTick(model), [{ x: 2, y: 1, code: 2, latest: true, result: 0 }]);
    assert.equal(model.get(11), 2);
    model.set(11, 0);
    model.set(7, 2);
    model.set(6, 4);
    assert.equal(matrixTick(model)[0].code, 3);
    model.set(7, 2);
    model.set(12, 4);
    assert.deepEqual(matrixTick(model), []);
});

test('OZN MATRIX preserves last-move callbacks and hero/enemy collision semantics', () => {
    const hero = matrixFromRows([
        [6, 6, 6, 6, 6], [6, 0, 2, 0, 6], [6, 0, 0, 0, 6],
        [6, 0, 99, 0, 6], [6, 6, 6, 6, 6],
    ]);
    assert.deepEqual(matrixTick(hero), [{ x: 2, y: 1, code: 1, latest: true, result: 2 }]);
    const enemy = matrixFromRows([
        [6, 6, 6, 6, 6], [6, 0, 2, 0, 6], [6, 0, 0, 0, 6],
        [6, 0, 5, 0, 6], [6, 6, 6, 6, 6],
    ]);
    assert.equal(matrixTick(enemy)[0].code, 1);
    assert.deepEqual(matrixTick(enemy), [{ x: 2, y: 2, code: 4, latest: true, result: 0 }]);
    assert.equal(enemy.get(12), 2);
    assert.equal(enemy.get(17), 5);
    assert.deepEqual(matrixTick(enemy), []);
    enemy.set(18, 8);
    enemy.move(12, 18);
    assert.equal(enemy.get(18), 8);
    assert.equal(enemy.get(12), 0);
});

test('OZN MATRIX gate checks and enemy wall following use native cell rules', () => {
    const model = matrixFromRows([
        [6, 6, 6, 6, 6], [6, 0, 0, 0, 6], [6, 0, 5, 0, 6],
        [6, 0, 99, 0, 6], [6, 6, 6, 6, 6],
    ]);
    assert.equal(model.enemyDirection(12, 0), 3);
    model.setGate(2, 3, 2, 3);
    assert.equal(model.enemyDirection(12, 0), 0);
    model.set(11, 1);
    assert.equal(model.enemyDirection(12, 0), 1);
    model.set(7, 1);
    assert.equal(model.enemyDirection(12, 0), 2);
    model.set(13, 1);
    assert.equal(model.enemyDirection(12, 0), 4);
    assert.equal(model.enemyDestination(12, 4), 12);
    model.setGate(0, 0, 0, 0);
    model.set(7, 0);
    model.set(17, 0);
    assert.equal(model.enemyDirection(12, 4), 1);
    model.setGate(2, 3, 2, 3);
    for (const code of [0, 1, 3, 5, 8, 9]) {
        model.set(11, code);
        assert.equal(model.canHeroGoTo(11), true);
    }
    for (const code of [2, 4, 6, 7, 99]) {
        model.set(11, code);
        assert.equal(model.canHeroGoTo(11), false);
    }
    model.set(17, 0);
    assert.equal(model.canHeroGoTo(17), false);
    assert.equal(model.isGateEmpty(), true);
    model.set(17, 2);
    assert.equal(model.isGateEmpty(), false);
    assert.equal(model.canHeroGoTo(-1), false);
    assert.throws(() => new OznMatrixSimulation(-1, 11), /dimensions/);
});

test('OZN MATRIX script API supports coordinate overloads and three callback arguments', async () => {
    const { Matrix } = loadModule('engine/types/matrix.ts', {
        './index': { Type: FakeType }, '../../common/types': decorator,
        '../../common/errors': { NotImplementedError: Error },
        '../compat/oznMatrix': { OznMatrixSimulation }, './behaviour': {},
    });
    const received = [];
    const engine = { compat: createEngineCompat('ozn'), diagnostics: { callback() {} },
        scripting: { executeCallback: async (...args) => received.push(args[3]) } };
    const matrix = new Matrix(engine);
    matrix.definition = { NAME: 'MAT', TYPE: 'MATRIX', SIZE: [5, 5], BASEPOS: [10, 100],
        CELLWIDTH: 40, CELLHEIGHT: 30, ONLATEST: { behaviourReference: 'MOVE', constantArguments: [] } };
    matrix.getObject = () => ({ RUNC: async (...args) => received.push(args) });
    matrix.init();
    for (let row = 0; row < 5; row++) matrix.SETROW(row, 6, row === 0 || row === 4 ? 6 : 0, 0, 0, 6);
    matrix.SET(2, 1, 2);
    assert.equal(matrix.GET(7), 2);
    assert.equal(matrix.GET(2, 1), 2);
    assert.equal(matrix.GETCELLSNO(2), 1);
    assert.equal(matrix.GETCELLPOSX(7), 90);
    assert.equal(matrix.GETCELLPOSX(2, 1), 90);
    assert.equal(matrix.GETCELLPOSY(7), 130);
    assert.equal(matrix.GETCELLPOSY(2, 1), 130);
    assert.equal(matrix.GETOFFSET(91, 131), 7);
    assert.equal(matrix.GETOFFSET(210, 131), -1);
    matrix.TICK();
    assert.equal(await matrix.NEXT(), 0);
    assert.deepEqual(received.pop(), [2, 1, 1]);
    assert.equal(matrix.GET(12), 2);
    matrix.definition.ONLATEST = { code: 'INLINE', constantArguments: [] };
    matrix.TICK();
    await matrix.NEXT();
    assert.deepEqual(received.pop(), [2, 2, 1]);
    for (const profile of ['default', 'magicienii', 'nemo', 'timpului']) {
        engine.compat = createEngineCompat(profile);
        assert.throws(() => matrix.init());
    }
});

test('OZN image clones join the renderer at their original priority without changing Pirates', async () => {
    class FakeSprite {
        constructor(texture) { this.texture = texture; this.visible = true; }
    }
    class FakeDisplay extends FakeType {
        async clone() { return new this.constructor(this.engine); }
        GETPRIORITY() { return 7; }
        SETPRIORITY(priority) { this.sprite.zIndex = priority; }
    }
    const { Image } = loadModule('engine/types/image.ts', {
        './index': { DisplayType: FakeDisplay }, '../../common/errors': { assert: assert.ok },
        'pixi.js': {}, '../../filesystem/assetsLoader': {},
        '../rendering': { AdvancedSprite: FakeSprite }, '../../common/types': decorator,
    });
    const added = [];
    const engine = { compat: createEngineCompat('ozn'), rendering: { addToStage: (sprite) => added.push(sprite) } };
    const image = new Image(engine);
    image.definition = { TOCANVAS: true };
    image.sprite = { texture: {}, x: 40, y: 100, visible: false, alpha: 0.8, hitmap: new Uint8Array([255]) };
    const clone = await image.clone();
    assert.equal(added[0], clone.sprite);
    assert.equal(clone.sprite.zIndex, 7);
    assert.equal(clone.sprite.visible, false);
    assert.equal(clone.sprite.alpha, 0.8);
    assert.equal(clone.sprite.x, 40);
    assert.equal(clone.sprite.y, 100);
    assert.equal(clone.sprite.hitmap, image.sprite.hitmap);
    for (const profile of ['default', 'magicienii', 'nemo', 'timpului']) {
        engine.compat = createEngineCompat(profile);
        await image.clone();
    }
    assert.equal(added.length, 1);
});

test('Nemo refreshes invisible hotspot transforms without changing Pirates hit tests', () => {
    const pixi = require('pixi.js');
    const { AdvancedSprite } = loadModule('engine/rendering.ts', {
        'pixi.js': pixi, '../common/errors': { assert: assert.ok },
    });
    class Display extends FakeType {}
    class ClassInstance extends FakeType {}
    const { CanvasObserver } = loadModule('engine/types/canvasObserver.ts', {
        './index': { Type: FakeType, DisplayType: Display },
        '../../filesystem/assetsLoader': {},
        'pixi.js': pixi,
        '../../common/types': decorator,
        '../rendering': { AdvancedSprite },
        '../../common/errors': {}, '../../fileFormats/img': {}, '../logging': {},
        './class': { ClassInstance },
    });
    const stage = new pixi.Container();
    const sprite = new AdvancedSprite(new pixi.Texture(new pixi.BaseTexture(null, { width: 36, height: 85 })));
    sprite.visible = false;
    sprite.zIndex = 399;
    sprite.hitmap = new Uint8Array(36 * 85).fill(255);
    sprite.position.set(140, 44);
    stage.addChild(sprite);
    const object = new Display();
    object.name = 'ANNMASKA1_3';
    object.getRenderObject = () => sprite;
    let objects = [object];
    const engine = {
        compat: createEngineCompat('nemo'), app: { stage },
        scopeManager: { find: (predicate) => objects.find((entry) => predicate(entry.name, entry)) ?? null },
        diagnostics: { hitTest() {} },
    };
    const observer = new CanvasObserver(engine);
    assert.equal(sprite.getGlobalPosition().x, 140);
    assert.equal(sprite.worldTransform.tx, 0);
    assert.equal(observer.GETGRAPHICSAT(160, 87, false, 399, 399), object.name);
    sprite.position.x = 240;
    assert.equal(observer.GETGRAPHICSAT(260, 87, true, 399, 399), null);
    assert.equal(sprite.worldTransform.tx, 140);
    engine.compat = createEngineCompat();
    assert.equal(observer.GETGRAPHICSAT(260, 87, false, 399, 399), null);
    for (const profile of ['default', 'magicienii', 'ozn', 'timpului']) {
        assert.equal(createEngineCompat(profile).hiddenHotspotTransforms, false);
        assert.equal(createEngineCompat(profile).classHotspotOwners, false);
    }
    const owner = new ClassInstance(engine);
    owner.name = 'KRET';
    owner.scope = { objects: [object] };
    objects = [owner];
    sprite.visible = true;
    sprite.toGlobal(new pixi.Point(0, 0));
    assert.equal(observer.GETGRAPHICSAT(260, 87, true, 399, 399), null);
    engine.compat = createEngineCompat('nemo');
    assert.equal(observer.GETGRAPHICSAT(260, 87, true, 399, 399), 'KRET');
    stage.destroy({ children: true, texture: true, baseTexture: true });
});

function archiveEntry(name, payload) {
    const encodedName = Buffer.from(name + '\0');
    const header = Buffer.alloc(12);
    header.writeUInt32LE(payload.length, 4);
    header.writeUInt32LE(encodedName.length, 8);
    return Buffer.concat([header, encodedName, payload]);
}

test('Nemo class constructors receive their instance name before explicit arguments', async () => {
    class Base {
        constructor(engine, parent, definition) {
            Object.assign(this, { engine, parent, definition, name: definition.NAME });
        }
        get parentScope() { return this.parent?.scope; }
    }
    const constructed = [];
    const { Class } = loadModule('engine/types/class.ts', {
        './index': { Type: Base, ParentType: Base }, '../../common/types': decorator,
        '../scope': { Scope: class {} },
        '../../filesystem/definitionLoader': {
            loadDefinition: async (_engine, _scope, _definition, instance) => {
                constructed.push(instance.args);
            },
            doReady: async () => {},
        },
        '../../common/errors': { assert: assert.ok }, './behaviour': {},
        '../logging': { logger: { debug() {} } },
    });
    const engine = { compat: createEngineCompat('nemo') };
    const cls = new Class(engine, null, { TYPE: 'CLASS', NAME: 'WALKER' });
    cls.innerDefinition = {};
    await cls.NEW('KRET');
    await cls.NEW('ENEMY0', '1_ENEMY0.ANN', 2, 5, 16);
    assert.deepEqual(constructed, [['KRET'], ['ENEMY0', '1_ENEMY0.ANN', 2, 5, 16]]);
    for (const profile of ['default', 'magicienii', 'ozn', 'timpului']) {
        engine.compat = createEngineCompat(profile);
        await cls.NEW('UNCHANGED', 42);
        assert.deepEqual(constructed.at(-1), [42]);
    }
});

test('Nemo rectangular button priorities keep inventory items above the close overlay', () => {
    const { Button } = loadModule('engine/types/button.ts', {
        './index': { Type: FakeType }, './image': {}, './animo': {}, './sound': {},
        'pixi.js': { Point: class {}, Graphics: class {}, Rectangle: class {
            constructor(x, y, width, height) { Object.assign(this, { x, y, width, height, top: y }); }
        } },
        '../components/button': { ButtonLogicComponent: class {} },
        '../../common/errors': {}, '../../common/types': decorator, '../logging': {},
    });
    const engine = { compat: createEngineCompat('nemo'), rendering: { addToStage() {}, sortObjects() {} } };
    const item = new Button(engine, null, {});
    item.definition = { ENABLE: false };
    item.SETPRIORITY(20010);
    item.SETRECT(100, 300, 160, 360);
    assert.equal(item.interactArea.zIndex, 20010);
    item.SETRECT(150, 250, 210, 310);
    assert.equal(item.interactArea.zIndex, 20010);
    const overlay = new Button(engine, null, {});
    overlay.definition = { ENABLE: false };
    overlay.SETRECT(0, 0, 800, 600);
    overlay.SETPRIORITY(20000);
    assert.ok(item.interactArea.zIndex > overlay.interactArea.zIndex);
    engine.compat = createEngineCompat();
    const baseline = new Button(engine, null, {});
    baseline.definition = { ENABLE: false };
    baseline.setRect([100, 300, 160, 360]);
    baseline.SETPRIORITY(20010);
    assert.equal(baseline.interactArea.zIndex, 9999999 - 300);
});

test('Nemo inventory frame steps stay within the active event and leave Pirates unchanged', async () => {
    const { Animo } = loadModule('engine/types/animo.ts', {
        './index': { DisplayType: FakeType }, '../../common/errors': {}, 'pixi.js': {},
        '../components/button': {}, '../../filesystem/assetsLoader': {},
        '../../filesystem/fileLoader': {}, '../rendering': {}, '../../common/types': decorator,
        '../components/collisions': {}, '../audio': {}, '../logging': {},
    });
    const animation = Object.create(Animo.prototype);
    animation.engine = { compat: createEngineCompat('nemo') };
    animation.currentEvent = { name: 'IDLE', framesCount: 2 };
    animation.currentFrame = 0;
    animation.SETFRAME = async (name, frame) => {
        assert.equal(name, 'IDLE');
        animation.currentFrame = frame;
    };
    await animation.NEXTFRAME();
    assert.equal(animation.currentFrame, 1);
    await animation.NEXTFRAME();
    assert.equal(animation.currentFrame, 1);
    await animation.PREVFRAME();
    await animation.PREVFRAME();
    assert.equal(animation.currentFrame, 0);
    animation.engine.compat = createEngineCompat();
    animation.__call = (name) => name;
    assert.equal(await animation.NEXTFRAME(), 'NEXTFRAME');
    assert.equal(await animation.PREVFRAME(), 'PREVFRAME');
    assert.equal(animation.currentFrame, 0);
});

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
    sequence.callbacks = { hasParametrized: () => true,
        run: async (event, name) => { events.push([event, name]); sequence.PAUSE(); } };
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

test('modern sequences finish single entries once and reserve subsection events for named callbacks', async () => {
    for (const profile of ['magicienii', 'timpului', 'nemo']) {
        const sequence = new Sequence({ compat: createEngineCompat(profile) });
        const events = [];
        sequence.callbacks = { hasParametrized: (_event, name) => name === 'LINE2',
            run: async (event, name) => events.push([event, name]) };
        sequence.sequenceName = 'GADABLANK';
        sequence.runningSubSequence = { NAME: 'GADABLANK', TYPE: 'SPEAKING' };
        await sequence.progressNext();
        assert.deepEqual(events, [['ONFINISHED', 'GADABLANK']]);
        sequence.sequenceName = 'CUTSCENE';
        sequence.runningSubSequence = { NAME: 'LINE1', TYPE: 'SPEAKING' };
        sequence.advanceQueue = async () => {};
        await sequence.progressNext();
        assert.equal(events.length, 1);
        sequence.runningSubSequence = { NAME: 'LINE2', TYPE: 'SPEAKING' };
        await sequence.progressNext();
        assert.deepEqual(events.at(-1), ['ONFINISHED', 'LINE2']);
    }
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

test('JPEG alpha decoding uses the LZO view length, not its backing allocation', () => {
    const allocation = Uint8Array.from([99, 99, 0, 127, 255, 0, 99, 99]);
    const { decompressCLZW } = loadModule('fileFormats/compression/clzw.ts', {
        'lzo-ts': { LZO: { decompress: () => allocation.subarray(2, 6) } },
    });
    const input = { getUint32: () => 4, read: () => new ArrayBuffer(4) };
    assert.deepEqual([...new Uint8Array(decompressCLZW(input, true))], [0, 127, 255, 0]);
    assert.equal(decompressCLZW(input).byteLength, 8);
});

test('Time Machine sequence completion can start the next sequence immediately', async () => {
    const sequence = new Sequence({ compat: createEngineCompat('timpului') });
    const played = [];
    const actor = { definition: { FILENAME: 'actor' }, hasEvent: () => true,
        playEvent: async (event) => { played.push(event); } };
    sequence.activeAnimo = actor;
    sequence.sequenceName = 'FIRST';
    sequence.parameterSequence = { NAME: 'ROOT' };
    sequence.parametersMapping.set('NEXT', 0);
    sequence.subEntries.set('ROOT', [{ NAME: 'NEXT_ENTRY', TYPE: 'SIMPLE', FILENAME: 'actor', EVENT: 'NEXT_EVENT' }]);
    sequence.callbacks = { run: async (event, name) => { if (name === 'FIRST') await sequence.PLAY('NEXT'); } };
    await sequence.progressNext();
    assert.deepEqual(played, ['NEXT_EVENT']);
    assert.equal(sequence.sequenceName, 'NEXT');
});

test('Time Machine music-name patch is confined to its episode helpers', () => {
    const { patchTimeMachineDefinitions } = loadModule('engine/patches/timpului.ts');
    const definitions = {
        BEHMUSICSET: { CODE: { code: 'G_ITEMP^SET($1);' } },
        BFITMP15: { CODE: { code: 'G_SMUSIC^SET(G_ITEMP);' } },
        OTHER: { CODE: { code: 'G_ITEMP^SET(3);' } },
    };
    patchTimeMachineDefinitions('other.cnv', definitions);
    assert.equal(definitions.BEHMUSICSET.CODE.code, 'G_ITEMP^SET($1);');
    patchTimeMachineDefinitions('dane/game/przygoda/przygoda.cnv', definitions);
    assert.equal(definitions.BEHMUSICSET.CODE.code, 'G_SMUSIC^SET($1);');
    assert.equal(definitions.BFITMP15.CODE.code, 'G_SMUSIC^SET(G_SMUSIC);');
    assert.equal(definitions.OTHER.CODE.code, 'G_ITEMP^SET(3);');
    for (const profile of ['default', 'magicienii', 'ozn', 'nemo']) {
        assert.equal(createEngineCompat(profile).timeMachineDefinitions, false);
    }
});

test('Time Machine keeps its dynamically loaded Reksio object alive with a valid placeholder', () => {
    const { patchTimeMachineDefinitions } = loadModule('engine/patches/timpului.ts');
    const definitions = { ANNREX: { FILENAME: 'REX.ANN' }, OTHER: { FILENAME: 'REX.ANN' } };
    patchTimeMachineDefinitions('dane/game/przygoda/arcade/arcade.cnv', definitions);
    assert.equal(definitions.ANNREX.FILENAME, 'TEMPLATE.ANN');
    assert.equal(definitions.OTHER.FILENAME, 'REX.ANN');
});

test('modern scripts can assign struct fields without enabling this for Pirates', async () => {
    class Struct {
        getField(name) { return name === 'VALUE' ? this.field : undefined; }
    }
    const { Interpreter, RuntimeContext } = loadModule('interpreter/interpreter.ts', {
        '../engine/types': { Type: FakeType, ValueType: FakeType },
        '../engine/types/struct': { Struct },
        '../common/types': {},
        '../engine/types/rand': { Rand: FakeType },
        '../engine/types/system': { System: FakeType },
        '../engine/types/cnvloader': { CNVLoader: FakeType },
        '../fileFormats/common': {},
        '../engine/types/behaviour': {},
        '../common/errors': { IgnorableError: Error },
        '../engine/types/integer': {},
        '../engine/types/string': {},
        '../engine/types/double': {},
        '../engine/types/bool': {},
        './parser': {}, './expression': {}, './expression/ast': {},
        '../engine/logging': {}, './stacktrace': {},
    });
    const row = new Struct();
    row.field = { value: 'INTRO_TYTUL', SET(value) { this.value = value; } };
    const engine = { compat: createEngineCompat('nemo'),
        diagnostics: { objectLookup() {} }, getObject: (name) => name === 'STLINE' ? row : null };
    const interpreter = new Interpreter(new RuntimeContext(engine, null, ''));
    const field = await interpreter.resolveObjectRef({ type: 'Identifier', name: 'STLINE|VALUE' });
    field.SET('GAME');
    assert.equal(row.field.value, 'GAME');
    engine.compat = createEngineCompat();
    assert.equal(await interpreter.resolveObjectRef({ type: 'Identifier', name: 'STLINE|VALUE' }), null);
});

test('OZN intro punctuation repairs do not affect other scenes or games', () => {
    const { patchOznSource } = loadModule('engine/patches/ozn.ts');
    const source = 'UFOLECI:ONFINISHED^1={THIS^PLAY("2"):;}\nTIMER1:ONINIT={THIS^DISABLE():;}\nTIMERKUR:ONINIT={THIS^DISABLE():;}';
    assert.equal(patchOznSource('other.cnv', source), source);
    const fixed = patchOznSource('dane/reksioufo/przygoda/s1_0_intro1/s1_0_intro1.cnv', source);
    assert.equal(fixed, source.replaceAll('):;', ');'));
    for (const profile of ['default', 'magicienii', 'timpului', 'nemo']) {
        assert.equal(createEngineCompat(profile).oznDefinitions, false);
    }
    assert.equal(createEngineCompat('ozn').oznDefinitions, true);
});

test('Nemo ANN frame extensions follow names without consuming the next frame', () => {
    const { loadAnn } = loadModule('fileFormats/ann/index.ts', {
        '../utils': loadModule('fileFormats/utils.ts'), '../img': {}, '../compression': {},
    });
    const header = Buffer.alloc(52);
    header.writeUInt32LE(0x50564e);
    header.writeUInt16LE(1, 8);
    const event = Buffer.alloc(67 + 4);
    event.write('PLAY');
    event.writeUInt16LE(2, 32);
    const frame = Buffer.alloc(30);
    frame.writeUInt32LE(1);
    frame.writeUInt32LE(1, 4);
    frame.writeInt16LE(-117, 8);
    frame.writeInt16LE(72, 10);
    const name = Buffer.concat([Buffer.from([6, 0, 0, 0]), Buffer.from('Clone\0')]);
    const extension = Buffer.alloc(16);
    extension.writeUInt32LE(12);
    extension.writeFloatLE(-0.6, 4);
    extension.writeFloatLE(1, 8);
    extension.writeFloatLE(1, 12);
    const nextFrame = Buffer.alloc(30);
    nextFrame.writeInt16LE(9, 8);
    nextFrame.writeInt16LE(10, 10);
    const input = arrayBuffer(Buffer.concat([header, event, frame, name, extension, nextFrame]));
    const ann = loadAnn(input, true);
    assert.deepEqual(ann.events[0].frames.map(({ name, positionX, positionY }) => [name, positionX, positionY]),
        [['Clone', -117, 72], ['', 9, 10]]);
    assert.equal(createEngineCompat('nemo').trailingAnnFrameData, true);
    assert.equal(createEngineCompat().trailingAnnFrameData, false);
});

test('modern INTEGER RANDOM assigns its result while the baseline only returns it', async () => {
    class Value extends FakeType {
        value = 0;
        setValue(value) { this.value = value; }
    }
    const { Integer } = loadModule('engine/types/integer.ts', {
        './index': { ValueType: Value }, '../../common/types': decorator,
    });
    const integer = new Integer({ compat: createEngineCompat('timpului') });
    assert.equal(await integer.RANDOM(5, 1), 5);
    assert.equal(integer.value, 5);
    assert.equal(await integer.RANDOM(1), 0);
    assert.equal(integer.value, 0);
    integer.engine.compat = createEngineCompat();
    assert.equal(await integer.RANDOM(7, 1), 7);
    assert.equal(integer.value, 0);
    assert.equal(Number.isNaN(await integer.RANDOM(1)), true);
});

test('modern keyboard input can be re-enabled after a transition', () => {
    const { Keyboard } = loadModule('engine/types/keyboard.ts', {
        './index': { Type: FakeType }, '../../common/types': decorator, '../logging': {},
    });
    const keyboard = new Keyboard({ compat: createEngineCompat('nemo') });
    keyboard.__call = () => 'unsupported';
    keyboard.DISABLE();
    assert.equal(keyboard.ISENABLED(), false);
    keyboard.ENABLE();
    assert.equal(keyboard.ISENABLED(), true);
    keyboard.engine.compat = createEngineCompat();
    keyboard.DISABLE();
    assert.equal(keyboard.ENABLE(), 'unsupported');
    assert.equal(keyboard.ISENABLED(), false);
});

test('Nemo checkpoint restore reloads only an existing selected save slot', async () => {
    const { restoreNemoSaveDatabase } = loadModule('engine/patches/nemo.ts');
    const calls = [];
    const engine = {
        getObject: (name) => name === 'SGSLOTNAME' ? { getValue: () => '2' }
            : { __call: async (...args) => { calls.push(args); } },
        resolvePath: async (path) => { assert.equal(path, '$COMMON/SAVE/SLOT2.DTA'); return path; },
        filesystem: { hasFile: async () => true },
    };
    await restoreNemoSaveDatabase(engine);
    assert.deepEqual(calls, [['DBLOAD', []]]);
    engine.filesystem.hasFile = async () => false;
    await restoreNemoSaveDatabase(engine);
    assert.equal(calls.length, 1);
});

test('callback removal targets only the requested event or parameter', () => {
    const { CallbacksComponent } = loadModule('engine/components/callbacks.ts', {
        '../../common/errors': { assert: assert.ok }, '../../fileFormats/cnv/types': {},
        '../../interpreter/stacktrace': {}, '../../interpreter': {},
    });
    const callbacks = new CallbacksComponent({ compat: createEngineCompat() }, {});
    callbacks.addBehaviour('ONFINISHED', 'DONE');
    callbacks.addBehaviour('ONBRUTALCHANGED$__END__', 'END');
    callbacks.addBehaviour('ONBRUTALCHANGED$PLAY', 'PLAY');
    callbacks.removeBehaviour('ONBRUTALCHANGED$__END__');
    assert.equal(callbacks.registry.get('ONBRUTALCHANGED').parametrized.has('__END__'), false);
    assert.equal(callbacks.registry.get('ONBRUTALCHANGED').parametrized.has('PLAY'), true);
    callbacks.removeBehaviour('ONFINISHED');
    assert.equal(callbacks.has('ONFINISHED'), false);
});

test('Nemo clone cleanup destroys only the requested range and retains identities', () => {
    const { Scene } = loadModule('engine/types/scene.ts', {
        './index': { ParentType: FakeType }, './behaviour': {},
        '../../common/errors': { assert: assert.ok }, '../../common/types': decorator,
        '../../filesystem/assetsLoader': {}, '../../filesystem': {}, './group': {}, './animo': {},
    });
    const removed = [];
    const destroyed = [];
    const clones = [1, 2, 3].map((number) => ({ name: `ANN_${number}`, isReady: true,
        destroy: () => destroyed.push(number), parentScope: { remove: (name) => removed.push(name) } }));
    const scene = new Scene({ compat: createEngineCompat('nemo') });
    scene.getObject = () => ({ clones });
    scene.REMOVECLONES('ANN', 2, 2);
    assert.deepEqual(removed, ['ANN_2']);
    assert.equal(clones.length, 3);
    scene.REMOVECLONES('ANN', -1, -1);
    assert.deepEqual(destroyed, [2, 1, 3]);
    assert.equal(clones.every((clone) => !clone.isReady), true);
});

test('modern argument values preserve filenames, empty strings and object-target interpolation', async () => {
    class Value extends FakeType {
        setValue(value) { this.value = value; }
        getValue() { return this.value; }
    }
    class Struct { getField() { return { getValue: () => 'field value' }; } }
    const common = { toNumber: (value) => parseFloat(value) || 0, valueAsBool: (value) => value === 'TRUE',
        valueAsString: (value) => String(value) };
    const parser = loadModule('interpreter/parser.ts', {
        './ast': loadModule('interpreter/ast.ts'), '../common/types': common,
    });
    const stackFrame = { type() { return this; }, method() { return this; }, object() { return this; },
        args() { return this; }, build() { return {}; } };
    const { runCode } = loadModule('interpreter/interpreter.ts', {
        '../engine/types': { Type: FakeType, ValueType: Value }, '../engine/types/struct': { Struct },
        '../common/types': common, '../engine/types/rand': { Rand: FakeType },
        '../engine/types/system': { System: FakeType }, '../engine/types/cnvloader': { CNVLoader: FakeType },
        '../fileFormats/common': {}, '../engine/types/behaviour': {},
        '../common/errors': { IgnorableError: Error }, '../engine/types/integer': { Integer: Value },
        '../engine/types/string': { String: Value }, '../engine/types/double': { Double: Value },
        '../engine/types/bool': { Bool: Value }, './parser': parser, './expression': {}, './expression/ast': {},
        '../engine/logging': {}, './stacktrace': { StackFrame: { builder: () => stackFrame }, stackTrace: [] },
    });
    const values = [];
    const objects = new Map([['TARGET', { SET(value) { values.push(value); } }], ['ROW', new Struct()]]);
    const engine = { compat: createEngineCompat('nemo'), getObject: (name) => objects.get(name) ?? null,
        diagnostics: { scriptStatement() {}, objectLookup() {} },
        scopeManager: { localScopes: [{ set: (name, value) => objects.set(name, value) }] } };
    await runCode(engine, null, '@STRING("LOCAL",$1);TARGET^SET(LOCAL);TARGET^SET($2);TARGET^SET($3);',
        ['00B_INTRO', '', 'text, with "quotes"; and brackets [x]'], false);
    assert.deepEqual(values, ['00B_INTRO', '', 'text, with "quotes"; and brackets [x]']);
    await runCode(engine, null, '$1^$2("prefix_$3");TARGET^SET($4|VALUE);', ['TARGET', 'SET', '00B', 'ROW'], false);
    assert.deepEqual(values.slice(-2), ['prefix_00B', 'field value']);
    const numericArgument = new Value(engine);
    numericArgument.setValue(42);
    await runCode(engine, null, 'TARGET^SET($1);', [numericArgument], false);
    assert.equal(values.at(-1), 42);
    const place = new Value(engine);
    place.setValue('KURATOR');
    objects.set('PLACE', place);
    objects.set('BEHCLICK_KURATOR', { RUN() { values.push('curator clicked'); } });
    objects.set('field value', { RUN() { values.push('field target clicked'); } });
    await runCode(engine, null, '*["BEHCLICK_"+PLACE]^RUN();*ROW|VALUE^RUN();', [], false);
    assert.deepEqual(values.slice(-2), ['curator clicked', 'field target clicked']);
    engine.compat = createEngineCompat();
    await runCode(engine, null, '*["BEHCLICK_"+PLACE]^RUN();', [], false);
    assert.equal(values.at(-1), 'field target clicked');
    await runCode(engine, null, 'TARGET^SET($1);', ['00B_INTRO'], false);
    assert.equal(values.at(-1), 0);
});

test('Nemo packed sound data remains reusable after Web Audio detaches a playback buffer', async () => {
    const { default: Filesystem } = loadModule('filesystem/index.ts', {
        '../fileFormats/cnv': {}, '../fileFormats/seq': {}, '../fileFormats/img': {},
        '../fileFormats/ann': {}, '../fileFormats/fnt': {}, '../fileFormats/archive/array': {},
        '../engine/compat': { createEngineCompat }, '../fileFormats/archive/sound': { readSoundArchive },
        '../engine/compatAssets': {}, '../engine/patches/timpului': {}, '../engine/patches/ozn': {},
        '../engine/patches/nemo': {}, '../engine/patches/magicienii': {},
    });
    const archive = arrayBuffer(archiveEntry('TEST.WAV', Buffer.from('OggS123')));
    let reads = 0;
    const filesystem = new Filesystem({ hasFile: () => false, getFilesListing: () => ['wavs/wav.snd'],
        getRawFile: async () => { reads++; return archive; } }, { get: async () => null, has: async () => false },
        createEngineCompat('nemo'));
    const first = await filesystem.getFile('wavs/test.wav');
    structuredClone(first, { transfer: [first] });
    assert.equal(first.byteLength, 0);
    assert.equal(Buffer.from(await filesystem.getFile('wavs/test.wav')).toString(), 'OggS123');
    assert.equal(await filesystem.hasFile('wavs/test.wav'), true);
    assert.equal(reads, 1);
});

test('player teardown releases input listeners and class scopes once even after a cleanup error', () => {
    const { ScopeManager } = loadModule('engine/scope.ts', {
        './types': {}, './types/application': {}, '../common/errors': { assert: assert.ok },
    });
    const manager = new ScopeManager();
    const scope = manager.newScope('root');
    const destroyed = [];
    const object = (type, name, destroy = () => destroyed.push(name)) => ({
        definition: { TYPE: type }, name, isReady: true, destroy,
    });
    const instance = object('CLASS_INSTANCE', 'INSTANCE');
    const owner = object('CLASS', 'OWNER', () => instance.destroy());
    const keyboard = object('KEYBOARD', 'KEYBOARD');
    scope.set('OWNER', owner);
    scope.set('INSTANCE', instance);
    scope.set('BROKEN', object('IMAGE', 'BROKEN', () => { throw new Error('not initialized'); }));
    scope.set('KEYBOARD', keyboard);
    manager.localScopes.push(scope);
    assert.equal(manager.destroy().length, 1);
    assert.deepEqual(destroyed, ['INSTANCE', 'KEYBOARD']);
    assert.equal(keyboard.isReady, false);
    assert.deepEqual(manager.scopes, []);
    assert.deepEqual(manager.localScopes, []);
    assert.deepEqual(manager.destroy(), []);
});

test('Nemo walker placeholders are limited to its dynamic animation objects', () => {
    const { patchNemoDefinitions } = loadModule('engine/patches/nemo.ts');
    const definitions = { ANNCREATURE: { TYPE: 'ANIMO', FILENAME: '' },
        ANNFRIEND: { TYPE: 'ANIMO', FILENAME: '' }, ANNMASK: { TYPE: 'ANIMO', FILENAME: '' },
        OTHER: { TYPE: 'ANIMO', FILENAME: '' } };
    patchNemoDefinitions('other.class', definitions);
    assert.equal(definitions.ANNCREATURE.FILENAME, '');
    patchNemoDefinitions('common/classes/clswalker.class', definitions);
    assert.equal(definitions.ANNCREATURE.FILENAME, '$COMMON/WALKER_MOVE.ANN');
    assert.equal(definitions.ANNFRIEND.FILENAME, '$COMMON/WALKER_MOVE.ANN');
    assert.equal(definitions.ANNMASK.FILENAME, '$COMMON/WALKER_MOVE.ANN');
    assert.equal(definitions.OTHER.FILENAME, '');
    assert.equal(createEngineCompat('nemo').nemoDefinitions, true);
    for (const profile of ['default', 'magicienii', 'ozn', 'timpului']) {
        assert.equal(createEngineCompat(profile).nemoDefinitions, false);
    }
});

test('modern display metrics report the current frame size for Nemo path grids', () => {
    const { DisplayType } = loadModule('engine/types/index.ts', {
        '../components/callbacks': {}, '../../common/errors': { assert: assert.ok },
        '../components/events': {}, '../../common/types': decorator, '../logging': {},
    });
    const sprite = { width: 20, height: 20 };
    const object = { engine: { compat: createEngineCompat('nemo') }, getRenderObject: () => sprite,
        __call: () => 'unsupported' };
    assert.equal(DisplayType.prototype.GETHEIGHT.call(object), 20);
    sprite.width = 740;
    sprite.height = 480;
    assert.equal(DisplayType.prototype.GETWIDTH.call(object), 740);
    assert.equal(DisplayType.prototype.GETHEIGHT.call(object), 480);
    object.engine.compat = createEngineCompat();
    assert.equal(DisplayType.prototype.GETHEIGHT.call(object), 'unsupported');
});

test('modern database lookup advances through repeated dialogue rows and stops at the end', async () => {
    const database = new Database({ compat: createEngineCompat('nemo') });
    database.content = ['wstep', 'wstep', 'other'].map((value) => ({ GETFIELD: () => ({ getValue: async () => value }) }));
    assert.equal(await database.FIND('ID', 'WSTEP', 0), 0);
    assert.equal(await database.FIND('ID', 'WSTEP', 1), 1);
    assert.equal(await database.FIND('ID', 'WSTEP', 2), -1);
    assert.equal(await database.FIND('ID', 'WSTEP', 3), -1);
    database.engine.compat = createEngineCompat();
    database.content = ['wstep', 'wstep', 'other'].map((value) => ({ GETFIELD: () => ({ getValue: () => value }) }));
    assert.equal(database.FIND('ID', 'wstep', 1), 3);
});

test('modern dynamic callbacks use CNV parameter types and accept caret separators', () => {
    const { CallbacksComponent } = loadModule('engine/components/callbacks.ts', {
        '../../common/errors': { assert: assert.ok }, '../../fileFormats/cnv/types': { structureDefinitions: {
            INTEGER: { ONBRUTALCHANGED: { subType: { processor: (_object, _name, _param, value) => Number(value) } } },
        } }, '../../interpreter/stacktrace': {}, '../../interpreter': {},
    });
    const callbacks = new CallbacksComponent({ compat: createEngineCompat('nemo') }, { definition: { TYPE: 'INTEGER' } });
    callbacks.addBehaviour('ONBRUTALCHANGED^2', 'PATH');
    assert.equal(callbacks.registry.get('ONBRUTALCHANGED').parametrized.get(2).behaviourReference, 'PATH');
    callbacks.removeBehaviour('ONBRUTALCHANGED^2');
    assert.equal(callbacks.has('ONBRUTALCHANGED'), false);
    callbacks.addBehaviour('ONBRUTALCHANGED$3', 'PATH');
    assert.equal(callbacks.registry.get('ONBRUTALCHANGED').parametrized.has(3), true);
});

test('modern doubles support the square-root operation used by Nemo pathfinding', async () => {
    class Value extends FakeType { value = 25; setValue(value) { this.value = value; return value; } }
    const { Double } = loadModule('engine/types/double.ts', {
        './index': { ValueType: Value }, '../../common/types': decorator,
    });
    const number = new Double({ compat: createEngineCompat('nemo') });
    assert.equal(await number.SQRT(), 5);
    assert.equal(number.value, 5);
    number.engine.compat = createEngineCompat();
    number.__call = () => 'unsupported';
    assert.equal(await number.SQRT(), 'unsupported');
});
