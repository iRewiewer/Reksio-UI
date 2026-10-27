import { Type } from './index'
import { WorldDefinition } from '../../fileFormats/cnv/types'
import { method } from '../../common/types'
import { NotImplementedError } from '../../common/errors'
import { readSekWorld, SekPoint } from '../../fileFormats/sek'
import { SekaiNavigation } from '../compat/sekaiNavigation'
import { TimeMachinePhysics } from '../compat/timeMachinePhysics'
import { createMagicieniiPhysics } from '../compat/magicieniiPhysics'
import type { TimeMachineVehiclePhysics } from '../compat/timeMachineVehiclePhysics'

type WorldBody = {
    x: number
    y: number
    z: number
    targetX: number
    targetY: number
    targetZ: number
    velocityX: number
    velocityY: number
    velocityZ: number
    moving: boolean
    movedDistance: number
    angle: number
    linkedAnimoName: string | null
    atGoalSignaled: boolean
    speed: number
    remainingPath: SekPoint[]
    positionInitialized: boolean
}

export class World extends Type<WorldDefinition> {
    private bodies = new Map<number, WorldBody>()
    private started = false
    private elapsedMS = 1000 / 60
    private backgroundX = 0
    private backgroundY = 0
    private refObjectId: number | null = null
    private loadedFilename = ''
    private paths = new Map<number, SekaiNavigation>()
    private physics: TimeMachinePhysics | TimeMachineVehiclePhysics | null = null
    private physicsElapsedMS = 0

    async init() {
        if (this.usesPhysics(this.definition.FILENAME)) await this.LOAD(this.definition.FILENAME)
    }

    private usesPhysics(filename: string) {
        return (this.engine.compat.underwaterPhysics && /(?:^|[\\/])NUREK\.SEK$/i.test(filename ?? '')) ||
            this.usesFlightPhysics(filename) || this.usesVehiclePhysics(filename) ||
            this.usesMagicieniiPhysics(filename)
    }

    private usesMagicieniiPhysics(filename: string) {
        if (!this.engine.compat.magicieniiArcadePhysics) return false
        const scene = this.engine.currentScene?.name
        return (['DRAGON', 'MIOTLY'].includes(scene ?? '') && /(?:^|[\\/])WORLD\.SEK$/i.test(filename ?? '')) ||
            (scene === 'BARANDALF' && /(?:^|[\\/])LEVEL[02]\.SEK$/i.test(filename ?? ''))
    }

    private usesFlightPhysics(filename: string) {
        return this.engine.compat.flightPhysics && this.engine.currentScene?.name === 'SAMOLOCIK' &&
            /(?:^|[\\/])TEREN\.SEK$/i.test(filename ?? '')
    }

    private usesVehiclePhysics(filename: string) {
        return this.engine.compat.vehiclePhysics && ['SAMOCHODZIK', 'PIESZO'].includes(this.engine.currentScene?.name ?? '') &&
            /(?:^|[\\/])TEREN\.SEK$/i.test(filename ?? '')
    }

    destroy() {
        this.physics?.destroy()
        this.physics = null
        this.bodies.clear()
        this.paths.clear()
    }

    private ensurePathingEnabled() {
        if (!this.engine.compat.simpleWorldPathing) {
            throw new NotImplementedError()
        }
    }

    private getBody(id: number) {
        let body = this.bodies.get(id)
        if (!body) {
            body = {
                x: 0,
                y: 0,
                z: 0,
                targetX: 0,
                targetY: 0,
                targetZ: 0,
                velocityX: 0,
                velocityY: 0,
                velocityZ: 0,
                moving: false,
                movedDistance: 0,
                angle: 0,
                linkedAnimoName: null,
                atGoalSignaled: false,
                speed: 0,
                remainingPath: [],
                positionInitialized: false,
            }
            this.bodies.set(id, body)
        }
        return body
    }

    tick(elapsedMS: number) {
        this.elapsedMS = elapsedMS
        if (this.physics && this.started) this.physicsElapsedMS += elapsedMS
    }

