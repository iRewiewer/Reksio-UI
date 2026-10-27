const assert = require('node:assert/strict');

module.exports = async function verifyMazeRoute(runtime, level, options = {}) {
    assert.ok(level === 1 || level === 2);
    const rescue = level === 1;
    const { assets, createMazePuzzleFixture, load, Keyboard, Mouse, Interpreter, RuntimeContext,
        Type, Animo, Sequence, constructors } = runtime;
    const recording = rescue ? require('./fixtures/magicienii-maze-rescue.json') : require('./fixtures/magicienii-maze-card.json');
    const previousWindow = globalThis.window;
    globalThis.window = new EventTarget();
    const { engine, parent, scope, defs, get, stage, backgrounds, reads } = await createMazePuzzleFixture(level, true);
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
        if (rescue) book.restoreCheckpointValue(Array(12).fill(1));
        else {
            assert.ok(options.spellbookFile instanceof ArrayBuffer, 'The card maze must receive the spellbook saved by a completed lesson');
            const saved = runtime.deserializeArray(options.spellbookFile);
            assert.equal(saved[5], 1); assert.ok(saved.slice(0, 12).some(value => value === 0), 'Do not replace the earned book with all spells unlocked');
            book.restoreCheckpointValue(saved);
        }
        scope.set(book.name, book);
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
                `Both heroes must survive maze ${level} frame ${elapsed}`);
            assert.deepEqual(routes, [], 'Normal maze inputs must not enter a failure/restart route');
        };
        const draw = async spell => {
            assert.equal(book.GET(spell), 1, 'The recorded route may only draw a learned spell');
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
        await sequence.PLAY(`ENTRE_LAB${level}`);
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
                assert.deepEqual([actor.GETCENTERX(), actor.GETCENTERY()], [x, y], `Maze ${level} waypoint ${++waypoints}`);
                assert.notEqual(actor.GETEVENTNAME(), 'PRISONER');
                if (!rescue && number === 1 && x === 580 && y === 500) {
                    assert.equal(get('ANNBTNMASK_29').GETCFRAMEINEVENT(), 1,
                        'The original pressure plate must open the card chamber while Rex holds it');
                }
                if (!rescue && number === 2 && x === 660 && y === 460) {
                    assert.equal(get('VARITEM').value, 1, 'Kretes must collect the card through its native hotspot');
                    assert.equal(get('G_ISUCCESS').value, 1);
                    assert.equal(get('ANNITEM').ISVISIBLE(), false);
                    assert.equal(get('ANNBTN_28').GETPRIORITY(), 0);
                }
            } else assert.fail(`Unknown maze input: ${command}`);
        }
        while (elapsed < recording.frames) await step();
        assert.deepEqual(get('ARRAYPLAYERS').value.map(name => [get(name).GETCENTERX(), get(name).GETCENTERY()]),
            rescue ? [[380, 100], [140, 100], [180, 100], [100, 100], [60, 100], [340, 100], [220, 100], [300, 100], [260, 100]]
                : [[60, 100], [100, 100]],
            'Every required character must reach the original exit through ordinary controls');
        assert.equal(get('G_ISUCCESS').value, 1, 'The original objective callback must award success');
        assert.equal(get('BTNEXIT').logic.enabled, true);
        assert.deepEqual([get('VARREXZYCIA').value, get('VARKRETZYCIA').value], recording.health);
        if (rescue) {
            assert.ok(audio.includes('wavs/krasnal_k289.wav'), 'The original completion dialogue must play');
            assert.ok(reads.includes('wavs/kretes_k289.wav'), 'The installed rescue voice must load through the compatibility fallback');
        } else {
            assert.equal(get('VARITEM').value, 1, 'The card must remain collected throughout the return route');
            assert.ok(audio.includes('wavs/kretes_d049.wav'), 'The original card-pickup dialogue must play');
            assert.equal(get('ANNITEM').ISVISIBLE(), false);
            assert.equal(get('ANNBTNMASK_29').GETCFRAMEINEVENT(), 0, 'Leaving the plate must close the chamber again');
            assert.ok(get('ANNBTN').clones.filter(plate => plate.GETCLONEINDEX() <= 26).every(plate => plate.GETPRIORITY() === 0),
                'Kretes must clear all 26 permanent gates through the original plate callbacks');
        }
        const button = get('BTNEXIT'), sprite = get(button.definition.GFXSTANDARD.objectName).getRenderObject();
        for (const event of ['pointerover', 'pointerdown', 'pointerup']) sprite.emit(event);
        await button.tick();
        assert.deepEqual(routes, ['ARCADE']); assert.equal(get('G_SARCADEOBJECTS').value, rescue ? 'CALINECZKA' : 'PIKLIBIA');
        assert.equal(screenshots.length, 1);
        if (!rescue) assert.deepEqual(book.value, runtime.deserializeArray(options.spellbookFile), 'The maze must not grant extra spells to complete its route');
        console.log(`MAZE ${level} ${rescue ? 'RESCUE' : 'CARD'}: ${waypoints} natural-input waypoints, ${drawn} drawn spells, ${rescue ? 'all seven prisoners' : 'all 26 gates and card collection/return'}, live guards, pressure hand-offs, original dialogue and story exit passed`);
        if (!rescue) console.log('MAZE CARD SPELLBOOK: the persisted darkness lesson, without unlocking the other ten spells, completes all 48 recorded casts');
    } finally {
        assetLoader.loadSound = previousSound;
        assert.deepEqual(engine.scopeManager.destroy(), [], 'Maze route cleanup'); assert.equal(stage.children.length, 0);
        backgrounds.forEach(texture => texture.destroy(true));
        if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    }
};
