import { Iso9660Reader, LocalIso9660Reader, RemoteIso9660Reader } from './iso9660'
import { normalizePath, pathJoin } from './index'
import { logger } from '../engine/logging'

const LOGICAL_ISO_NAME_HINTS = [
    'muzatitle.wav',
    'muzatitle2.wav',
    'plansza002.wav',
    'plansza003.wav',
    'plansza004.wav',
    'plansza005.wav',
    'plansza006.wav',
    'plansza006x.wav',
    'plansza009.wav',
    'plansza010.wav',
    'plansza013.wav',
    'plansza014.wav',
    'plansza015.wav',
    'plansza016.wav',
    'plansza017.wav',
    'plansza018.wav',
    'plansza019.wav',
    'plansza020.wav',
    'plansza021.wav',
    'wavs/piptaszek1.wav',
    'wavs/robinson6b.wav',
    'dane/intro/mainmenu/17ciemnosc/reksio17a.ann',
    'dane/intro/mainmenu/17ciemnosc/reksio17b.ann',
    'dane/intro/mainmenu/17ciemnosc/reksio17c.ann',
    'dane/intro/mainmenu/17ciemnosc/reksio17d.ann',
    'dane/intro/mainmenu/17ciemnosc/reksio17e.ann',
    'dane/intro/mainmenu/17ciemnosc/reksio17f.ann',
    'dane/intro/mainmenu/08rzekab/8kamien1-0.ann',
    'dane/intro/mainmenu/08rzekab/8kamien1-1.ann',
    'dane/intro/mainmenu/08rzekab/8kamien1-11.ann',
    'dane/intro/mainmenu/08rzekab/8kamien1-13.ann',
    'dane/intro/mainmenu/08rzekab/8kamien1-7.ann',
    'dane/intro/mainmenu/08rzekab/8kamien1-e.ann',
    'dane/intro/mainmenu/08rzekab/8kroko1-10.ann',
    'dane/intro/mainmenu/08rzekab/8kroko1-2.ann',
    'dane/intro/mainmenu/08rzekab/8kroko1-5.ann',
    'dane/intro/mainmenu/08rzekab/8kroko1-8.ann',
    'dane/intro/mainmenu/08rzekab/krokodyl10.seq',
    'dane/intro/mainmenu/08rzekab/krokodyl12.seq',
    'dane/intro/mainmenu/08rzekab/krokodyl13.seq',
    'dane/intro/mainmenu/08rzekab/krokodyl2.seq',
    'dane/intro/mainmenu/08rzekab/krokodyl5.seq',
    'dane/intro/mainmenu/08rzekab/krokodyl8.seq',
]

