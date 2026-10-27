# Reksio UI

Self-hosted browser launcher for a vendored ReksioEngine build.

The app builds the bundled `./ReksioEngine` web player into the Docker image, serves a launcher UI, and stores user-added ISO games in a persistent data volume. Custom local ISOs for Romanian, English, Turkish, Polish, and other language ports can be uploaded from the browser.

## Run with Docker

The engine source is included in:

```text
ReksioEngine/
  package.json
  yarn.lock
  src/
```

Build and run:

```sh
docker compose up --build
```

Open http://localhost:3030.

Uploaded games and metadata are stored in `./data` on the host:

```text
data/
  games.json
  games/
    <game-id>/game.iso
    <game-id>/files/
  logs/
    <session-id>.ndjson
    <session-id>-export-<timestamp>/
      console.ndjson
      screenshot.png
```

On startup, the container prepares the mounted data directory so uploaded games can be written by the app.

## Add Custom ISO

1. Open the launcher.
2. Click the add button in the library header.
3. Choose or drop a `.iso` file.
4. Set the title/language fields and upload.

The launcher stores the ISO locally, extracts it on the server during upload, and starts ReksioEngine with an extracted asset listing:

```text
/engine/?loader=listingjson&source=/api/games/<game-id>/listing
```

The raw ISO endpoint is still available at `/api/games/<game-id>/iso` for diagnostics. Docker includes `7zip` for extraction; local development needs `7z` on `PATH`, or `REKSIO_EXTRACTOR` set to a compatible executable. Existing entries uploaded before this behavior should be re-uploaded so their extracted `files/` folder is created.

## Snapshots

Open Snapshots with the archive icon in the game toolbar. It stays available at narrow window widths, where the game-details sidebar is hidden.

Snapshots normally use **scene-entry checkpoints**, not exact mid-animation save states. They capture the scene name, persistent global values, save JSON, and IndexedDB files from entry into the current scene. Restoring rebuilds the engine inside the existing iframe and returns directly to that scene. A minigame restarts from its entry state; earlier scenes do not need to be replayed.

For scenes using entry checkpoints, leave and re-enter the room before checkpointing puzzle changes made inside it. For example, Magicienii teleport parts fitted after entering the yard are included only after a yard round trip.

Nemo's `ARCADE` scene is an exception: several districts share that scene, so new snapshots capture its current persisted slot files and global values after the active script tick settles. These are labeled **Saved progress** and restore saved district, position, inventory and puzzle flags, rather than transient animation or dialogue state. Older scene-entry snapshots retain their original behavior.

Magicienii's `CAT` minigame also supports **Saved progress** snapshots. New captures retain the current hive/boots flags, inventory, save JSON and global values after the active tick finishes. Character positions, jumps and dialogue restart from scene entry; a hive already knocked down stays down, and collected boots remain in inventory. Restore reloads the selected inventory file and hides boots already owned, which the original room initializer otherwise redraws. A completed-puzzle snapshot was round-tripped in the browser after first restoring an older, unsolved checkpoint. Other Magicienii scenes and older Cat scene-entry snapshots keep their existing behavior.

Old snapshots remain available as **Legacy save files**. They restore saved files only and may require the game's own Load menu. They cannot be converted into a checkpoint after the fact.

Snapshots are stored in the browser's IndexedDB under the current host/origin. They survive Docker rebuilds and app restarts, but they are local to the browser profile.

Each game now has an isolated engine filesystem. Existing shared filesystem data is copied once for Magicienii without deleting the old database.

Magicienii checkpoint restores clear transient page-turn graphics before entering the saved scene, preventing a stale page corner from covering the yard or intercepting clicks. The Trace toggle updates the running player without reloading and captures its current diagnostic state; it can be switched off immediately after reproduction.

## Compatibility Profiles

Pirates uses the `default` profile, which preserves the existing engine behavior. The launcher selects `magicienii`, `ozn`, `nemo`, or `timpului` from the game title. New compatibility behavior is gated in `ReksioEngine/src/engine/compat.ts`; do not enable a new fix globally without regression testing Pirates.

Current compatibility work includes JPEG backgrounds, newer script local variables and return values, Nemo packed SND archives and cutscene tables, and subsection completion callbacks for Time Machine's intro. Magicienii and Time Machine load the original SEKAI v4 navigation graphs instead of using straight-line movement. Routes honor directional links, waypoint groups and scripted exact endpoints, using `ngraph.path` for graph search. All 139 local SEKAI files parsed successfully (126 navigation graphs, 69,024 waypoints); endpoint behavior was checked against the isolated native path routine. General WORLD physics and navigation acceleration remain incomplete; Time Machine's underwater and flying scenes have an isolated physics backend described below.

