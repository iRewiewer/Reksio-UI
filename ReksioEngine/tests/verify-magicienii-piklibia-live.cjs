const assert = require('node:assert/strict');

module.exports = async function verifyPiklibiaLive(runtime, options = {}) {
    const recording = require('./fixtures/magicienii-piklibia-puzzle.json');
    const fixture = await require('./magicienii-adventure-fixture.cjs')(runtime, options);
    const { get, missing, routes, audio, backgrounds } = fixture;
    const switches = new Set();
    let elapsed = 0, saved;
    try {
        for (let index = 0; index < 24; index++) {
            const actor = get(`ANNOBJECT${index}`), event = actor.annFile.events[0], frame = event.frames[0];
            const image = actor.annFile.annImages[event.framesImageMapping[0]];
            assert.deepEqual([get('ARRGOTOX').GET(index), get('ARRGOTOY').GET(index)],
                [image.positionX + frame.positionX + image.height, image.positionY + frame.positionY],
                `Switch ${index} must retain its own authored walking destination`);
        }
        const navigation = get('WPATH'), cameraPositions = [];
        const step = count => fixture.step(count, () => {
            const y = navigation.GETBKGPOSY(); cameraPositions.push(y);
            assert.ok(y >= -300 && y <= 300, 'The live adventure camera must stay inside the original background bounds');
            assert.ok(Math.abs(get('ANNBKG').GETPOSITIONY() - (-300 - y)) <= 1,
                'The original tick must keep the background aligned with its navigation camera');
            elapsed = fixture.elapsed;
        });
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
    } finally { fixture.dispose(); }
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
    return { files: saved, previous: 'PIKLIBIA', destination: 'DOMSPIEL' };
};
