export type MatrixMove = {
    x: number
    y: number
    code: number
    latest: boolean
    result: number
}

const EMPTY = 0
const STONE = 2
const ENEMY = 5
const WALL = 6
const EXPLOSION = 8
const HERO = 99

// OZN's Matrix.dll uses a separate planning pass, then lets scripts animate each move.
export class OznMatrixSimulation {
    readonly cells: Uint8Array
    private readonly falling: Uint8Array
    private readonly pending: Uint8Array
    private queue: number[] = []
    private cursor = 0
    private gate: [number, number, number, number] = [0, 0, 0, 0]

    constructor(readonly width: number, readonly height: number) {
        if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width * height > 1000000) {
            throw new Error('Invalid MATRIX dimensions')
        }
        this.cells = new Uint8Array(width * height)
        this.falling = new Uint8Array(this.cells.length)
        this.pending = new Uint8Array(this.cells.length)
    }

    get(index: number) {
        return this.cells[index] ?? WALL
    }

    set(index: number, code: number) {
        if (Number.isInteger(index) && index >= 0 && index < this.cells.length) this.cells[index] = code
    }

    setRow(row: number, codes: number[]) {
        if (!Number.isInteger(row) || row < 0 || row >= this.height) return
        this.cells.set(codes.slice(0, this.width), row * this.width)
    }

    setGate(left: number, top: number, right: number, bottom: number) {
        this.gate = [left, top, right, bottom]
    }

    isInGate(index: number) {
        const x = index % this.width
        const y = Math.trunc(index / this.width)
        const [left, top, right, bottom] = this.gate
        return x >= left && x <= right && y >= top && y <= bottom
    }

    isGateEmpty() {
        return !this.cells.some((code, index) => code === STONE && this.isInGate(index))
    }

    canHeroGoTo(index: number) {
        return [EMPTY, 1, 3, ENEMY, EXPLOSION, 9].includes(this.get(index)) && !this.isInGate(index)
    }

    enemyDestination(index: number, direction: number) {
        return index + ([-1, -this.width, 1, this.width][direction] ?? 0)
    }

    enemyDirection(index: number, direction: number) {
        const left = [3, 0, 1, 2][direction] ?? 1
        const right = [1, 2, 3, 0][direction] ?? 3
        const reverse = [2, 3, 0, 1][direction] ?? 0
        for (const next of [left, direction, right, reverse]) {
            const target = this.enemyDestination(index, next)
            if ([EMPTY, HERO].includes(this.get(target)) && !this.isInGate(target)) return next
        }
        return 4
    }

    move(source: number, destination: number, direction = 0) {
        if (source < 0 || destination < 0 || source >= this.cells.length || destination >= this.cells.length) return
        if (this.get(destination) !== EXPLOSION) {
            this.set(destination, this.get(source))
            if (this.get(destination) === STONE) this.falling[destination] = direction
        }
        this.set(source, EMPTY)
        this.falling[source] = 0
    }

    tick() {
        this.pending.fill(0)
        for (let x = 0; x < this.width; x++) {
            for (let y = this.height - 2; y >= 0; y--) {
                const index = y * this.width + x
                if (this.get(index) !== STONE) continue
                const below = this.get(index + this.width)
                if (below === EMPTY || below === ENEMY) {
                    this.pending[index] = below === ENEMY ? 4 : 1
                    // Only the bottom stone in a vertical stack is considered this tick.
                    while (y > 0 && this.get((y - 1) * this.width + x) === STONE) y--
                    continue
                }
                if (below === STONE && (y === 0 || this.get(index - this.width) !== STONE)) {
                    const canRoll = (dx: number) => {
                        const nextX = x + dx
                        return nextX >= 0 && nextX < this.width &&
                            this.pending[index + dx] === 0 &&
                            (x + dx * 2 < 0 || x + dx * 2 >= this.width || this.pending[index + dx * 2] === 0) &&
                            this.get(index + dx) === EMPTY && this.get(index + this.width + dx) === EMPTY
                    }
                    const code = canRoll(-1) ? 2 : canRoll(1) ? 3 : 0
                    this.pending[index] = code
                    this.falling[index] = code
                } else {
                    this.falling[index] = 0
                }
            }
        }
        this.queue = []
        this.cursor = 0
        for (let y = this.height - 2; y >= 0; y--) {
            for (let x = 0; x < this.width; x++) {
                const index = y * this.width + x
                if (this.pending[index]) this.queue.push(index)
            }
        }
    }

    next(): MatrixMove | null {
        let index: number
        let code: number
        do {
            index = this.queue[this.cursor++]
            if (index === undefined) return null
            code = this.pending[index]
        } while (code === 4 && this.falling[index] !== 1)
        let collision = false
        if (code <= 3) {
            this.move(index, index + this.width + (code === 2 ? -1 : code === 3 ? 1 : 0), code)
            collision = code === 1 && this.get(index + 2 * this.width) === HERO
        } else if (this.falling[index] === 1) {
            this.falling[index] = 0
        }
        const latest = this.cursor >= this.queue.length
        return {
            x: index % this.width,
            y: Math.trunc(index / this.width),
            code,
            latest,
            result: collision ? 2 : latest ? 0 : 1,
        }
    }
}
