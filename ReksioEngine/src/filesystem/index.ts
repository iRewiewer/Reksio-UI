import { parseCNV } from '../fileFormats/cnv'
import { parseSequence } from '../fileFormats/seq'
import { loadImage } from '../fileFormats/img'
import { loadAnn } from '../fileFormats/ann'
import { parseFont } from '../fileFormats/fnt'
import { decryptCNV } from '../fileFormats/cnv'
import { deserializeArray } from '../fileFormats/archive/array'
import { FileLoader } from './fileLoader'
import { FileStorage } from './fileStorage'
import { createEngineCompat, EngineCompat } from '../engine/compat'
import { readSoundArchive } from '../fileFormats/archive/sound'
import { loadJpegBackground } from '../engine/compatAssets'
import { patchTimeMachineDefinitions } from '../engine/patches/timpului'
import { patchOznSource } from '../engine/patches/ozn'
import { patchNemoDefinitions } from '../engine/patches/nemo'
import { patchMagicieniiArray, patchMagicieniiSequence, patchMagicieniiSource } from '../engine/patches/magicienii'

const PIRATES_RIVER_THREE_PATH = 'dane/intro/mainmenu/09rzekac/rzeka3.cnv'
const PIRATES_WIOSKA_PATH = 'dane/intro/mainmenu/10wioska/wioska10.cnv'
const PIRATES_PALISADE_PATH = 'dane/intro/mainmenu/13palisada/palisada13.cnv'
const PIRATES_TEMPLE_PATH = 'dane/intro/mainmenu/15posag/15posag.cnv'
const PIRATES_BLAWA_PATH = 'dane/intro/mainmenu/16blawa/16blawa.cnv'
const PIRATES_CIEMNOSC_PATH = 'dane/intro/mainmenu/17ciemnosc/ciemnosc.cnv'
const PIRATES_LASER_PATH = 'dane/intro/mainmenu/24laser/24laser.cnv'
const PIRATES_MENU_PATH = 'dane/intro/mainmenu/menu/menuglowne.cnv'

const PIRATES_WIOSKA_SINGER_LOOP_BEHAVIOURS = `
#
#BEHLOOPSPIEWAK1
#
OBJECT=BEHLOOPSPIEWAK1
BEHLOOPSPIEWAK1:TYPE=BEHAVIOUR
BEHLOOPSPIEWAK1:CONDITION=CONDPLAYSPIEW
BEHLOOPSPIEWAK1:CODE={ANIMOSPIEWAK1^PLAY("PLAY");}

#
#BEHLOOPSPIEWAK2
#
OBJECT=BEHLOOPSPIEWAK2
BEHLOOPSPIEWAK2:TYPE=BEHAVIOUR
BEHLOOPSPIEWAK2:CONDITION=CONDPLAYSPIEW
BEHLOOPSPIEWAK2:CODE={ANIMOSPIEWAK2^PLAY("PLAY");}

#
#BEHLOOPSPIEWAK3
#
OBJECT=BEHLOOPSPIEWAK3
BEHLOOPSPIEWAK3:TYPE=BEHAVIOUR
BEHLOOPSPIEWAK3:CONDITION=CONDPLAYSPIEW
BEHLOOPSPIEWAK3:CODE={ANIMOSPIEWAK3^PLAY("PLAY");}

#
#BEHLOOPSPIEWAK4
#
OBJECT=BEHLOOPSPIEWAK4
BEHLOOPSPIEWAK4:TYPE=BEHAVIOUR
BEHLOOPSPIEWAK4:CONDITION=CONDPLAYSPIEW
BEHLOOPSPIEWAK4:CODE={ANIMOSPIEWAK4^PLAY("PLAY");}

#
#BEHLOOPSPIEWAK5
#
OBJECT=BEHLOOPSPIEWAK5
BEHLOOPSPIEWAK5:TYPE=BEHAVIOUR
BEHLOOPSPIEWAK5:CONDITION=CONDPLAYSPIEW
BEHLOOPSPIEWAK5:CODE={ANIMOSPIEWAK5^PLAY("PLAY");}
`