    @method()
    async LOAD(filename: string) {
        this.ensurePathingEnabled()
        const scene = this.engine.currentScene
        if (!scene) throw new Error('WORLD requires a current scene')
        const path = await scene.getRelativePath(filename)
        const physical = this.usesPhysics(filename)
        const world = readSekWorld(await this.engine.filesystem.getFile(path), physical)
        this.physics?.destroy()
        this.physics = null
        if (this.usesMagicieniiPhysics(filename)) {
            this.physics = createMagicieniiPhysics(world)
        } else if (this.usesVehiclePhysics(filename)) {
            const { TimeMachineVehiclePhysics } = await import('../compat/timeMachineVehiclePhysics')
            this.physics = await TimeMachineVehiclePhysics.create(world)
        } else if (physical) {
            this.physics = new TimeMachinePhysics(world, !this.usesFlightPhysics(filename))
        }
        this.paths = new Map(world.paths.map((path) => [path.id, new SekaiNavigation(path)]))
        for (const { id, position } of world.bodies) {
            const body = this.getBody(id)
            body.x = position.x + 400
            body.y = 300 - position.y
            body.z = position.z
            body.positionInitialized = true
        }
        for (const body of this.bodies.values()) {
            body.remainingPath = []
            body.moving = false
            body.movedDistance = 0
        }
        this.loadedFilename = filename
        this.engine.diagnostics.worldState(this, 'LOAD', null, {
            filename,
            paths: world.paths.map(({ id, nodes, edges }) => ({ id, nodes: nodes.length, edges: edges.length })),
        })
    }

    @method()
    SETGRAVITY(x: number, y: number, z: number) {
        this.ensurePathingEnabled()
        this.physics?.setGravity(x, y, z)
    }

    @method()
    ADDBODY(
        id: number,
        density: number,
        mu: number,
        friction: number,
        bounce: number,
        bounceVel: number,
        maxVel: number,
        bodyType: number,
        geomType: number,
        radiusX: number = 1,
        radiusY: number = radiusX,
        radiusZ: number = radiusX
    ) {
        this.ensurePathingEnabled()
        const body = this.getBody(id)
        body.speed = maxVel
        if (this.physics) {
            if (geomType === 0 && 'addBox' in this.physics) {
                this.physics.addBox(id, density, mu, bounce, maxVel, bodyType !== 0, radiusX, radiusY, radiusZ)
            } else if (geomType === 2) {
                this.physics.addSphere(id, density, mu, bounce, maxVel, bodyType !== 0, radiusX)
            } else throw new Error(`Unsupported Time Machine geometry type ${geomType}`)
        }
    }

    @method()
    SETLIMIT(id: number, x: number, y: number, z: number, x1: number, y1: number, z1: number) {
        this.ensurePathingEnabled()
        this.getBody(id)
        this.physics?.setLimit(id, x, y, z, x1, y1, z1)
    }

    @method()
    SETSPEED(id: number, speed: number) {
        this.ensurePathingEnabled()
        this.getBody(id).speed = speed
    }

    @method()
    LINK(id: number, animoName: string, flag?: any) {
        this.ensurePathingEnabled()
        const body = this.getBody(id)
        body.linkedAnimoName = animoName
        if (this.physics) return

        if (!body.moving && body.x === 0 && body.y === 0 && body.targetX === 0 && body.targetY === 0 &&
            (!this.engine.compat.linkedBodyPositions || !body.positionInitialized)) {
            this.syncBodyFromLinkedAnimo(body)
        }

        this.engine.diagnostics.worldState(this, 'LINK', id, this.snapshotBody(body))
        // Time Machine positions bodies before replacing its temporary actor sprites.
        if (this.engine.compat.linkedBodyPositions) return this.syncLinkedAnimo(body)
    }

    @method()
    async SETPOSITION(id: number, x: number, y: number, z: number) {
        this.ensurePathingEnabled()
        const body = this.getBody(id)
        body.x = x
        body.y = y
        body.z = z
        body.positionInitialized = true
        body.targetX = x
        body.targetY = y
        body.targetZ = z
        body.moving = false
        body.remainingPath = []
        body.movedDistance = 0
        body.atGoalSignaled = true
        if (this.physics) {
            this.physics.setPosition(id, x, y, z)
            return
        }
        await this.syncLinkedAnimo(body)
    }

