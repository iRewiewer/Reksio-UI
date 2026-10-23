import { Engine } from './engine'
import * as PIXI from 'pixi.js'
import { FileLoader } from './filesystem/fileLoader'
import { SaveFile, SaveFileManager } from './engine/saveFile'
import { FileStorage } from './filesystem/fileStorage'
import type { CompatProfile } from './engine/compat'
import type { SceneCheckpoint } from './engine/checkpoint'
export * as FileLoaders from './filesystem/fileLoader'
export { SaveFile, SaveFileManager, createSaveFileLocalStorageHandler } from './engine/saveFile'
export { FileStorage, IndexedDBStorage } from './filesystem/fileStorage'

export const BUILD_VARS = {
    manualTick: process.env.manualTick as unknown as boolean,
    debug: process.env.debug as unknown as boolean,
    buildTime: process.env.buildTime as unknown as string,
}

export type GamePlayerOptions = {
    fileLoader: FileLoader
    storage: FileStorage
    startScene?: string
    startSceneObject?: string
    saveFile?: SaveFile
    debug?: boolean
    trace?: boolean
    traceScene?: string
    compatProfile?: CompatProfile | string
    checkpointsEnabled?: boolean
    checkpoint?: SceneCheckpoint
    debugContainer?: HTMLElement | null
    onExit?: () => void
    onSceneChange?: (next: string, previous?: string) => void
    onSaveFileUpdate?: (saveFile: SaveFile) => void
}

export class GamePlayerInstance {
    constructor(private engine: Engine) {}

    start() {
        return this.engine.start()
    }

    async restart(extraOptions?: Partial<GamePlayerOptions>) {
        const view = this.engine.app.view as HTMLCanvasElement
        await this.engine.stopForRestart()
        this.destroy()
        const app = new PIXI.Application()
        view.replaceWith(app.view as HTMLCanvasElement)

        this.engine = new Engine(app, { ...this.engine.options, ...(extraOptions ?? {}) })
        await this.engine.init()
        await this.engine.start()
    }

    captureCheckpoint() {
        return this.engine.captureCheckpoint()
    }

    setTrace(enabled: boolean, scene: string = '*') {
        this.engine.options.trace = enabled
        this.engine.options.traceScene = scene
        return this.engine.diagnostics.setTrace(enabled, scene)
    }

    captureScreenshot(): Promise<Blob> {
        const { app } = this.engine
        const frame = new PIXI.Rectangle(0, 0, app.screen.width, app.screen.height)
        const canvas = app.renderer.extract.canvas(app.stage, frame) as HTMLCanvasElement
        return new Promise((resolve, reject) => {
            canvas.toBlob(
                (blob) => (blob ? resolve(blob) : reject(new Error('Screenshot encoding failed'))),
                'image/png'
            )
        })
    }

    restoreCheckpoint(checkpoint: SceneCheckpoint) {
        if (checkpoint.version !== 1 || !checkpoint.scene) throw new Error('Unsupported checkpoint')
        return this.restart({ checkpoint, checkpointsEnabled: true })
    }

    destroy() {
        this.engine.destroy()
    }

    exportSaveFile() {
        return SaveFileManager.toINI(this.engine.saveFile)
    }

    importSaveFile(content: string) {
        this.restart({
            saveFile: SaveFileManager.fromINI(content, this.engine.saveFile.onChange),
        } as GamePlayerOptions)
    }

    get currentScene() {
        return this.engine.currentScene?.name ?? null
    }
}

export const createGamePlayer = (element: HTMLElement | null, options: GamePlayerOptions) => {
    if (element === null) {
        return null
    }

    const app = new PIXI.Application()
    element.appendChild(app.view as unknown as Node)

    const engine = new Engine(app, options)
    void engine.init()

    return new GamePlayerInstance(engine)
}
