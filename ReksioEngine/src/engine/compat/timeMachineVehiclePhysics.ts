import RAPIER from '@dimforge/rapier3d-compat'
import { Quaternion, Vec3 } from 'cannon-es'
import type { SekPoint, SekWorld } from '../../fileFormats/sek'

type VehicleBody = {
    body: RAPIER.RigidBody
    collider: RAPIER.Collider
    maxSpeed: number
    magnetic: boolean
    g: number
    excludedCenters: Set<number>
    force: SekPoint
    angle: number
    limit?: { min: SekPoint; max: SekPoint }
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const toWorld = (x: number, y: number, z: number): SekPoint => ({ x: x - 400, y: 300 - y, z })
let initialization: Promise<void> | undefined

// Vehicle boxes must collide with the original terrain mesh. Rapier supplies that
// narrow phase and the wheel joints; Cannon remains in use for the other scenes.
export class TimeMachineVehiclePhysics {
    private world = new RAPIER.World({ x: 0, y: 0, z: 0 })
    private events = new RAPIER.EventQueue(true)
    private bodies = new Map<number, VehicleBody>()
    private ids = new Map<number, number>()
    private bounds = { x0: 0, x1: 800, y0: 0, y1: 600 }
    private reference: number | null = null
    private moveX = false
    private moveY = false
    private destroyed = false
    backgroundX = 0
    backgroundY = 0

    static async create(source: SekWorld) {
        initialization ??= RAPIER.init()
        await initialization
        return new TimeMachineVehiclePhysics(source)
    }

    private constructor(source: SekWorld) {
        this.world.lengthUnit = 30
        this.world.numSolverIterations = 16
        for (const { id, geometry } of source.bodies) {
            if (!geometry?.triangles.length) continue
            const vertices = Float32Array.from(geometry.triangles.flatMap(face => face.flatMap(p => [p.x, p.y, p.z])))
            const indices = Uint32Array.from({ length: vertices.length / 3 }, (_, index) => index)
            this.add(id, RAPIER.RigidBodyDesc.fixed(), RAPIER.ColliderDesc.trimesh(vertices, indices), 0)
        }
    }

    private add(id: number, descriptor: RAPIER.RigidBodyDesc, shape: RAPIER.ColliderDesc, maxSpeed: number) {
        this.remove(id)
        const body = this.world.createRigidBody(descriptor.setCanSleep(false))
        const collider = this.world.createCollider(shape.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body)
        this.ids.set(collider.handle, id)
        this.bodies.set(id, { body, collider, maxSpeed, magnetic: false, g: 0,
            excludedCenters: new Set(), force: { x: 0, y: 0, z: 0 }, angle: 0 })
    }

    private addDynamic(id: number, mass: number, friction: number, bounce: number, maxSpeed: number,
        dynamic: boolean, shape: RAPIER.ColliderDesc) {
        const descriptor = dynamic ? RAPIER.RigidBodyDesc.dynamic() : RAPIER.RigidBodyDesc.fixed()
        this.add(id, descriptor, shape.setMass(mass).setFriction(friction).setRestitution(bounce), maxSpeed)
    }

    addSphere(id: number, mass: number, friction: number, bounce: number, maxSpeed: number,
        dynamic: boolean, radius: number) {
        this.addDynamic(id, mass, friction, bounce, maxSpeed, dynamic, RAPIER.ColliderDesc.ball(radius))
    }

    addBox(id: number, mass: number, friction: number, bounce: number, maxSpeed: number,
        dynamic: boolean, x: number, y: number, z: number) {
        this.addDynamic(id, mass, friction, bounce, maxSpeed, dynamic, RAPIER.ColliderDesc.cuboid(x / 2, y / 2, z / 2))
    }

    setGravity(x: number, y: number, z: number) { this.world.gravity = { x, y, z } }
    setPosition(id: number, x: number, y: number, z: number) {
        this.bodies.get(id)?.body.setTranslation(toWorld(x, y, z), true)
    }
    position(id: number): SekPoint {
        const p = this.bodies.get(id)?.body.translation() ?? { x: 0, y: 0, z: 0 }
        return { x: p.x + 400 - this.backgroundX, y: 300 - p.y - this.backgroundY, z: p.z }
    }
    setVelocity(id: number, x: number, y: number, z: number) { this.bodies.get(id)?.body.setLinvel({ x, y, z }, true) }
    setMaxSpeed(id: number, speed: number) {
        const entry = this.bodies.get(id)
        if (entry) entry.maxSpeed = speed
    }
    speed(id: number) {
        const v = this.bodies.get(id)?.body.linvel()
        return v ? Math.hypot(v.x, v.y, v.z) : 0
    }
    angle(id: number) { return this.bodies.get(id)?.angle ?? 0 }
    rotation(id: number) {
        const r = this.bodies.get(id)?.body.rotation()
        if (!r) return 0
        const forward = new Quaternion(r.x, r.y, r.z, r.w).vmult(new Vec3(1, 0, 0))
        return (Math.atan2(forward.y, forward.x) * 180 / Math.PI + 360) % 360
    }
    setLimit(id: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
        const entry = this.bodies.get(id)
        if (entry) entry.limit = { min: toWorld(x0, y1, z0), max: toWorld(x1, y0, z1) }
    }
    setActive(id: number, active: boolean, collide = true) {
        const collider = this.bodies.get(id)?.collider
        collider?.setSensor(!active)
        collider?.setEnabled(collide)
    }
    setMagnetic(id: number, enabled: boolean) {
        const entry = this.bodies.get(id)
        if (entry) entry.magnetic = enabled
    }
    setG(id: number, g: number) {
        const entry = this.bodies.get(id)
        if (entry) entry.g = g
    }
    excludeGravity(id: number, center: number, exclude: boolean) {
        const excluded = this.bodies.get(id)?.excludedCenters
        if (exclude) excluded?.add(center)
        else excluded?.delete(center)
    }
    addForce(id: number, x: number, y: number, z: number) {
        const force = this.bodies.get(id)?.force
        if (force) { force.x += x; force.y += y; force.z += z }
    }
    join(a: number, b: number, x: number, y: number, z: number) {
        const bodyA = this.bodies.get(a)?.body, bodyB = this.bodies.get(b)?.body
        if (!bodyA || !bodyB) return
        const anchor = toWorld(x, y, z)
        const local = (body: RAPIER.RigidBody) => {
            const p = body.translation(), r = body.rotation()
            return new Quaternion(r.x, r.y, r.z, r.w).inverse().vmult(new Vec3(anchor.x - p.x, anchor.y - p.y, anchor.z - p.z))
        }
        this.world.createImpulseJoint(RAPIER.JointData.spherical(local(bodyA), local(bodyB)), bodyA, bodyB, true)
            .setContactsEnabled(false)
    }
    remove(id: number) {
        const entry = this.bodies.get(id)
        if (!entry) return
        this.ids.delete(entry.collider.handle)
        this.world.removeRigidBody(entry.body)
        this.bodies.delete(id)
    }
    setBackgroundSize(x0: number, x1: number, y0: number, y1: number) { this.bounds = { x0, x1, y0, y1 } }
    setReference(id: number) { this.reference = id }
    setMoveFlags(x: boolean, y: boolean) { this.moveX = x; this.moveY = y }

    step(elapsedMS: number) {
        const elapsed = Math.max(0, elapsedMS / 1000)
        const simulated = Math.min(elapsed, 0.03)
        const collisions: [number, number][] = []
        if (simulated === 0) return { elapsed, collisions }
        const count = Math.ceil(simulated * 120), reported = new Set<string>()
        this.world.timestep = simulated / count
        for (let i = 0; i < count; i++) {
            for (const [id, entry] of this.bodies) {
                if (!entry.body.isDynamic()) continue
                entry.body.resetForces(true)
                entry.body.addForce(entry.force, true)
                for (const [centerId, center] of this.bodies) {
                    if (id === centerId || !center.magnetic || entry.excludedCenters.has(centerId)) continue
                    const p = entry.body.translation(), c = center.body.translation()
                    const x = c.x - p.x, y = c.y - p.y, z = c.z - p.z, distance = Math.hypot(x, y, z)
                    if (distance < 1e-3) continue
                    const scale = center.g * center.body.mass() * entry.body.mass() / distance ** 3
                    entry.body.addForce({ x: x * scale, y: y * scale, z: z * scale }, true)
                }
                this.limitBody(entry)
            }
            this.world.step(this.events)
            this.events.drainCollisionEvents((a, b, started) => {
                const idA = this.ids.get(a), idB = this.ids.get(b)
                if (!started || idA === undefined || idB === undefined) return
                const key = idA < idB ? `${idA}:${idB}` : `${idB}:${idA}`
                if (!reported.has(key)) collisions.push([idA, idB])
                reported.add(key)
            })
            for (const entry of this.bodies.values()) {
                if (!entry.body.isDynamic()) continue
                this.limitBody(entry)
                const { x, y } = entry.body.linvel()
                if (Math.hypot(x, y) > 1e-6) entry.angle = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
            }
        }
        for (const entry of this.bodies.values()) entry.force = { x: 0, y: 0, z: 0 }
        const ref = this.reference === null ? undefined : this.bodies.get(this.reference)?.body.translation()
        if (ref) {
            this.backgroundX = this.moveX ? clamp(ref.x, this.bounds.x0, this.bounds.x1 - 800) : 0
            this.backgroundY = this.moveY ? clamp(-ref.y, this.bounds.y0, this.bounds.y1 - 600) : 0
        }
        return { elapsed, collisions }
    }

    private limitBody({ body, maxSpeed, limit }: VehicleBody) {
        const v = body.linvel(), speed = Math.hypot(v.x, v.y, v.z)
        let velocityChanged = false
        if (maxSpeed > 0 && speed > maxSpeed) {
            v.x *= maxSpeed / speed; v.y *= maxSpeed / speed; v.z *= maxSpeed / speed
            velocityChanged = true
        }
        if (limit) {
            const p = body.translation()
            let positionChanged = false
            for (const axis of ['x', 'y', 'z'] as const) {
                const next = clamp(p[axis], limit.min[axis], limit.max[axis])
                if (next !== p[axis]) { p[axis] = next; v[axis] = 0; positionChanged = true; velocityChanged = true }
            }
            if (positionChanged) body.setTranslation(p, true)
        }
        if (velocityChanged) body.setLinvel(v, true)
    }

    destroy() {
        if (this.destroyed) return
        this.events.free()
        this.world.free()
        this.ids.clear()
        this.bodies.clear()
        this.destroyed = true
    }
}
