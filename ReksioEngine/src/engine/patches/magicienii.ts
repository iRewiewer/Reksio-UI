import type { Engine } from '../index'
import type { SequenceFile } from '../../fileFormats/seq'
import type { ANN } from '../../fileFormats/ann'
import type { ValueType } from '../types'
import type { Database } from '../types/database'
import type { Animo } from '../types/animo'

export function getMagicieniiPlaceholderAnimation(filename: string): ANN | null {
    if (!['dane/game/przygoda/labirynt/blank.ann',
        'dane/game/przygoda/labirynt/przedmioty1.ann'].includes(filename)) return null
    // Native objects survive an absent editor placeholder and can receive a later LOAD.
    return {
        header: { framesCount: 0, bpp: 16, eventsCount: 0, fps: 16, flags: 0,
            transparency: 255, randomFramesNumber: 0, author: '', description: '' },
        events: [], images: [], annImages: [],
    }
}

export function patchMagicieniiAnimation(filename: string, animation: ANN): ANN {
    if (filename !== 'dane/game/przygoda/labirynt/ges.ann' ||
        animation.events.some(event => event.name.toUpperCase() === 'IDLE_FROG')) return animation
    const idle = animation.events.find(event => event.name.toUpperCase() === 'IDLE')
    const frog = animation.events.find(event => event.name.toUpperCase() === 'DOWN_FROG')
    if (!idle?.frames.length || !frog?.frames.length) return animation
    // Keep the original idle timing/path metadata while displaying an existing frog frame.
    const event = { ...idle, name: 'IDLE_FROG', frames: idle.frames.map((frame, index) => ({
        ...frog.frames[0], name: index === 0 ? '_FROG' : frame.name, hasSounds: 0, sounds: [],
    })), framesImageMapping: idle.frames.map(() => frog.framesImageMapping[0]) }
    return { ...animation, header: { ...animation.header, eventsCount: animation.events.length + 1 },
        events: [...animation.events, event] }
}

