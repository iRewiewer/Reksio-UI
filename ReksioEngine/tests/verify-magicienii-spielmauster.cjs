const assert = require('node:assert/strict');
const createRoom = require('./magicienii-adventure-fixture.cjs');

module.exports = async function verifySpielmauster(runtime, checkpoint) {
    assert.equal(checkpoint.destination, 'DOMSPIEL');
    let files = checkpoint.files, character;
    const waitFor = async (room, predicate, message, limit = 1200) => {
        for (let tick = 0; tick < limit && !predicate(); tick++) await room.step(1);
        assert.ok(predicate(), message);
    };
    const settle = async room => {
        await waitFor(room, () => room.get('VARIFIRSTENTER').value === 0 && !room.get('VARBSEQPLAYING').value,
            'Native arrival and dialogue must release the adventure controls');
        await room.step(60);
    };
    const field = async (room, index, name) => {
        await room.get('BEHSELECTOBJ').RUN(index);
        return room.get('SOBJECT').GETFIELD(name).getValue();
    };
    const transition = async (room, actor, scene, objects) => {
        await room.clickActor(actor);
        await waitFor(room, () => room.routes.length > 0, `The original ${scene} transition must complete`);
        assert.deepEqual(room.routes, [scene]);
        assert.equal(room.get('G_SARCADEOBJECTS').value, objects);
        files = [...room.memory];
    };
    const talk = async previous => {
        const room = await createRoom(runtime, { room: 'Domspiel', previous, files });
        try {
            await settle(room);
            assert.equal(room.get('VARINUMITEMS').value, 4);
            assert.equal(await room.get('BEHFINDITEM').RUN('KLUCZ_PIKLIB_BUT'), -1);
            assert.equal(await field(room, 11, 'IPARAM2'), 1);
            await transition(room, 'ANNOBJECT11', 'DIALOGS', 'DOMSPIEL');
            character = room.get('G_SDIALOGCHARACTER').value;
            assert.equal(character, 'SPIELMAUSTER');
        } finally { room.dispose(); }
    };
    const openDialog = () => createRoom(runtime, { room: 'Dialogs', previous: 'DOMSPIEL', character, files });
    const preview = async (room, actor) => {
        const pixel = room.findPixel(actor); assert.ok(pixel);
        room.get('MOUSE').onMouseMove({ button: 0, screen: { x: pixel[0], y: pixel[1] } });
        await room.step(2);
        assert.ok(room.audio.includes('wavs/kogut_p086.wav'), 'Hover must play the authored question preview');
    };
    const answerFile = 'wavs/spielmauster_p092.wav';
    const idle = room => !room.get('SEQBLANK').ISPLAYING() && !room.get('SNDANSWER').ISPLAYING() &&
        Array.from({ length: 6 }, (_value, index) => room.get(`SNDREX${index}`)).every(sound => !sound.ISPLAYING());

    await talk(checkpoint.previous);
    const early = await openDialog();
    try {
        await early.step(5);
        assert.deepEqual(early.get('ARRQUESTIONS').value, ['66', '67', '68', '69', '70']);
        assert.deepEqual(early.get('ARRHISTORY').value, []);
        assert.deepEqual(early.get('ARRASKED').value, []);
        await transition(early, 'ANNEXIT', 'ARCADE', 'DOMSPIEL');
        assert.deepEqual(runtime.deserializeArray(early.memory.get('common/questions_asked0.arr')), []);
    } finally { early.dispose(); }

    // Re-enter through the real NPC hotspot: leaving without an answer must not award the key.
    await talk('DIALOGS');
    const dialog = await openDialog();
    try {
        await dialog.step(5);
        const index = dialog.get('ARRQUESTIONS').FIND('70'), cloud = `ANNSMOKE_${index}`;
        assert.equal(index, 4);
        await preview(dialog, cloud);
        assert.deepEqual(dialog.get('ARRASKED').value, [], 'Previewing a question must not mark it answered');
        await dialog.clickActor(cloud);
        await waitFor(dialog, () => dialog.get('ARRASKED').FIND('70') >= 0 && idle(dialog),
            'Question, answer animation and completion callbacks must finish normally');
        await dialog.step(30);
        assert.ok(dialog.audio.includes(answerFile));
        assert.ok(dialog.audio.some(file => /^wavs\/rex_r(?:008|009|011|013|014|015)\.wav$/.test(file)));
        assert.deepEqual(dialog.get('ARRHISTORY').value, ['70']);
        assert.deepEqual(dialog.get('ARRQUESTIONS').value, ['66', '67', '68', '69']);
        assert.deepEqual(runtime.deserializeArray(dialog.memory.get('common/questions_asked0.arr')), ['70']);
        assert.deepEqual(runtime.deserializeArray(dialog.memory.get('common/spielmauster_hist0.arr')), ['70']);

        const writes = dialog.saves.length;
        await dialog.clickActor('ANNHISTORY', 2);
        assert.equal(dialog.get('VARIMODE').value, 1);
        await preview(dialog, 'ANNSMOKEHIST_0');
        await dialog.clickActor('ANNSMOKEHIST_0');
        await waitFor(dialog, () => dialog.audio.filter(file => file === answerFile).length === 2 && idle(dialog),
            'The clone-zero history bubble must replay its original answer');
        await dialog.step(30);
        assert.equal(dialog.saves.length, writes, 'History playback must not rewrite progress or duplicate rewards');
        assert.deepEqual(dialog.get('ARRASKED').value, ['70']);
        assert.deepEqual(dialog.get('ARRHISTORY').value, ['70']);
        await dialog.clickActor('ANNHISTORY', 2);
        assert.equal(dialog.get('VARIMODE').value, 0);
        assert.deepEqual(dialog.get('ARRQUESTIONS').value, ['66', '67', '68', '69']);
        assert.deepEqual(dialog.calls, []);
        assert.deepEqual([...dialog.missing].filter(name => name !== 'NULL'), [],
            'Only the native empty-focus sentinel may be absent; every dialogue callback must resolve');
        await transition(dialog, 'ANNEXIT', 'ARCADE', 'DOMSPIEL');
        assert.equal(dialog.get('G_SLASTOBJECTS').value, 'DIALOGS');
        console.log('SPIELMAUSTER DIALOGUE: native NPC entry, no-answer exit guard, hover preview, question/answer completion, clone-zero history replay and persisted answer/return passed');
    } finally { dialog.dispose(); }

    const reward = await createRoom(runtime, { room: 'Domspiel', previous: 'DIALOGS', files });
    try {
        await settle(reward);
        assert.equal(reward.get('VARINUMITEMS').value, 5);
        assert.equal(await reward.get('BEHFINDITEM').RUN('KLUCZ_PIKLIB_BUT'), 0);
        assert.equal(await reward.get('DBITEMS_CURSOR').GETFIELD('PARENT').getValue(), -1);
        assert.equal(await field(reward, 11, 'IPARAM2'), 9999);
        assert.equal(reward.saves.filter(file => file === 'common/items0.dta').length, 1);
        files = [...reward.memory];
    } finally { reward.dispose(); }
    const reloaded = await createRoom(runtime, { room: 'Domspiel', previous: 'DIALOGS', files });
    try {
        await settle(reloaded);
        assert.equal(reloaded.get('VARINUMITEMS').value, 5);
        assert.equal(await reloaded.get('BEHFINDITEM').RUN('KLUCZ_PIKLIB_BUT'), 0);
        assert.equal(reloaded.saves.includes('common/items0.dta'), false, 'The saved conversation reward must not be duplicated');
        await transition(reloaded, 'ANNOBJECT13', 'ARCADE', 'PIKLIBIA');
        console.log('SPIELMAUSTER KEY: original post-dialogue reward, detached inventory parent, saved reward guard and return to Piklibia passed');
    } finally { reloaded.dispose(); }

    const showDoor = async room => {
        await settle(room);
        for (let scroll = 0; scroll < 8 && !room.findPixel('ANNOBJECT33'); scroll++) {
            const bounds = room.get('ANNOBJECT33').getRenderObject().getBounds();
            await room.click(500, bounds.y < 0 ? 40 : 550, 180);
        }
        assert.ok(room.findPixel('ANNOBJECT33'), 'Normal scrolling must expose the underground door');
    };
    const board = await createRoom(runtime, { room: 'Piklibia', previous: 'DOMSPIEL', files });
    try {
        await showDoor(board);
        assert.equal(await field(board, 26, 'IPARAM0'), 0);
        await board.clickActor('ANNREX', 30); await board.clickActor('ANNITEM1', 30);
        assert.match(board.get('VARSCURRENTITEM').value, /^ZLOM[0-7]_BUT$/);
        await board.clickActor('ANNOBJECT33', 600);
        assert.equal(board.get('VARINUMITEMS').value, 5, 'An unrelated scrap must not be consumed by the door');
        assert.equal(await field(board, 26, 'IPARAM0'), 0);
        await board.clickActor('ANNREX', 30); await board.clickActor('ANNITEM0', 30);
        assert.equal(board.get('VARSCURRENTITEM').value, 'KLUCZ_PIKLIB_BUT');
        await board.clickActor('ANNOBJECT33');
        await waitFor(board, () => board.get('VARINUMITEMS').value === 4 && !board.get('VARBSEQPLAYING').value,
            'Using the earned key must consume it and finish the original door-opening dialogue');
        await board.step(120);
        assert.equal(await field(board, 26, 'IPARAM0'), 1);
        assert.equal(await board.get('BEHFINDITEM').RUN('KLUCZ_PIKLIB_BUT'), -1);
        assert.equal(board.get('ANNOBJECT33').GETEVENTNAME(), 'OPEN');
        assert.equal(board.get('VARIWASUSED').value, 0, 'The generic dispatcher must clear its handled-action flag');
        assert.ok(board.audio.includes('wavs/nar_p055.wav') && board.audio.includes('wavs/kretes_p056.wav'));
        files = [...board.memory];
    } finally { board.dispose(); }

    const unlocked = await createRoom(runtime, { room: 'Piklibia', previous: 'DOMSPIEL', files });
    try {
        await showDoor(unlocked);
        assert.equal(await field(unlocked, 26, 'IPARAM0'), 1);
        assert.equal(await unlocked.get('BEHFINDITEM').RUN('KLUCZ_PIKLIB_BUT'), -1);
        await unlocked.clickActor('ANNOBJECT33', 600);
        assert.equal(unlocked.get('ANNOBJECT33').GETEVENTNAME(), 'OPEN');
        await transition(unlocked, 'ANNOBJECT26', 'LABIRYNT', '2');
        console.log('PIKLIBIA DOOR: unrelated-item guard, earned key use, original opening dialogue, persisted unlock/re-entry and native third-maze transition passed');
    } finally { unlocked.dispose(); }
    return { files, previous: 'PIKLIBIA', destination: 'LABIRYNT', arcade: '2' };
};
