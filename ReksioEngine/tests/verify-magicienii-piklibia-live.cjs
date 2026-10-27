const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

module.exports = async function verifyPiklibiaLive(runtime) {
    const { assets, load, normalizePath, Type, Animo, Sequence, Mouse, CanvasObserver, StaticFilter, constructors } = runtime;
    const fixture = await require('./verify-magicienii-piklibia.cjs').createFixture(runtime, { initialize: false });
    const { engine, parent, scope, defs, get, missing } = fixture;
    const assetLoader = load('filesystem/assetsLoader.ts'), originalSound = assetLoader.loadSound;
    const voices = [], audio = [], backgrounds = [], switches = new Set(), routes = [];
    const { UrlFileLoader, FileNotFoundError } = load('filesystem/fileLoader.ts');
    // Reuse the production listing resolver without HTTP; all game-save writes remain in memory.
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
        parent.getRelativePath = name => engine.resolvePath(name, 'dane/game/przygoda/arcade');
        // Only audio duration and GPU background display are boundaries, not speech callbacks.
        assetLoader.loadSound = async (_filesystem, filename) => {
            const data = await engine.filesystem.getFile(filename);
            assert.ok(data.byteLength > 0, filename);
            const sound = { isPlaying: false, stop() { this.isPlaying = false; }, pause() {}, resume() {},
                play(options = {}) {
                    this.isPlaying = true; audio.push(normalizePath(filename)); options.onStart?.();
                    const instance = { isPlaying: true, stop() { this.isPlaying = false; sound.stop(); }, pause() {}, resume() {} };
                    voices.push(() => {
                        if (!instance.isPlaying || !sound.isPlaying) return;
                        instance.isPlaying = false; sound.isPlaying = false; options.onEnd?.();
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
        scope.set(canvas.name, canvas);
        engine.rendering.setBackground = (texture, position) => backgrounds.push({ texture, position });
        scope.set('MOUSE', new Mouse(engine, parent, defs.MOUSE));
        scope.set('FCOLOR', new StaticFilter(engine, parent, defs.FCOLOR));
        const boundary = (name, methods) => {
            const object = new Type(engine, parent, { TYPE: 'CLASS_INSTANCE', NAME: name });
            for (const method of methods) object[method] = () => {};
            scope.set(name, object); return object;
        };
        for (const [name, methods] of [
            ['__GAME_INIT__', ['RUN']], ['__FLIP__', ['RUN']], ['__SCREENSHOT__', ['RUN']],
            ['G_MENU', ['SETSCENE', 'SAVESETS', 'SHOW', 'ADDEXP']], ['G_CARD', ['SETSCENE', 'LOAD']],
            ['G_CURSOR', ['SETSCENE', 'SETARCADE', 'SHOW']], ['G_AMBIENT', ['SETAMBIENT']], ['G_ANNPAGE', ['PLAY']],
        ]) boundary(name, methods);
        const cnv = boundary('CNVLOADER', ['LOAD']);
        cnv.LOAD = filename => assert.equal(filename, 'PIKLIBIA.CNV', 'The already-installed overlay must be requested normally');
        const episode = boundary('PRZYGODA', ['GOTO']); episode.GOTO = scene => routes.push(scene);
        for (const [name, type, value] of [['SCENENAME', 'STRING', 'ARCADE'], ['G_IKRETACTIVE', 'INTEGER', 1], ['G_IFLIPPAGE', 'INTEGER', 0]]) {
            scope.set(name, new constructors[type](engine, parent, { TYPE: type, NAME: name, VALUE: value }));
        }
        const settings = new constructors.ARRAY(engine, parent, { TYPE: 'ARRAY', NAME: 'G_ARRSETTINGS' });
        settings.ADD(1, 500); scope.set(settings.name, settings);
        parent.STARTMUSIC = async filename => { await assetLoader.loadSound(engine.filesystem, filename); };
        parent.SETMUSICVOLUME = () => {};
        for (const name of ['DBOBJECTS', 'DBITEMS']) get(name).REMOVEALL();
        await get('MOUSE').ready(); await get('__INIT__').RUN();
        const navigation = get('WPATH'), cameraPositions = [];
        const step = async count => {
            for (let tick = 0; tick < count; tick++) {
                if (voices.length) voices.shift()();
                for (const object of [...scope.objects]) await object.tick(1000 / 30);
                const y = navigation.GETBKGPOSY(); cameraPositions.push(y);
                assert.ok(y >= -300 && y <= 300, 'The live adventure camera must stay inside the original background bounds');
                assert.ok(Math.abs(get('ANNBKG').GETPOSITIONY() - (-300 - y)) <= 1,
                    'The original tick must keep the background aligned with its navigation camera');
                assert.deepEqual(routes, [], 'Normal board movement must not trigger an unrelated scene');
            }
        };
        await step(500);
        assert.equal(get('VARIFIRSTENTER').value, 0, 'The original arrival animation must release scene input');
        assert.equal(navigation.GETBKGPOSY(), 245);
        assert.equal(navigation.GETPOSITIONY(100), 300);
        assert.equal(backgrounds.length, 1);
        assert.ok(Array.from({ length: 8 }, (_value, index) => get(`ANNKNIGHT${index}`).getRenderObject().getBounds())
            .some(bounds => bounds.x < 800 && bounds.y < 600 && bounds.x + bounds.width > 0 && bounds.y + bounds.height > 0),
        'At least one live knight must occupy the visible board, not the zero-coordinate off-screen pile');
        // Only mouse destinations and elapsed ticks after entry: no body, switch or health writes.
        for (const [x, y] of [[500, 500], [500, 550], [500, 100], [200, 100], [200, 500], [650, 500],
            [650, 100], [400, 100], [400, 550], [250, 550], [250, 150], [700, 400]]) {
            const pointer = { button: 0, screen: { x, y } }, mouse = get('MOUSE');
            mouse.lastClicksTime = {}; mouse.onMouseMove(pointer); mouse.handleClickEvent(pointer, 'click');
            await mouse.tick(16); await step(180);
            for (let index = 0; index < 24; index++) {
                if (get(`ANNOBJECT${index}`).GETEVENTNAME() !== 'STATE0') switches.add(index);
            }
        }
        assert.ok(Math.min(...cameraPositions) < -200 && Math.max(...cameraPositions) > 200,
            'Normal mouse input must traverse both the top and bottom parts of the scrolling map');
        assert.ok(switches.size >= 8, 'Walking across the map must activate its original three-way switch hit tests');
        assert.ok(audio.includes('wavs/nar_p017.wav') && audio.includes('wavs/kretes_p018.wav'));
        assert.equal(get('STL0').ISPLAYING(), true); assert.equal(navigation.started, true);
        const optional = [...missing].filter(name => !['BEHPOSTINIT', 'BEHENTERED', 'BEHAUXGADA'].includes(name) &&
            !/^BEHFINISHEDS[012]_ZNAK\d+$/.test(name));
        assert.deepEqual(optional, [], 'All required live room callbacks must resolve');
        console.log(`PIKLIBIA LIVE: complete adventure initialization, real navigation/actors/dialogue, 12 mouse destinations, scrolling bounds and ${switches.size} walked switch activations passed`);
    } finally {
        assetLoader.loadSound = originalSound;
        for (const { texture } of backgrounds) texture.destroy(true);
        fixture.dispose();
    }
};
