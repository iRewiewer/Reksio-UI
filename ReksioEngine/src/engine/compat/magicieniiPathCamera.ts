export class MagicieniiPathCamera {
    private bounds = { x0: 0, x1: 800, y0: 0, y1: 600 }
    private moveX = false
    private moveY = false

    setBounds(x0: number, x1: number, y0: number, y1: number) {
        this.bounds = { x0, x1, y0, y1 }
    }

    setMoveFlags(x: boolean, y: boolean) {
        this.moveX = x
        this.moveY = y
    }

    follow(x: number, y: number) {
        const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max))
        return {
            x: this.moveX ? clamp(x - 400, this.bounds.x0, this.bounds.x1 - 800) : 0,
            y: this.moveY ? clamp(y - 300, this.bounds.y0, this.bounds.y1 - 600) : 0,
        }
    }
}
