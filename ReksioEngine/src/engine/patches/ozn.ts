export function patchOznSource(filename: string, source: string) {
    if (filename !== 'dane/reksioufo/przygoda/s1_0_intro1/s1_0_intro1.cnv') return source

    // The original player tolerates these stray colons after the closing parenthesis.
    return source
        .replace('UFOLECI:ONFINISHED^1={THIS^PLAY("2"):;}', 'UFOLECI:ONFINISHED^1={THIS^PLAY("2");}')
        .replace('TIMER1:ONINIT={THIS^DISABLE():;}', 'TIMER1:ONINIT={THIS^DISABLE();}')
        .replace('TIMERKUR:ONINIT={THIS^DISABLE():;}', 'TIMERKUR:ONINIT={THIS^DISABLE();}')
}
