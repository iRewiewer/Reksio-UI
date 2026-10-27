import { Point, Texture } from 'pixi.js'
import { DisplayType, ParentType } from './index'
import { PatternDefinition } from '../../fileFormats/cnv/types'
import { Engine } from '../index'
import { AdvancedSprite } from '../rendering'
import { assert } from '../../common/errors'
import { method } from '../../common/types'

type Entry = {
    alias: string
    column: number
    row: number
    layer: number
    object: DisplayType<any>
    sprite: AdvancedSprite
}

class PatternSurface extends AdvancedSprite {
    // Tiles have their own PATTERN hit tests, not one canvas-wide rectangular hotspot.
    containsPoint() { return false }
}

export class Pattern extends DisplayType<PatternDefinition> {
    private readonly surface = new PatternSurface(Texture.EMPTY)
    private entries: Entry[] = []
    private readonly layers: number
    private gridX: number
    private gridY: number

    constructor(engine: Engine, parent: ParentType<any> | null, definition: PatternDefinition) {
        super(engine, parent, definition)
        assert(engine.compat.patternMaps, 'PATTERN is not enabled for this game')
        this.layers = Math.max(1, Math.trunc(definition.LAYERS))
        this.gridX = definition.GRIDX || 1
        this.gridY = definition.GRIDY || 1
        assert(this.gridX > 0 && this.gridY > 0, 'PATTERN grid dimensions must be positive')
        this.surface.name = `${this.name} (PATTERN)`
        this.surface.eventMode = 'none'
        this.surface.sortableChildren = true
    }

    async applyDefaults() {
        this.surface.visible = this.definition.VISIBLE
        this.SETPRIORITY(this.definition.PRIORITY ?? 0)
        if (this.definition.TOCANVAS) this.engine.rendering.addToStage(this.surface)
    }

    async ready() {
        await this.callbacks.run('ONINIT')
    }

    tick() {
        for (const entry of this.entries) this.sync(entry)
    }

    private sync(entry: Entry) {
        const source = entry.object.getRenderObject()
        const target = entry.sprite
        if (!(source instanceof AdvancedSprite)) {
            target.visible = false
            return null
        }
        target.texture = source.texture
        target.hitmap = source.hitmap
        target.anchor.copyFrom(source.anchor)
        target.scale.copyFrom(source.scale)
        target.rotation = source.rotation
        target.alpha = source.alpha
        target.tint = source.tint
        target.blendMode = source.blendMode
        target.visible = source.visible
        target.position.set(entry.column * this.gridX, entry.row * this.gridY)
        return source
    }

    @method()
    ADD(alias: string, column: number, row: number, objectName: string, layer: number, info: number = 0) {
        column = Math.trunc(column)
        row = Math.trunc(row)
        layer = Math.trunc(layer)
        assert(column >= 0 && row >= 0 && column < Math.trunc(this.definition.WIDTH / this.gridX) &&
            row < Math.trunc(this.definition.HEIGHT / this.gridY), 'PATTERN cell is outside the map')
        assert(layer >= 0 && layer < this.layers, 'PATTERN layer is outside the map')
        const object = this.getObject<DisplayType<any>>(objectName)
        assert(object && typeof object.getRenderObject === 'function', 'PATTERN graphics object does not exist')
        const previous = this.entries.find(entry => entry.column === column && entry.row === row && entry.layer === layer)
        if (previous) this.removeEntry(previous)
        const sprite = new AdvancedSprite(Texture.EMPTY)
        sprite.eventMode = 'none'
        sprite.zIndex = layer
        sprite.name = `${this.name}/${alias}`
        const entry = { alias, column, row, layer, object, sprite }
        this.entries.push(entry)
        this.surface.addChild(sprite)
        this.surface.sortChildren()
        this.sync(entry)
    }

    @method()
    REMOVE(alias: string) {
        const entry = this.entries.find(entry => entry.alias === alias)
        if (entry) this.removeEntry(entry)
    }

    private removeEntry(entry: Entry) {
        this.entries.splice(this.entries.indexOf(entry), 1)
        this.surface.removeChild(entry.sprite)
        entry.sprite.destroy()
    }

    @method()
    REMOVEALL() {
        for (const entry of [...this.entries]) this.removeEntry(entry)
    }

    @method()
    SETGRID(x: number, y: number) {
        assert(x > 0 && y > 0, 'PATTERN grid dimensions must be positive')
        this.gridX = Math.trunc(x)
        this.gridY = Math.trunc(y)
        this.tick()
    }

    @method()
    MOVE(x: number, y: number) {
        this.surface.position.set(this.surface.x + Math.trunc(x), this.surface.y + Math.trunc(y))
    }

    @method()
    SETPOSITION(x: number, y: number) {
        this.surface.position.set(Math.trunc(x), Math.trunc(y))
    }

    @method()
    GETPOSITIONX() { return this.surface.x }

    @method()
    GETPOSITIONY() { return this.surface.y }

    @method()
    SHOW() { this.surface.visible = true }

    @method()
    HIDE() { this.surface.visible = false }

    @method()
    GETGRAPHICSAT(x: number, y: number, includeHidden: boolean, ignoreAlpha: boolean,
        layer: number = -1, alpha: number = 0) {
        const point = new Point(x, y)
        const firstLayer = layer < 0 ? this.layers - 1 : layer
        const lastLayer = firstLayer === this.layers - 1 ? 0 : firstLayer
        for (let current = firstLayer; current >= lastLayer; current--) {
            for (const entry of this.entries) {
                if (entry.layer !== current) continue
                const source = this.sync(entry)
                if (!source || (!includeHidden && !source.visible)) continue
                entry.sprite.toGlobal(new Point(0, 0))
                if (!entry.sprite.containsPoint(point)) continue
                if (ignoreAlpha || entry.sprite.getAlphaAt(point) > alpha) return entry.object.name
            }
        }
        return 'UNKNOWN'
    }

    getRenderObject() { return this.surface }

    destroy() {
        this.REMOVEALL()
        this.engine.rendering.removeFromStage(this.surface)
        this.surface.destroy()
    }
}
