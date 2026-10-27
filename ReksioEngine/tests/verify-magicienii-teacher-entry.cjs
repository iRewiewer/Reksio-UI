const assert = require('node:assert/strict');
const createRoom = require('./magicienii-adventure-fixture.cjs');

module.exports = async function verifyTeacherEntry(runtime) {
    let files, previous = 'HOLGLOWNY', character;
    const waitFor = async (room, predicate, message, limit = 1800) => {
        for (let tick = 0; tick < limit && !predicate(); tick++) await room.step(1);
        assert.ok(predicate(), message);
    };
    const settle = async room => {
        await waitFor(room, () => room.get('VARIFIRSTENTER').value === 0 && !room.get('VARBSEQPLAYING').value,
            'The room-owned introduction and arrival must release the controls');
        await room.step(60);
    };
    const transition = async (room, actor, destination, arcade) => {
        await room.clickActor(actor);
        await waitFor(room, () => room.routes.length > 0, `The original ${destination} transition must complete`);
        assert.deepEqual(room.routes, [destination]);
        if (arcade) assert.equal(room.get('G_SARCADEOBJECTS').value, arcade);
        files = [...room.memory]; previous = room.get('G_SLASTOBJECTS').value;
    };
    const ask = async (dialog, id, destination) => {
        const index = dialog.get('ARRQUESTIONS').FIND(id); assert.ok(index >= 0, `Question ${id} must be unlocked by the original dialogue`);
        await dialog.clickActor(`ANNSMOKE_${index}`);
        await waitFor(dialog, () => destination ? dialog.routes.length > 0 : dialog.get('ARRASKED').FIND(id) >= 0 &&
            !dialog.get('SEQBLANK').ISPLAYING() && !dialog.get('SNDANSWER').ISPLAYING(), `Question ${id} must finish naturally`);
        if (destination) assert.deepEqual(dialog.routes, [destination]);
        files = [...dialog.memory]; previous = dialog.get('G_SLASTOBJECTS').value;
    };

    // Office access is the entry boundary; no dialogue permission or learned spell is seeded.
    const unbriefed = await createRoom(runtime, { room: 'Guldryk', previous: 'KORYTARZ' });
    try {
        await settle(unbriefed);
        assert.ok(unbriefed.audio.includes('wavs/gul_m331.wav'), 'The unbriefed introduction must play its actual voice');
        await unbriefed.clickActor('ANNOBJECT9', 180);
        assert.deepEqual(unbriefed.routes, [], 'The mannequin must stay locked before the headmaster briefing');
        assert.equal(unbriefed.get('G_ARRREXSPELLS').GET(3), 0);
    } finally { unbriefed.dispose(); }

    const office = await createRoom(runtime, { room: 'GabinetDyr', previous });
    try {
        await settle(office); await transition(office, 'ANNOBJECT2', 'DIALOGS');
        character = office.get('G_SDIALOGCHARACTER').value; assert.equal(character, 'BUREKTOR');
    } finally { office.dispose(); }
    const initial = await createRoom(runtime, { room: 'Dialogs', previous, character, files });
    try {
        await initial.step(5);
        assert.equal(initial.get('ARRQUESTIONS').FIND('13'), -1);
        await ask(initial, '7'); await ask(initial, '12', 'CHOICE');
    } finally { initial.dispose(); }
    const choice = await createRoom(runtime, { room: 'Choice', previous, character, files });
    try {
        assert.equal(choice.get('BTNBONE').logic.enabled, false, 'The decision must wait for its introduction');
        await waitFor(choice, () => choice.get('BTNBONE').logic.enabled, 'The original decision narration must enable the bone');
        await transition(choice, 'ANNBONE', 'DIALOGS');
        assert.deepEqual(choice.audio.filter(file => /burektor_m0(?:42|43|44|45|49)\.wav$/.test(file)),
            ['wavs/burektor_m042.wav', 'wavs/burektor_m044.wav', 'wavs/burektor_m043.wav', 'wavs/burektor_m045.wav', 'wavs/burektor_m049.wav']);
    } finally { choice.dispose(); }
    const briefing = await createRoom(runtime, { room: 'Dialogs', previous, character, files });
    try {
        await briefing.step(5); await ask(briefing, '13');
        assert.ok(runtime.deserializeArray(briefing.memory.get('common/questions_asked0.arr')).includes('13'));
        await transition(briefing, 'ANNEXIT', 'ARCADE', 'GABINETDYR');
    } finally { briefing.dispose(); }
    const returned = await createRoom(runtime, { room: 'GabinetDyr', previous: 'DIALOGS', files });
    try { await settle(returned); await transition(returned, 'ANNOBJECT4', 'ARCADE', 'HOLGLOWNY'); }
    finally { returned.dispose(); }
    const hall = await createRoom(runtime, { room: 'HolGlowny', previous, files });
    try { await settle(hall); await transition(hall, 'ANNOBJECT2', 'ARCADE', 'KORYTARZ'); }
    finally { hall.dispose(); }
    const corridor = await createRoom(runtime, { room: 'Korytarz', previous, files });
    try {
        await settle(corridor); await corridor.clickActor('ANNOBJECT3', 120);
        await transition(corridor, 'ANNOBJECT0', 'ARCADE', 'GULDRYK');
    } finally { corridor.dispose(); }
    const classroom = await createRoom(runtime, { room: 'Guldryk', previous, files });
    try {
        await settle(classroom);
        const intro = await classroom.engine.filesystem.getARRFile('dane/game/przygoda/arcade/guldryk/wst0_poburdial13.arr');
        assert.ok(classroom.audio.includes(`wavs/${intro[1].toLowerCase()}.wav`), 'The briefing-specific introduction must play instead of the absent generic cue');
        assert.equal(classroom.get('G_ARRREXSPELLS').GET(3), 0);
        await transition(classroom, 'ANNOBJECT9', 'MAGIC');
        assert.equal(classroom.get('S_IMAGICFIGHTER').value, 13);
        assert.equal(classroom.get('S_SLIMBORETURN').value, 'GULDRYK');
        assert.equal(classroom.get('G_ARRREXSPELLS').GET(3), 1, 'Only the native mannequin interaction may grant pudding before the lesson');
        assert.deepEqual(runtime.deserializeArray(classroom.memory.get('common/spells0.arr')).slice(0, 12),
            [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
        assert.deepEqual(classroom.captures, [['$COMMON\\ZOOM.IMG', 2, 2, 210, 250, 610, 550]]);
        console.log('TEACHER ENTRY: native headmaster questions 7/12, narrated bone decision, persisted briefing 13, hall/corridor doors and first pudding lesson entry passed; unbriefed mannequin stays locked');
        return { files, destination: 'MAGIC', fighter: 13, previous: 'GULDRYK' };
    } finally { classroom.dispose(); }
};
