import { DisplayType, ParentType, XRayInfo } from './index'
import { AnimoDefinition } from '../../fileFormats/cnv/types'
import { Engine } from '../index'
import { assert, InvalidObjectError } from '../../common/errors'
import * as PIXI from 'pixi.js'
import { Graphics, Rectangle, Sprite, Texture } from 'pixi.js'
import { ANN, Event } from '../../fileFormats/ann'
import { ButtonLogicComponent, Event as FSMEvent, State } from '../components/button'
import { loadSound } from '../../filesystem/assetsLoader'
import { FileNotFoundError } from '../../filesystem/fileLoader'
import { AdvancedSprite, createHitmapFromImageBytes } from '../rendering'
import { method } from '../../common/types'
import { CollisionsComponent } from '../components/collisions'
import { Sound } from '../audio'
import { logger } from '../logging'

export class Animo extends DisplayType<AnimoDefinition> {
    private buttonLogic: ButtonLogicComponent
    readonly collisions: CollisionsComponent

    public isPlaying: boolean = false
    private currentFrame: number = 0
    private currentEvent: Event | null = null
    private playbackDirection: 1 | -1 = 1

    private eventEndedLastTick: Event | null = null
    private buttonInteractArea: Graphics | null = null

    private fps: number = 16
    private timeSinceLastFrame: number = 0

    private positionX: number = 0
    private positionOffsetX: number = 0
    private positionY: number = 0
    private positionOffsetY: number = 0

    public anchorOffsetX: number = 0
    public anchorOffsetY: number = 0

    private annFile: ANN | null = null
    private sprite: AdvancedSprite | null = null

    private textures = new Map<number, PIXI.Texture>()
    private hitmaps = new Map<number, Uint8Array>()
    private sounds = new Map<string, Sound>()

    public static Events = {
        ONFINISHED: 'ONFINISHED',
        ONSTARTED: 'ONSTARTED',
    }

    constructor(engine: Engine, parent: ParentType<any> | null, definition: AnimoDefinition) {
        super(engine, parent, definition)
        this.fps = definition.FPS ?? 16
        this.collisions = new CollisionsComponent(engine, this)
        this.buttonLogic = new ButtonLogicComponent(this.onButtonStateChange.bind(this))
    }

    async init() {
        this.annFile = await this.loadAnimation(this.definition.FILENAME)
    }

    async applyDefaults() {
        const existingObjectWithFilename: Animo | null = this.engine.scopeManager.find(
            (key: string, object) =>
                object != this &&
                object instanceof Animo &&
                object.definition.FILENAME === this.definition.FILENAME &&
                object.sprite != null
        )
        if (existingObjectWithFilename != null && existingObjectWithFilename.annFile != null) {
            this.annFile = existingObjectWithFilename.annFile
            this.textures = existingObjectWithFilename.textures
            this.hitmaps = existingObjectWithFilename.hitmaps
        }
        await this.initSprite()
    }

    async ready() {
        await this.callbacks.run('ONINIT')
    }

    destroy() {
        if (this.sprite !== null) {
            this.sprite.setClippingRect(null)
            this.engine.rendering.removeFromStage(this.sprite)
        }
        if (this.buttonInteractArea !== null) {
            this.buttonLogic.unregisterInteractive(this.buttonInteractArea)
            this.engine.rendering.removeFromStage(this.buttonInteractArea)
        }
        for (const sound of this.sounds.values()) {
            sound.stop()
        }
        this.sounds.clear()
    }

    async tick(elapsedMS: number) {
        await this.buttonLogic.tick()
        this.collisions.tick()

        if (!this.isPlaying) {
            return
        }

        this.timeSinceLastFrame += elapsedMS * this.engine.speed

        const frameLength = (1 / this.fps) * 1000
        while (this.isPlaying && this.timeSinceLastFrame >= frameLength) {
            await this.tickAnimation()
            this.timeSinceLastFrame -= frameLength
        }
    }

