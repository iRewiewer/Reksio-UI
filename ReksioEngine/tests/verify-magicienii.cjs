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
const { patchMagicieniiSource, restoreMagicieniiSavedProgress } = load('engine/patches/magicienii.ts');
const { Interpreter, RuntimeContext } = load('interpreter/interpreter.ts');
const { loadAnn } = load('fileFormats/ann/index.ts');
const { Animo } = load('engine/types/animo.ts');
const { Mouse } = load('engine/types/mouse.ts');
const { Keyboard } = load('engine/types/keyboard.ts');
const { Timer } = load('engine/types/timer.ts');
const { Scene } = load('engine/types/scene.ts');
const { Sequence } = load('engine/types/sequence.ts');
const { Group } = load('engine/types/group.ts');
const { Struct } = load('engine/types/struct.ts');
const { World } = load('engine/types/world.ts');
const { Pattern } = load('engine/types/pattern.ts');
const { CanvasObserver } = load('engine/types/canvasObserver.ts');
const { Image } = load('engine/types/image.ts');
const { Button } = load('engine/types/button.ts');
const { StaticFilter } = load('engine/types/staticfilter.ts');
const { Database } = load('engine/types/database.ts');
const { captureSavedProgressCheckpoint } = load('engine/checkpoint.ts');
const { loadImage } = load('fileFormats/img/index.ts');
const { loadSprite } = load('filesystem/assetsLoader.ts');
const { default: Filesystem, normalizePath } = load('filesystem/index.ts');
const { FileNotFoundError } = load('filesystem/fileLoader.ts');
const { deserializeArray, serializeArray } = load('fileFormats/archive/array.ts');
const { Container, Rectangle, Texture, BaseTexture } = require('pixi.js');
const createGraph = require('ngraph.graph');
const { aStar } = require('ngraph.path');
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

async function createArcadeFixture(scene, folder, filename, overlay) {
    const directory = path.join(assets, 'Dane/Game/Przygoda', folder);
    const definitions = name => parseCNV(patchMagicieniiSource(`dane/game/przygoda/${folder}/${name}`.toLowerCase(),
        decryptCNV(bytes(path.join(directory, name)))));
    const defs = definitions(filename);
    if (overlay) for (const name of [overlay].flat()) Object.assign(defs, definitions(name));
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
    const parent = new Scene(engine, null, { TYPE: 'SCENE', NAME: scene });
    parent.scope = scope; parent.getRelativePath = engine.currentScene.getRelativePath;
    engine.currentScene = parent; scope.set(scene, parent);
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
    await world?.init();
    return { engine, parent, scope, directory, defs, world, get, addMedia };
}

async function verifyPiklibia() {
    await require('./verify-magicienii-piklibia.cjs')({ assets, createArcadeFixture, Filesystem, normalizePath,
        Database, Struct, Animo, Type, constructors, serializeArray, deserializeArray });
}

async function verifyBarandalf() {
    for (const level of [0, 2]) {
        const { engine, parent, scope, directory, defs, world, get } =
            await createArcadeFixture('BARANDALF', 'Barandalf', 'Barandalf.cnv', `cnvLevel${level}.cnv`);
        // Background/audio are boundaries; the original initialization, actors, filter and movement are real.
        get('CANVASOBSERVER').SETBACKGROUND = () => {};
        get('CANVASOBSERVER').GETGRAPHICSAT = () => null;
        const mouse = new Mouse(engine, parent, { TYPE: 'MOUSE', NAME: 'MOUSE' });
        scope.set('MOUSE', mouse);
        scope.set('FLTRROTATE', new StaticFilter(engine, parent, defs.FLTRROTATE));
        for (const name of ['IMGEXIT', 'IMGNAKLADKA', 'IMGMASK']) get(name).LOAD = () => {};
        for (const name of ['ANNDRUZYNA', 'ANNWODA', 'ANNLISCIE', 'ANNLISCIESLOTY']) {
            const actor = new Animo(engine, parent, defs[name]);
            actor.LOAD = async filename => {
                actor.annFile = loadAnn(bytes(path.join(directory, filename)));
                await actor.initSprite();
            };
            await actor.LOAD(defs[name].FILENAME);
            scope.set(name, actor);
        }
        try {
            await get('VARLEVEL').SET(level);
            await get('BEHINITLEVEL').RUN();
            assert.ok(world.physics, `Barandalf ${level} must enable its physical world`);
            const actor = get('ANNDRUZYNA'), filter = get('FLTRROTATE'), sprite = actor.getRenderObject();
            // The authored spawn overlaps the outer wall by ten pixels; let contacts settle first.
            for (let tick = 0; tick < 10; tick++) { world.tick(16); await world.MOVEOBJECTS(); }
            const startX = world.GETPOSITIONX(100);
            mouse.mousePosition.set(Math.round(startX), 450);
            for (let tick = 0; tick < 80; tick++) {
                world.tick(16); await get('BEHMOVEWORLD').RUN();
                assert.ok(Math.abs(actor.GETCENTERX() - world.GETPOSITIONX(100)) <= 1,
                    `Barandalf ${level} rotation must not shift the reported X center`);
                assert.ok(Math.abs(actor.GETCENTERY() - world.GETPOSITIONY(100)) <= 1,
                    `Barandalf ${level} rotation must not shift the reported Y center`);
            }
            assert.ok(world.GETPOSITIONY(100) < 510, `Barandalf ${level} must follow the mouse upward`);
            assert.ok(Math.abs(world.GETPOSITIONX(100) - startX) < 1,
                `Vertical travel must not drift horizontally: ${world.GETPOSITIONX(100)},${world.GETPOSITIONY(100)}`);
            mouse.mousePosition.set(actor.GETCENTERX(), actor.GETCENTERY());
            await get('BEHMOVEPLAYER').RUN();
            assert.equal(world.GETSPEED(100), 0, 'The original near-pointer branch must stop movement');
            filter.UNLINK(actor.name);
            assert.deepEqual([sprite.anchor.x, sprite.anchor.y, sprite.angle], [0, 0, 0],
                'Unlinking repeated rotations must restore the original anchor and angle');
            await world.SETPOSITION(100, 700, 480, 0);
            world.SETVELOCITY(100, 100, 0, 0);
            world.tick(16); await world.MOVEOBJECTS();
            const x = world.GETPOSITIONX(100);
            const rawX = world.physics.position(100).x;
            assert.ok(rawX > 700 && rawX < 702);
            assert.equal(x, Math.trunc(rawX));
            world.STOP(); world.tick(1000); await world.MOVEOBJECTS();
            assert.equal(world.GETPOSITIONX(100), x, 'Stopping the scene must freeze the physical body');
            await world.SETPOSITION(100, level === 0 ? 160 : 330, level === 0 ? 480 : 440, 0);
            world.START();
            for (let tick = 0; tick < 120; tick++) {
                world.SETVELOCITY(100, level === 0 ? 100 : -100, 0, 0);
                world.tick(16); await world.MOVEOBJECTS();
            }
            assert.ok(level === 0 ? Math.abs(world.physics.position(100).x - 180) < 1
                : Math.abs(world.physics.position(100).x - 300) < 1, 'The shipped obstacle mesh must block the actor');
            assert.equal(get('ANNLISCIE').clones.length, get('ANNLISCIESLOTY').GETNOE());
        } finally {
            assert.deepEqual(engine.scopeManager.destroy(), [], `Barandalf ${level} scene cleanup`);
        }
    }
    console.log('BARANDALF: both original map initializers, mouse-follow movement, stable rotation centers and stop branches passed');
}

function planBarandalfBoat() {
    const forbidden = [[0, 1], [0, 2], [4, 3], [2, 3]];
    const independent = mask => forbidden.every(([a, b]) => !(mask & (1 << a)) || !(mask & (1 << b)));
    const queue = [{ right: 0, side: 0, trips: [] }], visited = new Set(['0:0']);
    let solution;
    while (queue.length) {
        const state = queue.shift();
        if (state.right === 31) { solution = state.trips; break; }
        const available = state.side ? state.right : 31 ^ state.right;
        for (let passengers = 0; passengers < 32; passengers++) {
            if ((passengers & available) !== passengers || passengers.toString(2).replaceAll('0', '').length > 2 ||
                !independent(passengers) || !independent(state.right & ~passengers) ||
                !independent((31 ^ state.right) & ~passengers)) continue;
            const right = state.right ^ passengers, side = 1 - state.side, key = `${right}:${side}`;
            if (visited.has(key)) continue;
            visited.add(key); queue.push({ right, side, trips: [...state.trips, passengers] });
        }
    }
    assert.ok(solution, 'The authored pair constraints must admit a two-seat boat solution');
    return solution;
}

async function verifyBarandalfBoat() {
    const { engine, parent, scope, directory, defs, get } =
        await createArcadeFixture('BARANDALF', 'Barandalf', 'Barandalf.cnv', 'cnvLevel1.cnv');
    const names = ['ANNKRET', 'ANNLOVELAS', 'ANNMIMLI', 'ANNREX', 'ANNCHOMIK'];
    const buttons = ['BTNKRET', 'BTNLOVELAS', 'BTNMIMLI', 'BTNREX', 'BTNCHOMIK'];
    const solution = planBarandalfBoat();
    get('CANVASOBSERVER').SETBACKGROUND = () => {};
    get('IMGNAKLADKA1').LOAD = () => {};
    const progress = [];
    const savedProgress = new Type(engine, parent, { TYPE: 'GROUP', NAME: 'G_SARCADEOBJECTS' });
    savedProgress.SET = level => progress.push(level);
    scope.set(savedProgress.name, savedProgress);
    get('ARRAYSAVE').restoreCheckpointValue([0, 1]);
    await get('VARLEVEL').SET(1);
    for (const name of [...names, 'ANNLODKA', 'ANNLISCIE', 'ANNLISCIESLOTY']) {
        const actor = new Animo(engine, parent, defs[name]);
        actor.annFile = loadAnn(bytes(path.join(directory, defs[name].FILENAME)));
        await actor.initSprite(); scope.set(name, actor);
    }
    await get('ANNLISCIE').CLONE(get('ANNLISCIESLOTY').GETNOE());
    for (const name of [...buttons, 'BTNLODKA']) {
        const button = new Button(engine, parent, defs[name]);
        scope.set(name, button); button.init(); await button.applyDefaults();
    }
    const click = async name => {
        const button = get(name), sprite = get(button.definition.GFXSTANDARD.objectName).getRenderObject();
        for (const event of ['pointerover', 'pointerdown', 'pointerup']) sprite.emit(event);
        await button.tick();
    };
    try {
        await get('BEHINITLEVEL').RUN();
        const boat = get('ANNLODKA');
        await click('BTNLODKA');
        assert.equal(get('SEQLEVEL').GETEVENTNAME(), 'B_KRET_LEFT_LOVELAS', 'Unsafe unattended banks must reject a crossing');
        assert.equal(boat.ISPLAYING(), false);
        get('SEQLEVEL').STOP();
        await click('BTNKRET'); await click('BTNLOVELAS');
        await click('BTNREX');
        assert.deepEqual(get('ARRAYBOAT').value, ['ANNKRET', 'ANNLOVELAS'], 'A third passenger must not board');
        await click('BTNLODKA');
        assert.equal(get('SEQLEVEL').GETEVENTNAME(), 'L_L0_KRET_LOVELAS', 'An incompatible passenger pair must reject a crossing');
        assert.equal(boat.ISPLAYING(), false);
        get('SEQLEVEL').STOP();
        await click('BTNKRET'); await click('BTNLOVELAS');
        assert.deepEqual(get('ARRAYBOAT').value, ['NULL', 'NULL']);
        for (const passengers of solution) {
            const indices = names.map((_name, index) => index).filter(index => passengers & (1 << index));
            for (const index of indices) {
                await click(buttons[index]);
                assert.equal(get('VARPLAYERNAME').value, names[index], 'GETSTD must select the clicked character');
                assert.ok(get('ARRAYBOAT').value.includes(names[index]), 'The selected character must board');
            }
            await click('BTNLODKA');
            assert.equal(get('SEQLEVEL').ISPLAYING(), false, 'A valid crossing must not invoke a failure sequence');
            assert.equal(boat.ISPLAYING(), true);
            for (let tick = 0; tick < 110 && boat.ISPLAYING(); tick++) await boat.tick(62.5);
            assert.equal(boat.ISPLAYING(), false, 'The authored boat animation must complete');
            const bank = boat.GETEVENTNAME(), passengerSide = bank === 'LEFT' ? 'RIGHT' : 'LEFT';
            for (const index of indices) {
                const slot = get('ARRAYBOAT').FIND(names[index]);
                assert.equal(get(names[index]).GETEVENTNAME(), `${passengerSide}_${slot}`,
                    'The named SWAP frame must reposition passengers at the destination');
                await click(buttons[index]);
                assert.equal(get(names[index]).GETEVENTNAME(), bank);
            }
            assert.deepEqual(get('ARRAYBOAT').value, ['NULL', 'NULL']);
        }
        for (const name of ['VARKRET', 'VARLOVELAS', 'VARMIMLI', 'VARREX', 'VARCHOMIK']) {
            assert.equal(get(name).value, 'RIGHT');
        }
        assert.deepEqual(progress, [2]);
        assert.equal(get('SEQLEVEL').GETEVENTNAME(), 'SUKCES');
        console.log(`BARANDALF BOAT: original buttons, capacity/pair/bank guards, ${solution.length} valid crossings, named passenger swaps and success decision passed`);
    } finally {
        assert.deepEqual(engine.scopeManager.destroy(), [], 'Boat puzzle scene cleanup');
    }
}

async function createBarandalfFixture(level) {
    const fixture = await createArcadeFixture('BARANDALF', 'Barandalf', 'Barandalf.cnv', `cnvLevel${level}.cnv`);
    const { engine, parent, scope, defs, get } = fixture, base = 'dane/game/przygoda/barandalf', stage = engine.app.stage;
    const memory = new Map(), routes = [], voices = [], audio = [], backgrounds = [], screenshots = [];
    engine.resolvePath = async (name, base = '') => normalizePath(name.startsWith('$') ? name.slice(1) : `${base}/${name}`);
    parent.getRelativePath = name => engine.resolvePath(name, base);
    engine.filesystem = new Filesystem({
        hasFile: name => fs.existsSync(path.join(assets, name)), registerLogicalFilenames() {},
        getRawFile: async name => {
            if (!fs.existsSync(path.join(assets, name))) throw new FileNotFoundError(name);
            return bytes(path.join(assets, name));
        },
    }, { get: async name => memory.get(name) ?? null, has: async name => memory.has(name),
        save: async (name, value) => { assert.equal(name, 'common/barandalf0.arr'); memory.set(name, value.slice(0)); } }, engine.compat);
    engine.rendering.sortObjects = () => stage.children.sort((a, b) => a.zIndex - b.zIndex);
    engine.rendering.addToStage = sprite => { stage.addChild(sprite); engine.rendering.sortObjects(); };
    engine.rendering.removeFromStage = sprite => stage.removeChild(sprite);
    engine.rendering.setBackground = texture => backgrounds.push(texture);
    const assetLoader = load('filesystem/assetsLoader.ts'), previousLoadSound = assetLoader.loadSound;
    assetLoader.loadSound = async (filesystem, filename) => {
        if (!fs.existsSync(path.join(assets, normalizePath(filename)))) throw new FileNotFoundError(filename);
        const sound = { isPlaying: false, stop() { this.isPlaying = false; }, play(options = {}) {
            sound.isPlaying = true; audio.push(filename); options.onStart?.();
            if (!options.loop) voices.push(() => { if (sound.isPlaying) { sound.isPlaying = false; options.onEnd?.(); } });
            return { stop() { sound.isPlaying = false; }, pause() {}, resume() {} };
        } };
        return sound;
    };
    const dispose = () => {
        const cleanup = engine.scopeManager.destroy(); backgrounds.forEach(texture => texture.destroy(true));
        assetLoader.loadSound = previousLoadSound;
        assert.deepEqual(cleanup, [], 'Barandalf cleanup'); assert.equal(stage.children.length, 0);
    };
    try {
        for (const def of Object.values(defs)) {
            if (['ANIMO', 'IMAGE'].includes(def.TYPE)) {
                const actor = new (def.TYPE === 'ANIMO' ? Animo : Image)(engine, parent, def);
                if (actor instanceof Animo) actor.loadSfx = async () => {};
                scope.set(actor.name, actor); await actor.init(); await actor.applyDefaults(); await actor.ready();
            } else if (def.TYPE === 'TIMER') scope.set(def.NAME, new Timer(engine, parent, def));
            else if (def.TYPE === 'STATICFILTER') scope.set(def.NAME, new StaticFilter(engine, parent, def));
        }
        for (const def of Object.values(defs).filter(def => def.TYPE === 'BUTTON')) {
            const button = new Button(engine, parent, def); scope.set(button.name, button); button.init(); await button.applyDefaults();
        }
        scope.set('MOUSE', new Mouse(engine, parent, defs.MOUSE));
        for (const [name, value] of [['G_SARCADEOBJECTS', String(level)], ['G_SLASTOBJECTS', 'BARANDALF'], ['SCENENAME', 'BARANDALF']]) {
            const object = new constructors.STRING(engine, parent, { TYPE: 'STRING', NAME: name });
            object.restoreCheckpointValue(value); scope.set(name, object);
        }
        const screenshot = new Type(engine, parent, { TYPE: 'BEHAVIOUR', NAME: '__SCREENSHOT__' });
        screenshot.RUN = () => screenshots.push(true); scope.set(screenshot.name, screenshot);
        const episode = new Type(engine, parent, { TYPE: 'EPISODE', NAME: 'PRZYGODA' });
        episode.GOTO = name => routes.push(name); scope.set(episode.name, episode);
        const helpers = new Map();
        const getAnimo = async name => {
            if (helpers.has(name)) return helpers.get(name);
            const actor = new Animo(engine, parent, { TYPE: 'ANIMO', NAME: `__BARANDALF_SEQ_${helpers.size}__`,
                FILENAME: name, TOCANVAS: true, VISIBLE: true });
            actor.loadSfx = async () => {}; scope.set(actor.name, actor);
            await actor.init(); await actor.applyDefaults(); await actor.ready(); helpers.set(name, actor); return actor;
        };
        for (const name of ['SEQLEVEL', 'SEQMANDOLINA']) {
            const sequence = new Sequence(engine, parent, defs[name]); sequence.getAnimo = getAnimo;
            scope.set(name, sequence); await sequence.init();
        }
        const code = defs.__INIT__.CODE.code, ast = load('interpreter/parser.ts').parseCode(code);
        const start = ast.findIndex(entry => entry.type === 'FunctionCall' && entry.target?.ref?.name === 'VARSAVENAME');
        assert.ok(start > 0);
        // The overlay is preloaded; global menu/cursor/music/ambient setup is outside this fixture.
        await new Interpreter(new RuntimeContext(engine, null, code)).execute(ast.slice(start).filter(entry =>
            !['G_CURSOR', 'G_MENU', 'G_AMBIENT', 'CNVLOADER'].includes(entry.target?.ref?.name)));
        const step = async (count = 1) => {
            for (let tick = 0; tick < count && !routes.length; tick++) {
                if (voices.length) voices.shift()();
                if (!parent.paused) for (const object of scope.objects) await object.tick(1000 / 60);
            }
        };
        const click = async name => {
            const button = get(name), sprite = get(button.definition.GFXSTANDARD.objectName).getRenderObject();
            for (const event of ['pointerover', 'pointerdown', 'pointerup']) sprite.emit(event);
            await button.tick();
        };
        assert.equal(get('VARLEVEL').value, level);
        return { ...fixture, step, click, routes, memory, audio, screenshots, dispose };
    } catch (error) { dispose(); throw error; }
}

async function verifyBarandalfRecovery() {
    for (const level of [0, 1, 2]) {
        const { get, world, parent, step, click, routes, memory, audio, screenshots, dispose } = await createBarandalfFixture(level);
        try {
            await step(120);
            if (level === 1) {
                await click('BTNKRET'); await click('BTNREX'); await click('BTNLODKA');
                assert.equal(get('ANNLODKA').ISPLAYING(), true, 'Start a valid crossing before restarting');
            }
            await get('BTNRESTART').callbacks.run('ONRELEASED');
            assert.equal(parent.paused, false, 'The restart sequence must keep ticking');
            assert.equal(world.started, false); assert.equal(get('ANNELAPSE').isPlaying, false);
            if (level !== 1) assert.equal(get('TIMERSEQ').enabled, false);
            assert.equal(get('BTNRESTART').logic.enabled, false);
            if (level === 1) for (const name of ['BTNKRET', 'BTNREX', 'BTNLOVELAS', 'BTNMIMLI', 'BTNCHOMIK', 'BTNLODKA']) {
                assert.equal(get(name).logic.enabled, false, `${name} must not mutate the boat during restart`);
            }
            const boatFrame = level === 1 ? get('ANNLODKA').GETCFRAMEINEVENT() : null;
            await step(600);
            assert.deepEqual(routes, ['BARANDALF']); assert.equal(screenshots.length, 1);
            assert.deepEqual(deserializeArray(memory.get('common/barandalf0.arr')), [level, level === 1 ? 1 : 0]);
            assert.deepEqual(audio.slice(-2).map(name => name.toLowerCase()), ['wavs/nar_b091.wav', 'wavs/nar_b092.wav']);
            assert.equal(get('SEQLEVEL').ISPLAYING(), false);
            if (level === 1) assert.equal(get('ANNLODKA').GETCFRAMEINEVENT(), boatFrame, 'A restarted crossing must stay frozen');
        } finally { dispose(); }
    }
    console.log('BARANDALF: three real-asset overlay initializers, restart voices, frozen controls/crossing and original reload requests passed');
}

function planBarandalfRoute(fixture, level) {
    const { get, world, directory } = fixture;
    const source = load('fileFormats/sek/index.ts').readSekWorld(bytes(path.join(directory, `level${level}.sek`)), true);
    const radius = world.physics.world.bodies.find(body => body.mass > 0).shapes[0].radius;
    const obstacles = source.bodies.filter(body => body.geometry?.triangles.length).map(body => {
        const points = body.geometry.triangles.flat();
        return { x0: Math.min(...points.map(point => point.x)) + 400, x1: Math.max(...points.map(point => point.x)) + 400,
            y0: 300 - Math.max(...points.map(point => point.y)), y1: 300 - Math.min(...points.map(point => point.y)),
            z0: Math.min(...points.map(point => point.z)), z1: Math.max(...points.map(point => point.z)) };
    });
    // Conservative inflated bounds are used only by the test controller, not by game physics.
    const free = (x, y) => !obstacles.some(box => box.z0 <= radius && box.z1 >= -radius &&
        x > box.x0 - radius - 4 && x < box.x1 + radius + 4 && y > box.y0 - radius - 4 && y < box.y1 + radius + 4);
    const graph = createGraph();
    for (let x = 20; x <= 780; x += 10) for (let y = 20; y <= 580; y += 10) {
        if (free(x, y)) graph.addNode(`${x},${y}`, { x, y });
    }
    graph.forEachNode(node => {
        const { x, y } = node.data;
        for (const [dx, dy] of [[10, 0], [0, 10], [10, 10], [10, -10]]) {
            if (!graph.getNode(`${x + dx},${y + dy}`) || !free(x + dx / 2, y + dy / 2)) continue;
            if (dx && dy && (!graph.getNode(`${x + dx},${y}`) || !graph.getNode(`${x},${y + dy}`))) continue;
            graph.addLink(node.id, `${x + dx},${y + dy}`);
        }
    });
    const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    let start, best = Infinity;
    const position = { x: world.GETPOSITIONX(100), y: world.GETPOSITIONY(100) }, goals = [];
    graph.forEachNode(node => {
        const d = distance(position, node.data);
        if (d < best) { best = d; start = node; }
        if (get('CANVASOBSERVER').GETGRAPHICSAT(node.data.x, node.data.y, false, 300, 300, false) === 'IMGEXIT') goals.push(node);
    });
    assert.ok(start && goals.length, `Barandalf ${level} must have an accessible opaque exit pixel`);
    const sprite = get('IMGEXIT').getRenderObject(), center = { x: sprite.x + sprite.width / 2, y: sprite.y + sprite.height / 2 };
    const end = goals.sort((a, b) => distance(a.data, center) - distance(b.data, center))[0];
    const plan = aStar(graph, { distance: (a, b) => distance(a.data, b.data), heuristic: (a, b) => distance(a.data, b.data) })
        .find(start.id, end.id).reverse().map(node => node.data);
    assert.ok(plan.length > 1, `Barandalf ${level} collision bounds must admit a route`);
    // Aim past the exit: the original character stops within ten pixels of the mouse.
    const last = plan.at(-1), previous = plan.at(-2), length = distance(last, previous);
    plan.push({ x: last.x + 20 * (last.x - previous.x) / length, y: last.y + 20 * (last.y - previous.y) / length });
    return plan;
}