    @method()
    SETVELOCITY(id: number, x: number, y: number, z: number) {
        this.ensurePathingEnabled()
        const body = this.getBody(id)
        body.velocityX = x
        body.velocityY = y
        body.velocityZ = z
        this.physics?.setVelocity(id, x, y, z)
    }

    @method()
    SETMAXSPEED(id: number, speed: number) {
        this.ensurePathingEnabled()
        this.getBody(id).speed = speed
        this.physics?.setMaxSpeed(id, speed)
    }

    @method()
    MOVEOBJECTS() {
        this.ensurePathingEnabled()
        if (this.physics) return this.movePhysicsObjects()
        return this.elapsedMS
    }

    @method()
    START() {
        this.ensurePathingEnabled()
        if (!this.started) this.physicsElapsedMS = 0
        this.started = true
    }

    @method()
    STOP(signal?: boolean) {
        this.ensurePathingEnabled()
        this.started = false
        this.physicsElapsedMS = 0
        for (const body of this.bodies.values()) {
            body.moving = false
            body.movedDistance = 0
        }
    }

    @method()
    SETACTIVE(pathId: number, pointId?: number | boolean, active?: boolean | number) {
        this.ensurePathingEnabled()
        if (typeof pointId === 'number' && active !== undefined) {
            this.paths.get(pathId)?.setActive(pointId, !!active)
        } else if (this.physics && typeof pointId === 'boolean') {
            this.physics.setActive(pathId, pointId, active === undefined || !!active)
        }
    }

    @method()
    SETBKGSIZE(x0: number, x1: number, y0: number, y1: number) {
        this.ensurePathingEnabled()
        this.physics?.setBackgroundSize(x0, x1, y0, y1)
    }

    @method()
    SETREFOBJECT(id: number) {
        this.ensurePathingEnabled()
        this.refObjectId = id
        this.physics?.setReference(id)
    }

    @method()
    SETMOVEFLAGS(x: number, y: number) {
        this.ensurePathingEnabled()
        this.physics?.setMoveFlags(!!x, !!y)
    }

    @method()
    GETBKGPOSX() {
        this.ensurePathingEnabled()
        return this.physics?.backgroundX ?? this.backgroundX
    }

    @method()
    GETBKGPOSY() {
        this.ensurePathingEnabled()
        return this.physics?.backgroundY ?? this.backgroundY
    }

    @method()
    FINDPATH(
        id: number,
        pathId: number,
        targetX: number,
        targetY: number,
        targetZ: number,
        force?: boolean,
        signal?: boolean
    ) {
        this.ensurePathingEnabled()
        const body = this.getBody(id)
        const target = { x: targetX, y: targetY, z: targetZ }
        let route: SekPoint[] | null = [target]
        if (this.loadedFilename) {
            const toWorld = ({ x, y, z }: SekPoint) => ({ x: x - 400, y: 300 - y, z })
            route = this.paths.get(pathId)?.find(toWorld(body), toWorld(target), !!force) ?? null
            route = route?.map(({ x, y, z }) => ({ x: x + 400, y: 300 - y, z })) ?? null
        }
        body.remainingPath = route ?? []
        body.movedDistance = 0
        if (!route) {
            body.moving = false
            this.engine.diagnostics.worldState(this, 'NO_PATH', id, { pathId, ...target })
            return false
        }
        this.setTarget(body, body.remainingPath.shift() ?? body)
        body.moving = true
        body.atGoalSignaled = false
        body.movedDistance = this.distanceToTarget(body)
        body.angle = this.angleToTarget(body)
        this.engine.diagnostics.worldState(this, 'FINDPATH', id, {
            pathId,
            waypoints: body.remainingPath.length + 1,
            ...this.snapshotBody(body),
        })
        return true
    }