    public getDefaultEvent() {
        assert(this.annFile !== null)
        // Find first event with any frames
        const defaultEvent = this.annFile.events.find((event) => event.framesCount > 0)
        if (defaultEvent !== undefined) {
            return defaultEvent.name
        }
        return null
    }

    private async loadAnimation(path: string) {
        try {
            const relativePath = this.engine.currentScene
                ? await this.engine.currentScene.getRelativePath(path)
                : await this.engine.resolvePath(path)

            const annFile = await this.engine.filesystem.getANNFile(relativePath)
            await this.loadSfx(annFile)

            logger.debug(`ANN file '${path}' loaded successfully!`, {
                animo: this,
                annFile,
            })
            return annFile
        } catch (err) {
            if (err instanceof FileNotFoundError) {
                throw new InvalidObjectError('ANN file not found')
            }
            throw err
        }
    }

    private async loadSfx(annFile: ANN) {
        const loadSoundIfNotExists = async (filename: string) => {
            const normalizedSFXFilename = filename.toLowerCase().replace('sfx\\', '')
            const resolvedPath = await this.engine.resolvePath(normalizedSFXFilename, 'wavs/sfx')
            try {
                const sound = await loadSound(this.engine.filesystem, resolvedPath)
                this.sounds.set(filename, sound)
            } catch (err) {
                logger.warn(
                    'Failed to load sfx sound',
                    {
                        animo: this,
                        filename,
                        resolvedPath,
                    },
                    err
                )
            }
        }

        const soundsNames = new Set<string>()
        for (const event of annFile.events) {
            for (const frame of event.frames) {
                if (frame.sounds) {
                    frame.sounds.forEach((name) => soundsNames.add(name))
                }
            }
        }

        await Promise.all([...soundsNames].map(loadSoundIfNotExists))
    }

    private async initSprite() {
        assert(this.annFile !== null)

        this.sprite = new AdvancedSprite()
        this.sprite.name = `${this.name} [ANIMO]` // For PIXI Devtools
        this.sprite.eventMode = 'none'
        this.sprite.visible = this.definition.VISIBLE
        this.SETPRIORITY(this.definition.PRIORITY ?? 0)

        if (this.definition.TOCANVAS) {
            this.engine.rendering.addToStage(this.sprite)
        }

        this.currentEvent = this.getEvent(this.getDefaultEvent() ?? '')
        if (this.currentEvent) {
            await this.changeFrame(this.currentEvent, 0, false)
        }
    }

    private getTexture(imageIndex: number): Texture {
        assert(this.annFile != null)

        // Check if cached already
        if (this.textures.has(imageIndex)) {
            return this.textures.get(imageIndex)!
        }

        const baseTexture = PIXI.BaseTexture.fromBuffer(
            new Uint8Array(this.annFile.images[imageIndex]),
            this.annFile.annImages[imageIndex].width,
            this.annFile.annImages[imageIndex].height
        )

        const texture = new PIXI.Texture(baseTexture)
        this.textures.set(imageIndex, texture)
        return texture
    }

    private getHitmap(imageIndex: number): Uint8Array {
        assert(this.annFile != null)

        if (this.hitmaps.has(imageIndex)) {
            return this.hitmaps.get(imageIndex)!
        }

        const hitmap = createHitmapFromImageBytes(this.annFile.images[imageIndex])
        this.hitmaps.set(imageIndex, hitmap)
        return hitmap
    }

    private async tickAnimation() {
        assert(this.annFile !== null && this.sprite !== null)
        if (this.usesDirectedPlayback()) return this.tickDirectedAnimation()

        const event = this.currentEvent
        if (!event) {
            return
        }

        if (this.eventEndedLastTick == this.currentEvent) {
            this.eventEndedLastTick = null
            await this.STOP(true)
            return
        }

        await this.changeFrame(event, this.currentFrame)

        if (this.currentFrame === 0) {
            await this.ONSTARTED()
        }

        // Animation might get stopped in ONFRAMECHANGED callback like in UFO:S65_ZAMEK
        // If we wouldn't return there then if ONFINISHED has PLAY then it will never stop running
        // because PLAY is changing isPlaying back to true
        if (!this.isPlaying) {
            return
        }

        // Event might be changed in ONFRAMECHANGED or ONSTARTED
        // event.name might be lowercase
        if (event !== this.currentEvent) {
            return
        }

        this.playFrameSound(event)

        if (event.loopFramesEndIndex != 0 && this.currentFrame == event.loopFramesEndIndex) {
            // TODO: handle event.loopRepeatsCount
            this.currentFrame = event.loopFramesStartIndex
        } else if (this.currentFrame + 1 >= event.framesCount) {
            this.currentFrame = 0
            this.eventEndedLastTick = this.currentEvent
        } else {
            this.currentFrame++
        }
    }

