import { ParentType, Type } from './index'
import { KeyboardDefinition } from '../../fileFormats/cnv/types'
import { Engine } from '../index'
import { method } from '../../common/types'
import { logger } from '../logging'

const keysMapping = {
    ArrowLeft: 'LEFT',
    ArrowRight: 'RIGHT',
    ArrowUp: 'UP',
    ArrowDown: 'DOWN',
    Space: 'SPACE',
    Digit1: '1',
    Digit2: '2',
} as any

type KeyState = { name: string; state: boolean }
type KeyChange = KeyState | { character: string }

export class Keyboard extends Type<KeyboardDefinition> {
    private keysState = new Map<string, boolean>()
    private changeQueue: KeyChange[] = []
    private enabled: boolean = true
    private autoRepeat: boolean = false

    private readonly onKeyDownCallback: (event: KeyboardEvent) => void
    private readonly onKeyUpCallback: (event: KeyboardEvent) => void

    constructor(engine: Engine, parent: ParentType<any> | null, definition: KeyboardDefinition) {
        super(engine, parent, definition)
        this.onKeyDownCallback = this.onKeyDown.bind(this)
        this.onKeyUpCallback = this.onKeyUp.bind(this)
    }

    async ready() {
        window.addEventListener('keydown', this.onKeyDownCallback)
        window.addEventListener('keyup', this.onKeyUpCallback)
    }

    destroy() {
        window.removeEventListener('keydown', this.onKeyDownCallback)
        window.removeEventListener('keyup', this.onKeyUpCallback)
    }

    async tick() {
        for (const change of this.changeQueue) {
            if ('character' in change) {
                if (this.enabled) await this.callbacks.run('ONCHAR', change.character)
            } else if (change.state) {
                await this.callbacks.run('ONKEYDOWN', change.name)
            } else {
                await this.callbacks.run('ONKEYUP', change.name)
            }
        }
        this.changeQueue = []
    }

    @method()
    DISABLE() {
        this.enabled = false
    }

    @method()
    ENABLE() {
        if (!this.engine.compat.modernScripts) return this.__call('ENABLE', [])
        this.enabled = true
    }

    @method()
    ISKEYDOWN(keyName: string) {
        if (this.keysState.has(keyName)) {
            return this.keysState.get(keyName)!
        }
        return false
    }

    @method()
    ISENABLED() {
        return this.enabled
    }

    @method()
    SETAUTOREPEAT(state: boolean) {
        this.autoRepeat = state
    }

    private onKeyDown(event: KeyboardEvent) {
        if (!this.autoRepeat && this.keysState.get(this.getKeyName(event.code))) {
            return
        }

        if (this.enabled) {
            this.setKeyState(event.code, true)
            if (this.engine.compat.keyboardCharacters && !event.ctrlKey && !event.altKey && !event.metaKey) {
                // Native character events preserve letter case and use unshifted top-row digits.
                const character = /^Digit(\d)$/.exec(event.code)?.[1] ?? event.key
                if (character?.length === 1) this.changeQueue.push({ character })
            }
        }
    }

    private onKeyUp(event: KeyboardEvent) {
        if (this.enabled) {
            this.setKeyState(event.code, false)
        }
    }

    private setKeyState(keyCode: string, value: boolean) {
        const mapped = this.getKeyName(keyCode)
        if (this.engine.compat.underwaterPhysics) this.engine.diagnostics.keyboardState(mapped ?? keyCode, value)
        if (!mapped) {
            logger.warn(`Unsupported keyboard key code ${keyCode}`, {
                supportedKeys: Object.keys(keysMapping),
            })
        }
        this.keysState.set(mapped, value)
        this.changeQueue.push({ name: mapped, state: value })
    }

    private getKeyName(code: string) {
        return keysMapping[code] ?? (this.engine.compat.keyboardCharacters
            ? /^(?:Digit(\d)|Key([A-Z]))$/.exec(code)?.slice(1).find(Boolean) : undefined)
    }
}
