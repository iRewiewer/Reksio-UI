import type { SekWorld } from '../../fileFormats/sek'
import { TimeMachinePhysics } from './timeMachinePhysics'

export function createMagicieniiPhysics(source: SekWorld) {
    const bodies = new Map<number, SekWorld['bodies'][number]>()
    for (const body of source.bodies) {
        const previous = bodies.get(body.id)
        if (previous?.geometry && body.geometry) {
            previous.geometry.triangles.push(...body.geometry.triangles)
        } else {
            bodies.set(body.id, { ...body, geometry: body.geometry ? {
                ...body.geometry, triangles: [...body.geometry.triangles],
            } : undefined })
        }
    }
    // The shipped worlds split their static walls into several meshes with the same ID.
    return new TimeMachinePhysics({ bodies: [...bodies.values()], paths: source.paths })
}
