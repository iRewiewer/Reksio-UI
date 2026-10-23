import { reference } from '../fileFormats/common'
import { ScriptingManager } from './scripting'
import { loadDefinition, doReady } from '../filesystem/definitionLoader'
import { Application, Rectangle, Sprite, Texture } from 'pixi.js'
import { Scene } from './types/scene'
import { loadSound, loadTexture } from '../filesystem/assetsLoader'
import { SaveFile, SaveFileManager } from './saveFile'
import { Debugging } from './debugging'
import { assert, IgnorableError, IrrecoverableError } from '../common/errors'
import { initDevtools } from '@pixi/devtools'
import { RenderingManager } from './rendering'
import { BUILD_VARS, GamePlayerOptions } from '../index'
import { Scope, ScopeManager } from './scope'
import { Episode } from './types/episode'
import { Type, ValueType } from './types'
import type { SceneCheckpoint } from './checkpoint'
import { Behaviour } from './types/behaviour'
import Filesystem, { pathJoin } from '../filesystem'
import { globalAudio, SoundInstance } from './audio'
import { logger } from './logging'
import { setFormatsLogger } from '../fileFormats/logger'
import { EngineDiagnostics } from './diagnostics'
import { createEngineCompat } from './compat'
import type { EngineCompat } from './compat'
import { captureNemoCheckpoint, restoreNemoSaveDatabase } from './patches/nemo'
import { restoreMagicieniiTransitionState } from './patches/magicienii'

export class Engine {
    public debug: Debugging
    public diagnostics: EngineDiagnostics
    public speed: number = 1

    public scopeManager: ScopeManager

    public rendering: RenderingManager
    public scripting: ScriptingManager

    public currentScene: Scene | null = null
    public previousScene: Scene | null = null

    public saveFile: SaveFile

    public filesystem: Filesystem
    public music: SoundInstance | null = null
    public readonly compat: EngineCompat
    private entryCheckpoint: SceneCheckpoint | null = null
    private changingScene = false
    private ticking = false
    private startupComplete = false

    constructor(
        public readonly app: Application,
        public readonly options: GamePlayerOptions
    ) {
        setFormatsLogger(logger)
        this.compat = createEngineCompat(options.compatProfile)
        this.rendering = new RenderingManager(app)
        this.scopeManager = new ScopeManager()
        this.diagnostics = new EngineDiagnostics(this, this.options.trace ?? false, this.options.traceScene)
        this.scripting = new ScriptingManager(this)
        this.debug = new Debugging(this, this.options.debug ?? false, options.debugContainer ?? null)
        this.filesystem = new Filesystem(this.options.fileLoader, this.options.storage, this.compat)
        this.saveFile = this.options.saveFile ?? SaveFileManager.empty(undefined)
    }

    async init() {
        try {
            // @ts-expect-error no engine in globalThis
            globalThis.engine = this
            await initDevtools({ app: this.app })

            this.rendering.init()

            if (!BUILD_VARS.manualTick) {
                this.app.ticker.add(() => this.tick(this.app.ticker.elapsedMS))
            }
            this.app.ticker.stop()

            this.debug.setupDebugTools()
        } catch (err) {
            logger.error('Unhandled error occurred during initialization', null, err)
        }
    }

