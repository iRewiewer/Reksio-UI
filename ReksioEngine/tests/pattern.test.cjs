const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const pixi = require('pixi.js');
// Geometry tests use a buffer texture instead of the browser canvas used by Texture.WHITE.
pixi.Texture._WHITE = new pixi.Texture(pixi.BaseTexture.fromBuffer(new Uint8Array([255, 255, 255, 255]), 1, 1));

function load(file, dependencies = {}, before) {
    const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        transformers: before ? { before: [before] } : undefined,
    }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)(name => {
        assert.ok(Object.hasOwn(dependencies, name), `Unmocked dependency ${name}`);
        return dependencies[name];
    }, module, module.exports);
    return module.exports;
}

const { createEngineCompat } = load('engine/compat.ts');
class Display {
    constructor(engine, parent, definition) {
        Object.assign(this, { engine, parent, definition, name: definition.NAME });
        this.callbacks = { run: async () => {} };
    }
    getObject(name) { return this.engine.getObject(name); }
    SETPRIORITY(value) { this.getRenderObject().zIndex = value; }
}
const { AdvancedSprite } = load('engine/rendering.ts', {
    'pixi.js': pixi, '../common/errors': { assert: assert.ok }, './types': { DisplayType: Display },
});
const { Pattern } = load('engine/types/pattern.ts', {
    'pixi.js': pixi, './index': { DisplayType: Display }, '../rendering': { AdvancedSprite },
    '../../common/errors': { assert: assert.ok }, '../../common/types': { method: () => method => method },
});
const definition = { NAME: 'MAP', TYPE: 'PATTERN', WIDTH: 800, HEIGHT: 24000,
    GRIDX: 100, GRIDY: 100, LAYERS: 2, VISIBLE: true, TOCANVAS: true, PRIORITY: 7 };

async function fixture(overrides = {}) {
    const stage = new pixi.Container(), actors = new Map();
    const engine = { compat: createEngineCompat('magicienii'), getObject: name => actors.get(name) ?? null,
        rendering: { addToStage: sprite => stage.addChild(sprite),
            removeFromStage: sprite => stage.removeChild(sprite) } };
    const pattern = new Pattern(engine, null, { ...definition, ...overrides });
    await pattern.applyDefaults();
    function actor(name, pixels = [0, 1, 2, 255], offset = { x: 0, y: 0 }) {
        const texture = new pixi.Texture(new pixi.BaseTexture(null, { width: 2, height: 2 }));
        const sprite = new AdvancedSprite(texture);
        sprite.hitmap = Uint8Array.from(pixels);
        sprite.position.set(-800, -1200);
        const object = { name, getRenderObject: () => sprite, getPatternPositionOffset: () => offset };
        actors.set(name, object);
        return sprite;
    }
    return { pattern, actor, stage, actors, engine };
}

test('Magicienii PATTERN uses cell coordinates without moving offscreen source actors', async () => {
    const { pattern, actor, stage } = await fixture();
    const source = actor('TREE');
    pattern.ADD('TREE_ALIAS', 2, 200, 'TREE', 0);
    const root = pattern.getRenderObject(), tile = root.children[0];
    assert.equal(stage.children[0], root);
    assert.equal(root.zIndex, 7);
    assert.deepEqual([tile.x, tile.y], [200, 20000]);
    assert.deepEqual([source.x, source.y], [-800, -1200]);
    assert.equal(tile.texture, source.texture);
    assert.equal(pattern.GETGRAPHICSAT(201.5, 20001.5, false, false, 0), 'TREE');
    assert.equal(pattern.GETGRAPHICSAT(-799, -1199, false, true, 0), 'UNKNOWN');
    pattern.MOVE(0, -19900);
    assert.equal(pattern.GETPOSITIONY(), -19900);
    assert.equal(pattern.GETGRAPHICSAT(201.5, 101.5, false, false, 0), 'TREE');
    pattern.SETPOSITION(-100, -19900);
    assert.equal(pattern.GETPOSITIONX(), -100);
    assert.equal(pattern.GETGRAPHICSAT(101.5, 101.5, false, false, 0), 'TREE');
    assert.deepEqual([source.x, source.y], [-800, -1200]);
});

