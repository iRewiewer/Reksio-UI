const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '../src');
const cache = new Map();
const overrides = new Map();
const errors = [];
let scriptTransformer;
const quiet = { debug() {}, warn() {}, info() {}, error(message, context, error) {
    errors.push(message?.text ?? message);
    console.error(message?.text ?? message, error?.stack ?? error ?? '');
} };
let Callbacks;
// Load the real script runtime without the browser renderer's circular initialization.
overrides.set('engine/components/callbacks.ts', { CallbacksComponent: class {
    constructor(...args) { return new Callbacks(...args); }
} });
overrides.set('engine/types/class.ts', { ClassInstance: class {} });
overrides.set('filesystem/definitionLoader.ts', {});
overrides.set('engine/audio.ts', {});

function load(name, bypass = false) {
    name = name.replaceAll('\\', '/');
    if (!bypass && overrides.has(name)) return overrides.get(name);
    if (cache.has(name)) return cache.get(name).exports;
    const filename = path.join(root, name);
    const module = { exports: {} };
    cache.set(name, module);
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        transformers: scriptTransformer ? { before: [scriptTransformer] } : undefined,
    }).outputText;
    new Function('require', 'module', 'exports', code)((request) => {
        if (!request.startsWith('.')) return require(require.resolve(request, { paths: [path.dirname(root)] }));
        let resolved = path.resolve(path.dirname(filename), request);
        resolved = fs.existsSync(`${resolved}.ts`) ? `${resolved}.ts` : path.join(resolved, 'index.ts');
        return load(path.relative(root, resolved));
    }, module, module.exports);
    return module.exports;
}