    async start() {
        try {
            await this.filesystem.init()
            if (this.options.checkpoint) {
                await this.options.storage.restore(this.options.checkpoint.filesystemEntries)
                this.saveFile = new SaveFile(this.options.checkpoint.saveData, this.saveFile.onChange)
            }

            const applicationDef = await this.filesystem.getCNVFile('DANE/Application.def')
            const rootScope = this.scopeManager.newScope('root')
            await loadDefinition(this, rootScope, applicationDef, null)
            await doReady(rootScope)

            const episode: Episode | null = this.scopeManager.findByType('EPISODE')
            if (episode === null) {
                logger.error("Starting episode doesn't exist")
                return
            }

            await this.debug.fillSceneSelector()
            const checkpoint = this.options.checkpoint
            if (!checkpoint && this.options.compatProfile === 'magicienii' &&
                this.options.startScene === 'ARCADE' && this.options.startSceneObject) {
                // The debug override must be applied after the menu loads GAME0.ARR.
                this.currentScene = this.getObject<Scene>('ARCADE')
                await this.getObject<Behaviour>('__GAME_INIT__')?.RUN()
                const sceneObject = this.getObject<ValueType<any, string>>('G_SARCADEOBJECTS')
                await sceneObject?.setValue(this.options.startSceneObject.toUpperCase())
                restoreMagicieniiTransitionState(this)
                this.currentScene = null
            }
            if (checkpoint) {
                // Recreate persistent UI classes before applying captured global values.
                this.currentScene = this.getObject<Scene>(checkpoint.scene)
                const initialized = checkpoint.globals.find((entry) => entry.name === 'G_IREADY')?.value
                const initializer = initialized
                    ? '__GAME_INIT__'
                    : this.options.compatProfile === 'nemo' && checkpoint.scene !== 'START'
                      ? '__PRZYGODA_INIT__'
                      : null
                if (initializer) await this.getObject<Behaviour>(initializer)?.RUN()
                for (const entry of checkpoint.globals) {
                    const object = this.scopeManager.scopes
                        .flatMap((scope) => scope.objects)
                        .find((object) => object.name === entry.name && (object.parent?.name ?? null) === entry.parent)
                    if (object instanceof ValueType && object.definition.TYPE === entry.type) {
                        object.restoreCheckpointValue(entry.value)
                    }
                }
                if (this.options.compatProfile === 'nemo') await restoreNemoSaveDatabase(this)
                if (this.options.compatProfile === 'magicienii') restoreMagicieniiTransitionState(this)
                this.currentScene = checkpoint.previousScene ? this.getObject<Scene>(checkpoint.previousScene) : null
            }
            await this.changeScene(checkpoint?.scene ?? this.options.startScene ?? episode.definition.STARTWITH)

            this.startupComplete = true
            this.app.ticker.start()
        } catch (err) {
            if (err instanceof CancelTick) {
                await err.callback?.()
                this.startupComplete = true
                return
            }

            logger.error(
                'Unhandled error occurred during start',
                {
                    scopes: this.scopeManager.scopes,
                },
                err
            )
            if (this.options.checkpoint) throw err
        }
    }

    destroy() {
        this.app.ticker.stop()
        for (const error of this.scopeManager.destroy()) {
            logger.warn('Object cleanup failed while closing the player', null, error)
        }
        this.app.destroy()
        if (this.music !== null) {
            this.music.stop()
        }
        globalAudio.stopAll()
    }

    async stopForRestart() {
        this.app.ticker.stop()
        const deadline = Date.now() + 15000
        while (this.ticking || this.changingScene) {
            if (Date.now() > deadline) throw new Error('The current scene is busy. Wait before restoring a checkpoint.')
            await new Promise((resolve) => setTimeout(resolve, 10))
        }
        this.app.ticker.stop()
    }

    async tick(elapsedMS: number) {
        if (this.compat.serialTicks && (this.ticking || this.changingScene || !this.startupComplete)) return
        this.ticking = true
        try {
            for (const scope of this.scopeManager.scopes) {
                if (scope === this.currentScene?.scope && this.currentScene.paused) continue
                for (const object of scope.objects.filter((object) => object.isReady)) {
                    try {
                        await object.tick(elapsedMS)
                    } catch (err) {
                        if (err instanceof CancelTick) {
                            await err.callback?.()
                            return
                        } else if (err instanceof IrrecoverableError) {
                            logger.error(
                                'Irrecoverable error occurred. Execution paused\n' + 'Call "engine.resume()" to resume',
                                {
                                    scopes: this.scopeManager.scopes,
                                },
                                err
                            )
                        } else {
                            logger.error(
                                'Unhandled error occurred during tick. Execution paused\n' +
                                    'Call "engine.resume()" to resume',
                                {
                                    scopes: this.scopeManager.scopes,
                                },
                                err
                            )
                        }
                        this.pause()
                    }
                }
            }

            this.debug.updateXRay()
        } finally {
            this.ticking = false
        }
    }

