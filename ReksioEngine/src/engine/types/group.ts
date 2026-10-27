import { Type } from './index'
import { GroupDefinition } from '../../fileFormats/cnv/types'
import { method } from '../../common/types'
import { logger } from '../logging'

export class Group extends Type<GroupDefinition> {
    private objects: any[] = []
    private marker = -1

    async ready() {
        await this.callbacks.run('ONINIT')
    }

    @method()
    ADD(...objectsNames: string[]) {
        objectsNames.forEach((objectName) => {
            const object = this.getObject(objectName)
            if (object === null) {
                logger.warn(`Script was trying to add non-existing object "${objectName}" to a group "${this.name}"`, {
                    group: this,
                })
            } else {
                this.objects.push(object)
            }
        })
    }

    @method()
    REMOVE(...objectsNames: string[]) {
        this.objects = this.objects.filter((object) => !objectsNames.includes(object.name))
    }

    @method()
    ADDCLONES(name: string, first: number, last: number) {
        if (!this.engine.compat.cloneGroups) return this.__call('ADDCLONES', [name, first, last])
        for (let index = first; index <= last; index++) {
            const object = this.getObject(`${name}_${index}`)
            if (object) this.objects.push(object)
        }
    }

    @method()
    SETMARKERPOS(position: number) {
        if (!this.engine.compat.cloneGroups) return this.__call('SETMARKERPOS', [position])
        this.marker = Math.trunc(position)
    }

    @method()
    GETMARKERPOS() {
        if (!this.engine.compat.cloneGroups) return this.__call('GETMARKERPOS', [])
        return this.marker
    }

    @method()
    RESETMARKER() {
        if (!this.engine.compat.cloneGroups) return this.__call('RESETMARKER', [])
        this.marker = -1
    }

    @method()
    GETNAMEATMARKER() {
        if (!this.engine.compat.cloneGroups) return this.__call('GETNAMEATMARKER', [])
        return this.objects[this.marker]?.name ?? null
    }

    @method()
    NEXT(count = 1) {
        if (!this.engine.compat.cloneGroups) return this.__call('NEXT', [count])
        return this.advanceMarker(count)
    }

    @method()
    PREV(count = 1) {
        if (!this.engine.compat.cloneGroups) return this.__call('PREV', [count])
        return this.advanceMarker(-count)
    }

    private advanceMarker(count: number) {
        if (!this.objects.length) return null
        const size = this.objects.length
        this.marker = ((this.marker + Math.trunc(count)) % size + size) % size
        return this.objects[this.marker].name
    }

    @method()
    GETSIZE() {
        if (!this.engine.compat.groupCollections) return this.__call('GETSIZE', [])
        return this.objects.length
    }

    @method()
    REMOVEALL() {
        if (!this.engine.compat.groupCollections) return this.__call('REMOVEALL', [])
        this.removeAll()
    }

    async __call(methodName: string, args: any[]) {
        for (const object of this.objects) {
            if (methodName in object) {
                await object[methodName](...args)
            } else if (this.engine.compat.cloneGroups && object.definition?.TYPE === 'CLASS_INSTANCE') {
                await object.__call(methodName, args)
            } else {
                const argumentsString = args?.map((arg) => typeof arg).join(', ')
                logger.warn(
                    `Method '${methodName}(${argumentsString ?? ''})' does not exist in ${object.constructor.name}`,
                    {
                        object,
                        args,
                    }
                )
            }
        }
    }

    add(object: Type<any>) {
        this.objects.push(object)
    }

    removeAll(): void {
        this.objects = []
        this.marker = -1
    }
}
