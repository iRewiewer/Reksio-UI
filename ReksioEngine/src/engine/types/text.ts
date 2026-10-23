import { Type } from './index'
import { TextDefinition } from '../../fileFormats/cnv/types'
import * as PIXI from 'pixi.js'
import { method } from '../../common/types'
import { BitmapText } from 'pixi.js'
import { Font } from './font'

export class Text extends Type<TextDefinition> {
    private text: PIXI.BitmapText | null = null

    async applyDefaults() {
        const font: Font | null = this.getObject(this.definition.FONT)
        if (font === null || font.bitmapFont === null) {
            return
        }

        this.text = new BitmapText(this.definition.TEXT ?? '', {
            fontName: font.bitmapFont.font,
        })

        const [x1, y1, x2, y2] = this.definition.RECT
        this.text.x = x1
        this.text.y = y1
        this.text.anchor.set(0.5, 0)
        this.text.visible = this.definition.VISIBLE
        this.engine.rendering.addToStage(this.text)
    }

    async ready() {
        await this.callbacks.run('ONINIT')
    }

    destroy() {
        if (this.text) {
            this.engine.rendering.removeFromStage(this.text)
        }
    }

    @method()
    SETTEXT(content: string) {
        if (this.text) {
            this.text.text = this.engine.compat.modernScripts ? content.replaceAll('|', '\n') : content
        }
    }

    @method()
    SETJUSTIFY(x1: number, y1: number, x2: number, y2: number, horizontal: string, vertical: string) {
        if (!this.engine.compat.modernScripts) return this.__call('SETJUSTIFY', [x1, y1, x2, y2, horizontal, vertical])
        if (!this.text) return
        const x = horizontal.toUpperCase() === 'RIGHT' ? 1 : horizontal.toUpperCase() === 'CENTER' ? 0.5 : 0
        const y = vertical.toUpperCase() === 'BOTTOM' ? 1 : vertical.toUpperCase() === 'CENTER' ? 0.5 : 0
        this.text.anchor.set(x, y)
        this.text.position.set(x1 + (x2 - x1) * x, y1 + (y2 - y1) * y)
        this.text.maxWidth = Math.max(0, x2 - x1)
        this.text.align = x === 1 ? 'right' : x === 0.5 ? 'center' : 'left'
    }

    @method()
    SETCOLOR(r: number, g: number, b: number) {
        if (!this.engine.compat.modernScripts) return this.__call('SETCOLOR', [r, g, b])
        if (this.text) this.text.tint = ((r & 255) << 16) | ((g & 255) << 8) | (b & 255)
    }
}
