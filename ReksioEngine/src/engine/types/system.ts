import { Type } from './index'
import { SystemDefinition } from '../../fileFormats/cnv/types'
import { method } from '../../common/types'

export class System extends Type<SystemDefinition> {
    @method()
    GETSYSTEMTIME() {
        if (!this.engine.compat.systemTime) return this.__call('GETSYSTEMTIME', [])
        return Math.floor(performance.now())
    }

    @method()
    GETDATE(): number {
        const date = new Date()
        return date.getDate() - 0xf41db + (date.getMonth() + (date.getFullYear() - 1900) * 100) * 100
    }
}
