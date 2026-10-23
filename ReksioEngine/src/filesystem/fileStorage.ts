import { IDBPDatabase, openDB } from 'idb'
import { assert } from '../common/errors'

export abstract class FileStorage {
    abstract init(): Promise<void>
    abstract get(filename: string): Promise<ArrayBuffer>
    abstract has(filename: string): Promise<boolean>
    abstract save(filename: string, content: ArrayBuffer): Promise<void>
    async snapshot(): Promise<Array<{ key: IDBValidKey; value: ArrayBuffer }>> {
        throw new Error('This storage does not support checkpoints')
    }
    async restore(_entries: Array<{ key: IDBValidKey; value: ArrayBuffer }>): Promise<void> {
        throw new Error('This storage does not support checkpoints')
    }
}

export class IndexedDBStorage extends FileStorage {
    private db: IDBPDatabase | null = null

    constructor(
        private name: string,
        private legacyName?: string
    ) {
        super()
    }

    async init() {
        this.db = await openDB(this.name, 2, {
            upgrade(database: IDBPDatabase) {
                if (!database.objectStoreNames.contains('filesystem')) database.createObjectStore('filesystem')
                if (!database.objectStoreNames.contains('metadata')) database.createObjectStore('metadata')
            },
        })
        if (this.legacyName && !(await this.db.get('metadata', 'legacyImported'))) {
            const legacy = await openDB(this.legacyName)
            try {
                if (!(await this.db.count('filesystem')) && legacy.objectStoreNames.contains('filesystem')) {
                    const tx = legacy.transaction('filesystem')
                    const keys = await tx.store.getAllKeys()
                    const values = await tx.store.getAll()
                    await tx.done
                    await this.restore(keys.map((key, i) => ({ key, value: values[i] })))
                }
                await this.db.put('metadata', true, 'legacyImported')
            } finally {
                legacy.close()
            }
        }
    }

    async get(filename: string) {
        assert(this.db !== null)
        return await this.db.get('filesystem', filename)
    }

    async has(filename: string): Promise<boolean> {
        assert(this.db !== null)
        return (await this.db.count('filesystem', filename)) > 0
    }

    async save(filename: string, content: ArrayBuffer) {
        assert(this.db !== null)
        await this.db.put('filesystem', content, filename)
    }

    async snapshot() {
        assert(this.db !== null)
        const tx = this.db.transaction('filesystem')
        const keys = await tx.store.getAllKeys()
        const values = await tx.store.getAll()
        await tx.done
        return keys.map((key, i) => ({ key, value: values[i] as ArrayBuffer }))
    }

    async restore(entries: Array<{ key: IDBValidKey; value: ArrayBuffer }>) {
        assert(this.db !== null)
        const tx = this.db.transaction('filesystem', 'readwrite')
        await tx.store.clear()
        for (const entry of entries) await tx.store.put(entry.value, entry.key)
        await tx.done
    }
}