const PIRATES_RIVER_THREE_ANIMO8 = `
#
#ANIMOKROKODYL8
#
OBJECT=ANIMOKROKODYL8
ANIMOKROKODYL8:TYPE=ANIMO
ANIMOKROKODYL8:VISIBLE=TRUE
ANIMOKROKODYL8:FILENAME=9KROKO1-8.ANN
ANIMOKROKODYL8:TOCANVAS=TRUE
ANIMOKROKODYL8:PRIORITY=0
ANIMOKROKODYL8:FPS=15
ANIMOKROKODYL8:PRELOAD=TRUE
ANIMOKROKODYL8:RELEASE=TRUE
ANIMOKROKODYL8:MONITORCOLLISION=FALSE
ANIMOKROKODYL8:MONITORCOLLISIONALPHA=FALSE
ANIMOKROKODYL8:ONSTARTED^OTWIERA=BEHREKSIOWYRZUCONYKOKODYL8
ANIMOKROKODYL8:ONFINISHED^OTWIERA=BEHSTARTGAME
`

const PIRATES_RIVER_THREE_SEQUENCE8 = `
#
#SEQKROKODYL8
#
OBJECT=SEQKROKODYL8
SEQKROKODYL8:TYPE=SEQUENCE
SEQKROKODYL8:FILENAME=KROKODYL8.SEQ
SEQKROKODYL8:ONINIT=BEHPLAYBEZRUCH
SEQKROKODYL8:ONFINISHED^BEZRUCH=BEHPLAYBEZRUCH
SEQKROKODYL8:ONFINISHED^AKCJA=BEHAKCJAKROKODYLA
`

const PIRATES_RIVER_THREE_CLICK8 = `
#
#BEHONCLICKKROKODYL8
#
OBJECT=BEHONCLICKKROKODYL8
BEHONCLICKKROKODYL8:TYPE=BEHAVIOUR
BEHONCLICKKROKODYL8:CODE={BEHONCLICKKROKODYL8Z4^RUNC();BEHONCLICKKROKODYL8Z5^RUNC();BEHONCLICKKROKODYL8Z6^RUNC();BEHONCLICKKROKODYL8Z9^RUNC();BEHONCLICKKROKODYL8Z10^RUNC();BEHONCLICKKROKODYL8Z11^RUNC();}

#
#BEHONCLICKKROKODYL8Z4
#
OBJECT=BEHONCLICKKROKODYL8Z4
BEHONCLICKKROKODYL8Z4:TYPE=BEHAVIOUR
BEHONCLICKKROKODYL8Z4:CONDITION=CONDKROKODYL8Z4
BEHONCLICKKROKODYL8Z4:CODE={BEHBEZRUCHKROKODYLI^RUN();BEHDISABLEBUTTONS^RUN();VARSTANREKSIA^SET(8);VARDESTX^SET(287);VARDESTY^SET(281);BEHMOVEE^RUN();}

#
#BEHONCLICKKROKODYL8Z5
#
OBJECT=BEHONCLICKKROKODYL8Z5
BEHONCLICKKROKODYL8Z5:TYPE=BEHAVIOUR
BEHONCLICKKROKODYL8Z5:CONDITION=CONDKROKODYL8Z5
BEHONCLICKKROKODYL8Z5:CODE={BEHBEZRUCHKROKODYLI^RUN();BEHDISABLEBUTTONS^RUN();VARSTANREKSIA^SET(8);VARDESTX^SET(287);VARDESTY^SET(281);BEHMOVESE^RUN();}

#
#BEHONCLICKKROKODYL8Z6
#
OBJECT=BEHONCLICKKROKODYL8Z6
BEHONCLICKKROKODYL8Z6:TYPE=BEHAVIOUR
BEHONCLICKKROKODYL8Z6:CONDITION=CONDKROKODYL8Z6
BEHONCLICKKROKODYL8Z6:CODE={BEHBEZRUCHKROKODYLI^RUN();BEHDISABLEBUTTONS^RUN();VARSTANREKSIA^SET(8);VARDESTX^SET(287);VARDESTY^SET(281);BEHMOVENE^RUN();}

#
#BEHONCLICKKROKODYL8Z9
#
OBJECT=BEHONCLICKKROKODYL8Z9
BEHONCLICKKROKODYL8Z9:TYPE=BEHAVIOUR
BEHONCLICKKROKODYL8Z9:CONDITION=CONDKROKODYL8Z9
BEHONCLICKKROKODYL8Z9:CODE={BEHBEZRUCHKROKODYLI^RUN();BEHDISABLEBUTTONS^RUN();VARSTANREKSIA^SET(8);VARDESTX^SET(287);VARDESTY^SET(281);BEHMOVESW^RUN();}

#
#BEHONCLICKKROKODYL8Z10
#
OBJECT=BEHONCLICKKROKODYL8Z10
BEHONCLICKKROKODYL8Z10:TYPE=BEHAVIOUR
BEHONCLICKKROKODYL8Z10:CONDITION=CONDKROKODYL8Z10
BEHONCLICKKROKODYL8Z10:CODE={BEHBEZRUCHKROKODYLI^RUN();BEHDISABLEBUTTONS^RUN();VARSTANREKSIA^SET(8);VARDESTX^SET(287);VARDESTY^SET(281);BEHMOVENW^RUN();}

#
#BEHONCLICKKROKODYL8Z11
#
OBJECT=BEHONCLICKKROKODYL8Z11
BEHONCLICKKROKODYL8Z11:TYPE=BEHAVIOUR
BEHONCLICKKROKODYL8Z11:CONDITION=CONDKROKODYL8Z11
BEHONCLICKKROKODYL8Z11:CODE={BEHBEZRUCHKROKODYLI^RUN();BEHDISABLEBUTTONS^RUN();VARSTANREKSIA^SET(8);VARDESTX^SET(287);VARDESTY^SET(281);BEHMOVEW^RUN();}
`