scriptTransformer = load('../transformers.ts').typeGuard({});
const { Type } = load('engine/types/index.ts');
const logging = load('engine/logging.ts');
Object.assign(logging.logger, quiet);
load('interpreter/stacktrace.ts').printStackTrace = () => {};
const { createEngineCompat } = load('engine/compat.ts');
const { ScopeManager } = load('engine/scope.ts');
const { ScriptingManager } = load('engine/scripting.ts');
Callbacks = load('engine/components/callbacks.ts', true).CallbacksComponent;
const { parseCNV, decryptCNV } = load('fileFormats/cnv/index.ts');
const { patchMagicieniiSource } = load('engine/patches/magicienii.ts');
const { Interpreter, RuntimeContext } = load('interpreter/interpreter.ts');
const { loadAnn } = load('fileFormats/ann/index.ts');
const { Animo } = load('engine/types/animo.ts');
const { Mouse } = load('engine/types/mouse.ts');
const { Group } = load('engine/types/group.ts');
const { Struct } = load('engine/types/struct.ts');
const { World } = load('engine/types/world.ts');
const { Pattern } = load('engine/types/pattern.ts');
const { CanvasObserver } = load('engine/types/canvasObserver.ts');
const { Container, Rectangle, Texture, BaseTexture } = require('pixi.js');
const constructors = Object.fromEntries([
    ['INTEGER', 'integer', 'Integer'], ['DOUBLE', 'double', 'Double'], ['STRING', 'string', 'String'],
    ['BOOL', 'bool', 'Bool'], ['ARRAY', 'array', 'ArrayObject'], ['BEHAVIOUR', 'behaviour', 'Behaviour'],
].map(([type, file, exported]) => [type, load(`engine/types/${file}.ts`)[exported]]));
if (!process.argv[2]) {
    console.error('Usage: node tests/verify-magicienii.cjs <extracted game files directory>');
    process.exit(1);
}
const assets = path.resolve(process.argv[2]);
function bytes(filename) {
    const b = fs.readFileSync(filename);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

async function createFixture() {
    const defs = parseCNV(patchMagicieniiSource('dane/game/przygoda/magic/magic.cnv', decryptCNV(
        bytes(path.join(assets, 'Dane/Game/Przygoda/Magic/Magic.cnv')))));
    const scopeManager = new ScopeManager();
    const scope = scopeManager.newScope('scene');
    const audio = [];
    const engine = {
        compat: createEngineCompat('magicienii'), scopeManager, speed: 1,
        saveFile: { loadValue: () => null, saveValue() {} },
        diagnostics: new Proxy({}, { get: () => () => {} }),
        app: { stage: new Container(), screen: new Rectangle(0, 0, 800, 600) },
        getObject: (name) => scopeManager.findByName(name?.objectName ?? name),
        rendering: { addToStage() {}, removeFromStage() {}, putAtZindex() {}, sortObjects() {} },
    };
    engine.scripting = new ScriptingManager(engine);
    const parent = { name: 'MAGIC', scope };
    // Audio completion and target hits are driven explicitly; no browser UI is exercised.
    class Media extends Type {
        event = 'IDLE'; playing = false;
        async PLAY(event = 'PLAY') {
            this.event = event; this.playing = true;
            if (this.definition.TYPE === 'SOUND') audio.push(this.name);
            await this.callbacks.run('ONSTARTED', event);
        }
        STOP() { this.playing = false; }
        ISPLAYING() { return this.playing; }
        GETEVENTNAME() { return this.event; }
        GETGRAPHICSAT(x, y, visible, minZ) { return minZ === 10 ? 'ANNBODY1' : null; }
        SETPOSITION() {} SHOW() {} HIDE() {} SETFRAME() {} NPLAY() {}
        GETPOSITIONX() { return 0; } GETPOSITIONY() { return 0; }
        SETFPS() {} ENABLE() {} DISABLE() {} SETPOSITIONNOCALL() {}
        TOP() {} MOVE() {}
    }
    for (const def of Object.values(defs)) {
        const Constructor = def.TYPE === 'MOUSE' ? Mouse : def.TYPE === 'GROUP' ? Group : constructors[def.TYPE] ?? Media;
        scope.set(def.NAME, new Constructor(engine, parent, def));
    }
    const wand = new Animo(engine, parent, defs.ANNWAND0);
    wand.annFile = loadAnn(bytes(path.join(assets, 'Dane/Game/Przygoda/Magic/rex_rozdzka.ann')));
    await wand.initSprite();
    scope.set(wand.name, wand);
    for (let index = 0; index < 100; index++) {
        scope.set(`ANNSPELL_${index}`, new Media(engine, parent, { TYPE: 'ANIMO', NAME: `ANNSPELL_${index}` }));
        scope.set(`ANNMAGIC_${index}`, new Media(engine, parent, { TYPE: 'ANIMO', NAME: `ANNMAGIC_${index}` }));
    }
    scope.set('G_CURSOR', new Media(engine, parent, { TYPE: 'GROUP', NAME: 'G_CURSOR' }));
    const fighter = new Struct(engine, parent, defs.SFIGHTER);
    for (const [name, number] of [['TYPE', 0], ['TIME', 2]]) {
        fighter.content.set(name, new constructors.INTEGER(engine, parent, { TYPE: 'INTEGER', NAME: name, VALUE: number }));
    }
    scope.set('SFIGHTER', fighter);
    const get = (name) => engine.getObject(name);
    const value = (name) => get(name).value;
    const set = async (name, data) => {
        get(name).restoreCheckpointValue(data);
    };
    const initAst = load('interpreter/parser.ts').parseCode(defs.__INIT__.CODE.code);
    const patterns = initAst.filter((entry) => entry.type === 'FunctionCall' &&
        entry.target?.type === 'ObjectTarget' && /^(ARRPATTERN\d+|ARRENEMYPARTS)$/.test(entry.target.ref.name));
    await new Interpreter(new RuntimeContext(engine, null, defs.__INIT__.CODE.code)).execute(patterns);
    for (const [name, data] of Object.entries({
        ARRACTIVESPELLS: [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0], ARRSPEEDFACTOR: [1, 1],
        ARRJUMP: [0, 0], ARRREXDIR: [0, 0], ARRSPELLTYPE: [-1, -1], ARRTIMEELAPSED: [0, 0],
        ARRENERGIZETIME: [2, 2], ARREFFECTLEVEL0: [0, 0, 0, 0, 0, 0], ARREFFECTLEVEL1: [0, 0, 0, 0, 0, 0],
        ARRDEFENSE: [-1, -1], ARRIDLENAME: ['IDLE', 'IDLE'], ARREFFECTELAPSED0: [0, 0], ARREFFECTELAPSED1: [0, 0],
        VARITUTORIAL: 3, VARINUMREXSPELLS: 1, VARICURSORX: 400, VARICURSORY: 300,
        VARIDEFTOPRACTICE: -1,
    })) await set(name, data);
    get('STL10').playing = false;
    return { get, value, set, wand, audio };
}

async function createArcadeFixture(scene, folder, filename) {
    const directory = path.join(assets, 'Dane/Game/Przygoda', folder);
    const defs = parseCNV(decryptCNV(bytes(path.join(directory, filename))));
    const scopeManager = new ScopeManager();
    const scope = scopeManager.newScope('scene');
    const engine = {
        compat: createEngineCompat('magicienii'), scopeManager, speed: 1,
        saveFile: { loadValue: () => null, saveValue() {} },
        diagnostics: new Proxy({}, { get: () => () => {} }),
        app: { stage: new Container(), screen: new Rectangle(0, 0, 800, 600) },
        rendering: { addToStage() {}, removeFromStage() {}, putAtZindex() {}, sortObjects() {} },
        getObject: (name) => scopeManager.findByName(name?.objectName ?? name),
        currentScene: { name: scene, getRelativePath: async (name) => path.join(directory, name) },
        filesystem: { getFile: async (name) => bytes(name) },
    };
    engine.scripting = new ScriptingManager(engine);
    const parent = { name: scene, scope };
    // Empty collision masks isolate original movement scripts from rendering and level obstacles.
    class Media extends Type {
        x = 0; y = 0; event = 'PLAY'; playing = false;
        SETPOSITION(x, y) { this.x = Math.floor(x); this.y = Math.floor(y); }
        MOVE(x, y) { this.x += Math.floor(x); this.y += Math.floor(y); }
        GETCENTERX() { return this.x; } GETCENTERY() { return this.y; }
        GETEVENTNAME() { return this.event; } GETCFRAMEINEVENT() { return 0; }
        PLAY(event = 'PLAY') { this.event = String(event); this.playing = true; }
        STOP() { this.playing = false; } ISPLAYING() { return this.playing; }
        GETGRAPHICSAT() { return 'UNKNOWN'; }
        ISKEYDOWN() { return false; }
        SETANCHOR() {} SETFRAME() {}
        SHOW() {} HIDE() {}
    }
    for (const def of Object.values(defs)) {
        const Constructor = def.TYPE === 'WORLD' ? World : def.TYPE === 'GROUP' ? Group :
            def.TYPE === 'PATTERN' ? Pattern : def.TYPE === 'CANVAS_OBSERVER' ? CanvasObserver : constructors[def.TYPE] ?? Media;
        scope.set(def.NAME, new Constructor(engine, parent, def));
    }
    const addMedia = (name) => {
        scope.set(name, new Media(engine, parent, { TYPE: 'ANIMO', NAME: name }));
    };
    const get = (name) => engine.getObject(name);
    const world = get('WORLD');
    await world.init();
    return { engine, parent, scope, directory, defs, world, get, addMedia };
}

async function verifyBroomPhysics() {
    const { world, get, addMedia } = await createArcadeFixture('MIOTLY', 'miotly', 'Miotly.cnv');
    for (let index = 1; index <= 10; index++) addMedia(`ANNKURZ_${index}`);
    try {
        await get('VARENERGIA').SET(200);
        await get('BEHINITWORLD').RUN();
        assert.deepEqual(get('ARRAYID').value, [199, 207, 200, 201, 202, 203, 204, 205, 206]);
        assert.equal(world.GETPOSITIONX(199), 380);
        assert.equal(world.GETPOSITIONY(199), 300);
        await get('VARREXANGLE').SET(0);
        for (let tick = 0; tick < 120; tick++) {
            world.tick(16);
            await get('BEHMOVEWORLD').RUN();
        }
        assert.ok(world.GETPOSITIONY(199) < 0, 'Original upward thrust must move the physical body');
        assert.equal(get('ANNREX').y, 300, 'Original scrolling must keep the hero at screen Y=300');
        assert.ok(world.GETPOSITIONY(207) < 200, 'The joined companion must follow the hero');
        assert.equal(get('VARENERGIA').value, 200, 'Empty masks must not cause false collision damage');
        assert.ok(get('VARELAPSED').value > 0);
        for (const id of get('ARRAYID').value) {
            assert.ok(Number.isFinite(world.GETPOSITIONX(id)) && Number.isFinite(world.GETPOSITIONY(id)));
        }
        const top = world.GETPOSITIONY(199);
        await get('VARREXANGLE').SET(16);
        for (let tick = 0; tick < 240; tick++) {
            world.tick(16);
            await get('BEHMOVEWORLD').RUN();
        }
        assert.ok(world.GETPOSITIONY(199) > top + 100, 'Changing the original angle must reverse vertical travel');
        assert.equal(get('ANNREX').y, 300);
        console.log('BROOM: original initialization, nine joined bodies, thrust reversal and script-owned scrolling passed');
    } finally {
        world.destroy();
    }
}

async function verifyDragonControls() {
    const { engine, parent, scope, directory, defs, world, get, addMedia } =
        await createArcadeFixture('DRAGON', 'Dragon', 'Dragon.cnv');
    const wings = new Animo(engine, parent, defs.ANNSKRZYDLA);
    wings.annFile = loadAnn(bytes(path.join(directory, 'SKRZYDLA.ANN')));
    await wings.initSprite();
    scope.set(wings.name, wings);
    for (const name of ['IMGBKGA_1', 'IMGBKGA_2', 'IMGBKGB_1', 'IMGBKGB_2']) addMedia(name);
    try {
        // Exercise original physics/control initialization without loading the map or projectile clones.
        const source = defs.BEHINITLEVEL.CODE.code;
        const statements = load('interpreter/parser.ts').parseCode(source).filter((entry) =>
            entry.type === 'FunctionCall' && entry.target?.type === 'ObjectTarget' &&
            ['WORLD', 'ARRAYFORCE', 'VARDIR', 'VARPOSY', 'VARENERGY', 'GRDRAGON', 'GRBKG', 'ANNSKRZYDLA']
                .includes(entry.target.ref.name));
        await new Interpreter(new RuntimeContext(engine, null, source)).execute(statements);
        get('ARRAYBKG').ADD(0, 800, 1600, 2400);
        get('ARRAYBKGA').ADD(0, 1600); get('ARRAYBKGB').ADD(0, 2000);
        let reverseObserved = false, liftObserved = false, minimumY = 200;
        for (let tick = 0; tick < 120; tick++) {
            const previous = wings.GETCFRAMEINEVENT(), direction = get('VARDIR').value;
            await wings.tick(16);
            if (direction === 'B' && get('VARDIR').value === 'B' && wings.GETCFRAMEINEVENT() < previous) {
                reverseObserved = true;
            }
            if (get('VARFORCEY').value > 0) liftObserved = true;
            world.tick(16);
            await get('BEHMOVEWORLD').RUN();
            minimumY = Math.min(minimumY, world.GETPOSITIONY(100));
        }
        assert.ok(reverseObserved, 'Original completion callback must play the wing stroke backward');
        assert.ok(liftObserved, 'Original wing callbacks must supply upward thrust');
        assert.ok(world.GETPOSITIONX(100) < 380);
        assert.ok(minimumY < 200, `The wing stroke must lift the body; minimum Y was ${minimumY}`);
        assert.ok(get('VARPOSX').value > 0);
        assert.ok(get('ARRAYBKG').value[0] < 0 && get('ARRAYBKGB').value[0] < 0);
        console.log('DRAGON: original wing callbacks, reverse strokes, lift, WORLD movement and array scrolling passed');
    } finally {
        world.destroy(); wings.destroy();
    }
}

async function verifyDragonPattern() {
    const { engine, parent, scope, directory, defs, world, get } =
        await createArcadeFixture('DRAGON', 'Dragon', 'Dragon.cnv');
    // PIXI mask geometry is real; its white texture is buffer-backed because no browser renderer runs here.
    Texture._WHITE = new Texture(BaseTexture.fromBuffer(new Uint8Array([255, 255, 255, 255]), 1, 1));
    const fire = new Animo(engine, parent, defs.ANNFIRE);
    fire.annFile = loadAnn(bytes(path.join(directory, defs.ANNFIRE.FILENAME)));
    await fire.initSprite();
    scope.set(fire.name, fire);
    const pattern = get('PATTERNFIRE');
    await pattern.applyDefaults();
    try {
        await fire.PLAY('A7'); await fire.MOVE(0, -1200);
        fire.SETCLIPPING(0, 0, 800, 500);
        pattern.ADD('fire', 2, 2, fire.name, 0);
        const tile = pattern.getRenderObject().children[0], source = fire.getRenderObject();
        const event = fire.annFile.events.find(event => event.name === 'A7');
        for (let frame = 0; frame < event.framesCount; frame++) {
            await fire.SETFRAME('A7', frame);
            pattern.tick();
            const image = fire.annFile.annImages[event.framesImageMapping[frame]];
            assert.equal(tile.x, 200 + image.positionX + event.frames[frame].positionX);
            assert.equal(tile.y, 200 + image.positionY + event.frames[frame].positionY);
            assert.ok(source.y < -1000, 'Placing a map copy must not move its offscreen source');
            const pixel = source.hitmap.findIndex(alpha => alpha > 0);
            assert.ok(pixel >= 0);
            assert.equal(pattern.GETGRAPHICSAT(tile.x + pixel % image.width + 0.5,
                tile.y + Math.floor(pixel / image.width) + 0.5, false, false, 0), fire.name);
        }
        fire.SETCLIPPING(5, 5, 10, 10); pattern.tick();
        assert.equal(pattern.GETGRAPHICSAT(tile.x + 6, tile.y + 6, false, true, 0), fire.name);
        assert.equal(pattern.GETGRAPHICSAT(tile.x + 1, tile.y + 1, false, true, 0), 'UNKNOWN');
        const clone = await fire.clone();
        assert.notEqual(clone.getRenderObject().mask, source.mask);
        assert.deepEqual(clone.getRenderObject().getClippingRect(), source.getClippingRect());
        clone.destroy();
        assert.equal(source.mask.destroyed, false);
        fire.SETCLIPPING(0, 0, 0, 0); pattern.tick();
        assert.equal(tile.mask, null);
        assert.equal(pattern.GETGRAPHICSAT(tile.x + 1, tile.y + 1, false, true, 0), fire.name);
        console.log('FIRE: six shipped animation frames retain offsets, opaque-pixel hits and independent clone/map clipping');
    } finally {
        pattern.destroy(); fire.destroy(); world.destroy();
    }
}

async function verifyDragonLevelInitialization() {
    let placements = 0;
    for (let level = 0; level < 5; level++) {
        const { engine, parent, scope, directory, defs, get } =
            await createArcadeFixture('DRAGON', 'Dragon', 'Dragon.cnv');
        try {
            for (const name of ['ANNLEVEL', 'ANNLEVELFIRE', 'ANNELEMENT', 'ANNFIRE', 'ANNSKRZYDLA']) {
                const filename = name === 'ANNLEVEL' ? `level${level}.ann` :
                    name === 'ANNLEVELFIRE' ? `levelfire${level}.ann` : defs[name].FILENAME;
                const actor = new Animo(engine, parent, defs[name]);
                actor.annFile = loadAnn(bytes(path.join(directory, filename)));
                await actor.initSprite();
                scope.set(name, actor);
            }
            await get('BEHINITLEVEL').RUN();
            for (const [name, layout] of [['PATTERNBKG', 'ANNLEVEL'], ['PATTERNFIRE', 'ANNLEVELFIRE']]) {
                const pattern = get(name), tiles = pattern.getRenderObject().children;
                const animation = get(layout).annFile, event = animation.events[0];
                const cells = new Set(event.frames.map((frame, index) => {
                    const image = animation.annImages[event.framesImageMapping[index]];
                    return [Math.floor(Math.round(image.positionX + frame.positionX + image.width / 2) / 10),
                        Math.floor(Math.round(image.positionY + frame.positionY + image.height / 2) / 10)].join(',');
                }));
                assert.equal(tiles.length, cells.size, `Dragon ${level} ${name} occupied cells`);
                const template = get(name === 'PATTERNBKG' ? 'ANNELEMENT' : 'ANNFIRE');
                assert.equal(template.clones.length, event.framesCount, `Dragon ${level} ${name} source clones`);
                placements += event.framesCount;
                let sampled = false;
                for (const tile of tiles) {
                    if (name === 'PATTERNFIRE') assert.ok(tile.mask, 'Every original fire clone must retain its clip');
                    const index = tile.hitmap.findIndex(alpha => alpha > 0);
                    if (index < 0 || sampled) continue;
                    const x = tile.x + index % tile.texture.orig.width + 0.5;
                    const y = tile.y + Math.floor(index / tile.texture.orig.width) + 0.5;
                    if (!tile.getClippingRect() || tile.getClippingRect().contains(x - tile.x, y - tile.y)) {
                        assert.notEqual(pattern.GETGRAPHICSAT(x, y, false, false, 0), 'UNKNOWN');
                        sampled = true;
                    }
                }
                assert.ok(sampled, `Dragon ${level} ${name} must have a queryable opaque tile`);
            }
            assert.equal(get('ARRAYAMMODX').GETSIZE(), 100);
            assert.equal(get('ARRAYWODADX').GETSIZE(), 100);
        } finally {
            assert.deepEqual(engine.scopeManager.destroy(), [], `Dragon ${level} cleanup must release scene objects`);
        }
    }
    console.log(`DRAGON MAPS: all five original level initialization routines passed; ${placements} tile/fire placements`);
}

async function main() {
    const { get, value, set, wand, audio } = await createFixture();
    const mouse = get('MOUSE');
    const pointer = (x, y) => ({ screen: { x, y }, button: 0 });
    mouse.SETPOSITION(400, 300);
    mouse.onMouseMove(pointer(600, 150));
    await mouse.tick(16);
    mouse.handleClickEvent(pointer(600, 150), 'click');
    await mouse.tick(16);
    for (const [x, y] of [[500, 150], [500, 230], [600, 230], [600, 310], [500, 310]]) {
        mouse.onMouseMove(pointer(x, y));
        await mouse.tick(16);
    }
    console.log('DRAW', { angles: value('ARRANGLES'), route: value('ARRROUTEX'), phase: value('VARITUTORIAL') });
    mouse.handleClickEvent(pointer(500, 310), 'release');
    await mouse.tick(16);
    console.log('RECOGNIZE', { spell: value('ARRSPELLTYPE'), ready: value('VARISPELLREADY'),
        wand: wand.GETEVENTNAME(), audio });
    assert.equal(value('ARRSPELLTYPE')[0], 3);
    assert.equal(value('VARISPELLREADY'), 1);
    for (let count = 0; count < 10 && value('VARISPELLREADY') !== 2; count++) await wand.tick(70);
    console.log('CHARGE', { ready: value('VARISPELLREADY'), wand: wand.GETEVENTNAME() });
    assert.equal(value('VARISPELLREADY'), 2);
    await get('SNDTUT7').callbacks.run('ONFINISHED');
    mouse.lastClicksTime = {};
    mouse.handleClickEvent(pointer(500, 310), 'click');
    await mouse.tick(16);
    console.log('CAST', { ready: value('VARISPELLREADY'), wand: wand.GETEVENTNAME(),
        effects: value('ARREFFECTLEVEL1'), speed: value('ARRSPEEDFACTOR'), repeats: value('VARITUTREPEAT') });
    assert.equal(value('ARREFFECTLEVEL1')[3], 1);
    assert.equal(value('ARRSPEEDFACTOR')[1], 2);
    assert.equal(wand.GETEVENTNAME(), 'STRZAL');
    for (let count = 0; count < 20 && wand.GETEVENTNAME() === 'STRZAL'; count++) await wand.tick(70);
    assert.equal(wand.GETEVENTNAME(), 'IDLE');
    assert.equal(value('VARIDOMAGIC'), 0);
    assert.equal(value('VARISPELLREADY'), 0);
    for (let round = 2; round <= 3; round++) {
        if (get('SNDTUT8').playing) {
            get('SNDTUT8').STOP(); await get('SNDTUT8').callbacks.run('ONFINISHED');
        }
        mouse.onMouseMove(pointer(600, 150)); await mouse.tick(16);
        mouse.lastClicksTime = {};
        mouse.handleClickEvent(pointer(600, 150), 'click'); await mouse.tick(16);
        for (const [x, y] of [[500, 150], [500, 230], [600, 230], [600, 310], [500, 310]]) {
            mouse.onMouseMove(pointer(x, y)); await mouse.tick(16);
        }
        mouse.handleClickEvent(pointer(500, 310), 'release'); await mouse.tick(16);
        assert.equal(value('ARRSPELLTYPE')[0], 3);
        for (let count = 0; count < 10 && value('VARISPELLREADY') !== 2; count++) await wand.tick(70);
        assert.equal(value('VARISPELLREADY'), 2);
        mouse.lastClicksTime = {};
        mouse.handleClickEvent(pointer(500, 310), 'click'); await mouse.tick(16);
        assert.equal(value('ARREFFECTLEVEL1')[3], round);
        for (let count = 0; count < 20 && wand.GETEVENTNAME() === 'STRZAL'; count++) await wand.tick(70);
    }
    assert.equal(value('VARIWINNER'), 1);
    for (let tick = 0; tick < 5; tick++) await get('STL10').callbacks.run('ONFRAMECHANGED', 'ELAPSE');
    assert.equal(audio.at(-1), 'SNDTUT9');
    await get('SNDTUT9').callbacks.run('ONFINISHED');
    assert.equal(audio.at(-1), 'SNDTUT10');
    assert.equal(value('VARBLEARNED'), true);
    await get('SNDTUT10').callbacks.run('ONFINISHED');
    assert.equal(value('VARIWINNER'), -1);
    assert.deepEqual(value('ARREFFECTLEVEL1'), [0, 0, 0, 0, 0, 0]);
    assert.equal(audio.at(-1), 'SNDTUT11');
    await get('SNDTUT11').callbacks.run('ONFINISHED');
    assert.equal(value('VARITUTORIAL'), 5);
    console.log('LESSON: three casts, target defeat, completion voice callbacks, learned flag and effect reset passed');
    for (let spell = 0; spell < 12; spell++) {
        for (const rotation of [0, 25, 50]) {
            const fixture = await createFixture();
            const { get, value, set, wand } = fixture;
            const active = Array(12).fill(0); active[spell] = 1;
            await set('ARRACTIVESPELLS', active);
            await set('VARITUTORIAL', spell < 6 ? 6 : 2);
            await set('VARIDEFTOPRACTICE', spell < 6 ? -1 : spell);
            const mouse = get('MOUSE');
            let x = 400, y = 300;
            mouse.SETPOSITION(400, 300);
            mouse.onMouseMove(pointer(x, y)); await mouse.tick(16);
            mouse.handleClickEvent(pointer(x, y), 'click'); await mouse.tick(16);
            for (const angle of value(`ARRPATTERN${spell}`)) {
                x += Math.round(60 * Math.cos((angle + rotation) * Math.PI / 180));
                y += Math.round(60 * Math.sin((angle + rotation) * Math.PI / 180));
                mouse.onMouseMove(pointer(x, y)); await mouse.tick(16);
            }
            mouse.handleClickEvent(pointer(x, y), 'release'); await mouse.tick(16);
            assert.equal(value('ARRSPELLTYPE')[0], rotation < 35.5 ? spell : -1,
                `spell ${spell}, rotation ${rotation}, angles ${value('ARRANGLES')}`);
            if (spell < 6) assert.equal(value('VARISPELLREADY'), rotation < 35.5 ? 1 : 0);
        }
    }
    console.log('PATTERNS: all 12 exact and rotated shapes recognized; all 12 out-of-tolerance shapes rejected');
    await verifyBroomPhysics();
    await verifyDragonControls();
    await verifyDragonPattern();
    await verifyDragonLevelInitialization();
    assert.deepEqual(errors, [], 'The original scripts must not call unsupported methods');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