Magicienii's white-room entrance, hidden door, mirror room, arrival cutscene and full teleport-building puzzle have been verified. Chicken-yard and workshop passages, all required pickups, inventory selection, sixteen fitted components and final trousers activation have been exercised. A checkpoint with sixteen fitted components and the final item restores correctly. Activation from that restored checkpoint plays both travel cutscenes and reaches the office's opening dialogue. Office walking, multiple director topics and chained answers, the director's offer, the gatekeeper code panel, and entry into the university main hall have been verified. A 57-waypoint route down the hall's staircase completed successfully. The lower corridor passage, classroom door, Guldryk dialogue, practice dummy, and first spell lesson entry now work. Its corrected background checkpoint restores directly into the lesson. Repeated drawing strokes reached the original 100-movement requirement and advanced the voiced tutorial without an engine halt. Spell recognition and the first lesson's three-cast completion pass a script-level diagnostic; the full browser lesson and subsequent chapters remain unverified. The ten-slot inventory fills correctly and refuses further pickups until parts are used. The hall reports a missing `HOLGLOWNY/WST0.ARR` intro file, but walking continues.

Magicienii backgrounds honor their original signed IMG positions in both scene loading and scripted background changes. This removes the chicken yard's white top strip by applying its Y offset of -24, without modifying or cropping the 624-pixel asset. Background replacement and clearing reset the position. The corrected yard and its exit into the normally positioned assembly yard were checked in the browser; other profiles retain zero-position backgrounds.

Magicienii and Time Machine support byte-valued inventory opacity queries and preserve queued mouse click coordinates through asynchronous callbacks, including double-clicks. Magicienii additionally refreshes moved inventory sprites before consulting their pixel masks. Clearing a database resets its selected row only for Magicienii; the cursor factory previously retained an out-of-range row when loading the smaller office table and paused class ticking. Its database `FIND` also selects the matched row, as required by direct cursor reads in branching dialogue; unsuccessful searches leave the previous selection intact. Other profiles retain their existing lookup behavior. Magicienii also supports asynchronous numeric database lookup, NULL entrance-name lookup, named sound objects in dialogue sequences, fractional direction calculations, and named cutscene subsection callbacks. Checkpoints are available for the mirror room, chicken yard, assembly yard, office, director dialogue and offer, gatekeeper panel, university hall, lower corridor, classroom and first spell lesson. `ReksioEngine/src/engine/patches/magicienii.ts` repairs a misspelled idle voice reference, clears transient page overlays when restoring a checkpoint, and removes an unused editor-placeholder branch from the dialogue's `blank.seq`. That branch references an absent animation and otherwise prevents the answer sequence from initializing; its real `GADABLANK` branch is preserved.

Its spell lesson also needs profile-gated group `GETSIZE` and `REMOVEALL` operations; forwarding these calls to the actors previously halted entry. Cropped canvas saves now write the actual scaled pixel dimensions, fixing the black captured-room background. Scripted mouse warps use subsequent physical pointer deltas rather than accumulating absolute positions, anchor on real input rather than an uninitialized renderer pointer, and rebase when returning from launcher controls. A patch limited to `magic/magic.cnv` replaces the drawing wand's absent `PLAY` reference and numeric frame-count query with its actual `CZARUJE` event. Trace output includes tutorial phase, movement count, cursor position and spell readiness. These gameplay changes remain disabled for Pirates and the other compatibility profiles.

Magicienii's counted-loop `BREAK` propagates to the calling behaviour, matching the original `PIKLIB8.dll` loop control flow. Previously, recognition charged the wand but then reset the selected spell to `-1` after leaving its search loop. `ONE_BREAK` still skips only the current iteration; other game profiles retain their existing loop semantics. The same scene-specific patch calls the effect-sound behaviour with `RUN` instead of its unsupported `PLAY` method.

Run the optional local Magicienii diagnostic against an extracted `files/` directory:

```sh
node ReksioEngine/tests/verify-magicienii.cjs "path/to/extracted/files"
```

It loads the original game script and real interpreter, callback, value, mouse and wand-animation logic. It checks 12 exact spell shapes, 12 shapes rotated by 25 degrees, 12 rejected shapes rotated by 50 degrees, charging, three pudding casts, target defeat, completion callbacks, the learned flag and effect reset. Renderer output, sound playback and target hit testing are mocked; this is not a browser playthrough. No game assets are bundled with the diagnostic.

Magicienii alone enables `PATTERN` map objects, used by the broom, dragon and Fred minigames. Pattern entries place the current frame of a source animation on the original grid without moving the source actor. Copies preserve built-in image/frame offsets and anchor alignment while ignoring the source's offscreen translation. They follow animation, visibility and map scrolling; collision queries support hidden masks, layer selection and strict alpha thresholds. Removing entries or scenes releases the copies without destroying shared textures. The pattern interface and query ordering were inspected in the original DLL, not executed on the host. Unit tests use real PIXI transforms and hitmaps, including the compiled script argument guards. Live rendering and victory transitions remain unverified.