    async changeScene(sceneName: string) {
        this.changingScene = true
        this.options.onSceneChange?.(sceneName, this.currentScene?.name)
        this.diagnostics.sceneChanging(sceneName, this.currentScene?.name)
        this.app.ticker.stop()
        if (this.options.checkpointsEnabled) {
            try {
                const globals: SceneCheckpoint['globals'] = []
                for (const scope of this.scopeManager.scopes.filter((scope) =>
                    ['root', 'application', 'episode'].includes(scope.type)
                )) {
                    for (const object of scope.objects) {
                        if (
                            object instanceof ValueType &&
                            ['INTEGER', 'DOUBLE', 'BOOL', 'STRING', 'ARRAY'].includes(object.definition.TYPE)
                        ) {
                            globals.push({
                                parent: object.parent?.name ?? null,
                                name: object.name,
                                type: object.definition.TYPE,
                                value: structuredClone(await object.getValue()),
                            })
                        }
                    }
                }
                this.entryCheckpoint = {
                    version: 1,
                    scene: sceneName,
                    previousScene: this.currentScene?.name ?? null,
                    globals,
                    saveData: structuredClone(this.saveFile.toObject()),
                    filesystemEntries: await this.options.storage.snapshot(),
                }
            } catch (err) {
                this.entryCheckpoint = null
                logger.warn('Could not capture scene checkpoint', null, err)
            }
        }
        this.music?.pause()

        this.rendering.onSceneChange()

        const loadingFreezeOverlay = Sprite.from(
            await this.app.renderer.extract.image(
                this.app.stage,
                undefined,
                undefined,
                new Rectangle(0, 0, this.app.view.width, this.app.view.height)
            )
        )
        loadingFreezeOverlay.name = 'Loading freeze overlay'
        loadingFreezeOverlay.zIndex = 9999999
        this.app.stage.addChild(loadingFreezeOverlay)
        this.app.renderer.render(this.app.stage)

        try {
            const scopeToClear: Scope | null = this.currentScene !== null ? this.currentScene.scope : null
            if (scopeToClear) {
                this.scopeManager.removeScope(scopeToClear)
                for (const object of scopeToClear.objects) {
                    object.destroy()
                    scopeToClear.remove(object.name)
                }
            }

            // Alert when rendering stage wasn't completely cleared after all destroys.
            // For debugging purposes.
            const leakedObjects = this.app.stage.children.filter(
                (obj) => ![loadingFreezeOverlay, this.rendering.canvasBackground].includes(obj as any)
            )
            if (leakedObjects.length > 0) {
                logger.error('Display objects leak detected', {
                    leakedObjects,
                })
            }

            this.previousScene = this.currentScene
            this.currentScene = this.getObject(sceneName) as Scene
            assert(this.currentScene !== null, 'could not find scene')

            if (this.music !== null && this.currentScene.definition.MUSIC !== this.previousScene?.definition.MUSIC) {
                this.music.stop()
                this.music = null
            }

            // Set background image
            let texturePromise: Promise<Texture> | null = null
            if (this.currentScene.definition.BACKGROUND) {
                texturePromise = loadTexture(
                    this.filesystem,
                    await this.currentScene.getRelativePath(this.currentScene.definition.BACKGROUND)
                )
            } else {
                this.rendering.clearBackground()
            }

            // Play new scene background music.
            // We keep playing the same music if it was the same in previous scene
            let musicPromise = null
            if (this.music == null && this.currentScene.definition.MUSIC) {
                musicPromise = loadSound(this.filesystem, this.currentScene.definition.MUSIC)
            }

            const sceneDefinitionPromise = this.filesystem.getCNVFile(
                await this.currentScene!.getRelativePath(sceneName + '.cnv')
            )
            const newScopePromise: Promise<Scope> = new Promise((resolve, reject) => {
                sceneDefinitionPromise
                    .then((sceneDefinition) => {
                        const newScope = this.scopeManager.newScope('scene')
                        assert(this.currentScene !== null, 'could not find scene')
                        this.currentScene.scope = newScope
                        const newScopePromise = loadDefinition(this, newScope, sceneDefinition, this.currentScene)
                        newScopePromise
                            .then(() => {
                                resolve(newScope)
                            })
                            .catch(reject)
                    })
                    .catch(reject)
            })

            const [texture, music, newScope] = await Promise.all([texturePromise, musicPromise, newScopePromise])
            if (texture) {
                this.rendering.setBackground(texture)
            }

            if (music) {
                this.music = music.play({
                    loop: true,
                    muted: this.debug.mutedMusic,
                })
            } else if (this.music !== null) {
                this.music.resume()
            }

            if (newScope) {
                await doReady(newScope)
                await this.diagnostics.sceneReady()
            }
        } finally {
            this.changingScene = false
            this.app.stage.removeChild(loadingFreezeOverlay)

            this.app.ticker.start()
            this.debug.updateCurrentScene()
        }
    }

