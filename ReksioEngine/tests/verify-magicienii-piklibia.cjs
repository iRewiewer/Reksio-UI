const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

function getAdventureFactory(runtime) {
    const { assets, createArcadeFixture, Filesystem, normalizePath, Database, Struct, Animo,
        Type, constructors, serializeArray } = runtime;
    const bytes = filename => {
        const buffer = fs.readFileSync(path.join(assets, filename));
        return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    };
    const create = async (options = {}) => {
        const room = options.room ?? 'Piklibia', roomKey = room.toUpperCase();
        const fixture = await createArcadeFixture('ARCADE', 'Arcade', 'Arcade.cnv', `${room}.cnv`);
        const { engine, parent, scope, defs, get } = fixture;
        const memory = new Map(options.files?.map(([name, data]) => [name, data.slice(0)]));
        const saves = [], calls = [], missing = new Set(), stage = engine.app.stage;
        const resolve = name => normalizePath(name.startsWith('$') ? name.slice(1) : `dane/game/przygoda/arcade/${name}`);
        const common = fs.readdirSync(assets).find(name => name.toLowerCase() === 'common');
        for (const template of fs.readdirSync(path.join(assets, common)).filter(name => /_def\.dta$/i.test(name))) {
            const filename = `common/${template.toLowerCase().replace(/_def\.dta$/, '0.dta')}`;
            if (!memory.has(filename)) memory.set(filename, bytes(`${common}/${template}`));
        }
        for (const name of ['questions', 'questions_asked']) {
            const filename = `common/${name}0.arr`;
            if (!memory.has(filename)) memory.set(filename, serializeArray([]));
        }
        engine.resolvePath = parent.getRelativePath = async name => resolve(name);
        engine.filesystem = new Filesystem({
            hasFile: name => fs.existsSync(path.join(assets, name)), registerLogicalFilenames() {},
            getRawFile: async name => bytes(name),
        }, {
            get: async name => memory.get(name) ?? null,
            has: async name => memory.has(name),
            save: async (name, data) => {
                assert.match(name, /^common\//, 'Only in-memory fixture saves may be written');
                memory.set(name, data.slice(0)); saves.push(name);
            },
        }, engine.compat);
        engine.rendering.addToStage = sprite => { stage.addChild(sprite); engine.rendering.sortObjects(); };
        engine.rendering.removeFromStage = sprite => stage.removeChild(sprite);
        engine.rendering.sortObjects = () => stage.children.sort((a, b) => a.zIndex - b.zIndex);
        engine.diagnostics = new Proxy({ objectLookup: (_caller, name, found) => {
            if (!found) missing.add(name);
        } }, { get: (object, key) => object[key] ?? (() => {}) });
        // The definition loader is a browser boundary; keep real typed fields and database copies.
        const makeStruct = def => {
            const item = new Struct(engine, parent, def);
            for (const [name, type] of item.structure) {
                item.content.set(name, new constructors[type](engine, parent, { TYPE: type, NAME: name }));
            }
            item.clone = async () => makeStruct(def);
            return item;
        };
        const dispose = () => {
            assert.deepEqual(engine.scopeManager.destroy(), []);
            assert.equal(stage.children.length, 0);
        };
        try {
            for (const def of Object.values(defs).filter(def => def.TYPE === 'STRUCT')) scope.set(def.NAME, makeStruct(def));
            for (const def of Object.values(defs).filter(def => def.TYPE === 'DATABASE')) {
                const database = new Database(engine, parent, def);
                scope.set(database.name, database); database.init();
            }
            const actors = [];
            for (const def of Object.values(defs).filter(def => def.TYPE === 'ANIMO')) {
                const actor = new Animo(engine, parent, def);
                actor.loadSfx = async () => {}; scope.set(actor.name, actor); actors.push(actor); await actor.init();
            }
            for (const actor of actors) await actor.applyDefaults();
            for (const actor of actors) await actor.ready();
            for (const [name, type, value] of [
                ['G_SARCADEOBJECTS', 'STRING', roomKey], ['G_SLASTOBJECTS', 'STRING', options.previous ?? 'PIKMIOT'],
                ['G_ISUCCESS', 'INTEGER', options.success ?? 0], ['G_IGAMESLOT', 'INTEGER', 0],
            ]) scope.set(name, new constructors[type](engine, parent, { TYPE: type, NAME: name, VALUE: value }));
            const menu = new Type(engine, parent, { TYPE: 'CLASS_INSTANCE', NAME: 'G_MENU' });
            menu.ADDEXP = value => calls.push(['ADDEXP', value]); scope.set(menu.name, menu);
            const card = new Type(engine, parent, { TYPE: 'CLASS_INSTANCE', NAME: 'G_CARD' });
            card.LOAD = () => calls.push(['CARD_LOAD']); scope.set(card.name, card);
            await get('VARSCURRARCADE').SET(`$COMMON\\${roomKey}0.DTA`);
            await get('VARSCURRITEMS').SET('$COMMON\\ITEMS0.DTA');
            await get('DBOBJECTS').LOAD(`$COMMON\\${roomKey}0.DTA`);
            await get('DBITEMS').LOAD('$COMMON\\ITEMS0.DTA');
            // Optional seed data represents persisted state on entry, never post-initialization success.
            await options.seed?.({ ...fixture, memory }); saves.length = 0; calls.length = 0;
            if (options.initialize !== false) {
                await get('VARINO').SET(0);
                for (let index = 0; index < get('DBOBJECTS').GETROWSNO(); index++) {
                    await get('BEHSELECTOBJ').RUN(index);
                    if (await get('SOBJECT').GETFIELD('TYPE').getValue() < 100) await get('BFITMP1051').RUN();
                }
                await get('BEHINITSCRIPT').RUN();
            }
            return { ...fixture, memory, saves, calls, missing, dispose };
        } catch (error) { dispose(); throw error; }
    };
    return create;
}

module.exports = async function verifyPiklibia(runtime) {
    const { serializeArray, deserializeArray } = runtime;
    const create = getAdventureFactory(runtime);
    const roomField = async (fixture, index, field) => {
        await fixture.get('BEHSELECTOBJ').RUN(index);
        return fixture.get('SOBJECT').GETFIELD(field).getValue();
    };
    const setSwitch = async ({ get }, index, state) => {
        await get('BEHSELECTOBJ').RUN(index);
        await get('SOBJECT').GETFIELD('IPARAM0').SET(state);
        await get('BEHUPDATEOBJECTS').RUN();
    };

    const board = await create();
    try {
        const { get, missing } = board;
        assert.deepEqual([...missing], [], 'Every original board script lookup must resolve');
        const frames = get('ANNPOLA').annFile.events[0].frames;
        assert.equal(frames.length, 230);
        assert.equal(get('ARRFIELDS').clones.length, frames.length);
        for (let index = 0; index < frames.length; index++) {
            const expected = frames[index].name.split('-').map(Number).filter(node => node !== index);
            assert.deepEqual(get('ARRFIELDS').clones[index].value, expected, `Board node ${index} must retain every authored edge`);
            const image = get('ANNPOLA').annFile.annImages[get('ANNPOLA').annFile.events[0].framesImageMapping[index]];
            await get('BEHPLACEATFIELD').RUN(0, index);
            assert.deepEqual([get('ARRKNIGHTX').GET(0), get('ARRKNIGHTY').GET(0)],
                [image.positionX + frames[index].positionX, image.positionY + frames[index].positionY],
                `Board node ${index} must use its actual image coordinates, not zero event offsets`);
        }
        // Component inputs deliberately exercise both ends of the original graph, including node zero.
        for (const [node, next] of [[0, 1], [229, 228]]) {
            await get('BEHPLACEATFIELD').RUN(0, node);
            await get('BEHNEXTMOVE').RUN(0);
            assert.equal(get('ARRKNIGHTFRAME').GET(0), next);
            assert.equal(get('ARRRECENTFIELD').GET(0), node);
            assert.equal(get('ANNKNIGHT0').GETEVENTNAME(), 'SKOK');
            for (let tick = 0; tick < 30 && get('ARRKNIGHTFRAME').GET(0) === next; tick++) {
                await get('ANNKNIGHT0').tick(1000 / 16);
            }
            assert.equal(get('ARRRECENTFIELD').GET(0), next, 'Real jump completion must choose the next edge');
            assert.equal(get('ARRKNIGHTFRAME').GET(0), node === 0 ? 2 : 227);
        }
        for (let index = 0; index < 24; index++) {
            const cross = get(`ANNOBJECT${index}`);
            await cross.SETFRAME('PLAY', 0);
            const node = Number(cross.GETFRAMENAME()), field = get('ARRFIELDS').clones[node], original = [...field.value];
            assert.equal(original.length, 3, `Switch ${index} must control a three-way node`);
            for (let turn = 1; turn <= 3; turn++) {
                await get('BEHTOGGLECROSS').RUN(cross.name);
                assert.equal(cross.GETEVENTNAME(), `STATE${turn % 3}`);
                assert.deepEqual(field.value, original.slice(turn % 3).concat(original.slice(0, turn % 3)));
            }
        }
        assert.deepEqual([...missing], []);
        assert.deepEqual(board.calls, [], 'Unrelated room entry must not grant the labyrinth reward');
    } finally { board.dispose(); }

    const reward = await create({ previous: 'LABIRYNT', success: 1, seed: fixture => setSwitch(fixture, 0, 2) });
    let saved, savedNodes;
    try {
        const { get, memory, saves, calls, missing } = reward;
        assert.deepEqual(calls, [['ADDEXP', 30], ['CARD_LOAD']]);
        assert.equal(await roomField(reward, 26, 'TYPE'), 0, 'The native reward must persist the completed entrance');
        assert.equal(await roomField(reward, 0, 'IPARAM0'), 2, 'Awarding a detached card must not reset switch zero');
        assert.equal(get('ANNOBJECT0').GETEVENTNAME(), 'STATE2');
        assert.equal(await get('BEHFINDITEM').RUN('KARTA_BUT'), 0);
        assert.equal(await get('DBITEMS_CURSOR').GETFIELD('PARENT').getValue(), -1);
        assert.equal(await get('DBITEMS_CURSOR').GETFIELD('BASE').getValue(), 'PIKLIBIA');
        assert.deepEqual(deserializeArray(memory.get('common/questions0.arr')), ['50', '55', '60', '65', '71', '75', '80', '29']);
        assert.equal(saves.filter(name => name === 'common/items0.dta').length, 1);
        assert.equal(saves.filter(name => name === 'common/piklibia0.dta').length, 1);
        assert.deepEqual([...missing], []);
        // Save all switch and knight positions through the original room-exit helper.
        await get('BEHTOGGLECROSS').RUN('ANNOBJECT1'); await get('BEHSAVEMAP').RUN();
        savedNodes = [...get('ARRKNIGHTFRAME').value];
        saved = [...memory];
    } finally { reward.dispose(); }

    const restored = await create({ files: saved, previous: 'LABIRYNT', success: 1 });
    try {
        assert.deepEqual(restored.calls, [], 'Persisted successful re-entry must not award XP or refresh the book again');
        assert.deepEqual(restored.saves, [], 'Persisted re-entry must not rewrite the inventory, room or questions');
        assert.equal(restored.get('ANNOBJECT0').GETEVENTNAME(), 'STATE2');
        assert.equal(restored.get('ANNOBJECT1').GETEVENTNAME(), 'STATE1');
        assert.deepEqual(restored.get('ARRSTART').value, savedNodes, 'All eight knights must restart from their saved nodes');
        assert.equal(await restored.get('BEHFINDITEM').RUN('KARTA_BUT'), 0);
        assert.deepEqual([...restored.missing], []);
    } finally { restored.dispose(); }

    for (const options of [{ previous: 'LABIRYNT', success: 0 }, { previous: 'DOMSPIEL', success: 1 }]) {
        const fixture = await create(options);
        try {
            assert.deepEqual(fixture.calls, [], 'A failure or a different minigame must not grant the card reward');
            assert.equal(await fixture.get('BEHFINDITEM').RUN('KARTA_BUT'), -1);
            assert.equal(await roomField(fixture, 26, 'TYPE'), 1);
        } finally { fixture.dispose(); }
    }
    const existing = await create({ previous: 'LABIRYNT', success: 1, seed: async ({ get, memory }) => {
        await get('BEHADDITEM').RUN('KARTA_BUT', -1);
        memory.set('common/questions0.arr', serializeArray(['55', '99']));
        memory.set('common/questions_asked0.arr', serializeArray(['50']));
    } });
    try {
        assert.deepEqual(existing.calls, [['ADDEXP', 30], ['CARD_LOAD']]);
        assert.equal(existing.saves.includes('common/items0.dta'), false, 'An existing card must not be duplicated');
        assert.deepEqual(deserializeArray(existing.memory.get('common/questions0.arr')),
            ['55', '99', '60', '65', '71', '75', '80', '29'], 'Preserve existing questions and exclude already asked ones');
    } finally { existing.dispose(); }
    console.log('PIKLIBIA: all 230 graph nodes, both endpoint moves, 24 three-way switches, card/XP reward, persisted re-entry and duplicate/asked-question guards passed');
};

module.exports.createFixture = (runtime, options) => getAdventureFactory(runtime)(options);
