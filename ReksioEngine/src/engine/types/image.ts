import { DisplayType } from './index'
import { ImageDefinition } from '../../fileFormats/cnv/types'
import { assert, NotImplementedError } from '../../common/errors'
import { Container, Graphics, Point, Sprite } from 'pixi.js'
import { loadSprite } from '../../filesystem/assetsLoader'
import { AdvancedSprite } from '../rendering'
import { method } from '../../common/types'
import * as PIXI from 'pixi.js'
import { ButtonLogicComponent, Event as ButtonEvent } from '../components/button'

export class Image extends DisplayType<ImageDefinition> {
    public sprite: AdvancedSprite | null = null
    private buttonLogic: ButtonLogicComponent | null = null

    async tick() {
        await this.buttonLogic?.tick()
    }

    async init() {
        await this.initSprite(this.definition.FILENAME)
    }

    async applyDefaults() {
        this.SETPRIORITY(this.definition.PRIORITY ?? 0)
    }

    private async initSprite(path: string) {
        this.sprite = await this.load(path)
        this.sprite.visible = this.definition.VISIBLE
        this.sprite.eventMode = 'none'
        this.sprite.name = `${this.name} (IMAGE)` // For PIXI Devtools
    }

    private async load(path: string) {
        const relativePath =
            this.engine.currentScene !== null
                ? await this.engine.currentScene.getRelativePath(path)
                : await this.engine.resolvePath(path)
        return await loadSprite(this.engine.filesystem, relativePath)
    }

    async ready() {
        assert(this.sprite !== null)
        this.engine.rendering.addToStage(this.sprite)
        await this.callbacks.run('ONINIT')
    }

    destroy() {
        assert(this.sprite !== null)
        this.buttonLogic?.unregisterInteractive(this.sprite)
        this.buttonLogic = null
        this.releaseUnderwaterMask()
        this.engine.rendering.removeFromStage(this.sprite)
    }

    @method()
    SETOPACITY(opacity: number) {
        assert(this.sprite !== null)
        this.sprite.alpha = opacity / 255
    }

    @method()
    MOVE(xOffset: number, yOffset: number) {
        assert(this.sprite !== null)
        this.sprite.x += xOffset
        this.sprite.y += yOffset
    }

    @method()
    SETPOSITION(x: number, y: number) {
        assert(this.sprite !== null)
        this.sprite.x = x
        this.sprite.y = y
    }

    @method()
    async SETASBUTTON(enabled: boolean, showPointer: boolean) {
        if (!this.engine.compat.imageButtons) return this.__call('SETASBUTTON', [enabled, showPointer])
        assert(this.sprite !== null)
        this.buttonLogic?.unregisterInteractive(this.sprite)
        if (!enabled) {
            this.buttonLogic = null
            return
        }
        this.buttonLogic ??= new ButtonLogicComponent(async (_previous, event) => {
            const callbacks: Partial<Record<ButtonEvent, string>> = {
                [ButtonEvent.OVER]: 'ONFOCUSON', [ButtonEvent.OUT]: 'ONFOCUSOFF',
                [ButtonEvent.DOWN]: 'ONCLICK', [ButtonEvent.UP]: 'ONRELEASE',
            }
            const callback = callbacks[event]
            if (callback) await this.callbacks.run(callback)
        })
        this.buttonLogic.registerInteractive(this.sprite, showPointer)
        this.sprite.checkPixelPerfect = true
        await this.buttonLogic.enable()
    }

    @method()
    SHOW() {
        assert(this.sprite !== null)
        this.sprite.visible = true
    }

    @method()
    HIDE() {
        assert(this.sprite !== null)
        this.sprite.visible = false
    }

    @method()
    GETPOSITIONX() {
        assert(this.sprite !== null)
        return this.sprite.x
    }

    @method()
    GETPOSITIONY() {
        assert(this.sprite !== null)
        return this.sprite.y
    }

    @method()
    GETALPHA(x: number, y: number) {
        assert(this.sprite !== null)
        return this.sprite.getAlphaAt(new Point(x, y))
    }

    private maskContainer: Container | null = null
    private otherObjectsAlphaSpriteCache = new Map<string, Sprite>()
    private underwaterMask: { container: Container; sprite: Sprite; texture: PIXI.RenderTexture;
        lights: Map<string, Sprite> } | null = null