const LOGICAL_ISO_ALIAS_OVERRIDES: Record<string, string> = {
    'wavs/sfx/00windad2.wav': 'wavs/sfx/00winda6.wav',
    'wavs/sfx/00windadn.wav': 'wavs/sfx/00winda7.wav',
    'wavs/sfx/00windau2.wav': 'wavs/sfx/00winda8.wav',
    'wavs/sfx/00windaup.wav': 'wavs/sfx/00winda9.wav',
    'wavs/sfx/chrabaszcz2.wav': 'wavs/sfx/chrabas5.wav',
    'wavs/sfx/chrabaszcz3.wav': 'wavs/sfx/chrabas6.wav',
    'wavs/sfx/chrabaszcz4.wav': 'wavs/sfx/chrabas7.wav',
    'wavs/sfx/chrabaszcz5.wav': 'wavs/sfx/chrabas8.wav',
    'wavs/sfx/chrabaszcz6.wav': 'wavs/sfx/chrabas9.wav',
    'wavs/sfx/chrabaszcz7.wav': 'wavs/sfx/chraba10.wav',
    'wavs/sfx/chrabaszcz8.wav': 'wavs/sfx/chraba11.wav',
    'wavs/sfx/chrabaszcz9.wav': 'wavs/sfx/chraba12.wav',
    'wavs/sfx/chrabaszcz10.wav': 'wavs/sfx/chrabas2.wav',
    'wavs/sfx/chrabaszcz11.wav': 'wavs/sfx/chrabas3.wav',
    'wavs/sfx/chrabaszcz12.wav': 'wavs/sfx/chrabas4.wav',
    'dane/intro/mainmenu/09rzekac/9kroko1-11.ann': 'dane/intro/mainmenu/09rzekac/9kroko1_.ann',
    'dane/intro/mainmenu/09rzekac/9kroko1-3.ann': 'dane/intro/mainmenu/09rzekac/9kroko12.ann',
    'dane/intro/mainmenu/09rzekac/9kroko1-4.ann': 'dane/intro/mainmenu/09rzekac/9kroko13.ann',
    'dane/intro/mainmenu/09rzekac/9kroko1-5.ann': 'dane/intro/mainmenu/09rzekac/9kroko14.ann',
    'dane/intro/mainmenu/09rzekac/9kroko1-6.ann': 'dane/intro/mainmenu/09rzekac/9kroko15.ann',
    'dane/intro/mainmenu/09rzekac/9kroko1-8.ann': 'dane/intro/mainmenu/09rzekac/9kroko16.ann',
    'dane/intro/mainmenu/09rzekac/9kroko1-9.ann': 'dane/intro/mainmenu/09rzekac/9kroko17.ann',
    'dane/intro/mainmenu/09rzekac/9zolw1-1.ann': 'dane/intro/mainmenu/09rzekac/9zolw1_1.ann',
    'dane/intro/mainmenu/09rzekac/9zolw1-10.ann': 'dane/intro/mainmenu/09rzekac/9zolw1_3.ann',
    'dane/intro/mainmenu/09rzekac/9zolw1-2.ann': 'dane/intro/mainmenu/09rzekac/9zolw1_2.ann',
    'dane/intro/mainmenu/09rzekac/9zolw1-7.ann': 'dane/intro/mainmenu/09rzekac/9zolw1_7.ann',
    'dane/intro/mainmenu/09rzekac/krokodyl11.seq': 'dane/intro/mainmenu/09rzekac/krokodyl.seq',
    'dane/intro/mainmenu/09rzekac/krokodyl3.seq': 'dane/intro/mainmenu/09rzekac/krokody2.seq',
    'dane/intro/mainmenu/09rzekac/krokodyl4.seq': 'dane/intro/mainmenu/09rzekac/krokody3.seq',
    'dane/intro/mainmenu/09rzekac/krokodyl5.seq': 'dane/intro/mainmenu/09rzekac/krokody4.seq',
    'dane/intro/mainmenu/09rzekac/krokodyl6.seq': 'dane/intro/mainmenu/09rzekac/krokody5.seq',
    'dane/intro/mainmenu/09rzekac/krokodyl8.seq': 'dane/intro/mainmenu/09rzekac/krokody6.seq',
    'dane/intro/mainmenu/09rzekac/krokodyl9.seq': 'dane/intro/mainmenu/09rzekac/krokody7.seq',
}

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

    registerLogicalFilenames(_basePath: string, _definitionText: string): void {}
}

abstract class SimpleFileLoader extends FileLoader {
    private warnedResolutions = new Set<string>()
    private isoCollisionGroupStarts = new Map<string, number>()
    private logicalIsoNameHintsRegistered = false
    private registeredLogicalIsoPaths = new Set<string>()
    private logicalIsoAliasAssignments = new Map<string, string>()
    private sequentialIsoAliasAssignments = new Map<string, string>()
    private sequentialIsoAliasNextIndexes = new Map<string, number>()

    private toIsoLevelOneNameCandidates(name: string, preserveNumericSuffix = false): string[] {
        const suffix = name.match(/\d+$/)?.[0] ?? ''
        const candidates: string[] = []

        if (preserveNumericSuffix && suffix && suffix.length < 8) {
            candidates.push(`${name.slice(0, 8 - suffix.length)}${suffix}`)
        }

        candidates.push(name.slice(0, 8))

        return candidates.filter((entry, index, list) => entry && list.indexOf(entry) === index)
    }

