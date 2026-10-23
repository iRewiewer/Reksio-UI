import type { CNV } from '../../fileFormats/cnv/parser'

export function patchTimeMachineDefinitions(filename: string, definitions: CNV) {
    if (filename === 'dane/game/przygoda/arcade/arcade.cnv' && definitions.ANNREX?.FILENAME === 'REX.ANN') {
        // The character is replaced from the scene DTA; the disc has no initial REX.ANN.
        definitions.ANNREX.FILENAME = 'TEMPLATE.ANN'
    }
    if (filename !== 'dane/game/przygoda/przygoda.cnv') return

    // This disc's music helper stores filenames in the INTEGER G_ITEMP, producing 0.wav.
    for (const name of ['BEHMUSICSET', 'BFITMP15']) {
        const callback = definitions[name]?.CODE
        if (typeof callback?.code === 'string') {
            callback.code = callback.code.replace(/\bG_ITEMP\b/g, 'G_SMUSIC')
        }
    }
}
