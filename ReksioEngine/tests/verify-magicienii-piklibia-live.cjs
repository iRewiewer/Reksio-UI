const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

module.exports = async function verifyPiklibiaLive(runtime) {
    const recording = require('./fixtures/magicienii-piklibia-puzzle.json');
    const { assets, load, normalizePath, Type, Animo, Sequence, Mouse, CanvasObserver, StaticFilter, constructors } = runtime;
    const fixture = await require('./verify-magicienii-piklibia.cjs').createFixture(runtime, { initialize: false });
    const { engine, parent, scope, defs, get, missing } = fixture;
    const assetLoader = load('filesystem/assetsLoader.ts'), originalSound = assetLoader.loadSound;
    const voices = [], audio = [], backgrounds = [], switches = new Set(), routes = [];
    let elapsed = 0, saved;
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
        for (let index = 0; index < 24; index++) {
            const actor = get(`ANNOBJECT${index}`), event = actor.annFile.events[0], frame = event.frames[0];
            const image = actor.annFile.annImages[event.framesImageMapping[0]];
            assert.deepEqual([get('ARRGOTOX').GET(index), get('ARRGOTOY').GET(index)],
                [image.positionX + frame.positionX + image.height, image.positionY + frame.positionY],
                `Switch ${index} must retain its own authored walking destination`);
        }
        const navigation = get('WPATH'), cameraPositions = [];
        const step = async count => {
            for (let tick = 0; tick < count; tick++) {
                if (voices.length) voices.shift()();
                for (const object of [...scope.objects]) await object.tick(1000 / 30);
                const y = navigation.GETBKGPOSY(); cameraPositions.push(y);
                assert.ok(y >= -300 && y <= 300, 'The live adventure camera must stay inside the original background bounds');
                assert.ok(Math.abs(get('ANNBKG').GETPOSITIONY() - (-300 - y)) <= 1,
                    'The original tick must keep the background aligned with its navigation camera');
                elapsed++;
                if (routes.length) break;
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
        assert.equal(recording.frameRate, 30);
        for (const [frame, x, y, duration] of recording.inputs) {
            assert.equal(elapsed, frame, 'Recorded clicks must retain their original timing');
            assert.ok(x >= 0 && x < 800 && y >= 0 && y < 600);
            assert.ok(x < 730 || y >= 80, 'The replay must avoid the global book overlay, which is a fixture boundary');
            assert.deepEqual(routes, [], 'The house transition must occur only at the end of the puzzle route');
            const pointer = { button: 0, screen: { x, y } }, mouse = get('MOUSE');
            mouse.lastClicksTime = {}; mouse.onMouseMove(pointer); mouse.handleClickEvent(pointer, 'click');
            await mouse.tick(16); await step(duration);
            for (let index = 0; index < 24; index++) {
                if (get(`ANNOBJECT${index}`).GETEVENTNAME() !== 'STATE0') switches.add(index);
            }
        }
        assert.ok(Math.min(...cameraPositions) < -200 && Math.max(...cameraPositions) > 200,
            'Normal mouse input must traverse both the top and bottom parts of the scrolling map');
        assert.ok(switches.size >= 8, 'Walking across the map must activate its original three-way switch hit tests');
        assert.ok(audio.includes('wavs/nar_p017.wav') && audio.includes('wavs/kretes_p018.wav'));
        assert.ok(audio.includes('wavs/snd_crashp.wav') && audio.includes('wavs/kretes_p050.wav'));
        assert.ok(audio.includes('wavs/nar_p057.wav'), 'The original house-entry dialogue must finish');
        assert.equal(elapsed, recording.expected.ticks);
        assert.equal(get('VARINUMZLOM').value, 8, 'The native pickup callbacks must award all eight scrap pieces');
        assert.deepEqual(routes, ['ARCADE']); assert.equal(get('G_SARCADEOBJECTS').value, 'DOMSPIEL');
        for (let index = 0; index < 8; index++) {
            assert.equal(get(`ANNKNIGHT${index}`).ISVISIBLE(), false, `Collected knight ${index} must stay hidden`);
            assert.ok(await get('BEHFINDITEM').RUN(`ZLOM${index}_BUT`) >= 0, `Scrap ${index} must be in the real database`);
            assert.equal(await get('DBITEMS_CURSOR').GETFIELD('PARENT').getValue(), -1);
            await get('BEHSELECTOBJ').RUN(index);
            assert.equal(await get('SOBJECT').GETFIELD('IPARAM2').getValue(), 1);
        }
        saved = [...fixture.memory];
        const optional = [...missing].filter(name => !['BEHPOSTINIT', 'BEHENTERED', 'BEHAUXGADA'].includes(name) &&
            !/^BEHFINISHEDS[012]_ZNAK\d+$/.test(name) && !/^BEHFOCUSO(?:N|FF)_/.test(name));
        assert.deepEqual(optional, [], 'All required live room callbacks must resolve');
        console.log(`PIKLIBIA PUZZLE: ${recording.inputs.length} native mouse destinations, all eight live knight crashes/pickups, scrolling, saved switches/positions and original house-entry dialogue/DOMSPIEL transition passed`);
    } finally {
        assetLoader.loadSound = originalSound;
        for (const { texture } of backgrounds) texture.destroy(true);
        fixture.dispose();
    }
    const restored = await require('./verify-magicienii-piklibia.cjs').createFixture(runtime, { files: saved, previous: 'DOMSPIEL' });
    try {
        for (let index = 0; index < 8; index++) {
            assert.equal(restored.get(`ANNKNIGHT${index}`).ISVISIBLE(), false,
                `Collected knight ${index} must not respawn after reloading the saved room`);
            assert.ok(await restored.get('BEHFINDITEM').RUN(`ZLOM${index}_BUT`) >= 0);
        }
        assert.deepEqual(restored.saves, [], 'Reloading the completed board must not rewrite or duplicate rewards');
        console.log('PIKLIBIA RELOAD: saved database bytes retain all eight scrap items and suppress every collected knight');
    } finally { restored.dispose(); }
};
