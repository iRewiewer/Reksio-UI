import { ParentType, ValueType } from './index'
import { Engine } from '../index'
import { StringDefinition } from '../../fileFormats/cnv/types'
import { method } from '../../common/types'

export class String extends ValueType<StringDefinition, string> {
    constructor(engine: Engine, parent: ParentType<any> | null, definition: StringDefinition) {
        super(engine, parent, definition, '')
    }

    async ready() {
        await this.callbacks.run('ONINIT')
    }

    @method()
    async ADD(text: string) {
        await this.setValue(this.value + text)
    }

    @method()
    async SET(text: string) {
        await this.setValue(text)
    }

    @method()
    async SUB(index: number, length: number) {
        await this.setValue(this.value.substring(0, index) + this.value.substring(index + length))
    }

    @method()
    GET(index?: number, length: number = 1) {
        if (index === undefined) {
            return this.value
        }
        return this.value.substring(index, index + length)
    }

    @method()
    async CUT(index: number, length: number) {
        if (!this.engine.compat.stringSlices) return this.__call('CUT', [index, length])
        const start = Math.max(0, Math.trunc(index)), count = Math.trunc(length)
        // Native nonpositive lengths keep the remainder of the string.
        await this.setValue(this.value.slice(start, count <= 0 ? undefined : start + count))
    }

    @method()
    FIND(needle: string, start?: number) {
        return this.value.indexOf(needle, start)
    }

    @method()
    async REPLACE(needle: string, replacement: string) {
        if (!this.engine.compat.stringReplacement) return this.__call('REPLACE', [needle, replacement])
        await this.setValue(needle.length ? this.value.split(needle).join(replacement) : this.value)
    }

    @method()
    LENGTH() {
        return this.value.length
    }

    @method()
    async UPPER() {
        if (!this.engine.compat.modernScripts) return this.__call('UPPER', [])
        await this.setValue(this.value.toUpperCase())
    }

    @method()
    async LOWER() {
        if (!this.engine.compat.modernScripts) return this.__call('LOWER', [])
        await this.setValue(this.value.toLowerCase())
    }

    protected async valueChanged(oldValue: any, newValue: any) {
        if (oldValue !== newValue) {
            await this.callbacks.run('ONCHANGED', newValue)
        }
        await this.callbacks.run('ONBRUTALCHANGED', newValue)
    }
}