export function patchMagicieniiSource(filename: string, source: string): string {
    if (['labirynt.cnv', 'cnvlevel0.cnv', 'cnvlevel1.cnv', 'cnvlevel2.cnv'].some((name) =>
        filename === `dane/game/przygoda/labirynt/${name}`)) {
        // Quantize through an INTEGER temporary before multiplying back to the tile center.
        for (const [target, input] of [['VARINT0', 'VARINT0'], ['VARINT1', 'VARINT1'],
            ['VARINT2', 'VARINT0'], ['VARINT3', 'VARINT1']]) {
            source = source.replaceAll(`${target}^SET([${input}@40*40+20]);`,
                `${target}^SET([${input}@40]);${target}^SET([${target}*40+20]);`)
        }
    }
    if (filename === 'dane/game/przygoda/labirynt/labirynt.cnv') {
        // Off-canvas templates produce layer-zero clones; spell hit tests require the actors at 300.
        source = source.replaceAll('*VARSTRING0^SETFPS(12);*VARSTRING0^SETANCHOR("CENTER");',
            '*VARSTRING0^SETFPS(12);*VARSTRING0^SETPRIORITY(300);*VARSTRING0^SETANCHOR("CENTER");')
    }
    if (filename === 'dane/game/game.cnv') {
        // The browser cannot warp the OS pointer; keep the global cursor aligned with scene mice.
        return source.replaceAll('MOUSE^SETPOSITION(400,300);MOUSE^HIDE();', 'MOUSE^HIDE();')
    }
    if (filename === 'dane/game/przygoda/cat/cat.cnv') {
        // Native integer division selects an eight-way event; JS expressions retain fractions.
        return source.replaceAll('*VARPLAYERNAME^PLAY([360-VARINT0@45]);',
            'VARINT0^SET([360-VARINT0@45]);VARINT0^MOD(8);*VARPLAYERNAME^PLAY(VARINT0);')
    }
    if (filename === 'dane/game/przygoda/fred/fred.cnv') {
        // The original callback already stops the actors; scene pause also blocks its failure sequence.
        return source.replaceAll('FRED^PAUSE();SEQNARRATOR^PLAY("FAILED");',
            'KEYBOARD^DISABLE();BTNRESTART^DISABLE();TIMERSEQ^DISABLE();SEQNARRATOR^PLAY("FAILED");')
    }
    if (filename === 'dane/game/przygoda/dragon/dragon.cnv') {
        // Select the high-detail parallax path without pretending to measure browser CPU frequency.
        return source.replaceAll('VARCPUSPEED^SET(SYSTEM^GETMHZ());', 'VARCPUSPEED^SET(1000);')
    }
    if (filename === 'dane/game/przygoda/miotly/miotly.cnv') {
        // Keep the original static-background path; CPU-frequency probing is not a browser API.
        const repaired = source.replaceAll('VARSPEED^SET(SYSTEM^GETMHZ());', 'VARSPEED^SET(0);')
        const failure = 'MIOTLY^PAUSE();SEQKRET^PLAY("FAILED");'
        if (!repaired.includes(failure)) return repaired
        // Gameplay is already stopped by this callback, but its dialogue must continue ticking.
        return repaired.replaceAll(failure, '__WEB_BROOMPAUSE__^RUN();SEQKRET^PLAY("FAILED");') + '\n' +
            'OBJECT=__WEB_BROOMPLAYING__\n__WEB_BROOMPLAYING__:TYPE=GROUP\n' +
            'OBJECT=__WEB_BROOMPAUSE__\n__WEB_BROOMPAUSE__:TYPE=BEHAVIOUR\n' +
            '__WEB_BROOMPAUSE__:CODE={MIOTLY^GETPLAYINGANIMO("__WEB_BROOMPLAYING__");' +
            '__WEB_BROOMPLAYING__^PAUSE();KEYBOARD^DISABLE();BTNRESTART^DISABLE();TIMEREND^DISABLE();SNDWIR^STOP();}\n'
    }
    if (filename === 'dane/game/przygoda/barandalf/barandalf.cnv' && source.includes('BARANDALF^PAUSE();')) {
        // Restart dialogue must tick after gameplay stops, including the boat overlay's controls.
        return source.replaceAll('BARANDALF^PAUSE();', '__WEB_BARANDALFPAUSE__^RUN();') + '\n' +
            'OBJECT=__WEB_BARANDALFPLAYING__\n__WEB_BARANDALFPLAYING__:TYPE=GROUP\n' +
            'OBJECT=__WEB_BARANDALFPAUSE__\n__WEB_BARANDALFPAUSE__:TYPE=BEHAVIOUR\n' +
            '__WEB_BARANDALFPAUSE__:CODE={SEQMANDOLINA^STOP();BARANDALF^GETPLAYINGANIMO("__WEB_BARANDALFPLAYING__");' +
            '__WEB_BARANDALFPLAYING__^PAUSE();MOUSE^DISABLESIGNAL();BTNRESTART^DISABLE();' +
            '@IF("VARLEVEL","_","1","__WEB_BARANDALFBOATPAUSE__","__WEB_BARANDALFWALKPAUSE__");}\n' +
            'OBJECT=__WEB_BARANDALFWALKPAUSE__\n__WEB_BARANDALFWALKPAUSE__:TYPE=BEHAVIOUR\n' +
            '__WEB_BARANDALFWALKPAUSE__:CODE={TIMERSEQ^DISABLE();}\n' +
            'OBJECT=__WEB_BARANDALFBOATPAUSE__\n__WEB_BARANDALFBOATPAUSE__:TYPE=BEHAVIOUR\n' +
            '__WEB_BARANDALFBOATPAUSE__:CODE={BTNKRET^DISABLE();BTNLOVELAS^DISABLE();BTNMIMLI^DISABLE();' +
            'BTNREX^DISABLE();BTNCHOMIK^DISABLE();BTNLODKA^DISABLE();}\n'
    }
    if (filename === 'dane/game/przygoda/shooter/shooter.cnv' && source.includes('SHOOTER^PAUSE();')) {
        // End-of-round sequences must tick while enemies, spawn timers and input are frozen.
        return source.replaceAll('SHOOTER^PAUSE();', '__WEB_SHOOTERPAUSE__^RUN();') + '\n' +
            'OBJECT=__WEB_SHOOTERPLAYING__\n__WEB_SHOOTERPLAYING__:TYPE=GROUP\n' +
            'OBJECT=__WEB_SHOOTERPAUSE__\n__WEB_SHOOTERPAUSE__:TYPE=BEHAVIOUR\n' +
            '__WEB_SHOOTERPAUSE__:CODE={SEQDROB^STOP();SHOOTER^GETPLAYINGANIMO("__WEB_SHOOTERPLAYING__");' +
            '__WEB_SHOOTERPLAYING__^PAUSE();TIMERPIECHUR^DISABLE();TIMERGOOSE^DISABLE();TIMERKURA^DISABLE();' +
            'KEYBOARD^DISABLE();MOUSE^DISABLESIGNAL();BTNRESTART^DISABLE();}\n'
    }
    if (filename === 'dane/game/przygoda/labirynt/labirynt.cnv' && source.includes('LABIRYNT^PAUSE();')) {
        // Freeze gameplay, but keep the failure/restart sequence's completion processor running.
        return source.replaceAll('LABIRYNT^PAUSE();', '__WEB_MAZEPAUSE__^RUN();') + '\n' +
            'OBJECT=__WEB_MAZEPLAYING__\n__WEB_MAZEPLAYING__:TYPE=GROUP\n' +
            'OBJECT=__WEB_MAZEPAUSE__\n__WEB_MAZEPAUSE__:TYPE=BEHAVIOUR\n' +
            '__WEB_MAZEPAUSE__:CODE={LABIRYNT^GETPLAYINGANIMO("__WEB_MAZEPLAYING__");' +
            '__WEB_MAZEPLAYING__^PAUSE();KEYBOARD^DISABLE();MOUSE^DISABLESIGNAL();BTNRESTART^DISABLE();}\n'
    }
    if (filename === 'dane/game/przygoda/arcade/alchemy.cnv') {
        return source.replaceAll('^SETPTIORITY(', '^SETPRIORITY(')
    }
    if (filename !== 'dane/game/przygoda/magic/magic.cnv') return source
    // The wand's drawing event is CZARUJE (event 1), not the absent PLAY alias.
    return source
        .replaceAll('ANNWAND0^SETFRAME("PLAY",VARIDEBUG)', 'ANNWAND0^SETFRAME("CZARUJE",VARIDEBUG)')
        .replaceAll('ANNWAND0^GETNOFINEVENT(1)', 'ANNWAND0^GETNOFINEVENT("CZARUJE")')
        .replaceAll('BEHPLAYRANDSOUND^PLAY()', 'BEHPLAYRANDSOUND^RUN()')
}