    private usesDirectedPlayback() {
        return this.engine.compat.dragonAnimationPlayback && this.engine.currentScene?.name === 'DRAGON'
    }

    private async tickDirectedAnimation() {
        const event = this.currentEvent
        if (!event) return
        let frame = this.currentFrame + this.playbackDirection
        if (event.loopFramesEndIndex !== 0) {
            if (this.playbackDirection === 1 && frame > event.loopFramesEndIndex) frame = event.loopFramesStartIndex
            else if (this.playbackDirection === -1 && frame < event.loopFramesStartIndex) frame = event.loopFramesEndIndex
        }
        if (frame < 0 || frame >= event.framesCount) {
            this.isPlaying = false
            await this.ONFINISHED()
            return
        }
        this.currentFrame = frame
        await this.changeFrame(event, frame)
        if (this.isPlaying && this.currentEvent === event) this.playFrameSound(event)
    }

    private playFrameSound(event: Event) {
        const eventFrame = event.frames[this.currentFrame]
        if (eventFrame.sounds) {
            const filenames = eventFrame.sounds
            const randomFilename = filenames[Math.floor(Math.random() * filenames.length)]

            if (this.sounds.has(randomFilename)) {
                logger.debug(`Playing sound '${randomFilename}'`, {
                    animo: this,
                })
                const sound = this.sounds.get(randomFilename)!
                sound.play()
            }
        }
    }

    public syncPosition() {
        assert(this.sprite !== null)
        this.sprite.x =
            this.positionX + this.positionOffsetX - this.anchorOffsetX + this.sprite.width * this.sprite.anchor.x
        this.sprite.y =
            this.positionY + this.positionOffsetY - this.anchorOffsetY + this.sprite.height * this.sprite.anchor.y
    }

    getPatternPositionOffset() {
        assert(this.sprite !== null)
        return { x: this.positionOffsetX - this.anchorOffsetX + this.sprite.width * this.sprite.anchor.x,
            y: this.positionOffsetY - this.anchorOffsetY + this.sprite.height * this.sprite.anchor.y }
    }

    private async changeFrame(event: Event, frameIdx: number, signal = true) {
        assert(this.annFile !== null)
        assert(this.sprite !== null)
        assert(event !== null)

        const eventFrame = event.frames[frameIdx]
        if (eventFrame === undefined) {
            logger.warn(`Attempted to change to non-existent frame ${frameIdx}`, {
                animo: this,
            })
            return
        }

        const imageIndex = event.framesImageMapping[frameIdx]
        const annImage = this.annFile.annImages[imageIndex]

        this.sprite.texture = this.getTexture(imageIndex)
        this.sprite.hitmap = this.getHitmap(imageIndex)
        this.sprite.name = `${this.name} (${event.name}) (ANIMO)` // For PIXI Devtools

        this.positionOffsetX = annImage.positionX + eventFrame.positionX
        this.positionOffsetY = annImage.positionY + eventFrame.positionY
        this.sprite.width = annImage.width
        this.sprite.height = annImage.height
        this.sprite.setClippingRect(this.sprite.getClippingRect())
        this.syncPosition()

        if (this.buttonInteractArea !== null) {
            this.buttonInteractArea.hitArea = this.sprite.getBounds()
        }

        if (signal) {
            // PIKLIB tries a named-frame handler before falling back to the event's handler.
            const frameName = eventFrame.name?.toUpperCase()
            const callbackName = this.engine.compat.namedAnimationCallbacks && frameName &&
                this.callbacks.hasParametrized('ONFRAMECHANGED', frameName) ? frameName : event.name
            await this.callbacks.run('ONFRAMECHANGED', callbackName)
        }
    }

