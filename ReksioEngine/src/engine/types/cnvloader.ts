import { Type } from './index'
import { CNVLoaderDefinition } from '../../fileFormats/cnv/types'
import { assert } from '../../common/errors'
import { method } from '../../common/types'
import { doReady, loadDefinition } from '../../filesystem/definitionLoader'

export class CNVLoader extends Type<CNVLoaderDefinition> {
    private loaded = new Map<string, { object: Type<any>; previous: Type<any> | null }[]>()

    @method()
    async LOAD(filename: string) {
        assert(this.engine.currentScene !== null)
        const definition = await this.engine.filesystem.getCNVFile(
            await this.engine.currentScene.getRelativePath(filename)
        )

        assert(this.parent?.scope)
        const scope = this.parent.scope
        const previous = this.engine.compat.underwaterPhysics ? new Map(scope.content) : null
        await loadDefinition(this.engine, this.parent.scope, definition, this.engine.currentScene)
        await doReady(this.parent.scope)
        if (previous) {
            const entries = [...scope.content].filter(([name, object]) => previous.get(name) !== object)
                .map(([name, object]) => ({ object, previous: previous.get(name) ?? null }))
            this.loaded.set(filename.replace(/\\/g, '/').toUpperCase(), entries)
        }
    }

    @method()
    RELEASE(filename: string) {
        if (!this.engine.compat.underwaterPhysics) return this.__call('RELEASE', [filename])
        const key = filename.replace(/\\/g, '/').toUpperCase()
        const scope = this.parent?.scope
        const entries = this.loaded.get(key)
        if (!scope || !entries) return
        for (const { object, previous } of entries) {
            for (const owned of [...object.clones, object]) {
                if (scope.get(owned.name) !== owned) continue
                owned.destroy()
                owned.isReady = false
                scope.remove(owned.name)
            }
            if (previous && !scope.get(object.name)) scope.set(previous.name, previous)
        }
        this.loaded.delete(key)
    }
}