    private toIsoLevelOnePartCandidates(part: string, preserveNumericSuffix = false): string[] {
        const extensionIndex = part.lastIndexOf('.')
        const clean = (value: string) => value.replace(/[^a-z0-9_]/gi, '').toLowerCase()
        const cleanWithUnderscores = (value: string) =>
            value
                .replace(/[^a-z0-9_]+/gi, '_')
                .replace(/^_+|_+$/g, '')
                .toLowerCase()
        const unique = (values: string[]) => values.filter((entry, index, list) => entry && list.indexOf(entry) === index)

        if (extensionIndex > 0) {
            const rawName = part.slice(0, extensionIndex)
            const nameVariants = unique([clean(rawName), cleanWithUnderscores(rawName)])
            const extension = clean(part.slice(extensionIndex + 1)).slice(0, 3)

            return unique(nameVariants.flatMap((name) => this.toIsoLevelOneNameCandidates(name, preserveNumericSuffix)))
                .map((candidate) => (extension ? `${candidate}.${extension}` : candidate))
                .filter((entry, index, list) => entry && list.indexOf(entry) === index)
        }

        return unique([clean(part), cleanWithUnderscores(part)]).flatMap((name) =>
            this.toIsoLevelOneNameCandidates(name, preserveNumericSuffix)
        )
    }

    private toIsoCollisionPathCandidate(filename: string): string | null {
        const parts = filename.split('/')
        const filenamePart = parts[parts.length - 1]
        const extensionIndex = filenamePart.lastIndexOf('.')
        const clean = (value: string) => value.replace(/[^a-z0-9_]/gi, '').toLowerCase()

        if (parts[0]?.toLowerCase() !== 'wavs' || parts[1]?.toLowerCase() === 'sfx' || extensionIndex <= 0) {
            return null
        }

        const name = clean(filenamePart.slice(0, extensionIndex))
        const extension = clean(filenamePart.slice(extensionIndex + 1)).slice(0, 3)
        const suffix = name.match(/\d+$/)?.[0]

        if (!suffix || suffix.length >= 8 || !extension) {
            return null
        }

        const groupName = name.slice(0, -suffix.length)
        const groupKey = [...parts.slice(0, -1), `${groupName}.${extension}`].join('/').toLowerCase()
        const firstSuffix = this.isoCollisionGroupStarts.get(groupKey) ?? Number(suffix)
        this.isoCollisionGroupStarts.set(groupKey, firstSuffix)

        const ordinal = Number(suffix) - firstSuffix + 1

        if (!Number.isInteger(ordinal) || ordinal < 1) {
            return null
        }

        const aliasName =
            ordinal === 1
                ? name.slice(0, 8)
                : `${name.slice(0, Math.max(0, 8 - String(ordinal).length))}${ordinal}`

        return [...parts.slice(0, -1), `${aliasName}.${extension}`].join('/')
    }

    private toSequentialIsoAliasPath(
        filename: string,
        listing: string[],
        listingByLowercase: Map<string, string>
    ): string | null {
        const normalizedRequest = filename.toLowerCase()
        const assigned = this.sequentialIsoAliasAssignments.get(normalizedRequest)
        if (assigned) {
            return assigned
        }

        const parts = filename.split('/')
        const filenamePart = parts[parts.length - 1]
        const extensionIndex = filenamePart.lastIndexOf('.')
        const clean = (value: string) => value.replace(/[^a-z0-9_]/gi, '').toLowerCase()
        const cleanWithUnderscores = (value: string) =>
            value
                .replace(/[^a-z0-9_]+/gi, '_')
                .replace(/^_+|_+$/g, '')
                .toLowerCase()
        const unique = (values: string[]) => values.filter((entry, index, list) => entry && list.indexOf(entry) === index)

        if (parts[0]?.toLowerCase() === 'wavs' || extensionIndex <= 0) {
            return null
        }

        const rawName = filenamePart.slice(0, extensionIndex)
        const extension = clean(filenamePart.slice(extensionIndex + 1)).slice(0, 3)
        if (!extension || extension === 'wav') {
            return null
        }

        const directory = parts.slice(0, -1).join('/').toLowerCase()
        const directoryPrefix = directory ? `${directory}/` : ''
        const truncatedNames = unique([clean(rawName), cleanWithUnderscores(rawName)]).filter((name) => name.length > 8)

        for (const truncatedName of truncatedNames) {
            const aliasStem = truncatedName.slice(0, 8)
            const aliasPath = `${directoryPrefix}${aliasStem}.${extension}`

            if (!listingByLowercase.has(aliasPath)) {
                continue
            }

            const aliasParts = aliasStem.match(/^(.*?)(\d+)$/)
            if (!aliasParts) {
                continue
            }

            const [, groupPrefix] = aliasParts
            const siblings = listing
                .filter((entry) => {
                    const lower = entry.toLowerCase()
                    if (!lower.startsWith(directoryPrefix) || !lower.endsWith(`.${extension}`)) {
                        return false
                    }

                    const basename = lower.slice(directoryPrefix.length, -(extension.length + 1))
                    return basename.startsWith(groupPrefix) && /^\d+$/.test(basename.slice(groupPrefix.length))
                })
                .sort((a, b) => {
                    const basenameA = a.toLowerCase().slice(directoryPrefix.length, -(extension.length + 1))
                    const basenameB = b.toLowerCase().slice(directoryPrefix.length, -(extension.length + 1))
                    const suffixA = Number(basenameA.slice(groupPrefix.length))
                    const suffixB = Number(basenameB.slice(groupPrefix.length))

                    if (suffixA !== suffixB) {
                        return suffixA - suffixB
                    }

                    return a.localeCompare(b)
                })

            if (siblings.length < 2) {
                continue
            }

            const groupKey = `${directoryPrefix}${groupPrefix}.${extension}`
            const nextIndex = this.sequentialIsoAliasNextIndexes.get(groupKey) ?? 0
            const resolved = siblings[nextIndex]

            if (!resolved) {
                return null
            }

            this.sequentialIsoAliasAssignments.set(normalizedRequest, resolved)
            this.sequentialIsoAliasNextIndexes.set(groupKey, nextIndex + 1)
            return resolved
        }

        return null
    }