async function verifyBarandalfRoutes() {
    for (const level of [0, 2]) {
        const fixture = await createBarandalfFixture(level), { get, world, step, routes, screenshots, dispose } = fixture;
        try {
            const plan = planBarandalfRoute(fixture, level);
            let index = 0;
            for (let tick = 0; tick < 6000 && !routes.length; tick++) {
                const x = world.GETPOSITIONX(100), y = world.GETPOSITIONY(100);
                while (index < plan.length - 1 && Math.hypot(x - plan[index].x, y - plan[index].y) < 12) index++;
                get('MOUSE').onMouseMove({ button: 0, screen: plan[index] });
                await step();
            }
            assert.deepEqual(routes, [level === 0 ? 'BARANDALF' : 'ARCADE']);
            assert.equal(get('G_SARCADEOBJECTS').value, level === 0 ? '1' : 'BARANMIOT');
            assert.equal(get('VARLEVEL').value, level + 1); assert.equal(screenshots.length, 1);
            assert.equal(world.started, false);
            console.log(`BARANDALF ${level}: full mouse-follow route, ${plan.length} collision-planned points, hidden exit and original story transition passed`);
        } finally { dispose(); }
    }
}

function planBarandalfDepartures(get, direction) {
    const rectangles = (actor, name) => {
        const event = actor.annFile.events.find(event => event.name === name);
        return event.frames.map((frame, index) => {
            const image = actor.annFile.annImages[event.framesImageMapping[index]];
            return { x: actor.positionX + image.positionX + frame.positionX - actor.anchorOffsetX,
                y: actor.positionY + image.positionY + frame.positionY - actor.anchorOffsetY, width: image.width, height: image.height };
        });
    };
    const hazard = rectangles(get('ANNORKA'), 'PLAY'), route = rectangles(get('ANNLODKA'), direction), safe = new Set();
    for (let phase = 0; phase < hazard.length; phase++) {
        let risk = 0;
        for (let frame = 0; frame < route.length; frame++) for (let offset = -2; offset <= 2; offset++) {
            const actor = hazard[(phase + frame + offset + hazard.length) % hazard.length], boat = route[frame];
            const width = Math.max(0, Math.min(actor.x + actor.width, boat.x + boat.width) - Math.max(actor.x, boat.x));
            const height = Math.max(0, Math.min(actor.y + actor.height, boat.y + boat.height) - Math.max(actor.y, boat.y));
            risk = Math.max(risk, width * height / (actor.width * actor.height));
        }
        // The original hazard uses 12% overlap; leave margin for animation-callback timing.
        if (risk <= .01) safe.add(phase);
    }
    assert.ok(safe.size > 0, `The original ${direction} crossing must have a safe departure window`);
    return { safe, period: hazard.length };
}

async function verifyBarandalfBoatCompletion() {
    const { get, step, click, routes, audio, screenshots, dispose } = await createBarandalfFixture(1);
    const names = ['ANNKRET', 'ANNLOVELAS', 'ANNMIMLI', 'ANNREX', 'ANNCHOMIK'];
    const buttons = ['BTNKRET', 'BTNLOVELAS', 'BTNMIMLI', 'BTNREX', 'BTNCHOMIK'];
    const solution = planBarandalfBoat();
    let waited = 0;
    try {
        await step(120);
        assert.equal(get('SEQLEVEL').ISPLAYING(), false, 'The original introduction must finish before boarding');
        const departures = Object.fromEntries(['LEFT', 'RIGHT'].map(name => [name, planBarandalfDepartures(get, name)]));
        for (const passengers of solution) {
            const indices = names.map((_name, index) => index).filter(index => passengers & (1 << index));
            for (const index of indices) await click(buttons[index]);
            assert.equal(get('ARRAYBOAT').value.filter(name => name !== 'NULL').length, indices.length);
            const { safe, period } = departures[get('ANNLODKA').GETEVENTNAME() === 'LEFT' ? 'RIGHT' : 'LEFT'];
            const phase = () => (get('ANNORKA').GETCFRAMEINEVENT() - 1 + period) % period;
            for (let tick = 0; tick < 1200 && !safe.has(phase()) && !routes.length; tick++) { await step(); waited++; }
            assert.ok(safe.has(phase()) && get('ANNORKA').ISPLAYING(), 'Wait for a safe departure without stopping the hazard');
            await click('BTNLODKA');
            const boat = get('ANNLODKA');
            assert.equal(boat.ISPLAYING(), true, 'Each valid crossing must start through its original button');
            for (let tick = 0; tick < 900 && boat.ISPLAYING(); tick++) await step();
            assert.equal(boat.ISPLAYING(), false, 'The actual boat animation and named frame callback must finish');
            for (const index of indices) await click(buttons[index]);
            assert.deepEqual(get('ARRAYBOAT').value, ['NULL', 'NULL']);
        }
        for (const name of ['VARKRET', 'VARLOVELAS', 'VARMIMLI', 'VARREX', 'VARCHOMIK']) assert.equal(get(name).value, 'RIGHT');
        await step(900);
        assert.deepEqual(routes, ['BARANDALF']); assert.equal(get('G_SARCADEOBJECTS').value, '2');
        assert.equal(get('SEQLEVEL').ISPLAYING(), false); assert.equal(screenshots.length, 1);
        assert.deepEqual(audio.slice(-2).map(name => name.toLowerCase()), ['wavs/nar_b093.wav', 'wavs/bulbo_b094.wav']);
        assert.ok(waited > 0);
        console.log(`BARANDALF BOAT: ${solution.length} complete original crossings, ${waited} hazard-timing waits, both success voices and next-map request passed`);
    } finally { dispose(); }
}

async function verifyBarandalfBoatHazard() {
    const { get, step, click, routes, memory, audio, screenshots, dispose } = await createBarandalfFixture(1);
    try {
        await step(120);
        await click('BTNKRET'); await click('BTNREX'); await click('BTNLODKA');
        await step(900);
        assert.deepEqual(routes, ['BARANDALF']); assert.equal(get('G_SARCADEOBJECTS').value, 'BARANDALF');
        assert.equal(get('ANNORKA').ISPLAYING(), false); assert.equal(get('ANNLODKA').ISPLAYING(), false);
        assert.ok(audio.some(name => name.toLowerCase() === 'wavs/nar_b090.wav'));
        assert.deepEqual(deserializeArray(memory.get('common/barandalf0.arr')), [1, 1]);
        assert.equal(screenshots.length, 1);
        console.log('BARANDALF BOAT: original moving-hazard capture, failure voice, retained progress and reload request passed');
    } finally { dispose(); }
}

async function verifyMazeEnemies() {
    let enemies = 0, accepted = 0, rejected = 0;
    for (const level of [0, 1, 2]) {
        const { engine, parent, scope, directory, defs, get } =
            await createArcadeFixture('LABIRYNT', 'Labirynt', 'Labirynt.cnv', `cnvLevel${level}.cnv`);
        // Player/story setup and global obstacle queries are boundaries; enemy actors and helpers are real.
        get('ARRAYSAVE').restoreCheckpointValue([0, 2]);
        engine.rendering.addToStage = sprite => engine.app.stage.addChild(sprite);
        engine.rendering.removeFromStage = sprite => engine.app.stage.removeChild(sprite);
        get('CANVASOBSERVER').GETGRAPHICSAT = () => null;
        const ast = load('interpreter/parser.ts').parseCode(defs.__INIT__.CODE.code);
        const directions = ast.filter(entry => entry.type === 'FunctionCall' && entry.target?.type === 'ObjectTarget' &&
            /^ARRAY(UP|DOWN|LEFT|RIGHT|IDLE|SLEEP)$/.test(entry.target.ref.name));
        await new Interpreter(new RuntimeContext(engine, null, defs.__INIT__.CODE.code)).execute(directions);
        for (const def of Object.values(defs).filter(def => /^ANNENEMY[01](PATH|FIELD|MASK|MMASK|ELAPSE|CURSE)?$/.test(def.NAME))) {
            const actor = new Animo(engine, parent, def);
            actor.LOAD = async filename => {
                if (actor.getRenderObject()) actor.destroy();
                actor.textures = new Map(); actor.hitmaps = new Map();
                actor.annFile = loadAnn(bytes(path.join(directory, filename)));
                await actor.initSprite();
            };
            await actor.LOAD(/^ANNENEMY[01]$/.test(def.NAME) ? 'GES.ANN' : def.FILENAME);
            scope.set(actor.name, actor);
        }
        try {
            await get('BEHPLAYERS').RUN();
            for (const family of [0, 1]) {
                const prefix = `ANNENEMY${family}`, actor = get(prefix);
                const count = get(`ARRAYENEMY${family}STARTX`).GETSIZE();
                assert.equal(actor.clones.length, count);
                for (let index = 1; index <= count; index++) {
                    const enemy = get(`${prefix}_${index}`), x = enemy.GETCENTERX(), y = enemy.GETCENTERY();
                    enemies++;
                    assert.ok(enemy.getRenderObject().parent === engine.app.stage,
                        'Enemy clones must join the renderer even when their source template is off-canvas');
                    assert.equal(enemy.ISVISIBLE(), true);
                    assert.equal(enemy.GETPRIORITY(), 300, 'Enemy clones must remain on the original spell-hit layer');
                    for (const suffix of ['FIELD', 'MASK', 'MMASK']) {
                        const helper = get(`${prefix}${suffix}_${index}`);
                        assert.equal(helper.GETEVENTNAME(), 'IDLE');
                        assert.deepEqual([helper.positionX, helper.positionY], [x, y], 'Initial masks must follow their own enemy clone');
                        assert.equal(helper.ISVISIBLE(), false);
                    }
                    for (const [direction, dx, dy] of [['UP', 0, -5], ['DOWN', 0, 5], ['LEFT', -5, 0], ['RIGHT', 5, 0]]) {
                        const oldX = enemy.positionX, oldY = enemy.positionY;
                        await enemy.PLAY(direction);
                        assert.deepEqual([enemy.positionX, enemy.positionY], [oldX + dx, oldY + dy]);
                        const curse = get(`${prefix}CURSE_${index}`);
                        assert.deepEqual([curse.positionX, curse.positionY], [enemy.GETCENTERX(), enemy.GETCENTERY()],
                            'The original frame callback must move the matching curse clone');
                    }
                }
                if (count) {
                    const enemy = actor.clones[0], mask = get(`${prefix}MASK_1`);
                    await mask.SETPOSITION(23, 31);
                    await get(`ARRAYENEMY${family}STATE`).CHANGEAT(0, 'DARK');
                    await enemy.callbacks.run('ONSTARTED', enemy.GETEVENTNAME());
                    assert.deepEqual([mask.positionX, mask.positionY], [23, 31], 'DARK must skip normal-mask synchronization');
                    await get(`ARRAYENEMY${family}STATE`).CHANGEAT(0, 'NULL');
                }
            }
            for (const family of [0, 1]) {
                for (const [index, enemy] of get(`ANNENEMY${family}`).clones.entries()) {
                    const positions = new Set();
                    const path = get(`ANNENEMY${family}PATH_${index + 1}`), isAt = path.ISAT.bind(path);
                    const sprite = path.getRenderObject(), imageIndex = path.currentEvent.framesImageMapping[0];
                    const image = path.annFile.annImages[imageIndex], pixels = path.annFile.images[imageIndex];
                    let queries = 0;
                    path.ISAT = (x, y, alpha) => {
                        const result = isAt(x, y, alpha), px = Math.floor(x - sprite.x), py = Math.floor(y - sprite.y);
                        const expected = px >= 0 && px < image.width && py >= 0 && py < image.height &&
                            pixels[(py * image.width + px) * 4 + 3] > 0;
                        assert.equal(result, expected, `${path.name} must match the shipped path's raw alpha pixels`);
                        queries++; if (result) accepted++; else rejected++;
                        return result;
                    };
                    await enemy.PLAY('IDLE');
                    for (let tick = 0; tick < 180; tick++) {
                        await enemy.tick(62.5);
                        positions.add(`${enemy.GETCENTERX()},${enemy.GETCENTERY()}`);
                    }
                    assert.ok(positions.size > 8, `${enemy.name} must patrol using its shipped alpha path`);
                    assert.ok(queries > 0, `${enemy.name} must query its own path clone`);
                    assert.ok(enemy.ISPLAYING(), `${enemy.name} must restart movement from its completion callback`);
                }
            }
        } finally {
            assert.deepEqual(engine.scopeManager.destroy(), [], `Maze ${level} scene cleanup`);
            assert.equal(engine.app.stage.children.length, 0, `Maze ${level} must release registered enemy/helper sprites`);
        }
    }
    assert.ok(accepted > 0 && rejected > 0, 'Patrols must exercise both opaque and transparent path pixels');
    console.log(`MAZE: all three original enemy initializers, ${enemies} registered clones, curse/DARK guards and patrols passed; ${accepted} accepted/${rejected} rejected path pixels`);
}

