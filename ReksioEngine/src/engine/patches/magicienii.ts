import type { Engine } from '../index'
import type { SequenceFile } from '../../fileFormats/seq'

export function patchMagicieniiSource(filename: string, source: string): string {
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
