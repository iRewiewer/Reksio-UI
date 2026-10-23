import { BinaryBuffer } from '../fileFormats/utils'
import { decompressCLZW } from '../fileFormats/compression/clzw'
import type { Image } from '../fileFormats/img'

export const loadJpegBackground = async (data: ArrayBuffer): Promise<Image> => {
    const view = new DataView(data)
    const width = view.getUint32(4, true)
    const height = view.getUint32(8, true)
    const imageLen = view.getUint32(16, true)
    const alphaLen = view.getUint32(28, true)
    if (!width || !height || width * height > 16777216 || 40 + imageLen + alphaLen > data.byteLength) {
        throw new Error('Invalid JPEG image bounds')
    }
    const bitmap = await createImageBitmap(new Blob([data.slice(40, 40 + imageLen)], { type: 'image/jpeg' }))
    try {
        if (bitmap.width !== width || bitmap.height !== height) throw new Error('JPEG dimensions mismatch')
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d')!
        context.drawImage(bitmap, 0, 0)
        const rgba = context.getImageData(0, 0, width, height).data
        if (alphaLen) {
            const alpha = new Uint8Array(decompressCLZW(new BinaryBuffer(new DataView(data.slice(40 + imageLen)))))
            if (alpha.length !== width * height) throw new Error('JPEG alpha dimensions mismatch')
            for (let i = 0; i < alpha.length; i++) rgba[i * 4 + 3] = alpha[i]
        }
        return {
            header: {
                width,
                height,
                imageLen,
                alphaLen,
                bpp: 24,
                compressionType: 5,
                positionX: view.getInt32(32, true),
                positionY: view.getInt32(36, true),
            },
            bytes: rgba.buffer as ArrayBuffer,
        }
    } finally {
        bitmap.close()
    }
}