    private changeImage(imageIndex: number) {
        assert(this.annFile !== null)
        assert(this.sprite !== null)

        const annImage = this.annFile.annImages[imageIndex]
        if (annImage === undefined) {
            logger.warn(`Attempted to change to non-existent frame image ${imageIndex}`, {
                animo: this,
            })
            return
        }

        this.sprite.texture = this.getTexture(imageIndex)
        this.sprite.hitmap = this.getHitmap(imageIndex)

        this.positionOffsetX = annImage.positionX
        this.positionOffsetY = annImage.positionY
        this.sprite.width = annImage.width
        this.sprite.height = annImage.height
        this.sprite.setClippingRect(this.sprite.getClippingRect())
        this.syncPosition()

        if (this.buttonInteractArea !== null) {
            this.buttonInteractArea.hitArea = this.sprite.getBounds()
        }
    }

    @method()
    async PLAY(name?: string) {
        if (name === undefined) {
            this.SHOW()
            this.RESUME()
            return
        }

        await this.playEvent(name)
    }

    @method()
    async NPLAY(index: number) {
        if (!this.engine.compat.modernScripts) return this.__call('NPLAY', [index])
        const event = this.getAllEvents()[index]
        if (event) await this.playEvent(event.name)
    }

    async playEvent(name: string) {
        const eventExists = this.hasEvent(name.toString())
        this.engine.diagnostics.animoPlay(this, name, eventExists)

        if (!eventExists) {
            return
        }

        const event = this.getEvent(name)
        assert(event !== null)
        if (event.framesCount === 0) {
            await this.ONFINISHED()
            return
        }

        this.eventEndedLastTick = null
        this.isPlaying = true

        assert(this.sprite !== null)
        this.sprite.visible = true

        this.currentFrame = 0
        this.currentEvent = this.getEvent(name)

        // Animation could be paused before next tick, and it wouldn't render new frame
        // Tick animation so that it's not signaling twice for 0 frame
        // + it has to call ONSTARTED instantly
        if (this.usesDirectedPlayback()) {
            await this.changeFrame(event, 0)
            await this.ONSTARTED()
            if (this.isPlaying && this.currentEvent === event) this.playFrameSound(event)
        } else {
            await this.tickAnimation()
        }
        this.engine.diagnostics.displayState(this, `PLAY:${name}`)
    }

    private async forceRender() {
        assert(this.currentEvent !== null)
        await this.changeFrame(this.currentEvent, this.currentFrame, true)
    }

    private async ONFINISHED() {
        assert(this.currentEvent !== null)
        const index = this.currentEvent.name.toUpperCase()
        this.engine.diagnostics.animoFinished(this, index)
        await this.callbacks.run('ONFINISHED', index)
        await this.events?.trigger('ONFINISHED', index)
    }

    private async ONSTARTED() {
        assert(this.currentEvent !== null)
        const index = this.currentEvent.name.toUpperCase()
        await this.callbacks.run('ONSTARTED', index)
        await this.events?.trigger('ONSTARTED', index)
    }

    @method()
    async SIGNAL(name: string) {
        await this.callbacks.run('ONSIGNAL', name.toUpperCase())
        await this.events?.trigger('ONSIGNAL', name.toUpperCase())
    }

    // For some reason there is sometimes a string passed
    @method()
    async STOP(shouldSignal?: boolean | string) {
        this.isPlaying = false
        this.currentFrame = 0
        if (shouldSignal !== false) {
            await this.ONFINISHED()
        }
    }

    @method()
    PAUSE() {
        this.isPlaying = false
    }

    @method()
    RESUME() {
        this.isPlaying = true
    }

    @method()
    SETFORWARD() {
        if (!this.usesDirectedPlayback()) return this.__call('SETFORWARD', [])
        this.playbackDirection = 1
    }