Magicienii's two-argument animation `SETFRAME` and frame-count queries distinguish numeric event indexes from string names. For `SETFRAME`, unknown names use event zero, matching the original engine; this avoids a stop on the dragon map's absent `G7` event instead of guessing a replacement graphic. Other profiles keep their previous event lookup behavior. `node ReksioEngine/tests/verify-magicienii-maps.cjs "path/to/extracted/files"` audits all 14 local map layouts, 1,413 grid placements, tile animation events and collision-mask references, including 14 references requiring the native event-zero fallback. This asset audit does not prove that the minigames are completable.

Fred's failure callback now disables keyboard input, its restart button and ambient dialogue timer without pausing the whole scene; the original callback already stops the player, enemies and collision animation. Pausing the scene also froze the failure sequence's completion queue, preventing a fresh-level request. This source repair is restricted to `Fred/Fred.cnv`. The optional diagnostic loads the real 72-tile map, all scene images/animations and the keyboard runtime, then completes a full-map route using only arrow-key events and animation ticks, with enemy damage enabled. It verifies wall rejection, 2,996 pixels of scrolling and the original `KROLOWA` story-return request. Both failure and manual-restart sequences finish using the real sequence parser and PIXEL animation. Global menu/audio initialization, ambient chatter timing, voice completion, screenshots and actual scene changes are fixture boundaries; this does not establish a full browser or normal-story Fred victory.

Separate-origin browser testing verifies Fred's rendered startup, arrow-key movement, moving enemies, energy loss, automatic restart after all energy is lost, and the in-game restart button after climbing away from the start. Both recovery paths play their original voice sequence and load a fresh Fred scene with the hero back at the start and full energy. A Fred scene-entry snapshot was created and restored, and Trace was switched off after exporting the recovery logs. The normal-story save and its spell-lesson tab were not changed.

Shooter's round-end source patch freezes the scene-owned playing animations, all three spawn timers, mouse/keyboard input and restart button, and stops background chatter without pausing the main dialogue processor. This avoids deadlocks on failure, restart and victory and applies only to `Shooter/Shooter.cnv`. Magicienii also enables the existing bounded `NEXTFRAME`/`PREVFRAME` implementation, previously limited to Nemo: Shooter uses a next-frame step to skip priority-only direction markers before transforming a hit enemy. Without it, a shot could award points while leaving the target unchanged. Frame stepping remains unchanged/unsupported in the other profiles.

The optional Magicienii diagnostic now loads both Shooter overlays and all images/animations, reads the three real level tables, and runs their spawn timers, foreground hit masks, mouse handlers, spell recognizer, ammo, scoring and sequences. It checks all 12 drawn spell shapes, five-shot offensive reloads, six shields and hits on all three enemy types. An automatic aiming test completes the actual three waves at 350/450/550 points using 70/58/52 unique targets and 14/12/11 drawn reloads, without injecting ammo, score, enemy positions or completion flags. Separate tests cover a naturally missed-enemy failure, restart and all three victory-routing callbacks. Learned-spell flags, global menu/cursor setup, deterministic cycling random choices, audio completion, screenshot capture and the requested next-scene load are fixture boundaries. This is not a full browser or normal-story Shooter victory.

Isolated browser testing verifies Shooter's rendered startup, enemy spawning, entry-checkpoint restore, restart dialogue followed by a fresh Shooter scene, and missed-enemy failure followed by the original Limbo scene/dialogue. Directly selecting Shooter in the debug scene list does not set `S_SLIMBORETURN`, which its normal courtyard entrance sets to `UNIVBACK`; Limbo then returns to an invalid arcade room. That debug-context failure is not patched with a guessed destination. The complete normal-entry failure round trip and browser victories remain unverified. The original spell-lesson tab and normal save remain unchanged.

Magicienii's `DRAGON` and `MIOTLY` scenes opt into the existing Cannon-es sphere, force and point-joint solver. Their duplicate-ID static meshes are combined so loading one wall does not discard another. The original scripts retain ownership of sprite positions and scrolling; physics does not apply actor movement twice. Other scenes and game profiles keep their previous behavior. Unit tests cover profile isolation, both static boundaries, pause behavior and the nine-body broom chain. The optional spell diagnostic above also runs the original broom initialization and movement scripts against the shipped world, checking thrust reversal and fixed screen-Y scrolling with empty collision masks. Browser controls, obstacle collisions and completion transitions still need verification.

