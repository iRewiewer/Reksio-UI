import { Type } from './index'
import { loadSound } from '../../filesystem/assetsLoader'
import { SoundDefinition } from '../../fileFormats/cnv/types'
import { FileNotFoundError } from '../../filesystem/fileLoader'
import { assert, NotImplementedError } from '../../common/errors'
import { method } from '../../common/types'
import { Sound as ISound, globalAudio } from '../audio'
import { logger } from '../logging'

export class Sound extends Type<SoundDefinition> {
    private sound: ISound | null = null
    private loadedFilename: string | null = null
    private callbacksQueue: string[] = []

    async init() {
        await this.loadSound(await this.engine.resolvePath(this.definition.FILENAME, 'Wavs'))
    }

    async ready() {
        await this.callbacks.run('ONINIT')
    }

    async tick(elapsedMS: number) {
        while (this.callbacksQueue.length > 0) {
            await this.callbacks.run(this.callbacksQueue.shift()!)
        }
    }

    destroy() {
        if (this.sound !== null) {
            this.sound.stop()
            this.sound = null
            this.loadedFilename = null
        }
    }

    // This argument is "PLAY" for kurator in intro for some reason
    @method()
    PLAY(arg?: any) {
        this.playForSequence()
    }

    playForSequence(onEnd?: () => void) {
        assert(this.sound !== null)
        const filename = this.loadedFilename ?? this.definition.FILENAME
        return this.sound.play({
            onStart: () => this.onStart(filename),
            onEnd: () => {
                this.onEnd(filename)
                onEnd?.()
            },
        })
    }

    @method()
    ISPLAYING() {
        return this.sound !== null && this.sound.isPlaying
    }

    @method()
    STOP(arg?: boolean) {
        this.sound?.stop()
    }

    @method()
    RESUME() {
        this.sound?.resume()
    }

    @method()
    PAUSE() {
        this.sound?.pause()
    }

    @method()
    RELEASE() {
        this.destroy()
    }

    @method()
    SETFREQ(frequency: number) {
        throw new NotImplementedError()
    }

    @method()
    async LOAD(filename: string) {
        await this.loadSound(filename)
    }

    private async loadSound(path: string) {
        try {
            const filename = await this.engine.resolvePath(path)
            this.sound = await loadSound(this.engine.filesystem, filename)
            this.loadedFilename = filename
        } catch (err) {
            if (this.engine.compat.packedSounds && /(?:^|[\\/])(?:_pusty(?:_sfx)?\d+|_null_[\w]+)\.wav$/i.test(path)) {
                // Nemo's empty Ogg placeholders contain no decodable audio packets.
                this.sound = globalAudio.silence()
                this.loadedFilename = path
                return
            }
            if (err instanceof FileNotFoundError) {
                // Ignore sound loading errors
                // because there are some sounds for other language versions
                // that it tries to load, but they are not there
                logger.warn(
                    `Failed to load sound "${path}"`,
                    {
                        sound: this,
                    },
                    err
                )
            } else {
                throw err
            }
        }
    }

    private onStart(filename: string) {
        logger.debug(`Playing sound '${filename}'`, {
            sound: this,
        })
        this.callbacksQueue.push('ONSTARTED')
    }

    private onEnd(filename: string) {
        logger.debug(`Finished playing sound '${filename}'`, {
            sound: this,
        })
        this.callbacksQueue.push('ONFINISHED')
    }
}
