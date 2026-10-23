export type CompatProfile = 'default' | 'magicienii'

export type EngineCompat = {
    clearAnimoCacheOnLoad: boolean
    simpleWorldPathing: boolean
}

export const normalizeCompatProfile = (profile?: string): CompatProfile => {
    const normalized = (profile ?? '').toLowerCase()

    if (/(magicien|magicians|czarodzieje)/.test(normalized)) {
        return 'magicienii'
    }

    return 'default'
}

export const createEngineCompat = (profile?: string): EngineCompat => {
    switch (normalizeCompatProfile(profile)) {
        case 'magicienii':
            return {
                clearAnimoCacheOnLoad: true,
                simpleWorldPathing: true,
            }
        case 'default':
        default:
            return {
                clearAnimoCacheOnLoad: false,
                simpleWorldPathing: false,
            }
    }
}