    @method()
    SETBACKWARD() {
        if (!this.usesDirectedPlayback()) return this.__call('SETBACKWARD', [])
        this.playbackDirection = -1
    }

    @method()
    SETANCHOR(anchor: string) {
        assert(this.sprite !== null)

        switch (anchor) {
            case 'CENTER':
                this.anchorOffsetX = this.positionOffsetX + Math.round(this.sprite.width / 2)
                this.anchorOffsetY = this.positionOffsetY + Math.round(this.sprite.height / 2)
                break
            case 'LEFTUPPER':
                this.anchorOffsetX = this.positionOffsetX
                this.anchorOffsetY = this.positionOffsetY
                break
            case 'LEFTLOWER':
                this.anchorOffsetX = this.positionOffsetX
                this.anchorOffsetY = this.positionOffsetY + this.sprite.height
                break
            case 'RIGHTUPPER':
                this.anchorOffsetX = this.positionOffsetX + this.sprite.width
                this.anchorOffsetY = this.positionOffsetY
                break
            case 'RIGHTLOWER':
                this.anchorOffsetX = this.positionOffsetX + this.sprite.width
                this.anchorOffsetY = this.positionOffsetY + this.sprite.height
                break
            default:
                logger.warn('Invalid anchor specifier - resetting anchor values.', {
                    animo: this,
                })
                this.anchorOffsetX = 0
                this.anchorOffsetY = 0
                break
        }
    }

    @method()
    async SETFRAME(eventNameOrFrameIdx: string | number, frameIdx?: number) {
        if (frameIdx === undefined) {
            const imageIndex = Number(eventNameOrFrameIdx)
            assert(!Number.isNaN(imageIndex))
            this.changeImage(imageIndex)
            return
        }

        let newEventFrame = Number(frameIdx)
        let event: Event | null
        if (this.engine.compat.nativeFrameSelection) {
            assert(this.annFile !== null)
            // PIKLIB uses event indexes for numeric arguments and event zero for unknown names.
            event = typeof eventNameOrFrameIdx === 'number'
                ? eventNameOrFrameIdx === -1 ? this.currentEvent : this.annFile.events[eventNameOrFrameIdx] ?? null
                : this.getEvent(eventNameOrFrameIdx) ?? this.annFile.events[0] ?? null
            if (!event) return
            if (newEventFrame === -1) newEventFrame = 0
        } else {
            event = this.getEvent(eventNameOrFrameIdx.toString())
        }
        assert(event !== null)

        // Necessary in S63_OBOZ
        if (newEventFrame < event.framesCount &&
            (!this.engine.compat.nativeFrameSelection || newEventFrame >= 0)) {
            this.currentEvent = event
            this.currentFrame = newEventFrame

            // Force render because some animations might not be playing,
            // but they display something (like a keypad screen in S73_0_KOD in UFO)
            await this.forceRender()
        }
    }

    @method()
    async NEXTFRAME() {
        if (!this.engine.compat.manualAnimationFrames) return this.__call('NEXTFRAME', [])
        await this.stepManualFrame(1)
    }

    @method()
    async PREVFRAME() {
        if (!this.engine.compat.manualAnimationFrames) return this.__call('PREVFRAME', [])
        await this.stepManualFrame(-1)
    }

    private async stepManualFrame(direction: number) {
        if (!this.currentEvent || this.currentEvent.framesCount === 0) return
        const frame = Math.max(0, Math.min(this.currentEvent.framesCount - 1, this.currentFrame + direction))
        await this.SETFRAME(this.currentEvent.name, frame)
    }

    @method()
    SETFPS(fps: number) {
        this.fps = fps
    }

    @method()
    SETCLIPPING(x1: number, y1: number, x2: number, y2: number) {
        if (!this.engine.compat.animationClipping) return this.__call('SETCLIPPING', [x1, y1, x2, y2])
        assert(this.sprite !== null)
        this.sprite.setClippingRect(new Rectangle(x1, y1, x2 - x1, y2 - y1))
    }