    @method()
    async FOLLOWPATH(id: number, stepDistance?: number, acceleration?: number, maxVelocity?: number) {
        this.ensurePathingEnabled()
        const body = this.getBody(id)

        if (!this.started || !body.moving) {
            body.movedDistance = 0
            return 0
        }

        const velocity = maxVelocity && maxVelocity > 0 ? maxVelocity : body.speed || 300
        let budget = Math.max(1, (velocity * this.elapsedMS) / 1000)
        body.movedDistance = 0
        while (body.moving) {
            const distance = this.distanceToTarget(body)
            if (distance <= budget) {
                body.x = body.targetX
                body.y = body.targetY
                body.z = body.targetZ
                body.movedDistance += distance
                budget -= distance
                const next = body.remainingPath.shift()
                if (!next) {
                    await this.finishPath(body)
                    break
                }
                this.setTarget(body, next)
                if (budget <= 0) break
            } else {
                body.angle = this.angleToTarget(body)
                body.x += ((body.targetX - body.x) / distance) * budget
                body.y += ((body.targetY - body.y) / distance) * budget
                body.z += ((body.targetZ - body.z) / distance) * budget
                body.movedDistance += budget
                break
            }
        }
        if (body.moving) await this.syncLinkedAnimo(body)

        return body.movedDistance
    }

    @method()
    GETMOVEDISTANCE(id: number) {
        this.ensurePathingEnabled()
        return this.getBody(id).movedDistance
    }

    @method()
    GETPOSITIONX(id: number) {
        this.ensurePathingEnabled()
        return this.physics?.position(id).x ?? this.getBody(id).x
    }

    @method()
    GETPOSITIONY(id: number) {
        this.ensurePathingEnabled()
        return this.physics?.position(id).y ?? this.getBody(id).y
    }

    @method()
    GETPOSITIONZ(id: number) {
        if (!this.engine.compat.vehiclePhysics || !this.physics) return this.__call('GETPOSITIONZ', [id])
        return this.physics.position(id).z
    }

    @method()
    GETANGLE(id: number) {
        this.ensurePathingEnabled()
        return this.physics?.angle(id) ?? this.getBody(id).angle
    }

    @method()
    ADDFORCE(id: number, x: number, y: number, z: number) {
        if (!this.physics) return this.__call('ADDFORCE', [id, x, y, z])
        this.physics.addForce(id, x, y, z)
        this.engine.diagnostics.worldState(this, 'ADDFORCE', id, { x, y, z })
    }

    @method()
    GETSPEED(id: number) {
        if (!this.physics) return this.__call('GETSPEED', [id])
        return this.physics.speed(id)
    }

    @method()
    GETROTATIONZ(id: number) {
        if (!this.physics) return this.__call('GETROTATIONZ', [id])
        return this.physics.rotation(id)
    }

    @method()
    SETGRAVITYCENTER(id: number, enabled: boolean) {
        if (!this.physics) return this.__call('SETGRAVITYCENTER', [id, enabled])
        this.physics.setMagnetic(id, enabled)
    }

    @method()
    SETG(id: number, g: number) {
        if (!this.physics) return this.__call('SETG', [id, g])
        this.physics.setG(id, g)
    }

    @method()
    ADDGRAVITYEX(id: number, center: number, excluded: boolean) {
        if (!this.physics) return this.__call('ADDGRAVITYEX', [id, center, excluded])
        this.physics.excludeGravity(id, center, excluded)
    }

    @method()
    JOIN(a: number, b: number, x: number, y: number, z: number, ...options: number[]) {
        if (!this.physics) return this.__call('JOIN', [a, b, x, y, z, ...options])
        this.physics.join(a, b, x, y, z)
    }

    @method()
    UNLINK(id: number) {
        if (!this.physics) return this.__call('UNLINK', [id])
        this.getBody(id).linkedAnimoName = null
    }

    @method()
    REMOVEOBJECT(id: number) {
        if (!this.physics) return this.__call('REMOVEOBJECT', [id])
        this.physics.remove(id)
        this.bodies.delete(id)
    }

