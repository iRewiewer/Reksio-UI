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
    trailingAnnFrameData: boolean
    nemoDefinitions: boolean
    magicieniiAssets: boolean
    hiddenHotspotTransforms: boolean
    classConstructorName: boolean
    classHotspotOwners: boolean
    buttonAreaPriority: boolean
    manualAnimationFrames: boolean
    imageCloneRendering: boolean
    displayOpacity: boolean
    queuedMouseCoordinates: boolean
    dynamicHotspotTransforms: boolean
    resetDatabaseCursor: boolean
    databaseFindSelectsRow: boolean
    groupCollections: boolean
    croppedCanvasSaves: boolean
    relativeScriptedCursor: boolean
    propagateLoopBreak: boolean
    persistedArcadeCheckpoints: boolean
    backgroundImagePositions: boolean
    linkedBodyPositions: boolean
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
        sequenceSubevents: name === 'magicienii' || name === 'nemo' || name === 'timpului',
        jpegImages: name === 'nemo' || name === 'timpului',
        packedSounds: name === 'nemo',
        serialTicks: name !== 'default',
        imageInvalidation: name !== 'default',
        scriptedCursor: name !== 'default',
        timeMachineDefinitions: name === 'timpului',
        oznDefinitions: name === 'ozn',
        trailingAnnFrameData: name === 'nemo',
        nemoDefinitions: name === 'nemo',
        magicieniiAssets: name === 'magicienii',
        hiddenHotspotTransforms: name === 'nemo',
        classConstructorName: name === 'nemo',
        classHotspotOwners: name === 'nemo',
        buttonAreaPriority: name === 'nemo',
        manualAnimationFrames: name === 'nemo',
        imageCloneRendering: name === 'ozn',
        displayOpacity: name === 'magicienii' || name === 'timpului',
        queuedMouseCoordinates: name === 'magicienii' || name === 'timpului',
        dynamicHotspotTransforms: name === 'magicienii',
        resetDatabaseCursor: name === 'magicienii',
        databaseFindSelectsRow: name === 'magicienii',
        groupCollections: name === 'magicienii',
        croppedCanvasSaves: name === 'magicienii',
        relativeScriptedCursor: name === 'magicienii',
        propagateLoopBreak: name === 'magicienii',
        persistedArcadeCheckpoints: name === 'nemo',
        backgroundImagePositions: name === 'magicienii',
        linkedBodyPositions: name === 'timpului',
    }
}
