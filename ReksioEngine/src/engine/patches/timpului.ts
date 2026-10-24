import type { CNV } from '../../fileFormats/cnv/parser'
import type { Engine } from '../index'
import type { ValueType } from '../types'

export async function prepareTimeMachineVehicleDebugScene(engine: Pick<Engine, 'compat' | 'getObject'>,
    scene: string, wheels: string[]) {
    if (!engine.compat.vehiclePhysics || scene !== 'SAMOCHODZIK') return
    if (wheels.length !== 4 || wheels.some(wheel => !/^[AKS]$/.test(wheel))) {
        throw new Error('A vehicle requires four valid wheel choices')
    }
    const parameters = engine.getObject<ValueType<any, string>>('G_SARCADESCENEPARAM')
    if (!parameters) throw new Error('Vehicle scene parameters are not ready')
    await parameters.setValue(`${wheels.join('')}0`)
}

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
