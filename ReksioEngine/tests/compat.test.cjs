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

test('Only Nemo decodes RGB555 images as 15-bit while RGB565 and alpha stay unchanged', () => {
    const { BinaryBuffer } = loadModule('fileFormats/utils.ts');
    const { loadImage } = loadModule('fileFormats/img/index.ts', {
        '../utils': { BinaryBuffer }, '../compression/clzw': {}, '../compression/crle': {},
        '../compression': { CompressionType: { NONE: 0, CLZW: 1, CLZW_IN_CRLE: 2, CRLE: 3, JPEG: 4 } },
    });
    const fixture = (bpp, colors) => {
        const bytes = new ArrayBuffer(40 + colors.length * 3), view = new DataView(bytes);
        [0x4b4950, colors.length, 1, bpp, colors.length * 2, 0, 0, colors.length, 0, 0]
            .forEach((value, index) => view.setUint32(index * 4, value, true));
        colors.forEach((value, index) => {
            view.setUint16(40 + index * 2, value, true);
            view.setUint8(40 + colors.length * 2 + index, 50 + index);
        });
        return bytes;
    };
    for (const profile of ['default', 'magicienii', 'ozn', 'nemo', 'timpului']) {
        const enabled = createEngineCompat(profile).rgb555Images;
        assert.equal(enabled, profile === 'nemo');
        for (const bpp of [2, 15]) {
            assert.deepEqual([...new Uint8Array(loadImage(fixture(bpp, [0x7c00, 0x03e0, 0x001f]), enabled).bytes)],
                enabled ? [248, 0, 0, 50, 0, 248, 0, 51, 0, 0, 248, 52]
                    : [120, 128, 0, 50, 0, 124, 0, 51, 0, 0, 248, 52]);
        }
        assert.deepEqual([...new Uint8Array(loadImage(fixture(16, [0xf800, 0x07e0, 0x001f]), enabled).bytes)],
            [248, 0, 0, 50, 0, 252, 0, 51, 0, 0, 248, 52]);
    }
});

const { OznMatrixSimulation } = loadModule('engine/compat/oznMatrix.ts');
const { readSekWorld } = loadModule('fileFormats/sek/index.ts');
const { TimeMachinePhysics } = loadModule('engine/compat/timeMachinePhysics.ts', { 'cannon-es': require('cannon-es') });
const { createMagicieniiPhysics } = loadModule('engine/compat/magicieniiPhysics.ts', {
    './timeMachinePhysics': { TimeMachinePhysics },
});
const { TimeMachineVehiclePhysics } = loadModule('engine/compat/timeMachineVehiclePhysics.ts', {
    '@dimforge/rapier3d-compat': require('@dimforge/rapier3d-compat'), 'cannon-es': require('cannon-es'),
});
const { SekaiNavigation } = loadModule('engine/compat/sekaiNavigation.ts', {
    'ngraph.graph': { default: require('ngraph.graph') }, 'ngraph.path': require('ngraph.path'),
});
const { readSoundArchive } = loadModule('fileFormats/archive/sound.ts');
const decorator = { method: () => (method) => method };
class FakeType {
    constructor(engine) { this.engine = engine; }
}
const { Group } = loadModule('engine/types/group.ts', {
    './index': { Type: FakeType }, '../../common/types': decorator,
    '../logging': { logger: { warn() {} } },
});

test('Magicienii group collection methods do not forward to actors or destroy them', async () => {
    const group = new Group({ compat: createEngineCompat('magicienii') });
    const calls = [];
    const actor = (name) => ({ name, GETSIZE: () => calls.push([name, 'size']),
        REMOVEALL: () => calls.push([name, 'clear']), HIDE: () => calls.push([name, 'hide']) });
    const rex = actor('REX'), dummy = actor('DUMMY');
    const objects = { REX: rex, DUMMY: dummy };
    group.getObject = (name) => objects[name] ?? null;
    assert.equal(await group.GETSIZE(), 0);
    group.ADD('REX', 'DUMMY');
    assert.equal(await group.GETSIZE(), 2);
    await group.__call('HIDE', []);
    assert.deepEqual(calls, [['REX', 'hide'], ['DUMMY', 'hide']]);
    group.REMOVE('DUMMY');
    assert.equal(await group.GETSIZE(), 1);
    await group.REMOVEALL();
    assert.equal(await group.GETSIZE(), 0);
    await group.__call('HIDE', []);
    assert.deepEqual(calls, [['REX', 'hide'], ['DUMMY', 'hide']]);
    group.add(rex);
    assert.equal(await group.GETSIZE(), 1);
});

test('Other profiles retain group collection call forwarding', async () => {
    for (const profile of ['default', 'ozn', 'timpului']) {
        const group = new Group({ compat: createEngineCompat(profile) });
        const calls = [];
        group.add({ GETSIZE: () => calls.push('size'), REMOVEALL: () => calls.push('clear'),
            HIDE: () => calls.push('hide') });
        assert.equal(await group.GETSIZE(), undefined);
        await group.REMOVEALL();
        await group.__call('HIDE', []);
        assert.deepEqual(calls, ['size', 'clear', 'hide']);
    }
});

test('Nemo clone groups include both range endpoints and wrap their object marker', async () => {
    const group = new Group({ compat: createEngineCompat('nemo') });
    const objects = Object.fromEntries([0, 1, 2, 4].map(i => [`BEAM_${i}`, { name: `BEAM_${i}` }]));
    group.getObject = name => objects[name] ?? null;
    group.ADDCLONES('BEAM', 0, 4);
    assert.equal(group.GETSIZE(), 4);
    assert.equal(group.GETMARKERPOS(), -1);
    assert.equal(group.NEXT(), 'BEAM_0');
    assert.equal(group.NEXT(2), 'BEAM_2');
    assert.equal(group.PREV(), 'BEAM_1');
    group.SETMARKERPOS(0);
    assert.equal(group.PREV(), 'BEAM_4');
    assert.equal(group.GETNAMEATMARKER(), 'BEAM_4');
    assert.equal(group.NEXT(9), 'BEAM_0');
    group.RESETMARKER();
    assert.equal(group.GETNAMEATMARKER(), null);
    group.REMOVEALL();
    assert.equal(group.GETSIZE(), 0);
    assert.equal(group.NEXT(), null);
});

test('Only Nemo forwards unknown group commands into class behaviour scopes', async () => {
    for (const profile of ['default', 'magicienii', 'ozn', 'nemo', 'timpului']) {
        const group = new Group({ compat: createEngineCompat(profile) });
        const calls = [];
        group.add({ definition: { TYPE: 'CLASS_INSTANCE' }, __call: (...args) => calls.push(args) });
        await group.__call('NEXTSTEP', [4]);
        assert.deepEqual(calls, profile === 'nemo' ? [['NEXTSTEP', [4]]] : []);
    }
});

test('Clone group methods retain actor forwarding outside Nemo', async () => {
    for (const profile of ['default', 'magicienii', 'ozn', 'timpului']) {
        const group = new Group({ compat: createEngineCompat(profile) });
        const calls = [];
        group.add(Object.fromEntries(['ADDCLONES', 'SETMARKERPOS', 'GETMARKERPOS', 'RESETMARKER',
            'GETNAMEATMARKER', 'NEXT', 'PREV'].map(name => [name, (...args) => calls.push([name, args])])));
        await group.ADDCLONES('BEAM', 0, 3);
        await group.SETMARKERPOS(2); await group.GETMARKERPOS(); await group.RESETMARKER();
        await group.GETNAMEATMARKER(); await group.NEXT(2); await group.PREV(3);
        assert.deepEqual(calls, [['ADDCLONES', ['BEAM', 0, 3]], ['SETMARKERPOS', [2]], ['GETMARKERPOS', []],
            ['RESETMARKER', []], ['GETNAMEATMARKER', []], ['NEXT', [2]], ['PREV', [3]]]);
    }
});

test('Nemo canvas stamps hidden templates and scrolls independently of live actors', () => {
    class Template {}
    const { CanvasObserver } = loadModule('engine/types/canvasObserver.ts', {
        './index': { Type: FakeType }, '../../common/types': decorator,
        '../../filesystem/assetsLoader': {}, 'pixi.js': {}, '../rendering': { AdvancedSprite: Template },
        '../../common/errors': {}, '../../fileFormats/img': {}, '../logging': {}, './class': {},
    });
    for (const profile of ['default', 'magicienii', 'ozn', 'nemo', 'timpului']) {
        const calls = [], sprite = new Template(); sprite.visible = false;
        const background = { x: 0, y: 0, position: { set(x, y) { background.x = x; background.y = y; } } };
        const observer = new CanvasObserver({ compat: createEngineCompat(profile),
            rendering: { canvasBackground: background, pasteBackground: (...args) => calls.push(args) } });
        observer.__call = (...args) => calls.push(args);
        observer.getObject = name => name === 'TILE' ? { getRenderObject: () => sprite }
            : name === 'VALUE' ? {} : null;
        observer.PASTE('TILE', 45, 90);
        observer.MOVEBKG(-30, -60);
        observer.MOVEBKG(5, 10);
        if (profile === 'nemo') {
            assert.deepEqual(calls, [[sprite, 45, 90]]);
            assert.deepEqual([background.x, background.y], [-25, -50]);
            observer.SETBKGPOS(90, 70);
            assert.deepEqual([background.x, background.y], [-90, -70]);
            observer.PASTE('MISSING', 0, 0);
            observer.PASTE('VALUE', 0, 0);
            assert.equal(calls.length, 1);
        } else {
            assert.deepEqual(calls, [['PASTE', ['TILE', 45, 90]], ['MOVEBKG', [-30, -60]], ['MOVEBKG', [5, 10]]]);
            assert.deepEqual([background.x, background.y], [0, 0]);
        }
        assert.equal(sprite.visible, false);
    }
});

test('Background stamping preserves prior pixels, frame properties and shared textures', () => {
    const draws = [], destroyed = [];
    class Sprite {
        constructor(texture) { this.texture = texture; this.position = new MousePoint();
            this.anchor = { copyFrom: value => this.copiedAnchor = value };
            this.scale = { copyFrom: value => this.copiedScale = value }; }
        destroy() { destroyed.push(this); }
    }
    const { RenderingManager } = loadModule('engine/rendering.ts', {
        'pixi.js': { Sprite, RenderTexture: { create: ({ width, height }) => ({ width, height,
            destroy: value => destroyed.push(['texture', value]) }) } },
        '../common/errors': { assert: assert.ok }, './types': {},
    });
    const originalTexture = { orig: { width: 1600, height: 1200 } };
    const manager = Object.create(RenderingManager.prototype);
    manager.pastedBackground = null;
    manager.app = { renderer: { render: (sprite, options) => draws.push({ sprite, options }) } };
    manager.canvasBackground = { texture: originalTexture, position: new MousePoint(40, -80) };
    const actor = { texture: {}, anchor: {}, scale: {}, rotation: 1, alpha: 0.5, tint: 123,
        blendMode: 0, visible: false, x: 8, y: 9 };
    manager.pasteBackground(actor, 50, 70);
    manager.pasteBackground(actor, 80, 90);
    assert.equal(draws.length, 3);
    assert.equal(draws[0].sprite.texture, originalTexture);
    assert.equal(draws[0].options.clear, true);
    assert.equal(draws[1].options.clear, false);
    assert.equal(draws[2].options.renderTexture, draws[0].options.renderTexture);
    assert.deepEqual([draws[1].sprite.position.x, draws[1].sprite.position.y], [50, 70]);
    assert.equal(draws[1].sprite.copiedAnchor, actor.anchor);
    assert.equal(draws[1].sprite.copiedScale, actor.scale);
    assert.equal(draws[1].sprite.alpha, 0.5);
    assert.equal(draws[1].sprite.rotation, 1);
    assert.deepEqual([actor.x, actor.y, actor.visible], [8, 9, false]);
    assert.deepEqual([manager.canvasBackground.position.x, manager.canvasBackground.position.y], [40, -80]);
    assert.equal(destroyed.length, 3);
    manager.setBackground(originalTexture);
    assert.equal(manager.pastedBackground, null);
    assert.deepEqual(destroyed[3], ['texture', true]);
    assert.equal(manager.canvasBackground.texture, originalTexture);
});

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

class MousePoint {
    constructor(x = 0, y = 0) { this.x = x; this.y = y; }
    set(x, y) { this.x = x; this.y = y; }
    clone() { return new MousePoint(this.x, this.y); }
}

test('Magicienii backgrounds retain signed IMG offsets without changing other profiles', async () => {
    const pixels = Uint8Array.of(1, 2, 3, 255);
    const image = { header: { width: 800, height: 624, positionX: 0xffffffe0, positionY: 0xffffffe8 },
        bytes: pixels.buffer };
    const { loadBackground } = loadModule('filesystem/assetsLoader.ts', {
        'pixi.js': { BaseTexture: { fromBuffer: (bytes, width, height) => ({ bytes, width, height }) },
            Texture: class { constructor(baseTexture) { this.baseTexture = baseTexture; } } },
        '../engine/rendering': {}, './index': {}, '../engine/audio': {},
    });
    const files = { getIMGFile: async (filename) => { assert.equal(filename, 'yard/bkg.img'); return image; } };
    for (const profile of ['default', 'magicienii', 'ozn', 'nemo', 'timpului']) {
        const background = await loadBackground(files, 'yard/bkg.img', createEngineCompat(profile).backgroundImagePositions);
        assert.deepEqual(background.position, profile === 'magicienii' ? { x: -32, y: -24 } : { x: 0, y: 0 });
        assert.equal(background.texture.baseTexture.width, 800);
        assert.equal(background.texture.baseTexture.height, 624);
        assert.deepEqual(background.texture.baseTexture.bytes, pixels);
    }
    image.header.positionX = 555; image.header.positionY = 0;
    assert.deepEqual((await loadBackground(files, 'yard/bkg.img', true)).position, { x: 555, y: 0 });
    assert.deepEqual((await loadBackground(files, 'yard/bkg.img')).position, { x: 0, y: 0 });
});

test('Background replacement and clearing reset the previous image position', () => {
    const { RenderingManager } = loadModule('engine/rendering.ts', {
        'pixi.js': { Sprite: class {} }, '../common/errors': { assert: assert.ok }, './types': {},
    });
    const black = {}, shifted = {}, next = {};
    const renderer = { canvasBackground: { position: new MousePoint() }, blackTexture: black,
        setBackground: RenderingManager.prototype.setBackground };
    renderer.setBackground(shifted, { x: 0, y: -24 });
    assert.equal(renderer.canvasBackground.texture, shifted);
    assert.equal(renderer.canvasBackground.position.y, -24);
    renderer.setBackground(next);
    assert.equal(renderer.canvasBackground.texture, next);
    assert.equal(renderer.canvasBackground.position.y, 0);
    renderer.setBackground(shifted, { x: 10, y: 20 });
    RenderingManager.prototype.clearBackground.call(renderer);
    assert.equal(renderer.canvasBackground.texture, black);
    assert.deepEqual({ ...renderer.canvasBackground.position }, { x: 0, y: 0 });
});

test('Scripted background loads use only the current profile position policy', async () => {
    let policy;
    const texture = {}, position = { x: 0, y: -24 };
    const { CanvasObserver } = loadModule('engine/types/canvasObserver.ts', {
        './index': { Type: FakeType }, '../../common/types': decorator,
        '../../filesystem/assetsLoader': { loadBackground: async (files, filename, enabled) => {
            assert.equal(filename, 'room/bkg.img'); policy = enabled; return { texture, position };
        } },
        'pixi.js': {}, '../rendering': {}, '../../common/errors': {}, '../../fileFormats/img': {},
        '../logging': {}, './class': {},
    });
    for (const profile of ['default', 'magicienii', 'ozn', 'nemo', 'timpului']) {
        const calls = [];
        const observer = new CanvasObserver({ compat: createEngineCompat(profile), filesystem: {},
            currentScene: { getRelativePath: async (name) => `room/${name}` },
            rendering: { setBackground: (...args) => calls.push(args) } });
        await observer.SETBACKGROUND('bkg.img');
        assert.equal(policy, profile === 'magicienii');
        assert.deepEqual(calls, [[texture, position]]);
    }
});

const { Mouse } = loadModule('engine/types/mouse.ts', {
    './index': { Type: FakeType }, 'pixi.js': { Point: MousePoint },
    '../../common/types': decorator, '../../common/errors': { NotImplementedError: Error },
});
const pointer = (x, y) => ({ button: 0, screen: { x, y } });
const mouseFor = (profile) => new Mouse({ compat: createEngineCompat(profile),
    diagnostics: { mousePosition() {} } });

test('Magicienii cursor warps use physical deltas once, including queued clicks', async () => {
    const mouse = mouseFor('magicienii'), moves = [], clicks = [];
    mouse.onMouseMove(pointer(450, 350));
    mouse.SETPOSITION(400, 300);
    mouse.callbacks = { run: async (type) => {
        const position = [mouse.GETPOSX(), mouse.GETPOSY()];
        if (type === 'ONMOVE') {
            moves.push(position);
            mouse.SETPOSITION(400, 300);
        } else clicks.push([type, ...position]);
    } };
    mouse.onMouseMove(pointer(460, 360));
    mouse.onMouseMove(pointer(460, 360)); // PIXI emits both local and global pointer moves.
    await mouse.tick(16);
    mouse.handleClickEvent(pointer(470, 360), 'click');
    mouse.handleClickEvent(pointer(470, 360), 'release');
    await mouse.tick(16);
    await mouse.tick(16);
    assert.deepEqual(moves, [[410, 310], [410, 300]]);
    assert.deepEqual(clicks, [['ONCLICK', 410, 300], ['ONRELEASE', 410, 300]]);
    assert.deepEqual([mouse.GETPOSX(), mouse.GETPOSY()], [400, 300]);
});

test('Magicienii anchors a scene-entry cursor warp on its first real pointer event', () => {
    const mouse = mouseFor('magicienii');
    mouse.engine.app = { renderer: { events: { pointer: pointer(450, 350) } } };
    mouse.SETPOSITION(400, 300);
    mouse.onMouseMove(pointer(460, 360));
    assert.deepEqual([mouse.GETPOSX(), mouse.GETPOSY()], [400, 300]);
    mouse.onMouseMove(pointer(470, 370));
    assert.deepEqual([mouse.GETPOSX(), mouse.GETPOSY()], [410, 310]);
    for (const profile of ['ozn', 'nemo', 'timpului']) {
        const other = mouseFor(profile);
        other.onMouseMove(pointer(450, 350));
        other.SETPOSITION(400, 300);
        other.onMouseMove(pointer(460, 360));
        assert.deepEqual([other.GETPOSX(), other.GETPOSY()], [460, 360]);
    }
});

