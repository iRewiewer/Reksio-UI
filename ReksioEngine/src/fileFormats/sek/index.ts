export type SekPoint = { x: number; y: number; z: number }
export type SekNode = SekPoint & { group: number }
export type SekPath = {
    id: number
    nodes: SekNode[]
    edges: { from: number; to: number; flags: number }[]
}
export type SekGeometry = { flags: number; triangles: [SekPoint, SekPoint, SekPoint][] }
export type SekWorld = { bodies: { id: number; position: SekPoint; geometry?: SekGeometry }[]; paths: SekPath[] }

export function readSekWorld(buffer: ArrayBuffer, includeGeometry = false): SekWorld {
    const view = new DataView(buffer)
    const bytes = new Uint8Array(buffer)
    let offset = 0
    const requireBytes = (length: number) => {
        if (length < 0 || offset + length > bytes.length) throw new Error('Truncated SEKAI world')
    }
    const skip = (length: number) => {
        requireBytes(length)
        offset += length
    }
    const uint = () => {
        requireBytes(4)
        const value = view.getUint32(offset, true)
        offset += 4
        return value
    }
    const float = () => {
        requireBytes(4)
        const value = view.getFloat32(offset, true)
        offset += 4
        if (!Number.isFinite(value)) throw new Error('Invalid SEKAI coordinate')
        return value
    }
    const point = (): SekPoint => ({ x: float(), y: float(), z: float() })
    const string = () => {
        const end = bytes.indexOf(0, offset)
        if (end < 0) throw new Error('Unterminated SEKAI property')
        offset = end + 1
    }
    const entity = () => {
        const id = uint()
        uint() // Entity kind; geometry and path records share this header.
        const position = point()
        skip(24) // Rotation and scale are not applied to navigation coordinates.
        const properties = uint()
        for (let i = 0; i < properties; i++) {
            string()
            const type = uint()
            if (type === 2) string()
            else if (type === 0 || type === 1) skip(4)
            else throw new Error(`Unsupported SEKAI property type ${type}`)
        }
        return { id, position }
    }

    requireBytes(19)
    if (new TextDecoder().decode(bytes.subarray(0, 19)) !== 'SEKAI81080701915004') {
        throw new Error('Unsupported SEKAI world version')
    }
    offset = 19
    const world: SekWorld = { bodies: [], paths: [] }
    const sections = uint()
    for (let i = 0; i < sections; i++) {
        const type = uint()
        const size = uint()
        // Known section sizes omit parts of the records in shipped files. The native
        // loader also reads known sections structurally and only seeks unknown ones.
        if (type === 1) {
            const body: SekWorld['bodies'][number] = entity()
            const flags = uint()
            const triangles = uint()
            if (includeGeometry) body.geometry = { flags, triangles: [] }
            for (let j = 0; j < triangles; j++) {
                string()
                if (body.geometry) {
                    const vertices = Array.from({ length: 3 }, () => {
                        const vertex = point()
                        skip(20) // Normal and texture coordinates follow each position.
                        return vertex
                    }) as [SekPoint, SekPoint, SekPoint]
                    body.geometry.triangles.push(vertices)
                    skip(12) // Face color.
                } else skip(108)
            }
            world.bodies.push(body)
        } else if (type === 4) {
            const { id } = entity()
            const nodeCount = uint()
            const edgeCount = uint()
            requireBytes(nodeCount * 16 + edgeCount * 12)
            const nodes = Array.from({ length: nodeCount }, () => ({ ...point(), group: uint() }))
            const edges = Array.from({ length: edgeCount }, () => {
                const from = uint(),
                    to = uint(),
                    flags = uint()
                if (from >= nodeCount || to >= nodeCount) throw new Error('Invalid SEKAI path link')
                return { from, to, flags }
            })
            world.paths.push({ id, nodes, edges })
        } else skip(size)
    }
    return world
}
