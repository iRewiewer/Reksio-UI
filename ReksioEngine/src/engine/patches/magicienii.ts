import type { Engine } from '../index'

export function patchMagicieniiArray(filename: string, entries: any[]): any[] {
    if (filename !== 'dane/game/przygoda/arcade/telep_podworko/idle_kogut.arr') return entries
    return entries.map((entry) => entry === 'KUGUT_U103' ? 'KOGUT_U103' : entry)
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