test('PATTERN tests hidden masks only when requested and honors strict alpha thresholds', async () => {
    const { pattern, actor } = await fixture({ LAYERS: 0 });
    const mask = actor('MASK');
    mask.visible = false;
    pattern.ADD('MASK_ALIAS', 1, 1, 'MASK', 0);
    assert.equal(pattern.getRenderObject().children[0].visible, false);
    assert.equal(pattern.GETGRAPHICSAT(101.5, 101.5, false, false, 0), 'UNKNOWN');
    assert.equal(pattern.GETGRAPHICSAT(101.5, 101.5, true, false, 0), 'MASK');
    assert.equal(pattern.GETGRAPHICSAT(100.5, 100.5, true, false, 0), 'UNKNOWN');
    assert.equal(pattern.GETGRAPHICSAT(100.5, 100.5, true, true, 0), 'MASK');
    assert.equal(pattern.GETGRAPHICSAT(101.5, 100.5, true, false, 0, 1), 'UNKNOWN');
    assert.equal(pattern.GETGRAPHICSAT(100.5, 101.5, true, false, 0, 1), 'MASK');
    assert.equal(pattern.GETGRAPHICSAT(102, 100.5, true, true, 0), 'UNKNOWN');
    assert.equal(mask.visible, false);
});

test('PATTERN native layer queries descend from the last layer and otherwise select one layer', async () => {
    const { pattern, actor } = await fixture({ LAYERS: 3 });
    actor('BASE', [255, 255, 255, 255]); actor('MIDDLE', [255, 255, 255, 255]);
    actor('TOP', [255, 255, 255, 255]);
    pattern.ADD('base', 0, 0, 'BASE', 0);
    pattern.ADD('middle', 0, 0, 'MIDDLE', 1);
    assert.equal(pattern.GETGRAPHICSAT(1, 1, false, true), 'MIDDLE');
    assert.equal(pattern.GETGRAPHICSAT(1, 1, false, true, 2), 'MIDDLE');
    assert.equal(pattern.GETGRAPHICSAT(1, 1, false, true, 0), 'BASE');
    pattern.ADD('top', 0, 0, 'TOP', 2);
    assert.equal(pattern.GETGRAPHICSAT(1, 1, false, true), 'TOP');
    assert.equal(pattern.GETGRAPHICSAT(1, 1, false, true, 1), 'MIDDLE');
});

test('PATTERN refreshes animated frames, transforms and visibility while retaining source identity', async () => {
    const { pattern, actor } = await fixture();
    const source = actor('ANIMATED');
    pattern.ADD('animated', 1, 1, 'ANIMATED', 0);
    source.texture = new pixi.Texture(new pixi.BaseTexture(null, { width: 4, height: 4 }));
    source.hitmap = new Uint8Array(16).fill(255);
    source.anchor.set(0.5, 0.5); source.scale.set(2, 2); source.alpha = 0.5;
    source.rotation = Math.PI / 2;
    pattern.tick();
    const tile = pattern.getRenderObject().children[0];
    assert.equal(tile.texture, source.texture);
    assert.equal(tile.hitmap, source.hitmap);
    assert.equal(tile.alpha, 0.5);
    assert.equal(tile.rotation, Math.PI / 2);
    assert.equal(pattern.GETGRAPHICSAT(98, 98, false, false, 0), 'ANIMATED');
    source.visible = false;
    pattern.tick();
    assert.equal(tile.visible, false);
    assert.equal(pattern.GETGRAPHICSAT(98, 98, false, false, 0), 'UNKNOWN');
    assert.deepEqual([source.x, source.y], [-800, -1200]);
});

