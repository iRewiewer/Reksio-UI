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

export function patchMagicieniiSource(filename: string, source: string): string {
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
