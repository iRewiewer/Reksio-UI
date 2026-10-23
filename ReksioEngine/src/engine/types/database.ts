import { Type } from './index'
import { DatabaseDefinition } from '../../fileFormats/cnv/types'
import { Struct } from './struct'
import { method } from '../../common/types'
import { assert } from '../../common/errors'

const decoder = new TextDecoder('windows-1250')

export class Database extends Type<DatabaseDefinition> {
    private baseStruct: Struct | null = null
    private content: Struct[] = []
    private cursorPosition: number = 0

    init() {
        this.baseStruct = this.getObject(this.definition.MODEL)
    }

    async ready() {
        await this.callbacks.run('ONINIT')
    }

    @method()
    GETROWSNO() {
        return this.content.length
    }

    @method()
    GETCURSORPOS() {
        return this.cursorPosition
    }

    @method()
    NEXT() {
        this.cursorPosition = (this.cursorPosition + 1) % this.content.length
        this.updateCursorValue()
    }

    @method()
    PREV() {
        this.cursorPosition += 1
        if (this.cursorPosition < 0) {
            this.cursorPosition = this.content.length - 1
        }
        this.updateCursorValue()
    }

    @method()
    SELECT(index: number) {
        assert(index < this.content.length && index >= 0, 'out of bounds')
        this.cursorPosition = index
        this.updateCursorValue()
    }

    @method()
    FIND(column: string, value: any, offset: number) {
        if (this.engine.compat.modernScripts || this.engine.compat.simpleWorldPathing) {
            return this.findRow(column, value, offset)
        }
        // Should be ok without await for getValue as these types don't have async get
        const index = this.content.findIndex((entry) => entry.GETFIELD(column)?.getValue() === value)
        if (index == -1) {
            return -1
        }

        // Simulating stupid behavior
        if (index < offset) {
            return this.content.length + index
        }

        return index
    }

    private async findRow(column: string, value: any, offset: number) {
        for (let index = 0; index < this.content.length; index++) {
            const stored = await this.content[index].GETFIELD(column)?.getValue()
            const matches = typeof stored === 'string' && typeof value === 'string'
                ? stored.toUpperCase() === value.toUpperCase() : stored === value
            if (matches) return index < offset ? this.content.length + index : index
        }
        return -1
    }

    @method()
    REMOVEAT(index: number) {
        this.content.splice(index, 1)
        this.updateCursorValue()
    }

    @method()
    REMOVEALL() {
        this.content.forEach((item) => item.destroy())
        this.content = []
        this.updateCursorValue()
    }

    @method()
    async LOAD(path: string) {
        assert(this.engine.currentScene !== null)
        assert(this.baseStruct !== null)

        const relativePath = await this.engine.currentScene.getRelativePath(path)
        const data = await this.engine.filesystem.getFile(relativePath)
        const content = decoder.decode(data)
        const lines = content.replaceAll('\r\n', '\n').trim().split('\n')

        const structFieldsNames = Array.from(this.baseStruct.structure.keys())
        for (const line of lines) {
            if (this.engine.compat.modernScripts && !line.trim()) continue
            const fieldContents = line.split('|')
            const newEntry = await this.baseStruct.clone()

            for (let i = 0; i < structFieldsNames.length; i++) {
                const fieldName = structFieldsNames[i]
                const fieldValue = fieldContents[i] ?? (this.engine.compat.modernScripts ? '' : undefined)
                await newEntry.setField(fieldName, fieldValue === 'NULL' ? null : fieldValue)
            }
            this.content.push(newEntry)
        }

        this.updateCursorValue()
    }

    @method()
    async SAVE(path: string) {
        if (!this.engine.compat.modernScripts) return this.__call('SAVE', [path])
        assert(this.baseStruct !== null)
        const rows = []
        for (const row of this.content) {
            const fields = []
            for (const name of this.baseStruct.structure.keys()) {
                fields.push(String(await row.GETFIELD(name)?.getValue() ?? 'NULL'))
            }
            rows.push(fields.join('|'))
        }
        const text = rows.join('\r\n') + '\r\n'
        // DTA files use Windows-1250, including localized slot names.
        const alphabet = decoder.decode(Uint8Array.from({ length: 256 }, (_, i) => i))
        const encoded = Uint8Array.from(text, (char) => {
            const index = alphabet.indexOf(char)
            return index < 0 ? 63 : index
        })
        await this.engine.filesystem.saveFile(await this.engine.resolvePath(path), encoded.buffer)
    }

    private updateCursorValue() {
        assert(this.parentScope !== null)

        const cursorName = this.name + '_CURSOR'
        if (this.content.length == 0) {
            this.parentScope.remove(cursorName)
        } else {
            this.parentScope.set(cursorName, this.content[this.cursorPosition])
        }
    }
}
