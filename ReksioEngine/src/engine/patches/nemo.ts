import type { Engine } from '../index'
import type { ValueType } from '../types'
import type { CNV } from '../../fileFormats/cnv/parser'

export function patchNemoDefinitions(filename: string, definitions: CNV) {
    if (filename !== 'common/classes/clswalker.class') return
    for (const name of ['ANNCREATURE', 'ANNFRIEND', 'ANNMASK']) {
        const object = definitions[name]
        if (object?.TYPE === 'ANIMO' && object.FILENAME === '') {
            object.FILENAME = '$COMMON/WALKER_MOVE.ANN'
        }
    }
}

export async function restoreNemoSaveDatabase(engine: Engine) {
    const slot = await engine.getObject<ValueType<any, string>>('SGSLOTNAME')?.getValue()
    if (slot === undefined) return
    const filename = await engine.resolvePath(`$COMMON/SAVE/SLOT${slot}.DTA`)
    if (!await engine.filesystem.hasFile(filename)) return

    // GSAVE's constructor loads global settings, but not the selected slot's database.
    await engine.getObject('GSAVE')?.__call('DBLOAD', [])
}