    @method()
    SHOW() {
        assert(this.sprite !== null)
        this.sprite.visible = true
        this.engine.diagnostics.displayState(this, 'SHOW')
    }

    @method()
    HIDE() {
        assert(this.sprite !== null)
        this.sprite.visible = false
        this.engine.diagnostics.displayState(this, 'HIDE')
    }

    @method()
    ISVISIBLE() {
        assert(this.sprite !== null)
        return this.sprite.visible
    }

    @method()
    async MOVE(xOffset: number, yOffset: number) {
        assert(this.sprite !== null)

        this.positionX += Math.floor(xOffset)
        this.positionY += Math.floor(yOffset)
        this.syncPosition()
        await this.onMove()
    }

    @method()
    async SETPOSITION(x: number, y: number) {
        assert(this.sprite !== null)

        this.positionX = Math.floor(x)
        this.positionY = Math.floor(y)
        this.syncPosition()
        this.engine.diagnostics.displayState(this, 'SETPOSITION')
        await this.onMove()
    }

    @method()
    async SETASBUTTON(enabled: boolean, showPointer: boolean) {
        assert(this.sprite !== null)
        if (enabled) {
            if (this.buttonInteractArea === null) {
                this.buttonInteractArea = new Graphics()
                this.engine.rendering.addToStage(this.buttonInteractArea)
                this.buttonLogic.registerInteractive(this.buttonInteractArea, showPointer)
            }

            this.buttonInteractArea.name = `${this.name} (ANIMO Button)` // For PIXI Devtools
            this.buttonInteractArea.hitArea = this.sprite.getBounds()
            this.buttonInteractArea.zIndex = this.sprite.zIndex

            await this.buttonLogic.enable()
            await this.playEvent('ONNOEVENT')
        } else {
            if (this.buttonInteractArea) {
                this.buttonLogic.unregisterInteractive(this.buttonInteractArea)
                this.engine.rendering.removeFromStage(this.buttonInteractArea)
                this.buttonInteractArea = null
            }
            await this.buttonLogic?.disable()
        }
    }

    @method()
    async DISABLE() {
        await this.buttonLogic.disable() // not sure
    }

    private async onButtonStateChange(prevState: State, event: FSMEvent, newState: State) {
        const playEventIfExists = async (eventName: string) => {
            if (this.hasEvent(eventName)) {
                await this.playEvent(eventName)
            } else if (this.hasEvent('PLAY')) {
                await this.playEvent('PLAY')
            }
        }

        switch (newState) {
            case State.HOVERED:
                await playEventIfExists('ONFOCUSON')
                await this.callbacks.run(event === FSMEvent.UP ? 'ONRELEASE' : 'ONFOCUSON')
                break
            case State.STANDARD:
                if (event === FSMEvent.ENABLE) {
                    await playEventIfExists('ONNOEVENT')
                } else {
                    await playEventIfExists('ONFOCUSOFF')
                    await this.callbacks.run('ONFOCUSOFF')
                }
                break
            case State.PRESSED:
                await playEventIfExists('ONCLICK')
                await this.callbacks.run('ONCLICKED')
                await this.callbacks.run('ONCLICK')
                break
        }
    }

    @method()
    ISAT(x: number, y: number, checkAlpha: boolean = false) {
        if (!this.engine.compat.animationHitTests) return this.__call('ISAT', [x, y, checkAlpha])
        if (!this.sprite) return false
        this.sprite.toGlobal(new PIXI.Point())
        const point = new PIXI.Point(x, y)
        // Check half-open image bounds before alpha lookup, independent of visibility or button hit testing.
        return Sprite.prototype.containsPoint.call(this.sprite, point) &&
            (!checkAlpha || this.sprite.getAlphaAt(point) > 0)
    }

    @method()
    GETCENTERX(): number {
        assert(this.sprite !== null)
        if (this.engine.compat.animationTransforms) return Math.round(this.getTransformedCenter().x)
        return Math.round(this.sprite.getGlobalPosition().x + this.sprite.width / 2)
    }