    captureCheckpoint(): SceneCheckpoint | Promise<SceneCheckpoint> {
        if (!this.entryCheckpoint || this.changingScene)
            throw new Error('Wait for the scene to finish loading before saving a checkpoint.')
        if (this.compat.persistedArcadeCheckpoints && this.entryCheckpoint.scene === 'ARCADE') {
            const entry = this.entryCheckpoint
            return captureNemoCheckpoint(this, entry).then((checkpoint) => {
                if (this.entryCheckpoint !== entry || this.changingScene)
                    throw new Error('The scene changed while capturing progress. Create the checkpoint again.')
                return checkpoint
            })
        }
        return structuredClone(this.entryCheckpoint)
    }

    getObject<T extends Type<any>>(name: string | reference | null, parentScope: Scope | null = null): T | null {
        if (typeof name == 'string') {
            const currentScopeEntry = parentScope?.get<T>(name)
            if (currentScopeEntry) {
                return currentScopeEntry
            }

            const object = this.scopeManager.findByName<T>(name, parentScope)
            // Newer games address the original animation as clone zero without creating a clone.
            if (!object && this.compat.modernScripts && name.endsWith('_0')) {
                return this.getObject<T>(name.slice(0, -2), parentScope)
            }
            return object
        } else if (name === null) {
            return null
        } else {
            return this.getObject(name.objectName, parentScope)
        }
    }

    async resolvePath(path: string, base = '') {
        if (path.startsWith('$')) {
            base = ''
            path = path.substring(1)
        }

        const lang = this.scopeManager.APPLICATION.GETLANGUAGE()
        const langPath = pathJoin(base, lang, path)
        const noLangPath = pathJoin(base, path)

        if (await this.filesystem.hasFile(langPath)) {
            return langPath
        } else {
            return noLangPath
        }
    }

    resume() {
        const sceneScope = this.currentScene?.scope
        assert(sceneScope)

        globalAudio.resume()
        for (const object of sceneScope.objects) {
            object.resume()
        }
        this.app.ticker.start()
    }

    pause() {
        const sceneScope = this.currentScene?.scope
        assert(sceneScope)

        this.app.ticker.stop()
        globalAudio.pause()
        for (const object of sceneScope.objects) {
            object.pause()
        }
    }
}

export class CancelTick extends IgnorableError {
    constructor(public callback?: () => Promise<void>) {
        super()
    }
}