test('Magicienii warped cursors ignore launcher controls and rebase on canvas re-entry', () => {
    const mouse = mouseFor('magicienii');
    mouse.engine.app = { screen: { contains: (x, y) => x >= 0 && y >= 0 && x < 800 && y < 600 } };
    mouse.onMouseMove(pointer(450, 350));
    mouse.SETPOSITION(400, 300);
    mouse.onMouseMove(pointer(900, 350));
    assert.deepEqual([mouse.GETPOSX(), mouse.GETPOSY()], [400, 300]);
    mouse.onMouseMove(pointer(600, 350));
    assert.deepEqual([mouse.GETPOSX(), mouse.GETPOSY()], [400, 300]);
    mouse.onMouseMove(pointer(610, 360));
    assert.deepEqual([mouse.GETPOSX(), mouse.GETPOSY()], [410, 310]);
});

test('Magicienii and Time Machine queued clicks retain coordinates across later moves and asynchronous callbacks', async () => {
    for (const profile of ['magicienii', 'default', 'ozn', 'nemo', 'timpului']) {
        const mouse = mouseFor(profile), events = [];
        let resume;
        const position = () => [mouse.GETPOSX(), mouse.GETPOSY()];
        mouse.callbacks = { run: async (type) => {
            if (type === 'ONCLICK') {
                events.push([type, 'before', ...position()]);
                await new Promise((resolve) => { resume = resolve; });
                events.push([type, 'after', ...position()]);
            } else events.push([type, ...position()]);
        } };
        mouse.handleClickEvent(pointer(10.8, 20.9), 'click');
        mouse.handleClickEvent(pointer(30.2, 40.7), 'release');
        mouse.onMouseMove(pointer(90, 100));
        const ticking = mouse.tick(16);
        mouse.onMouseMove(pointer(80, 95));
        resume();
        await ticking;
        assert.deepEqual(events, ['magicienii', 'timpului'].includes(profile) ? [
            ['ONCLICK', 'before', 10, 20], ['ONCLICK', 'after', 10, 20],
            ['ONRELEASE', 30, 40], ['ONMOVE', 80, 95],
        ] : [
            ['ONCLICK', 'before', 90, 100], ['ONCLICK', 'after', 80, 95],
            ['ONRELEASE', 80, 95], ['ONMOVE', 80, 95],
        ]);
        assert.deepEqual(position(), [80, 95]);
    }
});

test('Magicienii and Time Machine double-clicks use the second click position without replacing live movement', async () => {
    for (const profile of ['magicienii', 'timpului']) {
        const mouse = mouseFor(profile), events = [];
        mouse.callbacks = { run: async (type) => events.push([type, mouse.GETPOSX(), mouse.GETPOSY()]) };
        mouse.handleClickEvent(pointer(10, 20), 'click');
        mouse.lastClicksTime.LEFT = Date.now();
        mouse.handleClickEvent(pointer(30, 40), 'click');
        mouse.onMouseMove(pointer(90, 100));
        await mouse.tick(16);
        assert.deepEqual(events, [
            ['ONCLICK', 10, 20], ['ONCLICK', 30, 40], ['ONDBLCLICK', 30, 40], ['ONMOVE', 90, 100],
        ]);
    }
});

