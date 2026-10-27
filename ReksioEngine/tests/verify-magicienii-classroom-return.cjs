const assert = require('node:assert/strict');
const createRoom = require('./magicienii-adventure-fixture.cjs');

module.exports = async function verifyClassroomReturn(runtime, checkpoint) {
    assert.equal(checkpoint.destination, 'ARCADE'); assert.equal(checkpoint.arcade, 'GULDRYK');
    assert.equal(checkpoint.previous, 'MAGIC_GULDRYK13');
    let files = checkpoint.files;
    const savedBook = room => runtime.deserializeArray(room.memory.get('common/spells0.arr'));
    const waitFor = async (room, predicate, message, limit = 1800) => {
        for (let tick = 0; tick < limit && !predicate(); tick++) await room.step(1);
        assert.ok(predicate(), message);
    };
    const settle = async room => {
        await waitFor(room, () => room.get('VARIFIRSTENTER').value === 0 && !room.get('VARBSEQPLAYING').value,
            'The original classroom arrival and tutorial-return dialogue must finish');
        await room.step(60);
    };
    const field = async (room, name, key) => {
        await room.get('BEHSELECTOBJS').RUN(name); return await room.get('SOBJECT').GETFIELD(key).getValue();
    };
    const focus = async (room, actor) => {
        const [x, y] = room.findPixel(actor) ?? assert.fail(`${actor} must be visible`);
        room.get('MOUSE').onMouseMove({ button: 0, screen: { x, y } }); await room.step(180);
        assert.equal(room.get('VARBSEQPLAYING').value, false);
    };
    const exit = async (room, actor, destination, arcade) => {
        await room.clickActor(actor);
        await waitFor(room, () => room.routes.length > 0, `The original ${destination} exit must finish`);
        assert.deepEqual(room.routes, [destination]);
        if (arcade) assert.equal(room.get('G_SARCADEOBJECTS').value, arcade);
        files = [...room.memory];
    };
    const assertLearnedRoom = async room => {
        assert.equal(await field(room, 'MANEKIN', 'IPARAM0'), 2);
        assert.equal(await field(room, 'KULA_BUDYN', 'IPARAM0'), 2);
        for (const name of ['KULA_BUDYN_OBR', 'KULA_SEN', 'KULA_SEN_OBR']) assert.equal(await field(room, name, 'IPARAM0'), 1);
        for (const number of [5, 6, 7, 8]) assert.equal(room.get(`ANNOBJECT${number}`).ISVISIBLE(), true);
        assert.equal(room.get('ANNOBJECT5').GETEVENTNAME(), 'NIEAKTYW');
        assert.deepEqual(savedBook(room), [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 64, 0, 0, 1, 0]);
    };
    const returned = await createRoom(runtime, { room: 'Guldryk', previous: checkpoint.previous, files });
    try {
        await settle(returned); await assertLearnedRoom(returned);
        assert.deepEqual(returned.calls, [], 'The tutorial return must not award story XP');
        assert.ok(returned.saves.includes('common/spells0.arr'), 'The native SHOWEXP behaviour must save its display flag');
        const tutorial = await returned.engine.filesystem.getARRFile('dane/game/przygoda/arcade/guldryk/potutorialu.arr');
        assert.ok(returned.audio.includes(`wavs/${tutorial[1].toLowerCase()}.wav`));
        const noXp = await returned.engine.filesystem.getARRFile('dane/game/przygoda/arcade/guldryk/wst_noexp.arr');
        const voice = `wavs/${noXp[1].toLowerCase()}.wav`;
        for (const orb of ['ANNOBJECT7', 'ANNOBJECT6', 'ANNOBJECT8']) {
            await focus(returned, orb);
            const before = returned.audio.filter(file => file === voice).length;
            await returned.clickActor(orb, 600);
            assert.deepEqual(returned.routes, [], 'The next lesson must remain gated by its required XP');
            assert.equal(returned.get('S_IMAGICFIGHTER').value, 0);
            assert.ok(returned.audio.filter(file => file === voice).length > before);
            await assertLearnedRoom(returned);
        }
        await returned.clickActor('ANNOBJECT1', 120);
        await exit(returned, 'ANNOBJECT4', 'ARCADE', 'KORYTARZ');
    } finally { returned.dispose(); }
    const corridor = await createRoom(runtime, { room: 'Korytarz', previous: 'GULDRYK', files });
    try {
        await settle(corridor);
        if (!corridor.findPixel('ANNOBJECT0')) await corridor.clickActor('ANNOBJECT3', 120);
        await exit(corridor, 'ANNOBJECT0', 'ARCADE', 'GULDRYK');
    } finally { corridor.dispose(); }
    const restored = await createRoom(runtime, { room: 'Guldryk', previous: 'KORYTARZ', files });
    try {
        await settle(restored); await assertLearnedRoom(restored);
        assert.deepEqual(restored.calls, [], 'Ordinary saved re-entry must not rerun the tutorial-return reward or XP display setup');
        await focus(restored, 'ANNOBJECT5');
        const before = savedBook(restored);
        await exit(restored, 'ANNOBJECT5', 'MAGIC');
        assert.equal(restored.get('S_IMAGICFIGHTER').value, 43, 'An earned pudding spell must allow its original practice lesson without XP');
        assert.deepEqual(savedBook(restored), before, 'Free practice must preserve the saved spellbook');
        console.log('CLASSROOM RETURN: native post-tutorial dialogue, saved XP display/orbs, insufficient-XP lesson guard, door exit/re-entry and free earned-spell practice passed');
    } finally { restored.dispose(); }
};
