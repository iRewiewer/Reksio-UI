import { BinaryBuffer } from '../utils'
import { LZO } from 'lzo-ts'

export const decompressCLZW = (buffer: BinaryBuffer, exactLength = false) => {
    const uncompressedSize = buffer.getUint32()
    const compressedSize = buffer.getUint32()

    const output = LZO.decompress(new Uint8Array(buffer.read(compressedSize)))
    // LZO may return a view into a larger allocation; JPEG masks require its exact length.
    return exactLength ? output.slice().buffer : output.buffer
}