Magicienii's `CAT` scene also enables that solver, with three-dimensional gravity, integer height queries, ground limits and its scripted body friction force. The linked sprite retains the native X/Y coordinates; the original script places its shadow using height. `INTEGER.LENGTH` assigns a truncated distance and returns the unrounded length in Magicienii, matching the inspected native routine; Time Machine keeps its previous return value. A Cat-only source patch converts the click direction to an integer eight-way animation name without changing shared expression arithmetic. The complete Cat puzzle has been verified in the browser through normal input: both heroes walk and stop, the cat jumps, the hive falls, the cat lands on the honey, the boots are picked up, and the original exit returns to the JAGA adventure room with its opening dialogue. A checkpoint at that adventure return also restores correctly. The optional diagnostic additionally checks all eight directions, jump/landing, real beehive-mask height guards, serialized puzzle flags, re-entry and the original boots pickup through real inventory database serialization, including duplicate rejection. A separate click-only route uses the original animation-driven update timing to complete the same puzzle and reach its exit request, without relocating actors or injecting completion flags after entry. Saved-progress tests capture the serialized array/database files, restore the hive, complete normal herding after restoration, and retain the collected boots without a duplicate reward. Audio, initial empty inventory construction, screenshot generation and the requested next-scene load remain diagnostic boundaries. Cannon-es remains a replacement solver, not an exact reproduction of SEKAI. Subsequent story quests remain unverified.

Magicienii's Game startup no longer attempts to warp the browser's system pointer to the centre. The native warp left the global custom cursor offset from the scene's actual click coordinates. Only that startup call is removed; the spell scene retains its explicit relative mouse warps. The diagnostic loads the shipped Game startup to check cursor/click alignment and confirms relative spell movement remains available.

The dragon scene supports forward/reverse animation playback through frame zero, loop endpoints and completion callbacks that restart the same animation. This playback path is restricted to Magicienii's `DRAGON` scene; all other scenes and profiles retain their existing timing. Magicienii also implements element-wise `ARRAY.SUB` with indexed change callbacks and a monotonic millisecond `SYSTEM.GETSYSTEMTIME` clock. These interfaces were checked against static disassembly of the original DLL. A Dragon-only source repair selects its high-detail parallax path instead of requesting a legacy CPU-frequency measurement; it does not add a fabricated `SYSTEM.GETMHZ` implementation.

The full dragon diagnostic loads each map's real images, animations, pattern masks and physics. It completes the first 15,000-pixel flight using 80 timed Space-key strokes, with obstacles, fire damage, water extinguishing, landing and takeoff enabled, and checks the original next-level request without injecting position, energy or completion flags. It also verifies a natural collision failure on the second map and the restart dialogue. Endings for maps 1-4 are separate boundary tests that advance the progress counter; they do not establish four more solved flights. Global menu setup, deterministic random choices, audio completion, screenshots, disk/browser persistence and actual scene changes are fixture boundaries.

The Lebiodka cutscene's copied, unused courtyard dialogue referred to four actors absent from that scene, aborting eager sequence loading before its real dialogue could start. A repair restricted to `Lebiodka/gadaja.seq` removes those four entries and reindexes only the three original `LEB` branches. Unit tests cover isolation, idempotence and unchanged replacement data. The real-asset diagnostic runs the scene's authored character animations and three dialogue branches through its request for Dragon map 2. Separate-origin browser testing also verifies the repaired dialogue's actual handoff to the volcanic map, that map's entry-checkpoint restore, and takeoff from water using timed Space presses. The normal-story save remains untouched. All five dragon flights and the full story route are not yet verified end to end.

Barandalf's first and third maps (`LEVEL0.SEK` and `LEVEL2.SEK`) also enable Magicienii's existing sphere/mesh solver. Unlike the broom and dragon, these maps rely on WORLD to synchronize their linked character sprite. Magicienii's animation-center queries now account for the PIXI anchor and transform, and rotation filters restore a saved copy of the anchor rather than its already-mutated reference. This prevents the mouse-following target from shifting during rotation. Other profiles retain their existing center/filter behavior. The optional diagnostic runs both original level initializers with real character/leaf/water animations, movement scripts and rotation filters; it checks upward mouse following, stopping near the pointer, repeated rotation cleanup, pause behavior and collision with each shipped map's obstacle mesh. Background/hotspot queries and audio are test boundaries. Live rendering and the first/third-map completion transitions remain unverified.

The middle boat-crossing puzzle enables Magicienii-only `BUTTON.GETSTD`, returning the current standard graphic's object name (or native `UNKNOWN` when absent). Magicienii animation callbacks also prioritize an explicitly registered frame-name handler over the event-level handler, preserving event/generic fallback and leaving other profiles unchanged. Static inspection of PIKLIB8's `onPlayableTick` confirmed this priority. Previously, character selection failed on `GETSTD`, and the named `SWAP` frame never repositioned boat passengers. The optional diagnostic uses the original six buttons and shipped boat/character animations to reject an unsafe bank, an incompatible passenger pair and a third passenger, then runs a seven-crossing solution through the original success decision and progress-write request. Audio, progress persistence and the next-scene transition are boundaries; this is not a browser playthrough.