    @method()
    GETCENTERY(): number {
        assert(this.sprite !== null)
        if (this.engine.compat.animationTransforms) return Math.round(this.getTransformedCenter().y)
        return Math.round(this.sprite.getGlobalPosition().y + this.sprite.height / 2)
    }

    private getTransformedCenter() {
        assert(this.sprite !== null)
        const { anchor, texture } = this.sprite
        return this.sprite.toGlobal(new PIXI.Point((0.5 - anchor.x) * texture.orig.width,
            (0.5 - anchor.y) * texture.orig.height))
    }

    @method()
    GETPOSITIONX(): number {
        assert(this.sprite !== null)
        return this.sprite.getGlobalPosition().x
    }

    @method()
    GETPOSITIONY(): number {
        assert(this.sprite !== null)
        return this.sprite.getGlobalPosition().y
    }

    @method()
    GETFRAMENAME(frameID?: string | number, iFrameNo?: number): string {
        assert(this.currentEvent !== null)

        if (frameID === undefined && iFrameNo === undefined) {
            return this.currentEvent.frames[this.currentFrame].name
        }

        assert(frameID !== undefined && iFrameNo !== undefined)
        assert(this.annFile !== null)

        const event = typeof frameID === 'string' ? this.getEvent(frameID) : this.annFile.events[frameID]
        assert(event !== null)
        return event?.frames[iFrameNo].name
    }

    @method()
    GETMAXWIDTH(): number {
        assert(this.annFile !== null)
        return Math.max(...this.annFile.annImages.map((e) => e.width))
    }

    @method()
    GETNOFINEVENT(eventName?: string | number): number {
        if (this.engine.compat.nativeFrameSelection && typeof eventName === 'number') {
            assert(this.annFile !== null)
            const event = eventName === -1 ? this.currentEvent : this.annFile.events[eventName]
            return event?.framesCount ?? 0
        }
        if (this.engine.compat.modernScripts && eventName !== undefined) {
            return this.getEvent(eventName.toString())?.framesCount ?? 0
        }
        assert(this.currentEvent !== null)
        return this.currentEvent.framesCount
    }

    @method()
    GETEVENTNAME(eventIndex?: number): string {
        if (eventIndex === undefined) {
            assert(this.currentEvent !== null)
            return this.currentEvent.name.toUpperCase()
        } else {
            const event = this.getAllEvents()[eventIndex]
            assert(event !== undefined)
            return event.name.toUpperCase()
        }
    }

    @method()
    GETFRAME(): number {
        assert(this.currentEvent !== null)
        return this.currentEvent.framesImageMapping[this.currentFrame]
    }

    @method()
    GETCFRAMEINEVENT(): number {
        return this.currentFrame
    }

    @method()
    GETNOF(): number {
        assert(this.annFile !== null)
        return this.annFile.header.framesCount
    }

    @method()
    GETNOE(): number {
        assert(this.annFile !== null)
        return this.annFile.events.length
    }

    @method()
    GETCURRFRAMEPOSX(): number {
        assert(this.currentEvent !== null)
        return this.currentEvent.frames[this.currentFrame].positionX
    }

    @method()
    GETCURRFRAMEPOSY(): number {
        assert(this.currentEvent !== null)
        return this.currentEvent.frames[this.currentFrame].positionY
    }

    @method()
    ISPLAYING(animName?: string) {
        assert(this.currentEvent !== null)
        return this.isPlaying && (animName === undefined || this.currentEvent.name.toUpperCase() == animName)
    }

