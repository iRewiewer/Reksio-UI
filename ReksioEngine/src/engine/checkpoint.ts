export type SceneCheckpoint = {
    version: 1
    scene: string
    previousScene: string | null
    globals: Array<{ parent: string | null; name: string; type: string; value: any }>
    saveData: object
    filesystemEntries: Array<{ key: IDBValidKey; value: ArrayBuffer }>
}