Magicienii's maze enemy scripts now support `STRING.CUT(start,length)` and `ANIMO.ISAT(x,y,checkAlpha)`. CUT keeps the requested slice and treats nonpositive lengths as the remainder, matching native valid-index behavior. ISAT tests current animation bounds and optional nonzero alpha regardless of visibility, refreshes unrendered transforms, and excludes right/bottom edges before reading pixels. Both APIs were inspected statically in PIKLIB8 and remain disabled for other profiles. Missing CUT previously left clone suffixes in indirect object names, so enemy masks stayed at the origin; missing ISAT prevented autonomous path selection. The optional diagnostic runs original enemy initialization on all three maze maps, covering 16 enemy clones, matching field/mask/curse clones, four-direction movement and the DARK-state mask guard. It also runs 180 animation ticks per enemy through original patrol callbacks, checking 256 accepted and 117 rejected queries against the shipped path images' raw alpha pixels. Player/story setup, global obstacle queries and audio are boundaries. Player puzzles, enemy interaction with global obstacles, scene rendering and maze exits remain unverified.

Magicienii animation clones now join the renderer even when their source template has `TOCANVAS=FALSE`. Static inspection of `CMC_Animo::clone` confirmed that native clones are registered independently, inheriting the source's current canvas priority or zero when the source is absent from the canvas. This fixes maze enemy sprites that previously remained detached despite running their movement scripts. The three-map diagnostic now uses a real PIXI stage to check registration and visibility of all 16 enemy clones, then verifies sprite release on scene cleanup. Unit tests cover on/off-canvas templates, changed priorities, shared textures and unchanged behavior in all other profiles. These are renderer-ownership checks, not browser/GPU pixel verification.

Magicienii also retains and dispatches case-sensitive `KEYBOARD.ONCHAR` handlers. They were previously lost by the CNV schema and never emitted by the keyboard runtime, preventing the maze's number-key character selection. Character events are queued after keydown, preserve letter case and use unshifted top-row digits, as inspected in the native keyboard routines. Browser/system modifier chords do not generate characters; repeat and enable/disable settings are honored. Extended letter/digit key mapping and character dispatch remain disabled for other profiles. Tests cover handler retention, callback order, repeat suppression, modifiers, listener cleanup and profile isolation. The optional diagnostic uses synthetic key events with the real keyboard/interpreter, original player initialization and shipped room masks for all three maze maps: 16 selections, prisoner/unavailable-character guards, 52 full-tile moves and 52 wall rejections. Actors are relocated to isolated test cells; rescuing prisoners, moving enemies, pressure-button logic, exit artwork, dialogue audio and persistence are boundaries. This does not verify the maze puzzles, exits or a browser playthrough.

The maze's absent `BLANK.ANN` and `PRZEDMIOTY1.ANN` editor placeholders now produce empty animation data only for their two exact paths, only under Magicienii, and only when no real asset exists. Native animation loading retains an object after a failed file open; the web loader previously removed it, leaving later scripted LOAD calls without a target. Empty animations have no events, items or hit pixels. Existing replacement files and unrelated missing/corrupt assets retain normal loading/error behavior. The broader optional diagnostic now uses the real filesystem and loads every maze image/animation before running the original level, plate/switch and player initializers for all three maps. It checks 96 queryable plate press/release cases, eight registered switch handlers, switch-state serialization/reload through an in-memory file store, main-character exit guards and four original exit-button routing decisions with real artwork and pointer callbacks. Leaving the prisoner map without the prisoners does not award rescue success. Actors are relocated for these checks; screenshot capture, actual scene changes, sound and disk/browser persistence are boundaries. Normal routes and teleport/rescue solutions remain unverified. The earlier control diagnostic was also corrected to load each map's runtime `MASK0/1/2.IMG`, rather than the base definition's initial mask for every map.

Isolated browser testing now verifies the first maze's rendered map, moving hazards, arrow-key movement, enemy damage, restart button and automatic recovery after losing all three lives. Death previously froze the scene's sequence tick queue, preventing its failure-dialogue completion from restarting the level. A source patch restricted to `Labirynt.cnv` freezes a group of currently playing animations and disables input while the original dialogue sequence finishes. Magicienii's `GETPLAYINGANIMO` also includes animations owned by the target scene through CNV overlays or nested parents, without including unrelated global/scene actors. The diagnostic exercises both recovery paths with the real sequence parser and PIXEL animation; voice completion, screenshot and scene-change requests are boundaries there. This is a targeted maze workaround, not a complete reproduction of native scene/audio pause semantics. Other profiles retain their existing behavior. A maze-entry checkpoint was created and restored on the separate `127.0.0.2` browser origin, without modifying the normal-story checkpoints on `localhost`. The full maze puzzles and normal-story entry remain unverified.

