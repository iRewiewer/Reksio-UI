export type CompatProfile = 'default' | 'magicienii' | 'ozn' | 'nemo' | 'timpului'

export type EngineCompat = {
    clearAnimoCacheOnLoad: boolean
    simpleWorldPathing: boolean
    modernScripts: boolean
    sequenceSubevents: boolean
    jpegImages: boolean
    packedSounds: boolean
    serialTicks: boolean
    imageInvalidation: boolean
    scriptedCursor: boolean
    timeMachineDefinitions: boolean
    oznDefinitions: boolean
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
        simpleWorldPathing: name === 'magicienii' || name === 'timpului',
        modernScripts: name === 'magicienii' || name === 'nemo' || name === 'timpului',
        sequenceSubevents: name === 'nemo' || name === 'timpului',
        jpegImages: name === 'nemo' || name === 'timpului',
        packedSounds: name === 'nemo',
        serialTicks: name !== 'default',
        imageInvalidation: name !== 'default',
        scriptedCursor: name !== 'default',
        timeMachineDefinitions: name === 'timpului',
        oznDefinitions: name === 'ozn',
    }
}