export function patchMagicieniiArray(filename: string, entries: any[]): any[] {
    if (filename !== 'dane/game/przygoda/arcade/telep_podworko/idle_kogut.arr') return entries
    return entries.map((entry) => entry === 'KUGUT_U103' ? 'KOGUT_U103' : entry)
}

export function patchMagicieniiSequence(filename: string, entries: SequenceFile): SequenceFile {
    if (filename === 'dane/game/przygoda/lebiodka/gadaja.seq') {
        const actors = new Map([['SEQ1', 'CB_BOBROMIR'], ['SEQ2', 'CB_BULBO'],
            ['SEQ3', 'CB_LOVELAS'], ['SEQ4B', 'CB_BARANDALF']])
        const unused = entries.filter((entry) => entry.TYPE === 'SPEAKING' && entry.ADD === 'GADAJA' && actors.has(entry.NAME) &&
            actors.get(entry.NAME) === entry.ANIMOFN)
        const root = entries.find((entry) => entry.NAME === 'GADAJA' && entry.TYPE === 'SEQUENCE' &&
            entry.MODE === 'PARAMETER' && entry.SEQEVENT?.size === 7)
        if (unused.length !== 4 || !root || !['LEB1', 'LEB2', 'LEB3'].every((name, index) =>
            root.SEQEVENT.get(name) === String(index + 5))) return entries
        // Copied courtyard dialogue is never played here and references absent scene actors.
        return entries.filter((entry) => !unused.includes(entry)).map((entry) => entry === root
            ? { ...entry, SEQEVENT: new Map([['LEB1', '1'], ['LEB2', '2'], ['LEB3', '3']]) } : entry)
    }
    if (filename !== 'dane/game/przygoda/dialogs/blank.seq') return entries
    const placeholder = entries.find((entry) =>
        entry.NAME === 'NOWY' && entry.TYPE === 'SIMPLE' && entry.FILENAME === 'BOLEK.ANN'
    )
    if (!placeholder) return entries

    // Dialogs only plays GADABLANK; the unused editor placeholder prevents eager sequence loading.
    return entries.filter((entry) => entry !== placeholder).map((entry) => {
        if (entry.TYPE !== 'SEQUENCE' || entry.MODE !== 'PARAMETER' || !entry.SEQEVENT) return entry
        const events = new Map(entry.SEQEVENT)
        events.delete('NOWY')
        return { ...entry, SEQEVENT: events }
    })
}

export function restoreMagicieniiTransitionState(engine: Engine) {
    // Scene-entry checkpoints skip the earlier page turn that normally clears these overlays.
    for (const name of ['G_ANNPAGE', 'G_STLPAGE']) {
        const animation = engine.getObject<any>(name)
        animation?.STOP(false)
        animation?.HIDE()
    }
    engine.getObject<any>('G_IMGPAGE')?.HIDE()
}

export async function restoreMagicieniiSavedProgress(engine: Engine) {
    if (!engine.compat.persistedCatCheckpoints || engine.currentScene?.name !== 'CAT') return
    const slot = await engine.getObject<ValueType<any, number>>('G_IGAMESLOT')?.getValue()
    const inventory = engine.getObject<Database>('DBITEMS')
    if (slot === undefined || !inventory) return
    const filename = `$COMMON\\ITEMS${slot}.DTA`
    if (!await engine.filesystem.hasFile(await engine.resolvePath(filename))) return
    inventory.REMOVEALL()
    await inventory.LOAD(filename)
    // The original re-entry initializer redraws dropped boots even after their pickup was saved.
    if (await inventory.FIND('NAME', 'BUTY_BUT', 0) >= 0) engine.getObject<Animo>('ANNBUTY')?.HIDE()
}
