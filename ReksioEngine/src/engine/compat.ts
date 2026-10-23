export type CompatProfile = 'default' | 'magicienii' | 'ozn' | 'nemo' | 'timpului'

export type EngineCompat = {
    clearAnimoCacheOnLoad: boolean
    simpleWorldPathing: boolean
    modernScripts: boolean
    jpegImages: boolean
    packedSounds: boolean
    serialTicks: boolean
}

export const normalizeCompatProfile = (profile?: string): CompatProfile => {
    const normalized = (profile ?? '').toLowerCase()

    if (/(magicien|magicians|czarodzieje)/.test(normalized)) {
        return 'magicienii'
    }
    if (/nemo/.test(normalized)) return 'nemo'
    if (/(timpului|time|wehikul)/.test(normalized)) return 'timpului'
    if (/(ozn|ufo)/.test(normalized)) return 'ozn'

    return 'default'
}

export const createEngineCompat = (profile?: string): EngineCompat => {
    const name = normalizeCompatProfile(profile)
    return {
        clearAnimoCacheOnLoad: name !== 'default',
        simpleWorldPathing: name === 'magicienii',
        modernScripts: name === 'nemo' || name === 'timpului',
        jpegImages: name === 'nemo' || name === 'timpului',
        packedSounds: name === 'nemo',
        serialTicks: name !== 'default',
    }
}
