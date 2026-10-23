import type { Engine } from './index'
import type { Type } from './types'

const RELATED_SCENES: Record<string, string[]> = {
    CIEMNOSC: ['16BLAWA', 'CIEMNOSC'],
    LASER: ['24LASER'],
}

const KEY_VALUES = new Set([
    'VAR_AKCJA', 'G_IREADY', 'G_SSCENENAME', 'SGSCENENAME', 'S_BFIRSTINTRO',
    'CZYEKRAN',
    'EKRANACTIVE',
    'INT_DRZWI',
    'INT_POCHODNIA',
    'INT_Z_JAKIEJ_PLANSZY',
    'KALIBRACJAX',
    'KALIBRACJAY',
    'KAMIENROZWALANY',
    'N',
    'G_SARCADEOBJECTS',
    'G_SLASTOBJECTS',
    'RANDOMX',
    'RANDOMY',
    'S_IHILLNUMBER',
    'STOP_16_REKS',
    'VARBSEQPLAYING',
    'VARBSEQSTOPABLE',
    'VARBLOCKSCENE',
    'VARICURRENTHILL',
    'VARIFIRSTENTER',
    'VARIMAXPRIORITY',
    'VARINEXTPRIORITY',
    'VARINEXTTRIGGER',
    'VARINUMHILLS',
    'VARIPATHID',
    'VARIITER',
    'VARITRIGGERTYPE',
    'VARITEMP0',
    'VARITEMP1',
    'VARITEMP2',
    'VARSAUXCLICKED',
    'VARSLASTFOCUS',
    'VARSLASTFOCUSON',
    'VARDTEMP0',
    'VARDTEMP1',
    'VARDTEMP2',
    'VARIBKGOFFSETX',
    'VARIBKGOFFSETY',
    'POZYCJAWULKAN',
    'POZYCJAREKSIA',
    'SAVEROZDZIAL6',
    'WGLAB',
    'WIN',
])

const KEY_OBJECT_PATTERN =
    /^(REKSIO16|REKSIO17[A-F]|BUT_DRZWI|BUT_POCHODNIA|BUT_PRZEJSCIE|17BEZPOCH|BEH_|BEHINITHILLS\d+|BEHPOSITIONHILLS|BEHMOVEHILL|BEHENTERREKS|BEHENTERRABBIT|COND_|INT_DRZWI|INT_POCHODNIA|INT_Z_JAKIEJ_PLANSZY|STOP_16_REKS|ANNHILL\d+|ANNREX\d+|ANNREX|ANNKRET|ANNOBJECT\d+|ANNRABBIT\d+|ANNRABBITBEHIND|ANNREXSAD|IMGOVER\d+|ARRPRIORITY|ARRPOSITION|ARRMOVEMENT|POZYCJAWULKAN|POZYCJAREKSIA|SAVEROZDZIAL6|BUTEKRANU|MOUSE|WPATH|CANVASOBSERVER|CANVAS_OBSERVER|DBOBJECTS|SOBJECT|STRZAL|TIMERSTRZALU|POCZGRY|WLACZCELOWNIK|WYLACZCELOWNIK|STRZEL|DISABLETIMERSTRZALU|PRZESUNIECIEBEH|PRZESUNIECIEBEH2|PRZESUNIECIEBEH3|COMBOCEL|BLOKX|BLOKY|BLOKXMAX|BLOKXMIN|BLOKYMAX|BLOKYMIN|JUZGRAMY|CZYEKRAN|EKRANACTIVE|KALIBRACJAX|KALIBRACJAY|RANDOMX|RANDOMY|G_SARCADEOBJECTS|G_SLASTOBJECTS|S_IHILLNUMBER|VARBSEQPLAYING|VARBSEQSTOPABLE|VARBLOCKSCENE|VARICURRENTHILL|VARIFIRSTENTER|VARIMAXPRIORITY|VARINEXTPRIORITY|VARINEXTTRIGGER|VARINUMHILLS|VARIPATHID|VARIITER|VARITRIGGERTYPE|VARITEMP0|VARITEMP1|VARITEMP2|VARSAUXCLICKED|VARSLASTFOCUS|VARSLASTFOCUSON|VARDTEMP0|VARDTEMP1|VARDTEMP2|VARIBKGOFFSETX|VARIBKGOFFSETY|XEXPRES|YEXPRES|KAMIENROZWALANY|WGLAB|N|WIN)/

export class EngineDiagnostics {
    private readonly traceScene: string

    constructor(
        private readonly engine: Engine,
        public readonly enabled: boolean,
        traceScene?: string
    ) {
        this.traceScene = (traceScene || '*').toUpperCase()
    }

    sceneChanging(nextScene: string, previousScene?: string) {
        if (!this.isSceneRelevant(nextScene)) {
            return
        }

        this.write('scene-changing', {
            from: previousScene || null,
            to: nextScene,
        })
    }