Magicienii's `ANIMO.SETCLIPPING` uses image-local rectangles, including native zero-size disabling. Clones and pattern copies own independent PIXI masks, which follow movement and frame-size changes and are released without destroying shared textures. Clipped pixels are excluded from pattern hit tests. Geometry tests cover scale, anchors, scrolling, mask cleanup and PIXI's calculated WebGL scissor commands, not GPU rendering. The optional spell diagnostic now uses the same argument-guard transformer as the built engine. It additionally checks six original `FIRE.ANN` frames and runs the original level-initialization routine for all five dragon maps: 584 tile/fire placements, duplicate-cell replacement, fire clipping, opaque-pixel queries, projectile-array setup and scene cleanup. The map templates, pattern objects, wing animation and physics are real; other actors, audio and the browser renderer remain mocked or absent.

Magicienii's alchemy controls support dynamic button hover/press images and pixel-tested image buttons, including the recipe sheet's focus callbacks and scrolling. Image-button callbacks are preserved by the CNV schema, listeners are released on teardown, and recipe image clones now join the renderer at their source priorities. The profile also enables literal string replacement and signed 32-bit integer OR for recipe effects. First entry supports the original UTC second/minute/day calls used to create its save prefix, including PIKLIB8's day-of-month-plus-one behavior. A source patch fixes three misspelled exit-image priority calls only in `Arcade/Alchemy.cnv`. Other game profiles keep these new control, arithmetic and clock APIs disabled; OZN retains its existing image-clone rendering. The optional diagnostic runs first/repeat alchemy initialization with real images and button logic, verifies all 256 ingredient subsets, and exercises three representative mixtures, recipe illustrations, the temporary-small escape name, success rewards, ingredient consumption requests and the cellar-exit decision. Audio/animation completion is driven or mocked, and room/inventory/save operations use an in-memory boundary: live brewing visuals, actual persistence and the full quest route remain unverified.

Magicienii's cup puzzle (`KUBKI`) can clear a button's standard graphic with `SETSTD("NULL",FALSE)`, matching the statically inspected native `CButton::Set` null-graphic path. This removes the empty-space hover/drop exception without accepting other invalid graphic names. Its draggable buttons also track the mouse-down position and move even without an `ONDRAGGING` script callback; the first movement is retained and stage listeners are removed on drop or destruction. Stage-only release also clears the pressed state when a moved/hidden source misses PIXI's `pointerupoutside`, allowing repeated drags. These changes are restricted to the existing Magicienii button-control profile. The real-asset diagnostic uses the original mouse, buttons, hit masks and sequence: it rejects an invalid coin drop, nests three cups, places all three coins in the top cup, completes the success dialogue and requests the original `SEZAM` story return. Global menu setup, audio completion, screenshots and the actual scene load are fixture boundaries.

Dragging preserves the grabbed graphic's center across scripted anchor/frame changes, rather than jumping the cup or coin offscreen. Releases queued before mouse-down processing finishes also complete their normal release/end-drag callbacks. Tests check each drag step's visible position, stage-only releases, rapid repeated clicks and unchanged behavior in every other profile. The full cup solution has also been completed in the separate-origin browser tab using two cup drags and three coin drags, followed by the original success dialogue and actual return to Sezam. The cup-entry and completed-puzzle story-return checkpoints were saved and restored; the normal-story save remains untouched.

Time Machine's title menu, first two story cutscenes, first yard, chicken yard and workshop now run. Curator dialogue, yard exits, umbrella, barrel, vacuum and horn pickups, inventory selection and item cancellation have been verified. The barrel, vacuum and horn fit successfully, reaching build stage 4 with the umbrella still held in inventory. Normal story play also verified all sixteen crane components: collecting them across the workshop, doghouse, chicken yard, assembly yard and pond, fitting them in their required stages, activating the completed crane, and entering the first dive through its dialogue and cutscene. Completed-crane, normal first-dive and drained-pond checkpoints are available. The completed-crane checkpoint restored successfully after a Docker rebuild. Both characters' chicken-yard movement was rechecked using SEKAI routes, including clicks clamped to walkable waypoints. Later chapters remain unverified. Its JPEG alpha masks use the actual decompressed view length, and sequences can chain from their completion callbacks. Time Machine alone supports directly named non-parameterized sequence roots, required by the first-dive cutscene; other profiles retain parameterized playback. Game-specific repairs in `ReksioEngine/src/engine/patches/timpului.ts` keep music filenames out of an integer variable and initialize the dynamically loaded character with a valid placeholder.