    @method()
    MERGEALPHA(x: number, y: number, name: string) {
        assert(this.sprite !== null)
        if (this.engine.compat.underwaterPhysics) return this.mergeUnderwaterAlpha(x, y, name)

        if (this.maskContainer === null) {
            const maskGraphics = new Graphics()

            maskGraphics.beginTextureFill({
                texture: this.generateMaskTexture(this.sprite),
                color: 0xffffff,
            })
            maskGraphics.drawRect(0, 0, this.sprite.width, this.sprite.height)
            maskGraphics.endFill()

            this.maskContainer = new Container()
            this.maskContainer.addChild(maskGraphics)
        }

        const object: DisplayType<any> | null = this.getObject(name)
        assert(object !== null)

        let otherObjectAlphaSprite = this.otherObjectsAlphaSpriteCache.get(name)
        if (!otherObjectAlphaSprite) {
            const renderObject = object.getRenderObject()
            assert(renderObject !== null)
            otherObjectAlphaSprite = new Sprite(this.generateMaskTexture(renderObject))
            this.otherObjectsAlphaSpriteCache.set(name, otherObjectAlphaSprite)
            this.maskContainer.addChild(otherObjectAlphaSprite)
        }

        otherObjectAlphaSprite.x = x
        otherObjectAlphaSprite.y = y
        this.sprite.mask = new Sprite(this.engine.app.renderer.generateTexture(this.maskContainer))
    }

    private mergeUnderwaterAlpha(x: number, y: number, name: string) {
        assert(this.sprite !== null)
        if (!this.underwaterMask) {
            const container = new Container()
            const background = new Sprite(PIXI.Texture.WHITE)
            background.width = this.sprite.width
            background.height = this.sprite.height
            container.addChild(background)
            const texture = PIXI.RenderTexture.create({ width: this.sprite.width, height: this.sprite.height })
            const sprite = new Sprite(texture)
            this.engine.rendering.addToStage(sprite)
            this.underwaterMask = { container, texture, sprite, lights: new Map() }
            this.sprite.mask = sprite
        }
        const mask = this.underwaterMask
        let light = mask.lights.get(name)
        if (!light) {
            const object = this.getObject<DisplayType<any>>(name)
            const renderObject = object?.getRenderObject()
            assert(renderObject instanceof AdvancedSprite)
            light = new Sprite(this.generateMaskTexture(renderObject))
            // White outside the cone preserves the water; black inside reveals it.
            light.blendMode = PIXI.BLEND_MODES.MULTIPLY
            mask.container.addChild(light)
            mask.lights.set(name, light)
        }
        light.position.set(x, y)
        mask.sprite.position.copyFrom(this.sprite.position)
        this.engine.app.renderer.render(mask.container, { renderTexture: mask.texture, clear: true })
    }

    private releaseUnderwaterMask() {
        const mask = this.underwaterMask
        if (!mask) return
        if (this.sprite) this.sprite.mask = null
        this.engine.rendering.removeFromStage(mask.sprite)
        mask.sprite.destroy()
        mask.texture.destroy(true)
        for (const light of mask.lights.values()) light.texture.destroy(true)
        mask.container.destroy({ children: true })
        this.underwaterMask = null
    }

    @method()
    async LOAD(path: string) {
        assert(this.sprite !== null)
        this.releaseUnderwaterMask()
        const newSprite = await this.load(path)
        this.sprite.texture = newSprite.texture
        this.sprite.x = newSprite.x
        this.sprite.y = newSprite.y
        this.sprite.hitmap = newSprite.hitmap
    }

    @method()
    INVALIDATE() {
        if (this.engine.compat.imageInvalidation) {
            // PIXI redraws each frame; LOAD has already replaced the image texture.
            return
        }
        throw new NotImplementedError()
    }

    @method()
    SETCLIPPING(x1: number, y1: number, x2: number, y2: number) {
        assert(this.sprite !== null)

        const maskGraphics = new Graphics()
        maskGraphics.beginFill(0x000000)
        maskGraphics.drawRect(x1, y1, x2 - x1, y2 - y1)
        maskGraphics.endFill()

        this.sprite.mask = maskGraphics
    }

    private generateMaskTexture(sprite: AdvancedSprite) {
        assert(sprite.hitmap !== undefined)
        const textureBytes = new Uint8Array(sprite.hitmap.length * 4)

        let newPos = 0
        for (let i = 0; i < sprite.hitmap.length; i++) {
            textureBytes[newPos++] = sprite.hitmap[i]
            textureBytes[newPos++] = sprite.hitmap[i]
            textureBytes[newPos++] = sprite.hitmap[i]
            textureBytes[newPos++] = 255
        }

        return new PIXI.Texture(PIXI.BaseTexture.fromBuffer(new Uint8Array(textureBytes), sprite.width, sprite.height))
    }

    async clone() {
        assert(this.sprite !== null)

        const spriteClone = new AdvancedSprite(this.sprite.texture)
        spriteClone.x = this.sprite.x
        spriteClone.y = this.sprite.y
        spriteClone.hitmap = this.sprite.hitmap

        const clone = (await super.clone()) as unknown as Image
        clone.sprite = spriteClone
        if (this.engine.compat.imageCloneRendering) {
            spriteClone.visible = this.sprite.visible
            spriteClone.alpha = this.sprite.alpha
            spriteClone.eventMode = 'none'
            spriteClone.name = `${this.name} clone (IMAGE)`
            clone.SETPRIORITY(this.GETPRIORITY())
            if (this.definition.TOCANVAS) this.engine.rendering.addToStage(spriteClone)
        }
        return clone
    }

    getRenderObject() {
        return this.sprite
    }
}
