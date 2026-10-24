import { Body, GSSolver, Material, PointToPointConstraint, Sphere, Trimesh, Vec3, World } from 'cannon-es'
import type { SekPoint, SekWorld } from '../../fileFormats/sek'

type PhysicsBody = {
    body: Body
    maxSpeed: number
    magnetic: boolean
    g: number
    excludedCenters: Set<number>
    force: Vec3
    angle: number
    limit?: { min: Vec3; max: Vec3 }
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const toWorld = (x: number, y: number, z = 0) => new Vec3(x - 400, 300 - y, z)

// The native WORLD bridge uses a centered, Y-up world and exposes camera-relative
// screen positions. Scene-specific callers opt in; navigation remains separate.
export class TimeMachinePhysics {
    private world = new World({ allowSleep: false })
    private bodies = new Map<number, PhysicsBody>()
    private ids = new Map<Body, number>()
    private contacts = new Set<string>()
    private collisions: [number, number][] = []
    private bounds = { x0: 0, x1: 800, y0: 0, y1: 600 }
    private moveX = false
    private moveY = false
    private reference: number | null = null
    backgroundX = 0
    backgroundY = 0

    constructor(source: SekWorld, private planar = true) {
        const solver = this.world.solver as GSSolver
        solver.iterations = 30
        solver.tolerance = 1e-7
        for (const { id, geometry } of source.bodies) {
            if (!geometry?.triangles.length) continue
            const vertices = geometry.triangles.flatMap((face) => face.flatMap(({ x, y, z }) => [x, y, z]))
            const mesh = new Trimesh(vertices, Array.from({ length: vertices.length / 3 }, (_, index) => index))
            this.add(id, new Body({ mass: 0, shape: mesh, material: new Material({ friction: 1, restitution: 0 }) }))
        }
    }

    private add(id: number, body: Body, maxSpeed = 0) {
        if (this.bodies.has(id)) this.remove(id)
        this.world.addBody(body)
        this.ids.set(body, id)
        this.bodies.set(id, { body, maxSpeed, magnetic: false, g: 0, excludedCenters: new Set(), force: new Vec3(), angle: 0 })
    }

    addSphere(id: number, mass: number, friction: number, bounce: number, maxSpeed: number,
        dynamic: boolean, radius: number) {
        const body = new Body({ mass: dynamic ? mass : 0, shape: new Sphere(radius),
            material: new Material({ friction, restitution: bounce }), linearDamping: 0, angularDamping: 0 })
        if (this.planar) {
            body.linearFactor.set(1, 1, 0)
            body.angularFactor.set(0, 0, 1)
        }
        this.add(id, body, maxSpeed)
    }

    setGravity(x: number, y: number, z: number) { this.world.gravity.set(x, y, z) }
    setPosition(id: number, x: number, y: number, z: number) {
        const body = this.bodies.get(id)?.body
        if (!body) return
        body.position.copy(toWorld(x, y, z))
        body.previousPosition.copy(body.position)
        body.interpolatedPosition.copy(body.position)
        body.aabbNeedsUpdate = true
    }

    position(id: number): SekPoint {
        const point = this.bodies.get(id)?.body.position ?? new Vec3()
        return { x: point.x + 400 - this.backgroundX, y: 300 - point.y - this.backgroundY, z: point.z }
    }

    setVelocity(id: number, x: number, y: number, z: number) { this.bodies.get(id)?.body.velocity.set(x, y, z) }
    setMaxSpeed(id: number, speed: number) {
        const entry = this.bodies.get(id)
        if (entry) entry.maxSpeed = speed
    }
    speed(id: number) { return this.bodies.get(id)?.body.velocity.length() ?? 0 }
    angle(id: number) { return this.bodies.get(id)?.angle ?? 0 }
    rotation(id: number) {
        const forward = this.bodies.get(id)?.body.quaternion.vmult(new Vec3(1, 0, 0))
        return forward ? (Math.atan2(forward.y, forward.x) * 180 / Math.PI + 360) % 360 : 0
    }
    setLimit(id: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
        const entry = this.bodies.get(id)
        if (entry) entry.limit = { min: toWorld(x0, y1, z0), max: toWorld(x1, y0, z1) }
    }
    setActive(id: number, active: boolean, collide = true) {
        const body = this.bodies.get(id)?.body
        if (body) {
            body.collisionResponse = active
            body.collisionFilterMask = collide ? -1 : 0
        }
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
        if (force) force.vadd(new Vec3(x, y, z), force)
    }
    join(a: number, b: number, x: number, y: number, z: number) {
        const bodyA = this.bodies.get(a)?.body, bodyB = this.bodies.get(b)?.body
        if (!bodyA || !bodyB) return
        const anchor = toWorld(x, y, z)
        const joint = new PointToPointConstraint(bodyA, bodyA.pointToLocalFrame(anchor),
            bodyB, bodyB.pointToLocalFrame(anchor))
        joint.collideConnected = false
        this.world.addConstraint(joint)
    }
    remove(id: number) {
        const entry = this.bodies.get(id)
        if (!entry) return
        for (const joint of [...this.world.constraints]) {
            if (joint.bodyA === entry.body || joint.bodyB === entry.body) this.world.removeConstraint(joint)
        }
        this.world.removeBody(entry.body)
        this.ids.delete(entry.body)
        this.bodies.delete(id)
    }
    setBackgroundSize(x0: number, x1: number, y0: number, y1: number) { this.bounds = { x0, x1, y0, y1 } }
    setReference(id: number) { this.reference = id }
    setMoveFlags(x: boolean, y: boolean) { this.moveX = x; this.moveY = y }

    step(elapsedMS: number) {
        // The original solver caps pauses to 30ms instead of fast-forwarding a scene.
        const elapsed = Math.max(0, elapsedMS / 1000)
        const simulated = Math.min(elapsed, 0.03)
        if (simulated === 0) return { elapsed, collisions: [] as [number, number][] }
        const substeps = Math.ceil(simulated * 120)
        const dt = simulated / substeps
        this.collisions = []
        const contacts = new Set<string>()
        for (let i = 0; i < substeps; i++) {
            for (const [id, target] of this.bodies) {
                if (!target.body.mass) continue
                target.body.applyForce(target.force)
                for (const [centerId, center] of this.bodies) {
                    if (id === centerId || !center.magnetic || target.excludedCenters.has(centerId)) continue
                    const delta = center.body.position.vsub(target.body.position)
                    const distanceSquared = delta.lengthSquared()
                    if (distanceSquared < 1e-6) continue
                    // Native attraction is directed: each center supplies its own G.
                    const force = center.g * center.body.mass * target.body.mass / distanceSquared
                    delta.scale(force / Math.sqrt(distanceSquared), delta)
                    target.body.applyForce(delta)
                }
                this.limitVelocity(target)
            }
            this.world.step(dt)
            for (const entry of this.bodies.values()) {
                this.limitVelocity(entry)
                const { x, y } = entry.body.velocity
                if (Math.hypot(x, y) > 1e-6) entry.angle = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
                if (!entry.limit) continue
                const { position, velocity } = entry.body
                for (const axis of ['x', 'y', 'z'] as const) {
                    const next = clamp(position[axis], entry.limit.min[axis], entry.limit.max[axis])
                    if (next !== position[axis]) {
                        position[axis] = next
                        velocity[axis] = 0
                        entry.body.aabbNeedsUpdate = true
                    }
                }
            }
            for (const contact of this.world.contacts) {
                const a = this.ids.get(contact.bi), b = this.ids.get(contact.bj)
                if (a === undefined || b === undefined) continue
                const key = a < b ? `${a}:${b}` : `${b}:${a}`
                if (!this.contacts.has(key) && !contacts.has(key)) this.collisions.push([a, b])
                contacts.add(key)
            }
        }
        this.contacts = contacts
        for (const entry of this.bodies.values()) entry.force.setZero()
        this.updateCamera()
        return { elapsed, collisions: this.collisions }
    }

    private limitVelocity({ body, maxSpeed }: PhysicsBody) {
        const speed = body.velocity.length()
        if (maxSpeed > 0 && speed > maxSpeed) body.velocity.scale(maxSpeed / speed, body.velocity)
    }

    private updateCamera() {
        const ref = this.reference === null ? undefined : this.bodies.get(this.reference)?.body.position
        if (!ref) return
        this.backgroundX = this.moveX ? clamp(ref.x, this.bounds.x0, this.bounds.x1 - 800) : 0
        this.backgroundY = this.moveY ? clamp(-ref.y, this.bounds.y0, this.bounds.y1 - 600) : 0
    }

    destroy() {
        for (const id of this.bodies.keys()) this.remove(id)
    }
}
