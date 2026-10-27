const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: true,
    compilerOptions: { module: 'CommonJS', target: 'ES2022', experimentalDecorators: true } });
const { loadAnn } = require('../src/fileFormats/ann');
const { parseCNV, decryptCNV } = require('../src/fileFormats/cnv');

if (!process.argv[2]) {
    console.error('Usage: node tests/verify-magicienii-maps.cjs <extracted game files directory>');
    process.exit(1);
}
const root = path.join(path.resolve(process.argv[2]), 'Dane/Game/Przygoda');
const bytes = file => {
    const data = fs.readFileSync(file);
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
};
const scenes = [
    { directory: 'Dragon', file: 'Dragon.cnv', pattern: 'PATTERNBKG', centered: true,
        files: /^level\d+\.ann$/i, actors: ['ANNELEMENT'], divisor: 10 },
    { directory: 'Dragon', file: 'Dragon.cnv', pattern: 'PATTERNFIRE', centered: true,
        files: /^levelfire\d+\.ann$/i, actors: ['ANNFIRE'], divisor: 10 },
    { directory: 'miotly', file: 'Miotly.cnv', pattern: 'PATTERNBKG', centered: false,
        files: /^level\d+\.ann$/i, actors: ['ANNELEMENT', 'ANNREXMASK', 'ANNKRETMASK'], divisor: 10 },
    { directory: 'Fred', file: 'Fred.cnv', pattern: 'PATBOARD', centered: true,
        files: /^uklad\.ann$/i, actors: ['ANNELEMENT'], divisor: 20 },
];
let total = 0, maps = 0, fallbacks = 0;
for (const scene of scenes) {
    const directory = path.join(root, scene.directory);
    const definitions = parseCNV(decryptCNV(bytes(path.join(directory, scene.file))));
    const pattern = definitions[scene.pattern];
    assert.equal(pattern.TYPE, 'PATTERN');
    assert.ok(pattern.GRIDX > 0 && pattern.GRIDY > 0);
    const columns = Math.trunc(pattern.WIDTH / pattern.GRIDX);
    const rows = Math.trunc(pattern.HEIGHT / pattern.GRIDY);
    const actors = scene.actors.map(name => {
        const animation = loadAnn(bytes(path.join(directory, definitions[name].FILENAME)));
        return { name, first: animation.events[0],
            events: new Map(animation.events.map(event => [event.name.toUpperCase(), event])) };
    });
    for (const file of fs.readdirSync(directory).filter(file => scene.files.test(file))) {
        const animation = loadAnn(bytes(path.join(directory, file)));
        const event = animation.events.find(event => event.framesCount > 0);
        assert.ok(event, `${scene.directory}/${file}: missing layout event`);
        for (let index = 0; index < event.framesCount; index++) {
            const frame = event.frames[index], image = animation.annImages[event.framesImageMapping[index]];
            const x = image.positionX + frame.positionX + (scene.centered ? image.width / 2 : 0);
            const y = image.positionY + frame.positionY + (scene.centered ? image.height / 2 : 0);
            const column = Math.trunc(Math.round(x) / scene.divisor);
            const row = Math.trunc(Math.round(y) / scene.divisor);
            const label = `${scene.directory}/${file} frame ${index} (${frame.name})`;
            assert.ok(column >= 0 && column < columns && row >= 0 && row < rows,
                `${label}: cell ${column},${row} outside ${columns}x${rows}`);
            for (const actor of actors) {
                const named = actor.events.get(frame.name.toUpperCase());
                const target = named ?? actor.first;
                assert.ok(target?.framesCount > 0, `${label}: missing ${actor.name} event`);
                if (!named) fallbacks++;
            }
            total++;
        }
        maps++;
        console.log(`${scene.directory}/${file}: ${event.framesCount} placements and ${actors.length} animation/mask sources verified`);
    }
}
console.log(`MAPS: ${maps} original layouts, ${total} grid placements; tile events, collision masks and bounds verified`);
console.log(`Native event-zero fallback required for ${fallbacks} layout references`);
