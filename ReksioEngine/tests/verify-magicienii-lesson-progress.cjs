const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { Point } = require('pixi.js');

async function createLesson(runtime, fighterId, options = {}) {
    const { assets, createFixture, load, Filesystem, normalizePath, Struct, Database, Type, Animo, Button,
        CanvasObserver, constructors, serializeArray, deserializeArray } = runtime;
    const fixture = await createFixture(), { engine, parent, scope, defs, get, value, wand } = fixture;
    const memory = new Map(options.files?.map(([name, data]) => [name, data.slice(0)]));
    const initial = memory.has('common/spells0.arr') ? deserializeArray(memory.get('common/spells0.arr')) :
        [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 64, fighterId === 13 ? 0 : 150, 0, fighterId === 13 ? 0 : 1, fighterId === 13 ? 0 : 1];
    // Pudding is granted by the original mannequin entry; later lessons require 150 XP.
    if (!memory.has('common/spells0.arr')) memory.set('common/spells0.arr', serializeArray(initial));
    const writes = [], routes = [];
    const relative = name => normalizePath(name.startsWith('$') ? name.slice(1) : `dane/game/przygoda/magic/${name}`);
    engine.currentScene = parent; parent.getRelativePath = async name => relative(name);
    engine.resolvePath = async (name, base = '') => normalizePath(name.startsWith('$') ? name.slice(1) : `${base}/${name}`);
    engine.getObject = (name, local = null) => {
        if (typeof name !== 'string') return name ? engine.getObject(name.objectName, local) : null;
        return local?.get(name) ?? engine.scopeManager.findByName(name, local) ??
            (name.endsWith('_0') ? engine.getObject(name.slice(0, -2), local) : null);
    };
    engine.filesystem = new Filesystem({
        hasFile: name => fs.existsSync(path.join(assets, name)), registerLogicalFilenames() {},
        getRawFile: async name => {
            const b = fs.readFileSync(path.join(assets, name)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
        },
    }, { get: async name => memory.get(name) ?? null, has: async name => memory.has(name),
        save: async (name, data) => { memory.set(name, data.slice(0)); writes.push(name); } }, engine.compat);
    const makeFighter = () => {
        const model = new Struct(engine, parent, defs.SFIGHTER);
        for (const [name, type] of model.structure) model.content.set(name, new constructors[type](engine, parent, { NAME: name, TYPE: type }));
        model.clone = async () => makeFighter(); return model;
    };
    scope.set('SFIGHTER', makeFighter());
    const fighters = new Database(engine, parent, defs.DBFIGHTERS); scope.set(fighters.name, fighters); fighters.init();
    await fighters.LOAD('$COMMON\\FIGHTERS.DTA'); fighters.SELECT(fighterId); await get('SFIGHTER').SET('DBFIGHTERS_CURSOR');
    const place = await get('SFIGHTER').GETFIELD('PLACE').getValue();
    for (const [name, type, content] of [['S_IMAGICFIGHTER', 'INTEGER', fighterId], ['S_SMAGICPLACE', 'STRING', place],
        ['G_SARCADEOBJECTS', 'STRING', place], ['G_SLASTOBJECTS', 'STRING', 'MAGIC']]) {
        scope.set(name, new constructors[type](engine, parent, { NAME: name, TYPE: type, VALUE: content }));
    }
    const book = new constructors.ARRAY(engine, parent, { TYPE: 'ARRAY', NAME: 'G_ARRREXSPELLS' });
    scope.set(book.name, book); await book.LOAD('$COMMON\\SPELLS0.ARR'); await get('VARSRETURNTO').SET(place);
    await get('ARRENERGIZETIME').CHANGEAT(0, book.GET(12));
    await get('ARRENERGIZETIME').CHANGEAT(1, await get('SFIGHTER').GETFIELD('TIME').getValue());
    const { Rand } = load('engine/types/rand.ts'); scope.set('RANDOM', new Rand(engine, parent, { TYPE: 'RAND', NAME: 'RANDOM' }));

    class Ui extends Type { PLAY(event) { this.event = event; } SHOW() {} HIDE() {} SETFRAME() {} STOP() {} SETMUSICVOLUME() {} }
    const menuState = await require('./magicienii-menu-fixture.cjs')(runtime, fixture);
    scope.set('MAGIC', new Ui(engine, parent, { TYPE: 'SCENE', NAME: 'MAGIC' }));
    const settings = new constructors.ARRAY(engine, parent, { TYPE: 'ARRAY', NAME: 'G_ARRSETTINGS' });
    settings.ADD(1, 500); scope.set(settings.name, settings);

    const stage = engine.app.stage;
    engine.rendering.addToStage = sprite => stage.addChild(sprite); engine.rendering.removeFromStage = sprite => stage.removeChild(sprite);
    engine.rendering.sortObjects = () => stage.children.sort((a, b) => a.zIndex - b.zIndex);
    const exit = new Animo(engine, parent, defs.ANNEXIT); exit.loadSfx = async () => {}; scope.set(exit.name, exit);
    await exit.init(); await exit.applyDefaults(); await exit.ready();
    const canvas = new CanvasObserver(engine, parent, defs.CANVASOBSERVER), graphicsAt = canvas.GETGRAPHICSAT.bind(canvas);
    // Target-body hits and narration duration are boundaries; the Return sprite and button stay real.
    canvas.GETGRAPHICSAT = (...args) => args[3] === 10 ? 'ANNBODY1' : graphicsAt(...args); scope.set(canvas.name, canvas);
    const button = new Button(engine, parent, defs.BTNEXIT); scope.set(button.name, button);
    button.init(); await button.applyDefaults(); await button.ready();
    const mouse = get('MOUSE'); await mouse.ready();
    const { IgnorableError } = load('common/errors.ts');
    class Transition extends IgnorableError { constructor(scene) { super(); this.scene = scene; } }
    const episode = new Type(engine, parent, { TYPE: 'EPISODE', NAME: 'PRZYGODA' });
    episode.GOTO = scene => { throw new Transition(scene); }; scope.set(episode.name, episode);
    const screenshot = new Type(engine, parent, { TYPE: 'BEHAVIOUR', NAME: '__SCREENSHOT__' });
    screenshot.RUN = () => {}; scope.set(screenshot.name, screenshot);
    const pointer = (x, y) => ({ button: 0, screen: { x, y } });
    const tick = async () => {
        const visited = [];
        try { for (const object of scope.objects) { visited.push(object.name); await object.tick(16); } }
        catch (error) { if (!(error instanceof Transition)) throw error; routes.push(error.scene); }
        return visited;
    };
    const exitPoint = () => {
        const sprite = exit.getRenderObject(), box = sprite.getBounds(); sprite.toGlobal(new Point(0, 0));
        for (let y = Math.ceil(box.y); y < Math.min(600, box.y + box.height); y++) {
            for (let x = Math.ceil(box.x); x < Math.min(800, box.x + box.width); x++) {
                if (sprite.containsPoint(new Point(x, y), true) && graphicsAt(x, y, true, 110, 110, true) === 'ANNEXIT') return [x, y];
            }
        }
        assert.fail('Return must expose an opaque pointer-hit pixel');
    };
    const clickExit = async () => {
        assert.ok(scope.objects.indexOf(button) < scope.objects.indexOf(mouse), 'The shipped BUTTON precedes MOUSE in the real tick order');
        const [x, y] = exitPoint(), event = pointer(x, y), sprite = exit.getRenderObject();
        mouse.onMouseMove(pointer(400, 300)); await mouse.tick(16); mouse.onMouseMove(event); await mouse.tick(16);
        assert.deepEqual([value('VARICURSORX'), value('VARICURSORY')], [x, y]);
        mouse.lastClicksTime = {}; sprite.emit('pointerover', event); sprite.emit('pointerdown', event); stage.emit('pointerdown', event);
        const visited = await tick();
        if (!routes.length) { sprite.emit('pointerup', event); stage.emit('pointerup', event); await tick(); }
        return visited;
    };
    const spell = fighterId === 13 ? 3 : 5;
    await get('BEHSETACTIVESPELL').RUN(spell);
    const intro = fighterId === 13 ? 'SNDTUT0' : 'SNDTUTDARKENTER'; await get(intro).PLAY();
    const dispose = () => {
        assert.deepEqual(engine.scopeManager.destroy(), []); assert.equal(stage.children.length, 0);
        menuState.dispose();
    };
    return { ...fixture, spell, place, book, initial, memory, writes, routes, mouse, pointer, intro, clickExit, dispose,
        saved: () => deserializeArray(memory.get('common/spells0.arr')),
        finishPanel: menuState.finishPanel };
}

async function drawAndCast(lesson, spell, beforeCast) {
    const { value, mouse, pointer, wand } = lesson;
    let x = 400, y = 300; mouse.onMouseMove(pointer(x, y)); await mouse.tick(16);
    mouse.lastClicksTime = {}; mouse.handleClickEvent(pointer(x, y), 'click'); await mouse.tick(16);
    for (const angle of value(`ARRPATTERN${spell}`)) {
        x += Math.round(60 * Math.cos(angle * Math.PI / 180)); y += Math.round(60 * Math.sin(angle * Math.PI / 180));
        mouse.onMouseMove(pointer(x, y)); await mouse.tick(16);
    }
    mouse.handleClickEvent(pointer(x, y), 'release'); await mouse.tick(16);
    assert.equal(value('ARRSPELLTYPE')[0], spell);
    for (let tick = 0; tick < 200 && value('VARISPELLREADY') !== 2; tick++) await wand.tick(70);
    assert.equal(value('VARISPELLREADY'), 2);
    await beforeCast?.();
    mouse.lastClicksTime = {}; mouse.handleClickEvent(pointer(x, y), 'click'); await mouse.tick(16);
    for (let tick = 0; tick < 30 && wand.GETEVENTNAME() === 'STRZAL'; tick++) await wand.tick(70);
    assert.equal(wand.GETEVENTNAME(), 'IDLE');
}

module.exports = async function verifyLessonProgress(runtime, entry = {}) {
    if (entry.files) { assert.equal(entry.destination, 'MAGIC'); assert.equal(entry.fighter, 13); }
    const first = await createLesson(runtime, 13, entry);
    let firstLesson;
    try {
        const finishVoice = async name => {
            assert.equal(first.get(name).ISPLAYING(), true, `${name} must be started by the native tutorial`);
            first.get(name).STOP(); await first.get(name).callbacks.run('ONFINISHED');
        };
        await finishVoice(first.intro); await finishVoice('SNDTUT1');
        assert.equal(first.value('VARITUTORIAL'), 2);
        await first.clickExit(); assert.deepEqual(first.routes, [], 'The first lesson cannot be skipped before learning');
        assert.deepEqual(first.saved(), first.initial); assert.deepEqual(first.writes, []);
        first.mouse.onMouseMove(first.pointer(400, 300)); await first.mouse.tick(16);
        first.mouse.lastClicksTime = {}; first.mouse.handleClickEvent(first.pointer(400, 300), 'click'); await first.mouse.tick(16);
        for (let move = 0; move < 100; move++) {
            first.mouse.onMouseMove(first.pointer(move % 2 ? 200 : 600, move % 2 ? 200 : 400));
            await first.mouse.tick(16);
        }
        assert.equal(first.value('VARITUTCOUNT'), 100, 'Native mouse movement must complete the wand exercise');
        first.mouse.handleClickEvent(first.pointer(200, 200), 'release'); await first.mouse.tick(16);
        for (let voice = 2; voice <= 6; voice++) await finishVoice(`SNDTUT${voice}`);
        assert.equal(first.value('VARITUTORIAL'), 3);
        for (let cast = 1; cast <= 3; cast++) {
            if (cast > 1 && first.get('SNDTUT8').ISPLAYING()) await finishVoice('SNDTUT8');
            assert.equal(first.value('VARITUTORIAL'), cast === 1 ? 3 : 4);
            await drawAndCast(first, 3, cast === 1 ? () => finishVoice('SNDTUT7') : null);
            assert.equal(first.value('ARREFFECTLEVEL1')[3], cast);
        }
        assert.equal(first.value('VARIWINNER'), 1);
        for (let tick = 0; tick < 5; tick++) await first.get('STL10').callbacks.run('ONFRAMECHANGED', 'ELAPSE');
        await finishVoice('SNDTUT9'); await finishVoice('SNDTUT10'); await finishVoice('SNDTUT11');
        assert.equal(first.value('VARITUTORIAL'), 5); assert.equal(first.value('VARBLEARNED'), true);
        await first.clickExit(); assert.deepEqual(first.routes, ['ARCADE']);
        assert.equal(first.get('G_SLASTOBJECTS').value, 'MAGIC_GULDRYK13');
        assert.equal(first.get('G_SARCADEOBJECTS').value, 'GULDRYK');
        assert.deepEqual(first.saved(), first.initial, 'The first tutorial must not spend XP or unlock another spell');
        assert.deepEqual(first.writes, ['common/spells0.arr']);
        firstLesson = { files: [...first.memory], previous: 'MAGIC_GULDRYK13', destination: 'ARCADE', arcade: 'GULDRYK' };
        console.log('FIRST LESSON: 100 native wand movements, original narration, three drawn/charged pudding casts, completion and saved classroom return passed without completion-state writes');
    } finally { first.dispose(); }
    const incomplete = await createLesson(runtime, 22);
    try {
        await incomplete.clickExit(); assert.deepEqual(incomplete.routes, [], 'Narration must block Return just as it blocks the mouse exit');
        await incomplete.get(incomplete.intro).callbacks.run('ONFINISHED');
        await incomplete.clickExit(); assert.deepEqual(incomplete.routes, ['ARCADE']);
        assert.equal(incomplete.value('VARBLEARNED'), false); assert.deepEqual(incomplete.saved(), incomplete.initial);
        assert.deepEqual(incomplete.writes, [], 'Leaving an unfinished later lesson must neither grant a spell nor spend XP');
    } finally { incomplete.dispose(); }

    const lesson = await createLesson(runtime, 22), { get, value } = lesson;
    try {
        await get(lesson.intro).callbacks.run('ONFINISHED'); assert.equal(value('VARITUTORIAL'), 6);
        assert.equal(lesson.saved()[5], 0);
        for (let cast = 1; cast <= 3; cast++) {
            await drawAndCast(lesson, 5);
            assert.equal(value('ARREFFECTLEVEL1')[5], cast);
        }
        assert.equal(value('VARIWINNER'), 1);
        await lesson.clickExit(); assert.deepEqual(lesson.routes, [], 'The result sequence must not be bypassed by the button');
        for (let tick = 0; tick < 5; tick++) await get('STL10').callbacks.run('ONFRAMECHANGED', 'ELAPSE');
        assert.equal(value('VARBLEARNED'), true);
        assert.deepEqual(lesson.saved().slice(12, 15), [61, 0, 1], 'Level/XP must already be durable before the hourglass animation finishes');
        assert.deepEqual([...new Set(lesson.writes)], ['common/spells0.arr']);
        await get('SNDLEARNEDDEF').callbacks.run('ONFINISHED'); await get('SNDTRYAGAIN').callbacks.run('ONFINISHED');
        await lesson.finishPanel();
        const visited = await lesson.clickExit(); assert.deepEqual(lesson.routes, ['ARCADE']);
        assert.equal(visited.includes('MOUSE'), false, 'The native scene interrupt must cancel the later mouse handler');
        const expected = [...lesson.initial]; expected[5] = 1; expected[12] = 61; expected[13] = 0; expected[14] = 1; expected[16] = 0;
        assert.deepEqual(lesson.saved(), expected, 'The visible Return button must save the earned spell and preserve unrelated flags');
        assert.equal(get('G_SLASTOBJECTS').value, 'MAGIC_WMWNETRZE22'); assert.equal(get('G_SARCADEOBJECTS').value, 'WMWNETRZE');
        const reloaded = new runtime.constructors.ARRAY(lesson.engine, lesson.parent, { TYPE: 'ARRAY', NAME: '__RELOADED_BOOK__' });
        await reloaded.LOAD('$COMMON\\SPELLS0.ARR'); assert.deepEqual(reloaded.value, expected);
        console.log('LESSON SAVE: three drawn darkness casts, native XP/level-up, narration/winner/unfinished guards, button-first scene interruption and reloaded earned spellbook passed');
        return { files: [...lesson.memory], book: reloaded.value.slice(0), firstLesson };
    } finally { lesson.dispose(); }
};
