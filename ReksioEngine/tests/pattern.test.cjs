const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const pixi = require('pixi.js');

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
    function actor(name, pixels = [0, 1, 2, 255]) {
        const texture = new pixi.Texture(new pixi.BaseTexture(null, { width: 2, height: 2 }));
        const sprite = new AdvancedSprite(texture);
        sprite.hitmap = Uint8Array.from(pixels);
        sprite.position.set(-800, -1200);
        const object = { name, getRenderObject: () => sprite };
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