async function verifyMazePlayers() {
    const previousWindow = globalThis.window;
    globalThis.window = new EventTarget();
    let moved = 0, blocked = 0, selections = 0;
    try {
        for (const level of [0, 1, 2]) {
            const { engine, parent, scope, directory, defs, get } =
                await createArcadeFixture('LABIRYNT', 'Labirynt', 'Labirynt.cnv', `cnvLevel${level}.cnv`);
            const stage = engine.app.stage;
            engine.rendering.sortObjects = () => stage.children.sort((a, b) => a.zIndex - b.zIndex);
            engine.rendering.addToStage = sprite => { stage.addChild(sprite); engine.rendering.sortObjects(); };
            engine.rendering.removeFromStage = sprite => stage.removeChild(sprite);
            engine.filesystem.getIMGFile = async filename => loadImage(bytes(filename));
            engine.filesystem.saveFile = async () => assert.fail('Maze control checks must not write game saves');
            // Enemy/pressure-button setup, exit artwork, dialogue audio and story persistence are boundaries.
            get('BEHINITENEMY').RUN = () => {};
            get('BEHONBUTTON').RUN = () => {};
            for (const def of Object.values(defs).filter(def => /^ANNENEMY/.test(def.NAME))) get(def.NAME).LOAD = () => {};
            for (const def of Object.values(defs).filter(def => def.TYPE === 'BUTTON')) {
                scope.set(def.NAME, new Button(engine, parent, def));
            }
            const companion = new constructors.INTEGER(engine, parent, { TYPE: 'INTEGER', NAME: 'G_IKRETACTIVE', VALUE: 1 });
            scope.set(companion.name, companion);
            for (const def of Object.values(defs).filter(def => /^ANNPLAYER([0-8]|MASK|FIELD|ELAPSE|DARKELAPSE)$/.test(def.NAME) || def.NAME === 'ANNMENU')) {
                const actor = new Animo(engine, parent, def);
                actor.annFile = loadAnn(bytes(path.join(directory, def.FILENAME)));
                await actor.initSprite(); scope.set(actor.name, actor);
            }
            const mask = new Image(engine, parent, defs.IMGMASK);
            mask.sprite = await loadSprite(engine.filesystem, path.join(directory, `MASK${level}.IMG`));
            mask.sprite.visible = false; await mask.applyDefaults(); stage.addChild(mask.sprite); scope.set(mask.name, mask);
            const keyboard = new Keyboard(engine, parent, defs.KEYBOARD);
            scope.set(keyboard.name, keyboard); await keyboard.ready(); keyboard.SETAUTOREPEAT(false);
            const key = async (code, character, down = true) => {
                const event = new Event(down ? 'keydown' : 'keyup');
                Object.assign(event, { code, key: character });
                window.dispatchEvent(event); await keyboard.tick();
            };
            const select = async number => { await key(`Digit${number}`, `${number}`); await key(`Digit${number}`, `${number}`, false); };
            try {
                get('ARRAYSAVE').restoreCheckpointValue([0, 0]);
                const ast = load('interpreter/parser.ts').parseCode(defs.__INIT__.CODE.code);
                const arrays = ast.filter(entry => entry.type === 'FunctionCall' && entry.target?.type === 'ObjectTarget' &&
                    /^ARRAY(KEYBOARD|PLAYERACTIVE|UP|DOWN|LEFT|RIGHT|IDLE)$/.test(entry.target.ref.name));
                await new Interpreter(new RuntimeContext(engine, null, defs.__INIT__.CODE.code)).execute(arrays);
                await get('BEHPLAYERS').RUN(); await get('BEHINITPLAYERS').RUN();
                await get('ANNMENU').CLONE(get('ARRAYPLAYERS').GETSIZE());
                await get('VARPLAYERNAME').SET('ANNPLAYER0'); await get('VARMASKNAME').SET('ANNPLAYERMASK_1');
                await get('ANNPLAYER0').PLAY('IDLE_DOWN');
                const collisionRequests = [], collision = get('BEHPLAYERCOLL'), checkCollision = collision.RUN.bind(collision);
                collision.RUN = async (...args) => {
                    collisionRequests.push(get('VARSTRING0').value);
                    return checkCollision(...args);
                };
                await select(2);
                assert.equal(get('VARPLAYERNAME').value, 'ANNPLAYER1', 'The original ONCHAR handler must select the companion');
                selections++;
                if (level === 1) {
                    await select(3);
                    assert.equal(get('VARPLAYERNAME').value, 'ANNPLAYER1', 'Imprisoned characters must remain unselectable');
                    // Rescue prerequisites are a boundary; release actors to exercise all nine selection handlers.
                    for (let index = 2; index < 9; index++) await get(`ANNPLAYER${index}`).PLAY('WAIT_DOWN');
                }
                for (let number = 1; number <= get('ARRAYPLAYERS').GETSIZE(); number++) {
                    await select(number);
                    const player = get(`ANNPLAYER${number - 1}`);
                    assert.equal(get('VARPLAYERNAME').value, player.name, `Maze ${level} selection key ${number}`);
                    selections++;
                    for (const [code, direction, dx, dy] of [['ArrowUp', 'UP', 0, -40], ['ArrowDown', 'DOWN', 0, 40],
                        ['ArrowLeft', 'LEFT', -40, 0], ['ArrowRight', 'RIGHT', 40, 0]]) {
                        let cell;
                        for (let y = 60; y < 540 && !cell; y += 40) {
                            for (let x = 60; x < 740; x += 40) {
                                if ([[0, 0], [dx * .75, dy * .75]].every(([ox, oy]) =>
                                    !get('CANVASOBSERVER').GETGRAPHICSAT(x + ox, y + oy, false, 110, 130, false))) {
                                    cell = { x, y }; break;
                                }
                            }
                        }
                        assert.ok(cell, `Maze ${level} must contain a free ${direction} movement cell`);
                        await player.SETPOSITION(cell.x, cell.y);
                        await player.PLAY(number <= 2 ? 'IDLE_DOWN' : 'SELECTED_DOWN');
                        const checks = collisionRequests.length;
                        await key(code, direction); await get('BEHPLAYERMOVE').RUN();
                        assert.equal(collisionRequests.length, checks + 1, `${player.name} movement must invoke its collision callback`);
                        assert.equal(collisionRequests.at(-1), player.name, 'Collision queries must refer to the moving actor');
                        await key(code, direction, false);
                        for (let tick = 0; tick < 9; tick++) await player.tick(1000 / 30);
                        assert.deepEqual([player.positionX, player.positionY], [cell.x + dx, cell.y + dy],
                            `${player.name} must finish exactly one ${direction} tile after releasing the arrow`);
                        moved++;
                        let wallCell;
                        for (let y = 60; y < 540 && !wallCell; y += 40) {
                            for (let x = 60; x < 740; x += 40) {
                                if (!get('CANVASOBSERVER').GETGRAPHICSAT(x, y, false, 110, 130, false) &&
                                    get('CANVASOBSERVER').GETGRAPHICSAT(x + dx * .75, y + dy * .75,
                                        false, 110, 130, false) === 'IMGMASK') { wallCell = { x, y }; break; }
                            }
                        }
                        assert.ok(wallCell, `Maze ${level} must have a ${direction} wall to test`);
                        await player.SETPOSITION(wallCell.x, wallCell.y);
                        await player.PLAY(number <= 2 ? 'IDLE_DOWN' : 'SELECTED_DOWN');
                        await key(code, direction); await get('BEHPLAYERMOVE').RUN(); await key(code, direction, false);
                        for (let tick = 0; tick < 9; tick++) await player.tick(1000 / 30);
                        assert.deepEqual([player.positionX, player.positionY], [wallCell.x, wallCell.y],
                            `${player.name} must not enter the original ${direction} wall`);
                        blocked++;
                    }
                }
                if (level !== 1) {
                    const selected = get('VARPLAYERNAME').value;
                    await select(9);
                    assert.equal(get('VARPLAYERNAME').value, selected, 'Unavailable character numbers must be ignored');
                }
            } finally {
                assert.deepEqual(engine.scopeManager.destroy(), [], `Maze ${level} player cleanup`);
                assert.equal(stage.children.length, 0);
            }
        }
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
    console.log(`MAZE PLAYERS: original player initialization, ${selections} keyboard selections, ${moved} tile moves and ${blocked} wall blocks passed`);
}

async function createMazePuzzleFixture(level, spells = false) {
    const fixture = await createArcadeFixture('LABIRYNT', 'Labirynt', 'Labirynt.cnv',
        spells ? ['cnvSpell.cnv', `cnvLevel${level}.cnv`] : `cnvLevel${level}.cnv`);
    const { engine, parent, scope, defs, get } = fixture, stage = engine.app.stage;
    const scenePath = 'dane/game/przygoda/labirynt', memory = new Map(), reads = [], backgrounds = [];
    engine.currentScene.getRelativePath = name => normalizePath(name.startsWith('$') ? name.slice(1) : `${scenePath}/${name}`);
    engine.resolvePath = async (name, base = scenePath) => normalizePath(name.startsWith('$') ? name.slice(1) : `${base}/${name}`);
    engine.rendering.sortObjects = () => stage.children.sort((a, b) => a.zIndex - b.zIndex);
    engine.rendering.addToStage = sprite => { stage.addChild(sprite); engine.rendering.sortObjects(); };
    engine.rendering.removeFromStage = sprite => stage.removeChild(sprite);
    engine.rendering.setBackground = texture => backgrounds.push(texture);
    engine.filesystem = new Filesystem({
        hasFile: name => fs.existsSync(path.join(assets, name)),
        registerLogicalFilenames() {},
        getRawFile: async name => {
            reads.push(name);
            if (!fs.existsSync(path.join(assets, name))) throw new FileNotFoundError(name);
            return bytes(path.join(assets, name));
        },
    }, {
        get: async name => memory.get(name) ?? null,
        has: async name => memory.has(name),
        save: async (name, data) => {
            assert.equal(name, `common/maze_fixture${level}.arr`, 'Puzzle saves must remain in the in-memory fixture');
            memory.set(name, data.slice(0));
        },
    }, engine.compat);
    for (const [name, type, value] of [['G_IKRETACTIVE', 'INTEGER', 1], ['G_ISUCCESS', 'INTEGER', 0],
        ['G_SARCADEOBJECTS', 'STRING', 'LABIRYNT']]) {
        scope.set(name, new constructors[type](engine, parent, { TYPE: type, NAME: name, VALUE: value }));
    }
    const { Rand } = load('engine/types/rand.ts');
    const random = new Rand(engine, parent, { TYPE: 'RAND', NAME: 'RANDOM' }); let randomIndex = 0;
    random.GET = (min, count) => count === undefined ? randomIndex++ % min : min + randomIndex++ % count;
    scope.set(random.name, random);
    const displays = [];
    try {
        for (const def of Object.values(defs).filter(def => ['ANIMO', 'IMAGE'].includes(def.TYPE))) {
            const actor = new (def.TYPE === 'ANIMO' ? Animo : Image)(engine, parent, def);
            // Asset decoding, scripts and rendering ownership are real; Web Audio playback is outside this fixture.
            if (actor instanceof Animo) actor.loadSfx = async () => {};
            scope.set(actor.name, actor); displays.push(actor);
            await actor.init();
        }
        for (const actor of displays) await actor.applyDefaults();
        for (const actor of displays) await actor.ready();
        for (const def of Object.values(defs).filter(def => def.TYPE === 'BUTTON')) {
            const button = new Button(engine, parent, def);
            scope.set(button.name, button); button.init(); await button.applyDefaults();
        }
        get('ARRAYSAVE').restoreCheckpointValue(Array(9).fill(0));
        await get('VARSAVENAME').SET(`$COMMON/MAZE_FIXTURE${level}.ARR`);
        await get('VARLEVEL').SET(level);
        const ast = load('interpreter/parser.ts').parseCode(defs.__INIT__.CODE.code);
        const arrays = ast.filter(entry => entry.type === 'FunctionCall' && entry.target?.type === 'ObjectTarget' &&
            /^ARRAY(KEYBOARD|PLAYERACTIVE|UP|DOWN|LEFT|RIGHT|IDLE|SLEEP|SPELL|SPELLTYPE)$/.test(entry.target.ref.name));
        await new Interpreter(new RuntimeContext(engine, null, defs.__INIT__.CODE.code)).execute(arrays);
        await get('BEHINITLEVEL').RUN();
        await get('BEHINITBUTTON').RUN();
        await get('BEHINITPLAYERS').RUN();
        assert.ok(reads.includes(`${scenePath}/mask${level}.img`), 'Each room must load its own collision mask');
        return { ...fixture, stage, memory, reads, backgrounds };
    } catch (error) {
        engine.scopeManager.destroy();
        backgrounds.forEach(texture => texture.destroy(true));
        throw error;
    }
}

async function verifyMazePuzzleInitialization() {
    let plates = 0, switches = 0, exits = 0, guards = 0;
    for (const level of [0, 1, 2]) {
        const { engine, parent, scope, get, stage, backgrounds, memory } = await createMazePuzzleFixture(level);
        try {
            for (const enemy of [...get('ANNENEMY0').clones, ...get('ANNENEMY1').clones]) {
                assert.equal(enemy.GETPRIORITY(), 300);
                const sprite = enemy.getRenderObject(); let hittable = false;
                for (let y = Math.ceil(sprite.y); y < sprite.y + sprite.height && !hittable; y += 2) {
                    for (let x = Math.ceil(sprite.x); x < sprite.x + sprite.width; x += 2) {
                        if (enemy.ISAT(x, y, true) && get('CANVASOBSERVER').GETGRAPHICSAT(x, y, false, 300, 300, false) === enemy.name) {
                            hittable = true; break;
                        }
                    }
                }
                assert.ok(hittable, `${enemy.name} must expose an opaque pixel to the original spell hit test`); guards++;
            }
            assert.equal(get('ANNBTN').clones.length, get('ANNBTN').GETNOE());
            assert.equal(get('ANNSWITCH').clones.length, get('ANNSWITCH').GETNOE());
            assert.equal(get('ANNPRZEDMIOT').GETNOE(), 0, 'The absent, unused item placeholder must not invent gameplay items');
            for (const [name, priority] of [['ANNBTN', 201], ['ANNBTNMASK', 130], ['ANNSWITCH', 202], ['ANNSWITCHMASK', 130]]) {
                for (const clone of get(name).clones) {
                    assert.equal(clone.GETPRIORITY(), priority);
                    assert.equal(clone.ISVISIBLE(), false);
                    assert.ok(clone.getRenderObject().parent === stage);
                }
            }
            const players = get('ARRAYPLAYERS').value.map(name => get(name));
            const park = async () => {
                for (const player of players) await player.SETPOSITION(-1000, -1000);
                await get('VARPLAYERCHANGED').SET(0);
            };
            const points = (area, minZ = 201, maxZ = 202) => {
                const hits = [];
                for (let y = 20; y < 600; y += 40) for (let x = 20; x < 800; x += 40) {
                    if (area.ISAT(x, y, true) && get('CANVASOBSERVER').GETGRAPHICSAT(x, y, false, minZ, maxZ, false) === area.name) {
                        hits.push({ x, y });
                    }
                }
                return hits;
            };
            await park();
            if (level === 1) {
                assert.equal(get('CANVASOBSERVER').GETGRAPHICSAT(660, 420, false, 201, 201, false), 'ANNBTN_60',
                    'The unused hidden prison hotspot must not steal the fourth character\'s pressure-plate hit');
            }
            for (const area of get('ANNBTN').clones) {
                const hit = points(area, 201, 201)[0];
                if (!hit) continue;
                await players[0].SETPOSITION(hit.x, hit.y); await get('BEHONBUTTON').RUN();
                const index = area.GETCLONEINDEX();
                for (const name of [`ANNBTNGRAPH_${index}`, `ANNBTNMASK_${index}`]) {
                    const helper = get(name), frames = helper.GETNOFINEVENT(`A${index}`);
                    assert.equal(helper.GETCFRAMEINEVENT(), frames > 1 ? 1 : 0, `${name} must reflect the occupied plate`);
                }
                await park(); await get('BEHONBUTTON').RUN();
                assert.equal(get(`ANNBTNGRAPH_${index}`).GETCFRAMEINEVENT(), 0, 'Releasing a plate must restore its graphic');
                assert.equal(get(`ANNBTNMASK_${index}`).GETCFRAMEINEVENT(), 0, 'Releasing a plate must restore its wall mask');
                plates++;
            }
            if (level === 1) {
                // This reachable four-holder arrangement must open the whole eastern rescue corridor.
                for (const [player, y] of [[0, 340], [2, 380], [3, 420], [4, 460]]) await players[player].SETPOSITION(660, y);
                await players[1].SETPOSITION(740, 380);
                await get('VARPLAYERCHANGED').SET(0); await get('BEHONBUTTON').RUN();
                assert.deepEqual([58, 59, 60, 61].map(index => get(`ANNBTNMASK_${index}`).GETCFRAMEINEVENT()), [1, 1, 1, 1]);
                assert.equal(get('CANVASOBSERVER').GETGRAPHICSAT(740, 410, false, 110, 130, false), null,
                    'An occupied plate 60 must remove the wall that blocks the companion\'s next downward move');
                await park(); await get('BEHONBUTTON').RUN();
            }
            for (const area of get('ANNSWITCH').clones) {
                const frames = area.getEvent(area.GETEVENTNAME()).frames;
                const linked = frames.length === 1 ? [area.GETCLONEINDEX()] : frames.map(frame => Number(frame.name));
                const before = linked.map(index => get(`ANNSWITCHMASK_${index}`).GETCFRAMEINEVENT());
                await get('VARPLAYERCHANGED').SET(0); await get('VARSWITCH').SET('NULL'); await get('VARSWITCH').SET(area.name);
                if (!get('VARSWITCH').callbacks.hasParametrized('ONCHANGED', area.name)) {
                    assert.deepEqual(linked.map(index => get(`ANNSWITCHMASK_${index}`).GETCFRAMEINEVENT()), before,
                        'An unused switch placeholder without a handler must not change wall state');
                    continue;
                }
                for (const [offset, index] of linked.entries()) {
                    const helper = get(`ANNSWITCHMASK_${index}`), count = helper.GETNOFINEVENT(`A${index}`);
                    const expected = (before[offset] + 1) % count;
                    assert.equal(helper.GETCFRAMEINEVENT(), expected, `${area.name} must advance its linked wall mask: ${JSON.stringify({
                        level, index, linked, before, after: get('ANNSWITCHMASK').clones.map(clone => clone.GETCFRAMEINEVENT()),
                        var0: get('VARINT0').value, var1: get('VARINT1').value, var2: get('VARINT2').value,
                        callback: get('VARSWITCH').definition.ONCHANGED.parametrized.get(area.name),
                    })}`);
                    assert.equal(get(`ANNSWITCHGRAPH_${index}`).GETCFRAMEINEVENT(), expected);
                }
                if (level === 0) {
                    const saved = deserializeArray(memory.get('common/maze_fixture0.arr'));
                    assert.deepEqual(saved.slice(2), get('ANNSWITCHMASK').clones.map(clone => clone.GETCFRAMEINEVENT()));
                }
                switches++;
            }
            if (level === 0) {
                const saved = [...get('ARRAYSAVE').value];
                get('ARRAYSAVE').REMOVEALL(); await get('ARRAYSAVE').LOAD(get('VARSAVENAME').value);
                assert.deepEqual(get('ARRAYSAVE').value, saved, 'Original array persistence must round-trip switch state');
                for (const clone of get('ANNSWITCHMASK').clones) await clone.SETFRAME(clone.GETEVENTNAME(), 0);
                await get('BFITMP196').RUN();
                assert.deepEqual(get('ANNSWITCHMASK').clones.map(clone => clone.GETCFRAMEINEVENT()), saved.slice(2));
            }
            const routes = [], screenshots = [];
            let localExits = 0;
            const episode = new Type(engine, parent, { TYPE: 'EPISODE', NAME: 'PRZYGODA' });
            episode.GOTO = scene => routes.push(scene); scope.set(episode.name, episode);
            const screenshot = new Type(engine, parent, { TYPE: 'BEHAVIOUR', NAME: '__SCREENSHOT__' });
            screenshot.RUN = () => screenshots.push(true); scope.set(screenshot.name, screenshot);
            for (const [plate, buttonName, destination] of level === 0
                ? [[9, 'BTNEXIT0', 'PIWNICA'], [8, 'BTNEXIT1', 'UNIVPIWNICA']]
                : [[level === 1 ? 56 : 27, 'BTNEXIT', level === 1 ? 'CALINECZKA' : 'PIKLIBIA']]) {
                const area = get(`ANNBTN_${plate}`), targets = points(area), button = get(buttonName);
                assert.ok(targets.length >= 2, `${area.name} must have room for both main characters`);
                await park(); await players[0].SETPOSITION(targets[0].x, targets[0].y);
                await get('VARPLAYERNAME').SET(players[0].name); await get('VARBUTTON').SET('NULL'); await get('VARBUTTON').SET(area.name);
                assert.equal(button.logic.enabled, false, 'One character must not unlock an exit requiring both');
                await players[1].SETPOSITION(targets[1].x, targets[1].y);
                await get('VARBUTTON').SET('NULL'); await get('VARBUTTON').SET(area.name);
                assert.equal(button.logic.enabled, true);
                if (level === 1) assert.equal(get('G_ISUCCESS').value, 0, 'Leaving without the seven prisoners must not award rescue success');
                const sprite = get(button.definition.GFXSTANDARD.objectName).getRenderObject();
                assert.equal(sprite.visible, true);
                for (const event of ['pointerover', 'pointerdown', 'pointerup']) sprite.emit(event);
                await button.tick();
                assert.equal(get('G_SARCADEOBJECTS').value, destination);
                assert.equal(routes.at(-1), 'ARCADE');
                assert.equal(screenshots.length, ++localExits);
                exits++;
            }
        } finally {
            assert.deepEqual(engine.scopeManager.destroy(), [], `Maze ${level} puzzle cleanup`);
            assert.equal(stage.children.length, 0);
            backgrounds.forEach(texture => texture.destroy(true));
        }
    }
    console.log(`MAZE PUZZLES: full image/animation startup, ${guards} spell-hittable guards, ${plates} plate updates, ${switches} linked switches, save round-trip and ${exits} exit decisions passed`);
}

async function verifyMazeFirstRoute() {
    const previousWindow = globalThis.window, assetLoader = load('filesystem/assetsLoader.ts'), previousSound = assetLoader.loadSound;
    globalThis.window = new EventTarget();
    const { engine, parent, scope, defs, get, stage, backgrounds, memory } = await createMazePuzzleFixture(0);
    const voices = [], audio = [], routes = [], screenshots = [];
    let walked = 0, crossings = 0, teleports = 0;
    try {
        const voice = (filename, onEnd) => {
            assert.ok(fs.existsSync(path.join(assets, filename)), `Original maze voice: ${filename}`);
            const instance = { isPlaying: true, stop() { this.isPlaying = false; }, pause() {}, resume() {} };
            audio.push(filename.toLowerCase());
            voices.push(() => { if (instance.isPlaying) { instance.isPlaying = false; onEnd?.(); } });
            return instance;
        };
        // Audio duration and GPU rendering are boundaries; actors, masks, enemies and sequence callbacks remain live.
        assetLoader.loadSound = async (_filesystem, filename) => ({ play: options => voice(filename, options?.onEnd) });
        for (const object of scope.objects.filter(object => object.definition.TYPE === 'SOUND')) {
            object.playForSequence = onEnd => voice(`wavs/${object.definition.FILENAME}`, onEnd);
        }
        const pixel = new Animo(engine, parent, { TYPE: 'ANIMO', NAME: '__MAZE_ROUTE_PIXEL__',
            FILENAME: '$\\COMMON\\PIXEL.ANN', TOCANVAS: true, VISIBLE: true });
        pixel.loadSfx = async () => {}; scope.set(pixel.name, pixel);
        await pixel.init(); await pixel.applyDefaults(); await pixel.ready();
        const sequence = new Sequence(engine, parent, defs.SEQLAB);
        sequence.getAnimo = async filename => { assert.equal(filename, '$\\COMMON\\PIXEL.ANN'); return pixel; };
        scope.set(sequence.name, sequence); await sequence.init();
        const keyboard = new Keyboard(engine, parent, defs.KEYBOARD);
        scope.set(keyboard.name, keyboard); await keyboard.ready(); keyboard.SETAUTOREPEAT(false);
        const episode = new Type(engine, parent, { TYPE: 'EPISODE', NAME: 'PRZYGODA' });
        episode.GOTO = name => routes.push(name); scope.set(episode.name, episode);
        const screenshot = new Type(engine, parent, { TYPE: 'BEHAVIOUR', NAME: '__SCREENSHOT__' });
        screenshot.RUN = () => screenshots.push(true); scope.set(screenshot.name, screenshot);
        const teleportSound = get('SNDTELE'), playTeleport = teleportSound.PLAY.bind(teleportSound);
        teleportSound.PLAY = (...args) => { teleports++; return playTeleport(...args); };
        const ast = load('interpreter/parser.ts').parseCode(defs.__INIT__.CODE.code);
        const start = ast.findIndex(entry => entry.target?.ref?.name === 'BEHINITPLAYERS');
        assert.ok(start >= 0);
        await new Interpreter(new RuntimeContext(engine, null, defs.__INIT__.CODE.code)).execute(ast.slice(start + 1));
        const key = async (code, character, down) => {
            const event = new Event(down ? 'keydown' : 'keyup'); Object.assign(event, { code, key: character });
            window.dispatchEvent(event); await keyboard.tick();
        };
        const step = async () => {
            if (voices.length) voices.shift()();
            for (const object of scope.objects) await object.tick(1000 / 30);
            assert.ok(get('VARREXZYCIA').value > 0 && get('VARKRETZYCIA').value > 0, 'Both characters must survive the route');
            assert.deepEqual(routes, [], 'Walking must not enter the failure/restart route');
        };
        const arrow = (direction, down) => key(`Arrow${direction[0]}${direction.slice(1).toLowerCase()}`, direction, down);
        const walk = async (actor, direction) => {
            const before = [actor.GETCENTERX(), actor.GETCENTERY()], beforeTeleports = teleports;
            await arrow(direction, true);
            let tick = 0;
            for (; tick < 60 && actor.GETCENTERX() === before[0] && actor.GETCENTERY() === before[1]; tick++) await step();
            await arrow(direction, false);
            for (; tick < 90; tick++) { await step(); if (actor.GETEVENTNAME().startsWith('IDLE')) break; }
            assert.ok(tick < 90, 'Each arrow input must finish at the original idle animation');
            const after = [actor.GETCENTERX(), actor.GETCENTERY()];
            if (beforeTeleports === teleports) {
                const [dx, dy] = { UP: [0, -40], DOWN: [0, 40], LEFT: [-40, 0], RIGHT: [40, 0] }[direction];
                assert.deepEqual(after, [before[0] + dx, before[1] + dy], 'Each ordinary move must finish one authored tile');
            } else assert.notDeepEqual(after, before, 'The original teleport callback must move its selected actor');
            walked++;
        };
        const ferry = async (actor, column) => {
            const boat = get('ANNLODKA'), startX = actor.GETCENTERX(), endX = column * 40 + 20, right = endX > startX;
            assert.equal(actor.GETCENTERY(), 460);
            let tick = 0;
            for (; tick < 1800; tick++) {
                const x = boat.GETCENTERX();
                if (right ? boat.GETEVENTNAME() === '4' && x >= startX - 24 && x <= startX - 8
                    : boat.GETEVENTNAME() === '-4' && x <= startX + 24 && x >= startX + 8) break;
                await step();
            }
            assert.ok(tick < 1800, 'Wait for the moving ferry to approach the boarding platform');
            await arrow('DOWN', true);
            for (tick = 0; tick < 60 && actor.GETCENTERY() === 460; tick++) await step();
            await arrow('DOWN', false);
            for (; tick < 90; tick++) { await step(); if (actor.GETEVENTNAME().startsWith('IDLE')) break; }
            assert.equal(actor.GETCENTERY(), 500, 'Board the ferry through normal downward movement');
            for (tick = 0; tick < 1800 && Math.abs(actor.GETCENTERX() - endX) > 30; tick++) await step();
            assert.ok(tick < 1800, 'The original ferry callback must carry the actor toward the destination');
            await arrow('UP', true);
            for (tick = 0; tick < 1800 && actor.GETCENTERY() === 500; tick++) await step();
            await arrow('UP', false);
            for (; tick < 1830; tick++) { await step(); if (actor.GETEVENTNAME().startsWith('IDLE')) break; }
            assert.deepEqual([actor.GETCENTERX(), actor.GETCENTERY()], [endX, 460], 'Disembark through the original collision guard');
            crossings++;
        };
        // Numbers are ferry landing columns. Kretes must leave the entrance first to unblock Reksio.
        const paths = [
            { number: 2, moves: ['DOWN', 'DOWN', 'DOWN', 'DOWN', 'LEFT', 'DOWN', 'DOWN', 'DOWN', 'DOWN', 'RIGHT', 'DOWN',
                16, 4, 16, 4, 16, 14, 'UP', 'UP', 'RIGHT', 'UP', 'UP', 'RIGHT', 'UP', 'DOWN', 'LEFT', 'DOWN', 'DOWN',
                'LEFT', 'DOWN', 'DOWN', 16, 4, 16, 14, 'UP', 'UP', 'UP', 'UP', 'UP', 'UP', 'UP', 'UP', 'UP', 'LEFT',
                'DOWN', 'RIGHT', 'LEFT', 'DOWN', 'LEFT', 'RIGHT', 'UP', 'DOWN', 'DOWN', 'RIGHT', 'RIGHT', 'RIGHT', 'UP', 'UP', 'RIGHT'] },
            { number: 1, moves: ['RIGHT', 'DOWN', 'DOWN', 'DOWN', 'DOWN', 'LEFT', 'DOWN', 'DOWN', 'DOWN', 'DOWN', 'RIGHT',
                'DOWN', 14, 'UP', 'UP', 'UP', 'UP', 'UP', 'UP', 'UP', 'RIGHT', 'RIGHT', 'RIGHT', 'UP', 'UP'] },
        ];
        for (const { number, moves } of paths) {
            await key(`Digit${number}`, String(number), true); await key(`Digit${number}`, String(number), false);
            const actor = get(`ANNPLAYER${number - 1}`);
            assert.equal(get('VARPLAYERNAME').value, actor.name);
            for (const move of moves) typeof move === 'number' ? await ferry(actor, move) : await walk(actor, move);
        }
        assert.equal(get('BTNEXIT1').logic.enabled, true, 'Both characters must reach the far exit naturally');
        assert.deepEqual(get('ANNSWITCHMASK').clones.map(wall => wall.GETCFRAMEINEVENT()), [1, 1, 1, 1, 0, 0, 1]);
        assert.deepEqual([get('VARREXZYCIA').value, get('VARKRETZYCIA').value], [1, 2]);
        assert.deepEqual([walked, crossings, teleports], [74, 11, 4]);
        assert.ok(audio.includes('wavs/rex_r042.wav') && audio.includes('wavs/kretes_d047.wav'));
        const button = get('BTNEXIT1'), sprite = get(button.definition.GFXSTANDARD.objectName).getRenderObject();
        for (const event of ['pointerover', 'pointerdown', 'pointerup']) sprite.emit(event);
        await button.tick();
        assert.deepEqual(routes, ['ARCADE']); assert.equal(get('G_SARCADEOBJECTS').value, 'UNIVPIWNICA');
        assert.equal(screenshots.length, 1);
        assert.deepEqual(deserializeArray(memory.get('common/maze_fixture0.arr')), [0, 1, 1, 1, 1, 1, 0, 0, 1]);
        console.log(`MAZE 0 ROUTE: ${walked} keyboard tile moves, ${crossings} live ferry rides, ${teleports} teleports, linked switches, moving enemies and original saved exit passed`);
    } finally {
        assetLoader.loadSound = previousSound;
        assert.deepEqual(engine.scopeManager.destroy(), [], 'Maze route cleanup'); assert.equal(stage.children.length, 0);
        backgrounds.forEach(texture => texture.destroy(true));
        if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    }
}

async function verifyMazeRescueRoute() {
    await require('./verify-magicienii-maze-route.cjs')({ assets, createMazePuzzleFixture, load, Keyboard, Mouse,
        Interpreter, RuntimeContext, Type, Animo, Sequence, constructors }, 1);
}

async function verifyMazeCardRoute() {
    await require('./verify-magicienii-maze-route.cjs')({ assets, createMazePuzzleFixture, load, Keyboard, Mouse,
        Interpreter, RuntimeContext, Type, Animo, Sequence, constructors }, 2);
}

async function verifyMazeSpellControls() {
    const previousWindow = globalThis.window; globalThis.window = new EventTarget();
    const { engine, scope, parent, defs, get, stage, backgrounds } = await createMazePuzzleFixture(1, true);
    try {
        const mouse = new Mouse(engine, parent, defs.MOUSE), keyboard = new Keyboard(engine, parent, defs.KEYBOARD);
        scope.set(mouse.name, mouse); scope.set(keyboard.name, keyboard); await keyboard.ready(); keyboard.SETAUTOREPEAT(false);
        // Learned spells and dialogue audio are inputs; drawing, projectiles, curses and expiry use the original scripts.
        const spellbook = new constructors.ARRAY(engine, parent, { TYPE: 'ARRAY', NAME: 'G_ARRREXSPELLS' });
        spellbook.restoreCheckpointValue([1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 0]); scope.set(spellbook.name, spellbook);
        const cursor = new Type(engine, parent, { TYPE: 'CLASS_INSTANCE', NAME: 'G_CURSOR' });
        cursor.SETPOSITIONNOCALL = () => {}; scope.set(cursor.name, cursor);
        const episode = new Type(engine, parent, { TYPE: 'EPISODE', NAME: 'PRZYGODA' });
        episode.GETCURRENTSCENE = () => 'LABIRYNT'; scope.set(episode.name, episode);
        await get('BEHINITSPELL').RUN();
        const code = defs.__INIT__.CODE.code, ast = load('interpreter/parser.ts').parseCode(code);
        const start = ast.findIndex(entry => entry.target?.ref?.name === 'BEHINITPLAYERS'); assert.ok(start >= 0);
        await new Interpreter(new RuntimeContext(engine, null, code)).execute(ast.slice(start + 1));
        assert.deepEqual(get('ARRAYSPELLTYPE').value, ['SLEEP', 'FROG', 'FLY', 'BUDYN', 'SWIRL', 'DARK']);
        const key = async (code, character, down) => {
            const event = new Event(down ? 'keydown' : 'keyup'); Object.assign(event, { code, key: character });
            window.dispatchEvent(event); await keyboard.tick();
        };
        const step = async (count = 1) => {
            for (let tick = 0; tick < count; tick++) for (const object of scope.objects) await object.tick(1000 / 30);
        };
        const select = async number => { await key(`Digit${number}`, String(number), true); await key(`Digit${number}`, String(number), false); };
        const right = async () => { await key('ArrowRight', 'RIGHT', true); await step(); await key('ArrowRight', 'RIGHT', false); await step(20); };
        await select(2); await right(); await select(1); await right();
        const rex = get('ANNPLAYER0'), companion = get('ANNPLAYER1');
        const positions = () => [rex.GETCENTERX(), rex.GETCENTERY(), companion.GETCENTERX(), companion.GETCENTERY()];
        assert.deepEqual(positions(), [100, 100, 140, 100], 'Move into casting range using the original keyboard controls');
        const draw = async spell => {
            let x = 400, y = 300;
            const pointer = () => ({ button: 0, screen: { x, y } });
            mouse.onMouseMove(pointer()); mouse.SETPOSITION(x, y); await mouse.tick(16);
            await get('VARMOUSEPOSX').SET(x); await get('VARMOUSEPOSY').SET(y);
            mouse.handleClickEvent(pointer(), 'click'); await mouse.tick(16);
            for (const angle of get(`ARRPATTERN${spell}`).value) {
                x += Math.round(60 * Math.cos(angle * Math.PI / 180)); y += Math.round(60 * Math.sin(angle * Math.PI / 180));
                mouse.onMouseMove(pointer()); await mouse.tick(16);
            }
            mouse.handleClickEvent(pointer(), 'release'); await mouse.tick(16);
        };
        const cast = async () => {
            const pointer = { button: 0, screen: { x: 400, y: 300 } };
            mouse.handleClickEvent(pointer, 'click'); await mouse.tick(16);
            mouse.handleClickEvent(pointer, 'release'); await mouse.tick(16); await step(30);
        };
        for (const [spell, name] of ['SLEEP', 'FROG', 'FLY', 'BUDYN', 'SWIRL', 'DARK'].entries()) {
            await draw(spell); assert.equal(get('ARRSPELLTYPE').value[0], spell);
            assert.equal(get('VARPLAYERSPELLTYPE').value, spell, 'A recognized learned shape must arm the original spell');
            await cast();
            assert.deepEqual(positions(), [100, 100, 140, 100], `${name} must not move either character off the tile grid`);
            assert.equal(get('ANNPLAYERELAPSE_2').ISPLAYING(), true, `${name} must hit through the real projectile callback`);
            if (name === 'DARK') assert.equal(get('ANNPLAYERDARKELAPSE_2').ISPLAYING(), true);
            else assert.equal(get('ARRAYPLAYERSSTATE').value[1], name);
            if (name === 'SLEEP') assert.equal(companion.ISPLAYING(), false);
            if (name === 'FROG') assert.match(companion.GETEVENTNAME(), /FROG/);
            if (name === 'FLY' || name === 'BUDYN') assert.equal(companion.fps, name === 'FLY' ? 16 : 4);
            if (name === 'SWIRL') {
                await select(2); assert.deepEqual(get('ARRAYKEYBOARD').value, ['DOWN', 'UP', 'RIGHT', 'LEFT']); await select(1);
            }
            let tick = 0;
            for (; tick < 2400 && (get('ANNPLAYERELAPSE_2').ISPLAYING() || get('ANNPLAYERDARKELAPSE_2').ISPLAYING()); tick++) await step();
            assert.ok(tick < 2400, `${name} must expire through its real animation timer`);
            assert.deepEqual(positions(), [100, 100, 140, 100], `${name} recovery must preserve both tile centers`);
            assert.equal(get('ARRAYPLAYERSSTATE').value[1], 'NULL'); assert.equal(companion.fps, 30);
            assert.equal(companion.ISPLAYING(), true); assert.equal(get('VARMOUSESPEED').value, 1);
            assert.deepEqual(get('ARRAYKEYBOARD').value, ['UP', 'DOWN', 'LEFT', 'RIGHT']);
        }
        assert.equal(get('ANNSPELL1').clones.length, 6);
        for (const spell of [7, 8, 9, 10]) {
            await draw(spell); assert.equal(get('ARRSPELLTYPE').value[0], spell);
            assert.equal(get('VARPLAYERSPELLTYPE').value, -1, 'A counterspell must not arm an invalid projectile');
        }
        assert.deepEqual(get('ARRAYREXIMUNE').value, ['FROG', 'FLY', 'BUDYN', 'SWIRL']);
        for (const spell of [6, 11]) { await draw(spell); assert.equal(get('ARRSPELLTYPE').value[0], -1); }
        await spellbook.CHANGEAT(0, 0); await draw(0);
        assert.equal(get('ARRSPELLTYPE').value[0], -1, 'The original learned-spell guard must reject an unavailable spell');
        assert.equal(get('VARPLAYERSPELLTYPE').value, -1);
        assert.deepEqual([get('VARREXZYCIA').value, get('VARKRETZYCIA').value], [3, 3]);
        console.log('MAZE SPELLS: six drawn projectile hits and native curse recoveries preserve tile centers; four counterspells and learned-spell guards passed');
    } finally {
        assert.deepEqual(engine.scopeManager.destroy(), [], 'Maze spell cleanup'); assert.equal(stage.children.length, 0);
        backgrounds.forEach(texture => texture.destroy(true));
        if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    }
}

async function verifyMazeEnemySpellHits() {
    for (const spell of ['SLEEP', 'FROG', 'FLY', 'BUDYN', 'SWIRL', 'DARK']) {
        const { engine, scope, get, stage, backgrounds } = await createMazePuzzleFixture(1);
        try {
            const enemy = get('ANNENEMY0_2'), elapsed = get('ANNENEMY0ELAPSE_2');
            await get('ANNSPELL1').CLONE(1);
            const beam = get('ANNSPELL1_1');
            await beam.SETANCHOR('CENTER'); await beam.PLAY(`${spell}_RIGHT_R`);
            // Projectile placement and unrelated actors are fixture boundaries; hit testing and curse callbacks are real.
            await beam.SETPOSITION(beam.positionX + enemy.GETCENTERX() - beam.GETCENTERX(),
                beam.positionY + enemy.GETCENTERY() - beam.GETCENTERY());
            beam.ADDBEHAVIOUR('ONFRAMECHANGED', 'BEHMOVESPELL');
            assert.equal(get('CANVASOBSERVER').GETGRAPHICSAT(beam.GETCENTERX(), beam.GETCENTERY(),
                false, 300, 300, false), enemy.name);
            await beam.tick(1000 / 16);
            assert.equal(get('ARRAYENEMY0STATE').value[1], spell, `${spell} must hit the guard through the original projectile callback`);
            assert.equal(beam.ISPLAYING(), false); assert.equal(beam.ISVISIBLE(), false);
            assert.equal(elapsed.ISPLAYING(), true);
            if (spell === 'SLEEP') assert.equal(enemy.ISPLAYING(), false);
            if (spell === 'FROG') assert.match(enemy.GETEVENTNAME(), /FROG/);
            if (spell === 'FLY' || spell === 'BUDYN') assert.equal(enemy.fps, spell === 'FLY' ? 4 : 8);
            if (spell === 'DARK') for (const suffix of ['FIELD', 'MASK']) {
                const helper = get(`ANNENEMY0${suffix}_2`);
                assert.deepEqual([helper.positionX, helper.positionY], [-40, -40], 'Darkness must disable guard contact');
            }
            const actors = scope.objects.filter(object => /^ANNENEMY0(?:_2|(?:FIELD|MASK|MMASK|ELAPSE|CURSE)_2)$/.test(object.name));
            const played = new Set();
            const step = async count => {
                for (let tick = 0; tick < count; tick++) {
                    for (const actor of actors) await actor.tick(1000 / 30);
                    played.add(enemy.GETEVENTNAME());
                }
            };
            if (spell === 'DARK') {
                const duration = elapsed.GETNOFINEVENT('PLAY') * 30 / elapsed.fps;
                await step(Math.ceil(duration / 2));
                const before = elapsed.GETCFRAMEINEVENT();
                assert.ok(before > 1 && elapsed.ISPLAYING());
                await get('ANNSPELL1').CLONE(1);
                const repeated = get('ANNSPELL1_2');
                await repeated.SETANCHOR('CENTER'); await repeated.PLAY('DARK_RIGHT_R');
                await repeated.SETPOSITION(repeated.positionX + enemy.GETCENTERX() - repeated.GETCENTERX(),
                    repeated.positionY + enemy.GETCENTERY() - repeated.GETCENTERY());
                repeated.ADDBEHAVIOUR('ONFRAMECHANGED', 'BEHMOVESPELL');
                await repeated.tick(1000 / 16);
                assert.equal(repeated.ISPLAYING(), false, 'The second projectile must hit, not merely find an already-dark guard');
                assert.ok(elapsed.GETCFRAMEINEVENT() < before, 'A confirmed second hit must restart the original curse timer');
                await step(Math.ceil(duration * 0.65));
                assert.equal(elapsed.ISPLAYING(), true, 'A refreshed curse must outlive the first hit\'s original expiry');
                assert.equal(get('ARRAYENEMY0STATE').value[1], 'DARK');
                for (const suffix of ['FIELD', 'MASK']) {
                    const helper = get(`ANNENEMY0${suffix}_2`);
                    assert.deepEqual([helper.positionX, helper.positionY], [-40, -40]);
                }
            }
            let tick = 0;
            for (; tick < 2400 && elapsed.ISPLAYING(); tick++) await step(1);
            assert.ok(tick < 2400, `${spell} must expire through the guard's native animation timer`);
            if (spell === 'FROG') {
                assert.ok([...played].some(name => /^(UP|DOWN|LEFT|RIGHT)_FROG$/.test(name)), 'The missing-idle adapter must enter the real frog patrol animations');
                assert.doesNotMatch(enemy.GETEVENTNAME(), /FROG/, 'The original expiry callback must restore the normal guard');
            }
            assert.equal(get('ARRAYENEMY0STATE').value[1], 'NULL');
            assert.equal(enemy.ISPLAYING(), true); assert.equal(enemy.fps, 16);
            for (tick = 0; tick < 60 && get('ANNENEMY0MASK_2').positionX < 0; tick++) {
                for (const actor of actors) await actor.tick(1000 / 30);
            }
            assert.ok(get('ANNENEMY0MASK_2').positionX >= 0, 'Guard collision must return after the curse expires');
        } finally {
            assert.deepEqual(engine.scopeManager.destroy(), [], 'Maze enemy spell cleanup'); assert.equal(stage.children.length, 0);
            backgrounds.forEach(texture => texture.destroy(true));
        }
    }
    console.log('MAZE GUARD SPELLS: six original projectile hits, frog patrol, confirmed darkness refresh, native expiry and restored guard collision passed');
}

async function verifyMazeRecovery() {
    const previousWindow = globalThis.window, assetLoader = load('filesystem/assetsLoader.ts');
    const loadSound = assetLoader.loadSound;
    globalThis.window = new EventTarget();
    try {
        for (const recovery of ['FAILED', 'RESTART']) {
            const fixture = await createMazePuzzleFixture(0);
            const { engine, parent, scope, defs, get, stage, backgrounds } = fixture;
            const voices = [], routes = [], screenshots = [];
            const voice = onEnd => {
                const instance = { isPlaying: true, stop() { this.isPlaying = false; }, pause() {}, resume() {} };
                voices.push(() => { instance.isPlaying = false; onEnd?.(); });
                return instance;
            };
            // Playback completion is driven here; sequence parsing, PIXEL animation and callbacks are real.
            assetLoader.loadSound = async () => ({ play: options => voice(options?.onEnd) });
            for (const object of scope.objects.filter(object => object.definition.TYPE === 'SOUND')) {
                object.playForSequence = onEnd => voice(onEnd);
            }
            const keyboard = new Keyboard(engine, parent, defs.KEYBOARD);
            const mouse = new Mouse(engine, parent, defs.MOUSE);
            scope.set('KEYBOARD', keyboard); scope.set('MOUSE', mouse);
            const episode = new Type(engine, parent, { TYPE: 'EPISODE', NAME: 'PRZYGODA' });
            episode.GOTO = scene => routes.push(scene); scope.set(episode.name, episode);
            const screenshot = new Type(engine, parent, { TYPE: 'BEHAVIOUR', NAME: '__SCREENSHOT__' });
            screenshot.RUN = () => screenshots.push(true); scope.set(screenshot.name, screenshot);
            const pixel = new Animo(engine, parent, { TYPE: 'ANIMO', NAME: '__RECOVERY_PIXEL__',
                FILENAME: '$\\COMMON\\PIXEL.ANN', TOCANVAS: true, VISIBLE: true });
            pixel.loadSfx = async () => {}; scope.set(pixel.name, pixel);
            const sequence = new Sequence(engine, parent, defs.SEQLAB);
            sequence.getAnimo = async filename => {
                assert.equal(filename, '$\\COMMON\\PIXEL.ANN'); return pixel;
            };
            scope.set(sequence.name, sequence);
            try {
                await pixel.init(); await pixel.applyDefaults(); await pixel.ready(); await sequence.init();
                const active = scope.objects.filter(object => object instanceof Animo && object.isPlaying);
                assert.ok(active.some(object => /^ANNENEMY\d_\d$/.test(object.name)), 'Recovery must freeze moving enemy clones too');
                if (recovery === 'FAILED') {
                    await get('VARREXZYCIA').SET(0); await get('BEHRESTARTLEVEL').RUN();
                } else {
                    const button = get('BTNRESTART'), sprite = get(button.definition.GFXSTANDARD.objectName).getRenderObject();
                    for (const event of ['pointerover', 'pointerdown', 'pointerup']) sprite.emit(event);
                    await button.tick();
                }
                assert.equal(parent.paused, false, 'Recovery must not freeze the sequence tick queue');
                assert.equal(keyboard.ISENABLED(), false); assert.equal(mouse.signalsDisabled, true);
                assert.equal(get('BTNRESTART').logic.enabled, false, 'Recovery must reject repeated restart clicks');
                assert.equal(sequence.ISPLAYING(), true);
                for (const actor of active.filter(actor => actor !== pixel)) assert.equal(actor.ISPLAYING(), false, actor.name);
                let spoken = 0;
                for (let tick = 0; tick < 120 && !routes.length; tick++) {
                    if (voices.length) { voices.shift()(); spoken++; }
                    await sequence.tick(62.5); await pixel.tick(62.5);
                }
                assert.equal(spoken, recovery === 'FAILED' ? 1 : 2);
                assert.deepEqual(routes, ['LABIRYNT'], 'Original sequence completion must request a fresh maze');
                assert.equal(sequence.ISPLAYING(), false); assert.equal(screenshots.length, 1);
                assert.equal(get('G_SARCADEOBJECTS').value, '0');
            } finally {
                assert.deepEqual(engine.scopeManager.destroy(), [], `${recovery} recovery cleanup`);
                assert.equal(stage.children.length, 0); backgrounds.forEach(texture => texture.destroy(true));
            }
        }
    } finally {
        assetLoader.loadSound = loadSound;
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
    console.log('MAZE RECOVERY: original failure and restart callbacks, frozen actors/input, real sequences and fresh-maze requests passed');
}

async function createFredFixture() {
    const fixture = await createArcadeFixture('FRED', 'Fred', 'Fred.cnv');
    const { engine, parent, scope, defs, get } = fixture, stage = engine.app.stage;
    const scenePath = 'dane/game/przygoda/fred';
    parent.getRelativePath = name => normalizePath(name.startsWith('$') ? name.slice(1) : `${scenePath}/${name}`);
    engine.resolvePath = async (name, base = scenePath) => normalizePath(name.startsWith('$') ? name.slice(1) : `${base}/${name}`);
    engine.filesystem = new Filesystem({
        hasFile: name => fs.existsSync(path.join(assets, name)), registerLogicalFilenames() {},
        getRawFile: async name => bytes(path.join(assets, name)),
    }, { get: async () => null, has: async () => false }, engine.compat);
    engine.rendering.sortObjects = () => stage.children.sort((a, b) => a.zIndex - b.zIndex);
    engine.rendering.addToStage = sprite => { stage.addChild(sprite); engine.rendering.sortObjects(); };
    engine.rendering.removeFromStage = sprite => stage.removeChild(sprite);
    for (const def of Object.values(defs).filter(def => ['ANIMO', 'IMAGE'].includes(def.TYPE))) {
        const actor = new (def.TYPE === 'ANIMO' ? Animo : Image)(engine, parent, def);
        if (actor instanceof Animo) actor.loadSfx = async () => {};
        scope.set(actor.name, actor); await actor.init(); await actor.applyDefaults(); await actor.ready();
    }
    await get('PATBOARD').applyDefaults();
    for (const def of Object.values(defs).filter(def => def.TYPE === 'BUTTON')) {
        const button = new Button(engine, parent, def);
        scope.set(button.name, button); button.init(); await button.applyDefaults();
    }
    const keyboard = new Keyboard(engine, parent, defs.KEYBOARD);
    scope.set(keyboard.name, keyboard); await keyboard.ready(); keyboard.SETAUTOREPEAT(false);
    scope.set('TIMERSEQ', new Timer(engine, parent, defs.TIMERSEQ));
    const ast = load('interpreter/parser.ts').parseCode(defs.__INIT__.CODE.code);
    const start = ast.findIndex(entry => entry.type === 'FunctionCall' && entry.target?.ref?.name === 'VARENERGIA');
    assert.ok(start > 0, 'Only global menu/audio setup may be omitted from the Fred fixture');
    await new Interpreter(new RuntimeContext(engine, null, defs.__INIT__.CODE.code)).execute(ast.slice(start));
    const step = async count => {
        for (let tick = 0; tick < count && !parent.paused; tick++) {
            // Ambient chatter scheduling is outside the deterministic movement/recovery fixture.
            for (const object of scope.objects.filter(object => !(object instanceof Timer))) await object.tick(1000 / 60);
        }
    };
    const press = async (direction, down) => {
        const event = new Event(down ? 'keydown' : 'keyup'); Object.assign(event, { code: `Arrow${direction}`, key: direction });
        window.dispatchEvent(event); await keyboard.tick();
    };
    const key = async (direction, ticks) => {
        await press(direction, true); await step(ticks); await press(direction, false); await step(3);
    };
    return { ...fixture, stage, step, key, press };
}

async function verifyFredRoute() {
    const previousWindow = globalThis.window;
    globalThis.window = new EventTarget();
    const { engine, parent, scope, get, stage, step, press, key } = await createFredFixture();
    const routes = [], screenshots = [];
    const episode = new Type(engine, parent, { TYPE: 'EPISODE', NAME: 'PRZYGODA' });
    episode.GOTO = scene => routes.push(scene); scope.set(episode.name, episode);
    const screenshot = new Type(engine, parent, { TYPE: 'BEHAVIOUR', NAME: '__SCREENSHOT__' });
    screenshot.RUN = () => screenshots.push(true); scope.set(screenshot.name, screenshot);
    scope.set('G_SARCADEOBJECTS', new constructors.STRING(engine, parent,
        { TYPE: 'STRING', NAME: 'G_SARCADEOBJECTS', VALUE: 'FRED' }));
    try {
        // Turns from the shipped alpha map; only real keyboard events and animation ticks move the player.
        const turns = [[11,69],[11,56],[15,56],[15,52],[11,52],[11,48],[9,48],[9,40],
            [11,40],[11,34],[7,34],[7,32],[3,32],[3,30],[1,30],[1,26],[3,26],[3,18],
            [5,18],[5,16],[7,16],[7,14],[9,14],[9,8],[11,8],[11,4],[9,4],[9,2],[5,2],[5,0],[1,0]];
        assert.equal(get('PATBOARD').getRenderObject().children.length, 72);
        const start = [get('VARPLAYERX').value, get('VARPLAYERY').value];
        await key('Down', 60);
        assert.deepEqual([get('VARPLAYERX').value, get('VARPLAYERY').value], start,
            'The real map must reject descending below the starting platform');
        for (const [x, y] of turns) {
            const current = [get('VARPLAYERX').value, get('VARPLAYERY').value];
            const axis = Math.floor(current[0] / 50) === x ? 1 : 0;
            const target = axis ? y * 50 + 5 : x * 50 + (y === 0 ? 5 : 25);
            const sign = Math.sign(target - current[axis]);
            const direction = axis ? (sign < 0 ? 'Up' : 'Down') : (sign < 0 ? 'Left' : 'Right');
            await press(direction, true);
            let ticks = 0;
            while (sign * (target - get(axis ? 'VARPLAYERY' : 'VARPLAYERX').value) > 0 && !routes.length && ticks++ < 1500) {
                await step(1);
            }
            await press(direction, false); await step(3);
            assert.ok(ticks < 1500, `Fred route stalled before ${x},${y}`);
            assert.equal(parent.paused, false); assert.ok(get('VARENERGIA').value > 0);
        }
        assert.deepEqual(routes, ['ARCADE'], 'Reaching the actual exit must return to the story');
        assert.equal(get('G_SARCADEOBJECTS').value, 'KROLOWA');
        assert.equal(screenshots.length, 1);
        assert.ok(get('VARSCROLL').value >= 2990, 'The route must scroll the entire 3600-pixel map');
        assert.ok(get('VARENERGIA').value < 200, 'Real moving-enemy collisions must remain active');
    } finally {
        assert.deepEqual(engine.scopeManager.destroy(), [], 'Fred route cleanup');
        assert.equal(stage.children.length, 0);
        if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    }
    console.log('FRED ROUTE: 72 real tiles, keyboard-only full-map traversal, scrolling, enemy damage and KROLOWA story return passed');
}

async function verifyFredRecovery() {
    const previousWindow = globalThis.window, assetLoader = load('filesystem/assetsLoader.ts');
    const loadSound = assetLoader.loadSound;
    globalThis.window = new EventTarget();
    try {
        for (const recovery of ['FAILED', 'RESTARTBTN']) {
            const { engine, parent, scope, defs, get, stage, step } = await createFredFixture();
            const voices = [], routes = [], screenshots = [];
            assetLoader.loadSound = async () => ({ play: options => {
                const instance = { isPlaying: true, stop() { this.isPlaying = false; }, pause() {}, resume() {} };
                voices.push(() => { instance.isPlaying = false; options?.onEnd?.(); }); return instance;
            } });
            const episode = new Type(engine, parent, { TYPE: 'EPISODE', NAME: 'PRZYGODA' });
            episode.GOTO = scene => routes.push(scene); scope.set(episode.name, episode);
            const screenshot = new Type(engine, parent, { TYPE: 'BEHAVIOUR', NAME: '__SCREENSHOT__' });
            screenshot.RUN = () => screenshots.push(true); scope.set(screenshot.name, screenshot);
            const pixel = new Animo(engine, parent, { TYPE: 'ANIMO', NAME: '__RECOVERY_PIXEL__',
                FILENAME: '$\\COMMON\\PIXEL.ANN', TOCANVAS: true, VISIBLE: true });
            pixel.loadSfx = async () => {}; scope.set(pixel.name, pixel);
            const sequence = new Sequence(engine, parent, defs.SEQNARRATOR);
            sequence.getAnimo = async filename => {
                assert.equal(filename, '$\\COMMON\\PIXEL.ANN'); return pixel;
            };
            scope.set(sequence.name, sequence);
            try {
                await pixel.init(); await pixel.applyDefaults(); await pixel.ready(); await sequence.init();
                if (recovery === 'FAILED') {
                    await get('VARENERGIA').SET(0);
                    assert.equal(get('ANNPLAYER').ISPLAYING(), false);
                    assert.equal(get('ANNCOLL').ISPLAYING(), false);
                    for (const enemy of get('GROUPENEMY').objects) assert.equal(enemy.ISPLAYING(), false);
                    assert.equal(get('KEYBOARD').ISENABLED(), false);
                    assert.equal(get('BTNRESTART').logic.enabled, false);
                    assert.equal(get('TIMERSEQ').enabled, false);
                } else {
                    const button = get('BTNRESTART'), sprite = get(button.definition.GFXSTANDARD.objectName).getRenderObject();
                    for (const event of ['pointerover', 'pointerdown', 'pointerup']) sprite.emit(event);
                    await button.tick();
                }
                assert.equal(parent.paused, false, 'Failure dialogue must retain its tick processor');
                assert.equal(sequence.ISPLAYING(), true);
                let spoken = 0;
                for (let tick = 0; tick < 240 && !routes.length; tick++) {
                    if (voices.length) { voices.shift()(); spoken++; }
                    await step(1);
                }
                assert.ok(spoken > 0, `${recovery} must finish its original voice sequence`);
                assert.deepEqual(routes, ['FRED']); assert.equal(screenshots.length, 1);
                assert.equal(sequence.ISPLAYING(), false);
            } finally {
                assert.deepEqual(engine.scopeManager.destroy(), [], `${recovery} Fred cleanup`);
                assert.equal(stage.children.length, 0);
            }
        }
    } finally {
        assetLoader.loadSound = loadSound;
        if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    }
    console.log('FRED RECOVERY: original failure/restart sequences, actor/input freeze and fresh-scene requests passed');
}

async function verifyCupsPuzzle() {
    const assetLoader = load('filesystem/assetsLoader.ts'), previousLoadSound = assetLoader.loadSound;
    const voices = [], routes = [], screenshots = [];
    assetLoader.loadSound = async () => ({ play: options => {
        const instance = { isPlaying: true, stop() { this.isPlaying = false; }, pause() {}, resume() {} };
        voices.push(() => { instance.isPlaying = false; options?.onEnd?.(); }); return instance;
    } });
    const { engine, parent, scope, defs, get } = await createArcadeFixture('KUBKI', 'Kubki', 'Kubki.cnv');
    const scenePath = 'dane/game/przygoda/kubki', stage = engine.app.stage;
    parent.getRelativePath = name => normalizePath(name.startsWith('$') ? name.slice(1) : `${scenePath}/${name}`);
    engine.resolvePath = async (name, base = scenePath) => normalizePath(name.startsWith('$') ? name.slice(1) : `${base}/${name}`);
    engine.filesystem = new Filesystem({
        hasFile: name => fs.existsSync(path.join(assets, name)), registerLogicalFilenames() {},
        getRawFile: async name => bytes(path.join(assets, name)),
    }, { get: async () => null, has: async () => false }, engine.compat);
    engine.rendering.sortObjects = () => stage.children.sort((a, b) => a.zIndex - b.zIndex);
    engine.rendering.addToStage = sprite => { stage.addChild(sprite); engine.rendering.sortObjects(); };
    engine.rendering.removeFromStage = sprite => stage.removeChild(sprite);
    try {
        for (const def of Object.values(defs).filter(def => ['ANIMO', 'IMAGE'].includes(def.TYPE))) {
            const actor = new (def.TYPE === 'ANIMO' ? Animo : Image)(engine, parent, def);
            if (actor instanceof Animo) actor.loadSfx = async () => {};
            scope.set(actor.name, actor); await actor.init(); await actor.applyDefaults(); await actor.ready();
        }
        for (const def of Object.values(defs).filter(def => def.TYPE === 'BUTTON')) {
            const button = new Button(engine, parent, def);
            scope.set(button.name, button); button.init(); await button.applyDefaults();
        }
        const mouse = new Mouse(engine, parent, defs.MOUSE); scope.set(mouse.name, mouse);
        const episode = new Type(engine, parent, { TYPE: 'EPISODE', NAME: 'PRZYGODA' });
        episode.GOTO = scene => routes.push(scene); scope.set(episode.name, episode);
        const screenshot = new Type(engine, parent, { TYPE: 'BEHAVIOUR', NAME: '__SCREENSHOT__' });
        screenshot.RUN = () => screenshots.push(true); scope.set(screenshot.name, screenshot);
        for (const name of ['G_SLASTOBJECTS', 'G_SARCADEOBJECTS']) scope.set(name,
            new constructors.STRING(engine, parent, { TYPE: 'STRING', NAME: name, VALUE: 'KUBKI' }));
        const pixel = new Animo(engine, parent, { TYPE: 'ANIMO', NAME: '__CUPS_PIXEL__',
            FILENAME: '$\\COMMON\\PIXEL.ANN', TOCANVAS: true, VISIBLE: true });
        pixel.loadSfx = async () => {}; scope.set(pixel.name, pixel);
        const sequence = new Sequence(engine, parent, defs.SEQKUBKI);
        sequence.getAnimo = async filename => { assert.equal(filename, '$\\COMMON\\PIXEL.ANN'); return pixel; };
        scope.set(sequence.name, sequence);
        await pixel.init(); await pixel.applyDefaults(); await pixel.ready(); await sequence.init();
        const code = defs.__INIT__.CODE.code, ast = load('interpreter/parser.ts').parseCode(code);
        const start = ast.findIndex(entry => entry.type === 'FunctionCall' && entry.target?.ref?.name === 'ANNKUBEK0');
        assert.ok(start > 0);
        await new Interpreter(new RuntimeContext(engine, null, code)).execute(ast.slice(start));
        const step = async () => { for (const object of scope.objects) await object.tick(1000 / 60); };
        const finishVoice = async () => {
            for (let tick = 0; tick < 240 && sequence.ISPLAYING(); tick++) {
                if (voices.length) voices.shift()(); await step();
            }
            assert.equal(sequence.ISPLAYING(), false);
        };
        await finishVoice();
        const move = async point => {
            const event = { screen: point, button: 0 };
            mouse.onMouseMove(event); stage.emit('pointermove', event); await step();
        };
        const center = name => {
            const sprite = get(name).getRenderObject(), bounds = sprite.getBounds();
            return { x: Math.floor(bounds.x + bounds.width / 2), y: Math.floor(bounds.y + bounds.height / 2) };
        };
        const drag = async (buttonName, from, to) => {
            await move(from);
            const button = get(buttonName), graphic = get(button.GETSTD()), sprite = graphic?.getRenderObject();
            assert.ok(sprite, `${buttonName} must have a real graphic at drag start`);
            assert.ok(sprite.containsPoint(from, true), `${buttonName} drag must start on a real opaque pixel`);
            const before = sprite.getBounds().clone();
            sprite.emit('pointerover', { screen: from }); sprite.emit('pointerdown', { screen: from }); await step();
            assert.equal(get('VARDRAGGING').value, 1);
            for (let part = 1; part <= 4; part++) {
                const pointer = { x: Math.round(from.x + (to.x - from.x) * part / 4),
                    y: Math.round(from.y + (to.y - from.y) * part / 4) };
                await move(pointer);
                const bounds = sprite.getBounds();
                assert.ok(Math.abs(bounds.x + bounds.width / 2 - before.x - before.width / 2 - pointer.x + from.x) < 1,
                    `${buttonName} must stay under the pointer horizontally`);
                assert.ok(Math.abs(bounds.y + bounds.height / 2 - before.y - before.height / 2 - pointer.y + from.y) < 1,
                    `${buttonName} must stay under the pointer vertically`);
            }
            stage.emit('pointerup', { screen: to }); await step();
            assert.equal(get('VARDRAGGING').value, 0);
            assert.equal(stage.listenerCount('pointermove'), 0); assert.equal(stage.listenerCount('pointerup'), 0);
        };
        await move({ x: 780, y: 30 }); assert.equal(get('BTNKUBEK').GETSTD(), 'UNKNOWN');
        await drag('BTNMONETA0', center('ANNMONETA0'), { x: 780, y: 30 });
        assert.deepEqual(get('ARRAYMONETA0').value, [-1, -1], 'Invalid drops must return a coin to its start');
        await drag('BTNKUBEK', center('ANNDRAGKUBEK0'), center('IMGFIELD1'));
        assert.equal(get('ANNKUBEK0').GETFRAMENAME(), '0'); assert.equal(get('ANNKUBEK1').GETFRAMENAME(), '2');
        await drag('BTNKUBEK', center('ANNDRAGKUBEK2'), center('IMGFIELD1'));
        assert.equal(get('ANNKUBEK2').GETFRAMENAME(), '0'); assert.equal(get('ANNKUBEK1').GETFRAMENAME(), '3');
        for (let coin = 0; coin < 3; coin++) {
            await drag(`BTNMONETA${coin}`, center(`ANNMONETA${coin}`), center('IMGMONFIELD1'));
            assert.deepEqual(get(`ARRAYMONETA${coin}`).value, [1, '3']);
        }
        assert.equal(sequence.ISPLAYING(), true, 'The original three-coins/three-cups guard must trigger success');
        await finishVoice(); assert.deepEqual(routes, ['ARCADE']); assert.equal(screenshots.length, 1);
        assert.equal(get('G_SLASTOBJECTS').value, 'KUBKI'); assert.equal(get('G_SARCADEOBJECTS').value, 'SEZAM');
        console.log('CUPS: real mouse/button dragging, invalid-drop recovery, three nested cups, all three coins and SEZAM story return passed');
    } finally {
        assetLoader.loadSound = previousLoadSound;
        assert.deepEqual(engine.scopeManager.destroy(), [], 'Cups cleanup'); assert.equal(stage.children.length, 0);
    }
}

async function createShooterFixture(level) {
    const fixture = await createArcadeFixture('SHOOTER', 'Shooter', 'Shooter.cnv', ['cnvSpell.cnv', 'cnvBkg0.cnv']);
    const { engine, parent, scope, defs, get } = fixture, stage = engine.app.stage;
    const scenePath = 'dane/game/przygoda/shooter', memory = new Map(), backgrounds = [], voices = [], routes = [], screenshots = [];
    parent.getRelativePath = name => normalizePath(name.startsWith('$') ? name.slice(1) : `${scenePath}/${name}`);
    engine.resolvePath = async (name, base = scenePath) => normalizePath(name.startsWith('$') ? name.slice(1) : `${base}/${name}`);
    engine.filesystem = new Filesystem({
        hasFile: name => fs.existsSync(path.join(assets, name)), registerLogicalFilenames() {},
        getRawFile: async name => {
            if (!fs.existsSync(path.join(assets, name))) throw new FileNotFoundError(name);
            return bytes(path.join(assets, name));
        },
    }, { get: async name => memory.get(name) ?? null, has: async name => memory.has(name),
        save: async (name, value) => { assert.equal(name, 'common/shooter0.arr'); memory.set(name, value.slice(0)); } }, engine.compat);
    engine.rendering.sortObjects = () => stage.children.sort((a, b) => a.zIndex - b.zIndex);
    engine.rendering.addToStage = sprite => { stage.addChild(sprite); engine.rendering.sortObjects(); };
    engine.rendering.removeFromStage = sprite => stage.removeChild(sprite);
    engine.rendering.setBackground = texture => backgrounds.push(texture);
    const assetLoader = load('filesystem/assetsLoader.ts'), previousLoadSound = assetLoader.loadSound;
    const previousWindow = globalThis.window; globalThis.window = new EventTarget();
    const voice = onEnd => {
        const instance = { isPlaying: true, stop() { this.isPlaying = false; }, pause() {}, resume() {} };
        voices.push(() => { if (instance.isPlaying) { instance.isPlaying = false; onEnd?.(); } }); return instance;
    };
    assetLoader.loadSound = async () => ({ play: options => voice(options?.onEnd) });
    const dispose = () => {
        const cleanup = engine.scopeManager.destroy(); backgrounds.forEach(texture => texture.destroy(true));
        assetLoader.loadSound = previousLoadSound;
        if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
        assert.deepEqual(cleanup, [], 'Shooter cleanup'); assert.equal(stage.children.length, 0);
    };
    try {
        for (const def of Object.values(defs).filter(def => ['ANIMO', 'IMAGE'].includes(def.TYPE))) {
            const actor = new (def.TYPE === 'ANIMO' ? Animo : Image)(engine, parent, def);
            if (actor instanceof Animo) actor.loadSfx = async () => {};
            scope.set(actor.name, actor); await actor.init(); await actor.applyDefaults(); await actor.ready();
        }
        for (const def of Object.values(defs).filter(def => def.TYPE === 'BUTTON')) {
            const button = new Button(engine, parent, def);
            scope.set(button.name, button); button.init(); await button.applyDefaults();
        }
        for (const def of Object.values(defs).filter(def => def.TYPE === 'TIMER')) scope.set(def.NAME, new Timer(engine, parent, def));
        const model = () => {
            const struct = new Struct(engine, parent, defs.STRUCTLEVEL);
            for (const [name, type] of struct.structure) struct.content.set(name,
                new constructors[type](engine, parent, { TYPE: type, NAME: name }));
            struct.clone = async () => model(); return struct;
        };
        scope.set('STRUCTLEVEL', model());
        const database = new Database(engine, parent, defs.DBASELEVEL); scope.set(database.name, database); database.init();
        for (const [name, type, value] of [['G_SARCADEOBJECTS', 'STRING', String(level)],
            ['G_SLASTOBJECTS', 'STRING', 'SHOOTER'], ['SCENENAME', 'STRING', 'SHOOTER'], ['G_ISUCCESS', 'INTEGER', 0],
            ['G_ARRREXSPELLS', 'ARRAY', Array(12).fill(1)]]) {
            const object = new constructors[type](engine, parent, { TYPE: type, NAME: name });
            object.restoreCheckpointValue(value); scope.set(name, object);
        }
        const cursor = new Type(engine, parent, { TYPE: 'CLASS_INSTANCE', NAME: 'G_CURSOR' });
        cursor.SETPOSITIONNOCALL = () => {}; scope.set(cursor.name, cursor);
        const episode = new Type(engine, parent, { TYPE: 'EPISODE', NAME: 'PRZYGODA' });
        episode.GOTO = scene => routes.push(scene); episode.GETCURRENTSCENE = () => 'SHOOTER'; scope.set(episode.name, episode);
        const screenshot = new Type(engine, parent, { TYPE: 'BEHAVIOUR', NAME: '__SCREENSHOT__' });
        screenshot.RUN = () => screenshots.push(true); scope.set(screenshot.name, screenshot);
        const { Rand } = load('engine/types/rand.ts');
        const random = new Rand(engine, parent, { TYPE: 'RAND', NAME: 'RANDOM' }); let randomIndex = 0;
        random.GET = (min, count) => count === undefined ? randomIndex++ % min : min + randomIndex++ % count;
        scope.set(random.name, random);
        const mouse = new Mouse(engine, parent, defs.MOUSE); scope.set(mouse.name, mouse);
        mouse.onMouseMove({ screen: { x: 400, y: 300 } });
        const keyboard = new Keyboard(engine, parent, { TYPE: 'KEYBOARD', NAME: 'KEYBOARD' }); scope.set(keyboard.name, keyboard);
        for (const object of scope.objects.filter(object => object.definition.TYPE === 'SOUND')) {
            object.playForSequence = onEnd => voice(onEnd);
        }
        const pixel = new Animo(engine, parent, { TYPE: 'ANIMO', NAME: '__SHOOTER_PIXEL__',
            FILENAME: '$\\COMMON\\PIXEL.ANN', TOCANVAS: true, VISIBLE: true });
        pixel.loadSfx = async () => {}; scope.set(pixel.name, pixel);
        await pixel.init(); await pixel.applyDefaults(); await pixel.ready();
        for (const name of ['SEQSHOOTER', 'SEQDROB']) {
            const sequence = new Sequence(engine, parent, defs[name]);
            sequence.getAnimo = async filename => { assert.equal(filename, '$\\COMMON\\PIXEL.ANN'); return pixel; };
            scope.set(sequence.name, sequence); await sequence.init();
        }
        const code = defs.__INIT__.CODE.code, ast = load('interpreter/parser.ts').parseCode(code);
        const start = ast.findIndex(entry => entry.type === 'FunctionCall' && entry.target?.ref?.name === 'VARMOUSEPOSX');
        assert.ok(start > 0);
        const initialization = ast.slice(start).filter(entry => !['CNVLOADER', 'G_MENU'].includes(entry.target?.ref?.name));
        await new Interpreter(new RuntimeContext(engine, null, code)).execute(initialization);
        const step = async (count = 1, timers = true) => {
            for (let tick = 0; tick < count && !parent.paused && !routes.length; tick++) {
                if (voices.length) voices.shift()();
                for (const object of scope.objects) if (timers || !(object instanceof Timer)) await object.tick(1000 / 60);
            }
        };
        const finishSequence = async () => {
            for (let tick = 0; tick < 600 && get('SEQSHOOTER').ISPLAYING() && !routes.length; tick++) await step(1, false);
            assert.equal(get('SEQSHOOTER').ISPLAYING(), false);
        };
        await finishSequence();
        assert.equal(get('VARLEVEL').value, level); assert.equal(database.GETROWSNO(), 15);
        return { ...fixture, memory, backgrounds, voices, routes, screenshots, step, finishSequence, dispose };
    } catch (error) { dispose(); throw error; }
}

async function verifyShooterRecovery() {
    for (const outcome of ['FAILED', 'RESTART', 'SUKCES0', 'SUKCES1', 'SUKCES2']) {
        const level = outcome.startsWith('SUKCES') ? Number(outcome.at(-1)) : 0;
        const { engine, parent, get, routes, screenshots, step, finishSequence, dispose } = await createShooterFixture(level);
        try {
            await get('BEHADDPIECHUR').RUN();
            assert.equal(get('ANNPIECHUR_1').ISPLAYING(), true);
            if (outcome === 'FAILED') {
                for (let tick = 0; tick < 3600 && !get('SEQSHOOTER').ISPLAYING(); tick++) await step(1, false);
            } else if (outcome === 'RESTART') {
                const button = get('BTNRESTART'), sprite = get(button.definition.GFXSTANDARD.objectName).getRenderObject();
                for (const event of ['pointerover', 'pointerdown', 'pointerup']) sprite.emit(event);
                await button.tick();
            } else {
                // The score threshold is a boundary here; the original victory callback/sequence are real.
                await get('VARSCORE').SET(get('VARSUKCES').value);
            }
            assert.equal(get('SEQSHOOTER').ISPLAYING(), true, outcome);
            assert.equal(parent.paused, false, 'End-of-round dialogue must retain its tick queue');
            assert.equal(get('ANNPIECHUR_1').ISPLAYING(), false);
            for (const name of ['TIMERPIECHUR', 'TIMERGOOSE', 'TIMERKURA']) assert.equal(get(name).enabled, false);
            assert.equal(get('KEYBOARD').ISENABLED(), false); assert.equal(get('MOUSE').signalsDisabled, true);
            assert.equal(get('BTNRESTART').logic.enabled, false); assert.equal(get('SEQDROB').ISPLAYING(), false);
            await finishSequence();
            assert.deepEqual(routes, [outcome === 'FAILED' ? 'LIMBO' : outcome === 'RESTART' ? 'SHOOTER' : 'ARCADE']);
            assert.equal(screenshots.length, 1);
            assert.equal(get('G_SARCADEOBJECTS').value, outcome === 'FAILED' ? 'SHOOTER' : outcome === 'RESTART' ? '0' : 'UNIVBACK');
            if (outcome.startsWith('SUKCES')) {
                assert.equal(get('G_SLASTOBJECTS').value, `SHOOTER${level}`); assert.equal(get('G_ISUCCESS').value, 1);
            }
        } finally { dispose(); }
    }
    console.log('SHOOTER RECOVERY: real startup/overlays, missed-enemy failure, restart and all three victory sequences/routing decisions passed');
}

async function verifyShooterControls() {
    const { get, step, dispose } = await createShooterFixture(0);
    try {
        const mouse = get('MOUSE');
        const pointer = (x, y) => ({ screen: { x, y }, button: 0 });
        for (const spell of [...Array(12).keys(), 0]) {
            let x = 400, y = 300;
            mouse.onMouseMove(pointer(x, y)); mouse.SETPOSITION(x, y); await mouse.tick(16);
            await get('VARMOUSEPOSX').SET(x); await get('VARMOUSEPOSY').SET(y);
            mouse.handleClickEvent(pointer(x, y), 'click'); await mouse.tick(16);
            for (const angle of get(`ARRPATTERN${spell}`).value) {
                x += Math.round(60 * Math.cos(angle * Math.PI / 180));
                y += Math.round(60 * Math.sin(angle * Math.PI / 180));
                mouse.onMouseMove(pointer(x, y)); await mouse.tick(16);
            }
            mouse.handleClickEvent(pointer(x, y), 'release'); await mouse.tick(16);
            assert.equal(get('ARRSPELLTYPE').value[0], spell, `Shooter spell ${spell}`);
            if (spell < 6) assert.equal(get('VARAMMO').value, 5, 'Offensive shapes must refill five shots');
            else assert.deepEqual(get('ARRAYIMMUNE').value, [get('ARRAYSPELL').value[spell - 6]]);
            await step(10, false);
        }
        assert.equal(get('VARSCORE').value, 0, 'Drawing over scenery must not award enemy points');
        await get('BEHADDPIECHUR').RUN(); await get('BEHADDGOOSE').RUN(); await get('BEHADDKURA').RUN();
        const observer = get('CANVASOBSERVER');
        let score = 0;
        for (const name of ['ANNPIECHUR_1', 'ANNGOOSE_1', 'ANNKURA_1']) {
            const actor = get(name); let target;
            for (let tick = 0; tick < 600 && !target; tick++) {
                const sprite = actor.getRenderObject(), bounds = sprite.getBounds();
                for (let y = Math.max(1, Math.ceil(bounds.y)); y < Math.min(600, bounds.bottom) && !target; y += 4) {
                    for (let x = Math.max(1, Math.ceil(bounds.x)); x < Math.min(800, bounds.right); x += 4) {
                        if (sprite.getAlphaAt({ x, y }) > 0 && observer.GETGRAPHICSAT(x, y, true, -20, 20, false) === name) {
                            target = { x, y }; break;
                        }
                    }
                }
                if (!target) await step(1, false);
            }
            assert.ok(target, `${name} must become hittable through the original foreground layers`);
            const ammo = get('VARAMMO').value;
            mouse.onMouseMove(pointer(target.x, target.y)); await mouse.tick(16);
            mouse.handleClickEvent(pointer(target.x, target.y), 'click'); await mouse.tick(16);
            assert.equal(get('VARHIT').value, 1, `${name} must be hit through the original click handler`);
            assert.equal(get('VARAMMO').value, ammo - 1); score += 5;
            assert.equal(get('VARSCORE').value, score);
            assert.match(actor.GETEVENTNAME(), /^C_/);
            mouse.handleClickEvent(pointer(target.x, target.y), 'release'); await mouse.tick(16);
        }
        console.log('SHOOTER CONTROLS: all 12 drawn spell shapes, five-shot reloads, shields and real foreground-aware hits on all three enemy types passed');
    } finally { dispose(); }
}

async function verifyShooterWaves() {
    for (const level of [0, 1, 2]) {
        const { scope, get, step, routes, dispose } = await createShooterFixture(level);
        const mouse = get('MOUSE'), observer = get('CANVASOBSERVER'), victims = new Set();
        const pointer = (x, y) => ({ screen: { x, y }, button: 0 });
        let ticks = 0, casts = 0;
        const tick = async () => { await step(); ticks++; };
        const recharge = async () => {
            let x = 400, y = 300;
            mouse.onMouseMove(pointer(x, y)); await tick();
            mouse.handleClickEvent(pointer(x, y), 'click'); await tick();
            for (const angle of get('ARRPATTERN0').value) {
                x += Math.round(60 * Math.cos(angle * Math.PI / 180));
                y += Math.round(60 * Math.sin(angle * Math.PI / 180));
                mouse.onMouseMove(pointer(x, y)); await tick();
            }
            mouse.handleClickEvent(pointer(x, y), 'release'); await tick(); casts++;
            assert.equal(get('VARAMMO').value, 5, 'Only an actual recognized shape may recharge the wand');
        };
        const findTarget = () => {
            for (const actor of scope.objects.filter(object => /^ANN(PIECHUR|GOOSE|KURA)_\d+$/.test(object.name) &&
                object.ISPLAYING() && /^[PA]/.test(object.GETEVENTNAME()))) {
                const sprite = actor.getRenderObject(), bounds = sprite.getBounds();
                for (let y = Math.max(1, Math.ceil(bounds.y)); y < Math.min(600, bounds.bottom); y += 6) {
                    for (let x = Math.max(1, Math.ceil(bounds.x)); x < Math.min(800, bounds.right); x += 6) {
                        if (sprite.getAlphaAt({ x, y }) && observer.GETGRAPHICSAT(x, y, true, -20, 20, false) === actor.name) {
                            return { x, y };
                        }
                    }
                }
            }
            return null;
        };
        try {
            // Automatic aim chooses visible hit pixels, but timers, actors, ammo, scores and drawing remain script-owned.
            while (ticks < 30000 && !routes.length) {
                if (mouse.signalsDisabled) { await tick(); continue; }
                if (get('VARAMMO').value === 0) await recharge();
                const target = findTarget();
                if (!target) { await tick(); continue; }
                const score = get('VARSCORE').value;
                mouse.onMouseMove(pointer(target.x, target.y)); await tick();
                mouse.handleClickEvent(pointer(target.x, target.y), 'click'); await tick();
                if (get('VARSCORE').value > score) {
                    const actual = get('VARSTRING0').value;
                    assert.equal(victims.has(actual), false, `${actual} must not award points twice`);
                    victims.add(actual);
                    assert.match(get(actual).GETEVENTNAME(), /^C_/, 'A credited hit must transform its target');
                }
                mouse.handleClickEvent(pointer(target.x, target.y), 'release'); await tick();
            }
            assert.deepEqual(routes, ['ARCADE'], `Shooter wave ${level} must finish normally`);
            assert.ok(get('VARSCORE').value >= get('VARSUKCES').value); assert.ok(casts > 0 && victims.size > 0);
            assert.equal(get('G_SARCADEOBJECTS').value, 'UNIVBACK');
            assert.equal(get('G_SLASTOBJECTS').value, `SHOOTER${level}`); assert.equal(get('G_ISUCCESS').value, 1);
            console.log(`SHOOTER WAVE ${level}: ${victims.size} unique targets, ${casts} drawn reloads, score ${get('VARSCORE').value}, original victory/story-return passed`);
        } finally { dispose(); }
    }
}

async function createBroomFixture(level) {
    const fixture = await createArcadeFixture('MIOTLY', 'miotly', 'Miotly.cnv', `cnvLevel${level}.cnv`);
    const { engine, parent, scope, defs, get } = fixture, stage = engine.app.stage;
    const base = 'dane/game/przygoda/miotly', memory = new Map(), voices = [], routes = [], backgrounds = [], screenshots = [];
    engine.resolvePath = async (name, base = '') => normalizePath(name.startsWith('$') ? name.slice(1) : `${base}/${name}`);
    parent.getRelativePath = name => engine.resolvePath(name, base);
    engine.filesystem = new Filesystem({
        hasFile: name => fs.existsSync(path.join(assets, name)), registerLogicalFilenames() {},
        getRawFile: async name => {
            if (!fs.existsSync(path.join(assets, name))) throw new FileNotFoundError(name);
            return bytes(path.join(assets, name));
        },
    }, { get: async name => memory.get(name) ?? null, has: async name => memory.has(name),
        save: async (name, value) => { assert.equal(name, 'common/miotly0.arr'); memory.set(name, value.slice(0)); } }, engine.compat);
    engine.rendering.sortObjects = () => stage.children.sort((a, b) => a.zIndex - b.zIndex);
    engine.rendering.addToStage = sprite => { stage.addChild(sprite); engine.rendering.sortObjects(); };
    engine.rendering.removeFromStage = sprite => stage.removeChild(sprite);
    engine.rendering.setBackground = texture => backgrounds.push(texture);
    const assetLoader = load('filesystem/assetsLoader.ts'), previousLoadSound = assetLoader.loadSound;
    const previousWindow = globalThis.window; globalThis.window = new EventTarget();
    assetLoader.loadSound = async (filesystem, filename) => {
        if (!fs.existsSync(path.join(assets, normalizePath(filename)))) throw new FileNotFoundError(filename);
        const sound = { isPlaying: false, stop() { this.isPlaying = false; }, play(options = {}) {
            this.isPlaying = true; options.onStart?.();
            const instance = { stop() { sound.isPlaying = false; }, pause() {}, resume() {} };
            if (!options.loop) voices.push(() => { if (sound.isPlaying) { sound.isPlaying = false; options.onEnd?.(); } });
            return instance;
        } };
        return sound;
    };
    const dispose = () => {
        const cleanup = engine.scopeManager.destroy(); backgrounds.forEach(texture => texture.destroy(true));
        assetLoader.loadSound = previousLoadSound;
        if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
        assert.deepEqual(cleanup, [], 'Broom cleanup'); assert.equal(stage.children.length, 0);
    };
    try {
        for (const def of Object.values(defs)) {
            if (['ANIMO', 'IMAGE'].includes(def.TYPE)) {
                const actor = new (def.TYPE === 'ANIMO' ? Animo : Image)(engine, parent, def);
                if (actor instanceof Animo) actor.loadSfx = async () => {};
                scope.set(actor.name, actor); await actor.init(); await actor.applyDefaults(); await actor.ready();
            } else if (def.TYPE === 'SOUND') {
                const sound = new (load('engine/types/sound.ts').Sound)(engine, parent, def);
                scope.set(sound.name, sound); await sound.init();
            } else if (def.TYPE === 'TIMER') scope.set(def.NAME, new Timer(engine, parent, def));
        }
        for (const def of Object.values(defs).filter(def => def.TYPE === 'BUTTON')) {
            const button = new Button(engine, parent, def); scope.set(button.name, button); button.init(); await button.applyDefaults();
        }
        for (const name of ['PATTERNBKG', 'PATTERNFOREST', 'PATTERNMASKREX', 'PATTERNMASKKRET']) await get(name).applyDefaults();
        for (const [name, value] of [['G_SARCADEOBJECTS', String(level)], ['G_SLASTOBJECTS', 'MIOTLY'], ['SCENENAME', 'MIOTLY']]) {
            const object = new constructors.STRING(engine, parent, { TYPE: 'STRING', NAME: name });
            object.restoreCheckpointValue(value); scope.set(name, object);
        }
        const episode = new Type(engine, parent, { TYPE: 'EPISODE', NAME: 'PRZYGODA' });
        episode.GOTO = name => routes.push(name); scope.set(episode.name, episode);
        const screenshot = new Type(engine, parent, { TYPE: 'BEHAVIOUR', NAME: '__SCREENSHOT__' });
        screenshot.RUN = () => screenshots.push(true); scope.set(screenshot.name, screenshot);
        const { System } = load('engine/types/system.ts');
        scope.set('SYSTEM', new System(engine, parent, { TYPE: 'SYSTEM', NAME: 'SYSTEM' }));
        const keyboard = new Keyboard(engine, parent, defs.KEYBOARD); scope.set(keyboard.name, keyboard); await keyboard.ready();
        scope.set('MOUSE', new Mouse(engine, parent, defs.MOUSE));
        const pixel = new Animo(engine, parent, { TYPE: 'ANIMO', NAME: '__BROOM_PIXEL__',
            FILENAME: '$\\COMMON\\PIXEL.ANN', TOCANVAS: true, VISIBLE: true });
        pixel.loadSfx = async () => {}; scope.set(pixel.name, pixel);
        await pixel.init(); await pixel.applyDefaults(); await pixel.ready();
        const sequence = new Sequence(engine, parent, defs.SEQKRET);
        sequence.getAnimo = async name => { assert.equal(name, '$\\COMMON\\PIXEL.ANN'); return pixel; };
        scope.set(sequence.name, sequence); await sequence.init();
        const code = defs.__INIT__.CODE.code, ast = load('interpreter/parser.ts').parseCode(code);
        const start = ast.findIndex(entry => entry.type === 'FunctionCall' && entry.target?.ref?.name === 'VARSPEED');
        assert.ok(start > 0);
        // The overlay is preloaded; global menu/music/page setup is outside this fixture.
        await new Interpreter(new RuntimeContext(engine, null, code)).execute(ast.slice(start).filter(entry =>
            !['CNVLOADER', 'G_MENU'].includes(entry.target?.ref?.name)));
        const step = async (count = 1) => {
            for (let tick = 0; tick < count && !parent.paused && !routes.length; tick++) {
                if (voices.length) voices.shift()();
                for (const object of scope.objects) await object.tick(1000 / 60);
            }
        };
        const key = (down, code) => {
            const event = new Event(down ? 'keydown' : 'keyup'); Object.assign(event, { code, key: code }); window.dispatchEvent(event);
        };
        assert.equal(get('VARLEVEL').value, level); assert.equal(get('VARSPEED').value, 0);
        return { ...fixture, step, key, dispose, routes, memory, screenshots };
    } catch (error) { dispose(); throw error; }
}

async function verifyBroomRecoveryAndControls() {
    for (const [level, room] of [[0, 'PIKMIOT'], [1, 'MIASTO'], [2, 'MIOTLISKO'], [3, 'MIASTO'],
        [4, 'BARANMIOT'], [5, 'MIASTO']]) {
        const { get, world, step, key, routes, memory, screenshots, dispose } = await createBroomFixture(level);
        try {
            const angle = get('VARREXANGLE').value;
            key(true, 'ArrowRight'); await step(4); key(false, 'ArrowRight'); await step();
            assert.notEqual(get('VARREXANGLE').value, angle, `Broom ${level} arrow input`);
            for (let tick = 0; tick < 120; tick++) {
                await step();
                for (const [name, id] of [['ANNREX', 199], ['ANNKRET', 207]]) {
                    const actor = get(name);
                    assert.equal(actor.positionX, world.GETPOSITIONX(id), `Broom ${level} ${name} horizontal drift`);
                    assert.equal(actor.GETCENTERX(), Math.round(actor.positionX + actor.positionOffsetX -
                        actor.anchorOffsetX + actor.sprite.width / 2), 'Visible center retains the authored frame offset');
                }
            }
            assert.equal(Math.sign(get('VARBKGPOSY').value), level % 2 ? -1 : 1);
            assert.ok(get('VARENERGIA').value > 0);
            assert.deepEqual(deserializeArray(memory.get('common/miotly0.arr')), [level]);
            // These six ending checks advance the counter, not the actors through an entire route.
            await get('VARBKGPOSY').SET(level % 2 ? -24001 : 24001); await step(600);
            assert.deepEqual(routes, ['ARCADE']); assert.equal(get('G_SARCADEOBJECTS').value, room);
            assert.equal(screenshots.length, 1);
        } finally { dispose(); }
    }
    const failure = await createBroomFixture(0);
    try {
        await failure.step(6000);
        assert.equal(failure.get('VARENERGIA').value, 0);
        assert.deepEqual(failure.routes, ['MIOTLY']); assert.equal(failure.parent.paused, false);
        assert.equal(failure.get('G_SARCADEOBJECTS').value, '0'); assert.equal(failure.screenshots.length, 1);
        assert.equal(failure.get('TIMEREND').enabled, false);
    } finally { failure.dispose(); }
    const restart = await createBroomFixture(5);
    try {
        await restart.get('BTNRESTART').callbacks.run('ONRELEASED'); await restart.step(600);
        assert.deepEqual(restart.routes, ['MIOTLY']); assert.equal(restart.get('G_SARCADEOBJECTS').value, '5');
        assert.equal(restart.screenshots.length, 1);
    } finally { restart.dispose(); }
    console.log('BROOM: six real-map startups, arrow controls, drift checks and boundary-tested story exits; natural damage failure and manual restart passed');
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

function planBroomRoute(get, direction) {
    const xs = Array.from({ length: 27 }, (_, index) => 75 + index * 25), costs = [], parents = [], plan = [];
    // Plan from the initial real mask pixels, in the direction of this outward or return flight.
    for (let progress = 0; progress <= 24500; progress += 100) {
        const row = [], links = [], previous = costs.at(-1);
        for (let index = 0; index < xs.length; index++) {
            let hazard = 0;
            for (const dx of [-25, 0, 25]) for (const dy of [-35, 0, 35]) {
                if (get('PATTERNMASKREX').GETGRAPHICSAT(xs[index] + dx, 300 - direction * progress + dy, true, false, 0, 1) !== 'UNKNOWN') hazard++;
            }
            let best = previous ? Infinity : Math.abs(xs[index] - 380) * .1, from = -1;
            if (previous) for (let candidate = Math.max(0, index - 2); candidate <= Math.min(xs.length - 1, index + 2); candidate++) {
                const score = previous[candidate] + Math.abs(xs[index] - xs[candidate]) * .01;
                if (score < best) { best = score; from = candidate; }
            }
            row.push(best + hazard * 100 + Math.abs(xs[index] - 400) * .0001); links.push(from);
        }
        costs.push(row); parents.push(links);
    }
    let index = costs.at(-1).indexOf(Math.min(...costs.at(-1)));
    for (let progress = costs.length - 1; progress >= 0; progress--) {
        plan[progress] = xs[index]; index = parents[progress][index];
    }
    return plan;
}

async function verifyBroomFlight() {
    for (const [level, room] of [[0, 'PIKMIOT'], [1, 'MIASTO'], [2, 'MIOTLISKO'], [3, 'MIASTO'],
        [4, 'BARANMIOT'], [5, 'MIASTO']]) {
        const { get, world, step, key, routes, memory, screenshots, dispose } = await createBroomFixture(level);
        const direction = level % 2 ? -1 : 1, history = [];
        let held = null, turns = 0;
        try {
            const plan = planBroomRoute(get, direction);
            const steeringGain = level === 5 ? 12 : 6;
            for (let tick = 0; tick < 14000 && !routes.length; tick++) {
                const x = world.GETPOSITIONX(199);
                // The hero moves within the viewport as well as scrolling the map.
                const progress = direction * (get('VARBKGPOSY').value + 300 - get('ANNREX').GETCENTERY());
                history.push(x); if (history.length > 10) history.shift();
                const vx = (x - history[0]) * 6;
                const target = plan[Math.min(plan.length - 1, Math.max(0, Math.round((progress + 100) / 100)))];
                const ax = Math.max(-400, Math.min(400, (target - x) * steeringGain - vx * 2));
                const desired = (Math.round((95 - Math.atan2(direction * Math.sqrt(500 * 500 - ax * ax), ax) * 180 / Math.PI) / 11) + 32) % 32;
                const delta = (desired - get('VARREXANGLE').value + 48) % 32 - 16;
                const next = delta > 0 ? 'ArrowRight' : delta < 0 ? 'ArrowLeft' : null;
                if (next !== held) {
                    if (held) key(false, held);
                    if (next) { key(true, next); turns++; }
                    held = next;
                }
                await step();
            }
            assert.deepEqual(routes, ['ARCADE'], `Broom ${level} full-flight destination`);
            assert.equal(get('G_SARCADEOBJECTS').value, room);
            assert.ok(direction * get('VARBKGPOSY').value > 24000 && get('VARENERGIA').value > 0 && turns > 0);
            assert.deepEqual(deserializeArray(memory.get('common/miotly0.arr')), [level]);
            assert.equal(screenshots.length, 1);
            console.log(`BROOM ${level}: full 24000-pixel flight, ${turns} steering changes, ${get('VARENERGIA').value} energy and original ${room} return passed`);
        } finally { if (held) key(false, held); dispose(); }
    }
}

async function createCatFixture(filesystemEntries = []) {
    const fixture = await createArcadeFixture('CAT', 'Cat', 'Cat.cnv');
    const { engine, parent, scope, directory, defs, world, get } = fixture;
    const stage = engine.app.stage, saves = [];
    const files = new Map(structuredClone(filesystemEntries).map(({ key, value }) => [key, value]));
    const savePath = path.join(directory, 'cat-fixture.arr'), inventoryPath = path.join(directory, 'cat-fixture-items.dta');
    engine.rendering.sortObjects = () => stage.children.sort((a, b) => a.zIndex - b.zIndex);
    engine.rendering.addToStage = sprite => { stage.addChild(sprite); engine.rendering.sortObjects(); };
    engine.rendering.removeFromStage = sprite => stage.removeChild(sprite);
    engine.filesystem.getANNFile = async filename => loadAnn(bytes(filename));
    engine.filesystem.getIMGFile = async filename => loadImage(bytes(filename));
    engine.filesystem.getFile = async filename => files.get(filename) ?? bytes(filename);
    engine.filesystem.hasFile = async filename => files.has(filename) || fs.existsSync(filename);
    engine.filesystem.getARRFile = async filename => deserializeArray(await engine.filesystem.getFile(filename));
    engine.filesystem.saveFile = async (filename, data) => {
        assert.ok([savePath, inventoryPath].includes(filename), 'Fixture must not modify game assets');
        files.set(filename, structuredClone(data));
        if (filename === savePath) saves.push(deserializeArray(data));
    };
    for (const def of Object.values(defs).filter(def => ['ANIMO', 'IMAGE'].includes(def.TYPE))) {
        const actor = new (def.TYPE === 'ANIMO' ? Animo : Image)(engine, parent, def);
        if (actor instanceof Animo) actor.loadSfx = async () => {};
        scope.set(actor.name, actor); await actor.init(); await actor.applyDefaults(); await actor.ready();
    }
    const mouse = new Mouse(engine, parent, defs.MOUSE); scope.set(mouse.name, mouse);
    await get('VARSAVENAME').SET('cat-fixture.arr');
    if (files.has(savePath)) await get('ARRAYSAVE').LOAD('cat-fixture.arr');
    else get('ARRAYSAVE').restoreCheckpointValue([0, 0]);
    const code = defs.__INIT__.CODE.code, ast = load('interpreter/parser.ts').parseCode(code);
    const first = ast.findIndex(entry => entry.type === 'FunctionCall' && entry.target?.ref?.name === 'BEHINITLEVEL');
    assert.ok(first >= 0);
    const initialization = ast.slice(first).filter(entry => entry.target?.ref?.name !== 'G_AMBIENT');
    await new Interpreter(new RuntimeContext(engine, null, code)).execute(initialization);
    assert.ok(world.physics, 'Cat must initialize its shipped three-dimensional collision world');
    const step = async (count = 1) => {
        for (let tick = 0; tick < count; tick++) {
            for (const object of scope.objects) {
                if (object instanceof World || object instanceof Animo || object instanceof Mouse) await object.tick(1000 / 60);
            }
        }
    };
    const click = async (x, y) => {
        const pointer = { button: 0, screen: { x, y } };
        mouse.handleClickEvent(pointer, 'click'); mouse.handleClickEvent(pointer, 'release'); await mouse.tick(16);
    };
    return { ...fixture, stage, saves, step, click, files };
}

async function verifyStartupCursor() {
    const original = decryptCNV(bytes(path.join(assets, 'Dane/Game/Game.cnv')));
    assert.ok(original.includes('MOUSE^SETPOSITION(400,300);MOUSE^HIDE();'));
    const definitions = parseCNV(patchMagicieniiSource('dane/game/game.cnv', original));
    const startup = Object.values(definitions).find(def => def.CODE?.code.includes('CF^NEW("G_CURSOR")'));
    assert.ok(startup);
    const { engine, parent, scope } = await createArcadeFixture('CAT', 'Cat', 'Cat.cnv');
    const globalMouse = new Mouse(engine, null, definitions.MOUSE), sceneMouse = new Mouse(engine, parent, { TYPE: 'MOUSE', NAME: 'SCENEMOUSE' });
    scope.set(globalMouse.name, globalMouse); scope.set(sceneMouse.name, sceneMouse);
    const cursorModes = []; engine.rendering.setCursor = mode => cursorModes.push(mode);
    try {
        const statements = load('interpreter/parser.ts').parseCode(startup.CODE.code).filter(entry =>
            entry.type === 'FunctionCall' && entry.target?.ref?.name === 'MOUSE');
        await new Interpreter(new RuntimeContext(engine, null, startup.CODE.code)).execute(statements);
        assert.deepEqual(cursorModes, ['none']);
        for (const [x, y] of [[50, 40], [700, 450], [450, 350]]) {
            const pointer = { button: 0, screen: { x, y } };
            globalMouse.onMouseMove(pointer); sceneMouse.onMouseMove(pointer);
            assert.deepEqual([globalMouse.GETPOSX(), globalMouse.GETPOSY()], [x, y]);
            assert.deepEqual([sceneMouse.GETPOSX(), sceneMouse.GETPOSY()], [x, y]);
        }
        sceneMouse.SETPOSITION(400, 300); sceneMouse.onMouseMove({ button: 0, screen: { x: 460, y: 360 } });
        assert.deepEqual([sceneMouse.GETPOSX(), sceneMouse.GETPOSY()], [410, 310], 'Spell drawing must retain relative warps');
        console.log('CURSOR: original Game startup keeps global cursor and scene clicks aligned; relative spell movement is preserved');
    } finally { assert.deepEqual(engine.scopeManager.destroy(), []); }
}

async function verifyCat() {
    const fixture = await createCatFixture();
    const { engine, stage, world, get, saves, step, click } = fixture;
    try {
        for (let tick = 0; tick < 10; tick++) await step();
        assert.equal(get('VARPLAYERNAME').value, 'ANNREX');
        assert.ok(Math.hypot(get('ANNREX').GETCENTERX() - 150, get('ANNREX').GETCENTERY() - 400) < 25,
            'The short initial idle animation must not send the hero sliding across the room');
        for (const [dx, dy, event] of [[100, 0, '0'], [100, -100, '1'], [0, -100, '2'], [-100, -100, '3'],
            [-100, 0, '4'], [-100, 100, '5'], [0, 100, '6'], [100, 100, '7']]) {
            await click(get('ANNREX').GETCENTERX() + dx, get('ANNREX').GETCENTERY() + dy);
            assert.equal(get('ANNREX').GETEVENTNAME(), event, `Walking direction ${dx},${dy}`);
        }
        await click(250, 400);
        assert.match(get('ANNREX').GETEVENTNAME(), /^[0-7]$/, 'A fractional angle must select a real walking event');
        for (let tick = 0; tick < 120; tick++) await step();
        assert.ok(Math.abs(get('ANNREX').GETCENTERX() - 250) < 10,
            `Original click-to-move scripts must approach the target: ${JSON.stringify({
                x: get('ANNREX').GETCENTERX(), y: get('ANNREX').GETCENTERY(), event: get('ANNREX').GETEVENTNAME(),
                playing: get('ANNREX').ISPLAYING(), target: [get('VARDESTX').value, get('VARDESTY').value],
                speed: world.GETSPEED(100), selected: get('VARPLAYERNAME').value
            })}`);
        assert.equal(world.GETSPEED(100), 0, 'The original arrival branch must stop the selected body');
        await click(get('ANNKRET').GETCENTERX(), get('ANNKRET').GETCENTERY());
        assert.equal(get('VARPLAYERNAME').value, 'ANNKRET', 'Clicking the second hero must select its physical body');
        await click(300, 500);
        for (let tick = 0; tick < 120; tick++) await step();
        assert.ok(Math.hypot(get('ANNKRET').GETCENTERX() - 300, get('ANNKRET').GETCENTERY() - 500) < 10,
            `The second hero must reach an unobstructed target: ${get('ANNKRET').GETCENTERX()},${get('ANNKRET').GETCENTERY()}`);
        assert.equal(world.GETSPEED(101), 0);
        // Puzzle approach positions are a boundary; the cat's launch, landing and height guards are real.
        await world.SETPOSITION(100, 640, 450, 0); await world.SETPOSITION(101, 650, 550, 0);
        await get('VARPLAYERNAME').SET('ANNREX'); await get('VARPLAYERID').SET(100);
        await get('ANNREX').PLAY('IDLE_0'); await get('VARDESTX').SET(640); await get('VARDESTY').SET(450);
        await world.SETPOSITION(102, 550, 450, 0); world.SETVELOCITY(102, 0, 0, 0); await get('ANNKOT').PLAY('IDLE');
        for (let tick = 0; tick < 4 && get('ANNKOT').GETEVENTNAME() !== 'PLAY'; tick++) await step();
        assert.equal(get('ANNKOT').GETEVENTNAME(), 'PLAY', 'A nearby hero must provoke the original cat jump');
        let peak = 0;
        for (let tick = 0; tick < 150; tick++) { await step(); peak = Math.max(peak, world.GETPOSITIONZ(102)); }
        assert.ok(peak > 150, 'Cat jumps must cross the beehive height threshold');
        assert.equal(world.GETPOSITIONZ(102), 0, 'Cat must land at its original ground limit');
        assert.deepEqual(saves, [], 'Movement checks must not invent puzzle completion');
        const mask = get('IMGULMASK').getRenderObject(), point = mask.getBounds();
        const opaque = mask.hitmap.findIndex(alpha => alpha > 0);
        assert.ok(opaque >= 0, 'The beehive mask must contain an actual opaque pixel');
        const target = { x: Math.floor(point.x + opaque % mask.texture.orig.width),
            y: Math.floor(point.y + Math.floor(opaque / mask.texture.orig.width)) };
        await get('ANNREX').PAUSE(); await get('ANNKRET').PAUSE();
        // Positioning at the shipped mask is a boundary, not a solution to the herding puzzle.
        const atMask = async height => {
            await get('ANNKOT').PLAY('IDLE');
            await world.SETPOSITION(102, target.x, target.y - 30 - height, height);
            await world.MOVEOBJECTS();
            get('ANNCIENKOTA').SETPOSITION(get('ANNKOT').GETCENTERX(), get('ANNKOT').GETCENTERY() + 30 + height);
            const dx = target.x - get('ANNCIENKOTA').GETCENTERX(), dy = target.y - get('ANNCIENKOTA').GETCENTERY();
            await world.SETPOSITION(102, world.GETPOSITIONX(102) + dx, world.GETPOSITIONY(102) + dy, height);
            await get('BEHMOVEWORLD').RUN();
            assert.equal(get('VARULMASK').value, 'IMGULMASK', `Real mask query at Z=${height}`);
        };
        await atMask(149); assert.deepEqual(saves, []);
        await atMask(151); assert.deepEqual(saves, [[1, 0]]);
        for (let tick = 0; tick < 50; tick++) await get('ANNUL').tick(1000 / 60);
        assert.equal(get('ANNUL').GETEVENTNAME(), 'MIOD', 'The beehive animation must finish before the boots guard');
        await atMask(6); assert.deepEqual(saves, [[1, 0]]);
        await atMask(4); assert.deepEqual(saves, [[1, 0], [1, 1]]);
        assert.equal(get('ANNKOT').GETEVENTNAME(), 'BEZ_BUTOW'); assert.equal(get('ANNBUTY').ISVISIBLE(), true);
        get('ARRAYSAVE').restoreCheckpointValue(saves.at(-1)); await get('BEHINITLEVEL').RUN();
        assert.equal(get('ANNUL').GETEVENTNAME(), 'MIOD'); assert.equal(get('ANNKOT').ISVISIBLE(), false);
        assert.equal(get('ANNCIENKOTA').ISVISIBLE(), false); assert.equal(get('ANNBUTY').ISVISIBLE(), true);
        await verifyCatReward(fixture);
        console.log('CAT: original initialization, eight-way walking, actor selection, stops, jump/landing, mask height guards, puzzle re-entry and boots inventory persistence passed');
    } finally {
        assert.deepEqual(engine.scopeManager.destroy(), [], 'Cat cleanup'); assert.equal(stage.children.length, 0);
    }
}

function installCatInventory({ engine, parent, scope, directory, defs, files }) {
    // Supply the value-field factory; database parsing, serialization and pickup scripts remain real.
    const makeItem = () => {
        const item = new Struct(engine, parent, defs.SITEM);
        for (const [name, type] of item.structure) {
            item.content.set(name, new constructors[type](engine, parent, { TYPE: type, NAME: name }));
        }
        item.clone = async () => makeItem();
        return item;
    };
    const model = makeItem(), inventoryPath = path.join(directory, 'cat-fixture-items.dta'), itemSaves = [];
    scope.set('SITEM', model);
    scope.set('G_IGAMESLOT', new constructors.INTEGER(engine, parent, { TYPE: 'INTEGER', NAME: 'G_IGAMESLOT' }));
    const database = new Database(engine, parent, defs.DBITEMS); scope.set(database.name, database); database.init();
    const relativePath = parent.getRelativePath;
    parent.getRelativePath = async name => name === '$COMMON\\ITEMS0.DTA' ? inventoryPath : relativePath(name);
    engine.resolvePath = parent.getRelativePath;
    const read = engine.filesystem.getFile, write = engine.filesystem.saveFile;
    let inventory = files.get(inventoryPath) ?? Buffer.from(Array.from({ length: 10 }, (_, index) => `${index}|NULL|-1|NULL|0\r\n`).join(''));
    engine.filesystem.getFile = async name => name === inventoryPath ? inventory : read(name);
    engine.filesystem.saveFile = async (name, data) => {
        if (name !== inventoryPath) return write(name, data);
        inventory = Buffer.from(data); itemSaves.push(inventory.toString());
        await write(name, data);
    };
    return { database, itemSaves };
}

async function verifyCatReward(fixture) {
    const { get, step, click } = fixture, { itemSaves } = installCatInventory(fixture);
    const boots = get('ANNBUTY').getRenderObject(), bounds = boots.getBounds();
    const pixel = boots.hitmap.findIndex(alpha => alpha > 0);
    assert.ok(pixel >= 0);
    const pickup = { x: Math.floor(bounds.x + pixel % boots.texture.orig.width),
        y: Math.floor(bounds.y + Math.floor(pixel / boots.texture.orig.width)) };
    await click(pickup.x, pickup.y);
    for (let tick = 0; tick < 480 && !itemSaves.length; tick++) await step();
    assert.equal(itemSaves.length, 1, 'The original arrival callback must persist the boots reward');
    assert.equal(get('ANNBUTY').ISVISIBLE(), false);
    assert.match(itemSaves[0], /^0\|BUTY_BUT\|-1\|CAT\|1\r\n/);
    await get('BEHBOOTS').RUN();
    assert.equal(itemSaves.length, 1, 'An existing boots item must not be awarded twice');
}

const catHiveRoute = [[300, 540, 240], [400, 540, 240], [400, 480, 240], [400, 520, 360],
    [650, 400, 240], [650, 270, 240], [650, 150, 180], [450, 130, 240]];

async function verifyCatHerding() {
    const fixture = await createCatFixture(), { engine, parent, scope, stage, get, step, click, saves } = fixture;
    try {
        // Only normal mouse destinations and elapsed ticks: no body/flag/animation relocation after entry.
        for (const [x, y, ticks] of catHiveRoute) {
            await click(x, y); await step(ticks);
        }
        assert.deepEqual(saves, [[1, 0]], 'The normal route must knock down the beehive before dropping the boots');
        const mole = get('ANNKRET'); await click(mole.GETCENTERX(), mole.GETCENTERY());
        assert.equal(get('VARPLAYERNAME').value, 'ANNKRET'); await click(150, 500); await step(320);
        assert.deepEqual(saves, [[1, 0], [1, 1]], 'Normal herding must land the cat on the honey');
        assert.equal(get('ANNKOT').GETEVENTNAME(), 'BEZ_BUTOW');
        await verifyCatReward(fixture);
        const routes = [], screenshots = [];
        const episode = new Type(engine, parent, { TYPE: 'EPISODE', NAME: 'PRZYGODA' });
        episode.GOTO = scene => routes.push(scene); scope.set(episode.name, episode);
        const screenshot = new Type(engine, parent, { TYPE: 'BEHAVIOUR', NAME: '__SCREENSHOT__' });
        screenshot.RUN = () => screenshots.push('exit'); scope.set(screenshot.name, screenshot);
        for (const name of ['G_SLASTOBJECTS', 'G_SARCADEOBJECTS']) {
            scope.set(name, new constructors.STRING(engine, parent, { TYPE: 'STRING', NAME: name }));
        }
        for (const [x, y] of [[250, 450], [180, 500], [60, 560]]) {
            await click(x, y);
            for (let tick = 0; tick < 480 && !routes.length; tick++) await step();
            if (routes.length) break;
        }
        assert.deepEqual(routes, ['ARCADE'], 'Walking to the original exit must request the adventure scene');
        assert.deepEqual(screenshots, ['exit']); assert.equal(get('G_SLASTOBJECTS').value, 'CAT');
        assert.equal(get('G_SARCADEOBJECTS').value, 'JAGA');
        console.log('CAT HERDING: normal click-only route knocks down the hive, lands the cat on honey, collects the boots and requests the original JAGA adventure return');
    } finally {
        assert.deepEqual(engine.scopeManager.destroy(), [], 'Cat herding cleanup'); assert.equal(stage.children.length, 0);
    }
}

async function verifyCatSavedProgress() {
    const fixtures = [];
    const capture = async fixture => {
        const { engine, parent, scope, files } = fixture;
        scope.set('G_SARCADEOBJECTS', new constructors.STRING(engine, parent, { TYPE: 'STRING', NAME: 'G_SARCADEOBJECTS', VALUE: 'CAT' }));
        engine.app.ticker = { started: true, start() { this.started = true; } };
        engine.stopForRestart = async () => { engine.app.ticker.started = false; };
        engine.saveFile.toObject = () => ({ fixture: 'CAT' });
        engine.options = { storage: { snapshot: async () => [...files].map(([key, value]) => ({ key, value })) } };
        const checkpoint = await captureSavedProgressCheckpoint(engine, {
            version: 1, scene: 'CAT', previousScene: 'ARCADE', globals: [
                { name: 'G_SARCADEOBJECTS', parent: 'CAT', type: 'STRING', value: 'JAGA' },
            ], saveData: {}, filesystemEntries: [],
        });
        assert.equal(checkpoint.captureKind, 'persisted'); assert.equal(checkpoint.globals[0].value, 'CAT');
        assert.equal(engine.app.ticker.started, true);
        return checkpoint;
    };
    try {
        const first = await createCatFixture(); fixtures.push(first);
        for (const [x, y, ticks] of catHiveRoute) { await first.click(x, y); await first.step(ticks); }
        assert.deepEqual(first.saves, [[1, 0]]);
        const hive = await capture(first);
        const restored = await createCatFixture(hive.filesystemEntries); fixtures.push(restored);
        assert.deepEqual(restored.get('ARRAYSAVE').value, [1, 0], 'Original array LOAD must retain the knocked-down hive');
        assert.equal(restored.get('ANNUL').GETEVENTNAME(), 'MIOD');
        assert.equal(restored.get('ANNKROPLA').ISVISIBLE(), false); assert.equal(restored.get('ANNKOT').ISVISIBLE(), true);
        assert.equal(restored.get('ANNBUTY').ISVISIBLE(), false);
        for (const [x, y, ticks] of catHiveRoute) { await restored.click(x, y); await restored.step(ticks); }
        const mole = restored.get('ANNKRET'); await restored.click(mole.GETCENTERX(), mole.GETCENTERY());
        await restored.click(150, 500); await restored.step(320);
        assert.deepEqual(restored.get('ARRAYSAVE').value, [1, 1]);
        await verifyCatReward(restored);
        const completed = await capture(restored);
        const final = await createCatFixture(completed.filesystemEntries); fixtures.push(final);
        assert.deepEqual(final.get('ARRAYSAVE').value, [1, 1]);
        assert.equal(final.get('ANNKOT').ISVISIBLE(), false); assert.equal(final.get('ANNCIENKOTA').ISVISIBLE(), false);
        const { database, itemSaves } = installCatInventory(final);
        await restoreMagicieniiSavedProgress(final.engine);
        assert.equal(final.get('ANNBUTY').ISVISIBLE(), false, 'Collected boots must stay hidden after checkpoint restoration');
        database.REMOVEALL();
        await database.LOAD('$COMMON\\ITEMS0.DTA'); assert.equal(await database.FIND('NAME', 'BUTY_BUT', 0), 0);
        await final.get('BEHBOOTS').RUN(); assert.deepEqual(itemSaves, [], 'Restored boots must not be awarded twice');
        console.log('CAT SAVED PROGRESS: real array/database bytes preserve the hive, allow normal herding after restore, retain collected boots and reject duplicate rewards');
    } finally {
        for (const fixture of fixtures) {
            assert.deepEqual(fixture.engine.scopeManager.destroy(), []); assert.equal(fixture.stage.children.length, 0);
        }
    }
}

async function createDragonFixture(level) {
    const fixture = await createArcadeFixture('DRAGON', 'Dragon', 'Dragon.cnv', `cnvLevel${level}.cnv`);
    const { engine, parent, scope, defs, get } = fixture, stage = engine.app.stage;
    const scenePath = 'dane/game/przygoda/dragon', memory = new Map([['common/dragon0.arr', serializeArray([level, 0])]]);
    const backgrounds = [], voices = [], routes = [], screenshots = [];
    Texture._WHITE ??= new Texture(BaseTexture.fromBuffer(new Uint8Array([255, 255, 255, 255]), 1, 1));
    parent.getRelativePath = name => normalizePath(name.startsWith('$') ? name.slice(1) : `${scenePath}/${name}`);
    engine.resolvePath = async (name, base = scenePath) => normalizePath(name.startsWith('$') ? name.slice(1) : `${base}/${name}`);
    engine.filesystem = new Filesystem({
        hasFile: name => fs.existsSync(path.join(assets, name)), registerLogicalFilenames() {},
        getRawFile: async name => {
            if (!fs.existsSync(path.join(assets, name))) throw new FileNotFoundError(name);
            return bytes(path.join(assets, name));
        },
    }, { get: async name => memory.get(name) ?? null, has: async name => memory.has(name),
        save: async (name, value) => { assert.equal(name, 'common/dragon0.arr'); memory.set(name, value.slice(0)); } }, engine.compat);
    engine.rendering.sortObjects = () => stage.children.sort((a, b) => a.zIndex - b.zIndex);
    engine.rendering.addToStage = sprite => { stage.addChild(sprite); engine.rendering.sortObjects(); };
    engine.rendering.removeFromStage = sprite => stage.removeChild(sprite);
    engine.rendering.setBackground = texture => backgrounds.push(texture);
    const assetLoader = load('filesystem/assetsLoader.ts'), previousLoadSound = assetLoader.loadSound;
    const previousWindow = globalThis.window; globalThis.window = new EventTarget();
    const voice = onEnd => {
        const instance = { isPlaying: true, stop() { this.isPlaying = false; }, pause() {}, resume() {} };
        voices.push(() => { if (instance.isPlaying) { instance.isPlaying = false; onEnd?.(); } }); return instance;
    };
    assetLoader.loadSound = async () => ({ play: options => voice(options?.onEnd) });
    const dispose = () => {
        const cleanup = engine.scopeManager.destroy(); backgrounds.forEach(texture => texture.destroy(true));
        assetLoader.loadSound = previousLoadSound;
        if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
        assert.deepEqual(cleanup, [], 'Dragon cleanup'); assert.equal(stage.children.length, 0);
    };
    try {
        for (const def of Object.values(defs).filter(def => ['ANIMO', 'IMAGE'].includes(def.TYPE))) {
            const actor = new (def.TYPE === 'ANIMO' ? Animo : Image)(engine, parent, def);
            if (actor instanceof Animo) actor.loadSfx = async () => {};
            scope.set(actor.name, actor); await actor.init(); await actor.applyDefaults(); await actor.ready();
        }
        for (const def of Object.values(defs).filter(def => def.TYPE === 'BUTTON')) {
            const button = new Button(engine, parent, def);
            scope.set(button.name, button); button.init(); await button.applyDefaults();
        }
        for (const def of Object.values(defs).filter(def => def.TYPE === 'TIMER')) scope.set(def.NAME, new Timer(engine, parent, def));
        for (const name of ['PATTERNBKG', 'PATTERNFIRE']) await get(name).applyDefaults();
        for (const [name, type, value] of [['G_SARCADEOBJECTS', 'STRING', String(level)],
            ['G_SLASTOBJECTS', 'STRING', 'DRAGON'], ['SCENENAME', 'STRING', 'DRAGON']]) {
            const object = new constructors[type](engine, parent, { TYPE: type, NAME: name });
            object.restoreCheckpointValue(value); scope.set(name, object);
        }
        const episode = new Type(engine, parent, { TYPE: 'EPISODE', NAME: 'PRZYGODA' });
        episode.GOTO = scene => routes.push(scene); scope.set(episode.name, episode);
        const screenshot = new Type(engine, parent, { TYPE: 'BEHAVIOUR', NAME: '__SCREENSHOT__' });
        screenshot.RUN = () => screenshots.push(true); scope.set(screenshot.name, screenshot);
        const { System } = load('engine/types/system.ts'), { Rand } = load('engine/types/rand.ts');
        scope.set('SYSTEM', new System(engine, parent, { TYPE: 'SYSTEM', NAME: 'SYSTEM' }));
        const random = new Rand(engine, parent, { TYPE: 'RAND', NAME: 'RANDOM' }); let randomIndex = 0;
        random.GET = (min, count) => count === undefined ? randomIndex++ % min : min + randomIndex++ % count;
        scope.set(random.name, random);
        const mouse = new Mouse(engine, parent, defs.MOUSE); scope.set(mouse.name, mouse);
        const keyboard = new Keyboard(engine, parent, defs.KEYBOARD); scope.set(keyboard.name, keyboard);
        await keyboard.ready(); keyboard.SETAUTOREPEAT(false);
        for (const object of scope.objects.filter(object => object.definition.TYPE === 'SOUND')) object.playForSequence = onEnd => voice(onEnd);
        const pixel = new Animo(engine, parent, { TYPE: 'ANIMO', NAME: '__DRAGON_PIXEL__',
            FILENAME: '$\\COMMON\\PIXEL.ANN', TOCANVAS: true, VISIBLE: true });
        pixel.loadSfx = async () => {}; scope.set(pixel.name, pixel);
        await pixel.init(); await pixel.applyDefaults(); await pixel.ready();
        const sequence = new Sequence(engine, parent, defs.SEQHELP);
        sequence.getAnimo = async filename => { assert.equal(filename, '$\\COMMON\\PIXEL.ANN'); return pixel; };
        scope.set(sequence.name, sequence); await sequence.init();
        const code = defs.__INIT__.CODE.code, ast = load('interpreter/parser.ts').parseCode(code);
        const start = ast.findIndex(entry => entry.type === 'FunctionCall' && entry.target?.ref?.name === 'VARCPUSPEED');
        assert.ok(start > 0);
        const initialization = ast.slice(start).filter(entry => !['CNVLOADER', 'G_MENU'].includes(entry.target?.ref?.name));
        await new Interpreter(new RuntimeContext(engine, null, code)).execute(initialization);
        const step = async (count = 1) => {
            for (let tick = 0; tick < count && !parent.paused && !routes.length; tick++) {
                if (voices.length) voices.shift()();
                for (const object of scope.objects) await object.tick(1000 / 60);
            }
        };
        const key = async (down, code = 'Space') => {
            const event = new Event(down ? 'keydown' : 'keyup'); Object.assign(event, { code, key: code === 'Space' ? ' ' : code });
            window.dispatchEvent(event);
        };
        assert.equal(get('VARLEVEL').value, level); assert.equal(get('VARCPUSPEED').value, 1);
        return { ...fixture, memory, backgrounds, voices, routes, screenshots, step, key, dispose };
    } catch (error) { dispose(); throw error; }
}

async function verifyDragonFlight() {
    const { get, memory, routes, screenshots, key, step, dispose } = await createDragonFixture(0);
    let strokes = 0, landed = false, tookOff = false, burning = false, extinguished = false;
    try {
        for (let tick = 0; tick < 7000 && !routes.length; tick++) {
            const wings = get('ANNSKRZYDLA');
            burning ||= get('ANNDRAGONFIRE').ISPLAYING('PLAY');
            landed ||= get('VARSTARTOWANIE').value === 1;
            tookOff ||= landed && get('VARSTARTOWANIE').value === 0;
            extinguished ||= burning && landed && !get('ANNDRAGONFIRE').ISPLAYING('PLAY');
            // Let complete strokes lift the dragon; descend into water when it catches fire.
            if (!get('ANNDRAGONFIRE').ISPLAYING('PLAY') && get('VARPOSY').value > 210 &&
                ((get('VARDIR').value === 'B' && wings.GETCFRAMEINEVENT() <= 1) ||
                    ['PLYNIE', 'SZYB'].includes(wings.GETEVENTNAME()))) {
                await key(true); await step(); await key(false); strokes++;
            } else await step();
        }
        assert.deepEqual(routes, ['DRAGON']);
        assert.equal(get('G_SARCADEOBJECTS').value, '1');
        assert.ok(get('VARPOSX').value > 15000 && get('VARENERGY').value > 0);
        assert.ok(strokes > 0 && landed && tookOff && burning && extinguished);
        assert.deepEqual(deserializeArray(memory.get('common/dragon0.arr')), [0, 0]);
        assert.equal(screenshots.length, 1);
        console.log(`DRAGON: full first flight, ${strokes} timed strokes, fire, water landing, takeoff and next-level request passed`);
    } finally { dispose(); }
}

function planDragonRoute(get) {
    const heights = Array.from({ length: 30 }, (_, index) => -20 + index * 15), costs = [], parents = [];
    // Plan from the real map pixels, allowing limited height change between horizontal samples.
    for (let x = 0; x <= 15200; x += 80) {
        const row = [], previous = costs.at(-1), links = [];
        for (let index = 0; index < heights.length; index++) {
            const y = heights[index]; let hazard = 0;
            for (const [cx, dy] of [[297, 45], [372, 75], [305, 122]]) {
                for (const margin of [-18, 0, 18]) {
                    if (get('PATTERNBKG').GETGRAPHICSAT(x + cx, y + dy + margin, true, false, 0) !== 'UNKNOWN') hazard += 100;
                    if (get('PATTERNFIRE').GETGRAPHICSAT(x + cx, y + dy + margin, false, false, 0) !== 'UNKNOWN') hazard += 2;
                }
            }
            let best = previous ? Infinity : Math.abs(y - 200) * 0.1, last = -1;
            if (previous) for (let from = Math.max(0, index - 4); from <= Math.min(heights.length - 1, index + 4); from++) {
                const score = previous[from] + Math.abs(y - heights[from]) * 0.04;
                if (score < best) { best = score; last = from; }
            }
            row.push(best + hazard + Math.abs(415 - y) * 0.0001); links.push(last);
        }
        costs.push(row); parents.push(links);
    }
    const route = []; let index = costs.at(-1).indexOf(Math.min(...costs.at(-1)));
    for (let x = costs.length - 1; x >= 0; x--) { route[x] = heights[index]; index = parents[x][index]; }
    return route;
}

async function verifyLaterDragonFlights() {
    for (const [level, destination, room] of [[1, 'LEBIODKA', 'DRAGON'], [2, 'ARCADE', 'PRZYSTAN'],
        [3, 'ARCADE', 'WMWEJSCIE'], [4, 'ARCADE', 'PRZYSTAN']]) {
        const { get, routes, memory, screenshots, key, step, dispose } = await createDragonFixture(level);
        const heights = [], mouse = get('MOUSE'), pointer = (x, y) => ({ screen: { x, y }, button: 0 });
        let spraying = false, sprays = 0, strokes = 0, extinguishedInAir = 0;
        try {
            const plan = planDragonRoute(get);
            const lookahead = level === 2 || level === 4 ? 240 : 160;
            const forecast = level === 2 || level === 4 ? 6 : 4;
            for (let tick = 0; tick < 7000 && !routes.length; tick++) {
                const wings = get('ANNSKRZYDLA'), fire = get('ANNDRAGONFIRE'), y = get('VARPOSY').value;
                const wasBurning = fire.ISPLAYING('PLAY'), wasAirborne = get('VARSTARTOWANIE').value === 0;
                const target = plan[Math.min(plan.length - 1, Math.max(0, Math.round((get('VARPOSX').value + lookahead) / 80)))];
                heights.push(y); if (heights.length > 10) heights.shift();
                const predictedY = y + (y - heights[0]) * forecast;
                if (wasBurning && wasAirborne) {
                    const position = pointer(fire.GETCENTERX(), fire.GETCENTERY()); mouse.onMouseMove(position);
                    if (!spraying) { mouse.handleClickEvent(position, 'click'); spraying = true; sprays++; }
                } else if (spraying) {
                    mouse.handleClickEvent(pointer(400, 300), 'release'); spraying = false;
                }
                if (get('VARENERGY').value > 0 && predictedY > target &&
                    ((get('VARDIR').value === 'B' && wings.GETCFRAMEINEVENT() <= 1) ||
                        ['PLYNIE', 'SZYB'].includes(wings.GETEVENTNAME()))) {
                    await key(true); await step(); await key(false); strokes++;
                } else await step();
                if (wasBurning && wasAirborne && get('VARSTARTOWANIE').value === 0 && !fire.ISPLAYING('PLAY')) extinguishedInAir++;
            }
            assert.deepEqual(routes, [destination], `Dragon ${level} full-flight destination`);
            assert.equal(get('G_SARCADEOBJECTS').value, room);
            assert.ok(get('VARPOSX').value > 15000 && get('VARENERGY').value > 0);
            assert.ok(strokes > 0 && sprays > 0 && extinguishedInAir > 0);
            assert.deepEqual(deserializeArray(memory.get('common/dragon0.arr')), [level, 0]);
            assert.equal(screenshots.length, 1);
            assert.equal(get('KEYBOARD').ISENABLED(), true);
            if (level === 2) assert.equal(get('G_SLASTOBJECTS').value, 'DRAGON2');
            console.log(`DRAGON ${level}: full flight, ${strokes} strokes, ${sprays} water bursts, ${extinguishedInAir} airborne extinguishings; ${get('VARENERGY').value} energy, return to ${destination}/${room}`);
        } finally { dispose(); }
    }
}

async function verifyDragonRecoveryAndExits() {
    const failure = await createDragonFixture(1);
    try {
        await failure.step(6000);
        assert.ok(failure.get('VARENERGY').value <= 0);
        assert.deepEqual(failure.routes, ['DRAGON']);
        assert.deepEqual(deserializeArray(failure.memory.get('common/dragon0.arr')), [1, 1]);
        assert.equal(failure.get('KEYBOARD').ISENABLED(), true);
    } finally { failure.dispose(); }
    const restart = await createDragonFixture(4);
    try {
        await restart.get('BTNRESTART').callbacks.run('ONRELEASED');
        await restart.step(240);
        assert.deepEqual(restart.routes, ['DRAGON']);
        assert.deepEqual(deserializeArray(restart.memory.get('common/dragon0.arr')), [4, 1]);
        assert.equal(restart.get('G_SARCADEOBJECTS').value, '4');
    } finally { restart.dispose(); }
    for (const [level, destination, room] of [[1, 'LEBIODKA', 'DRAGON'], [2, 'ARCADE', 'PRZYSTAN'],
        [3, 'ARCADE', 'WMWEJSCIE'], [4, 'ARCADE', 'PRZYSTAN']]) {
        const fixture = await createDragonFixture(level);
        try {
            // Boundary test of each authored ending, not a claim that these four flights were solved.
            await fixture.get('VARPOSX').SET(15001);
            await fixture.step(360);
            assert.deepEqual(fixture.routes, [destination]);
            assert.equal(fixture.get('G_SARCADEOBJECTS').value, room);
            assert.equal(fixture.screenshots.length, 1);
            assert.equal(fixture.get('KEYBOARD').ISENABLED(), true);
            if (level === 2) assert.equal(fixture.get('G_SLASTOBJECTS').value, 'DRAGON2');
        } finally { fixture.dispose(); }
    }
    console.log('DRAGON: natural collision failure, manual restart and four boundary-tested story endings passed');
}

async function verifyLebiodkaCutscene() {
    const { engine, parent, scope, defs, get } = await createArcadeFixture('LEBIODKA', 'Lebiodka', 'Lebiodka.cnv');
    const scenePath = 'dane/game/przygoda/lebiodka', stage = engine.app.stage;
    parent.getRelativePath = name => normalizePath(name.startsWith('$') ? name.slice(1) : `${scenePath}/${name}`);
    engine.filesystem = new Filesystem({
        hasFile: name => fs.existsSync(path.join(assets, name)), registerLogicalFilenames() {},
        getRawFile: async name => bytes(path.join(assets, name)),
    }, { get: async () => null, has: async () => false }, engine.compat);
    engine.rendering.addToStage = sprite => stage.addChild(sprite);
    engine.rendering.removeFromStage = sprite => stage.removeChild(sprite);
    const voices = [], audio = [], routes = [], assetLoader = load('filesystem/assetsLoader.ts');
    const previousLoadSound = assetLoader.loadSound;
    assetLoader.loadSound = async (filesystem, filename) => ({ play: options => {
        audio.push(filename);
        const instance = { isPlaying: true, stop() { this.isPlaying = false; }, pause() {}, resume() {} };
        voices.push(() => { if (instance.isPlaying) { instance.isPlaying = false; options?.onEnd?.(); } });
        return instance;
    } });
    try {
        for (const def of Object.values(defs).filter(def => ['ANIMO', 'IMAGE'].includes(def.TYPE))) {
            const actor = new (def.TYPE === 'ANIMO' ? Animo : Image)(engine, parent, def);
            if (actor instanceof Animo) actor.loadSfx = async () => {};
            scope.set(actor.name, actor); await actor.init(); await actor.applyDefaults(); await actor.ready();
        }
        scope.set('G_SARCADEOBJECTS', new constructors.STRING(engine, parent, { TYPE: 'STRING', NAME: 'G_SARCADEOBJECTS' }));
        const episode = new Type(engine, parent, { TYPE: 'EPISODE', NAME: 'PRZYGODA' });
        episode.GOTO = scene => routes.push(scene); scope.set(episode.name, episode);
        const sequence = new Sequence(engine, parent, defs.GADAJA);
        scope.set(sequence.name, sequence); await sequence.init();
        // Global menu/cursor/music setup is outside this scene-owned animation/dialogue test.
        await get('CPL_SMOK').PLAY('WCHODZI');
        for (let tick = 0; tick < 2400 && !routes.length; tick++) {
            if (voices.length) voices.shift()();
            for (const object of scope.objects) await object.tick(1000 / 60);
        }
        assert.deepEqual(audio.map(name => name.toLowerCase()),
            ['wavs/smokret_d038.wav', 'wavs/rex_r039.wav', 'wavs/smokret_d039.wav']);
        assert.deepEqual(routes, ['DRAGON']);
        assert.equal(get('G_SARCADEOBJECTS').value, '2');
        console.log('LEBIODKA: real scene actors, three original dialogue branches and Dragon level-two request passed');
    } finally {
        assetLoader.loadSound = previousLoadSound;
        assert.deepEqual(engine.scopeManager.destroy(), []);
        assert.equal(stage.children.length, 0);
    }
}

async function verifyMagicieniiEndings() {
    const { Sound } = load('engine/types/sound.ts'), { Application } = load('engine/types/application.ts');
    const expected = [
        ['OUTRO_2', 'kretes_f087', 'nar_f088', 'kretes_f089', 'kogut_f090'],
        ['OUTRO_3', 'kogut_f092', 'kretes_f093', 'rex_r090', 'kurator_f094', 'kretes_f095'],
        ['OUTRO_4', 'nar_f099', 'nar_f100', 'nar_f101', 'k_uniwersytet_02', 'nar_f104',
            'k_uniwersytet_03', 'nar_f103', 'k_uniwersytet_05', 'nar_f102', 'nar_f105'],
        ['OUTRO_5', 'kogut_f096', 'kretes_f097', 'nar_f107', 'nar_f108', 'nar_f109', 'nar_f111', 'nar_f112', 'jp02'],
        ['OUTRO_7', 'kre03', 'jp04', 'mal05', 'jp06', 'kre07', 'jp08', 'mal09', 'jp10', 'mal11'],
        ['OUTRO_7', 'mal12', 'kre13', 'reg05', 'mal14', 'kre19', 'reg09', 'reg07', 'mal17',
            'kre15', 'jp16', 'reg02', 'reg10', 'reg04', 'reg06', 'mal22'],
        ['EXIT', 'susel30', 'marzajac31', 'susel32', 'kapelu33', 'susel34', 'marzajac35',
            'susel36', 'marzajac37', 'kapelu38', 'susel39'],
    ];
    for (let level = 1; level <= 7; level++) {
        const { engine, parent, scope, defs, get } =
            await createArcadeFixture(`OUTRO_${level}`, `Outro/outro${level}`, `outro_${level}.cnv`);
        const base = `dane/game/przygoda/outro/outro${level}`, stage = engine.app.stage;
        const backgrounds = [], voices = [], audio = [], routes = [], screenshots = [];
        engine.resolvePath = async (name, base = '') => normalizePath(name.startsWith('$') ? name.slice(1) : `${base}/${name}`);
        parent.getRelativePath = name => engine.resolvePath(name, base);
        engine.filesystem = new Filesystem({
            hasFile: name => fs.existsSync(path.join(assets, name)), registerLogicalFilenames() {},
            getRawFile: async name => bytes(path.join(assets, name)),
        }, { get: async () => null, has: async () => false }, engine.compat);
        engine.rendering.addToStage = sprite => stage.addChild(sprite);
        engine.rendering.removeFromStage = sprite => stage.removeChild(sprite);
        engine.rendering.setBackground = texture => backgrounds.push(texture);
        const assetLoader = load('filesystem/assetsLoader.ts'), previousLoadSound = assetLoader.loadSound;
        assetLoader.loadSound = async (filesystem, filename) => {
            if (!fs.existsSync(path.join(assets, normalizePath(filename)))) throw new FileNotFoundError(filename);
            const sound = { isPlaying: false, stop() { this.isPlaying = false; }, play(options = {}) {
                if (!options.loop) audio.push(path.posix.basename(normalizePath(filename)));
                this.isPlaying = true; options.onStart?.();
                const instance = { volume: 1, stop() { sound.isPlaying = false; }, pause() {}, resume() {} };
                if (!options.loop) voices.push(() => { if (sound.isPlaying) { sound.isPlaying = false; options.onEnd?.(); } });
                return instance;
            } };
            return sound;
        };
        engine.music = { volume: 1, stop() {} };
        engine.options = { onExit: () => routes.push('EXIT') };
        try {
            for (const def of Object.values(defs)) {
                if (['ANIMO', 'IMAGE'].includes(def.TYPE)) {
                    const actor = new (def.TYPE === 'ANIMO' ? Animo : Image)(engine, parent, def);
                    if (actor instanceof Animo) actor.loadSfx = async () => {};
                    scope.set(actor.name, actor); await actor.init(); await actor.applyDefaults(); await actor.ready();
                } else if (def.TYPE === 'SOUND') {
                    const sound = new Sound(engine, parent, def); scope.set(sound.name, sound); await sound.init();
                } else if (def.TYPE === 'TIMER') scope.set(def.NAME, new Timer(engine, parent, def));
            }
            for (const def of Object.values(defs).filter(def => def.TYPE === 'SEQUENCE')) {
                const sequence = new Sequence(engine, parent, def); scope.set(sequence.name, sequence); await sequence.init();
            }
            const episode = new Type(engine, parent, { TYPE: 'EPISODE', NAME: 'PRZYGODA' });
            episode.GOTO = scene => routes.push(scene); scope.set(episode.name, episode);
            const application = new Application(engine, null, { TYPE: 'APPLICATION', NAME: 'GAME' });
            scope.set(application.name, application);
            const screenshot = new Type(engine, parent, { TYPE: 'BEHAVIOUR', NAME: '__SCREENSHOT__' });
            screenshot.RUN = () => screenshots.push(true); scope.set(screenshot.name, screenshot);
            const flip = new Type(engine, parent, { TYPE: 'BEHAVIOUR', NAME: '__FLIP__' });
            flip.RUN = () => {}; scope.set(flip.name, flip);
            scope.set('G_ITKTPM', new constructors.INTEGER(engine, parent, { TYPE: 'INTEGER', NAME: 'G_ITKTPM', VALUE: 0 }));
            for (const name of ['G_ANNPAGE', 'G_STLPAGE']) {
                const page = new Type(engine, parent, { TYPE: 'ANIMO', NAME: name });
                page.HIDE = () => {}; page.PLAY = () => {}; scope.set(name, page);
            }
            // Global menu/cursor/page effects and voice duration are outside this scene-owned test.
            const code = defs.__INIT__.CODE.code, ast = load('interpreter/parser.ts').parseCode(code);
            await new Interpreter(new RuntimeContext(engine, null, code)).execute(ast.filter(entry =>
                !['G_CURSOR', 'G_MENU', 'G_AMBIENT'].includes(entry.target?.ref?.name)));
            for (let tick = 0; tick < 24000 && !routes.length; tick++) {
                if (voices.length) voices.shift()();
                for (const object of scope.objects) await object.tick(1000 / 60);
            }
            const [destination, ...filenames] = expected[level - 1];
            assert.deepEqual(routes, [destination], `Outro ${level} destination`);
            assert.deepEqual(audio, filenames.map(name => `${name}.wav`), `Outro ${level} voice order`);
            if (level === 1) assert.equal(get('VAR_OUTRO1').value, 5);
            if (level === 3) {
                assert.equal(get('VARO_PRZEB').value, 20); assert.equal(get('VARO_KLATKA').value, 19);
                assert.equal(screenshots.length, 19);
            }
            console.log(`OUTRO ${level}: ${audio.length} original voices, animation/timer chain and ${destination} request passed`);
        } finally {
            engine.music?.stop(); assetLoader.loadSound = previousLoadSound;
            assert.deepEqual(engine.scopeManager.destroy(), [], `Outro ${level} cleanup`);
            backgrounds.forEach(texture => texture.destroy(true));
            assert.equal(stage.children.length, 0);
        }
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

async function createAlchemyFixture(firstVisit = false) {
    const directory = path.join(assets, 'Dane/Game/Przygoda/Arcade');
    const inherited = parseCNV(decryptCNV(bytes(path.join(directory, 'Arcade.cnv'))));
    const local = parseCNV(patchMagicieniiSource('dane/game/przygoda/arcade/alchemy.cnv',
        decryptCNV(bytes(path.join(directory, 'Alchemy.cnv')))));
    const defs = { ...inherited, ...local }, imageCache = new Map(), calls = [], trace = [];
    const scopeManager = new ScopeManager(), scope = scopeManager.newScope('scene');
    const stage = new Container();
    const resolve = name => name.startsWith('$') ? path.join(assets, name.slice(1)) : path.join(directory, name);
    const engine = {
        compat: createEngineCompat('magicienii'), scopeManager, speed: 1,
        saveFile: { loadValue: () => null, saveValue() {} },
        diagnostics: new Proxy({}, { get: (_target, name) => name === 'behaviour' ? object => {
            trace.push(object.name); if (trace.length > 12) trace.shift();
        } : () => {} }), app: { stage, screen: new Rectangle(0, 0, 800, 600) },
        getObject: name => scopeManager.findByName(name?.objectName ?? name),
        currentScene: { name: 'ARCADE', getRelativePath: async name => resolve(name) },
        rendering: { addToStage: sprite => stage.addChild(sprite), removeFromStage: sprite => stage.removeChild(sprite),
            putAtZindex() {}, sortObjects() {} },
        filesystem: { getIMGFile: async filename => {
            if (!imageCache.has(filename)) imageCache.set(filename, loadImage(bytes(filename)));
            return imageCache.get(filename);
        }, saveFile: async () => assert.fail('Alchemy diagnostics must not write game saves') },
    };
    engine.scripting = new ScriptingManager(engine);
    const parent = { name: 'ARCADE', scope };
    // Room persistence, audio and animation playback are boundaries; recipe scripts and image/button logic are real.
    class Media extends Type {
        playing = false; event = ''; x = 0; y = 0;
        PLAY(event = 'PLAY') { this.playing = true; this.event = String(event); }
        STOP() { this.playing = false; } ISPLAYING() { return this.playing; }
        GETEVENTNAME() { return this.event; }
        MOVE(x, y) { this.x += x; this.y += y; }
        LOAD() {} SETPRIORITY() {} SETFRAME() {} SHOW() {} HIDE() {}
    }
    for (const def of Object.values(defs)) {
        const Constructor = def.TYPE === 'IMAGE' ? Image : def.TYPE === 'BUTTON' ? Button :
            def.TYPE === 'STRUCT' ? Struct : def.TYPE === 'GROUP' ? Group : constructors[def.TYPE] ?? Media;
        const object = new Constructor(engine, parent, def);
        scope.set(def.NAME, object);
        if (object instanceof Struct) {
            for (const [name, type] of object.structure) {
                object.content.set(name, new constructors[type](engine, parent, { TYPE: type, NAME: name }));
            }
        }
        if (object instanceof Image) {
            object.sprite = await loadSprite(engine.filesystem, resolve(local[def.NAME] ? def.FILENAME : 'TEMPLATE.IMG'));
            object.sprite.visible = def.VISIBLE;
            await object.applyDefaults();
            if (def.TOCANVAS) stage.addChild(object.sprite);
        }
    }
    const get = name => engine.getObject(name);
    for (const name of ['BEHSELECTOBJ', 'BEHUPDATEOBJECTS', 'BEHSAVESLOTS', 'BEHSAVEDODOS', 'BEHLOADTEMPOBJ',
        'BEHSELECTTEMPOBJS', 'BEHUPDATETEMPOBJ', 'BEHADDITEM', 'BEHLOADSEQARR', 'BEHGOTO', 'BEHFINDITEM', 'BEHREMOVEITEM']) {
        const boundary = new Media(engine, parent, { TYPE: 'BEHAVIOUR', NAME: name });
        boundary.RUN = async (...args) => { calls.push([name, ...args]); return name === 'BEHFINDITEM' ? 0 : undefined; };
        scope.set(name, boundary);
    }
    const menu = new Media(engine, parent, { TYPE: 'GROUP', NAME: 'G_MENU' });
    menu.ADDEXP = number => calls.push(['ADDEXP', number]);
    scope.set(menu.name, menu);
    await get('SOBJECT').SETFIELD('IPARAM0', 1);
    await get('SOBJECT').SETFIELD('SPARAM1', 'fixture');
    await get('STEMPOBJ').SETFIELD('TYPE', 1);
    await get('VARBFIRSTENTER').SET(firstVisit);
    for (const def of Object.values(local).filter(def => def.TYPE === 'BUTTON')) {
        get(def.NAME).init(); await get(def.NAME).applyDefaults();
    }
    try { await get('BEHINITSCRIPT').RUN(); }
    catch (error) { console.error('ALCHEMY INIT TRACE', trace); engine.scopeManager.destroy(); throw error; }
    return { engine, get, defs, calls, stage, trace };
}

async function verifyAlchemy() {
    const existing = await createAlchemyFixture();
    assert.equal(existing.get('VARSDODOPREFIX').value, 'fixture');
    assert.deepEqual(existing.engine.scopeManager.destroy(), []);
    const { engine, get, defs, calls, stage, trace } = await createAlchemyFixture(true);
    try {
        assert.match(get('VARSDODOPREFIX').value, /^S\d{6}$/);
        assert.equal(get('VARSDODOPREFIX').value, await get('SOBJECT').GETFIELD('SPARAM1').getValue());
        const paper = get('IMGKARTKA'), closedX = paper.GETPOSITIONX();
        paper.sprite.emit('pointerover'); await paper.tick();
        assert.equal(get('STLALCH1').ISPLAYING(), true);
        for (let tick = 0; tick < 22; tick++) await get('STLALCH1').callbacks.run('ONFRAMECHANGED', 'ELAPSE');
        assert.equal(get('VARIX').value, 0);
        assert.equal(paper.GETPOSITIONX(), closedX - 220);
        paper.sprite.emit('pointerout'); await paper.tick();
        for (let tick = 0; tick < 22; tick++) await get('STLALCH1').callbacks.run('ONFRAMECHANGED', 'ELAPSE');
        assert.equal(get('VARIX').value, 220);
        assert.equal(paper.GETPOSITIONX(), closedX);
        for (const name of ['IMG_EXIT_STD', 'IMG_EXIT_GLOW', 'IMG_EXIT_CLICK']) assert.equal(get(name).GETPRIORITY(), 610);
        const ast = load('interpreter/parser.ts').parseCode(defs.BEHCALCEFFECT.CODE.code);
        const start = ast.findIndex(entry => entry.type === 'FunctionCall' && entry.target?.type === 'ObjectTarget' &&
            entry.target.ref.name === 'VARIEFFECT' && entry.method === 'SET' && entry.args[0]?.type === 'NumberLiteral' &&
            entry.args[0].value === '0');
        assert.ok(start >= 0);
        assert.equal(ast[start + 1].method, 'LOOP');
        const effects = get('ARREFFECTS').value;
        for (let mask = 0; mask < 256; mask++) {
            const selected = effects.filter((_value, index) => mask & (1 << index));
            get('ARRTEMPDODO').restoreCheckpointValue(selected);
            let expected = 0;
            for (let first = 0; first < selected.length; first++) {
                for (let second = first + 1; second < selected.length; second++) expected |= selected[first] & selected[second];
            }
            await new Interpreter(new RuntimeContext(engine, null, defs.BEHCALCEFFECT.CODE.code)).execute(ast.slice(start, start + 2));
            assert.equal(get('VARIEFFECT').value, expected, `Alchemy ingredient mask ${mask}`);
        }
        const click = async name => {
            const button = get(name), sprite = button.gfxStandard.getRenderObject();
            sprite.emit('pointerdown'); sprite.emit('pointerup'); await button.tick();
        };
        const buttons = ['BTNKOLFLOW', 'BTNKOLBAT', 'BTNKOLCOOK', 'BTNKOLLEBIO',
            'BTNKOLSPIDER', 'BTNKOLFEATHER', 'BTNKOLSHOE', 'BTNKOLSAND'];
        await get('ANNDODO').callbacks.run('ONFINISHED', 'WYCHODZI');
        await click('BTNPALNIK');
        assert.equal(get('VARINUMSLOTS').value, 0, 'An empty mixture must not create a recipe');
        for (const [ingredients, effect, success] of [[[0, 5], 8, false], [[2, 3], 1, false], [[2, 3, 4, 5], 3, true]]) {
            await get('ANNZASLONA').callbacks.run('ONFINISHED', 'IN');
            await get('ANNDODO').callbacks.run('ONFINISHED', 'WYCHODZI');
            for (const index of ingredients) await click(buttons[index]);
            assert.deepEqual(get('ARRACTIVE').value, effects.map((_value, index) => ingredients.includes(index) ? 1 : 0));
            await click('BTNPALNIK');
            assert.equal(get('VARIEFFECT').value, effect);
            assert.equal(get('VARBSUCCESS').value, success);
            const slot = get(`ARRSLOTS_${get('VARINUMSLOTS').value}`);
            assert.ok(slot.value.length >= ingredients.length + 1);
            for (const name of slot.value) assert.ok(stage.children.includes(get(name).getRenderObject()), `${name} must render`);
            if (effect === 1) {
                await get('BFITMP263').RUN();
                assert.equal(get('VARSSTATE').value, 'NORMAL_UCIEKA_MALY');
                assert.equal(get('ANNDODO').GETEVENTNAME(), 'NORMAL_UCIEKA_MALY');
            }
        }
        assert.equal(get('VARINUMSLOTS').value, 3);
        assert.equal(await get('STEMPOBJ').GETFIELD('TYPE').GET(), 0);
        assert.ok(calls.some(call => call[0] === 'ADDEXP' && call[1] === 30));
        assert.ok(calls.some(call => call[0] === 'BEHADDITEM' && call[1] === 'ELIKSIR_BUT'));
        await click('BTNEXITALCH');
        assert.ok(calls.some(call => call[0] === 'BEHGOTO' && call[1] === 'PIWNICA'));
        assert.deepEqual(calls.filter(call => call[0] === 'BEHREMOVEITEM').map(call => call[1]), get('ARRSKLADNIKI').value);
        console.log('ALCHEMY: first/repeat entry, save-prefix creation, paper scrolling, 256 ingredient subsets, three recipes and success/exit branches passed');
    } catch (error) {
        console.error('ALCHEMY TRACE', trace); throw error;
    } finally {
        assert.deepEqual(engine.scopeManager.destroy(), [], 'Alchemy scene objects must clean up');
    }
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
    await verifyBroomRecoveryAndControls();
    await verifyBroomFlight();
    await verifyStartupCursor();
    await verifyCat();
    await verifyCatHerding();
    await verifyCatSavedProgress();
    await verifyBarandalf();
    await verifyBarandalfBoat();
    await verifyBarandalfRecovery();
    await verifyBarandalfRoutes();
    await verifyBarandalfBoatCompletion();
    await verifyBarandalfBoatHazard();
    await verifyMazeEnemies();
    await verifyMazePlayers();
    await verifyMazePuzzleInitialization();
    await verifyMazeFirstRoute();
    await verifyMazeRescueRoute();
    await verifyMazeCardRoute();
    await verifyPiklibia();
    await verifyMazeSpellControls();
    await verifyMazeEnemySpellHits();
    await verifyMazeRecovery();
    await verifyFredRoute();
    await verifyFredRecovery();
    await verifyCupsPuzzle();
    await verifyShooterRecovery();
    await verifyShooterControls();
    await verifyShooterWaves();
    await verifyDragonControls();
    await verifyDragonPattern();
    await verifyDragonLevelInitialization();
    await verifyDragonFlight();
    await verifyLaterDragonFlights();
    await verifyDragonRecoveryAndExits();
    await verifyLebiodkaCutscene();
    await verifyMagicieniiEndings();
    await verifyAlchemy();
    assert.deepEqual(errors, [], 'The original scripts must not call unsupported methods');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
