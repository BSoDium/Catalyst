/**
 * Sleigh bells for the `?xmas` Easter egg: a recording ("Bells jingling 2", dragon-studio, trimmed to 3.4 s with a fade-out; `/audio/sleigh-bells.mp3`),
 * played ONCE, faintly, as the picture's start-up begins (the file is fetched as soon as the picture is built). It plays only if the browser lets the page (not before the visitor has interacted
 * with it: a refused try is silent) and the picture is in view and the tab visible: if it is not, the try is repeated every second for up to 20 s, so that
 * the bells come when the visitor first sees the picture, and never twice. Stopped, it ends the sound and closes its audio context.
 */
export interface SleighBellsOptions {
  canPlay?: () => boolean;
}

const URL = "/audio/sleigh-bells.mp3";
const VOLUME = 0.3;

export function createSleighBells({ canPlay = () => true }: SleighBellsOptions = {}) {
  let running = false;
  let timer = 0;
  let ctx: AudioContext | null = null;
  let tries = 0;
  let data: Promise<ArrayBuffer> | null = null;
  const fetchData = () => (data ??= fetch(URL).then((r) => r.arrayBuffer()));

  const attempt = async () => {
    if (!running) return;
    if (document.hidden || !canPlay() || typeof AudioContext === "undefined") return retry();
    let c: AudioContext;
    try {
      c = new AudioContext();
      await Promise.race([c.resume(), new Promise((r) => setTimeout(r, 300))]);
    } catch {
      return retry();
    }
    // (not allowed to make sound yet: silent, and the next try may be)
    if (c.state !== "running" || !running) {
      c.close().catch(() => {});
      return retry();
    }
    try {
      const buffer = await c.decodeAudioData((await fetchData()).slice(0));
      if (!running) return void c.close().catch(() => {});
      ctx = c;
      const gain = c.createGain();
      gain.gain.value = VOLUME;
      const src = c.createBufferSource();
      src.buffer = buffer;
      src.connect(gain).connect(c.destination);
      src.onended = () => {
        if (ctx === c) ctx = null;
        c.close().catch(() => {});
      };
      src.start();
    } catch {
      c.close().catch(() => {});
    }
  };
  const retry = () => {
    if (!running || ++tries > 20) return;
    timer = window.setTimeout(attempt, 1000);
  };

  return {
    /** Fetch the recording now (it is decoded when it is played). */
    load() {
      void fetchData().catch(() => {});
    },
    start() {
      if (running) return;
      running = true;
      tries = 0;
      // (with the start-up: the first tube's flicker)
      void attempt();
    },
    stop() {
      running = false;
      window.clearTimeout(timer);
      const x = ctx;
      ctx = null;
      if (x && x.state !== "closed") x.close().catch(() => {});
    },
  };
}
