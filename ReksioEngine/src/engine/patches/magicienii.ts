export function patchMagicieniiArray(filename: string, entries: any[]): any[] {
    if (filename !== 'dane/game/przygoda/arcade/telep_podworko/idle_kogut.arr') return entries
    return entries.map((entry) => entry === 'KUGUT_U103' ? 'KOGUT_U103' : entry)
}