test('PATTERN preserves animation frame offsets independently of offscreen template translation', async () => {
    const { pattern, actor } = await fixture();
    const offset = { x: 40, y: -87 };
    const source = actor('FIRE', [255, 255, 255, 255], offset);
    pattern.ADD('fire', 2, 2, 'FIRE', 0);
    const tile = pattern.getRenderObject().children[0];
    assert.deepEqual([tile.x, tile.y], [240, 113]);
    assert.equal(pattern.GETGRAPHICSAT(241, 114, false, false, 0), 'FIRE');
    assert.equal(pattern.GETGRAPHICSAT(201, 201, false, true, 0), 'UNKNOWN');
    offset.x = 42; offset.y = -90;
    pattern.tick();
    assert.deepEqual([tile.x, tile.y], [242, 110]);
    assert.equal(pattern.GETGRAPHICSAT(243, 111, false, false, 0), 'FIRE');
    assert.deepEqual([source.x, source.y], [-800, -1200]);
});

test('Sprite clipping uses local image coordinates under scale, translation and anchor changes', () => {
    const sprite = new AdvancedSprite(new pixi.Texture(new pixi.BaseTexture(null, { width: 4, height: 4 })));
    sprite.hitmap = new Uint8Array(16).fill(255);
    sprite.anchor.set(0.5); sprite.scale.set(2); sprite.position.set(100, 80);
    const rect = new pixi.Rectangle(1, 1, 2, 2);
    sprite.setClippingRect(rect);
    const mask = sprite.mask;
    assert.ok(mask instanceof pixi.Graphics);
    const shape = mask.geometry.graphicsData[0].shape;
    assert.deepEqual([shape.x, shape.y, shape.width, shape.height], [-1, -1, 2, 2]);
    sprite.toGlobal(new pixi.Point());
    assert.equal(sprite.containsPoint(new pixi.Point(99, 79)), true);
    assert.equal(sprite.getAlphaAt(new pixi.Point(99, 79)), 255);
    assert.equal(sprite.containsPoint(new pixi.Point(97, 79)), false);
    assert.equal(sprite.getAlphaAt(new pixi.Point(97, 79)), 0);
    rect.x = 9;
    assert.equal(sprite.getClippingRect().x, 1, 'Caller rectangles must not mutate an existing clip');
    const dirty = mask.geometry.dirty;
    sprite.setClippingRect(new pixi.Rectangle(1, 1, 2, 2));
    assert.equal(mask.geometry.dirty, dirty, 'Unchanged frame clips must not rebuild graphics');
    sprite.texture = new pixi.Texture(new pixi.BaseTexture(null, { width: 8, height: 4 }));
    sprite.hitmap = new Uint8Array(32).fill(255);
    sprite.setClippingRect(new pixi.Rectangle(3, 1, 2, 2));
    assert.equal(sprite.getClippingRect().x, 3);
    assert.equal(mask.geometry.dirty, dirty, 'Equal geometry can retain a changed logical clip');
    sprite.setClippingRect(new pixi.Rectangle(1, 1, 2, 2));
    assert.equal(mask.geometry.graphicsData[0].shape.x, -3);
    sprite.destroy();
    assert.equal(mask.destroyed, true);
});

test('Zero-sized sprite clipping disables the mask and destroying a sprite releases only its mask', () => {
    const texture = new pixi.Texture(new pixi.BaseTexture(null, { width: 4, height: 4 }));
    const sprite = new AdvancedSprite(texture);
    sprite.hitmap = new Uint8Array(16).fill(255);
    sprite.setClippingRect(new pixi.Rectangle(1, 1, 2, 2));
    const first = sprite.mask;
    sprite.setClippingRect(new pixi.Rectangle(0, 0, 0, 4));
    assert.equal(sprite.getClippingRect(), null);
    assert.equal(sprite.mask, null);
    assert.equal(first.destroyed, true);
    sprite.toGlobal(new pixi.Point());
    assert.equal(sprite.getAlphaAt(new pixi.Point(0.5, 0.5)), 255);
    sprite.setClippingRect(new pixi.Rectangle(0, 0, -1, 4));
    assert.equal(sprite.containsPoint(new pixi.Point(0.5, 0.5)), false);
    sprite.setClippingRect(new pixi.Rectangle(1, 1, 2, 2));
    const second = sprite.mask;
    sprite.destroy();
    assert.equal(second.destroyed, true);
    assert.notEqual(texture.baseTexture, null);
    assert.equal(sprite.mask, null);
});