const PIRATES_RIVER_THREE_ATTACK8 = `
#
#BEHATAKKROKODYLA8
#
OBJECT=BEHATAKKROKODYLA8
BEHATAKKROKODYLA8:TYPE=BEHAVIOUR
BEHATAKKROKODYLA8:CONDITION=CONDATAKKROKODYLA8
BEHATAKKROKODYLA8:CODE={SEQKROKODYL8^PLAY("AKCJA");}

#
#BEHREKSIOWYRZUCONYKOKODYL8
#
OBJECT=BEHREKSIOWYRZUCONYKOKODYL8
BEHREKSIOWYRZUCONYKOKODYL8:TYPE=BEHAVIOUR
BEHREKSIOWYRZUCONYKOKODYL8:CODE={BEHDISABLEBUTTONS^RUN();VARSTANREKSIA^SET(-1);VARDX^SET(0);VARDY^SET(0);ANIMOREKSIOGRA^SETPOSITION(185,249);ANIMOREKSIOGRA^PLAY("1WYRZUCONY");}
`

const PIRATES_RIVER_THREE_ATTACK8_CONDITION = `
#
#CONDATAKKROKODYLA8
#
OBJECT=CONDATAKKROKODYLA8
CONDATAKKROKODYLA8:TYPE=CONDITION
CONDATAKKROKODYLA8:OPERAND1=VARSTANREKSIA
CONDATAKKROKODYLA8:OPERATOR=EQUAL
CONDATAKKROKODYLA8:OPERAND2=8
`

const PIRATES_CIEMNOSC_TORCH_ENTRANCE_REPAIR = `
#
#BEH_PRAWOOUTBEZ_DONE
#
OBJECT=BEH_PRAWOOUTBEZ_DONE
BEH_PRAWOOUTBEZ_DONE:TYPE=BEHAVIOUR
BEH_PRAWOOUTBEZ_DONE:CODE={COND_PRAWOOUTBEZ_POCHODNIA^CHECK(TRUE);}

#
#COND_PRAWOOUTBEZ_POCHODNIA
#
OBJECT=COND_PRAWOOUTBEZ_POCHODNIA
COND_PRAWOOUTBEZ_POCHODNIA:TYPE=CONDITION
COND_PRAWOOUTBEZ_POCHODNIA:OPERAND1=INT_POCHODNIA
COND_PRAWOOUTBEZ_POCHODNIA:OPERATOR=EQUAL
COND_PRAWOOUTBEZ_POCHODNIA:OPERAND2=1
COND_PRAWOOUTBEZ_POCHODNIA:ONRUNTIMESUCCESS=BEH_BUT_AKTYWNY_B
COND_PRAWOOUTBEZ_POCHODNIA:ONRUNTIMEFAILED={17BEZPOCH^PLAY();}
`