    private async movePhysicsObjects() {
        if (!this.physics || !this.started) return 0
        const { elapsed, collisions } = this.physics.step(this.physicsElapsedMS)
        this.physicsElapsedMS = 0
        for (const [id, body] of this.bodies) {
            if (!body.linkedAnimoName || !body.positionInitialized) continue
            Object.assign(body, this.physics.position(id))
            // Broom and dragon scripts apply their own deltas and camera offsets; Barandalf uses linked actors.
            const scriptedPosition = this.usesMagicieniiPhysics(this.loadedFilename) &&
                ['DRAGON', 'MIOTLY'].includes(this.engine.currentScene?.name ?? '')
            if (!scriptedPosition) await this.syncLinkedAnimo(body)
        }
        for (const [a, b] of collisions) {
            for (const [id, other] of [[a, b], [b, a]]) {
                const name = this.bodies.get(id)?.linkedAnimoName
                if (name) await this.engine.getObject<any>(name, this.parentScope)?.SIGNAL?.(`${other}`)
            }
        }
        return elapsed
    }

    private distanceToTarget(body: WorldBody) {
        return Math.hypot(body.targetX - body.x, body.targetY - body.y, body.targetZ - body.z)
    }

    private setTarget(body: WorldBody, point: SekPoint) {
        body.targetX = point.x
        body.targetY = point.y
        body.targetZ = point.z
        if (this.distanceToTarget(body) > 0) body.angle = this.angleToTarget(body)
    }

    private angleToTarget(body: WorldBody) {
        const angle = (Math.atan2(body.targetY - body.y, body.targetX - body.x) * 180) / Math.PI
        return angle < 0 ? angle + 360 : angle
    }

    private async syncLinkedAnimo(body: WorldBody) {
        if (!body.linkedAnimoName) {
            return
        }

        const linkedAnimo = this.engine.getObject<any>(body.linkedAnimoName, this.parentScope)
        if (linkedAnimo && typeof linkedAnimo.SETPOSITION === 'function') {
            await linkedAnimo.SETPOSITION(body.x, body.y)
        }
    }

    private syncBodyFromLinkedAnimo(body: WorldBody) {
        if (!body.linkedAnimoName) {
            return
        }

        const linkedAnimo = this.engine.getObject<any>(body.linkedAnimoName, this.parentScope)
        if (
            linkedAnimo &&
            typeof linkedAnimo.GETPOSITIONX === 'function' &&
            typeof linkedAnimo.GETPOSITIONY === 'function'
        ) {
            body.x = linkedAnimo.GETPOSITIONX()
            body.y = linkedAnimo.GETPOSITIONY()
            body.targetX = body.x
            body.targetY = body.y
            body.positionInitialized = true
        }
    }

    private async signalAtGoal(body: WorldBody) {
        if (body.atGoalSignaled || !body.linkedAnimoName) {
            return
        }

        body.atGoalSignaled = true
        const linkedAnimo = this.engine.getObject<any>(body.linkedAnimoName, this.parentScope)
        if (linkedAnimo && typeof linkedAnimo.SIGNAL === 'function') {
            this.engine.diagnostics.worldState(this, 'SIGNAL_ATGOAL', null, this.snapshotBody(body))
            await linkedAnimo.SIGNAL('ATGOAL')
        }
    }

    private async finishPath(body: WorldBody) {
        body.x = body.targetX
        body.y = body.targetY
        body.z = body.targetZ
        body.moving = false
        body.movedDistance = 0
        await this.syncLinkedAnimo(body)
        this.engine.diagnostics.worldState(this, 'FINISHPATH', null, this.snapshotBody(body))
        await this.signalAtGoal(body)
    }

    private snapshotBody(body: WorldBody) {
        return {
            x: Math.round(body.x),
            y: Math.round(body.y),
            targetX: Math.round(body.targetX),
            targetY: Math.round(body.targetY),
            moving: body.moving,
            remainingWaypoints: body.remainingPath.length,
            movedDistance: Math.round(body.movedDistance * 100) / 100,
            angle: Math.round(body.angle * 100) / 100,
            linkedAnimoName: body.linkedAnimoName,
            started: this.started,
        }
    }
}