Time Machine's `NUREK.SEK` WORLD uses `ReksioEngine/src/engine/compat/timeMachinePhysics.ts`, backed by pinned `cannon-es` rigid-body collision and joint solving. It loads the original collision triangles, simulates planar spheres and joined objects, applies scripted gravity, directed magnetic attraction and exclusions, reports collision signals, and follows the native bounded camera convention. WORLD accumulates elapsed time between runner callbacks, returns seconds to the script, and caps individual physics steps to 30ms. Native DLL interfaces were inspected statically, not executed on the host. This is a replacement solver, not an exact reproduction of the original physics.

Isolated browser testing through the existing debug scene selector verified descent, sustained directional forces, floor collision, scrolling, magnetic interactions and electric shock, the drain-the-pond transition, surfacing, leaving to the pond, and diving back in. A subsequent normal-route test verified first-dive movement and magnet controls, the pond-draining cutscene, and return to the drained pond. Recovery of every item remains unverified. Time Machine's moving light cone now multiplies the water's alpha mask and reuses its render texture; mask resources are released on image reload or destruction. Surface CNV overlays release their own objects and restore replaced scene helpers. Focus notifications, sequence-name queries and two-argument arctangent support are enabled only for Time Machine. Other profiles keep their prior behavior. Trace includes its keyboard transitions and applied forces.

The same backend also loads `TEREN.SEK` only in Time Machine's `SAMOLOCIK` flying scene. This mode permits height movement and ground collisions while the script fixes the UFO's altitude. It supplies velocity magnitude and heading, two-axis camera scrolling, and repulsive gravity centers. Time Machine integer vector-length queries assign floored Euclidean distances. Isolated browser testing verified the rendered UFO, forward thrust, turning, vertical and horizontal scrolling, terrain collision voices and effects, visible moving enemies, and restoration of a flying-scene entry checkpoint. Normal-story entry and the four-enemy completion condition remain unverified. Other game profiles retain their previous WORLD behavior.

Time Machine's `SAMOCHODZIK` and `PIESZO` instead load `timeMachineVehiclePhysics.ts`, using pinned [Rapier 3D](https://rapier.rs/docs/user_guides/javascript/getting_started_js/) 0.21.0 for chassis-box/terrain-mesh contacts and spherical wheel joints. It supports original full box dimensions, sphere masses, gravity-center exclusions, height queries, collision triggers, bounded scrolling and WASM cleanup on scene release. The underwater and flying solvers are not replaced. Body rotation now preserves the full yaw range instead of folding past 90 degrees, and Time Machine alone supports the floating-point absolute-value query used for chassis tilt scaling. Physical integration remains capped at 30ms; this backend is not an exact native-solver reproduction.

Isolated browser tests verified car entry with four ammonite wheels, forward driving, steering, reverse motion, scrolling, terrain-based chassis scaling, chasing enemies, and restoration of the same car-entry checkpoint across a Docker rebuild. The walking scene loads and executes its native capture/return to the prehistoric workshop. Story prerequisites, the car's victory exit and all wheel combinations remain unverified. The Time Machine debug panel adds four **Car Wheels** selectors, used only when its scene selector jumps to `SAMOCHODZIK`; normal story transitions retain their own configuration. Entry checkpoints preserve that selected configuration, not live vehicle motion. The app build preserves ES modules so the Rapier dependency is a separate lazy chunk, not part of other games' initial payload. Pirates' opening and shipwreck rendering/interaction were rechecked after this bundling change.

Time Machine enables the same byte-valued inventory opacity query and queued click coordinates as Magicienii. Missing `GETOPACITY` previously paused the engine on inventory hover; delayed clicks could also use a later pointer position and fail to select an item. Its profile synchronizes newly linked sprites to already positioned WORLD bodies, including an explicit origin, so restored entry dialogue no longer leaves both characters floating at the temporary `(400,300)` position. Linking does not fire arrival callbacks early, and Magicienii retains its existing linking policy. Trace includes the current arcade room, inventory count, selected item, use target and build stage.

Nemo reaches Paris after both opening story sequences. Paris checkpoints restore directly, dialogue advances through successive database rows, and the scripted grid pathfinder supports walking. The first-to-second district transition, lamplighter interaction, lamp-lighter pickup, inventory expansion and item selection have been verified. The second district's street-level stairway and northeastern passage into the bakery district also work. Its profile handles trailing ANN frame extensions, reusable packed audio buffers, dynamic walker placeholders, class constructor names, invisible hotspot transforms, class-owned player sprites, rectangular button priorities and inventory frame stepping. It reloads the selected save-slot database after checkpoint restoration. New arcade checkpoints preserve in-scene saved progress; restoring district two with the lamp-lighter held and restoring the bakery district have been verified in the browser. All 977 ANN files in the local Nemo extraction were decoded successfully during the format audit. Later puzzles and chapters are not yet verified.