test('PIXI projects a moved local animation clip into the expected WebGL scissor rectangle', () => {
    const parent = new pixi.Container(); parent.position.set(20, -40);
    const sprite = new AdvancedSprite(new pixi.Texture(new pixi.BaseTexture(null, { width: 4, height: 4 })));
    parent.addChild(sprite);
    sprite.anchor.set(0.5); sprite.scale.set(2); sprite.position.set(100, 80);
    sprite.setClippingRect(new pixi.Rectangle(1, 1, 2, 2));
    sprite.mask.getBounds();
    const calls = [], scissor = Object.create(pixi.ScissorSystem.prototype);
    // Run PIXI's real scissor projection, recording commands instead of using a GPU context.
    scissor.renderer = { height: 600, resolution: 1, projection: { transform: null },
        filter: { transformAABB: pixi.FilterSystem.prototype.transformAABB },
        renderTexture: { current: null, sourceFrame: new pixi.Rectangle(0, 0, 800, 600),
            destinationFrame: new pixi.Rectangle(0, 0, 800, 600) },
        gl: { SCISSOR_TEST: 3089, enable: mode => calls.push(['enable', mode]),
            disable: mode => calls.push(['disable', mode]), scissor: (...args) => calls.push(['scissor', ...args]) } };
    scissor.maskStack = [];
    const data = new pixi.MaskData(sprite.mask);
    assert.equal(scissor.testScissor(data), true);
    scissor.maskStack.push(data); scissor.push(data);
    scissor.maskStack.pop(); scissor.pop(data);
    assert.deepEqual(calls, [['enable', 3089], ['scissor', 118, 558, 4, 4], ['disable', 3089]]);
    sprite.destroy(); parent.destroy();
});

test('PATTERN copies own independent clipping masks that follow scrolling and source changes', async () => {
    const { pattern, actor } = await fixture();
    const source = actor('FIRE', [255, 255, 255, 255]);
    source.texture = new pixi.Texture(new pixi.BaseTexture(null, { width: 4, height: 4 }));
    source.hitmap = new Uint8Array(16).fill(255);
    source.setClippingRect(new pixi.Rectangle(1, 1, 2, 2));
    pattern.ADD('first', 1, 1, 'FIRE', 0);
    pattern.ADD('second', 2, 1, 'FIRE', 0);
    const [first, second] = pattern.getRenderObject().children;
    assert.notEqual(first.mask, second.mask);
    assert.notEqual(first.mask, source.mask);
    assert.equal(pattern.GETGRAPHICSAT(101.5, 101.5, false, false, 0), 'FIRE');
    assert.equal(pattern.GETGRAPHICSAT(100.5, 100.5, false, true, 0), 'UNKNOWN');
    const mask = first.mask;
    source.setClippingRect(new pixi.Rectangle(0, 0, 1, 1));
    pattern.tick();
    assert.equal(first.mask, mask);
    assert.equal(pattern.GETGRAPHICSAT(100.5, 100.5, false, false, 0), 'FIRE');
    assert.equal(pattern.GETGRAPHICSAT(101.5, 101.5, false, true, 0), 'UNKNOWN');
    assert.equal(pattern.GETGRAPHICSAT(200.5, 100.5, false, false, 0), 'FIRE');
    pattern.MOVE(20, -40);
    assert.equal(pattern.GETGRAPHICSAT(120.5, 60.5, false, false, 0), 'FIRE');
    const bounds = first.mask.getBounds();
    assert.deepEqual([bounds.x, bounds.y, bounds.width, bounds.height], [120, 60, 1, 1]);
    const sourceMask = source.mask, secondMask = second.mask;
    pattern.REMOVE('first');
    assert.equal(mask.destroyed, true);
    assert.equal(sourceMask.destroyed, false);
    pattern.destroy();
    assert.equal(secondMask.destroyed, true);
    assert.equal(source.mask, sourceMask);
    source.destroy();
    assert.equal(sourceMask.destroyed, true);
});