    async sceneReady() {
        if (!this.isCurrentSceneRelevant()) {
            return
        }

        await this.snapshot('ready')
        window.setTimeout(() => void this.snapshot('after-2s'), 2000)
    }

    callback(object: Type<any>, type: string, param?: any) {
        if (!this.shouldTraceObject(object)) {
            return
        }

        this.write('callback', {
            object: object.name,
            objectType: object.definition.TYPE,
            type,
            param: param ?? null,
        })
    }

    behaviour(object: Type<any>, mode: string, shouldRun?: boolean) {
        if (!this.shouldTraceObject(object)) {
            return
        }

        this.write('behaviour', {
            name: object.name,
            mode,
            shouldRun: shouldRun ?? null,
        })
    }

    scriptStatement(caller: Type<any> | null, statement: any, script: string) {
        if (!caller || !this.shouldTraceObject(caller)) {
            return
        }

        this.write('statement', {
            caller: caller.name,
            callerType: caller.definition.TYPE,
            statementType: statement.type,
            text:
                typeof statement.start === 'number' && typeof statement.end === 'number'
                    ? script.substring(statement.start, statement.end)
                    : null,
        })
    }

    objectLookup(caller: Type<any> | null, name: string, found: boolean) {
        if (!this.isCurrentSceneRelevant()) {
            return
        }

        if (!caller || (!this.shouldTraceObject(caller) && !KEY_OBJECT_PATTERN.test(name))) {
            return
        }

        this.write('object-lookup', {
            caller: caller.name,
            name,
            found,
        })
    }

    condition(object: Type<any>, operand1: any, operator: string, operand2: any, result: boolean) {
        if (!this.shouldTraceObject(object)) {
            return
        }

        this.write('condition', {
            name: object.name,
            operand1: this.valueToString(operand1),
            operator,
            operand2: this.valueToString(operand2),
            result,
        })
    }

    animoPlay(object: Type<any>, eventName: string, hasEvent: boolean) {
        if (!this.shouldTraceObject(object)) {
            return
        }

        this.write('animo-play', {
            name: object.name,
            event: eventName,
            hasEvent,
        })
    }

    animoFinished(object: Type<any>, eventName: string) {
        if (!this.shouldTraceObject(object)) {
            return
        }

        this.write('animo-finished', {
            name: object.name,
            event: eventName,
        })
    }

    buttonState(object: Type<any>, event: string, previousState: string, nextState: string) {
        if (!this.shouldTraceObject(object)) {
            return
        }

        this.write('button-state', {
            name: object.name,
            event,
            previousState,
            nextState,
        })
    }

    displayState(object: Type<any>, action: string) {
        if (!this.shouldTraceObject(object)) {
            return
        }

        const anyObject = object as any
        const renderObject = typeof anyObject.getRenderObject === 'function' ? anyObject.getRenderObject() : null

        this.write('display', {
            name: object.name,
            action,
            visible: renderObject ? Boolean(renderObject.visible) : null,
            playing: Boolean(anyObject.isPlaying),
            event: anyObject.currentEvent?.name ?? null,
            frame: anyObject.currentFrame ?? null,
            x: renderObject ? Math.round(renderObject.x) : null,
            y: renderObject ? Math.round(renderObject.y) : null,
            globalX: renderObject ? Math.round(renderObject.getGlobalPosition().x) : null,
            globalY: renderObject ? Math.round(renderObject.getGlobalPosition().y) : null,
            width: renderObject ? Math.round(renderObject.width) : null,
            height: renderObject ? Math.round(renderObject.height) : null,
            priority: typeof anyObject.GETPRIORITY === 'function' ? anyObject.GETPRIORITY() : null,
            zIndex: renderObject ? renderObject.zIndex : null,
            stageIndex: renderObject?.parent ? renderObject.parent.children.indexOf(renderObject) : null,
        })
    }

    worldState(object: Type<any>, action: string, bodyId: number | null, state: Record<string, unknown>) {
        if (!this.shouldTraceObject(object)) {
            return
        }

        this.write('world', {
            name: object.name,
            action,
            bodyId,
            ...state,
        })
    }

    mousePosition(object: Type<any>, action: string, position: { x: number; y: number }) {
        if (!this.shouldTraceObject(object)) {
            return
        }

        this.write('mouse', {
            name: object.name,
            action,
            x: Math.round(position.x),
            y: Math.round(position.y),
        })
    }

    timerState(object: Type<any>, action: string, enabled: boolean, currentTick: number) {
        if (!this.shouldTraceObject(object)) {
            return
        }

        this.write('timer', {
            name: object.name,
            action,
            enabled,
            currentTick,
        })
    }

