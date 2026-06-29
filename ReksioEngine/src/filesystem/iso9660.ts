import { BinaryBuffer } from '../fileFormats/utils'

const SECTOR_SIZE = 2048
const VOLUME_DESCRIPTOR_START_SECTOR = 16
const VOLUME_DESCRIPTOR_SCAN_LIMIT = 64
const VOLUME_DESCRIPTOR_PRIMARY = 1
const VOLUME_DESCRIPTOR_SUPPLEMENTARY = 2
const VOLUME_DESCRIPTOR_TERMINATOR = 255

type IsoEncoding = 'ascii' | 'joliet'

type VolumeDescriptor = {
    sector: number
    type: number
    encoding: IsoEncoding
    rootLocation: number
    rootLength: number
}

export type FileEntry = {
    name: string
    location: number
    size: number
    flags: number
}

export abstract class Iso9660Reader {
    private filesMapping: Map<string, FileEntry> = new Map()
    private seenDirectories: Set<string> = new Set()
    private decoder = new TextDecoder('utf-16le')

    protected abstract readAt(offset: number, length: number): Promise<ArrayBuffer>

    private async bufferAt(offset: number, length: number) {
        const data = await this.readAt(offset, length)
        return new BinaryBuffer(new DataView(data))
    }

    private decodeASCII(arrayBuffer: ArrayBuffer) {
        const bytes = new Uint8Array(arrayBuffer)
        let output = ''

        for (const byte of bytes) {
            if (byte !== 0) {
                output += String.fromCharCode(byte)
            }
        }

        return output
    }

    private decodeUTF16BE(arrayBuffer: ArrayBuffer) {
        const byteLength = arrayBuffer.byteLength - (arrayBuffer.byteLength % 2)
        const view = new DataView(arrayBuffer)
        const swappedBuffer = new Uint8Array(byteLength)

        for (let i = 0; i < byteLength; i += 2) {
            swappedBuffer[i] = view.getUint8(i + 1)
            swappedBuffer[i + 1] = view.getUint8(i)
        }

        return this.decoder.decode(swappedBuffer)
    }

    private stripVersion(name: string) {
        const withoutNulls = name.replace(/\0/g, '')
        const semicolonIndex = withoutNulls.indexOf(';')
        return semicolonIndex > -1 ? withoutNulls.substring(0, semicolonIndex) : withoutNulls
    }

    private readFileName(directory: BinaryBuffer, identifierLength: number, encoding: IsoEncoding): string {
        if (identifierLength === 1) {
            const charCode = directory.getUint8()
            return charCode === 0 ? '.' : charCode === 1 ? '..' : ''
        }

        const rawIdentifier = directory.read(identifierLength)
        const name = encoding === 'joliet' ? this.decodeUTF16BE(rawIdentifier) : this.decodeASCII(rawIdentifier)
        return this.stripVersion(name)
    }

    private async processDirectory(
        position: number,
        length: number,
        path: Array<string>,
        encoding: IsoEncoding
    ): Promise<void> {
        const directoryKey = `${position}:${length}:${path.join('/')}`

        if (this.seenDirectories.has(directoryKey)) {
            return
        }

        this.seenDirectories.add(directoryKey)

        const directory = await this.bufferAt(position * SECTOR_SIZE, length)
        while (directory.offset < length) {
            const startOffset = directory.offset
            const directoryRecordLength = directory.getUint8()

            if (directoryRecordLength === 0) {
                const skip = SECTOR_SIZE - (startOffset % SECTOR_SIZE) - 1

                if (skip > 0) {
                    directory.skip(skip)
                }

                continue
            }

            if (directoryRecordLength < 34) {
                directory.offset = startOffset + directoryRecordLength
                continue
            }

            directory.getUint8()
            const locationOfExtent = directory.getUint32()
            directory.getUint32()
            const dataLength = directory.getUint32()
            directory.getUint32()
            directory.read(7)
            const flags = directory.getUint8()
            directory.getUint8()
            directory.getUint8()
            directory.getUint16()
            directory.getUint16()
            const identifierLength = directory.getUint8()
            const name = this.readFileName(directory, identifierLength, encoding)

            if (identifierLength % 2 === 0) {
                directory.skip(1)
            }

            const remainingRecordBytes = directoryRecordLength - (directory.offset - startOffset)

            if (remainingRecordBytes > 0) {
                directory.skip(remainingRecordBytes)
            }

            if (name == '.' || name == '..' || !name) {
                continue
            }

            const fullPathParts = [...path, name]
            const fullPath = fullPathParts.join('/').toLowerCase()
            const isDirectory = (flags & 2) != 0

            if (isDirectory) {
                await this.processDirectory(locationOfExtent, dataLength, fullPathParts, encoding)
            } else {
                this.filesMapping.set(fullPath, {
                    location: locationOfExtent * SECTOR_SIZE,
                    size: dataLength,
                    name: fullPath,
                    flags,
                })
            }
        }
    }