    private getIsoCollisionAliases(
        directoryPrefix: string,
        aliasStem: string,
        extension: string,
        listingByLowercase: Map<string, string>
    ): string[] {
        const aliases: string[] = []
        const baseAlias = `${directoryPrefix}${aliasStem}.${extension}`
        const baseMatch = listingByLowercase.get(baseAlias)

        if (!baseMatch) {
            return aliases
        }

        aliases.push(baseMatch)

        if (aliasStem.length < 2) {
            return aliases
        }

        for (let ordinal = 2; ordinal < 100; ordinal += 1) {
            const collisionPrefix = aliasStem.slice(0, Math.max(0, 8 - String(ordinal).length))
            const collisionAlias = `${directoryPrefix}${collisionPrefix}${ordinal}.${extension}`
            if (collisionAlias === baseAlias) {
                continue
            }

            const match = listingByLowercase.get(collisionAlias)

            if (!match) {
                break
            }

            aliases.push(match)
        }

        return aliases
    }

    private toIsoDirectoryPrefixCandidates(parts: string[]): string[] {
        if (parts.length === 0) {
            return ['']
        }

        const candidates = ['']
        const exactPrefix = `${parts.join('/').toLowerCase()}/`

        for (const part of parts) {
            const partCandidates = this.toIsoLevelOnePartCandidates(part)
            const nextCandidates = []

            for (const existingCandidate of candidates) {
                for (const partCandidate of partCandidates) {
                    nextCandidates.push(existingCandidate ? `${existingCandidate}/${partCandidate}` : partCandidate)
                }
            }

            candidates.splice(0, candidates.length, ...nextCandidates)
        }

        return [exactPrefix, ...candidates.map((candidate) => `${candidate}/`)].filter(
            (entry, index, list) => entry && list.indexOf(entry) === index
        )
    }