Nemo also enables inclusive clone-group ranges, group collection methods and wrapping marker iteration, and forwards grouped class commands into their behaviour scopes. Its canvas observer supports relative background scrolling, absolute background positions, and stamping the current frame of a hidden template into an owned render texture without moving the live actor. Background replacement releases that texture without destroying shared source images. Isolated Eiffel Tower testing verified scene-entry checkpoint restoration, walking, ladder movement, camera scrolling and active grouped enemies/platforms. Its single RGB555 image now decodes as 15-bit color instead of RGB565, fixing the fluorescent green tower structure; all other local Nemo images and animations use 16-bit color. Background stamping has focused unit coverage but the full `BDUSA` board and minigame victories remain unverified. These additions are disabled for the other game profiles.

OZN's intro, menu, first conversation and transition to the next yard have been verified. Its digging minigame now has a profile-gated MATRIX simulation in `ReksioEngine/src/engine/compat/oznMatrix.ts`, covering falling and rolling stones, gate checks, enemy wall following, and queued movement callbacks. Its image clones are added to the renderer with their original priorities. Digging movement, dynamite pickup, blasting wall tiles, restarting the board and restoring its scene-entry checkpoint have been verified. The simulation was compared against 300 isolated original-DLL ticks and 18,000 enemy direction decisions. The replacement runs as TypeScript; no native DLL is executed. The full minigame and later stages remain unverified. Three malformed intro callbacks are repaired only for that game's opening script in `ReksioEngine/src/engine/patches/ozn.ts`. Pirates' opening and shipwreck interaction were smoke-tested on the default profile; its existing compatibility behavior remains the baseline.

Newer-script compatibility includes typed callback arguments, struct-field writes, sequential database searches, numeric dynamic callbacks, computed handler names, and clone cleanup. These changes are disabled for Pirates. Named sequence subsections fire only their explicit callbacks; single-entry sequences finish once. Player teardown also releases old object scopes and input listeners when restoring checkpoints. Trace logs include changed hotspot results and database search values, matched rows and cursor positions, and suppress repeated stationary mouse queries. Sound playback logs identify the actual dynamically loaded file rather than its initial placeholder; each playback retains its filename even if the sound object is subsequently reloaded.

For local debugging, append `&scene=ARCADE&sceneObject=BIALO` to a Magicienii launcher URL that already contains `?game=<game-id>`. This initializes the persistent game objects and enters the white room; use `LUSTRO` for the mirror room. These parameters can write the game's normal save files, so create a checkpoint before testing. Remove both parameters to return to normal startup. They are not applied when selecting a different game.

Appending `&debug=true` forwards the engine's existing scene selector and controls only for the game named in that launcher URL. Use a separate origin, such as `http://127.0.0.2:3030`, for direct scene experiments: it has separate browser saves from `http://localhost:3030`. Direct scene entry can skip story prerequisites and modify that origin's save data; do not treat it as a full playthrough.

Run focused compatibility regression tests with `npm test --prefix ReksioEngine`, plus `npm run check` and `npm run build --prefix ReksioEngine`. Then run `.\rebuild.bat` for the Docker deployment. Reaching a title or menu is not evidence that an entire game is playable; gameplay still needs scene-by-scene verification.

## Local Working Files

`./ReksioEngine` is vendored source and is required by the Docker build. Its local `.git`, `.github`, `node_modules`, and `dist` folders are ignored.

`./ISOs` is intentionally ignored by the UI repository. Use it for private disc images while testing compatibility.

Current local ISO focus:

1. `Reksio si Magicienii.iso`
2. `Reksio si Comoara Piratilor.iso`
3. `Reksio si OZN-ul.iso`
4. `Reksio si Masina Timpului.iso`
5. `Reksio si Capitanul Nemo.iso`

Release order reference:

1. `Piratilor`
2. `OZN-ul`
3. `Magicienii`
4. `Masina Timpului`
5. `Capitanul Nemo`

## Configuration

Environment variables:

| Name | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3030` | HTTP port inside the container |
| `REKSIO_DATA_DIR` | `/data` | Persistent metadata, logs, and uploaded ISO directory |
| `REKSIO_ENGINE_DIR` | auto-detected | Override the directory served at `/engine` |
| `REKSIO_EXTRACTOR` | `7z` | ISO extraction command used for custom uploaded games |
| `MAX_ISO_SIZE_BYTES` | `8589934592` | Upload limit, default 8 GB |

## Local Development

Install dependencies and start the launcher server:

```sh
npm install
npm start
```

Local development serves the launcher and APIs. The `/engine` route uses `REKSIO_ENGINE_DIR` when set, then `ReksioEngine/dist/app` when it exists, then the Docker/static fallback at `public/engine`.

For local game playback outside Docker, build the engine first:

```sh
cd ReksioEngine
corepack yarn build
cd ..
npm start
```

When `ReksioEngine/dist/app` exists, the launcher serves it at `/engine`. Docker still serves the image-built bundle from `public/engine`.