const PIRATES_MENU_VOLCANO_RESTORE_REPAIR = `
#
#PODWULKAN_RESTORE
#
OBJECT=PODWULKAN_RESTORE
PODWULKAN_RESTORE:TYPE=BEHAVIOUR
PODWULKAN_RESTORE:CODE={MENUGLOWNE^RUN("RATUNEK","GOTO",SAVEROZDZIAL6);}

#
#PODWULKAN_SAFE_START
#
OBJECT=PODWULKAN_SAFE_START
PODWULKAN_SAFE_START:TYPE=BEHAVIOUR
PODWULKAN_SAFE_START:CODE={MENUGLOWNE^RUN("RATUNEK","GOTO","15BWTWAROGU");}

#
#COND_PODWULKAN_CIEMNOSC
#
OBJECT=COND_PODWULKAN_CIEMNOSC
COND_PODWULKAN_CIEMNOSC:TYPE=CONDITION
COND_PODWULKAN_CIEMNOSC:OPERAND1=SAVEROZDZIAL6
COND_PODWULKAN_CIEMNOSC:OPERATOR=EQUAL
COND_PODWULKAN_CIEMNOSC:OPERAND2="CIEMNOSC"
COND_PODWULKAN_CIEMNOSC:ONRUNTIMESUCCESS=PODWULKAN_SAFE_START
COND_PODWULKAN_CIEMNOSC:ONRUNTIMEFAILED=PODWULKAN_RESTORE
`

