import { BUILD_VARS, createGamePlayer, GamePlayerOptions } from './index'
import {
    ArchiveOrgFileLoader,
    ListingJSONUrlFileLoader,
    IsoFileLoader,
    RemoteIsoFileLoader,
} from './filesystem/fileLoader'
import { SaveFileManager } from './engine/saveFile'
import { IndexedDBStorage } from './filesystem/fileStorage'

const urlParams = new URLSearchParams(window.location.search)
const gameContainer = document.getElementById('game')!
const debugContainer = document.getElementById('debug')
const controls = document.getElementById('controls')!

const savesEnabledEntry: string | null = localStorage.getItem('savesEnabled')
const areSavesEnabled = savesEnabledEntry == 'true' || savesEnabledEntry === null

const baseOptions = {
    startScene: urlParams.get('scene') ?? undefined,
    debug: urlParams.has('debug') ? urlParams.get('debug') == 'true' : BUILD_VARS.debug,
    debugContainer: debugContainer,
    onExit: () => document.exitFullscreen(),
    saveFile: areSavesEnabled ? SaveFileManager.fromLocalStorage() : undefined,
    storage: new IndexedDBStorage('reksio'),
}

const consoleLogQueue: Array<Record<string, unknown>> = []
let consoleFlushTimer: number | null = null
let consoleWindowStartedAt = Date.now()
let consoleWindowCount = 0
let consoleSuppressedCount = 0

const serializeConsoleValue = (value: unknown): string => {
    if (value instanceof Error) {
        return value.stack ?? value.message
    }

    if (typeof value === 'string') {
        return value
    }

    try {
        return JSON.stringify(value)
    } catch {
        return String(value)
    }
}

const postLauncherMessage = (message: object) => {
    if (window.parent === window) {
        return
    }

    try {
        window.parent.postMessage(message, window.location.origin)
    } catch {
        // Debug forwarding must not interfere with the game runtime.
    }
}

const flushLauncherConsoleLogs = () => {
    if (consoleFlushTimer !== null) {
        window.clearTimeout(consoleFlushTimer)
        consoleFlushTimer = null
    }

    if (consoleSuppressedCount > 0) {
        consoleLogQueue.push({
            time: new Date().toISOString(),
            source: 'engine',
            level: 'warn',
            message: `Suppressed ${consoleSuppressedCount} noisy engine logs before forwarding`,
            detail: '',
        })
        consoleSuppressedCount = 0
    }

    if (!consoleLogQueue.length) {
        return
    }

    postLauncherMessage({
        type: 'reksio:console-batch',
        entries: consoleLogQueue.splice(0, consoleLogQueue.length),
    })
}

const shouldForwardConsoleLog = (level: string) => {
    if (level === 'warn' || level === 'error') {
        return true
    }

    const now = Date.now()

    if (now - consoleWindowStartedAt >= 1000) {
        consoleWindowStartedAt = now
        consoleWindowCount = 0
    }

    consoleWindowCount += 1

    if (consoleWindowCount > 500) {
        consoleSuppressedCount += 1
        return false
    }

    return true
}

const queueLauncherConsoleLog = (level: string, args: unknown[]) => {
    const normalizedLevel = level === 'log' ? 'info' : level

    if (!shouldForwardConsoleLog(normalizedLevel)) {
        return
    }

    consoleLogQueue.push({
        time: new Date().toISOString(),
        source: 'engine',
        level: normalizedLevel,
        message: args.map(serializeConsoleValue).join(' '),
        detail: '',
    })

    if (consoleLogQueue.length >= 250) {
        flushLauncherConsoleLogs()
        return
    }

    if (consoleFlushTimer === null) {
        consoleFlushTimer = window.setTimeout(flushLauncherConsoleLogs, 250)
    }
}

window.addEventListener('beforeunload', flushLauncherConsoleLogs)

for (const level of ['debug', 'info', 'warn', 'error', 'log']) {
    const original = (console as any)[level].bind(console)
    ;(console as any)[level] = (...args: unknown[]) => {
        original(...args)
        queueLauncherConsoleLog(level, args)
    }
}

window.addEventListener('error', (event) => {
    flushLauncherConsoleLogs()
    postLauncherMessage({
        type: 'reksio:error',
        source: 'engine',
        message: event.message,
        stack: `${event.filename}:${event.lineno}:${event.colno}`,
    })
})

window.addEventListener('unhandledrejection', (event) => {
    flushLauncherConsoleLogs()
    postLauncherMessage({
        type: 'reksio:error',
        source: 'engine',
        message: 'Unhandled promise rejection',
        stack: serializeConsoleValue(event.reason),
    })
})

console.info('ReksioEngine player booting', { loader: urlParams.get('loader'), source: urlParams.get('source') })

let config = {}
const start = () => {
    gameContainer.removeEventListener('click', start)
    gameContainer.classList.remove('notready')

    const player = createGamePlayer(gameContainer, config as GamePlayerOptions)
    if (player) {
        void player.start()
    }
}

if (urlParams.get('loader') === 'iso-local') {
    const fileSelector = document.createElement('input')
    fileSelector.type = 'file'
    fileSelector.addEventListener('change', (event: any) => {
        controls.removeChild(fileSelector)

        config = {
            ...baseOptions,
            fileLoader: new IsoFileLoader(event.target.files[0]),
        }
        gameContainer.classList.add('notready')
        gameContainer.addEventListener('click', start)
    })

    controls.appendChild(fileSelector)
} else {
    const getFileLoader = () => {
        const loader = urlParams.get('loader')
        const source = urlParams.get('source')
        if (loader && source) {
            if (loader === 'archiveorg') {
                return new ArchiveOrgFileLoader(source)
            } else if (loader === 'listingjson') {
                return new ListingJSONUrlFileLoader(source)
            } else if (loader === 'iso-remote') {
                return new RemoteIsoFileLoader(source)
            }
        }
        return new ListingJSONUrlFileLoader('https://iso.zagrajwreksia.pl/game-assets/risp/pl/listing.json')
    }

    config = {
        ...baseOptions,
        fileLoader: getFileLoader(),
    }
    gameContainer!.classList.add('notready')
    gameContainer!.addEventListener('click', start)
}

const enterFullscreen = document.querySelector('#enterFullscreen')!
enterFullscreen.addEventListener('click', async () => {
    await gameContainer!.requestFullscreen()
})