    private getLogicalIsoAliasGroup(
        filename: string,
        listingByLowercase: Map<string, string>
    ): { key: string; aliases: string[] } | null {
        const parts = filename.split('/')
        const filenamePart = parts[parts.length - 1]
        const extensionIndex = filenamePart.lastIndexOf('.')
        const clean = (value: string) => value.replace(/[^a-z0-9_]/gi, '').toLowerCase()
        const cleanWithUnderscores = (value: string) =>
            value
                .replace(/[^a-z0-9_]+/gi, '_')
                .replace(/^_+|_+$/g, '')
                .toLowerCase()
        const unique = (values: string[]) => values.filter((entry, index, list) => entry && list.indexOf(entry) === index)

        if (extensionIndex <= 0) {
            return null
        }

        const rawName = filenamePart.slice(0, extensionIndex)
        const extension = clean(filenamePart.slice(extensionIndex + 1)).slice(0, 3)

        if (!extension) {
            return null
        }

        const directoryPrefixes = this.toIsoDirectoryPrefixCandidates(parts.slice(0, -1))
        const aliasStems = unique([clean(rawName), cleanWithUnderscores(rawName)])
            .flatMap((name) => this.toIsoLevelOneNameCandidates(name))
            .filter((entry, index, list) => entry.length > 0 && list.indexOf(entry) === index)

        const groups = directoryPrefixes
            .flatMap((directoryPrefix) =>
                aliasStems.map((aliasStem) => ({
                    directoryPrefix,
                    aliasStem,
                    aliases: this.getIsoCollisionAliases(directoryPrefix, aliasStem, extension, listingByLowercase),
                }))
            )
            .filter((group) => group.aliases.length > 1)
            .sort((a, b) => b.aliases.length - a.aliases.length)

        const bestGroup = groups[0]
        if (!bestGroup) {
            return null
        }

        return {
            key: `${bestGroup.directoryPrefix}${bestGroup.aliasStem}.${extension}`,
            aliases: bestGroup.aliases,
        }
    }

    private sortLogicalIsoPaths(paths: string[]): string[] {
        return [...paths].sort((a, b) => {
            if (a === b) {
                return 0
            }

            return a < b ? -1 : 1
        })
    }

    private rebuildLogicalIsoAliasAssignments(): void {
        this.logicalIsoAliasAssignments.clear()

        const listing = this.getFilesListing()
        const listingByLowercase = new Map(listing.map((entry) => [entry.toLowerCase(), entry]))
        const groups = new Map<string, { aliases: string[]; paths: string[] }>()

        for (const logicalPath of this.registeredLogicalIsoPaths) {
            const group = this.getLogicalIsoAliasGroup(logicalPath, listingByLowercase)

            if (!group) {
                continue
            }

            const existingGroup = groups.get(group.key)
            if (existingGroup) {
                existingGroup.paths.push(logicalPath)
            } else {
                groups.set(group.key, {
                    aliases: group.aliases,
                    paths: [logicalPath],
                })
            }
        }

        for (const group of groups.values()) {
            const sortedPaths = this.sortLogicalIsoPaths(group.paths)
            if (sortedPaths.length < 2) {
                continue
            }

            const limit = Math.min(sortedPaths.length, group.aliases.length)

            for (let index = 0; index < limit; index += 1) {
                this.logicalIsoAliasAssignments.set(sortedPaths[index], group.aliases[index])
            }
        }
    }

    private registerLogicalIsoPaths(paths: string[]): void {
        let changed = false

        for (const path of paths) {
            const normalizedPath = normalizePath(path)
            if (this.registeredLogicalIsoPaths.has(normalizedPath)) {
                continue
            }

            this.registeredLogicalIsoPaths.add(normalizedPath)
            changed = true
        }

        if (changed) {
            this.rebuildLogicalIsoAliasAssignments()
        }
    }

    private ensureLogicalIsoNameHintsRegistered(): void {
        if (this.logicalIsoNameHintsRegistered) {
            return
        }

        this.logicalIsoNameHintsRegistered = true
        this.registerLogicalIsoPaths(LOGICAL_ISO_NAME_HINTS)
    }

    private extractLogicalAssetPaths(basePath: string, definitionText: string): string[] {
        const normalizedBasePath = normalizePath(basePath)
        const assetPaths: string[] = []
        const objectTypes = new Map<string, string>()

        for (const line of definitionText.split('\n')) {
            const match = /^([^:]+):TYPE\s*=\s*("?)([^"\r\n]+)\2\s*$/i.exec(line.trim())
            if (match) {
                objectTypes.set(match[1].trim().toUpperCase(), match[3].trim().toUpperCase())
            }
        }

        const toRelativeDefinitionPath = (filename: string) => {
            const normalizedFilename = normalizePath(filename.replace(/^\$/, ''))
            return normalizedFilename.includes('/') || normalizedFilename.startsWith('dane/')
                ? normalizedFilename
                : pathJoin(normalizedBasePath, normalizedFilename)
        }
        const toWavsPath = (filename: string) => {
            const normalizedFilename = normalizePath(filename.replace(/^\$/, ''))
            return normalizedFilename.startsWith('wavs/') ? normalizedFilename : pathJoin('wavs', normalizedFilename)
        }

