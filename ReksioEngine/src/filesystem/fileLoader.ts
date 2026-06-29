import { Iso9660Reader, LocalIso9660Reader, RemoteIso9660Reader } from './iso9660'
import { normalizePath } from './index'
import { logger } from '../engine/logging'

export class FileNotFoundError extends Error {
    constructor(filename: string) {
        super(`File '${filename}' not found in files listing`)
    }
}

export abstract class FileLoader {
    abstract init(): Promise<void>
    abstract getRawFile(filename: string): Promise<ArrayBuffer>
    abstract getFilesListing(): string[]
    abstract hasFile(filename: string): boolean
}

abstract class SimpleFileLoader extends FileLoader {
    private warnedResolutions = new Set<string>()

    private toIsoLevelOnePath(filename: string): string {
        return filename
            .split('/')
            .map((part) => {
                const extensionIndex = part.lastIndexOf('.')
                const clean = (value: string) => value.replace(/[^a-z0-9_]/gi, '').toLowerCase()

                if (extensionIndex > 0) {
                    const name = clean(part.slice(0, extensionIndex)).slice(0, 8)
                    const extension = clean(part.slice(extensionIndex + 1)).slice(0, 3)
                    return extension ? `${name}.${extension}` : name
                }

                return clean(part).slice(0, 8)
            })
            .join('/')
    }

    private warnResolution(filename: string, resolvedFilename: string, reason: string): void {
        const key = `${reason}:${filename}:${resolvedFilename}`

        if (this.warnedResolutions.has(key)) {
            return
        }

        this.warnedResolutions.add(key)
        logger.warn(`Resolved '${filename}' as '${resolvedFilename}' using ${reason}`)
    }

    protected resolveListedPath(filename: string): string | null {
        const normalizedFilename = normalizePath(filename)
        const listing = this.getFilesListing()
        const listingByLowercase = new Map(listing.map((entry) => [entry.toLowerCase(), entry]))
        const isoLevelOneFilename = this.toIsoLevelOnePath(normalizedFilename)
        const candidates = [normalizedFilename, isoLevelOneFilename].filter(
            (entry, index, list) => entry && list.indexOf(entry) === index
        )

        for (const candidate of candidates) {
            const exactMatch = listingByLowercase.get(candidate)

            if (exactMatch) {
                if (candidate !== normalizedFilename) {
                    this.warnResolution(normalizedFilename, exactMatch, 'ISO9660 8.3 alias')
                }

                return exactMatch
            }
        }

        for (const candidate of candidates) {
            const suffix = `/${candidate}`
            const matches = listing.filter((entry) => entry.toLowerCase().endsWith(suffix))

            if (matches.length === 1) {
                this.warnResolution(
                    normalizedFilename,
                    matches[0],
                    candidate === normalizedFilename ? 'nested path suffix' : 'nested ISO9660 8.3 alias'
                )
                return matches[0]
            }

            if (matches.length > 1) {
                logger.warn(`Found multiple nested candidates for '${normalizedFilename}'`, {
                    candidates: matches.slice(0, 10),
                })
            }
        }

        return null
    }

    hasFile(filename: string): boolean {
        return this.resolveListedPath(filename) != null
    }
}

export abstract class UrlFileLoader extends SimpleFileLoader {
    protected listing: Map<string, string> | null = null

    protected abstract fetchFilesListing(): Promise<Map<string, string>>

    async init(): Promise<void> {
        logger.debug('Fetching files listing...')
        this.listing = await this.fetchFilesListing()
    }

    getFilesListing(): string[] {
        return [...this.listing!.keys()]
    }

    async getRawFile(filename: string): Promise<ArrayBuffer> {
        const normalizedFilename = normalizePath(filename)
        logger.debug(`Fetching '${normalizedFilename}'...`)
        const resolvedFilename = this.resolveListedPath(normalizedFilename)
        const fileUrl = resolvedFilename == null ? null : this.listing!.get(resolvedFilename)
        if (fileUrl == null) {
            throw new FileNotFoundError(normalizedFilename)
        }

        const response = await fetch(fileUrl)
        return await response.arrayBuffer()
    }
}

export class ArchiveOrgFileLoader extends UrlFileLoader {
    private readonly baseUrl: string

    constructor(baseUrl: string) {
        super()
        this.baseUrl = baseUrl
    }

    // Windows case-insensitive filenames moment
    protected async fetchFilesListing() {
        const response = await fetch(this.baseUrl)
        const html = await response.text()

        const parser = new DOMParser()
        const doc = parser.parseFromString(html, 'text/html')

        const table = doc.querySelector('.archext')
        if (table == null) {
            throw new Error('Failed to fetch files listing table')
        }

        const links = table.querySelectorAll('a')
        return new Map<string, string>(
            [...links].map((link) => [link.textContent!.toLowerCase(), link.getAttribute('href')!])
        )
    }
}

export class IsoFileLoader extends SimpleFileLoader {
    private isoReader: Iso9660Reader

    constructor(file: File) {
        super()
        this.isoReader = new LocalIso9660Reader(file)
    }

    async init() {
        await this.isoReader.load()
    }

    getFilesListing(): string[] {
        return this.isoReader.getListing()
    }

    async getRawFile(filename: string): Promise<ArrayBuffer> {
        const normalizedFilename = normalizePath(filename)
        console.debug(`Loading '${normalizedFilename}'...`)
        const resolvedFilename = this.resolveListedPath(normalizedFilename)
        const fileResult = resolvedFilename == null ? null : await this.isoReader.getFile(resolvedFilename)
        if (fileResult == null) {
            throw new FileNotFoundError(normalizedFilename)
        }
        return fileResult
    }
}

export class RemoteIsoFileLoader extends SimpleFileLoader {
    private isoReader: Iso9660Reader

    constructor(url: string) {
        super()
        this.isoReader = new RemoteIso9660Reader(url)
    }

    async init() {
        await this.isoReader.load()
    }

    getFilesListing(): string[] {
        return this.isoReader.getListing()
    }

    async getRawFile(filename: string): Promise<ArrayBuffer> {
        const normalizedFilename = normalizePath(filename)
        console.debug(`Loading '${normalizedFilename}'...`)
        const resolvedFilename = this.resolveListedPath(normalizedFilename)
        const fileResult = resolvedFilename == null ? null : await this.isoReader.getFile(resolvedFilename)
        if (fileResult == null) {
            throw new FileNotFoundError(normalizedFilename)
        }
        return fileResult
    }
}

export class ListingJSONUrlFileLoader extends UrlFileLoader {
    constructor(private readonly listingUrl: string) {
        super()
    }

    protected async fetchFilesListing() {
        const response = await fetch(this.listingUrl)
        const data = await response.json()
        return new Map<string, string>(Object.entries(data))
    }
}
