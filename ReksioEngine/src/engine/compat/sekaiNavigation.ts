import createGraph from 'ngraph.graph'
import { aStar } from 'ngraph.path'
import { SekPath, SekPoint } from '../../fileFormats/sek'

const distance = (a: SekPoint, b: SekPoint) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

export class SekaiNavigation {
    private graph = createGraph<SekPoint & { active: boolean; group: number }>()
    private disabledGroups = new Set<number>()
    private finder = aStar(this.graph, {
        oriented: true,
        distance: (a, b) => distance(a.data, b.data),
        heuristic: (a, b) => distance(a.data, b.data),
    })

    constructor(private readonly path: SekPath) {
        this.rebuildGraph()
    }

    private rebuildGraph() {
        this.graph.clear()
        this.path.nodes.forEach((node, index) =>
            this.graph.addNode(index, {
                ...node,
                active: !this.disabledGroups.has(node.group),
            })
        )
        for (const edge of this.path.edges) {
            // Exclude blocked links structurally: ngraph.path 1.6.1 queues a blocked
            // neighbour before applying its `blocked` callback.
            if (!this.graph.getNode(edge.from)?.data.active || !this.graph.getNode(edge.to)?.data.active) continue
            if (edge.flags & 2) this.graph.addLink(edge.from, edge.to)
            if (edge.flags & 1) this.graph.addLink(edge.to, edge.from)
        }
    }

    setActive(group: number, active: boolean) {
        if (active === !this.disabledGroups.has(group)) return
        if (active) this.disabledGroups.delete(group)
        else this.disabledGroups.add(group)
        this.rebuildGraph()
    }

    find(start: SekPoint, target: SekPoint, exactTarget: boolean): SekPoint[] | null {
        const nearest = (point: SekPoint) => {
            let nearestId: number | null = null
            let best = Infinity
            this.graph.forEachNode((node) => {
                const d = distance(node.data, point)
                if (node.data.active && d < best) {
                    best = d
                    nearestId = node.id as number
                }
            })
            return nearestId
        }
        const from = nearest(start),
            to = nearest(target)
        if (from === null || to === null) return null
        // Native FindPath succeeds with an empty route when both points map to the
        // same waypoint, and allows an exact final position only when requested.
        if (from === to) return []
        const nodes = this.finder.find(from, to).reverse()
        if (!nodes.length) return null
        if (nodes.length === 2) nodes.shift()
        const points = nodes.map(({ data: { x, y, z } }) => ({ x, y, z }))
        if (exactTarget && distance(points[points.length - 1], target) > 0) points.push({ ...target })
        return points
    }
}
