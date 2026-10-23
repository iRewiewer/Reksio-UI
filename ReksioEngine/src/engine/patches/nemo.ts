import type { Engine } from '../index'
import type { ValueType } from '../types'
import type { CNV } from '../../fileFormats/cnv/parser'
import type { SceneCheckpoint } from '../checkpoint'

export async function captureNemoCheckpoint(engine: Engine, entry: SceneCheckpoint): Promise<SceneCheckpoint> {
    const wasRunning = engine.app.ticker.started
    try {
        // GSAVE persists district and inventory changes without leaving the ARCADE scene.
        await engine.stopForRestart()
        const globals = await Promise.all(entry.globals.map(async (captured) => {
            const current = engine.scopeManager.scopes.flatMap((scope) => scope.objects).find((object) =>
                object.name === captured.name && (object.parent?.name ?? null) === captured.parent &&
                object.definition.TYPE === captured.type
            ) as ValueType<any, any> | undefined
            return current && typeof current.getValue === 'function'
                ? { ...captured, value: await current.getValue() }
                : captured
        }))
        return structuredClone({
            ...entry,
            captureKind: 'persisted',
            globals,
            saveData: engine.saveFile.toObject(),
            filesystemEntries: await engine.options.storage.snapshot(),
        })
    } finally {
        if (wasRunning) engine.app.ticker.start()
    }
}

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
