module.exports = async function createMenu(runtime, fixture) {
    const { load, Type, constructors } = runtime;
    const { engine, parent, scope } = fixture;
    const { Scope } = load('engine/scope.ts');
    const menuScope = new Scope('class_instance'), menuParent = { name: 'G_MENU', scope: menuScope };
    // Only presentation is replaced; the original XP, level and save behaviours remain live.
    class Ui extends Type {
        PLAY(event) { this.event = event; }
        SHOW() {} HIDE() {} SETFRAME() {} STOP() {} SETMUSICVOLUME() {}
    }
    const defs = await engine.filesystem.getCNVFile('common/classes/mainmenu.class');
    for (const def of Object.values(defs)) {
        const Constructor = constructors[def.TYPE] ?? Ui;
        menuScope.set(def.NAME, new Constructor(engine, menuParent, def));
    }
    const menu = scope.get('G_MENU') ?? new Ui(engine, parent, { TYPE: 'CLASS_INSTANCE', NAME: 'G_MENU' });
    for (const name of ['LEVELUP', 'ADDEXP', 'SAVEEXP', 'GETEXP', 'SHOWEXP', 'HIDEEXP']) {
        menu[name] = async (...args) => {
            if (name === 'ADDEXP') fixture.calls?.push([name, ...args]);
            return await menuScope.get(name).RUNC(...args);
        };
    }
    scope.set(menu.name, menu);
    return {
        menu, scope: menuScope,
        finishPanel: () => menuScope.get('M_KLEPSYDRA').callbacks.run('ONFINISHED', 'PANEL'),
        dispose: () => { for (const object of menuScope.objects) object.destroy(); },
    };
};