        for (const line of definitionText.split('\n')) {
            const match = /^([^:]+):([a-z0-9_]+)\s*=\s*("?)([^"\r\n]+)\3\s*$/i.exec(line.trim())
            if (!match) {
                continue
            }

            const objectName = match[1].trim().toUpperCase()
            const propertyName = match[2].trim().toUpperCase()
            const filename = match[4].trim()
            const isDefinitionAsset = /\.(ann|seq|img|fnt|arr|cnv|def)$/i.test(filename)
            const isAudioAsset = /\.wav$/i.test(filename)

            if (propertyName === 'WAVFN' && isAudioAsset) {
                assetPaths.push(toWavsPath(filename))
                continue
            }

            if (propertyName === 'MUSIC' && isAudioAsset) {
                assetPaths.push(normalizePath(filename.replace(/^\$/, '')))
                continue
            }

            if (propertyName === 'FILENAME' && isAudioAsset) {
                if (objectTypes.get(objectName) === 'MUSIC') {
                    assetPaths.push(normalizePath(filename.replace(/^\$/, '')))
                } else {
                    assetPaths.push(toWavsPath(filename))
                }
                continue
            }

            if ((propertyName === 'FILENAME' || propertyName === 'BACKGROUND') && isDefinitionAsset) {
                assetPaths.push(toRelativeDefinitionPath(filename))
            }
        }

        return assetPaths
    }

    registerLogicalFilenames(basePath: string, definitionText: string): void {
        this.ensureLogicalIsoNameHintsRegistered()
        this.registerLogicalIsoPaths(this.extractLogicalAssetPaths(basePath, definitionText))
    }

    private toIsoLevelOnePathCandidates(filename: string): string[] {
        const candidates = ['']
        const parts = filename.split('/')
        const preserveNumericSuffix = parts[0]?.toLowerCase() === 'wavs'

        for (const [partIndex, part] of parts.entries()) {
            const partCandidates = this.toIsoLevelOnePartCandidates(
                part,
                preserveNumericSuffix && partIndex === parts.length - 1
            )
            const nextCandidates = []

            for (const existingCandidate of candidates) {
                for (const partCandidate of partCandidates) {
                    nextCandidates.push(existingCandidate ? `${existingCandidate}/${partCandidate}` : partCandidate)
                }
            }

            candidates.splice(0, candidates.length, ...nextCandidates)
        }

        return candidates.filter((entry, index, list) => entry && list.indexOf(entry) === index)
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
        this.ensureLogicalIsoNameHintsRegistered()

        const normalizedFilename = normalizePath(filename)
        const listing = this.getFilesListing()
        const listingByLowercase = new Map(listing.map((entry) => [entry.toLowerCase(), entry]))
        const exactNormalizedMatch = listingByLowercase.get(normalizedFilename)
        if (exactNormalizedMatch) {
            return exactNormalizedMatch
        }

        const logicalIsoAliasOverride = LOGICAL_ISO_ALIAS_OVERRIDES[normalizedFilename]
        if (logicalIsoAliasOverride) {
            const exactOverrideMatch = listingByLowercase.get(logicalIsoAliasOverride)
            if (exactOverrideMatch) {
                this.warnResolution(normalizedFilename, exactOverrideMatch, 'explicit logical ISO9660 collision alias')
                return exactOverrideMatch
            }
        }

        const logicalIsoAliasPath = this.logicalIsoAliasAssignments.get(normalizedFilename)
        if (logicalIsoAliasPath) {
            this.warnResolution(normalizedFilename, logicalIsoAliasPath, 'logical ISO9660 collision alias')
            return logicalIsoAliasPath
        }

        const sequentialIsoAliasPath = this.toSequentialIsoAliasPath(normalizedFilename, listing, listingByLowercase)
        if (sequentialIsoAliasPath) {
            this.warnResolution(normalizedFilename, sequentialIsoAliasPath, 'sequential ISO9660 8.3 alias')
            return sequentialIsoAliasPath
        }

        const candidates = [
            normalizedFilename,
            this.toIsoCollisionPathCandidate(normalizedFilename),
            ...this.toIsoLevelOnePathCandidates(normalizedFilename),
        ]
            .filter((entry): entry is string => entry != null)
            .filter((entry, index, list) => list.indexOf(entry) === index)

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