    private async readVolumeDescriptor(sector: number): Promise<VolumeDescriptor | null> {
        const descriptor = await this.bufferAt(sector * SECTOR_SIZE, SECTOR_SIZE)
        const type = descriptor.getUint8()
        const standardIdentifier = this.decodeASCII(descriptor.read(5))

        if (standardIdentifier !== 'CD001') {
            return null
        }

        descriptor.getUint8()

        if (type === VOLUME_DESCRIPTOR_TERMINATOR) {
            return {
                sector,
                type,
                encoding: 'ascii',
                rootLocation: 0,
                rootLength: 0,
            }
        }

        descriptor.offset = 88
        const escapeSequences = this.decodeASCII(descriptor.read(32))
        const encoding = type === VOLUME_DESCRIPTOR_SUPPLEMENTARY && escapeSequences.includes('%/') ? 'joliet' : 'ascii'

        descriptor.offset = 156
        descriptor.getUint8()
        descriptor.getUint8()
        const rootLocation = descriptor.getUint32()
        descriptor.getUint32()
        const rootLength = descriptor.getUint32()

        return {
            sector,
            type,
            encoding,
            rootLocation,
            rootLength,
        }
    }

    private async readVolumeDescriptors(): Promise<VolumeDescriptor[]> {
        const descriptors: VolumeDescriptor[] = []

        for (
            let sector = VOLUME_DESCRIPTOR_START_SECTOR;
            sector < VOLUME_DESCRIPTOR_START_SECTOR + VOLUME_DESCRIPTOR_SCAN_LIMIT;
            sector += 1
        ) {
            const descriptor = await this.readVolumeDescriptor(sector)

            if (descriptor == null) {
                continue
            }

            if (descriptor.type === VOLUME_DESCRIPTOR_TERMINATOR) {
                break
            }

            if (descriptor.type === VOLUME_DESCRIPTOR_PRIMARY || descriptor.type === VOLUME_DESCRIPTOR_SUPPLEMENTARY) {
                descriptors.push(descriptor)
            }
        }

        return descriptors
    }

    private selectVolumeDescriptor(descriptors: VolumeDescriptor[]): VolumeDescriptor | null {
        return (
            descriptors.find((descriptor) => descriptor.encoding === 'joliet') ??
            descriptors.find((descriptor) => descriptor.type === VOLUME_DESCRIPTOR_PRIMARY) ??
            descriptors[0] ??
            null
        )
    }

    async load() {
        this.filesMapping.clear()
        this.seenDirectories.clear()

        const descriptors = await this.readVolumeDescriptors()
        const descriptor = this.selectVolumeDescriptor(descriptors)

        if (descriptor == null) {
            throw new Error('No supported ISO9660 volume descriptor found')
        }

        await this.processDirectory(descriptor.rootLocation, descriptor.rootLength, [], descriptor.encoding)
        console.info(
            `Loaded ISO9660 ${descriptor.encoding} descriptor from sector ${descriptor.sector} with ${this.filesMapping.size} files`
        )
    }

    async getFile(path: string) {
        const entry = this.filesMapping.get(path)
        if (!entry) {
            return null
        }

        return this.readAt(entry.location, entry.size)
    }

    getListing() {
        return [...this.filesMapping.keys()]
    }
}

export class LocalIso9660Reader extends Iso9660Reader {
    protected file: File

    constructor(file: File) {
        super()
        this.file = file
    }

    protected async readAt(offset: number, length: number): Promise<ArrayBuffer> {
        const blob = this.file.slice(offset, offset + length)
        const reader = new FileReader()

        return new Promise<ArrayBuffer>((resolve, reject) => {
            reader.onload = () => resolve(reader.result as ArrayBuffer)
            reader.onerror = () => reject(reader.error)
            reader.readAsArrayBuffer(blob)
        })
    }
}

export class RemoteIso9660Reader extends Iso9660Reader {
    private readonly url: string

    constructor(url: string) {
        super()
        this.url = url
    }

    protected async readAt(offset: number, length: number): Promise<ArrayBuffer> {
        const response = await fetch(this.url, {
            headers: {
                Range: `bytes=${offset}-${offset + length - 1}`,
            },
        })
        return response.arrayBuffer()
    }
}