test('Magicienii event positions support scripted cursor writes and are released after callback errors', async () => {
    const mouse = mouseFor('magicienii');
    mouse.callbacks = { run: async (type) => {
        if (type !== 'ONCLICK') return;
        mouse.SETPOSITION(7, 8);
        assert.deepEqual([mouse.GETPOSX(), mouse.GETPOSY()], [7, 8]);
        throw new Error('callback failed');
    } };
    mouse.handleClickEvent(pointer(10, 20), 'click');
    await assert.rejects(mouse.tick(16), /callback failed/);
    mouse.onMouseMove(pointer(50, 60));
    assert.deepEqual([mouse.GETPOSX(), mouse.GETPOSY()], [47, 48]);
    mouse.handleClickEvent(pointer(70, 80), 'release');
    mouse.DISABLESIGNAL();
    await mouse.tick(16);
    assert.deepEqual([mouse.GETPOSX(), mouse.GETPOSY()], [67, 68]);
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

test('Time Machine inventory and build progress are traced only while tracing is enabled', () => {
    const { EngineDiagnostics } = loadModule('engine/diagnostics.ts');
    const messages = [], original = console.info;
    const diagnostics = new EngineDiagnostics({ options: {}, currentScene: { name: 'ARCADE' } }, false);
    console.info = (message) => messages.push(message);
    try {
        for (const name of ['G_SARCADESCENE', 'VARI_INVENTORYCOUNT', 'VARS_CURRENTITEM',
            'VARS_CURRENTITEMOBJECT', 'VARS_USEPLACE', 'VARS_NEWITEM', 'VARINUMASSEMBLED']) {
            diagnostics.valueChanged({ name }, 'old', 'new');
            assert.equal(messages.length, 0);
            diagnostics.enabled = true;
            diagnostics.valueChanged({ name }, 'old', 'new');
            assert.equal(JSON.parse(messages.pop().slice('[trace:value] '.length)).name, name);
            diagnostics.enabled = false;
        }
    } finally {
        console.info = original;
    }
});

test('Magicienii repairs only the spell lesson drawing wand event references', () => {
    const { patchMagicieniiSource } = loadModule('engine/patches/magicienii.ts');
    const source = 'ANNWAND0^SETFRAME("PLAY",VARIDEBUG);ANNWAND0^GETNOFINEVENT(1);OTHER^SETFRAME("PLAY",0);';
    const file = 'dane/game/przygoda/magic/magic.cnv';
    const repaired = patchMagicieniiSource(file, source);
    assert.equal(repaired, 'ANNWAND0^SETFRAME("CZARUJE",VARIDEBUG);ANNWAND0^GETNOFINEVENT("CZARUJE");OTHER^SETFRAME("PLAY",0);');
    assert.equal(patchMagicieniiSource(file, repaired), repaired);
    assert.equal(patchMagicieniiSource('dane/game/przygoda/magic/magic2.cnv', source), source);
    assert.equal(patchMagicieniiSource('other/magic.cnv', source), source);
    assert.equal(patchMagicieniiSource(file, 'BEHPLAYRANDSOUND^PLAY();OTHER^PLAY();'),
        'BEHPLAYRANDSOUND^RUN();OTHER^PLAY();');
});

test('Magicienii repairs misspelled alchemy image priorities only in that source file', () => {
    const { patchMagicieniiSource } = loadModule('engine/patches/magicienii.ts');
    const source = 'IMG_EXIT_STD^SETPTIORITY(610);IMG_EXIT_GLOW^SETPTIORITY(610);IMG_EXIT_CLICK^SETPTIORITY(610);';
    const file = 'dane/game/przygoda/arcade/alchemy.cnv';
    const repaired = patchMagicieniiSource(file, source);
    assert.equal(repaired, source.replaceAll('SETPTIORITY', 'SETPRIORITY'));
    assert.equal(patchMagicieniiSource(file, repaired), repaired);
    assert.equal(patchMagicieniiSource('dane/game/przygoda/arcade/arcade.cnv', source), source);
    assert.equal(patchMagicieniiSource('dane/game/przygoda/magic/magic.cnv', source), source);
});

test('Magicienii Cat converts walking directions to integer event names only in its scene source', () => {
    const { patchMagicieniiSource } = loadModule('engine/patches/magicienii.ts');
    const source = '*VARPLAYERNAME^PLAY([360-VARINT0@45]);OTHER^PLAY([360-VARINT0@45]);';
    const file = 'dane/game/przygoda/cat/cat.cnv';
    const repaired = patchMagicieniiSource(file, source);
    assert.equal(repaired, 'VARINT0^SET([360-VARINT0@45]);VARINT0^MOD(8);*VARPLAYERNAME^PLAY(VARINT0);OTHER^PLAY([360-VARINT0@45]);');
    assert.equal(patchMagicieniiSource(file, repaired), repaired);
    for (const name of ['cat/other.cnv', 'magic/magic.cnv', 'arcade/arcade.cnv']) {
        assert.equal(patchMagicieniiSource(`dane/game/przygoda/${name}`, source), source);
    }
});

test('Magicienii removes only the global startup pointer warp, preserving relative spell drawing', () => {
    const { patchMagicieniiSource } = loadModule('engine/patches/magicienii.ts');
    const source = 'CF^NEW("G_CURSOR");MOUSE^SETPOSITION(400,300);MOUSE^HIDE();MOUSE^SETPOSITION(100,200);';
    const file = 'dane/game/game.cnv', repaired = patchMagicieniiSource(file, source);
    assert.equal(repaired, 'CF^NEW("G_CURSOR");MOUSE^HIDE();MOUSE^SETPOSITION(100,200);');
    assert.equal(patchMagicieniiSource(file, repaired), repaired);
    assert.equal(patchMagicieniiSource('dane/game/przygoda/cat/cat.cnv', source), source);
    assert.equal(patchMagicieniiSource('dane/game/przygoda/magic/magic.cnv', source), source);
    assert.equal(patchMagicieniiSource('other/game.cnv', source), source);
});

test('Magicienii Fred failure keeps its dialogue processor running and rejects further input', () => {
    const { patchMagicieniiSource } = loadModule('engine/patches/magicienii.ts');
    const file = 'dane/game/przygoda/fred/fred.cnv';
    const source = 'ANNPLAYER^STOP(FALSE);FRED^PAUSE();SEQNARRATOR^PLAY("FAILED");OTHER^PAUSE();';
    const repaired = patchMagicieniiSource(file, source);
    assert.equal(repaired, 'ANNPLAYER^STOP(FALSE);KEYBOARD^DISABLE();BTNRESTART^DISABLE();TIMERSEQ^DISABLE();SEQNARRATOR^PLAY("FAILED");OTHER^PAUSE();');
    assert.equal(patchMagicieniiSource(file, repaired), repaired);
    for (const name of ['fred/other.cnv', 'labirynt/labirynt.cnv', 'arcade/arcade.cnv']) {
        assert.equal(patchMagicieniiSource(`dane/game/przygoda/${name}`, source), source);
    }
});

test('Magicienii maze failure and restart freeze animations without pausing their dialogue processor', () => {
    const { patchMagicieniiSource } = loadModule('engine/patches/magicienii.ts');
    const file = 'dane/game/przygoda/labirynt/labirynt.cnv';
    const source = 'A:CODE={LABIRYNT^PAUSE();SEQLAB^PLAY("FAILED");}\n' +
        'B:CODE={LABIRYNT^PAUSE();SEQLAB^PLAY("RESTART");}';
    const repaired = patchMagicieniiSource(file, source);
    assert.equal(repaired.includes('LABIRYNT^PAUSE();'), false);
    assert.equal(repaired.split('__WEB_MAZEPAUSE__^RUN();').length - 1, 2);
    assert.match(repaired, /GETPLAYINGANIMO\("__WEB_MAZEPLAYING__"\)/);
    assert.match(repaired, /__WEB_MAZEPLAYING__\^PAUSE\(\);KEYBOARD\^DISABLE\(\);MOUSE\^DISABLESIGNAL\(\);BTNRESTART\^DISABLE\(\)/);
    assert.equal(patchMagicieniiSource(file, repaired), repaired);
    for (const name of ['labirynt/cnvlevel0.cnv', 'magic/magic.cnv', 'arcade/arcade.cnv']) {
        assert.equal(patchMagicieniiSource(`dane/game/przygoda/${name}`, source), source);
    }
});

test('Only Magicienii collects scene-owned playing animations across overlay scopes', () => {
    class Actor { constructor(parent, playing = true) { this.parent = parent; this.isPlaying = playing; } }
    class Collection { objects = []; removeAll() { this.objects = []; } add(object) { this.objects.push(object); } }
    const { Scene } = loadModule('engine/types/scene.ts', {
        './index': { ParentType: FakeType }, './behaviour': {}, '../../common/types': decorator,
        '../../common/errors': { assert: assert.ok }, '../../filesystem/assetsLoader': {},
        '../../filesystem': {}, './group': { Group: Collection }, './animo': { Animo: Actor },
    });
    for (const profile of ['default', 'magicienii', 'ozn', 'nemo', 'timpului']) {
        const engine = { compat: createEngineCompat(profile) }, scene = new Scene(engine), other = new Scene(engine);
        const first = new Actor(scene), clone = new Actor(scene), nested = new Actor({ parent: scene });
        const stopped = new Actor(scene, false), foreign = new Actor(other), global = new Actor(null);
        scene.scope = { objects: [first, stopped] }; engine.currentScene = scene;
        engine.scopeManager = { scopes: [scene.scope, { objects: [clone, nested, first, foreign, global] }] };
        const group = new Collection(); engine.getObject = () => group;
        scene.GETPLAYINGANIMO('GROUP');
        assert.deepEqual(group.objects, profile === 'magicienii' ? [first, clone, nested] : [first]);
        other.GETPLAYINGANIMO('GROUP');
        assert.deepEqual(group.objects, profile === 'magicienii' ? [foreign] : [first]);
    }
});

test('Magicienii empty animation placeholders are restricted to two maze paths and never share mutable state', () => {
    const { getMagicieniiPlaceholderAnimation } = loadModule('engine/patches/magicienii.ts');
    for (const name of ['blank.ann', 'przedmioty1.ann']) {
        const file = `dane/game/przygoda/labirynt/${name}`, first = getMagicieniiPlaceholderAnimation(file);
        assert.deepEqual(first.events, []); assert.deepEqual(first.images, []); assert.deepEqual(first.annImages, []);
        assert.equal(first.header.eventsCount, 0);
        first.events.push({ name: 'MUTATED' });
        assert.deepEqual(getMagicieniiPlaceholderAnimation(file).events, []);
    }
    for (const file of ['dane/game/przygoda/labirynt/ogien.ann', 'dane/game/przygoda/magic/blank.ann',
        'dane/game/przygoda/labirynt/missing.ann', 'blank.ann']) {
        assert.equal(getMagicieniiPlaceholderAnimation(file), null);
    }
});

test('Only Magicienii retains absent maze placeholders while existing assets and unrelated failures remain untouched', async () => {
    const patches = loadModule('engine/patches/magicienii.ts'), decoded = [], raw = new ArrayBuffer(4);
    let corrupt = false;
    const { default: Filesystem } = loadModule('filesystem/index.ts', {
        '../fileFormats/cnv': {}, '../fileFormats/seq': {}, '../fileFormats/img': {},
        '../fileFormats/ann': { loadAnn: data => {
            assert.equal(data, raw); if (corrupt) throw new Error('corrupt animation');
            decoded.push(data); return 'REAL ASSET';
        } },
        '../fileFormats/fnt': {}, '../fileFormats/archive/array': {},
        '../engine/compat': { createEngineCompat }, '../fileFormats/archive/sound': {}, '../engine/compatAssets': {},
        '../engine/patches/timpului': {}, '../engine/patches/ozn': {}, '../engine/patches/nemo': {},
        '../engine/patches/magicienii': patches,
    });
    let exists = false;
    const filesystem = new Filesystem({ hasFile: () => exists, getRawFile: async () => {
        if (!exists) throw new Error('missing asset'); return raw;
    } }, { get: async () => null, has: async () => false }, createEngineCompat('magicienii'));
    const filename = 'DANE\\GAME\\PRZYGODA\\LABIRYNT\\BLANK.ANN';
    assert.deepEqual((await filesystem.getANNFile(filename)).events, []);
    assert.deepEqual(decoded, []);
    exists = true;
    assert.equal(await filesystem.getANNFile(filename), 'REAL ASSET', 'An installed replacement must take precedence');
    assert.equal(decoded.length, 1);
    corrupt = true;
    await assert.rejects(filesystem.getANNFile(filename), /corrupt animation/);
    corrupt = false;
    exists = false;
    await assert.rejects(filesystem.getANNFile('dane/game/przygoda/labirynt/not-a-placeholder.ann'), /missing asset/);
    for (const profile of ['default', 'ozn', 'nemo', 'timpului']) {
        filesystem.compat = createEngineCompat(profile);
        await assert.rejects(filesystem.getANNFile(filename), /missing asset/);
    }
});

test('Magicienii counted-loop BREAK propagates to the behaviour boundary; ONE_BREAK only skips an iteration', async () => {
    class IgnorableError extends Error {}
    class Counter { async setValue(value) { this.value = value; } }
    const { Interpreter, RuntimeContext, InterruptScriptExecution, ScriptReturn } = loadModule('interpreter/interpreter.ts', {
        '../engine/types': { Type: FakeType, ValueType: FakeType }, '../engine/types/struct': {},
        '../common/types': {}, '../engine/types/rand': { Rand: FakeType },
        '../engine/types/system': { System: FakeType }, '../engine/types/cnvloader': { CNVLoader: FakeType },
        '../fileFormats/common': { createCallback: (code) => ({ code }) }, '../engine/types/behaviour': {},
        '../common/errors': { IgnorableError, IrrecoverableError: Error },
        '../engine/types/integer': { Integer: Counter }, '../engine/types/string': {},
        '../engine/types/double': {}, '../engine/types/bool': {}, './parser': {},
        './expression': {}, './expression/ast': {}, '../engine/logging': {}, './stacktrace': {},
    });
    const { Behaviour } = loadModule('engine/types/behaviour.ts', {
        './index': { Type: FakeType }, './condition': {}, '../../common/types': decorator,
        '../../common/errors': { assert: assert.ok }, './class': {},
        '../../interpreter': { InterruptScriptExecution }, '../logging': {},
        '../../interpreter/interpreter': { ScriptReturn },
    });
    for (const profile of ['magicienii', 'default', 'ozn', 'nemo', 'timpului']) {
        const visited = [];
        let skipOne = false;
        const engine = { compat: createEngineCompat(profile), diagnostics: { behaviour() {} }, scripting: {
            executeCallback: async (self, caller, callback, args, locals, forward) => {
                assert.equal(forward, true);
                visited.push(locals._I_.value);
                if (locals._I_.value === 2) throw new InterruptScriptExecution(skipOne);
            },
        } };
        const interpreter = new Interpreter(new RuntimeContext(engine, null, ''));
        const run = () => interpreter.handleLoop(['BODY', 0, 5, 1]);
        if (profile === 'magicienii') await assert.rejects(run(), InterruptScriptExecution);
        else await run();
        assert.deepEqual(visited, [0, 1, 2]);
        visited.length = 0;
        skipOne = true;
        await run();
        assert.deepEqual(visited, [0, 1, 2, 3, 4]);
        skipOne = false;
        visited.length = 0;
        let reachedAfterLoop = false;
        const executeBody = engine.scripting.executeCallback;
        engine.scripting.executeCallback = async (...args) => {
            if (args[2].code !== 'OUTER') return executeBody(...args);
            await run();
            reachedAfterLoop = true;
        };
        const outer = new Behaviour(engine);
        outer.definition = { CODE: { code: 'OUTER' } };
        await outer.RUN();
        assert.deepEqual(visited, [0, 1, 2]);
        assert.equal(reachedAfterLoop, profile !== 'magicienii');
    }
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

test('Magicienii and Time Machine inventory opacity queries return byte values without changing other profiles', () => {
    const { DisplayType } = loadModule('engine/types/index.ts', {
        '../components/callbacks': {}, '../../common/errors': { assert: assert.ok },
        '../components/events': {}, '../../common/types': decorator, '../logging': {},
    });
    const sprite = { alpha: 1 };
    const object = { engine: { compat: createEngineCompat('default') },
        getRenderObject: () => sprite, __call: () => 'unsupported' };
    for (const profile of ['magicienii', 'timpului']) {
        object.engine.compat = createEngineCompat(profile);
        for (const opacity of [0, 128, 255]) {
            sprite.alpha = opacity / 255;
            assert.equal(DisplayType.prototype.GETOPACITY.call(object), opacity);
        }
    }
    for (const profile of ['default', 'ozn', 'nemo']) {
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

test('OZN and Magicienii image clones join the renderer at their original priority without changing Pirates', async () => {
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
        '../components/button': {},
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
    assert.equal(added.length, 2);
});

test('Time Machine light masks multiply alpha, follow scrolling and reuse their GPU resources', () => {
    let allocations = 0;
    const textures = [];
    class Texture {
        constructor() { textures.push(this); }
        destroy() { this.destroyed = true; }
        static WHITE = {};
    }
    class Sprite {
        constructor(texture) {
            this.texture = texture;
            this.position = { x: 0, y: 0, set(x,y) { this.x=x; this.y=y; },
                copyFrom(p) { this.x=p.x; this.y=p.y; } };
        }
        destroy() { this.destroyed = true; }
    }
    class Container {
        children = [];
        addChild(child) { this.children.push(child); }
        destroy() { this.destroyed = true; }
    }
    const pixi = { Sprite, Container, Texture, BLEND_MODES: { MULTIPLY: 2 },
        RenderTexture: { create: () => { allocations++; return new Texture(); } },
        BaseTexture: { fromBuffer: () => ({}) } };
    const { Image } = loadModule('engine/types/image.ts', {
        './index': { DisplayType: FakeType }, '../../common/errors': { assert: assert.ok },
        'pixi.js': pixi, '../../filesystem/assetsLoader': {},
        '../rendering': { AdvancedSprite: Sprite }, '../../common/types': decorator,
        '../components/button': {},
    });
    const added = [], removed = [], rendered = [];
    const image = new Image({ compat: createEngineCompat('timpului'),
        rendering: { addToStage: s => added.push(s), removeFromStage: s => removed.push(s) },
        app: { renderer: { render: (container, options) => rendered.push([container, options]) } } });
    image.sprite = new Sprite(new Texture());
    image.sprite.width = 800; image.sprite.height = 1200; image.sprite.position.set(0, -400);
    const light = new Sprite({}); light.width = 1; light.height = 1; light.hitmap = Uint8Array.of(0);
    image.getObject = () => ({ getRenderObject: () => light });
    image.MERGEALPHA(100, 300, 'LIGHT'); image.MERGEALPHA(150, 350, 'LIGHT');
    assert.equal(allocations, 1);
    assert.equal(added.length, 1);
    assert.equal(rendered.length, 2);
    assert.equal(rendered[0][1].renderTexture, rendered[1][1].renderTexture);
    const cone = rendered[0][0].children[1];
    assert.equal(cone.blendMode, 2);
    assert.equal(cone.position.x, 150);
    assert.equal(image.sprite.mask.position.y, -400);
    image.destroy();
    assert.equal(image.sprite.mask, null);
    assert.equal(removed.length, 2);
    assert.equal(rendered[0][1].renderTexture.destroyed, true);
    assert.equal(cone.texture.destroyed, true);
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

test('Magicienii cropped canvas saves describe the actual scaled pixel dimensions', async () => {
    const pixi = require('pixi.js');
    const { CanvasObserver } = loadModule('engine/types/canvasObserver.ts', {
        './index': { Type: FakeType }, '../../filesystem/assetsLoader': {},
        'pixi.js': pixi, '../../common/types': decorator, '../rendering': {},
        '../../common/errors': { assert: assert.ok },
        '../../fileFormats/img': { buildImage: (header, pixels) => ({ header, length: pixels.length }) },
        '../logging': { logger: { debug() {} } }, './class': {},
    });
    const previous = global.document;
    global.document = { createElement: () => ({ width: 0, height: 0,
        getContext: () => ({ scale() {}, drawImage() {},
            getImageData: (x, y, width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }) }) }) };
    try {
        for (const profile of ['magicienii', 'default', 'ozn', 'nemo', 'timpului']) {
            let saved;
            const engine = { compat: createEngineCompat(profile),
                currentScene: { getRelativePath: async (name) => name },
                filesystem: { saveFile: async (name, content) => { saved = content; } },
                app: { view: { width: 800, height: 600 }, stage: {}, renderer: { extract: {
                    image: async (stage, format, quality, frame) => {
                        assert.deepEqual([frame.x, frame.y, frame.width, frame.height], [20, 30, 4, 3]);
                        return { width: frame.width, height: frame.height };
                    },
                } } } };
            await new CanvasObserver(engine).SAVE('ZOOM.IMG', 2, 2, 20, 30, 24, 33);
            assert.equal(saved.length, 8 * 6 * 4);
            assert.deepEqual([saved.header.width, saved.header.height],
                profile === 'magicienii' ? [8, 6] : [1600, 1200]);
        }
    } finally { global.document = previous; }
});

test('Magicienii refreshes moved visible inventory hitmaps before their next render', () => {
    const pixi = require('pixi.js');
    const { AdvancedSprite } = loadModule('engine/rendering.ts', {
        'pixi.js': pixi, '../common/errors': { assert: assert.ok },
    });
    class Display extends FakeType {}
    const { CanvasObserver } = loadModule('engine/types/canvasObserver.ts', {
        './index': { Type: FakeType, DisplayType: Display }, '../../filesystem/assetsLoader': {},
        'pixi.js': pixi, '../../common/types': decorator, '../rendering': { AdvancedSprite },
        '../../common/errors': {}, '../../fileFormats/img': {}, '../logging': {}, './class': {},
    });
    const stage = new pixi.Container();
    const sprite = new AdvancedSprite(new pixi.Texture(new pixi.BaseTexture(null, { width: 36, height: 85 })));
    sprite.visible = true;
    sprite.zIndex = 2998;
    sprite.hitmap = new Uint8Array(36 * 85).fill(255);
    sprite.position.set(140, 44);
    stage.addChild(sprite);
    const object = new Display();
    object.name = 'ANNITEM0';
    object.getRenderObject = () => sprite;
    const engine = { compat: createEngineCompat('magicienii'), app: { stage },
        scopeManager: { find: (predicate) => predicate(object.name, object) ? object : null },
        diagnostics: { hitTest() {} } };
    const observer = new CanvasObserver(engine);
    assert.equal(sprite.getGlobalPosition().x, 140);
    assert.equal(sprite.worldTransform.tx, 0);
    assert.equal(observer.GETGRAPHICSAT(160, 87, true, 2998, 2998), 'ANNITEM0');
    sprite.position.set(240, 44);
    assert.equal(sprite.worldTransform.tx, 140);
    assert.equal(observer.GETGRAPHICSAT(260, 87, true, 2998, 2998), 'ANNITEM0');
    assert.equal(observer.GETGRAPHICSAT(160, 87, true, 2998, 2998), null);
    sprite.visible = false;
    assert.equal(observer.GETGRAPHICSAT(260, 87, true, 2998, 2998), null);
    sprite.visible = true;
    for (const profile of ['default', 'ozn', 'nemo', 'timpului']) {
        engine.compat = createEngineCompat(profile);
        assert.equal(engine.compat.dynamicHotspotTransforms, false);
        sprite.position.set(340, 44);
        assert.equal(observer.GETGRAPHICSAT(360, 87, true, 2998, 2998), null);
    }
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

function alchemyControls(profile = 'magicienii') {
    const pixi = require('pixi.js');
    const logic = loadModule('engine/components/button.ts', {
        '../../common/stateMachine': loadModule('common/stateMachine.ts'),
    });
    class Base {
        constructor(engine, parent, definition) {
            Object.assign(this, { engine, parent, definition, name: definition.NAME });
            this.callbacks = { run: async () => {}, has: () => false };
        }
        getObject(name) { return this.engine.getObject(name?.objectName ?? name); }
    }
    const { AdvancedSprite } = loadModule('engine/rendering.ts', {
        'pixi.js': pixi, './types': { DisplayType: Base }, '../common/errors': { assert: assert.ok },
    });
    const { Image } = loadModule('engine/types/image.ts', {
        './index': { DisplayType: Base }, '../../common/errors': { assert: assert.ok }, 'pixi.js': pixi,
        '../../filesystem/assetsLoader': {}, '../rendering': { AdvancedSprite }, '../../common/types': decorator,
        '../components/button': logic,
    });
    const { Button } = loadModule('engine/types/button.ts', {
        './index': { Type: Base }, './image': { Image }, './animo': { Animo: class {} }, './sound': {},
        'pixi.js': pixi, '../components/button': logic, '../../common/errors': { assert: assert.ok },
        '../../common/types': decorator, '../logging': { logger: { debug() {} } },
    });
    const stage = new pixi.Container(), objects = new Map();
    const engine = { compat: createEngineCompat(profile), getObject: name => objects.get(name) ?? null,
        diagnostics: { buttonState() {} }, app: { stage },
        rendering: { addToStage: sprite => stage.addChild(sprite), removeFromStage: sprite => stage.removeChild(sprite) } };
    function image(name) {
        const object = new Image(engine, null, { TYPE: 'IMAGE', NAME: name, TOCANVAS: true });
        object.sprite = new AdvancedSprite(new pixi.Texture(new pixi.BaseTexture(null, { width: 2, height: 2 })));
        object.sprite.hitmap = Uint8Array.from([0, 255, 255, 255]);
        objects.set(name, object);
        return object;
    }
    return { engine, stage, image, Image, Button };
}

test('Magicienii image buttons deliver pointer callbacks once and release listeners on disable or destruction', async () => {
    const { image, stage } = alchemyControls();
    const paper = image('PAPER'), calls = [];
    paper.callbacks.run = async name => calls.push(name);
    stage.addChild(paper.sprite);
    await paper.SETASBUTTON(true, true);
    await paper.SETASBUTTON(true, true);
    assert.equal(paper.sprite.listenerCount('pointerover'), 1);
    assert.equal(paper.sprite.cursor, 'pointer');
    paper.MOVE(25, 10); paper.sprite.toGlobal({ x: 0, y: 0 });
    assert.equal(paper.sprite.containsPoint({ x: 25.5, y: 10.5 }), false);
    assert.equal(paper.sprite.containsPoint({ x: 26.5, y: 10.5 }), true);
    for (const event of ['pointerover', 'pointerdown', 'pointerup', 'pointerout']) paper.sprite.emit(event);
    await paper.tick();
    assert.deepEqual(calls, ['ONFOCUSON', 'ONCLICK', 'ONRELEASE', 'ONFOCUSOFF']);
    paper.sprite.emit('pointerdown');
    await paper.SETASBUTTON(false, false);
    assert.equal(paper.sprite.listenerCount('pointerdown'), 0);
    assert.equal(paper.sprite.visible, true);
    await paper.SETASBUTTON(true, false); await paper.tick();
    assert.equal(paper.sprite.cursor, 'default');
    assert.equal(calls.length, 4, 'Disabling must discard queued clicks');
    paper.sprite.emit('pointerover');
    paper.destroy(); await paper.tick();
    assert.equal(paper.sprite.listenerCount('pointerover'), 0);
    assert.equal(stage.children.length, 0);
    assert.equal(calls.length, 4);
});

test('Magicienii button state graphics refresh in place without firing input callbacks', async () => {
    const { engine, image, Button } = alchemyControls();
    const standard = image('STANDARD'), hover = image('HOVER'), pressed = image('PRESSED');
    const nextHover = image('HOVER2'), nextPressed = image('PRESSED2');
    const button = new Button(engine, null, { TYPE: 'BUTTON', NAME: 'EXIT', ENABLE: true,
        GFXSTANDARD: { objectName: 'STANDARD' } });
    const calls = [];
    button.callbacks.run = async name => calls.push(name);
    button.init(); await button.applyDefaults();
    button.SETONMOVE('HOVER'); button.SETONCLICK('PRESSED');
    assert.deepEqual([standard.sprite.visible, hover.sprite.visible, pressed.sprite.visible], [true, false, false]);
    standard.sprite.emit('pointerover'); await button.tick();
    assert.equal(standard.sprite.alpha, 0);
    assert.equal(hover.sprite.visible, true);
    button.SETONMOVE('HOVER2');
    assert.equal(hover.sprite.visible, false);
    assert.equal(nextHover.sprite.visible, true);
    assert.deepEqual(calls, ['ONFOCUSON']);
    standard.sprite.emit('pointerdown'); await button.tick();
    button.SETONCLICK('PRESSED2');
    assert.equal(pressed.sprite.visible, false);
    assert.equal(nextPressed.sprite.visible, true);
    assert.equal(nextHover.sprite.visible, false);
    assert.deepEqual(calls, ['ONFOCUSON', 'ONCLICKED']);
    standard.sprite.emit('pointerup'); await button.tick();
    assert.equal(nextHover.sprite.visible, true);
    assert.deepEqual(calls, ['ONFOCUSON', 'ONCLICKED', 'ONRELEASED', 'ONACTION']);
    await button.DISABLEBUTVISIBLE();
    button.SETONMOVE('STANDARD');
    assert.equal(standard.sprite.visible, true);
    assert.equal(standard.sprite.alpha, 1);
    await button.DISABLE(); button.SETONCLICK('STANDARD');
    assert.equal(standard.sprite.visible, false);
    await button.ENABLE();
    assert.equal(standard.sprite.visible, true);
    assert.equal(standard.sprite.listenerCount('pointerdown'), 1);
    button.destroy();
    assert.equal(standard.sprite.listenerCount('pointerdown'), 0);
});

test('Magicienii GETSTD reports the current standard graphic, including replacements and clones', async () => {
    const { engine, image, Button } = alchemyControls();
    const standard = image('STANDARD'); image('NEXT_2'); image('HOVER');
    const button = new Button(engine, null, { TYPE: 'BUTTON', NAME: 'PLAYER', ENABLE: true,
        GFXSTANDARD: { objectName: 'STANDARD' } });
    assert.equal(button.GETSTD(), 'UNKNOWN');
    button.init(); await button.applyDefaults();
    assert.equal(button.GETSTD(), 'STANDARD');
    button.SETONMOVE('HOVER');
    standard.sprite.emit('pointerover'); await button.tick();
    assert.equal(button.GETSTD(), 'STANDARD');
    button.SETSTD('NEXT_2');
    assert.equal(button.GETSTD(), 'NEXT_2');
    button.destroy();
});

test('Other profiles keep image and dynamic button graphic calls unsupported', async () => {
    for (const profile of ['default', 'ozn', 'nemo', 'timpului']) {
        const { engine, image, Button } = alchemyControls(profile);
        const paper = image('PAPER'), calls = [];
        paper.__call = (...args) => calls.push(args);
        const button = new Button(engine, null, { TYPE: 'BUTTON', NAME: 'EXIT' });
        button.__call = (...args) => calls.push(args);
        await paper.SETASBUTTON(true, true);
        button.SETONMOVE('PAPER'); button.SETONCLICK('PAPER');
        button.GETSTD();
        assert.deepEqual(calls, [['SETASBUTTON', [true, true]], ['SETONMOVE', ['PAPER']],
            ['SETONCLICK', ['PAPER']], ['GETSTD', []]]);
        assert.equal(paper.sprite.listenerCount('pointerdown'), 0);
    }
});

test('Magicienii SETSTD NULL clears a button without hiding or retaining the old graphic listener', async () => {
    for (const profile of ['magicienii', 'nemo', 'timpului']) {
        const { engine, image, Button } = alchemyControls(profile);
        const first = image('FIRST'), next = image('NEXT');
        const button = new Button(engine, null, { TYPE: 'BUTTON', NAME: 'DRAG', ENABLE: true,
            GFXSTANDARD: { objectName: 'FIRST' } });
        button.init(); await button.applyDefaults();
        assert.throws(() => button.SETSTD('MISSING'), /button graphic/);
        if (profile !== 'magicienii') {
            assert.throws(() => button.SETSTD('NULL'), /button graphic/);
            button.destroy(); continue;
        }
        button.SETSTD('NULL', false);
        assert.equal(first.sprite.visible, true); assert.equal(first.sprite.listenerCount('pointerdown'), 0);
        assert.equal(button.GETSTD(), 'UNKNOWN');
        button.SETSTD('NEXT'); assert.equal(next.sprite.listenerCount('pointerdown'), 1);
        button.SETSTD('NULL', true); assert.equal(next.sprite.visible, false);
        assert.equal(next.sprite.listenerCount('pointerdown'), 0); button.destroy();
    }
});

test('Magicienii draggable buttons move on the first pointer delta without an ONDRAGGING handler', async () => {
    const { engine, image, Button } = alchemyControls();
    const graphic = image('COIN'), stage = engine.app.stage;
    graphic.SETPRIORITY = priority => { graphic.sprite.zIndex = priority; };
    graphic.sprite.position.set(100, 100);
    const button = new Button(engine, null, { TYPE: 'BUTTON', NAME: 'DRAG', ENABLE: true,
        DRAGGABLE: true, GFXSTANDARD: { objectName: 'COIN' } });
    const calls = []; button.callbacks.run = async name => calls.push(name);
    button.init(); await button.applyDefaults(); calls.length = 0;
    const pointer = (x, y) => ({ screen: { x, y } });
    graphic.sprite.emit('pointerdown', pointer(100, 100)); await button.tick();
    assert.equal(stage.listenerCount('pointermove'), 1);
    stage.emit('pointermove', pointer(160, 170)); await button.tick();
    assert.deepEqual([graphic.sprite.x, graphic.sprite.y], [160, 170]);
    stage.emit('pointerup', pointer(160, 170)); await button.tick();
    assert.ok(calls.includes('ONSTARTDRAGGING')); assert.ok(calls.includes('ONENDDRAGGING'));
    assert.equal(stage.listenerCount('pointermove'), 0); assert.equal(stage.listenerCount('pointerup'), 0);
    graphic.sprite.emit('pointerdown', pointer(160, 170)); await button.tick();
    assert.equal(stage.listenerCount('pointermove'), 1, 'A stage-only release must allow the next drag');
    button.destroy(); await button.tick();
    assert.equal(stage.listenerCount('pointermove'), 0); assert.equal(stage.listenerCount('pointerup'), 0);
    assert.equal(graphic.sprite.listenerCount('pointerdown'), 0);
});

test('Ordinary drag movement remains unchanged in all other game profiles', async () => {
    for (const profile of ['default', 'ozn', 'nemo', 'timpului']) {
        const { engine, image, Button } = alchemyControls(profile);
        const graphic = image('COIN'), stage = engine.app.stage;
        graphic.SETPRIORITY = priority => { graphic.sprite.zIndex = priority; };
        const button = new Button(engine, null, { TYPE: 'BUTTON', NAME: 'DRAG', ENABLE: true,
            DRAGGABLE: true, GFXSTANDARD: { objectName: 'COIN' } });
        button.init(); await button.applyDefaults();
        graphic.sprite.emit('pointerdown', { screen: { x: 10, y: 20 } }); await button.tick();
        assert.equal(stage.listenerCount('pointermove'), 0);
        assert.equal(button.draggingActive, false);
        button.destroy(); stage.removeAllListeners();
    }
});

test('Magicienii finishes clicks released before drag setup has run', async () => {
    const { engine, image, Button } = alchemyControls();
    const graphic = image('COIN'), stage = engine.app.stage, calls = [];
    graphic.SETPRIORITY = priority => { graphic.sprite.zIndex = priority; };
    const button = new Button(engine, null, { TYPE: 'BUTTON', NAME: 'DRAG', ENABLE: true,
        DRAGGABLE: true, GFXSTANDARD: { objectName: 'COIN' } });
    button.callbacks.run = async name => calls.push(name);
    button.init(); await button.applyDefaults(); calls.length = 0;
    for (let click = 0; click < 2; click++) {
        graphic.sprite.emit('pointerdown', { screen: { x: 10, y: 20 } });
        graphic.sprite.emit('pointerup', { screen: { x: 10, y: 20 } }); await button.tick();
        assert.equal(button.draggingActive, false);
        assert.equal(stage.listenerCount('pointermove'), 0); assert.equal(stage.listenerCount('pointerup'), 0);
    }
    assert.equal(calls.filter(name => name === 'ONENDDRAGGING').length, 2);
    assert.equal(calls.filter(name => name === 'ONRELEASED').length, 2); button.destroy();
});

test('IMAGE schema keeps alchemy focus and click callbacks', () => {
    const logger = { warn: message => assert.fail(message) };
    const common = loadModule('fileFormats/common/index.ts', { '../logger': { logger } });
    const { structureDefinitions } = loadModule('fileFormats/cnv/types.ts', { '../common': common });
    const { parseCNV } = loadModule('fileFormats/cnv/parser.ts', {
        './types': { structureDefinitions }, '../common': common, '../logger': { logger },
    });
    const source = ['OBJECT=PAPER', 'PAPER:TYPE=IMAGE', 'PAPER:FILENAME=PAPER.IMG',
        'PAPER:VISIBLE=TRUE', 'PAPER:TOCANVAS=TRUE', ...['ONFOCUSON', 'ONFOCUSOFF', 'ONCLICK', 'ONRELEASE']
            .map(name => `PAPER:${name}={BEH${name}^RUN();}`)].join('\n');
    const paper = parseCNV(source).PAPER;
    for (const name of ['ONFOCUSON', 'ONFOCUSOFF', 'ONCLICK', 'ONRELEASE']) {
        assert.equal(paper[name].code, `BEH${name}^RUN();`);
    }
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

test('Magicienii frame selection uses native event indexes and event-zero fallback', async () => {
    const { Animo } = loadModule('engine/types/animo.ts', {
        './index': { DisplayType: FakeType }, '../../common/errors': { assert: assert.ok }, 'pixi.js': {},
        '../components/button': {}, '../../filesystem/assetsLoader': {}, '../../filesystem/fileLoader': {},
        '../rendering': {}, '../../common/types': decorator, '../components/collisions': {}, '../audio': {}, '../logging': {},
    });
    const animation = Object.create(Animo.prototype), rendered = [];
    const events = [{ name: 'PLAY', framesCount: 3 }, { name: 'IDLE', framesCount: 2 }, { name: '0', framesCount: 1 }];
    animation.engine = { compat: createEngineCompat('magicienii') };
    animation.annFile = { events };
    animation.currentEvent = events[1]; animation.currentFrame = 1;
    animation.forceRender = async () => rendered.push([animation.currentEvent.name, animation.currentFrame]);
    animation.changeImage = index => rendered.push(['IMAGE', index]);
    assert.equal(animation.GETNOFINEVENT(0), 3);
    assert.equal(animation.GETNOFINEVENT(1), 2);
    assert.equal(animation.GETNOFINEVENT('0'), 1);
    assert.equal(animation.GETNOFINEVENT('G7'), 0);
    assert.equal(animation.GETNOFINEVENT(-1), 2);
    assert.equal(animation.GETNOFINEVENT(7), 0);
    await animation.SETFRAME(0, 2);
    await animation.SETFRAME(1, 1);
    await animation.SETFRAME('0', 0);
    await animation.SETFRAME('G7', 0);
    await animation.SETFRAME('idle', -1);
    await animation.SETFRAME(-1, 1);
    await animation.SETFRAME(7, 0);
    await animation.SETFRAME(1, 99);
    await animation.SETFRAME(1, -2);
    await animation.SETFRAME(2);
    assert.deepEqual(rendered, [['PLAY', 2], ['IDLE', 1], ['0', 0], ['PLAY', 0], ['IDLE', 0], ['IDLE', 1], ['IMAGE', 2]]);
    assert.equal(animation.currentEvent, events[1]);
    assert.equal(animation.currentFrame, 1);
    for (const profile of ['default', 'ozn', 'nemo', 'timpului']) {
        animation.engine.compat = createEngineCompat(profile);
        await animation.SETFRAME(0, 0);
        assert.deepEqual(rendered.at(-1), ['0', 0]);
        await assert.rejects(animation.SETFRAME('G7', 0));
        assert.equal(animation.GETNOFINEVENT(0), 1);
    }
});

function transformFixture(profile) {
    const pixi = require('pixi.js');
    const { AdvancedSprite } = loadModule('engine/rendering.ts', {
        'pixi.js': pixi, './types': { DisplayType: FakeType }, '../common/errors': { assert: assert.ok },
    });
    const { Animo } = loadModule('engine/types/animo.ts', {
        './index': { DisplayType: FakeType }, '../../common/errors': { assert: assert.ok }, 'pixi.js': pixi,
        '../components/button': {}, '../../filesystem/assetsLoader': {}, '../../filesystem/fileLoader': {},
        '../rendering': {}, '../../common/types': decorator, '../components/collisions': {}, '../audio': {}, '../logging': {},
    });
    const { StaticFilter } = loadModule('engine/types/staticfilter.ts', {
        './index': { Type: FakeType }, './animo': { Animo }, '../../common/errors': { assert: assert.ok },
        '../../common/types': decorator,
    });
    const actor = Object.create(Animo.prototype), engine = { compat: createEngineCompat(profile) };
    actor.engine = engine;
    actor.annFile = { annImages: [{ width: 80, height: 40 }] };
    const texture = new pixi.Texture(pixi.BaseTexture.fromBuffer(new Uint8Array(80 * 40 * 4), 80, 40));
    const sprite = new AdvancedSprite(texture), parent = new pixi.Container();
    parent.position.set(10, 20); parent.addChild(sprite);
    Object.assign(actor, { sprite, positionX: 200, positionY: 300, positionOffsetX: 7,
        positionOffsetY: -3, anchorOffsetX: 47, anchorOffsetY: 17 });
    actor.syncPosition();
    const filter = new StaticFilter(engine);
    filter.definition = { ACTION: 'ROTATE' }; filter.getObject = () => actor;
    return { actor, sprite, parent, filter };
}

test('Magicienii animation centers stay fixed through repeated rotation and anchor restoration', () => {
    const { actor, sprite, parent, filter } = transformFixture('magicienii');
    const anchor = sprite.anchor;
    assert.equal(actor.GETCENTERX(), 210);
    assert.equal(actor.GETCENTERY(), 320);
    for (const angle of [90, 180, 270, 17, -35, 0]) {
        filter.SETPROPERTY('ANGLE', angle); filter.LINK('ACTOR');
        assert.deepEqual([actor.GETCENTERX(), actor.GETCENTERY()], [210, 320]);
        filter.UNLINK('ACTOR');
        assert.equal(sprite.anchor, anchor, 'Restore coordinates without replacing PIXI\'s observable anchor');
        assert.deepEqual([sprite.anchor.x, sprite.anchor.y, sprite.angle], [0, 0, 0]);
        assert.deepEqual([actor.GETCENTERX(), actor.GETCENTERY()], [210, 320]);
    }
    sprite.anchor.set(.25, .75); sprite.scale.set(2, .5); actor.syncPosition();
    parent.scale.set(2, 3); parent.angle = 30;
    const center = sprite.toGlobal(new (require('pixi.js').Point)(20, -10));
    assert.deepEqual([actor.GETCENTERX(), actor.GETCENTERY()], [Math.round(center.x), Math.round(center.y)]);
    parent.destroy({ children: true, texture: true, baseTexture: true });
});

test('Other profiles retain their existing animation center and rotation-filter behavior', () => {
    for (const profile of ['default', 'ozn', 'nemo', 'timpului']) {
        const { actor, sprite, parent, filter } = transformFixture(profile);
        assert.equal(actor.engine.compat.animationTransforms, false);
        const anchor = sprite.anchor;
        filter.SETPROPERTY('ANGLE', 90); filter.LINK('ACTOR');
        assert.deepEqual([actor.GETCENTERX(), actor.GETCENTERY()], [250, 340]);
        filter.UNLINK('ACTOR');
        assert.equal(sprite.anchor, anchor);
        assert.deepEqual([sprite.anchor.x, sprite.anchor.y, sprite.angle], [.5, .5, 0]);
        parent.destroy({ children: true, texture: true, baseTexture: true });
    }
});

test('Magicienii ISAT checks hidden animation bounds and optional alpha with current transforms', () => {
    const { actor, sprite, parent } = transformFixture('magicienii');
    parent.position.set(0, 0); sprite.position.set(100, 200);
    sprite.hitmap = new Uint8Array(80 * 40); sprite.hitmap[0] = 255;
    sprite.hitmap[1] = 1; sprite.hitmap[80] = 255;
    sprite.visible = false; sprite.checkPixelPerfect = true;
    assert.equal(actor.ISAT(100, 200, true), true);
    assert.equal(actor.ISAT(101, 200, true), true, 'Any nonzero alpha is a hit');
    assert.equal(actor.ISAT(102, 200, true), false);
    assert.equal(actor.ISAT(102, 200, false), true, 'Bounding-box queries ignore button pixel testing');
    assert.equal(actor.ISAT(102, 200), true);
    for (const [x, y] of [[99, 200], [100, 199], [180, 200], [100, 240]]) {
        assert.equal(actor.ISAT(x, y, true), false, 'Half-open image edges must not wrap into another pixel row');
        assert.equal(actor.ISAT(x, y, false), false);
    }
    sprite.position.set(500, 100);
    assert.equal(actor.ISAT(100, 200, true), false);
    assert.equal(actor.ISAT(500, 100, true), true, 'Unrendered position changes must refresh the transform');
    parent.position.set(10, 20); parent.scale.set(2, 3);
    sprite.anchor.set(.5, .5); sprite.scale.set(2, .5); sprite.angle = 90;
    const point = sprite.toGlobal(new (require('pixi.js').Point)(-39.75, -19.75));
    assert.equal(actor.ISAT(point.x, point.y, true), true);
    for (const profile of ['default', 'ozn', 'nemo', 'timpului']) {
        actor.engine.compat = createEngineCompat(profile);
        actor.__call = (method, args) => ({ method, args });
        assert.deepEqual(actor.ISAT(100, 200, true), { method: 'ISAT', args: [100, 200, true] });
    }
    actor.engine.compat = createEngineCompat('magicienii'); actor.annFile = { annImages: [] };
    assert.equal(actor.ISAT(point.x, point.y, false), false, 'An empty placeholder has no image bounds');
    assert.equal(actor.ISAT(point.x, point.y, true), false);
    actor.sprite = null;
    assert.equal(actor.ISAT(0, 0, true), false);
    parent.destroy({ children: true, texture: true, baseTexture: true });
});

test('Only Magicienii registers off-canvas animation clones and copies the current canvas priority', async () => {
    const pixi = require('pixi.js');
    class Base {
        constructor(engine, parent, definition) {
            Object.assign(this, { engine, parent, definition, name: definition.NAME });
            this.callbacks = { run: async () => {} };
        }
        SETPRIORITY(value) { this.priority = value; this.getRenderObject().zIndex = value; }
        GETPRIORITY() { return this.priority; }
        async clone() { return new Animo(this.engine, this.parent, this.definition); }
    }
    const { AdvancedSprite } = loadModule('engine/rendering.ts', {
        'pixi.js': pixi, './types': { DisplayType: Base }, '../common/errors': { assert: assert.ok },
    });
    const { Animo } = loadModule('engine/types/animo.ts', {
        './index': { DisplayType: Base }, '../../common/errors': { assert: assert.ok }, 'pixi.js': pixi,
        '../components/button': { ButtonLogicComponent: class {} }, '../../filesystem/assetsLoader': {},
        '../../filesystem/fileLoader': {}, '../rendering': { AdvancedSprite, createHitmapFromImageBytes: () => Uint8Array.of(255, 255) },
        '../../common/types': decorator, '../components/collisions': { CollisionsComponent: class {} }, '../audio': {}, '../logging': {},
    });
    for (const profile of ['default', 'magicienii', 'ozn', 'nemo', 'timpului']) {
        for (const onCanvas of [true, false]) {
            const stage = new pixi.Container();
            const engine = { compat: createEngineCompat(profile), rendering: {
                addToStage: sprite => stage.addChild(sprite), removeFromStage: sprite => stage.removeChild(sprite),
            } };
            const source = new Animo(engine, null, { NAME: 'TEMPLATE', TYPE: 'ANIMO',
                VISIBLE: false, TOCANVAS: onCanvas, PRIORITY: 5 });
            source.annFile = { images: [new Uint8Array(8).fill(255)],
                annImages: [{ width: 2, height: 1, positionX: 0, positionY: 0 }],
                events: [{ name: 'IDLE', framesCount: 1, framesImageMapping: [0],
                    frames: [{ positionX: 0, positionY: 0 }] }] };
            await source.initSprite(); source.SETPRIORITY(712);
            const clone = await source.clone(), sprite = clone.getRenderObject();
            assert.equal(sprite.parent === stage, onCanvas || profile === 'magicienii');
            assert.equal(sprite.zIndex, profile === 'magicienii' ? onCanvas ? 712 : 0 : 5);
            assert.equal(sprite.visible, false);
            assert.equal(sprite.texture, source.getRenderObject().texture);
            assert.equal(stage.children.filter(child => child === sprite).length, sprite.parent ? 1 : 0);
            clone.destroy();
            assert.equal(stage.children.length, onCanvas ? 1 : 0);
            assert.ok(source.getRenderObject().texture.baseTexture, 'Clone teardown must not release shared textures');
            source.destroy();
            assert.equal(stage.children.length, 0);
        }
    }
});

test('Only Magicienii prioritizes named animation-frame callbacks over event callbacks', async () => {
    for (const profile of ['default', 'magicienii', 'ozn', 'nemo', 'timpului']) {
        const { actor, sprite, parent } = transformFixture(profile), calls = [];
        const handlers = new Set(['SWAP', 'RIGHT']);
        actor.callbacks = { hasParametrized: (name, param) => name === 'ONFRAMECHANGED' && handlers.has(param),
            run: async (...args) => calls.push(args) };
        actor.annFile = { annImages: [{ width: 80, height: 40, positionX: 0, positionY: 0 }] };
        actor.getTexture = () => sprite.texture; actor.getHitmap = () => new Uint8Array(80 * 40);
        sprite.getClippingRect = () => null; sprite.setClippingRect = () => {};
        actor.buttonInteractArea = null;
        const event = { name: 'RIGHT', framesImageMapping: [0, 0],
            frames: [{ name: 'swap', positionX: 0, positionY: 0 }, { name: '', positionX: 0, positionY: 0 }] };
        await actor.changeFrame(event, 0);
        assert.deepEqual(calls.pop(), ['ONFRAMECHANGED', profile === 'magicienii' ? 'SWAP' : 'RIGHT']);
        handlers.delete('SWAP');
        await actor.changeFrame(event, 0);
        assert.deepEqual(calls.pop(), ['ONFRAMECHANGED', 'RIGHT']);
        await actor.changeFrame(event, 1);
        assert.deepEqual(calls.pop(), ['ONFRAMECHANGED', 'RIGHT']);
        await actor.changeFrame(event, 0, false);
        assert.deepEqual(calls, []);
        parent.destroy({ children: true, texture: true, baseTexture: true });
    }
});

function playbackFixture(profile = 'magicienii', scene = 'DRAGON') {
    const { Animo } = loadModule('engine/types/animo.ts', {
        './index': { DisplayType: FakeType }, '../../common/errors': { assert: assert.ok }, 'pixi.js': {},
        '../components/button': {}, '../../filesystem/assetsLoader': {}, '../../filesystem/fileLoader': {},
        '../rendering': {}, '../../common/types': decorator, '../components/collisions': {}, '../audio': {},
        '../logging': { logger: { debug() {} } },
    });
    const animation = Object.create(Animo.prototype), rendered = [], callbacks = [];
    animation.engine = { compat: createEngineCompat(profile), currentScene: { name: scene },
        diagnostics: new Proxy({}, { get: () => () => {} }) };
    const event = { name: 'UP', framesCount: 4, loopFramesStartIndex: 0, loopFramesEndIndex: 0,
        frames: Array.from({ length: 4 }, () => ({ sounds: [] })) };
    Object.assign(animation, { annFile: { events: [event] }, currentEvent: event, currentFrame: 0,
        playbackDirection: 1, sprite: {}, sounds: new Map(), eventEndedLastTick: null });
    animation.callbacks = { run: async (name, event) => callbacks.push([name, event]) };
    animation.changeFrame = async (event, frame) => {
        rendered.push(frame);
        await animation.callbacks.run('ONFRAMECHANGED', event.name);
    };
    return { animation, rendered, callbacks, event };
}

test('Magicienii dragon plays backward through frame zero and signals completion once', async () => {
    const { animation, rendered, callbacks } = playbackFixture();
    await animation.PLAY('UP');
    await animation.SETFRAME('UP', 3);
    animation.SETBACKWARD();
    assert.equal(animation.currentFrame, 3, 'Changing direction must not seek the current frame');
    for (let tick = 0; tick < 4; tick++) await animation.tickAnimation();
    assert.deepEqual(rendered, [0, 3, 2, 1, 0]);
    assert.equal(animation.isPlaying, false);
    assert.equal(animation.currentFrame, 0);
    assert.equal(callbacks.filter(([name]) => name === 'ONSTARTED').length, 1);
    assert.equal(callbacks.filter(([name]) => name === 'ONFINISHED').length, 1);
});

test('Magicienii dragon completion can restart and reverse the same animation', async () => {
    const { animation, rendered, callbacks } = playbackFixture();
    let completions = 0;
    const run = animation.callbacks.run;
    animation.callbacks.run = async (name, event) => {
        await run(name, event);
        if (name === 'ONFINISHED' && ++completions === 1) {
            await animation.PLAY('UP');
            await animation.SETFRAME('UP', 3);
            animation.SETBACKWARD();
        }
    };
    await animation.PLAY('UP');
    for (let tick = 0; tick < 8; tick++) await animation.tickAnimation();
    assert.deepEqual(rendered, [0, 1, 2, 3, 0, 3, 2, 1, 0]);
    assert.equal(completions, 2);
    assert.equal(animation.isPlaying, false);
    assert.equal(callbacks.filter(([name]) => name === 'ONSTARTED').length, 2);
});

test('Dragon direction switches preserve the displayed frame and wrap loop endpoints', async () => {
    const { animation, rendered, event } = playbackFixture();
    event.loopFramesStartIndex = 1; event.loopFramesEndIndex = 3;
    await animation.PLAY('UP');
    await animation.SETFRAME('UP', 2);
    animation.SETBACKWARD();
    await animation.tickAnimation();
    await animation.tickAnimation();
    animation.SETFORWARD();
    await animation.tickAnimation();
    assert.deepEqual(rendered, [0, 2, 1, 3, 1]);
    assert.equal(animation.isPlaying, true);
});

test('Other games and Magicienii scenes retain their previous forward animation timing', async () => {
    for (const [profile, scene] of [['default', 'DRAGON'], ['ozn', 'DRAGON'], ['nemo', 'DRAGON'],
        ['timpului', 'DRAGON'], ['magicienii', 'MAGIC'], ['magicienii', 'MIOTLY']]) {
        const { animation, rendered } = playbackFixture(profile, scene);
        const unsupported = [];
        animation.__call = name => unsupported.push(name);
        await animation.PLAY('UP');
        assert.equal(animation.currentFrame, 1);
        animation.SETBACKWARD();
        await animation.tickAnimation();
        animation.SETFORWARD();
        assert.deepEqual(rendered, [0, 1]);
        assert.deepEqual(unsupported, ['SETBACKWARD', 'SETFORWARD']);
    }
});

test('Only Magicienii accepts animation clipping and pattern offsets omit the template translation', () => {
    const { Animo } = loadModule('engine/types/animo.ts', {
        './index': { DisplayType: FakeType }, '../../common/errors': { assert: assert.ok },
        'pixi.js': { Rectangle: class { constructor(x, y, width, height) { Object.assign(this, { x, y, width, height }); } } },
        '../components/button': {}, '../../filesystem/assetsLoader': {}, '../../filesystem/fileLoader': {},
        '../rendering': {}, '../../common/types': decorator, '../components/collisions': {}, '../audio': {}, '../logging': {},
    });
    for (const profile of ['default', 'magicienii', 'ozn', 'nemo', 'timpului']) {
        const animation = Object.create(Animo.prototype), clips = [], calls = [];
        animation.engine = { compat: createEngineCompat(profile) };
        animation.sprite = { setClippingRect: rect => clips.push(rect), width: 40, height: 20, anchor: { x: .5, y: 0 } };
        animation.__call = (...args) => calls.push(args);
        animation.SETCLIPPING(10, 20, 800, 500);
        if (profile === 'magicienii') {
            assert.deepEqual({ ...clips[0] }, { x: 10, y: 20, width: 790, height: 480 });
            assert.deepEqual(calls, []);
        } else {
            assert.deepEqual(clips, []);
            assert.deepEqual(calls, [['SETCLIPPING', [10, 20, 800, 500]]]);
        }
        Object.assign(animation, { positionX: -800, positionY: -1200, positionOffsetX: 39,
            positionOffsetY: -69, anchorOffsetX: 5, anchorOffsetY: 10 });
        assert.deepEqual(animation.getPatternPositionOffset(), { x: 54, y: -79 });
    }
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
    database.parentScope = { set() {}, remove() {} };
    database.content = [101, 102, 104, 108].map((value) => ({ GETFIELD: () => ({ getValue: async () => value }) }));
    assert.equal(await database.FIND('TYPE', 102, 0), 1);
    assert.equal(await database.FIND('TYPE', 108, 0), 3);
    assert.equal(await database.FIND('TYPE', 999, 0), -1);
});

test('Magicienii FIND selects the matching row for direct database cursor reads', async () => {
    const { Scope } = loadModule('engine/scope.ts', { '../common/errors': { assert: assert.ok } });
    const scope = new Scope('scene');
    const database = new Database({ compat: createEngineCompat('magicienii') });
    database.name = 'DBDIALOG';
    database.parentScope = scope;
    database.content = ['one', 'topic', 'other', 'TOPIC'].map((value) => ({
        GETFIELD: () => ({ getValue: async () => value }),
    }));
    database.SELECT(0);
    assert.equal(await database.FIND('ID', 'TOPIC', 0), 1);
    assert.equal(database.GETCURSORPOS(), 1);
    assert.equal(scope.get('DBDIALOG_CURSOR'), database.content[1]);
    assert.equal(await database.FIND('ID', 'topic', 2), 3);
    assert.equal(database.GETCURSORPOS(), 3);
    assert.equal(scope.get('DBDIALOG_CURSOR'), database.content[3]);
    assert.equal(await database.FIND('ID', 'missing', 0), -1);
    assert.equal(database.GETCURSORPOS(), 3);
    assert.equal(scope.get('DBDIALOG_CURSOR'), database.content[3]);
});

test('database FIND cursor selection is confined to Magicienii', async () => {
    for (const profile of ['default', 'ozn', 'nemo', 'timpului', 'magicienii']) {
        const database = new Database({ compat: createEngineCompat(profile) });
        database.parentScope = { set() {}, remove() {} };
        database.content = ['one', 'topic', 'other'].map((value) => ({ GETFIELD: () => ({ getValue: () => value }) }));
        database.SELECT(2);
        assert.equal(await database.FIND('ID', 'topic', 0), 1);
        assert.equal(database.GETCURSORPOS(), profile === 'magicienii' ? 1 : 2);
    }
});

test('database lookup tracing records the matched row and is silent when disabled', () => {
    const { EngineDiagnostics } = loadModule('engine/diagnostics.ts');
    const messages = [];
    const original = console.info;
    console.info = (message) => messages.push(message);
    try {
        const diagnostics = new EngineDiagnostics({ currentScene: { name: 'DIALOGS' } }, true);
        diagnostics.databaseFind({ name: 'DBDIALOG' }, 'ID', '7', 0, 6, 6);
        assert.match(messages[0], /trace:database-find/);
        assert.deepEqual(JSON.parse(messages[0].slice(messages[0].indexOf('{'))), {
            name: 'DBDIALOG', column: 'ID', value: '7', offset: 0, result: 6, cursor: 6,
        });
        diagnostics.enabled = false;
        diagnostics.databaseFind({ name: 'DBDIALOG' }, 'ID', '12', 0, 12, 12);
        assert.equal(messages.length, 1);
    } finally { console.info = original; }
});

test('sound logs name the loaded file and retain its identity across subsequent reloads', async () => {
    const logs = [], plays = [];
    class Missing extends Error {}
    const { Sound } = loadModule('engine/types/sound.ts', {
        './index': { Type: FakeType }, '../../common/types': decorator,
        '../../common/errors': { assert: assert.ok }, '../../filesystem/fileLoader': { FileNotFoundError: Missing },
        '../audio': {}, '../logging': { logger: { debug: (message) => logs.push(message), warn() {} } },
        '../../filesystem/assetsLoader': { loadSound: async (_filesystem, filename) => {
            if (filename.endsWith('missing.wav')) throw new Missing();
            return { play: (callbacks) => { plays.push(callbacks); return filename; } };
        } },
    });
    const sound = new Sound({ compat: createEngineCompat('magicienii'), resolvePath: async (name) => `wavs/${name}` });
    sound.definition = { FILENAME: 'original.wav' };
    await sound.LOAD('answer1.wav');
    assert.equal(sound.playForSequence(), 'wavs/answer1.wav');
    await sound.LOAD('answer2.wav');
    assert.equal(sound.playForSequence(), 'wavs/answer2.wav');
    plays[0].onStart();
    plays[1].onStart();
    plays[0].onEnd();
    plays[1].onEnd();
    assert.deepEqual(logs, ["Playing sound 'wavs/answer1.wav'", "Playing sound 'wavs/answer2.wav'",
        "Finished playing sound 'wavs/answer1.wav'", "Finished playing sound 'wavs/answer2.wav'"]);
    await sound.LOAD('missing.wav');
    sound.playForSequence();
    plays[2].onStart();
    assert.equal(logs.at(-1), "Playing sound 'wavs/answer2.wav'");
    assert.equal(sound.definition.FILENAME, 'original.wav');
    assert.deepEqual(sound.callbacksQueue, ['ONSTARTED', 'ONSTARTED', 'ONFINISHED', 'ONFINISHED', 'ONSTARTED']);
});

test('Magicienii dialogue sequence repair removes only its unused missing placeholder', () => {
    const { patchMagicieniiSequence } = loadModule('engine/patches/magicienii.ts');
    assert.equal(typeof patchMagicieniiSequence, 'function');
    const root = { NAME: 'BLANK', TYPE: 'SEQUENCE', MODE: 'PARAMETER',
        SEQEVENT: new Map([['GADABLANK', '1'], ['NOWY', '2']]) };
    const speaking = { NAME: 'GADABLANK', TYPE: 'SPEAKING', ADD: 'BLANK',
        ANIMOFN: 'ANNCHARACTER', WAVFN: 'SNDANSWER' };
    const placeholder = { NAME: 'NOWY', TYPE: 'SIMPLE', ADD: 'BLANK', FILENAME: 'BOLEK.ANN', EVENT: 'NOWY' };
    const entries = [root, speaking, placeholder];
    const repaired = patchMagicieniiSequence('dane/game/przygoda/dialogs/blank.seq', entries);
    assert.deepEqual(repaired.map((entry) => entry.NAME), ['BLANK', 'GADABLANK']);
    assert.deepEqual([...repaired[0].SEQEVENT], [['GADABLANK', '1']]);
    assert.equal(repaired[1], speaking);
    assert.equal(root.SEQEVENT.has('NOWY'), true);
    assert.equal(entries.length, 3);
    assert.equal(patchMagicieniiSequence('dane/game/przygoda/arcade/blank.seq', entries), entries);
    const valid = [root, speaking, { ...placeholder, FILENAME: 'PRESENT.ANN' }];
    assert.equal(patchMagicieniiSequence('dane/game/przygoda/dialogs/blank.seq', valid), valid);
});

test('Magicienii clears a database cursor before loading a smaller scene table', async () => {
    const { Scope } = loadModule('engine/scope.ts', { '../common/errors': { assert: assert.ok } });
    const scope = new Scope('class_instance');
    const database = new Database({
        compat: createEngineCompat('magicienii'),
        currentScene: { getRelativePath: async (filename) => filename },
        filesystem: { getFile: async () => new TextEncoder().encode('office\r\n').buffer },
    });
    database.name = 'DBOBJECTS';
    database.parentScope = scope;
    let destroyed = 0;
    database.content = Array.from({ length: 21 }, () => ({ destroy() { destroyed++; } }));
    database.SELECT(20);
    assert.equal(scope.get('DBOBJECTS_CURSOR'), database.content[20]);
    database.REMOVEALL();
    assert.equal(destroyed, 21);
    assert.equal(database.GETCURSORPOS(), 0);
    assert.equal(scope.get('DBOBJECTS_CURSOR'), null);

    const row = { setField: async () => {}, isReady: true };
    database.baseStruct = { structure: new Map([['NAME', 'STRING']]), clone: async () => row };
    await database.LOAD('office.dta');
    assert.equal(scope.get('DBOBJECTS_CURSOR'), row);
    assert.deepEqual(scope.objects, [row]);
    assert.ok(scope.objects.filter((object) => object.isReady).includes(row));
});

test('database cursor reset is Magicienii-only and does not change append loading', async () => {
    for (const profile of ['magicienii', 'default', 'nemo', 'timpului', 'ozn']) {
        const database = new Database({ compat: createEngineCompat(profile) });
        database.parentScope = { set() {}, remove() {} };
        database.content = Array.from({ length: 3 }, () => ({ destroy() {} }));
        database.SELECT(2);
        database.REMOVEALL();
        assert.equal(database.GETCURSORPOS(), profile === 'magicienii' ? 0 : 2);
    }
    const rows = [];
    let text = 'one\r\ntwo\r\nthree\r\n';
    const scope = new Map();
    const database = new Database({
        compat: createEngineCompat('magicienii'),
        currentScene: { getRelativePath: async (filename) => filename },
        filesystem: { getFile: async () => new TextEncoder().encode(text).buffer },
    });
    database.name = 'DB';
    database.parentScope = { set: (name, row) => scope.set(name, row), remove: (name) => scope.delete(name) };
    database.baseStruct = {
        structure: new Map([['NAME', 'STRING']]),
        clone: async () => {
            const row = { setField: async () => {}, destroy() {} };
            rows.push(row);
            return row;
        },
    };
    await database.LOAD('first.dta');
    database.SELECT(2);
    text = 'four\r\nfive\r\n';
    await database.LOAD('append.dta');
    assert.equal(database.GETROWSNO(), 5);
    assert.equal(database.GETCURSORPOS(), 2);
    assert.equal(scope.get('DB_CURSOR'), rows[2]);
    database.REMOVEALL();
    text = '';
    await database.LOAD('empty.dta');
    assert.equal(database.GETCURSORPOS(), 0);
    assert.equal(database.GETROWSNO(), 0);
    assert.equal(scope.has('DB_CURSOR'), false);
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
    '../../fileFormats/sek': { readSekWorld },
    '../compat/sekaiNavigation': { SekaiNavigation },
    '../compat/timeMachinePhysics': { TimeMachinePhysics },
    '../compat/magicieniiPhysics': { createMagicieniiPhysics },
    '../compat/timeMachineVehiclePhysics': { TimeMachineVehiclePhysics },
});

function sekFixture() {
    const parts = [];
    const uint = (value) => { const b = Buffer.alloc(4); b.writeUInt32LE(value); parts.push(b); };
    const float = (value) => { const b = Buffer.alloc(4); b.writeFloatLE(value); parts.push(b); };
    const string = (value) => parts.push(Buffer.from(`${value}\0`));
    const entity = (id) => {
        uint(id); uint(0);
        for (let i = 0; i < 9; i++) float(0);
        uint(1); string('entityName'); uint(2); string('Fixture');
    };
    parts.push(Buffer.from('SEKAI81080701915004'));
    uint(3);
    uint(1); uint(1); entity(100); uint(2); uint(1); string('Default');
    for (const vertex of [[1, 2, 3], [4, 5, 6], [7, 8, 9]]) {
        for (const component of vertex) float(component);
        for (let i = 0; i < 5; i++) float(99);
    }
    for (let i = 0; i < 3; i++) float(1);
    uint(99); uint(3); parts.push(Buffer.from([1, 2, 3]));
    uint(4); uint(1); entity(9000); uint(4); uint(3);
    for (const [x, y, group] of [[0, 0, 0], [0, 100, 1], [100, 100, 0], [100, 0, 0]]) {
        float(x); float(y); float(0); uint(group);
    }
    for (const [from, to, flags] of [[0, 1, 3], [1, 2, 3], [2, 3, 3]]) {
        uint(from); uint(to); uint(flags);
    }
    const b = Buffer.concat(parts);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

test('SEKAI v4 reads entity records, navigation groups and links despite incorrect section sizes', () => {
    const world = readSekWorld(sekFixture());
    assert.deepEqual(world.bodies, [{ id: 100, position: { x: 0, y: 0, z: 0 } }]);
    assert.equal(world.paths[0].id, 9000);
    assert.equal(world.paths[0].nodes.length, 4);
    assert.deepEqual(world.paths[0].nodes[1], { x: 0, y: 100, z: 0, group: 1 });
    assert.deepEqual(world.paths[0].edges[2], { from: 2, to: 3, flags: 3 });
    const truncated = sekFixture().slice(0, -1);
    assert.throws(() => readSekWorld(truncated), /Truncated/);
    const unsupported = sekFixture();
    new Uint8Array(unsupported)[18] = 51;
    assert.throws(() => readSekWorld(unsupported), /version/);
});

test('SEKAI navigation follows graph links around obstacles and can disable waypoint groups', () => {
    const nav = new SekaiNavigation(readSekWorld(sekFixture()).paths[0]);
    const start = { x: 0, y: 0, z: 0 }, target = { x: 100, y: 0, z: 0 };
    assert.deepEqual(nav.find(start, target, false), [start, { x: 0, y: 100, z: 0 }, { x: 100, y: 100, z: 0 }, target]);
    nav.setActive(1, false);
    assert.equal(nav.find(start, target, false), null);
    nav.setActive(1, true);
    assert.equal(nav.find(start, target, false).length, 4);
});

test('SEKAI collision parsing reads vertex stride without applying entity transforms twice', () => {
    assert.deepEqual(readSekWorld(sekFixture(), true).bodies[0].geometry, { flags: 2, triangles: [[
        { x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 }, { x: 7, y: 8, z: 9 },
    ]] });
    assert.equal(readSekWorld(sekFixture()).bodies[0].geometry, undefined);
});

const emptyPhysics = () => new TimeMachinePhysics({ bodies: [], paths: [] });
const sphere = (world, id, x, y, mass = 1, dynamic = true) => {
    world.addSphere(id, mass, 0, 0, 100, dynamic, 5);
    world.setPosition(id, x, y, 0);
};

test('Time Machine physics integrates forces in seconds, caps stalls and respects planar limits', () => {
    const world = emptyPhysics();
    sphere(world, 501, 400, 300, 8);
    world.setGravity(0, -100, 0);
    world.addForce(501, 0, 1600, 0);
    assert.equal(world.step(1000).elapsed, 1);
    assert.ok(world.position(501).y < 300);
    const moved = world.position(501).y;
    for (let i = 0; i < 60; i++) world.step(1000 / 60);
    assert.ok(world.position(501).y > moved);
    assert.ok(world.speed(501) <= 100);
    assert.equal(world.rotation(501), 0);
    world.setLimit(501, 390, 290, 0, 410, 310, 0);
    world.setVelocity(501, 100, 100, 100);
    for (let i = 0; i < 60; i++) world.step(1000 / 60);
    const p = world.position(501);
    assert.ok(p.x <= 410 && p.x >= 390 && p.y <= 310 && p.y >= 290);
    assert.equal(p.z, 0);
});

test('Time Machine magnetic centers attract bodies only when enabled and not excluded', () => {
    const world = emptyPhysics();
    sphere(world, 501, 400, 300, 8);
    sphere(world, 101, 500, 300);
    world.setG(501, 280000);
    world.setMagnetic(501, true);
    world.step(16);
    assert.ok(world.position(101).x < 500);
    world.setVelocity(101, 0, 0, 0); world.setPosition(101, 500, 300, 0);
    world.excludeGravity(101, 501, true); world.step(16);
    assert.equal(world.position(101).x, 500);
    world.excludeGravity(101, 501, false); world.setMagnetic(501, false); world.step(16);
    assert.equal(world.position(101).x, 500);
});

test('Time Machine flight physics supports height, ground collision and a fixed flying altitude', () => {
    const world = new TimeMachinePhysics({ paths: [], bodies: [{ id: 1, position: { x: 0, y: 0, z: 0 },
        geometry: { flags: 0, triangles: [
            [{ x: -200, y: -200, z: 0 }, { x: 200, y: -200, z: 0 }, { x: 200, y: 200, z: 0 }],
            [{ x: -200, y: -200, z: 0 }, { x: 200, y: 200, z: 0 }, { x: -200, y: 200, z: 0 }],
        ] } }] }, false);
    sphere(world, 520, 400, 300);
    world.setPosition(520, 400, 300, 100);
    sphere(world, 501, 450, 350);
    world.setPosition(501, 450, 350, 120);
    world.setLimit(501, -400, -300, 120, 1200, 900, 120);
    world.setGravity(0, 0, -200);
    for (let i = 0; i < 180; i++) world.step(1000 / 60);
    assert.ok(Math.abs(world.position(520).z - 5) < 0.1);
    assert.equal(world.position(501).z, 120);
    world.setVelocity(501, 0, 100, 0); world.step(16);
    assert.equal(world.angle(501), 90);
    world.setVelocity(501, 0, 0, 0); world.step(16);
    assert.equal(world.angle(501), 90);
});

test('Time Machine flight camera scrolls both axes without changing world-space forces', () => {
    const world = new TimeMachinePhysics({ bodies: [], paths: [] }, false);
    sphere(world, 501, 1068, 828);
    world.setPosition(501, 1068, 828, 120);
    world.setBackgroundSize(-400, 1200, -300, 900);
    world.setReference(501); world.setMoveFlags(true, true); world.step(16);
    assert.deepEqual(world.position(501), { x: 668, y: 528, z: 120 });
    assert.equal(world.backgroundX, 400);
    assert.equal(world.backgroundY, 300);
    world.setPosition(501, 500, 450, 120); world.step(16);
    assert.deepEqual(world.position(501), { x: 400, y: 300, z: 120 });
    world.addForce(501, -100, 0, 0); world.step(16);
    assert.ok(world.backgroundX < 100);
    assert.equal(world.position(501).x, 400);
});

test('Time Machine physical camera clamps to native background bounds', () => {
    const world = emptyPhysics(); sphere(world, 501, 400, -150);
    world.setBackgroundSize(0, 800, -200, 800);
    world.setReference(501); world.setMoveFlags(false, true); world.step(16);
    assert.equal(world.backgroundY, -200);
    assert.equal(world.position(501).y, 50);
    world.setPosition(501, 400, 400, 0); world.step(16);
    assert.equal(world.backgroundY, 100);
    assert.equal(world.position(501).y, 300);
    world.setPosition(501, 400, 750, 0); world.step(16);
    assert.equal(world.backgroundY, 200);
    assert.equal(world.position(501).y, 550);
});

test('Only Time Machine NUREK loads physics automatically and links in camera coordinates', async () => {
    for (const profile of ['default', 'magicienii', 'timpului']) {
        const files = [], positions = [];
        const world = new World({ compat: createEngineCompat(profile),
            currentScene: { getRelativePath: async file => file },
            filesystem: { getFile: async file => { files.push(file); return sekFixture(); } },
            getObject: () => ({ SETPOSITION: (x, y) => positions.push([x, y]) }),
            diagnostics: { worldState() {} } });
        world.definition = { FILENAME: 'NUREK.SEK' };
        await world.init();
        if (profile !== 'timpului') { assert.deepEqual(files, []); continue; }
        assert.deepEqual(files, ['NUREK.SEK']);
        world.ADDBODY(501, 8, 0, 0, 0, 0, 100, 1, 2, 16, 16, 16);
        await world.LINK(501, 'MAGNET');
        await world.SETPOSITION(501, 400, -150, 0);
        assert.deepEqual(positions, []);
        world.SETBKGSIZE(0, 800, -200, 800); world.SETREFOBJECT(501); world.SETMOVEFLAGS(false, true);
        world.START(); world.tick(16);
        assert.equal(await world.MOVEOBJECTS(), .016);
        assert.deepEqual(positions.at(-1), [400, 50]);
        assert.equal(world.GETBKGPOSY(), -200);
        assert.equal(world.GETSPEED(501), 0);
        world.UNLINK(501);
        for (let i = 0; i < 4; i++) world.tick(16);
        assert.equal(await world.MOVEOBJECTS(), .064);
        assert.equal(positions.length, 1);
        world.REMOVEOBJECT(501); world.STOP();
        assert.equal(await world.MOVEOBJECTS(), 0);
    }
});

test('Only Magicienii broom, dragon, cat and Barandalf worlds initialize their scene-specific physics', async () => {
    const emptyWorld = Buffer.concat([Buffer.from('SEKAI81080701915004'), Buffer.alloc(4)]);
    for (const profile of ['default', 'magicienii', 'ozn', 'nemo', 'timpului']) {
        for (const scene of ['DRAGON', 'MIOTLY', 'CAT', 'ARCADE', 'BARANDALF']) {
            for (const filename of ['WORLD.SEK', 'LEVEL0.SEK', 'LEVEL1.SEK', 'LEVEL2.SEK', 'LEVEL3.SEK']) {
                const files = [];
                const world = new World({ compat: createEngineCompat(profile),
                    currentScene: { name: scene, getRelativePath: async file => file },
                    filesystem: { getFile: async file => { files.push(file); return arrayBuffer(emptyWorld); } },
                    diagnostics: { worldState() {} } });
                world.definition = { FILENAME: filename };
                await world.init();
                const enabled = profile === 'magicienii' && ((['DRAGON', 'MIOTLY', 'CAT'].includes(scene) && filename === 'WORLD.SEK') ||
                    (scene === 'BARANDALF' && ['LEVEL0.SEK', 'LEVEL2.SEK'].includes(filename)));
                assert.deepEqual(files, enabled ? [filename] : []);
                assert.equal(world.physics !== null, enabled);
                world.destroy();
            }
        }
    }
});

test('Magicienii Cat supports height, gravity and ground limits without projecting height into linked sprites', async () => {
    const emptyWorld = Buffer.concat([Buffer.from('SEKAI81080701915004'), Buffer.alloc(4)]), positions = [];
    const world = new World({ compat: createEngineCompat('magicienii'),
        currentScene: { name: 'CAT', getRelativePath: async file => file },
        filesystem: { getFile: async () => arrayBuffer(emptyWorld) },
        getObject: () => ({ SETPOSITION: (...args) => positions.push(args) }), diagnostics: { worldState() {} } });
    world.definition = { FILENAME: 'WORLD.SEK' }; await world.init();
    try {
        world.ADDBODY(102, 10, 0, 0, 0, 0, 1000, 1, 2, 30, 16, 16);
        await world.SETPOSITION(102, 400, 400, 0); world.LINK(102, 'CAT');
        world.SETLIMIT(102, 0, 0, 0, 800, 600, 999999); world.SETGRAVITY(0, 0, -1000);
        world.SETVELOCITY(102, 100, 0, 500); world.START();
        let highest = 0;
        for (let tick = 0; tick < 120; tick++) {
            world.tick(1000 / 60); await world.MOVEOBJECTS(); highest = Math.max(highest, world.GETPOSITIONZ(102));
            assert.deepEqual(positions.at(-1), [world.GETPOSITIONX(102), world.GETPOSITIONY(102)]);
            assert.equal(Number.isInteger(world.GETPOSITIONZ(102)), true);
        }
        assert.ok(highest > 100); assert.equal(world.GETPOSITIONZ(102), 0);
        assert.ok(world.GETPOSITIONX(102) > 590); assert.equal(world.GETPOSITIONY(102), 400);
        world.engine.currentScene.name = 'DRAGON';
        world.__call = (method, args) => ({ method, args });
        assert.deepEqual(world.GETPOSITIONZ(102), { method: 'GETPOSITIONZ', args: [102] });
    } finally { world.destroy(); }
});

test('Only Cat opts into the original body friction force while other Magicienii worlds retain free motion', async () => {
    const emptyWorld = Buffer.concat([Buffer.from('SEKAI81080701915004'), Buffer.alloc(4)]);
    for (const scene of ['CAT', 'DRAGON', 'MIOTLY']) {
        const world = new World({ compat: createEngineCompat('magicienii'),
            currentScene: { name: scene, getRelativePath: async file => file },
            filesystem: { getFile: async () => arrayBuffer(emptyWorld) }, diagnostics: { worldState() {} } });
        world.definition = { FILENAME: 'WORLD.SEK' }; await world.init();
        try {
            world.ADDBODY(100, 10, 0, 10000, 0, 0, 200, 1, 2, 30, 16, 16);
            await world.SETPOSITION(100, 400, 400, 0); world.SETVELOCITY(100, 100, 0, 0); world.START();
            for (let tick = 0; tick < 60; tick++) { world.tick(1000 / 60); await world.MOVEOBJECTS(); }
            if (scene === 'CAT') {
                assert.equal(world.GETSPEED(100), 0); assert.ok(world.GETPOSITIONX(100) < 410);
            } else {
                assert.equal(world.GETSPEED(100), 100); assert.ok(world.GETPOSITIONX(100) > 499);
            }
        } finally { world.destroy(); }
    }
});

test('Magicienii Barandalf synchronizes linked actors but keeps collision signals and pause semantics', async () => {
    const emptyWorld = Buffer.concat([Buffer.from('SEKAI81080701915004'), Buffer.alloc(4)]);
    const positions = [], signals = [];
    const actor = { SETPOSITION: (...args) => positions.push(args), SIGNAL: id => signals.push(id) };
    const world = new World({ compat: createEngineCompat('magicienii'),
        currentScene: { name: 'BARANDALF', getRelativePath: async file => file },
        filesystem: { getFile: async () => arrayBuffer(emptyWorld) },
        getObject: () => actor, diagnostics: { worldState() {} } });
    world.definition = { FILENAME: 'LEVEL0.SEK' };
    await world.init();
    try {
        world.ADDBODY(100, 1, 0, 100, 0, 0, 0, 1, 2, 20, 20, 20);
        world.SETMAXSPEED(100, 50); world.LINK(100, 'ACTOR');
        await world.SETPOSITION(100, 400, 300, 0);
        world.SETVELOCITY(100, 100, 0, 0);
        world.START(); world.tick(16); await world.MOVEOBJECTS();
        assert.equal(positions.length, 1);
        assert.deepEqual(positions[0], [world.GETPOSITIONX(100), world.GETPOSITIONY(100)]);
        assert.ok(positions[0][0] > 400 && positions[0][0] <= 400.81);
        world.STOP(); world.tick(1000); await world.MOVEOBJECTS();
        assert.equal(positions.length, 1);
        world.START(); world.UNLINK(100); world.tick(16); await world.MOVEOBJECTS();
        assert.equal(positions.length, 1);
        world.LINK(100, 'ACTOR');
        world.ADDBODY(101, 1, 0, 100, 0, 0, 0, 0, 2, 20, 20, 20);
        await world.SETPOSITION(101, 420, 300, 0);
        world.tick(16); await world.MOVEOBJECTS();
        assert.ok(signals.includes('101'));
    } finally { world.destroy(); }
});

test('Magicienii physics preserves separate static walls sharing a body ID', () => {
    const plane = (y, flip) => {
        const a = { x: -100, y, z: -100 }, b = { x: -100, y, z: 100 };
        const c = { x: 100, y, z: -100 }, d = { x: 100, y, z: 100 };
        return { id: 0, position: { x: 0, y: 0, z: 0 }, geometry: { flags: 0,
            triangles: flip ? [[a, c, b], [b, c, d]] : [[a, b, c], [b, d, c]] } };
    };
    const source = { paths: [], bodies: [plane(-10, false), plane(10, true)] };
    const physics = createMagicieniiPhysics(source);
    try {
        physics.addSphere(100, 1, 0, 0, 100, true, 1);
        physics.setPosition(100, 400, 300, 0);
        physics.setGravity(0, -100, 0);
        for (let tick = 0; tick < 180; tick++) physics.step(1000 / 60);
        assert.ok(Math.abs(physics.position(100).y - 309) < 0.3);
        physics.setGravity(0, 100, 0);
        physics.setVelocity(100, 0, 0, 0);
        for (let tick = 0; tick < 180; tick++) physics.step(1000 / 60);
        assert.ok(Math.abs(physics.position(100).y - 291) < 0.3);
        assert.equal(source.bodies[0].geometry.triangles.length, 2);
        assert.equal(source.bodies[1].geometry.triangles.length, 2);
    } finally { physics.destroy(); }
});

test('Magicienii MOVEOBJECTS integrates forces but leaves actor movement to the original script', async () => {
    const emptyWorld = Buffer.concat([Buffer.from('SEKAI81080701915004'), Buffer.alloc(4)]);
    const positions = [];
    const world = new World({ compat: createEngineCompat('magicienii'),
        currentScene: { name: 'DRAGON', getRelativePath: async file => file },
        filesystem: { getFile: async () => arrayBuffer(emptyWorld) },
        getObject: () => ({ SETPOSITION: (...args) => positions.push(args) }), diagnostics: { worldState() {} } });
    world.definition = { FILENAME: 'WORLD.SEK' };
    await world.init();
    try {
        world.ADDBODY(100, 1, 0, 200, 0, 0, 600, 1, 2, 16, 16, 16);
        await world.SETPOSITION(100, 380, 200, 0);
        await world.LINK(100, 'WINGS', 2);
        world.SETVELOCITY(100, -100, 0, 0);
        world.SETGRAVITY(0, -15, 0);
        world.START(); world.tick(16);
        assert.equal(await world.MOVEOBJECTS(), .016);
        assert.ok(world.GETPOSITIONX(100) < 380);
        assert.ok(world.GETPOSITIONY(100) > 200);
        assert.deepEqual(positions, []);
        world.ADDFORCE(100, 0, 1000, 0);
        world.tick(16); await world.MOVEOBJECTS();
        assert.ok(world.GETPOSITIONY(100) < 200);
        const stopped = world.GETPOSITIONX(100);
        world.STOP(); world.tick(1000);
        assert.equal(await world.MOVEOBJECTS(), 0);
        assert.equal(world.GETPOSITIONX(100), stopped);
    } finally { world.destroy(); }
});

test('Magicienii broom point joints keep the nine-body chain connected under thrust', () => {
    const physics = createMagicieniiPhysics({ bodies: [], paths: [] });
    try {
        const ids = [199, 200, 201, 202, 203, 204, 205, 206, 207];
        const xs = [380, 420, 440, 460, 480, 500, 520, 540, 562];
        ids.forEach((id, index) => {
            physics.addSphere(id, index === 0 ? 40 : index === 8 ? 1 : .1, 0, 0,
                index === 0 || index === 8 ? 300 : 100000, true, 16);
            physics.setPosition(id, xs[index], 300, 0);
            physics.setLimit(id, 50, -9999999, 0, 750, 9999999, 0);
        });
        physics.setActive(199, false); physics.setActive(207, false);
        for (let index = 0; index < ids.length - 1; index++) {
            physics.join(ids[index], ids[index + 1], 400 + 20 * index, 300, 0);
        }
        for (let tick = 0; tick < 120; tick++) {
            physics.addForce(199, 0, 20000, 0);
            physics.step(1000 / 60);
        }
        assert.ok(physics.position(199).y < 0);
        assert.ok(physics.position(207).y < 200);
        for (let index = 0; index < ids.length - 1; index++) {
            const a = physics.position(ids[index]), b = physics.position(ids[index + 1]);
            const distance = Math.hypot(a.x - b.x, a.y - b.y);
            assert.ok(Number.isFinite(distance) && distance < xs[index + 1] - xs[index] + 4);
            assert.equal(a.z, 0);
        }
    } finally { physics.destroy(); }
});

test('Terrain physics is enabled only for the three Time Machine vehicle scenes', async () => {
    for (const profile of ['default', 'magicienii', 'ozn', 'nemo', 'timpului']) {
        for (const scene of ['SAMOLOCIK', 'SAMOCHODZIK', 'PIESZO', 'ARCADE']) {
            const files = [];
            const world = new World({ compat: createEngineCompat(profile),
                currentScene: { name: scene, getRelativePath: async file => file },
                filesystem: { getFile: async file => { files.push(file); return sekFixture(); } },
                diagnostics: { worldState() {} } });
            world.definition = { FILENAME: 'TEREN.SEK' };
            await world.init();
            const enabled = profile === 'timpului' && scene !== 'ARCADE';
            assert.deepEqual(files, enabled ? ['TEREN.SEK'] : []);
            if (!enabled) continue;
            world.ADDBODY(501, 1, 0, 0, 0, 0, 100, 1, 2, 5, 5, 5);
            await world.SETPOSITION(501, 400, 300, 120);
            world.SETGRAVITY(0, 0, -100);
            world.SETVELOCITY(501, 0, 10, 0);
            world.START(); world.tick(16);
            await world.MOVEOBJECTS();
            assert.equal(world.GETANGLE(501), 90);
            assert.ok(world.physics.position(501).z < 120);
            world.destroy();
        }
    }
});

test('Vehicle boxes use their full dimensions and collide with original terrain triangles', async () => {
    const world = await TimeMachineVehiclePhysics.create({ paths: [], bodies: [{ id: 1, position: { x: 0, y: 0, z: 0 },
        geometry: { flags: 0, triangles: [
            [{ x: -200, y: -200, z: 0 }, { x: 200, y: -200, z: 0 }, { x: 200, y: 200, z: 0 }],
            [{ x: -200, y: -200, z: 0 }, { x: 200, y: 200, z: 0 }, { x: -200, y: 200, z: 0 }],
        ] } }] });
    try {
        world.addBox(501, 0.1, 0, 0, 170, true, 35, 22, 1);
        world.setPosition(501, 400, 300, 20);
        world.setGravity(0, 0, -200);
        for (let i = 0; i < 240; i++) world.step(1000 / 60);
        assert.ok(Math.abs(world.position(501).z - 0.5) < 0.2);
        assert.ok(Math.abs(world.bodies.get(501).body.mass() - 0.1) < 1e-6);
        assert.deepEqual({ ...world.bodies.get(501).collider.halfExtents() }, { x: 17.5, y: 11, z: 0.5 });
    } finally { world.destroy(); world.destroy(); }
});

test('Joined vehicle wheels drive and steer the chassis without separating', async () => {
    const world = await TimeMachineVehiclePhysics.create({ bodies: [], paths: [] });
    try {
        world.addBox(501, 0.1, 0, 0, 170, true, 35, 22, 1);
        world.setPosition(501, 400, 300, 6);
        const wheels = [[502, 12, 15], [503, 12, -15], [504, -12, 15], [505, -12, -15]];
        for (const [id, x, y] of wheels) {
            world.addSphere(id, .1, .2, 0, 170, true, 6);
            world.setPosition(id, 400 + x, 300 + y, 6);
            world.join(id, 501, 400 + x, 300 + y * 2 / 3, 0);
        }
        for (let i = 0; i < 120; i++) {
            for (const [id] of wheels) world.addForce(id, 80, 0, 0);
            world.step(1000 / 60);
        }
        assert.ok(world.position(501).x > 600);
        assert.ok(world.speed(501) <= 171);
        for (const [id] of wheels) {
            const p = world.position(id), center = world.position(501);
            assert.ok(Math.hypot(p.x - center.x, p.y - center.y, p.z - center.z) < 30);
        }
        for (const [id, x] of wheels) world.addForce(id, 0, x > 0 ? 80 : -80, 0);
        for (let i = 0; i < 30; i++) world.step(1000 / 60);
        assert.ok(Math.abs(world.rotation(501)) > 1);
        world.remove(501);
        for (let i = 0; i < 30; i++) world.step(1000 / 60);
        for (const [id] of wheels) assert.ok(Number.isFinite(world.position(id).x));
    } finally { world.destroy(); }
});

test('Vehicle trigger contacts are nonblocking, and camera limits remain in native coordinates', async () => {
    const world = await TimeMachineVehiclePhysics.create({ bodies: [], paths: [] });
    try {
        world.addBox(12, 0, 0, 0, 0, false, 10, 100, 100);
        world.setPosition(12, 450, 300, 10);
        world.setActive(12, false);
        world.addBox(501, 1, 0, 0, 100, true, 10, 10, 10);
        world.setPosition(501, 400, 300, 10); world.setVelocity(501, 100, 0, 0);
        const collisions = [];
        for (let i = 0; i < 60; i++) collisions.push(...world.step(1000 / 60).collisions);
        assert.ok(world.position(501).x > 490);
        assert.deepEqual(collisions.map(pair => [...pair].sort((a, b) => a - b)), [[12, 501]]);
        world.setVelocity(501, 0, 0, 0);
        world.setPosition(501, 1068, 828, 120);
        world.setBackgroundSize(-400, 1200, -300, 900);
        world.setReference(501); world.setMoveFlags(true, true); world.step(16);
        assert.deepEqual(world.position(501), { x: 668, y: 528, z: 120 });
    } finally { world.destroy(); }
});

test('Vehicle gravity centers honor exclusions and do not accumulate force between frames', async () => {
    const world = await TimeMachineVehiclePhysics.create({ bodies: [], paths: [] });
    try {
        for (const [id, x] of [[501, 400], [520, 500], [502, 550]]) {
            world.addSphere(id, 1, 0, 0, 100, true, 5); world.setPosition(id, x, 300, 0);
        }
        world.setMagnetic(501, true); world.setG(501, 6000000);
        world.excludeGravity(502, 501, true);
        world.step(16);
        assert.ok(world.position(520).x < 500);
        assert.equal(world.position(502).x, 550);
        world.setMagnetic(501, false); world.setVelocity(520, 0, 0, 0);
        const x = world.position(520).x; world.step(16);
        assert.equal(world.position(520).x, x);
        world.addForce(502, 100, 0, 0); world.step(16);
        world.setVelocity(502, 0, 0, 0);
        const afterForce = world.position(502).x; world.step(16);
        assert.equal(world.position(502).x, afterForce);
    } finally { world.destroy(); }
});

test('Time Machine body rotation preserves all four yaw quadrants instead of folding at 90 degrees', async () => {
    const vehicle = await TimeMachineVehiclePhysics.create({ bodies: [], paths: [] });
    const planar = emptyPhysics();
    try {
        sphere(planar, 501, 400, 300);
        vehicle.addBox(501, 1, 0, 0, 100, true, 35, 22, 1);
        for (const angle of [0, 45, 90, 135, 180, 225, 270, 315]) {
            const half = angle * Math.PI / 360;
            planar.bodies.get(501).body.quaternion.set(0, 0, Math.sin(half), Math.cos(half));
            vehicle.bodies.get(501).body.setRotation({ x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) }, true);
            assert.ok(Math.abs(planar.rotation(501) - angle) < 1e-4);
            assert.ok(Math.abs(vehicle.rotation(501) - angle) < 1e-4);
        }
    } finally { planar.destroy(); vehicle.destroy(); }
});

test('Time Machine dynamic overlays release their own objects and restore replaced helpers', async () => {
    const destroyed = [];
    const object = name => ({ name, clones: [], isReady: true, destroy: () => destroyed.push(name) });
    const original = object('HELPER'), overlay = object('HELPER'), image = object('OVERLAY_IMAGE');
    const scope = { content: new Map([['HELPER', original]]), get(name) { return this.content.get(name); },
        remove(name) { this.content.delete(name); }, set(name, value) { this.content.set(name, value); } };
    const { CNVLoader } = loadModule('engine/types/cnvloader.ts', {
        './index': { Type: FakeType }, '../../common/errors': { assert: assert.ok }, '../../common/types': decorator,
        '../../filesystem/definitionLoader': {
            loadDefinition: async () => { scope.set('HELPER', overlay); scope.set('OVERLAY_IMAGE', image); },
            doReady: async () => {},
        },
    });
    const loader = new CNVLoader({ compat: createEngineCompat('timpului'),
        currentScene: { getRelativePath: async file => file }, filesystem: { getCNVFile: async () => ({}) } });
    loader.parent = { scope };
    await loader.LOAD('Surface.cnv');
    assert.equal(scope.get('HELPER'), overlay);
    loader.RELEASE('SURFACE.CNV');
    assert.equal(scope.get('HELPER'), original);
    assert.equal(scope.get('OVERLAY_IMAGE'), undefined);
    assert.deepEqual(destroyed, ['HELPER', 'OVERLAY_IMAGE']);
    loader.RELEASE('surface.cnv');
    assert.equal(destroyed.length, 2);
});

test('Time Machine joints retain their anchors, and removing a member releases its constraints', () => {
    const world = emptyPhysics();
    sphere(world, 1, 400, 300, 1, false); sphere(world, 2, 400, 320);
    world.join(1, 2, 400, 310, 0); world.setGravity(0, -100, 0);
    for (let i = 0; i < 120; i++) world.step(1000 / 60);
    assert.ok(Math.abs(world.position(2).y - 320) < 1);
    world.remove(1);
    for (let i = 0; i < 60; i++) world.step(1000 / 60);
    assert.ok(world.position(2).y > 350);
});

test('Time Machine spheres collide with original SEK triangles and report contacts once', () => {
    const world = new TimeMachinePhysics({ paths: [], bodies: [{ id: 1, position: { x: 0, y: 123, z: 0 },
        geometry: { flags: 0, triangles: [[{ x: -100, y: -20, z: -100 },
            { x: 0, y: -20, z: 100 }, { x: 100, y: -20, z: -100 }]] } }] });
    sphere(world, 101, 400, 300); world.setGravity(0, -100, 0);
    const hits = [];
    for (let i = 0; i < 120; i++) hits.push(...world.step(1000 / 60).collisions);
    assert.ok(Math.abs(world.position(101).y - 315) < 1);
    assert.ok(hits.some(pair => pair.includes(101) && pair.includes(1)));
    assert.equal(world.step(16).collisions.length, 0);
});

test('SEKAI navigation honors directional edge flags and native exact endpoint behavior', () => {
    const nodes = [{ x: 0, y: 0, z: 0, group: 0 }, { x: 100, y: 0, z: 0, group: 0 }];
    const forward = new SekaiNavigation({ id: 1, nodes, edges: [{ from: 0, to: 1, flags: 2 }] });
    const end = { x: 110, y: 0, z: 0 };
    assert.deepEqual(forward.find(nodes[0], end, false), [{ x: 100, y: 0, z: 0 }]);
    assert.deepEqual(forward.find(nodes[0], end, true), [{ x: 100, y: 0, z: 0 }, end]);
    assert.equal(forward.find(nodes[1], nodes[0], false), null);
    assert.deepEqual(forward.find(nodes[0], { x: 1, y: 0, z: 0 }, true), []);
    const reverse = new SekaiNavigation({ id: 1, nodes, edges: [{ from: 0, to: 1, flags: 1 }] });
    assert.equal(reverse.find(nodes[0], nodes[1], false), null);
    assert.deepEqual(reverse.find(nodes[1], nodes[0], false), [{ x: 0, y: 0, z: 0 }]);
});

test('WORLD loads SEKAI scene-relative paths and follows converted waypoints without cutting corners', async () => {
    const positions = [], signals = [], files = [];
    const actor = { SETPOSITION: (x, y) => positions.push([x, y]), SIGNAL: (signal) => signals.push(signal) };
    const world = new World({ compat: createEngineCompat('timpului'),
        currentScene: { getRelativePath: async (file) => `scene/${file}` },
        filesystem: { getFile: async (file) => { files.push(file); return sekFixture(); } },
        getObject: () => actor, diagnostics: { worldState() {} } });
    await world.LOAD('mask.sek');
    assert.deepEqual(files, ['scene/mask.sek']);
    await world.LINK(100, 'ANNREX');
    world.START();
    assert.equal(world.FINDPATH(100, 9000, 500, 300, 0, false), true);
    world.tick(1000);
    await world.FOLLOWPATH(100, 20, 0.5, 150);
    assert.deepEqual(positions.at(-1), [450, 200]);
    await world.FOLLOWPATH(100, 20, 0.5, 150);
    assert.deepEqual(positions.at(-1), [500, 300]);
    assert.deepEqual(signals, ['ATGOAL']);
    await world.FOLLOWPATH(100);
    assert.deepEqual(signals, ['ATGOAL']);
    world.SETACTIVE(9000, 1, false);
    assert.equal(world.FINDPATH(100, 9000, 400, 300, 0, false), false);
    await world.FOLLOWPATH(100);
    assert.deepEqual(signals, ['ATGOAL']);
    await world.LOAD('mask.sek');
    assert.equal(world.FINDPATH(100, 9000, 500, 300, 0, false), true);
    await world.SETPOSITION(100, 425, 325, 0);
    await world.FOLLOWPATH(100);
    assert.deepEqual(positions.at(-1), [425, 325]);
});

test('Time Machine links actors at their saved body positions without changing Magicienii linking', async () => {
    for (const profile of ['timpului', 'magicienii']) {
        for (const point of [[71.2, 493.2], [0, 0], null]) {
            const positions = [], signals = [];
            const actor = { GETPOSITIONX: () => 400, GETPOSITIONY: () => 300,
                SETPOSITION: (x, y) => positions.push([x, y]), SIGNAL: (signal) => signals.push(signal) };
            const world = new World({ compat: createEngineCompat(profile), getObject: () => actor,
                diagnostics: { worldState() {} } });
            if (point) await world.SETPOSITION(100, ...point, 0);
            await world.LINK(100, 'ANNREX');
            if (profile === 'timpului') {
                assert.deepEqual(positions, [point ?? [400, 300]]);
                assert.equal(world.GETPOSITIONX(100), point?.[0] ?? 400);
                assert.equal(world.GETPOSITIONY(100), point?.[1] ?? 300);
            } else {
                assert.deepEqual(positions, []);
                assert.equal(world.GETPOSITIONX(100), point?.[0] || 400);
                assert.equal(world.GETPOSITIONY(100), point?.[1] || 300);
            }
            assert.deepEqual(signals, []);
        }
    }
});

test('Time Machine linking a pending entry path updates the sprite without firing arrival early', async () => {
    const positions = [], signals = [];
    const actor = { SETPOSITION: (x, y) => positions.push([x, y]), SIGNAL: (signal) => signals.push(signal) };
    const world = new World({ compat: createEngineCompat('timpului'), getObject: () => actor,
        diagnostics: { worldState() {} } });
    await world.SETPOSITION(100, 71.2, 493.2, 0);
    world.FINDPATH(100, 9000, 71, 493, 0, false);
    await world.LINK(100, 'ANNREX');
    assert.deepEqual(positions, [[71.2, 493.2]]);
    assert.deepEqual(signals, []);
    world.START();
    world.tick(16);
    await world.FOLLOWPATH(100);
    assert.deepEqual(positions.at(-1), [71, 493]);
    assert.deepEqual(signals, ['ATGOAL']);
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

test('Only Magicienii subtracts every array element and awaits each indexed change callback', async () => {
    const { ArrayObject } = loadModule('engine/types/array.ts', {
        './index': { ValueType: FakeType }, '../../common/errors': { assert: assert.ok },
        '../../common/types': decorator, '../../filesystem/fileLoader': {},
        '../../fileFormats/archive/array': {}, '../logging': {},
    });
    for (const profile of ['default', 'magicienii', 'ozn', 'nemo', 'timpului']) {
        const array = new ArrayObject({ compat: createEngineCompat(profile) });
        array.value = [-10, 0, 80.5];
        const changes = [], unsupported = [];
        array.__call = (...args) => unsupported.push(args);
        array.callbacks = { run: async (name, index) => {
            await Promise.resolve();
            changes.push([name, index, [...array.value]]);
        } };
        await array.SUB(-2.5);
        if (profile === 'magicienii') {
            assert.deepEqual(array.value, [-7.5, 2.5, 83]);
            assert.deepEqual(changes, [['ONCHANGED', 0, [-7.5, 0, 80.5]],
                ['ONCHANGED', 1, [-7.5, 2.5, 80.5]], ['ONCHANGED', 2, [-7.5, 2.5, 83]]]);
            assert.deepEqual(unsupported, []);
            array.REMOVEALL(); await array.SUB(5);
            assert.equal(changes.length, 3);
        } else {
            assert.deepEqual(array.value, [-10, 0, 80.5]);
            assert.deepEqual(changes, []);
            assert.deepEqual(unsupported, [['SUB', [-2.5]]]);
        }
    }
});

test('Only Magicienii exposes a monotonic millisecond system timer across script instances', () => {
    const { System } = loadModule('engine/types/system.ts', {
        './index': { Type: FakeType }, '../../common/types': decorator,
    });
    const before = Math.floor(performance.now());
    const clock = new System({ compat: createEngineCompat('magicienii') });
    const first = clock.GETSYSTEMTIME();
    const second = new System({ compat: createEngineCompat('magicienii') }).GETSYSTEMTIME();
    assert.ok(Number.isInteger(first) && first >= before && first <= second);
    assert.ok(second <= Math.floor(performance.now()));
    for (const profile of ['default', 'ozn', 'nemo', 'timpului']) {
        const system = new System({ compat: createEngineCompat(profile) });
        const calls = [];
        system.__call = (...args) => { calls.push(args); };
        assert.equal(system.GETSYSTEMTIME(), undefined);
        assert.deepEqual(calls, [['GETSYSTEMTIME', []]]);
    }
});

test('Only Magicienii exposes native UTC save-prefix components, including the original day offset', () => {
    const { System } = loadModule('engine/types/system.ts', {
        './index': { Type: FakeType }, '../../common/types': decorator,
    });
    const OriginalDate = globalThis.Date;
    globalThis.Date = class {
        getUTCSeconds() { return 57; }
        getUTCMinutes() { return 8; }
        getUTCDate() { return 31; }
    };
    try {
        const system = new System({ compat: createEngineCompat('magicienii') });
        assert.equal(system.GETSECONDS(), 57);
        assert.equal(system.GETMINUTES(), 8);
        assert.equal(system.GETDAY(), 32);
        for (const profile of ['default', 'ozn', 'nemo', 'timpului']) {
            system.engine.compat = createEngineCompat(profile);
            const calls = []; system.__call = (...args) => { calls.push(args); };
            for (const method of ['GETSECONDS', 'GETMINUTES', 'GETDAY']) assert.equal(system[method](), undefined);
            assert.deepEqual(calls, [['GETSECONDS', []], ['GETMINUTES', []], ['GETDAY', []]]);
        }
    } finally {
        globalThis.Date = OriginalDate;
    }
});

test('Only Magicienii replaces every nonoverlapping literal substring and awaits value changes', async () => {
    class Value extends FakeType {
        async setValue(value) { await Promise.resolve(); this.value = value; }
    }
    const { String: Text } = loadModule('engine/types/string.ts', {
        './index': { ValueType: Value }, '../../common/types': decorator,
    });
    const text = new Text({ compat: createEngineCompat('magicienii') });
    for (const [source, needle, replacement, expected] of [
        ['NORMAL_MALY', '_MALY', '_UCIEKA_MALY', 'NORMAL_UCIEKA_MALY'],
        ['MALY_maly_MALY', 'MALY', 'X', 'X_maly_X'], ['aaaa', 'aa', 'b', 'bb'],
        ['aaaa', 'a', 'aa', 'aaaaaaaa'], ['one.one', '.', '$&', 'one$&one'],
        ['abc', '', 'Z', 'abc'], ['abc', 'abs', 'Z', 'abc'],
    ]) {
        text.value = source;
        await text.REPLACE(needle, replacement);
        assert.equal(text.value, expected);
    }
    for (const profile of ['default', 'ozn', 'nemo', 'timpului']) {
        text.engine.compat = createEngineCompat(profile); text.value = 'a';
        const calls = []; text.__call = (...args) => calls.push(args);
        await text.REPLACE('a', 'b');
        assert.equal(text.value, 'a');
        assert.deepEqual(calls, [['REPLACE', ['a', 'b']]]);
    }
});

test('Only Magicienii CUT keeps the requested slice and treats nonpositive lengths as the remainder', async () => {
    class Value extends FakeType {
        async setValue(value) {
            await Promise.resolve(); const oldValue = this.value; this.value = value;
            await this.valueChanged(oldValue, value);
        }
    }
    const { String: Text } = loadModule('engine/types/string.ts', {
        './index': { ValueType: Value }, '../../common/types': decorator,
    });
    const text = new Text({ compat: createEngineCompat('magicienii') }), calls = [];
    text.callbacks = { run: async (...args) => { await Promise.resolve(); calls.push(args); } };
    for (const [source, start, length, expected] of [
        ['ANNENEMY0_12', 0, 9, 'ANNENEMY0'], ['abcdef', 2, 2, 'cd'],
        ['abcdef', 2, 0, 'cdef'], ['abcdef', 2, -1, 'cdef'], ['abcdef', 2, 99, 'cdef'],
        ['abcdef', 0, 0, 'abcdef'], ['abcdef', 6, 1, ''], ['abcdef', 6, 0, ''], ['', 0, 1, ''],
    ]) {
        text.value = source; calls.length = 0;
        assert.equal(await text.CUT(start, length), undefined);
        assert.equal(text.value, expected);
        assert.deepEqual(calls, [...(source === expected ? [] : [['ONCHANGED', expected]]), ['ONBRUTALCHANGED', expected]]);
    }
    for (const profile of ['default', 'ozn', 'nemo', 'timpului']) {
        text.engine.compat = createEngineCompat(profile); text.value = 'abc';
        text.__call = (method, args) => ({ method, args });
        assert.deepEqual(await text.CUT(0, 1), { method: 'CUT', args: [0, 1] });
        assert.equal(text.value, 'abc');
    }
});

test('Only Magicienii combines integer recipe flags with signed 32-bit OR', async () => {
    class Value extends FakeType {
        async setValue(value) { await Promise.resolve(); this.value = value; return value; }
    }
    const { Integer } = loadModule('engine/types/integer.ts', {
        './index': { ValueType: Value }, '../../common/types': decorator,
    });
    const flags = new Integer({ compat: createEngineCompat('magicienii') });
    for (const [value, argument, expected] of [[0, 1, 1], [8, 17, 25], [-2147483648, 1, -2147483647],
        [0xffffffff, 0, -1], [3, 3, 3]]) {
        flags.value = value;
        assert.equal(await flags.OR(argument), expected);
        assert.equal(flags.value, expected);
    }
    for (const profile of ['default', 'ozn', 'nemo', 'timpului']) {
        flags.engine.compat = createEngineCompat(profile); flags.value = 8;
        const calls = []; flags.__call = (...args) => calls.push(args);
        await flags.OR(4);
        assert.equal(flags.value, 8);
        assert.deepEqual(calls, [['OR', [4]]]);
    }
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

test('Time Machine plays a named non-parameterized cutscene root and completes it once', async () => {
    const sequence = new Sequence({ compat: createEngineCompat('timpului') });
    const root = { NAME: 'DIVE', TYPE: 'SEQUENCE', MODE: 'SEQUENCE' };
    const first = { NAME: 'NARRATOR', TYPE: 'SIMPLE', FILENAME: 'actor', EVENT: 'FIRST' };
    const second = { NAME: 'KRETES', TYPE: 'SIMPLE', FILENAME: 'actor', EVENT: 'SECOND' };
    sequence.sequenceFile = [root, first, second];
    sequence.subEntries.set('DIVE', [first, second]);
    const played = [], finished = [];
    sequence.activeAnimo = { definition: { FILENAME: 'actor' }, hasEvent: () => true,
        playEvent: async (event) => played.push(event) };
    sequence.callbacks = { hasParametrized: () => false,
        run: async (event, name) => finished.push([event, name]) };
    await sequence.PLAY('UNKNOWN');
    assert.equal(sequence.ISPLAYING(), false);
    await sequence.PLAY('DIVE');
    assert.equal(sequence.ISPLAYING(), true);
    assert.deepEqual(played, ['FIRST']);
    await sequence.onAnimoEventFinished('FIRST');
    assert.deepEqual(played, ['FIRST', 'SECOND']);
    await sequence.onAnimoEventFinished('SECOND');
    assert.equal(sequence.ISPLAYING(), false);
    await sequence.progressNext();
    assert.deepEqual(finished, [['ONFINISHED', 'DIVE']]);
});

test('Named non-parameterized sequence playback stays disabled for other profiles', async () => {
    for (const profile of ['default', 'magicienii', 'ozn', 'nemo']) {
        const sequence = new Sequence({ compat: createEngineCompat(profile) });
        sequence.sequenceFile = [{ NAME: 'DIVE', TYPE: 'SEQUENCE', MODE: 'SEQUENCE' }];
        await assert.rejects(sequence.PLAY('DIVE'));
        assert.equal(createEngineCompat(profile).namedSequencePlayback, false);
    }
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

test('Time Machine floating-point absolute values preserve chassis tilt fractions', async () => {
    class Value extends FakeType {
        value = 0;
        setValue(value) { this.value = value; return value; }
    }
    const { Double } = loadModule('engine/types/double.ts', {
        './index': { ValueType: Value }, '../../common/types': decorator,
    });
    const number = new Double({ compat: createEngineCompat('timpului') });
    assert.equal(await number.ABS(-0.75), 0.75);
    assert.equal(number.value, 0.75);
    for (const profile of ['default', 'magicienii', 'ozn', 'nemo']) {
        number.engine.compat = createEngineCompat(profile);
        number.__call = (method, args) => ({ method, args });
        assert.deepEqual(await number.ABS(-3), { method: 'ABS', args: [-3] });
        assert.equal(number.value, .75);
    }
});

test('Time Machine debug car entry supplies validated wheel parameters without changing story jumps or other games', async () => {
    const { prepareTimeMachineVehicleDebugScene } = loadModule('engine/patches/timpului.ts');
    const values = [];
    const engine = { compat: createEngineCompat('timpului'),
        getObject: name => { assert.equal(name, 'G_SARCADESCENEPARAM'); return { setValue: value => values.push(value) }; } };
    await prepareTimeMachineVehicleDebugScene(engine, 'SAMOCHODZIK', ['A', 'K', 'S', 'A']);
    assert.deepEqual(values, ['AKSA0']);
    await assert.rejects(prepareTimeMachineVehicleDebugScene(engine, 'SAMOCHODZIK', ['A']), /four valid/);
    await assert.rejects(prepareTimeMachineVehicleDebugScene(engine, 'SAMOCHODZIK', ['A', 'K', 'S', 'X']), /four valid/);
    await prepareTimeMachineVehicleDebugScene(engine, 'PIESZO', []);
    for (const profile of ['default', 'magicienii', 'ozn', 'nemo']) {
        engine.compat = createEngineCompat(profile);
        await prepareTimeMachineVehicleDebugScene(engine, 'SAMOCHODZIK', []);
    }
    assert.deepEqual(values, ['AKSA0']);
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

test('Time Machine and Magicienii integer vector lengths assign floored distances without enabling other profiles', async () => {
    class Value extends FakeType {
        value = 0;
        setValue(value) { this.value = value; return value; }
    }
    const { Integer } = loadModule('engine/types/integer.ts', {
        './index': { ValueType: Value }, '../../common/types': decorator,
    });
    const integer = new Integer({ compat: createEngineCompat('timpului') });
    assert.equal(await integer.LENGTH(-3, 4), 5);
    assert.equal(integer.value, 5);
    assert.equal(await integer.LENGTH(1, 1), 1);
    assert.equal(integer.value, 1);
    assert.equal(await integer.LENGTH(0, 0), 0);
    integer.engine.compat = createEngineCompat('magicienii');
    assert.equal(await integer.LENGTH(1, 1), Math.SQRT2);
    assert.equal(integer.value, 1);
    assert.equal(await integer.LENGTH(0, 0), 0);
    for (const profile of ['default', 'ozn', 'nemo']) {
        integer.engine.compat = createEngineCompat(profile);
        integer.__call = (method, args) => ({ method, args });
        assert.deepEqual(await integer.LENGTH(3, 4), { method: 'LENGTH', args: [3, 4] });
        assert.equal(integer.value, 0);
    }
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

test('KEYBOARD schema retains every case-sensitive character handler and its fallback', () => {
    const logger = { warn: message => assert.fail(message) };
    const common = loadModule('fileFormats/common/index.ts', { '../logger': { logger } });
    const { structureDefinitions } = loadModule('fileFormats/cnv/types.ts', { '../common': common });
    const { parseCNV } = loadModule('fileFormats/cnv/parser.ts', {
        './types': { structureDefinitions }, '../common': common, '../logger': { logger },
    });
    const chars = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'o', 'O'];
    const keyboard = parseCNV(['OBJECT=KEYS', 'KEYS:TYPE=KEYBOARD', 'KEYS:ONCHAR={FALLBACK^RUN();}',
        ...chars.map(char => `KEYS:ONCHAR^${char}={SELECT^RUN("${char}");}`)].join('\n')).KEYS;
    assert.equal(keyboard.ONCHAR.parametrized.size, chars.length);
    for (const char of chars) assert.equal(keyboard.ONCHAR.parametrized.get(char).code, `SELECT^RUN("${char}");`);
    assert.equal(keyboard.ONCHAR.nonParametrized.code, 'FALLBACK^RUN();');
});

function keyboardFixture(profile = 'magicienii') {
    const warnings = [], calls = [];
    const { Keyboard } = loadModule('engine/types/keyboard.ts', {
        './index': { Type: FakeType }, '../../common/types': decorator,
        '../logging': { logger: { warn: message => warnings.push(message) } },
    });
    const keyboard = new Keyboard({ compat: createEngineCompat(profile), diagnostics: { keyboardState() {} } });
    keyboard.callbacks = { run: async (...args) => calls.push(args) };
    const down = (code, key, modifiers = {}) => keyboard.onKeyDown({ code, key, ...modifiers });
    const up = (code, key) => keyboard.onKeyUp({ code, key });
    return { keyboard, down, up, calls, warnings };
}

test('Magicienii queues character input after keydown, preserves case and honors repeat/disable gates', async () => {
    const { keyboard, down, up, calls, warnings } = keyboardFixture();
    down('Digit9', '('); down('Digit9', '9');
    assert.equal(keyboard.ISKEYDOWN('9'), true);
    assert.deepEqual(calls, []);
    await keyboard.tick();
    assert.deepEqual(calls, [['ONKEYDOWN', '9'], ['ONCHAR', '9']]);
    up('Digit9', '9'); await keyboard.tick();
    assert.equal(keyboard.ISKEYDOWN('9'), false);
    assert.deepEqual(calls.at(-1), ['ONKEYUP', '9']);
    calls.length = 0;
    keyboard.SETAUTOREPEAT(true);
    down('KeyO', 'o'); down('KeyO', 'O'); up('KeyO', 'O'); await keyboard.tick();
    assert.deepEqual(calls, [['ONKEYDOWN', 'O'], ['ONCHAR', 'o'], ['ONKEYDOWN', 'O'], ['ONCHAR', 'O'], ['ONKEYUP', 'O']]);
    calls.length = 0;
    for (const modifier of ['ctrlKey', 'altKey', 'metaKey']) { down('KeyO', 'o', { [modifier]: true }); up('KeyO', 'o'); }
    await keyboard.tick();
    assert.equal(calls.some(([name]) => name === 'ONCHAR'), false, 'Browser/system chords must not generate printable input');
    calls.length = 0;
    down('Digit3', '3'); keyboard.DISABLE(); await keyboard.tick();
    assert.equal(calls.some(([name]) => name === 'ONCHAR'), false, 'Disabling must suppress an already queued character');
    calls.length = 0; down('Digit4', '4'); await keyboard.tick();
    assert.deepEqual(calls, []);
    keyboard.ENABLE(); down('Digit4', '4'); await keyboard.tick();
    assert.deepEqual(calls, [['ONKEYDOWN', '4'], ['ONCHAR', '4']]);
    assert.deepEqual(warnings, []);
});

test('Magicienii character listeners are removed on teardown and not duplicated by repeated ready calls', async () => {
    const previousWindow = globalThis.window, target = new EventTarget(); globalThis.window = target;
    const { keyboard, calls } = keyboardFixture();
    const press = () => {
        const event = new Event('keydown'); Object.assign(event, { code: 'Digit8', key: '8' });
        target.dispatchEvent(event);
    };
    try {
        await keyboard.ready(); await keyboard.ready();
        press(); await keyboard.tick();
        assert.deepEqual(calls, [['ONKEYDOWN', '8'], ['ONCHAR', '8']]);
        keyboard.destroy(); calls.length = 0; press(); await keyboard.tick();
        assert.deepEqual(calls, []);
    } finally {
        keyboard.destroy();
        if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    }
});

test('Other profiles retain legacy keyboard mapping and never emit ONCHAR', async () => {
    for (const profile of ['default', 'ozn', 'nemo', 'timpului']) {
        const { keyboard, down, up, calls } = keyboardFixture(profile);
        for (const [code, key] of [['Digit1', '1'], ['Digit2', '2'], ['Digit9', '9'], ['KeyO', 'o']]) {
            down(code, key); up(code, key);
        }
        await keyboard.tick();
        assert.equal(calls.some(([name]) => name === 'ONCHAR'), false);
        assert.deepEqual(calls.slice(0, 4), [['ONKEYDOWN', '1'], ['ONKEYUP', '1'], ['ONKEYDOWN', '2'], ['ONKEYUP', '2']]);
        assert.equal(keyboard.ISKEYDOWN('9'), false);
    }
});

test('Persisted checkpoints wait for the active tick and copy current slot, values and files', async () => {
    const { captureSavedProgressCheckpoint } = loadModule('engine/checkpoint.ts');
    const entry = { version: 1, scene: 'ARCADE', previousScene: 'CUTSCENKI',
        globals: [{ parent: 'GAME', name: 'SGSLOTNAME', type: 'STRING', value: '0' }],
        saveData: { old: true }, filesystemEntries: [] };
    const saved = { current: { slot: 2 } }, bytes = Uint8Array.of(2, 5, 9).buffer;
    const calls = [];
    let finishTick;
    const engine = {
        app: { ticker: { started: true, start: () => calls.push('resume') } },
        stopForRestart: async () => {
            calls.push('stop'); await new Promise((resolve) => { finishTick = resolve; }); calls.push('settled');
        },
        scopeManager: { scopes: [{ objects: [
            { parent: { name: 'OTHER' }, name: 'SGSLOTNAME', definition: { TYPE: 'STRING' }, getValue: () => '9' },
            { parent: { name: 'GAME' }, name: 'SGSLOTNAME', definition: { TYPE: 'STRING' },
                getValue: async () => { calls.push('global'); return '2'; } },
        ] }] },
        saveFile: { toObject: () => saved }, options: { storage: {
            snapshot: async () => { calls.push('files'); return [{ key: 'SLOT2.DTA', value: bytes }]; },
        } },
    };
    const pending = captureSavedProgressCheckpoint(engine, entry);
    assert.deepEqual(calls, ['stop']);
    finishTick();
    const captured = await pending;
    assert.deepEqual(calls, ['stop', 'settled', 'global', 'files', 'resume']);
    assert.equal(captured.captureKind, 'persisted');
    assert.equal(captured.globals[0].value, '2');
    assert.equal(captured.filesystemEntries[0].key, 'SLOT2.DTA');
    assert.deepEqual([...new Uint8Array(captured.filesystemEntries[0].value)], [2, 5, 9]);
    assert.deepEqual(captured.saveData, saved);
    saved.current.slot = 3; new Uint8Array(bytes)[0] = 99;
    assert.equal(captured.saveData.current.slot, 2);
    assert.equal(new Uint8Array(captured.filesystemEntries[0].value)[0], 2);
    assert.equal(entry.globals[0].value, '0');
    assert.equal(entry.captureKind, undefined);
});

test('Persisted checkpoint capture preserves a paused player and resumes after storage errors', async () => {
    const { captureSavedProgressCheckpoint } = loadModule('engine/checkpoint.ts');
    for (const running of [false, true]) {
        let resumes = 0;
        const engine = { app: { ticker: { started: running, start: () => { resumes++; } } },
            stopForRestart: async () => {}, scopeManager: { scopes: [] }, saveFile: { toObject: () => ({}) },
            options: { storage: { snapshot: async () => { throw new Error('storage unavailable'); } } } };
        await assert.rejects(captureSavedProgressCheckpoint(engine, { globals: [] }), /storage unavailable/);
        assert.equal(resumes, running ? 1 : 0);
    }
});

test('Only restored Magicienii Cat hides boots already present in its selected inventory file', async () => {
    const { restoreMagicieniiSavedProgress } = loadModule('engine/patches/magicienii.ts');
    for (const profile of ['default', 'magicienii', 'ozn', 'nemo', 'timpului']) {
        for (const scene of ['CAT', 'ARCADE', 'MAGIC']) {
            for (const owned of [false, true]) {
                const calls = [];
                const inventory = { REMOVEALL() { calls.push('clear'); }, LOAD: async file => calls.push(file),
                    FIND: async (...args) => { assert.deepEqual(args, ['NAME', 'BUTY_BUT', 0]); return owned ? 2 : -1; } };
                const engine = { compat: createEngineCompat(profile), currentScene: { name: scene },
                    getObject: name => name === 'G_IGAMESLOT' ? { getValue: async () => 3 }
                        : name === 'DBITEMS' ? inventory : { HIDE() { calls.push('hide'); } },
                    resolvePath: async name => { assert.equal(name, '$COMMON\\ITEMS3.DTA'); return 'common/items3.dta'; },
                    filesystem: { hasFile: async file => { assert.equal(file, 'common/items3.dta'); return true; } } };
                await restoreMagicieniiSavedProgress(engine);
                assert.deepEqual(calls, profile === 'magicienii' && scene === 'CAT'
                    ? ['clear', '$COMMON\\ITEMS3.DTA', ...(owned ? ['hide'] : [])] : []);
                engine.filesystem.hasFile = async () => false; calls.length = 0;
                await restoreMagicieniiSavedProgress(engine); assert.deepEqual(calls, []);
            }
        }
    }
});

test('Only Nemo arcade and Magicienii Cat capture current progress; other checkpoints stay synchronous and scene changes reject capture', async () => {
    let finishCapture;
    const { Engine } = loadModule('engine/index.ts', {
        './scripting': {}, '../filesystem/definitionLoader': {}, 'pixi.js': {}, './types/scene': {},
        '../filesystem/assetsLoader': {}, './saveFile': {}, './debugging': {}, '../common/errors': { IgnorableError: Error },
        '@pixi/devtools': {}, './rendering': {}, '../index': {}, './scope': {}, './types/episode': {},
        './types': {}, './types/behaviour': {}, '../filesystem': {}, './audio': {}, './logging': {},
        '../fileFormats/logger': {}, './diagnostics': {}, './compat': {}, './patches/magicienii': {},
        './patches/nemo': {},
        './checkpoint': { captureSavedProgressCheckpoint: () => new Promise((resolve) => { finishCapture = resolve; }) },
    });
    for (const profile of ['default', 'magicienii', 'ozn', 'nemo', 'timpului']) {
        for (const scene of ['ARCADE', 'CAT', 'LABIRYNT', 'MAGIC', 'CUTSCENKI']) {
            const entry = { version: 1, scene, globals: [], filesystemEntries: [] };
            const engine = { compat: createEngineCompat(profile), entryCheckpoint: entry, changingScene: false };
            const captured = Engine.prototype.captureCheckpoint.call(engine);
            if ((profile === 'nemo' && scene === 'ARCADE') || (profile === 'magicienii' && scene === 'CAT')) {
                assert.ok(captured instanceof Promise);
                engine.entryCheckpoint = { ...entry };
                finishCapture(entry);
                await assert.rejects(captured, /scene changed/);
            } else {
                assert.ok(!(captured instanceof Promise));
                assert.deepEqual(captured, entry);
                assert.notEqual(captured, entry);
            }
        }
    }
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
