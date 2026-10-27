const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { Point, Texture, BaseTexture } = require('pixi.js');

module.exports = async function createAdventureFixture(runtime, options = {}) {
    const { assets, load, normalizePath, Type, Animo, Sequence, Mouse, CanvasObserver, StaticFilter, constructors } = runtime;
    const room = options.room ?? 'Piklibia';
    const dialogs = room === 'Dialogs', choice = room === 'Choice';
    const fixture = await require('./verify-magicienii-piklibia.cjs').createFixture(runtime, { ...options, initialize: false });
    const { engine, parent, scope, defs, get } = fixture;
    const assetLoader = load('filesystem/assetsLoader.ts'), originalSound = assetLoader.loadSound;
    const { IgnorableError } = load('common/errors.ts');
    class SceneTransition extends IgnorableError {}
    const voices = [], audio = [], backgrounds = [], routes = [], captures = [];
    let elapsed = 0, menuState;
    const dispose = () => {
        assetLoader.loadSound = originalSound;
        for (const { texture } of backgrounds) texture.destroy(true);
        menuState?.dispose();
        fixture.dispose();
    };
    const { UrlFileLoader, FileNotFoundError } = load('filesystem/fileLoader.ts');
    // Keep production path resolution; only HTTP and game-save storage are replaced.
    class LocalLoader extends UrlFileLoader {
        constructor() {
            super();
            this.listing = new Map(fs.readdirSync(assets, { recursive: true })
                .filter(name => fs.statSync(path.join(assets, name)).isFile()).map(name => [normalizePath(name), name]));
        }
        async getRawFile(name) {
            const target = this.resolveListedPath(normalizePath(name));
            if (!target) throw new FileNotFoundError(name);
            const data = fs.readFileSync(path.join(assets, this.listing.get(target)));
            return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        }
    }
    try {
        engine.filesystem.fileLoader = new LocalLoader();
        engine.resolvePath = async (name, base = '') => normalizePath(name.startsWith('$') ? name.slice(1) : `${base}/${name}`);
        parent.getRelativePath = name => engine.resolvePath(name, `dane/game/przygoda/${dialogs ? 'dialogs' : choice ? 'choice' : 'arcade'}`);
        // Audio duration and GPU background display are boundaries, not speech completion.
        assetLoader.loadSound = async (_filesystem, filename) => {
            const data = await engine.filesystem.getFile(filename);
            assert.ok(data.byteLength > 0, filename);
            const sound = { isPlaying: false, stop() { this.isPlaying = false; }, pause() {}, resume() {},
                play(settings = {}) {
                    this.isPlaying = true; audio.push(normalizePath(filename)); settings.onStart?.();
                    const instance = { isPlaying: true, stop() { this.isPlaying = false; sound.stop(); }, pause() {}, resume() {} };
                    voices.push(() => {
                        if (!instance.isPlaying || !sound.isPlaying) return;
                        instance.isPlaying = false; sound.isPlaying = false; settings.onEnd?.();
                    });
                    return instance;
                },
            };
            return sound;
        };
        const { Sound } = load('engine/types/sound.ts');
        for (const def of Object.values(defs).filter(def => def.TYPE === 'SOUND')) {
            const sound = new Sound(engine, parent, def); scope.set(sound.name, sound); await sound.init();
        }
        const { Image } = load('engine/types/image.ts');
        for (const def of Object.values(defs).filter(def => def.TYPE === 'IMAGE')) {
            const image = new Image(engine, parent, def); scope.set(image.name, image);
            await image.init(); await image.applyDefaults(); await image.ready();
        }
        for (const def of Object.values(defs).filter(def => def.TYPE === 'SEQUENCE')) {
            const sequence = new Sequence(engine, parent, def);
            sequence.getAnimo = async name => {
                const existing = get(name) ?? scope.objects.find(object => object instanceof Animo && object.definition.FILENAME === name);
                if (existing) return existing;
                const actor = new Animo(engine, parent, { TYPE: 'ANIMO', NAME: name, FILENAME: name,
                    FPS: 16, TOCANVAS: true, VISIBLE: true, PRIORITY: 0 });
                actor.loadSfx = async () => {}; scope.set(actor.name, actor);
                await actor.init(); await actor.applyDefaults(); await actor.ready(); return actor;
            };
            scope.set(sequence.name, sequence); await sequence.init();
        }
        const canvas = new CanvasObserver(engine, parent, defs.CANVASOBSERVER);
        // GPU capture is a presentation boundary, separate from the native crop/save unit tests.
        canvas.SAVE = (...args) => captures.push(args);
        scope.set(canvas.name, canvas);
        engine.rendering.setBackground = (texture, position) => backgrounds.push({ texture, position });
        scope.set('MOUSE', new Mouse(engine, parent, defs.MOUSE));
        if (defs.FCOLOR) scope.set('FCOLOR', new StaticFilter(engine, parent, defs.FCOLOR));
        if (dialogs || choice) {
            const { Rand } = load('engine/types/rand.ts');
            scope.set('RANDOM', new Rand(engine, parent, { TYPE: 'RAND', NAME: 'RANDOM' }));
            Texture._WHITE ??= new Texture(BaseTexture.fromBuffer(new Uint8Array([255, 255, 255, 255]), 1, 1));
        }
        if (choice) {
            const { Button } = load('engine/types/button.ts');
            for (const def of Object.values(defs).filter(def => def.TYPE === 'BUTTON')) {
                const button = new Button(engine, parent, def); scope.set(button.name, button);
                button.init(); await button.applyDefaults(); await button.ready();
            }
        }
        const boundary = (name, methods) => {
            const object = new Type(engine, parent, { TYPE: 'CLASS_INSTANCE', NAME: name });
            for (const method of methods) object[method] = () => {};
            scope.set(name, object); return object;
        };
        for (const [name, methods] of [
            ['__GAME_INIT__', ['RUN']], ['__FLIP__', ['RUN']], ['__SCREENSHOT__', ['RUN']],
            ['G_MENU', ['SETSCENE', 'SAVESETS', 'SHOW']], ['G_CARD', ['SETSCENE', 'LOAD']],
            ['G_CURSOR', ['SETSCENE', 'SETARCADE', 'SHOW']], ['G_AMBIENT', ['SETAMBIENT']], ['G_ANNPAGE', ['PLAY']],
        ]) boundary(name, methods);
        const cnv = boundary('CNVLOADER', ['LOAD']);
        cnv.LOAD = filename => assert.equal(filename, `${room.toUpperCase()}.CNV`);
        const episode = boundary('PRZYGODA', ['GOTO']);
        episode.GOTO = scene => { routes.push(scene); throw new SceneTransition(); };
        for (const [name, type, value] of [['SCENENAME', 'STRING', dialogs ? 'DIALOGS' : choice ? 'CHOICE' : 'ARCADE'], ['G_IKRETACTIVE', 'INTEGER', 1], ['G_IFLIPPAGE', 'INTEGER', 0]]) {
            scope.set(name, new constructors[type](engine, parent, { TYPE: type, NAME: name, VALUE: value }));
        }
        const settings = new constructors.ARRAY(engine, parent, { TYPE: 'ARRAY', NAME: 'G_ARRSETTINGS' });
        settings.ADD(1, 500); scope.set(settings.name, settings);
        const book = new constructors.ARRAY(engine, parent, { TYPE: 'ARRAY', NAME: 'G_ARRREXSPELLS' });
        scope.set(book.name, book);
        if (fixture.memory.has('common/spells0.arr')) await book.LOAD('$COMMON\\SPELLS0.ARR');
        else book.restoreCheckpointValue([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 64, 0, 0, 0, 0]);
        menuState = await require('./magicienii-menu-fixture.cjs')(runtime, fixture);
        parent.STARTMUSIC = async filename => { await assetLoader.loadSound(engine.filesystem, filename); };
        parent.SETMUSICVOLUME = () => {};
        for (const name of dialogs ? ['DBDIALOG'] : choice ? [] : ['DBOBJECTS', 'DBITEMS']) get(name).REMOVEALL();
        await get('MOUSE').ready(); await get('__INIT__').RUN();
        const step = async (count, check) => {
            for (let tick = 0; tick < count; tick++) {
                try {
                    if (voices.length) voices.shift()();
                    for (const object of [...scope.objects]) await object.tick(1000 / 30);
                } catch (error) { if (!(error instanceof SceneTransition)) throw error; }
                elapsed++; await check?.();
                if (routes.length) break;
            }
        };
        const buttonAt = (x, y) => {
            const point = new Point(x, y);
            for (const area of [...engine.app.stage.children].reverse()) {
                if (!area.visible || area.eventMode !== 'dynamic') continue;
                const local = area.toLocal(point);
                if (!(area.hitArea ? area.hitArea.contains(local.x, local.y) : area.containsPoint(point, true))) continue;
                const object = scope.objects.find(object => object.buttonInteractArea === area || object.getRenderObject?.() === area);
                if (object) return { object, area };
            }
            return null;
        };
        const click = async (x, y, duration = 1) => {
            assert.ok(x >= 0 && x < 800 && y >= 0 && y < 600);
            assert.ok(x < 730 || y >= 80, 'The book overlay is outside this fixture');
            const pointer = { button: 0, screen: { x, y } }, mouse = get('MOUSE');
            // The renderer is absent, but button input must still pass through its real state machine.
            const button = dialogs || choice ? buttonAt(x, y)?.area : null;
            button?.emit('pointerover', pointer); button?.emit('pointerdown', pointer);
            mouse.lastClicksTime = {}; mouse.onMouseMove(pointer); mouse.handleClickEvent(pointer, 'click');
            try { await mouse.tick(16); }
            catch (error) { if (!(error instanceof SceneTransition)) throw error; }
            if (routes.length) return;
            await step(duration); if (routes.length) return;
            button?.emit('pointerup', pointer); if (button) await step(1);
        };
        const findPixel = name => {
            const actor = get(name), box = actor.getRenderObject().getBounds();
            const menu = /^ANNITEM\d+$/.test(name), minZ = menu ? 2998 : 0;
            const maxZ = menu ? 2998 : dialogs ? 15 : choice ? 5000 : get('VARIMAXPRIORITY').value;
            const owned = (x, y) => x >= 0 && x < 800 && y >= 0 && y < 600 && (x < 730 || y >= 80) &&
                ((dialogs || choice) && (actor.buttonInteractArea || actor.getRenderObject().eventMode === 'dynamic') ? buttonAt(x, y)?.object.name === actor.name :
                    canvas.GETGRAPHICSAT(x, y, true, dialogs ? 15 : minZ, maxZ, dialogs) === actor.name);
            for (const fy of [.5, .75, .25, .9, .1]) for (const fx of [.5, .75, .25, .9, .1]) {
                const x = Math.floor(box.x + fx * box.width), y = Math.floor(box.y + fy * box.height);
                if (owned(x, y)) return [x, y];
            }
            for (let y = Math.max(0, Math.ceil(box.y)); y < Math.min(600, box.y + box.height); y++) {
                for (let x = Math.max(0, Math.ceil(box.x)); x < Math.min(800, box.x + box.width); x++) {
                    if (owned(x, y)) return [x, y];
                }
            }
            return null;
        };
        const clickActor = async (name, duration = 1) => {
            const pixel = findPixel(name); assert.ok(pixel, `${name} must expose a visible clickable pixel`);
            await click(...pixel, duration);
        };
        return { ...fixture, audio, backgrounds, routes, captures, step, click, findPixel, clickActor, dispose, get elapsed() { return elapsed; } };
    } catch (error) { dispose(); throw error; }
};
