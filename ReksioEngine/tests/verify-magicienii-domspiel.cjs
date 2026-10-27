const assert = require('node:assert/strict');
const createRoom = require('./magicienii-adventure-fixture.cjs');

module.exports = async function verifyDomspiel(runtime, checkpoint) {
    assert.equal(checkpoint.destination, 'DOMSPIEL');
    let files = checkpoint.files;
    const consumed = new Set();
    const waitFor = async (room, predicate, message, limit = 1200) => {
        for (let tick = 0; tick < limit && !predicate(); tick++) await room.step(1);
        assert.ok(predicate(), message);
    };
    const settle = async room => {
        await waitFor(room, () => room.get('VARIFIRSTENTER').value === 0 && !room.get('VARBSEQPLAYING').value,
            'Arrival and dialogue must release scene input');
        await room.step(60);
    };
    const field = async (room, index, name) => {
        await room.get('BEHSELECTOBJ').RUN(index);
        return room.get('SOBJECT').GETFIELD(name).getValue();
    };
    const exit = async (room, object, destination) => {
        await room.clickActor(object);
        await waitFor(room, () => room.routes.length > 0, `Walking to ${destination} must finish its original exit callback`);
        assert.deepEqual(room.routes, ['ARCADE']);
        assert.equal(room.get('G_SARCADEOBJECTS').value, destination);
        files = [...room.memory];
    };
    const select = async (room, index, expected) => {
        await room.clickActor('ANNREX', 30);
        assert.equal(room.get('VARIMENUVISIBLE').value, 1);
        await room.clickActor(`ANNITEM${index}`, 30);
        assert.equal(room.get('VARSCURRENTITEM').value, expected);
        return room.get('VARSCURRENTITEMOBJECT').value;
    };
    const use = async (room, index, item, target, remaining) => {
        const held = await select(room, index, item);
        await room.clickActor(target);
        await waitFor(room, () => room.get('VARINUMITEMS').value === remaining, `Using ${item} must consume the real inventory entry`);
        await room.step(120);
        assert.equal(room.get('VARSCURRENTITEM').value, 'NULL');
        assert.equal(room.get('VARSCURRENTITEMOBJECT').value, 'NULL');
        assert.equal(room.scope.objects.some(object => object.name === held), false, 'The held-item clone must be removed');
        assert.equal(await room.get('BEHFINDITEM').RUN(item), -1);
    };

    const first = await createRoom(runtime, { room: 'Domspiel', previous: checkpoint.previous, files });
    try {
        await settle(first);
        assert.equal(first.get('VARINUMITEMS').value, 8, 'All eight earned knight scraps must survive the room transition');
        assert.ok(first.audio.includes('wavs/spielmauster_p059.wav'));
        await first.clickActor('ANNOBJECT4');
        await waitFor(first, () => first.get('VARINUMITEMS').value === 9, 'The pot pickup must complete after walking');
        await first.step(120);
        assert.equal(await first.get('BEHFINDITEM').RUN('GARNEK_BUT'), 8);
        assert.equal(first.get('ANNOBJECT4').ISVISIBLE(), false);
        await exit(first, 'ANNOBJECT13', 'PIKLIBIA');
    } finally { first.dispose(); }

    const outdoors = await createRoom(runtime, { room: 'Piklibia', previous: 'DOMSPIEL', files });
    try {
        await settle(outdoors);
        for (let scroll = 0; scroll < 8 && !outdoors.findPixel('ANNOBJECT24'); scroll++) {
            const bounds = outdoors.get('ANNOBJECT24').getRenderObject().getBounds();
            await outdoors.click(500, bounds.y < 0 ? 40 : 550, 180);
        }
        // The authored walk winds around the board: never interrupt it with the next click.
        await outdoors.clickActor('ANNOBJECT24');
        await waitFor(outdoors, () => outdoors.get('VARINUMITEMS').value === 10, 'The rope must fill the tenth inventory slot');
        await outdoors.step(120);
        assert.equal(await outdoors.get('BEHFINDITEM').RUN('LINA_BUT'), 9);
        assert.equal(outdoors.get('ANNOBJECT24').ISVISIBLE(), false);
        assert.equal(outdoors.get('ANNOBJECT25').GETEVENTNAME(), 'STATE0', 'Picking up the rope must update the original scenery');
        for (let scroll = 0; scroll < 12 && !outdoors.findPixel('ANNOBJECT27'); scroll++) await outdoors.click(600, 40, 180);
        await exit(outdoors, 'ANNOBJECT27', 'DOMSPIEL');
    } finally { outdoors.dispose(); }

    const prepared = await createRoom(runtime, { room: 'Domspiel', previous: 'PIKLIBIA', files });
    try {
        await settle(prepared);
        assert.equal(prepared.get('VARINUMITEMS').value, 10);
        assert.equal(prepared.get('ANNOBJECT4').ISVISIBLE(), false, 'A saved pot pickup must not respawn');
        await use(prepared, 9, 'LINA_BUT', 'ANNOBJECT1', 9);
        assert.equal(await field(prepared, 5, 'IPARAM0'), 1);
        await use(prepared, 8, 'GARNEK_BUT', 'ANNOBJECT5', 8);
        assert.equal(await field(prepared, 5, 'IPARAM0'), 2);
        assert.deepEqual(prepared.calls, [['ADDEXP', 10], ['ADDEXP', 10]]);
        assert.ok(prepared.saves.includes('common/przepasc0.dta'), 'Hanging the pot must persist its destination-room state');
        await exit(prepared, 'ANNOBJECT2', 'PRZEPASC');
        console.log('DOMSPIEL: earned scrap checkpoint, pot/rope pickup, full inventory, native item selection/use, both XP awards and PRZEPASC exit passed');
    } finally { prepared.dispose(); }

    const cliff = await createRoom(runtime, { room: 'Przepasc', previous: 'DOMSPIEL', files });
    try {
        await settle(cliff);
        assert.equal(cliff.get('ANNOBJECT1').ISVISIBLE(), true, 'The pot hung in the previous room must appear');
        assert.equal(await field(cliff, 1, 'IPARAM0'), 1);
        assert.equal(cliff.get('ANNOBJECT1').GETEVENTNAME(), 'STATE0');
        for (let scrap = 0; scrap < 4; scrap++) {
            const inventory = cliff.get('DBITEMS');
            inventory.SELECT(await inventory.FIND('EMPTY', 1, 0));
            const item = await cliff.get('DBITEMS_CURSOR').GETFIELD('NAME').getValue();
            assert.match(item, /^ZLOM[0-7]_BUT$/);
            assert.equal(consumed.has(item), false);
            await use(cliff, 0, item, 'ANNOBJECT1', 7 - scrap); consumed.add(item);
            assert.equal(await field(cliff, 1, 'IPARAM1'), scrap + 1);
            assert.equal(cliff.get('ANNOBJECT1').GETEVENTNAME(), `STATE${scrap}`);
        }
        assert.deepEqual(cliff.calls, [['ADDEXP', 30]], 'Completing the trap must award XP exactly once');
        // Inspect the real cross-room save, without seeding the prisoner's rescued state.
        const database = cliff.get('DBTEMPOBJ');
        database.REMOVEALL(); await database.LOAD('$COMMON\\DOMSPIEL0.DTA');
        await database.SELECT(await database.FIND('IDNAME', 'SPIELMAUSTER', 0));
        assert.equal(await cliff.get('DBTEMPOBJ_CURSOR').GETFIELD('TYPE').getValue(), 1);
        await exit(cliff, 'ANNOBJECT0', 'DOMSPIEL');
        console.log('PRZEPASC: four earned scraps consumed through the native inventory/pot interactions, trap progression, persisted rescue and single XP award passed');
    } finally { cliff.dispose(); }

    const rescued = await createRoom(runtime, { room: 'Domspiel', previous: 'PRZEPASC', files });
    try {
        await settle(rescued);
        assert.equal(rescued.get('VARINUMITEMS').value, 4);
        assert.equal(await field(rescued, 11, 'TYPE'), 1);
        assert.equal(await field(rescued, 11, 'IPARAM2'), 1, 'Returning from the trap must run and save the freed-prisoner callback');
        assert.deepEqual(rescued.calls, [], 'Reloading the solved trap must not duplicate XP');
        for (let scrap = 0; scrap < 8; scrap++) {
            const item = `ZLOM${scrap}_BUT`, row = await rescued.get('BEHFINDITEM').RUN(item);
            assert.equal(row >= 0, !consumed.has(item));
        }
        files = [...rescued.memory];
        console.log('DOMSPIEL RELOAD: rescued-prisoner state, four remaining scraps and consumed rope/pot persist without duplicate rewards');
    } finally { rescued.dispose(); }
    return { files, previous: 'PRZEPASC', destination: 'DOMSPIEL' };
};
