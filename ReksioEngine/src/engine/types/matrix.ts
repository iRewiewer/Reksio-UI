import { Type } from './index'
import { MatrixDefinition } from '../../fileFormats/cnv/types'
import { method } from '../../common/types'
import { NotImplementedError } from '../../common/errors'
import { OznMatrixSimulation } from '../compat/oznMatrix'
import { Behaviour } from './behaviour'

export class Matrix extends Type<MatrixDefinition> {
    private simulation!: OznMatrixSimulation

    init() {
        if (!this.engine.compat.oznDefinitions) throw new NotImplementedError()
        this.simulation = new OznMatrixSimulation(this.definition.SIZE[0], this.definition.SIZE[1])
    }

    @method()
    GET(x: number, y?: number) {
        return this.simulation.get(y === undefined ? x : this.GETCELLOFFSET(x, y))
    }

    @method()
    SET(indexOrX: number, codeOrY: number, code?: number) {
        this.simulation.set(code === undefined ? indexOrX : this.GETCELLOFFSET(indexOrX, codeOrY), code ?? codeOrY)
    }

    @method()
    SETROW(row: number, ...codes: number[]) {
        this.simulation.setRow(row, codes)
    }

    @method()
    GETCELLSNO(code: number) {
        return this.simulation.cells.reduce((count, cell) => count + Number(cell === code), 0)
    }

    @method()
    GETCELLOFFSET(x: number, y: number) {
        return y * this.simulation.width + x
    }

    @method()
    GETFIELDPOSX(index: number) {
        return index % this.simulation.width
    }

    @method()
    GETFIELDPOSY(index: number) {
        return Math.trunc(index / this.simulation.width)
    }

    @method()
    GETCELLPOSX(indexOrX: number, y?: number) {
        return this.definition.BASEPOS[0] + (y === undefined ? this.GETFIELDPOSX(indexOrX) : indexOrX) * this.definition.CELLWIDTH
    }

    @method()
    GETCELLPOSY(indexOrX: number, y?: number) {
        return this.definition.BASEPOS[1] + (y === undefined ? this.GETFIELDPOSY(indexOrX) : y) * this.definition.CELLHEIGHT
    }

    @method()
    GETOFFSET(x: number, y: number) {
        const gridX = Math.trunc((x - this.definition.BASEPOS[0]) / this.definition.CELLWIDTH)
        const gridY = Math.trunc((y - this.definition.BASEPOS[1]) / this.definition.CELLHEIGHT)
        return gridX < 0 || gridX >= this.simulation.width || gridY < 0 || gridY >= this.simulation.height
            ? -1 : this.GETCELLOFFSET(gridX, gridY)
    }

    @method()
    MOVE(source: number, destination: number, targetX?: number, targetY?: number) {
        if (targetX !== undefined && targetY !== undefined) {
            this.simulation.move(this.GETCELLOFFSET(source, destination), this.GETCELLOFFSET(targetX, targetY))
        } else {
            this.simulation.move(source, destination)
        }
    }

    @method()
    CANHEROGOTO(indexOrX: number, y?: number) {
        return this.simulation.canHeroGoTo(y === undefined ? indexOrX : this.GETCELLOFFSET(indexOrX, y))
    }

    @method()
    SETGATE(left: number, top: number, right: number, bottom: number) {
        this.simulation.setGate(left, top, right, bottom)
    }

    @method()
    ISGATEEMPTY() {
        return this.simulation.isGateEmpty()
    }

    @method()
    ISINGATE(indexOrX: number, y?: number) {
        return this.simulation.isInGate(y === undefined ? indexOrX : this.GETCELLOFFSET(indexOrX, y))
    }

    @method()
    CALCENEMYMOVEDIR(index: number, direction: number) {
        return this.simulation.enemyDirection(index, direction)
    }

    @method()
    CALCENEMYMOVEDEST(index: number, direction: number) {
        return this.simulation.enemyDestination(index, direction)
    }

    @method()
    TICK() {
        this.simulation.tick()
    }

    @method()
    async NEXT() {
        const move = this.simulation.next()
        if (!move) return 0
        const event = move.latest ? 'ONLATEST' : 'ONNEXT'
        const callback = this.definition[event]
        if (callback) {
            const args = [move.x, move.y, move.code]
            this.engine.diagnostics.callback(this, event, args)
            if (callback.behaviourReference) {
                await this.getObject<Behaviour>(callback.behaviourReference)?.RUNC(...callback.constantArguments, ...args)
            } else {
                await this.engine.scripting.executeCallback(this, this, callback, args)
            }
        }
        return move.result
    }
}
