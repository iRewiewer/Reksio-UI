import { Type } from './index'
import { WorldDefinition } from '../../fileFormats/cnv/types'
import { method } from '../../common/types'
import { NotImplementedError } from '../../common/errors'

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
}

export class World extends Type<WorldDefinition> {
    private bodies = new Map<number, WorldBody>()
    private started = false
    private elapsedMS = 1000 / 60
    private backgroundX = 0
    private backgroundY = 0
    private refObjectId: number | null = null
    private loadedFilename = ''

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
            }
            this.bodies.set(id, body)
        }
        return body
    }

    tick(elapsedMS: number) {
        this.elapsedMS = elapsedMS
    }

    @method()
    LOAD(filename: string) {
        this.ensurePathingEnabled()
        this.loadedFilename = filename
        this.engine.diagnostics.worldState(this, 'LOAD', null, { filename })
    }

    @method()
    SETGRAVITY(x: number, y: number, z: number) {
        this.ensurePathingEnabled()
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
        geomType: number
    ) {
        this.ensurePathingEnabled()
        const body = this.getBody(id)
        body.speed = maxVel
    }

    @method()
    SETLIMIT(id: number, x: number, y: number, z: number, x1: number, y1: number, z1: number) {
        this.ensurePathingEnabled()
        this.getBody(id)
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

        if (!body.moving && body.x === 0 && body.y === 0 && body.targetX === 0 && body.targetY === 0) {
            this.syncBodyFromLinkedAnimo(body)
        }

        this.engine.diagnostics.worldState(this, 'LINK', id, this.snapshotBody(body))
    }

    @method()
    async SETPOSITION(id: number, x: number, y: number, z: number) {
        this.ensurePathingEnabled()
        const body = this.getBody(id)
        body.x = x
        body.y = y
        body.z = z
        body.targetX = x
        body.targetY = y
        body.targetZ = z
        body.moving = false
        body.movedDistance = 0
        body.atGoalSignaled = true
        await this.syncLinkedAnimo(body)
    }

    @method()
    SETVELOCITY(id: number, x: number, y: number, z: number) {
        this.ensurePathingEnabled()
        const body = this.getBody(id)
        body.velocityX = x
        body.velocityY = y
        body.velocityZ = z
    }

    @method()
    SETMAXSPEED(id: number, speed: number) {
        this.ensurePathingEnabled()
        this.getBody(id).speed = speed
    }

    @method()
    MOVEOBJECTS() {
        this.ensurePathingEnabled()
        return this.elapsedMS
    }

    @method()
    START() {
        this.ensurePathingEnabled()
        this.started = true
    }

    @method()
    STOP(signal?: boolean) {
        this.ensurePathingEnabled()
        this.started = false
        for (const body of this.bodies.values()) {
            body.moving = false
            body.movedDistance = 0
        }
    }

    @method()
    SETACTIVE(pathId: number, pointId?: number | boolean, active?: boolean | number) {
        this.ensurePathingEnabled()
    }

    @method()
    SETBKGSIZE(x0: number, x1: number, y0: number, y1: number) {
        this.ensurePathingEnabled()
    }

    @method()
    SETREFOBJECT(id: number) {
        this.ensurePathingEnabled()
        this.refObjectId = id
    }

    @method()
    SETMOVEFLAGS(x: number, y: number) {
        this.ensurePathingEnabled()
    }

    @method()
    GETBKGPOSX() {
        this.ensurePathingEnabled()
        return this.backgroundX
    }

    @method()
    GETBKGPOSY() {
        this.ensurePathingEnabled()
        return this.backgroundY
    }

    @method()
    FINDPATH(id: number, pathId: number, targetX: number, targetY: number, targetZ: number, force?: boolean, signal?: boolean) {
        this.ensurePathingEnabled()
        const body = this.getBody(id)
        body.targetX = targetX
        body.targetY = targetY
        body.targetZ = targetZ
        body.moving = true
        body.atGoalSignaled = false
        body.movedDistance = this.distanceToTarget(body)
        body.angle = this.angleToTarget(body)
        this.engine.diagnostics.worldState(this, 'FINDPATH', id, {
            pathId,
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

        const distance = this.distanceToTarget(body)
        if (distance <= 0.5) {
            await this.finishPath(body)
            return 0
        }

        const velocity = maxVelocity && maxVelocity > 0 ? maxVelocity : body.speed || 300
        const step = Math.max(1, (velocity * this.elapsedMS) / 1000)
        const moveBy = Math.min(step, distance)
        const dx = body.targetX - body.x
        const dy = body.targetY - body.y

        body.angle = this.angleToTarget(body)
        body.x += (dx / distance) * moveBy
        body.y += (dy / distance) * moveBy
        body.movedDistance = moveBy
        await this.syncLinkedAnimo(body)

        if (moveBy >= distance - 0.5) {
            await this.finishPath(body)
        }

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
        return this.getBody(id).x
    }

    @method()
    GETPOSITIONY(id: number) {
        this.ensurePathingEnabled()
        return this.getBody(id).y
    }

    @method()
    GETANGLE(id: number) {
        this.ensurePathingEnabled()
        return this.getBody(id).angle
    }

    private distanceToTarget(body: WorldBody) {
        return Math.hypot(body.targetX - body.x, body.targetY - body.y)
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
            movedDistance: Math.round(body.movedDistance * 100) / 100,
            angle: Math.round(body.angle * 100) / 100,
            linkedAnimoName: body.linkedAnimoName,
            started: this.started,
        }
    }
}