    valueChanged(object: Type<any>, oldValue: any, newValue: any) {
        if (!this.enabled || !KEY_VALUES.has(object.name)) {
            return
        }

        this.write('value', {
            name: object.name,
            oldValue: this.valueToString(oldValue),
            newValue: this.valueToString(newValue),
            scene: this.engine.currentScene?.name ?? null,
        })
    }

    private async snapshot(label: string) {
        const scene = this.engine.currentScene
        const scope = scene?.scope
        if (!scene || !scope) {
            return
        }

        const values: Record<string, unknown> = {}
        const animos: unknown[] = []
        const buttons: unknown[] = []

        for (const object of scope.objects) {
            const anyObject = object as any

            if (KEY_VALUES.has(object.name) && typeof anyObject.getValue === 'function') {
                try {
                    values[object.name] = this.valueToString(await anyObject.getValue())
                } catch {
                    values[object.name] = '<read failed>'
                }
            }

            if (object.definition.TYPE === 'ANIMO') {
                const renderObject = typeof anyObject.getRenderObject === 'function' ? anyObject.getRenderObject() : null
                animos.push({
                    name: object.name,
                    visible: Boolean(renderObject?.visible),
                    playing: Boolean(anyObject.isPlaying),
                    event: anyObject.currentEvent?.name ?? null,
                    frame: anyObject.currentFrame ?? null,
                    x: renderObject ? Math.round(renderObject.x) : null,
                    y: renderObject ? Math.round(renderObject.y) : null,
                    width: renderObject ? Math.round(renderObject.width) : null,
                    height: renderObject ? Math.round(renderObject.height) : null,
                })
            }

            if (object.definition.TYPE === 'ANIMO' && object.name === 'STRZAL') {
                const renderObject = typeof anyObject.getRenderObject === 'function' ? anyObject.getRenderObject() : null
                animos.push({
                    name: object.name,
                    visible: Boolean(renderObject?.visible),
                    playing: Boolean(anyObject.isPlaying),
                    event: anyObject.currentEvent?.name ?? null,
                    frame: anyObject.currentFrame ?? null,
                    x: renderObject ? Math.round(renderObject.x) : null,
                    y: renderObject ? Math.round(renderObject.y) : null,
                    globalX: renderObject ? Math.round(renderObject.getGlobalPosition().x) : null,
                    globalY: renderObject ? Math.round(renderObject.getGlobalPosition().y) : null,
                    width: renderObject ? Math.round(renderObject.width) : null,
                    height: renderObject ? Math.round(renderObject.height) : null,
                })
            }

            if (object.definition.TYPE === 'BUTTON' && object.name.startsWith('BUT_DRZWI')) {
                const logic = anyObject.logic
                const rect = anyObject.rect
                buttons.push({
                    name: object.name,
                    state: logic?.state ?? null,
                    enabled: logic?.enabled ?? null,
                    rect: rect
                        ? {
                              x: Math.round(rect.x),
                              y: Math.round(rect.y),
                              width: Math.round(rect.width),
                              height: Math.round(rect.height),
                          }
                        : null,
                })
            }

            if (object.definition.TYPE === 'BUTTON' && object.name === 'BUTEKRANU') {
                const logic = anyObject.logic
                const rect = anyObject.rect
                buttons.push({
                    name: object.name,
                    state: logic?.state ?? null,
                    enabled: logic?.enabled ?? null,
                    rect: rect
                        ? {
                              x: Math.round(rect.x),
                              y: Math.round(rect.y),
                              width: Math.round(rect.width),
                              height: Math.round(rect.height),
                          }
                        : null,
                })
            }
        }

        this.write('snapshot', {
            label,
            scene: scene.name,
            values,
            animos,
            buttons,
        })
    }

    private shouldTraceObject(object: Type<any>) {
        if (!this.isCurrentSceneRelevant()) {
            return false
        }

        return KEY_OBJECT_PATTERN.test(object.name)
    }

    private isCurrentSceneRelevant() {
        return this.isSceneRelevant(this.engine.currentScene?.name)
    }

    private isSceneRelevant(sceneName?: string | null) {
        if (!this.enabled) {
            return false
        }

        if (this.traceScene === '*') {
            return true
        }

        const normalized = (sceneName || '').toUpperCase()
        const scenes = RELATED_SCENES[this.traceScene] ?? [this.traceScene]
        return scenes.includes(normalized)
    }

    private valueToString(value: any): unknown {
        if (value === null || value === undefined) {
            return value
        }

        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            return value
        }

        if (Array.isArray(value)) {
            return `[${value.map((entry) => this.valueToString(entry)).join(',')}]`
        }

        return String(value)
    }

    private write(kind: string, payload: Record<string, unknown>) {
        if (!this.enabled) {
            return
        }

        console.info(`[trace:${kind}] ${JSON.stringify(payload)}`)
    }
}