export const normalizePath = (path: string) => {
    return path.toLowerCase().replace(/\\+/g, '/').replace(/\/+/g, '/').replace(/^\//, '')
}

export const pathJoin = (...parts: Array<string>) => {
    const fixedParts = parts.filter((part) => part !== '').map((part) => part.replace(/\\/g, '/'))
    return normalizePath(fixedParts.join('/'))
}

export default class Filesystem {
    private soundArchives = new Map<string, Promise<Map<string, ArrayBuffer>>>()

    constructor(
        public fileLoader: FileLoader,
        public storage: FileStorage,
        private compat: EngineCompat = createEngineCompat()
    ) {}

    async init() {
        await this.fileLoader.init()
        await this.storage.init()
    }

    async getFile(path: string) {
        path = normalizePath(path)
        const storageFile = await this.storage.get(path)
        if (storageFile) {
            return storageFile
        }
        if (this.compat.packedSounds && !this.fileLoader.hasFile(path) && path.endsWith('.wav')) {
            const packed = await this.getPackedSound(path)
            // decodeAudioData detaches its input; the archive cache must keep its own copy.
            if (packed) return packed.slice(0)
        }
        return this.fileLoader.getRawFile(path)
    }

    private async getPackedSound(path: string) {
        const directory = path.slice(0, path.lastIndexOf('/') + 1)
        const archives = this.fileLoader.getFilesListing().filter((name) =>
            normalizePath(name).startsWith(directory) && name.toLowerCase().endsWith('.snd'))
        for (const archive of archives) {
            if (!this.soundArchives.has(archive)) {
                this.soundArchives.set(archive, this.fileLoader.getRawFile(archive).then((data) => {
                    const base = normalizePath(archive).slice(0, archive.lastIndexOf('/') + 1)
                    return new Map(readSoundArchive(data).map((entry) =>
                        [base + entry.name, data.slice(entry.offset, entry.offset + entry.length)]))
                }))
            }
            const entry = (await this.soundArchives.get(archive)!).get(path)
            if (entry) return entry
        }
        return null
    }

    async hasFile(path: string) {
        path = normalizePath(path)
        if (await this.storage.has(path)) {
            return true
        }
        if (this.compat.packedSounds && path.endsWith('.wav') && !this.fileLoader.hasFile(path)) {
            return (await this.getPackedSound(path)) !== null
        }
        return this.fileLoader.hasFile(path)
    }

    saveFile(path: string, content: ArrayBuffer) {
        return this.storage.save(normalizePath(path), content)
    }

    async getANNFile(filename: string) {
        const data = await this.getFile(filename)
        return loadAnn(data, this.compat.trailingAnnFrameData)
    }

    async getFNTFile(filename: string) {
        const data = await this.getFile(filename)
        return parseFont(data)
    }

    async getCNVFile(filename: string) {
        filename = normalizePath(filename)
        const data = await this.getFile(filename)
        let text = this.repairKnownDefinition(filename, decryptCNV(data))
        if (this.compat.oznDefinitions) text = patchOznSource(filename, text)
        if (this.compat.magicieniiAssets) text = patchMagicieniiSource(filename, text)
        this.fileLoader.registerLogicalFilenames(this.getDirectoryPath(filename), text)
        console.debug(filename)
        console.debug(text)
        const definitions = parseCNV(text)
        if (this.compat.timeMachineDefinitions) patchTimeMachineDefinitions(filename, definitions)
        if (this.compat.nemoDefinitions) patchNemoDefinitions(filename, definitions)
        return definitions
    }

    async getSequenceFile(filename: string) {
        filename = normalizePath(filename)
        const data = await this.getFile(filename)
        const decoder = new TextDecoder()
        const text = decoder.decode(data)
        this.fileLoader.registerLogicalFilenames(this.getDirectoryPath(filename), text)
        console.debug(text)
        const entries = parseSequence(text)
        return this.compat.magicieniiAssets ? patchMagicieniiSequence(filename, entries) : entries
    }

    private getDirectoryPath(filename: string) {
        const index = filename.lastIndexOf('/')
        return index > -1 ? filename.slice(0, index) : ''
    }

    private repairKnownDefinition(filename: string, text: string) {
        if (filename === PIRATES_WIOSKA_PATH) {
            return this.repairPiratesWioskaDefinition(text)
        }

        if (filename === PIRATES_PALISADE_PATH) {
            return this.repairPiratesPalisadeDefinition(text)
        }

        if (filename === PIRATES_TEMPLE_PATH) {
            return this.repairPiratesTempleDefinition(text)
        }

        if (filename === PIRATES_MENU_PATH) {
            return this.repairPiratesMenuDefinition(text)
        }

        if (filename === PIRATES_BLAWA_PATH) {
            return this.repairPiratesBlawaDefinition(text)
        }

        if (filename === PIRATES_CIEMNOSC_PATH) {
            return this.repairPiratesCiemnoscDefinition(text)
        }

        if (filename === PIRATES_LASER_PATH) {
            return this.repairPiratesLaserDefinition(text)
        }

        if (filename !== PIRATES_RIVER_THREE_PATH) {
            return text
        }

        return this.repairPiratesRiverThreeDefinition(text)
    }

    private repairPiratesWioskaDefinition(text: string) {
        let repaired = text

        for (let i = 1; i <= 5; i++) {
            const callback = `ANIMOSPIEWAK${i}:ONFINISHED^PLAY=BEHLOOPSPIEWAK${i}`

            if (!repaired.includes(callback)) {
                repaired = repaired.replace(
                    `ANIMOSPIEWAK${i}:MONITORCOLLISIONALPHA=FALSE`,
                    `ANIMOSPIEWAK${i}:MONITORCOLLISIONALPHA=FALSE\n${callback}`
                )
            }
        }

        if (!repaired.includes('OBJECT=BEHLOOPSPIEWAK1')) {
            repaired = repaired.replace('\n#\n#BEHPLAYMELODIA\n#', `${PIRATES_WIOSKA_SINGER_LOOP_BEHAVIOURS}\n#\n#BEHPLAYMELODIA\n#`)
        }

        return repaired.replace(
            'BEHPLAYMELODIA:CODE={BUTTONSPIEWAK1^DISABLEBUTVISIBLE();BUTTONSPIEWAK2^DISABLEBUTVISIBLE();BUTTONSPIEWAK3^DISABLEBUTVISIBLE();BUTTONSPIEWAK4^DISABLEBUTVISIBLE();BUTTONSPIEWAK5^DISABLEBUTVISIBLE();SEQSPIEW^PLAY("SPIEW_1");}',
            'BEHPLAYMELODIA:CODE={BUTTONSPIEWAK1^DISABLEBUTVISIBLE();BUTTONSPIEWAK2^DISABLEBUTVISIBLE();BUTTONSPIEWAK3^DISABLEBUTVISIBLE();BUTTONSPIEWAK4^DISABLEBUTVISIBLE();BUTTONSPIEWAK5^DISABLEBUTVISIBLE();ANIMOSPIEWAK1^PLAY("PLAY");ANIMOSPIEWAK2^PLAY("PLAY");ANIMOSPIEWAK3^PLAY("PLAY");ANIMOSPIEWAK4^PLAY("PLAY");ANIMOSPIEWAK5^PLAY("PLAY");SEQSPIEW^PLAY("SPIEW_1");}'
        )
    }

    private repairPiratesPalisadeDefinition(text: string) {
        return text
            .replace('ANIMOREKSIO:PRIORITY=10', 'ANIMOREKSIO:PRIORITY=-100')
            .replace('IMGNAKLADKA1:PRIORITY=120', 'IMGNAKLADKA1:PRIORITY=1900')
            .replace('IMGNAKLADKA2:PRIORITY=1500', 'IMGNAKLADKA2:PRIORITY=1900')
            .replace('IMGNAKLADKA3:PRIORITY=1500', 'IMGNAKLADKA3:PRIORITY=1900')
            .replace('IMGNAKLADKA4:PRIORITY=105', 'IMGNAKLADKA4:PRIORITY=1900')
    }

    private repairPiratesTempleDefinition(text: string) {
        return text
            .replace('BUT_KAPLON:RECT=213,31,649,541', 'BUT_KAPLON:RECT=KAPLON')
            .replace(
                'BEH_POKAZ_ODP:CODE={BUT_ODP_OK^ENABLE();BUT_ODP_BAD^ENABLE();',
                'BEH_POKAZ_ODP:CODE={BUT_KAPLON^DISABLE();BUT_ODP_OK^ENABLE();BUT_ODP_BAD^ENABLE();'
            )
    }

    private repairPiratesBlawaDefinition(text: string) {
        return text
            .replace(
                'REKSIO16:ONFINISHED^DOPLANSZY17P={STOP_16_REKS^SET(0);RATUNEK^GOTO("CIEMNOSC");}',
                'REKSIO16:ONFINISHED^DOPLANSZY17P={STOP_16_REKS^SET(0);INT_DRZWI^SET(0);INT_Z_JAKIEJ_PLANSZY^SET(0);POZYCJAWULKAN^SET(17);RATUNEK^GOTO("CIEMNOSC");}'
            )
            .replace(
                'REKSIO16:ONFINISHED^DOPLANSZY17={STOP_16_REKS^SET(0);RATUNEK^GOTO("CIEMNOSC");}',
                'REKSIO16:ONFINISHED^DOPLANSZY17={STOP_16_REKS^SET(0);INT_DRZWI^SET(0);INT_Z_JAKIEJ_PLANSZY^SET(0);POZYCJAWULKAN^SET(17);RATUNEK^GOTO("CIEMNOSC");}'
            )
    }

    private repairPiratesCiemnoscDefinition(text: string) {
        let repaired = text

        if (!repaired.includes('OBJECT=BEH_PRAWOOUTBEZ_DONE')) {
            repaired = repaired.replace(
                '\n#\n#BEH_REKSIO_WCHODZI\n#',
                `${PIRATES_CIEMNOSC_TORCH_ENTRANCE_REPAIR}\n#\n#BEH_REKSIO_WCHODZI\n#`
            )
        }

        return repaired
            .replace('REKSIO17B:ONFINISHED^PRAWOOUTBEZ={17BEZPOCH^PLAY();}', 'REKSIO17B:ONFINISHED^PRAWOOUTBEZ=BEH_PRAWOOUTBEZ_DONE')
            .replace(
                /BEH_REKSIO_WCHODZI:CODE=\{POZYCJAREKSIA\^SET\("WULKAN"\);POZYCJAWULKAN\^SET\(17\);COND_CZY_POCHODNIA\^CHECK\(TRUE\);!?REKSIO17B\^PLAY\("PRAWOOUT"\);\}/,
                'BEH_REKSIO_WCHODZI:CODE={REKSIO17B^PLAY("PRAWOOUTBEZ");POZYCJAREKSIA^SET("WULKAN");POZYCJAWULKAN^SET(17);}'
            )
            .replace('BEH_REKSIO_WCHODZI_POCHODNIA:CODE={REKSIO17B^PLAY("PRAWOOUT");}', 'BEH_REKSIO_WCHODZI_POCHODNIA:CODE={REKSIO17B^PLAY("PRAWOOUTBEZ");}')
    }

    private repairPiratesMenuDefinition(text: string) {
        let repaired = text

        if (!repaired.includes('OBJECT=COND_PODWULKAN_CIEMNOSC')) {
            repaired = repaired.replace('\n# PODWULKAN\n#', `${PIRATES_MENU_VOLCANO_RESTORE_REPAIR}\n# PODWULKAN\n#`)
        }

        return repaired.replace(
            'PODWULKAN:CODE={MENUGLOWNE^RUN("RATUNEK","GOTO",SAVEROZDZIAL6);}',
            'PODWULKAN:CODE={COND_PODWULKAN_CIEMNOSC^CHECK(TRUE);}'
        ).replace(
            'DOPOSAGU:CODE={RATUNEK^GOTO("15POSAG");}',
            'DOPOSAGU:CODE={ROZDZIAL5^RESETINI();RATUNEK^GOTO("15POSAG");}'
        )
    }

    private repairPiratesLaserDefinition(text: string) {
        let repaired = text

        return repaired
            .replace('BUTEKRANU:ENABLE=TRUE', 'BUTEKRANU:ENABLE=FALSE')
            .replace(
                'WLACZCELOWNIK:CODE={CZYEKRAN^SET(1);TIMERSTRZALU^ENABLE();STRZAL^SHOW();}',
                'WLACZCELOWNIK:CODE={CZYEKRAN^SET(1);MOUSE^HIDE();STRZAL^PLAY("BEZRUCH");STRZAL^SETPOSITION(MOUSE^GETPOSX(),MOUSE^GETPOSY());TIMERSTRZALU^ENABLE();STRZAL^SHOW();}'
            )
            .replace(
                'POCZGRY:CODE={EKRAN^HIDE();GRUPAKAMIENI^SHOW();GRUPAKAMIENI^PLAY("BEZRUCH");!!!GRUPAKAMIENI^MONITORCOLLISIONS();!!!KAMIEN4^MONITORCOLLISION();!!!KAMIEN5^MONITORCOLLISIONS();!!!KAMIEN6^MONITORCOLLISIONS();NAKLADKA^SHOW();LAWINAANIMO^HIDE();LAWINAANIMO^SETPRIORITY(0);EKRANACTIVE^SET(1);CYFRY^PLAY("PLAY");WIN^SET(0);}',
                'POCZGRY:CODE={EKRAN^HIDE();GRUPAKAMIENI^SHOW();GRUPAKAMIENI^PLAY("BEZRUCH");!!!GRUPAKAMIENI^MONITORCOLLISIONS();!!!KAMIEN4^MONITORCOLLISION();!!!KAMIEN5^MONITORCOLLISIONS();!!!KAMIEN6^MONITORCOLLISIONS();NAKLADKA^SHOW();LAWINAANIMO^HIDE();LAWINAANIMO^SETPRIORITY(0);EKRANACTIVE^SET(1);BUTEKRANU^ENABLE();WLACZCELOWNIK^RUN();CYFRY^PLAY("PLAY");WIN^SET(0);}'
            )
            .replace(
                'KAMIENROZWALASIE:CODE={STRZAL^SETPRIORITY(25);KAMIENROZWALANY^SET(CANVAS_OBSERVER^GETGRAPHICSAT(STRZAL^GETPOSITIONX(),STRZAL^GETPOSITIONY()));MOUSE^SHOW();;KONDNAKLADKI^CHECK(TRUE);}',
                'KAMIENROZWALASIE:CODE={STRZAL^SETPRIORITY(25);KAMIENROZWALANY^SET(CANVAS_OBSERVER^GETGRAPHICSAT(STRZAL^GETPOSITIONX(),STRZAL^GETPOSITIONY(),TRUE,29,30));MOUSE^SHOW();;KONDNAKLADKI^CHECK(TRUE);}'
            )
            .replace(
                'KAMIENROZWALASIE2:CODE={24LASER^RUN(CANVAS_OBSERVER^GETGRAPHICSAT(STRZAL^GETPOSITIONX(),STRZAL^GETPOSITIONY()),"PLAY","STRZAL");STRZAL^SETPRIORITY(35);STRZAL^PLAY("BEZRUCH");TIMERSTRZALU^ENABLE();}',
                'KAMIENROZWALASIE2:CODE={24LASER^RUN(KAMIENROZWALANY,"PLAY","STRZAL");STRZAL^SETPRIORITY(35);STRZAL^PLAY("BEZRUCH");TIMERSTRZALU^ENABLE();}'
            )
            .replace(
                'PRZESUNIECIEBEH2:CODE={!!!STRZAL^HIDE();STRZAL^SETPOSITION(MOUSE^GETPOSX(),MOUSE^GETPOSY());24LASER^RUN("STRZAL","MOVE",XEXPRES1,YEXPRES1);PRZESUNIECIEBEH3^RUNC();}',
                'PRZESUNIECIEBEH2:CODE={!!!STRZAL^HIDE();STRZAL^SETPOSITION(MOUSE^GETPOSX(),MOUSE^GETPOSY());24LASER^RUN("STRZAL","MOVE",XEXPRES1,YEXPRES1);PRZESUNIECIEBEH3^RUNC();}'
            )
    }

    private repairPiratesRiverThreeDefinition(text: string) {
        let repaired = text

        if (!repaired.includes('OBJECT=ANIMOKROKODYL8')) {
            repaired = repaired.replace('\n#\n#ANIMOKROKODYL9\n#', `${PIRATES_RIVER_THREE_ANIMO8}\n#\n#ANIMOKROKODYL9\n#`)
        }

        if (!repaired.includes('OBJECT=SEQKROKODYL8')) {
            repaired = repaired.replace('\n#\n#SEQKROKODYL9\n#', `${PIRATES_RIVER_THREE_SEQUENCE8}\n#\n#SEQKROKODYL9\n#`)
        }

        if (!repaired.includes('OBJECT=BEHONCLICKKROKODYL8')) {
            repaired = repaired.replace(
                '\n#\n#BEHONCLICKKROKODYL9\n#',
                `${PIRATES_RIVER_THREE_CLICK8}\n#\n#BEHONCLICKKROKODYL9\n#`
            )
        }

        if (!repaired.includes('OBJECT=BEHATAKKROKODYLA8')) {
            repaired = repaired.replace(
                '\n#\n#BEHATAKKROKODYLA9\n#',
                `${PIRATES_RIVER_THREE_ATTACK8}\n#\n#BEHATAKKROKODYLA9\n#`
            )
        }

        if (!repaired.includes('OBJECT=CONDATAKKROKODYLA8')) {
            repaired = repaired.replace(
                '\n#\n#CONDATAKKROKODYLA9\n#',
                `${PIRATES_RIVER_THREE_ATTACK8_CONDITION}\n#\n#CONDATAKKROKODYLA9\n#`
            )
        }

        repaired = repaired.replace(
            'BEHATAKKROKODYLI:CODE={BEHBEZRUCHKROKODYLI^RUN();BEHATAKKROKODYLA3^RUNC();BEHATAKKROKODYLA4^RUNC();BEHATAKKROKODYLA5^RUNC();BEHATAKKROKODYLA6^RUNC();BEHATAKKROKODYLA9^RUNC();BEHATAKKROKODYLA11^RUNC();}',
            'BEHATAKKROKODYLI:CODE={BEHBEZRUCHKROKODYLI^RUN();BEHATAKKROKODYLA3^RUNC();BEHATAKKROKODYLA4^RUNC();BEHATAKKROKODYLA5^RUNC();BEHATAKKROKODYLA6^RUNC();BEHATAKKROKODYLA8^RUNC();BEHATAKKROKODYLA9^RUNC();BEHATAKKROKODYLA11^RUNC();}'
        )
        repaired = repaired.replace(
            'BEHBEZRUCHKROKODYLI:CODE={SEQKROKODYL3^PLAY("BEZRUCH");SEQKROKODYL4^PLAY("BEZRUCH");SEQKROKODYL5^PLAY("BEZRUCH");SEQKROKODYL6^PLAY("BEZRUCH");SEQKROKODYL9^PLAY("BEZRUCH");SEQKROKODYL11^PLAY("BEZRUCH");}',
            'BEHBEZRUCHKROKODYLI:CODE={SEQKROKODYL3^PLAY("BEZRUCH");SEQKROKODYL4^PLAY("BEZRUCH");SEQKROKODYL5^PLAY("BEZRUCH");SEQKROKODYL6^PLAY("BEZRUCH");SEQKROKODYL8^PLAY("BEZRUCH");SEQKROKODYL9^PLAY("BEZRUCH");SEQKROKODYL11^PLAY("BEZRUCH");}'
        )

        return repaired
    }

    async getIMGFile(filename: string) {
        filename = normalizePath(filename)
        if (!filename.endsWith('.img')) {
            filename = filename + '.img'
        }

        const data = await this.getFile(filename)
        if (this.compat.jpegImages && data.byteLength >= 40 && new DataView(data).getUint32(24, true) === 5) {
            return loadJpegBackground(data)
        }
        return loadImage(data)
    }

    async getARRFile(filename: string): Promise<any[]> {
        const data = await this.getFile(filename)
        const entries = deserializeArray(data)
        return this.compat.magicieniiAssets ? patchMagicieniiArray(filename.toLowerCase().replaceAll('\\', '/'), entries) : entries
    }
}
