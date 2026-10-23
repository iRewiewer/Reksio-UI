import { Type } from './index'
import { MouseDefinition } from '../../fileFormats/cnv/types'
import { FederatedPointerEvent, Point } from 'pixi.js'
import { NotImplementedError } from '../../common/errors'
import { method } from '../../common/types'

type MouseEvent = {
    type: string
    key: string
}

const keysMapping = new Map([
    [0, 'LEFT'],
    [1, 'MIDDLE'],
    [2, 'RIGHT'],
])

export class Mouse extends Type<MouseDefinition> {
    private mouseMoveListener: any
    private globalMouseMoveListener: any
    private mouseClickListener: any
    private mouseReleaseListener: any

    private clicksQueue: MouseEvent[] = []
    private lastClicksTime: Record<string, number> = {}

    private mousePosition: Point = new Point(0, 0)
    private moved = false
    private signalsDisabled: boolean = false
    private callbacksRegistered = false

    async ready() {
        this.registerCallbacks()
        await this.callbacks.run('ONINIT')
    }

    destroy() {
        this.unregisterCallbacks()
    }

    async tick(elapsedMS: number) {
        while (this.clicksQueue.length > 0) {
            const event = this.clicksQueue.shift()!

            if (this.signalsDisabled) {
                continue
            }

            switch (event.type) {
                case 'click':
                    await this.callbacks.run('ONCLICK', event.key)
                    break
                case 'dblclick':
                    await this.callbacks.run('ONDBLCLICK', event.key)
                    break
                case 'release':
                    await this.callbacks.run('ONRELEASE', event.key)
                    break
            }
        }

        if (this.moved && !this.signalsDisabled) {
            await this.callbacks.run('ONMOVE')
            this.moved = false
        }
    }

    @method()
    SET(cursorType: 'ACTIVE' | 'ARROW') {
        throw new NotImplementedError()
    }

    @method()
    ENABLE() {
        this.registerCallbacks()
        this.engine.app.stage.eventMode = 'static'
    }

    private registerCallbacks() {
        if (this.callbacksRegistered) {
            return
        }

        this.mouseMoveListener = this.onMouseMove.bind(this)
        this.globalMouseMoveListener = this.onMouseMove.bind(this)
        this.mouseClickListener = this.onMouseClick.bind(this)
        this.mouseReleaseListener = this.onMouseRelease.bind(this)

        this.engine.app.stage.addListener('pointermove', this.mouseMoveListener)
        this.engine.app.stage.addListener('globalpointermove', this.globalMouseMoveListener)
        if (this.callbacks.has('ONCLICK') || this.callbacks.has('ONDBLCLICK')) {
            this.engine.app.stage.addListener('pointerdown', this.mouseClickListener)
        }
        if (this.callbacks.has('ONRELEASE')) {
            this.engine.app.stage.addListener('pointerup', this.mouseReleaseListener)
        }

        this.callbacksRegistered = true
    }

    @method()
    DISABLE() {
        this.unregisterCallbacks()
        this.engine.app.stage.eventMode = 'none'
    }

    @method()
    DISABLESIGNAL() {
        this.signalsDisabled = true
    }

    @method()
    ENABLESIGNAL() {
        this.signalsDisabled = false
    }

    private unregisterCallbacks() {
        if (!this.callbacksRegistered) {
            return
        }

        this.engine.app.stage.removeListener('pointermove', this.mouseMoveListener)
        this.engine.app.stage.removeListener('globalpointermove', this.globalMouseMoveListener)
        this.engine.app.stage.removeListener('pointerdown', this.mouseClickListener)
        this.engine.app.stage.removeListener('pointerup', this.mouseReleaseListener)
        this.callbacksRegistered = false
    }

    @method()
    SHOW() {
        this.engine.rendering.setCursor('auto')
    }

    @method()
    HIDE() {
        this.engine.rendering.setCursor('none')
    }

    @method()
    GETPOSX() {
        this.engine.diagnostics.mousePosition(this, 'GETPOSX', this.mousePosition)
        return this.mousePosition.x
    }

    @method()
    GETPOSY() {
        this.engine.diagnostics.mousePosition(this, 'GETPOSY', this.mousePosition)
        return this.mousePosition.y
    }

    @method()
    SETPOSITION(x: number, y: number) {
        if (this.engine.compat.clearAnimoCacheOnLoad) {
            this.mousePosition.set(x, y)
            this.moved = true
            return
        }
        // This is kinda impossible. We would have to hide cursor and emulate it.
        throw new NotImplementedError()
    }

    private onMouseMove(event: FederatedPointerEvent) {
        this.moved = true
        this.mousePosition = this.getMousePosition(event)
        this.engine.diagnostics.mousePosition(this, 'move', this.mousePosition)
    }

    private onMouseClick(event: FederatedPointerEvent) {
        this.handleClickEvent(event, 'click')
    }

    private onMouseRelease(event: FederatedPointerEvent) {
        this.handleClickEvent(event, 'release')
    }

    private handleClickEvent(event: FederatedPointerEvent, type: string) {
        if (!keysMapping.has(event.button)) {
            return
        }

        const key = keysMapping.get(event.button)!
        const clickEvent = { type, key }

        this.clicksQueue.push(clickEvent)
        if (type === 'click') {
            const dateNow = Date.now()
            const previousClick = this.lastClicksTime[key]
            if (previousClick && dateNow - previousClick < 200) {
                this.clicksQueue.push({
                    type: 'dblclick',
                    key,
                })
                delete this.lastClicksTime[key]
            } else {
                this.lastClicksTime[key] = dateNow
            }
        }

        this.onMouseMove(event)
    }

    private getMousePosition(event: FederatedPointerEvent) {
        return new Point(Math.floor(event.screen.x), Math.floor(event.screen.y))
    }
}
