import type { Engine } from './index'
import type { ValueType } from './types'

export type SceneCheckpoint = {
    version: 1
    scene: string
    previousScene: string | null
    captureKind?: 'persisted'
    globals: Array<{ parent: string | null; name: string; type: string; value: any }>
    saveData: object
    filesystemEntries: Array<{ key: IDBValidKey; value: ArrayBuffer }>
}

export async function captureSavedProgressCheckpoint(engine: Engine, entry: SceneCheckpoint): Promise<SceneCheckpoint> {
    const wasRunning = engine.app.ticker.started
    try {
        // Capture only after script writes settle; transient scene objects are recreated on restore.
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
