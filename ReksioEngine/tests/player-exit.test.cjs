const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const player = ts.createSourceFile('devPlayer.ts', fs.readFileSync(path.join(__dirname, '../src/devPlayer.ts'), 'utf8'),
    ts.ScriptTarget.Latest, true);
const options = player.statements.flatMap(statement => statement.declarationList?.declarations ?? [])
    .find(declaration => declaration.name.getText(player) === 'baseOptions').initializer;
const exitSource = options.properties.find(property => property.name?.getText(player) === 'onExit').initializer.getText(player);
const launcher = ts.createSourceFile('app.js', fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const messageSource = launcher.statements.find(statement => ts.isFunctionDeclaration(statement) &&
    statement.name.text === 'handleEngineMessage').getText(launcher);

test('Only Magicienii notifies the launcher on exit without requiring fullscreen', async () => {
    for (const profile of ['default', 'ozn', 'nemo', 'timpului', 'magicienii']) {
        const calls = [], document = { fullscreenElement: null, exitFullscreen: async () => calls.push('fullscreen') };
        const exit = new Function('urlParams', 'document', 'flushLauncherConsoleLogs', 'postLauncherMessage', `return ${exitSource}`)(
            new URLSearchParams({ compatProfile: profile }), document,
            () => calls.push('flush'), message => calls.push(message));
        await exit();
        assert.deepEqual(calls, profile === 'magicienii' ? ['flush', { type: 'reksio:exit' }] : ['fullscreen']);
    }
});

test('Magicienii tolerates losing fullscreen before its own exit request completes', async () => {
    let attempts = 0;
    const exit = new Function('urlParams', 'document', 'flushLauncherConsoleLogs', 'postLauncherMessage', `return ${exitSource}`)(
        new URLSearchParams({ compatProfile: 'magicienii' }), { fullscreenElement: {}, exitFullscreen: async () => {
            attempts++; throw new Error('Document not active');
        } }, () => {}, () => {});
    await exit();
    assert.equal(attempts, 1);
});

function launcherFixture(profile = 'magicienii', fullscreen = false, rejectFullscreen = false) {
    const calls = [], origin = 'http://localhost:3030', frame = { contentWindow: {} };
    const state = { games: [{ id: 'game', title: 'Example', profile }], loadedId: 'game', selectedId: 'game' };
    const window = { location: { origin, href: `${origin}/?game=game&scene=OUTRO_7&sceneObject=TEST&debug=true` },
        history: { replaceState: (data, title, url) => calls.push(['url', url.toString()]) } };
    const document = { fullscreenElement: fullscreen ? frame : null, exitFullscreen: async () => {
        calls.push('fullscreen'); if (rejectFullscreen) throw new Error('Document not active');
    } };
    const params = new URLSearchParams(new URL(window.location.href).search);
    const handle = new Function('window', 'document', 'nodes', 'state', 'compatProfileForGame', 'syncCurrentSave',
        'stopLoadedGame', 'renderGames', 'renderDetails', 'launcherParams', 'addLog', `${messageSource}; return handleEngineMessage;`)(
        window, document, { gameFrame: frame }, state, game => game.profile, () => calls.push('save'),
        () => { calls.push('stop'); state.loadedId = null; frame.src = 'about:blank'; },
        () => calls.push('games'), () => calls.push('details'), params, (...args) => calls.push(['log', ...args]));
    const event = { origin, source: frame.contentWindow, data: { type: 'reksio:exit' } };
    return { calls, state, frame, params, handle, event };
}

test('Launcher saves and closes Magicienii, retaining the library and removing one-shot scene overrides', () => {
    const { calls, state, frame, params, handle, event } = launcherFixture();
    handle(event);
    assert.deepEqual(calls, ['save', 'stop', 'games', 'details', ['url', 'http://localhost:3030/?debug=true'],
        ['log', 'launcher', 'info', 'Game closed', 'Example']]);
    assert.equal(state.loadedId, null); assert.equal(state.selectedId, null);
    assert.equal(state.games.length, 1); assert.equal(frame.src, 'about:blank');
    assert.deepEqual([...params], [['debug', 'true']]);
});

test('Launcher rejects exits from another origin, another window, a stopped game or another profile', () => {
    for (const scenario of ['origin', 'source', 'stopped', 'profile']) {
        const fixture = launcherFixture(scenario === 'profile' ? 'default' : 'magicienii');
        if (scenario === 'origin') fixture.event.origin = 'https://example.com';
        if (scenario === 'source') fixture.event.source = {};
        if (scenario === 'stopped') fixture.state.loadedId = null;
        fixture.handle(fixture.event);
        assert.deepEqual(fixture.calls, []);
        assert.equal(fixture.state.selectedId, 'game');
    }
});

test('Launcher leaves iframe-owned fullscreen and contains fullscreen rejection', async () => {
    for (const rejected of [false, true]) {
        const { calls, handle, event } = launcherFixture('magicienii', true, rejected);
        handle(event); await Promise.resolve();
        assert.deepEqual(calls.slice(0, 3), ['save', 'fullscreen', 'stop']);
        assert.equal(calls.some(call => Array.isArray(call) && call[0] === 'log' && call[2] === 'warn'), rejected);
    }
});
