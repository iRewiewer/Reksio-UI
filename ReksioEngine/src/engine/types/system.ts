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
    GETSECONDS() {
        if (!this.engine.compat.systemTime) return this.__call('GETSECONDS', [])
        return new Date().getUTCSeconds()
    }

    @method()
    GETMINUTES() {
        if (!this.engine.compat.systemTime) return this.__call('GETMINUTES', [])
        return new Date().getUTCMinutes()
    }

    @method()
    GETDAY() {
        if (!this.engine.compat.systemTime) return this.__call('GETDAY', [])
        // PIKLIB8 adds one to gmtime's day-of-month when generating save-slot prefixes.
        return new Date().getUTCDate() + 1
    }

    @method()
    GETDATE(): number {
        const date = new Date()
        return date.getDate() - 0xf41db + (date.getMonth() + (date.getFullYear() - 1900) * 100) * 100
    }
}