test('PATTERN replaces occupied cells, removes aliases, and releases copies without shared textures', async () => {
    const { pattern, actor, stage } = await fixture();
    const old = actor('OLD'), next = actor('NEW');
    pattern.ADD('old', 1, 1, 'OLD', 0);
    const oldTile = pattern.getRenderObject().children[0];
    pattern.ADD('new', 1, 1, 'NEW', 0);
    assert.equal(oldTile.destroyed, true);
    assert.equal(pattern.getRenderObject().children.length, 1);
    assert.equal(pattern.GETGRAPHICSAT(101.5, 101.5, false, true, 0), 'NEW');
    pattern.REMOVE('new');
    assert.equal(pattern.GETGRAPHICSAT(101.5, 101.5, false, true, 0), 'UNKNOWN');
    pattern.ADD('new', 2, 2, 'NEW', 0);
    const texture = next.texture, base = next.texture.baseTexture;
    pattern.destroy();
    assert.equal(stage.children.length, 0);
    assert.equal(texture.baseTexture, base);
    assert.equal(next.texture, texture);
    assert.notEqual(old.texture.baseTexture, null);
});

test('PATTERN rejects invalid map entries and stays disabled for every other game', async () => {
    const { pattern, actor } = await fixture();
    actor('TREE');
    for (const args of [['outside', -1, 0, 'TREE', 0], ['outside', 8, 0, 'TREE', 0],
        ['outside', 0, 240, 'TREE', 0], ['layer', 0, 0, 'TREE', 2], ['missing', 0, 0, 'NONE', 0]]) {
        assert.throws(() => pattern.ADD(...args));
    }
    for (const profile of ['default', 'ozn', 'nemo', 'timpului']) {
        assert.equal(createEngineCompat(profile).patternMaps, false);
        assert.throws(() => new Pattern({ compat: createEngineCompat(profile) }, null, definition));
    }
});

test('PATTERN schema preserves grid, layers, rendering flags and callbacks from original CNV syntax', () => {
    const logger = { warn: message => assert.fail(message) };
    const common = load('fileFormats/common/index.ts', { '../logger': { logger } });
    const { structureDefinitions } = load('fileFormats/cnv/types.ts', { '../common': common });
    const { parseCNV } = load('fileFormats/cnv/parser.ts', {
        './types': { structureDefinitions }, '../common': common, '../logger': { logger },
    });
    const source = ['OBJECT=PATTERNBKG', 'PATTERNBKG:TYPE=PATTERN', 'PATTERNBKG:LAYERS=0',
        'PATTERNBKG:TOCANVAS=TRUE', 'PATTERNBKG:VISIBLE=TRUE', 'PATTERNBKG:PRIORITY=2',
        'PATTERNBKG:WIDTH=19200', 'PATTERNBKG:HEIGHT=600', 'PATTERNBKG:GRIDX=100', 'PATTERNBKG:GRIDY=100',
        'PATTERNBKG:ONINIT={INIT^RUN();}'].join('\n');
    const def = parseCNV(source).PATTERNBKG;
    assert.deepEqual([def.LAYERS, def.WIDTH, def.HEIGHT, def.GRIDX, def.GRIDY], [0, 19200, 600, 100, 100]);
    assert.equal(def.VISIBLE, true); assert.equal(def.TOCANVAS, true); assert.equal(def.PRIORITY, 2);
    assert.equal(def.ONINIT.code, 'INIT^RUN();');
});

test('Built PATTERN methods retain optional layer and alpha arguments in script type guards', () => {
    const { typeGuard } = load('../transformers.ts', { typescript: ts });
    const parameters = {};
    load('engine/types/pattern.ts', {
        'pixi.js': pixi, './index': { DisplayType: Display }, '../rendering': { AdvancedSprite },
        '../../common/errors': { assert: assert.ok },
        '../../common/types': { method: (...types) => (original, context) => {
            parameters[context.name] = types;
            return original;
        } },
    }, typeGuard({}));
    assert.equal(parameters.ADD.length, 6);
    assert.equal(parameters.GETGRAPHICSAT.length, 6);
    for (const parameter of parameters.GETGRAPHICSAT.slice(4)) {
        assert.equal(parameter.optional, true);
        assert.equal(parameter.types[0].name, 'number');
    }
});
