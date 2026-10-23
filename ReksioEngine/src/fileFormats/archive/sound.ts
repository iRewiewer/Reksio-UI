export type PackedSound = { name: string; offset: number; length: number }

// SND is a sequence of flags, payload length, NUL-terminated name length, name, payload.
export const readSoundArchive = (data: ArrayBuffer): PackedSound[] => {
    const view = new DataView(data)
    const decoder = new TextDecoder('windows-1250')
    const entries: PackedSound[] = []
    let offset = 0
    while (offset < data.byteLength) {
        if (offset + 12 > data.byteLength) throw new Error('Truncated SND header')
        const length = view.getUint32(offset + 4, true)
        const nameLength = view.getUint32(offset + 8, true)
        const start = offset + 12 + nameLength
        if (!nameLength || nameLength > 1024 || start + length > data.byteLength) {
            throw new Error('Invalid SND entry bounds')
        }
        const name = decoder.decode(new Uint8Array(data, offset + 12, nameLength)).replace(/\0+$/, '')
        entries.push({ name: name.toLowerCase(), offset: start, length })
        offset = start + length
    }
    return entries
}