    @method()
    ISNEAR(objectName: string, percentage: number) {
        const otherObject = this.getObject(objectName)
        if (otherObject === null || !(otherObject instanceof DisplayType)) {
            return false
        }

        const otherSprite: Sprite | null = otherObject.getRenderObject()
        assert(otherSprite !== null)

        const thisSprite: Sprite | null = this.getRenderObject()
        assert(thisSprite !== null)

        const boundsThis = thisSprite.getBounds()
        const boundsOther = otherSprite.getBounds()

        const x1 = Math.max(boundsThis.x, boundsOther.x)
        const y1 = Math.max(boundsThis.y, boundsOther.y)
        const x2 = Math.min(boundsThis.x + boundsThis.width, boundsOther.x + boundsOther.width)
        const y2 = Math.min(boundsThis.y + boundsThis.height, boundsOther.y + boundsOther.height)

        const intersectionWidth = Math.max(0, x2 - x1)
        const intersectionHeight = Math.max(0, y2 - y1)
        const intersectionArea = intersectionWidth * intersectionHeight

        const areaThis = boundsThis.width * boundsThis.height
        const val = intersectionArea / areaThis
        return val * 100 > percentage
    }

    @method()
    ADDBEHAVIOUR(callbackString: string, behaviourName: string) {
        this.callbacks.addBehaviour(callbackString, behaviourName)
    }

    @method()
    MONITORCOLLISION(newState?: boolean) {
        this.collisions.enabled = true
    }

    @method()
    MONITORCOLLISIONS(newState?: boolean) {
        this.MONITORCOLLISION(newState ?? true)
    }

    @method()
    REMOVEMONITORCOLLISION() {
        this.collisions.enabled = false
    }

    @method()
    SETOPACITY(opacity: number) {
        assert(this.sprite !== null)
        this.sprite.alpha = opacity / 255
    }

    @method()
    async LOAD(path: string) {
        this.destroy()
        if (this.engine.compat.clearAnimoCacheOnLoad) {
            this.textures = new Map()
            this.hitmaps = new Map()
        }
        this.annFile = await this.loadAnimation(path)
        await this.initSprite()
    }

    // Only triggered on explicit position change
    // Animation offset change doesn't trigger it
    private async onMove() {
        await this.collisions.handle(async (object: Animo) => {
            await this.callbacks.run('ONCOLLISION', object.name)
        })
    }

    public getEvent(name: string): Event | null {
        assert(this.annFile !== null)
        return this.annFile.events.find((event) => event.name.toUpperCase() === name.toUpperCase()) ?? null
    }

    public hasEvent(name: string): boolean {
        return this.getEvent(name) !== null
    }

    public getAllEvents(): Event[] {
        assert(this.annFile !== null)
        return this.annFile.events
    }

    getRenderObject() {
        return this.sprite
    }

    async clone() {
        const clone = (await super.clone()) as Animo
        clone.isPlaying = this.isPlaying
        clone.currentFrame = this.currentFrame
        clone.currentEvent = this.currentEvent
        clone.playbackDirection = this.playbackDirection
        clone.annFile = this.annFile
        clone.textures = this.textures
        clone.sounds = this.sounds

        clone.fps = this.fps
        clone.positionX = this.positionX
        clone.positionOffsetX = this.positionOffsetX
        clone.positionY = this.positionY
        clone.positionOffsetY = this.positionOffsetY
        clone.anchorOffsetX = this.anchorOffsetX
        clone.anchorOffsetY = this.anchorOffsetY

        await clone.initSprite()
        clone.sprite!.visible = this.sprite!.visible
        clone.sprite!.setClippingRect(this.sprite!.getClippingRect())
        if (this.engine.compat.animationCloneRendering) {
            // Native clones join the canvas even when their template was not registered.
            clone.SETPRIORITY(this.sprite!.parent ? this.GETPRIORITY() : 0)
            if (!clone.sprite!.parent) this.engine.rendering.addToStage(clone.sprite!)
        }
        return clone
    }

    __getXRayInfo(): XRayInfo | null {
        if (this.buttonInteractArea) {
            return {
                type: 'button',
                bounds: this.buttonInteractArea.hitArea as Rectangle,
                color: this.buttonLogic.enabled ? 0x00ff00 : 0x0000ff,
                position: 'outside',
                visible: this.buttonLogic.state != State.DISABLED,
            }
        } else if (this.sprite?.visible) {
            return {
                type: 'sprite',
                bounds: this.sprite.getBounds(),
                position: 'inside',
                visible: this.sprite.visible,
            }
        }
        return null
    }
}
