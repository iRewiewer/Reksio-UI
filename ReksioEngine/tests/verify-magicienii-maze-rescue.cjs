const assert = require('node:assert/strict');

module.exports = async function verifyMazeRescueRoute(runtime) {
    const { assets, createMazePuzzleFixture, load, Keyboard, Mouse, Interpreter, RuntimeContext,
        Type, Animo, Sequence, constructors } = runtime;
    const recording = require('./fixtures/magicienii-maze-rescue.json');
    const previousWindow = globalThis.window;
    globalThis.window = new EventTarget();
    const { engine, parent, scope, defs, get, stage, backgrounds, reads } = await createMazePuzzleFixture(1, true);
    const assetLoader = load('filesystem/assetsLoader.ts'), previousSound = assetLoader.loadSound;
    const voices = [], audio = [], loaded = new Set(), routes = [], screenshots = [];
    let elapsed = 0, waypoints = 0, drawn = 0;
    try {
        // Audio duration, the learned spellbook and GPU compositing are fixture inputs.
        // Every actor, collision mask, pressure plate, projectile and curse timer stays live.
        const normalize = name => name.toLowerCase().replaceAll('\\', '/');
        const preload = async filename => {
            const data = await engine.filesystem.getFile(filename);
            assert.ok(data.byteLength > 0, `Original maze sound: ${filename}`);
            loaded.add(normalize(filename));
        };
        const voice = (filename, onEnd) => {
            assert.ok(loaded.has(normalize(filename)), filename);
            const instance = { isPlaying: true, stop() { this.isPlaying = false; }, pause() {}, resume() {} };
            audio.push(normalize(filename));
            voices.push(() => { instance.isPlaying = false; onEnd?.(); });
            return instance;
        };
        assetLoader.loadSound = async (_filesystem, filename) => {
            await preload(filename);
            return { play: options => voice(filename, options?.onEnd) };
        };
        for (const object of scope.objects.filter(object => object.definition.TYPE === 'SOUND')) {
            const filename = `wavs/${object.definition.FILENAME}`;
            await preload(filename);
            object.playForSequence = onEnd => voice(filename, onEnd);
        }
        const pixel = new Animo(engine, parent, { TYPE: 'ANIMO', NAME: '__ROUTE_PIXEL__',
            FILENAME: '$\\COMMON\\PIXEL.ANN', TOCANVAS: true, VISIBLE: true });
        pixel.loadSfx = async () => {}; scope.set(pixel.name, pixel);
        await pixel.init(); await pixel.applyDefaults(); await pixel.ready();
        const sequence = new Sequence(engine, parent, defs.SEQLAB);
        sequence.getAnimo = async filename => { assert.equal(filename, '$\\COMMON\\PIXEL.ANN'); return pixel; };
        scope.set(sequence.name, sequence); await sequence.init();
        const keyboard = new Keyboard(engine, parent, defs.KEYBOARD), mouse = new Mouse(engine, parent, defs.MOUSE);
        scope.set(keyboard.name, keyboard); scope.set(mouse.name, mouse);
        get('IMGDARK').MERGEALPHA = () => {};
        const cursor = new Type(engine, parent, { TYPE: 'CLASS_INSTANCE', NAME: 'G_CURSOR' });
        cursor.SETPOSITIONNOCALL = () => {}; scope.set(cursor.name, cursor);
        const book = new constructors.ARRAY(engine, parent, { TYPE: 'ARRAY', NAME: 'G_ARRREXSPELLS' });
        book.restoreCheckpointValue(Array(12).fill(1)); scope.set(book.name, book);
        const episode = new Type(engine, parent, { TYPE: 'EPISODE', NAME: 'PRZYGODA' });
        episode.GETCURRENTSCENE = () => 'LABIRYNT'; episode.GOTO = scene => routes.push(scene);
        scope.set(episode.name, episode);
        const screenshot = new Type(engine, parent, { TYPE: 'BEHAVIOUR', NAME: '__SCREENSHOT__' });
        screenshot.RUN = () => screenshots.push(true); scope.set(screenshot.name, screenshot);
        await get('BEHINITSPELL').RUN();
        await keyboard.ready(); keyboard.SETAUTOREPEAT(false);
        const ast = load('interpreter/parser.ts').parseCode(defs.__INIT__.CODE.code);
        const start = ast.findIndex(entry => entry.target?.ref?.name === 'BEHINITPLAYERS');
        assert.ok(start >= 0);
        await new Interpreter(new RuntimeContext(engine, null, defs.__INIT__.CODE.code)).execute(ast.slice(start + 1));
        const step = async () => {
            elapsed++;
            if (voices.length) voices.shift()();
            for (const object of scope.objects) await object.tick(1000 / 30);
            assert.ok(get('VARREXZYCIA').value > 0 && get('VARKRETZYCIA').value > 0,
                `Both heroes must survive rescue frame ${elapsed}`);
            assert.deepEqual(routes, [], 'Normal rescue inputs must not enter a failure/restart route');
        };
        const draw = async spell => {
            let x = 400, y = 300;
            const pointer = () => ({ button: 0, screen: { x, y } });
            mouse.onMouseMove(pointer()); mouse.SETPOSITION(x, y); await mouse.tick(16);
            await get('VARMOUSEPOSX').SET(x); await get('VARMOUSEPOSY').SET(y);
            mouse.handleClickEvent(pointer(), 'click'); await mouse.tick(16);
            for (const angle of get(`ARRPATTERN${spell}`).value) {
                x += Math.round(60 * Math.cos(angle * Math.PI / 180));
                y += Math.round(60 * Math.sin(angle * Math.PI / 180));
                mouse.onMouseMove(pointer()); await mouse.tick(16);
            }
            mouse.handleClickEvent(pointer(), 'release'); await mouse.tick(16);
            assert.equal(get('VARPLAYERSPELLTYPE').value, spell, 'Recorded mouse strokes must arm the learned spell');
            drawn++;
        };
        await sequence.PLAY('ENTRE_LAB1');
        // This is a native-input transcript, not saved state: never write positions, health or rescue flags.
        for (const [frame, command, ...args] of recording.inputs) {
            assert.ok(frame >= elapsed && frame <= recording.frames);
            while (elapsed < frame) await step();
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(command) || /^Digit[1-9]$/.test(command)) {
                const key = command.startsWith('Arrow') ? command.slice(5).toUpperCase() : command.slice(5);
                const event = new Event(args[0] ? 'keydown' : 'keyup');
                Object.assign(event, { code: command, key }); window.dispatchEvent(event); await keyboard.tick();
            } else if (command === 'draw') await draw(args[0]);
            else if (command === 'cast') {
                const pointer = { button: 0, screen: { x: 400, y: 300 } };
                mouse.handleClickEvent(pointer, 'click'); await mouse.tick(16);
                mouse.handleClickEvent(pointer, 'release'); await mouse.tick(16);
            } else if (command === 'at') {
                const [number, x, y] = args, actor = get(`ANNPLAYER${number - 1}`);
                assert.equal(get('VARPLAYERNAME').value, actor.name);
                assert.deepEqual([actor.GETCENTERX(), actor.GETCENTERY()], [x, y], `Rescue waypoint ${++waypoints}`);
                assert.notEqual(actor.GETEVENTNAME(), 'PRISONER');
            } else assert.fail(`Unknown rescue input: ${command}`);
        }
        while (elapsed < recording.frames) await step();
        assert.deepEqual(get('ARRAYPLAYERS').value.map(name => [get(name).GETCENTERX(), get(name).GETCENTERY()]),
            [[380, 100], [140, 100], [180, 100], [100, 100], [60, 100], [340, 100], [220, 100], [300, 100], [260, 100]],
            'Both heroes and all seven prisoners must reach the original exit through ordinary controls');
        assert.equal(get('G_ISUCCESS').value, 1, 'The original all-prisoners callback must award success');
        assert.equal(get('BTNEXIT').logic.enabled, true);
        assert.deepEqual([get('VARREXZYCIA').value, get('VARKRETZYCIA').value], recording.health);
        assert.ok(audio.includes('wavs/krasnal_k289.wav'), 'The original completion dialogue must play');
        assert.ok(reads.includes('wavs/kretes_k289.wav'), 'The installed rescue voice must load through the compatibility fallback');
        const button = get('BTNEXIT'), sprite = get(button.definition.GFXSTANDARD.objectName).getRenderObject();
        for (const event of ['pointerover', 'pointerdown', 'pointerup']) sprite.emit(event);
        await button.tick();
        assert.deepEqual(routes, ['ARCADE']); assert.equal(get('G_SARCADEOBJECTS').value, 'CALINECZKA');
        assert.equal(screenshots.length, 1);
        console.log(`MAZE 1 RESCUE: ${waypoints} natural-input waypoints, ${drawn} drawn spells, all seven prisoners, live guards, pressure hand-offs, completion voice and original story exit passed`);
    } finally {
        assetLoader.loadSound = previousSound;
        assert.deepEqual(engine.scopeManager.destroy(), [], 'Maze rescue cleanup'); assert.equal(stage.children.length, 0);
        backgrounds.forEach(texture => texture.destroy(true));
        if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    }
};
