import { describe, expect, it } from "vitest";
import { CAPTION_FACE, CaptionMotion, DRIFT, cycleMs, eggMs, eggX, entranceMs, placeEgg, shellXY, type CinematicPlan } from "./caption";
import { CINEMATIC, planCinematic } from "./cinematic";
import { SOUND } from "./cinematic-sound";
import { markPlayed, visitState } from "./visit";
import { CAPTION } from "./tuning";

const store = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};
const base = { returning: true, played: false, reduced: false };

describe("the cinematic interlude: when it may play", () => {
  it("never for a first visit, a session that has seen it, or reduced motion", () => {
    for (let seed = 1; seed < 400; seed++) {
      expect(planCinematic({ ...base, seed, returning: false })).toBeNull();
      expect(planCinematic({ ...base, seed, played: true })).toBeNull();
      expect(planCinematic({ ...base, seed, reduced: true })).toBeNull();
    }
  });
  it("is rare, and decided by the seed alone", () => {
    const plays = Array.from({ length: 4000 }, (_, i) => planCinematic({ ...base, seed: i * 7919 + 3 })).filter(Boolean);
    expect(plays.length / 4000).toBeGreaterThan(CINEMATIC.chance * 0.7);
    expect(plays.length / 4000).toBeLessThan(CINEMATIC.chance * 1.3);
    expect(planCinematic({ ...base, seed: 12345 })).toEqual(planCinematic({ ...base, seed: 12345 }));
  });
  it("begins at the second or the third time the first row would leave, early enough to be over before the idle hold", () => {
    const ns = new Set<number>();
    for (let i = 0; i < 4000; i++) {
      const p = planCinematic({ ...base, seed: i * 7919 + 3 });
      if (p) ns.add(p.n);
    }
    expect([...ns].sort()).toEqual([...CINEMATIC.cycles]);
    // it may begin late enough to run past the idle hold (it is 21 s long): the renderer's hold waits for an interlude under way
    // (`freezeWhenIdle`), so what is asked here is that it begins after the visitor has settled and before the hold would
    const latestStart = Math.max(...CINEMATIC.cycles) * cycleMs() + CAPTION.enter.ms + CAPTION.cycle.dwellMs;
    expect(latestStart).toBeGreaterThan(10000);
    expect(latestStart).toBeLessThan(30000); // ENERGY.idleFreezeMs
  });
  it("the force flag plays it at the first exit, whatever the visit says (but not under reduced motion)", () => {
    expect(planCinematic({ ...base, seed: 1, returning: false, played: true, forced: true })?.n).toBe(0);
    expect(planCinematic({ ...base, seed: 1, forced: true, reduced: true })).toBeNull();
  });
  it("one word, at least twice the size, from the east, on a higher orbit than the rows'", () => {
    expect(CINEMATIC.word).toBe("UNIVERSAL");
    expect(CINEMATIC.capScale).toBe(2);
    expect(CINEMATIC.side).toBe(1);
    expect(CINEMATIC.radius).toBeGreaterThan(CAPTION.radius);
  });
});

describe("the cinematic interlude: the big word's place", () => {
  /** About what "UNIVERSAL" is in the heavy serif, tracked: nine capitals. */
  const box = { widthEm: 7.4, aboveCaps: 1.15, belowCaps: 0.2 };
  const o = { fill: CINEMATIC.fill, minCap: CINEMATIC.capScale * CAPTION.capR, maxCap: CINEMATIC.maxCapScale * CAPTION.capR, ampRad: (CINEMATIC.shape.ampDeg * Math.PI) / 180 };
  const sil = (d: number) => 1 / Math.sqrt(d * d - 1);

  it("sits on the equator: its baseline is half its cap height under it", () => {
    for (const d of [3.2, 4.5, 8, 13]) {
      const p = placeEgg(box, d, CINEMATIC.radius, o);
      expect(p.baseLat).toBeCloseTo(-(p.capR / CINEMATIC.radius / (Math.PI / 180)) / 2, 9);
    }
  });
  it("is as large as its chord allows, between twice the rows' cap and its maximum", () => {
    for (const d of [3.2, 4.5, 8, 13]) {
      const p = placeEgg(box, d, CINEMATIC.radius, o);
      expect(p.capR).toBeGreaterThanOrEqual(o.minCap - 1e-12);
      expect(p.capR).toBeLessThanOrEqual(o.maxCap + 1e-12);
    }
  });
  it("never reaches farther than its share of the planet's silhouette on the screen, for any camera in the band", () => {
    for (const d of [3.2, 4.5, 8, 13]) {
      const p = placeEgg(box, d, CINEMATIC.radius, o);
      if (p.capR <= o.minCap + 1e-9) continue; // (the smallest is returned when none fits)
      for (const cam of [CAPTION.band.deg, -CAPTION.band.deg, 0]) expect(Math.abs(shellXY(Math.min(p.halfSpan, Math.PI / 2), p.baseLat, cam, d, CINEMATIC.radius)[0])).toBeLessThanOrEqual(CINEMATIC.fill * sil(d) + 1e-9);
    }
  });
  it("is bigger than the rows' letters, and wider on the screen than a row of the block", () => {
    const p = placeEgg(box, 4.5, CINEMATIC.radius, o);
    expect(p.capR).toBeGreaterThanOrEqual(2 * CAPTION.capR - 1e-12);
    expect(CAPTION_FACE.capEm).toBeGreaterThan(0);
  });
});

describe("the cinematic interlude: knowing a return", () => {
  it("a first visit is new for its whole session (a reload is not a return), the next session is a return", () => {
    const local = store();
    const s1 = store();
    expect(visitState(local, s1)).toEqual({ returning: false, played: false });
    expect(visitState(local, s1).returning).toBe(false); // (a reload in the same session)
    expect(visitState(local, store()).returning).toBe(true); // (another session)
  });
  it("remembers that it played, for the session", () => {
    const local = store({ "site-seen": "1" });
    const s = store();
    expect(visitState(local, s)).toEqual({ returning: true, played: false });
    markPlayed(s);
    expect(visitState(local, s)).toEqual({ returning: true, played: true });
  });
  it("no storage, or storage that throws: not a return", () => {
    expect(visitState(null, null).returning).toBe(false);
    const bad = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(visitState(bad, bad).returning).toBe(false);
    expect(() => markPlayed(bad)).not.toThrow();
  });
});

describe("the cinematic interlude: the big row's trajectory", () => {
  const s = CINEMATIC.shape;
  const start = 2.4;
  const tIn = s.enterMs + s.holdMs + s.exitMs;
  it("is long and gentle: slow to rise, a long settle, and a hold that rolls a little", () => {
    expect(s.enterMs).toBeGreaterThanOrEqual(4 * CAPTION.enter.ms);
    expect(s.ease).toBeLessThan(DRIFT.ease);
    expect(eggX(0, start, s)).toBe(start);
    expect(eggX(s.enterMs, start, s)).toBeCloseTo((s.ampDeg * Math.PI) / 180, 12);
    expect(eggX(s.enterMs + s.holdMs, start, s)).toBeCloseTo(-(s.ampDeg * Math.PI) / 180, 12);
    expect(eggX(tIn, start, s)).toBeCloseTo(-start, 12);
    expect(eggX(tIn + 1000, start, s)).toBe(-start);
  });
  it("only ever moves on: monotone from behind the planet on one side to behind it on the other", () => {
    let last = Infinity;
    for (let t = 0; t <= tIn; t += 5) {
      const x = eggX(t, start, s);
      expect(x).toBeLessThanOrEqual(last + 1e-9);
      last = x;
    }
  });
  it("takes well under the idle hold (and is as long as the sound it was made to)", () => {
    expect(eggMs(s)).toBeLessThan(26000);
    expect(Math.abs(eggMs(s) / 1000 - SOUND.fileSec)).toBeLessThan(0.6); // the sound's own length
  });
  it("lands its word when the sound's final chord is (SOUND.hitSec into the file)", () => {
    expect((s.leaveMs + s.gapMs + s.enterMs) / 1000).toBeCloseTo(SOUND.hitSec - SOUND.fromSec, 6);
  });
});

describe("the cinematic interlude: in the caption's motion", () => {
  const plan: CinematicPlan = { n: 1, shape: CINEMATIC.shape, side: CINEMATIC.side };
  const starts = [2.2, 2.4, 2.6, 2.8];
  const at = () => plan.n * cycleMs() + CAPTION.enter.ms + CAPTION.cycle.dwellMs;
  const make = (p: CinematicPlan | null = plan) => {
    const m = new CaptionMotion();
    m.egg = p;
    m.setStarts(starts);
    m.setFixedFrom(2);
    m.setEggStart(2.4);
    m.settle(true);
    m.tick(0);
    return m;
  };
  /** Run the caption's clock to `until` ms, a frame every 16 ms; returns the time reached. */
  const run = (m: CaptionMotion, until: number, from = 0): number => {
    let now = from;
    while (now < until) m.tick((now += 16));
    return now;
  };
  const rows = (m: CaptionMotion, now: number) => starts.map((s, i) => m.angle(now, i, s));

  it("waits for its moment, then begins once, and only from the rest", () => {
    const m = make();
    let told = 0;
    m.onCinematic = () => told++;
    const now = run(m, at() - 100);
    expect(m.phase).toBe("rest");
    expect(told).toBe(0);
    run(m, at() + 100, now);
    expect(m.phase).toBe("egg");
    expect(told).toBe(1);
  });
  it("can be played now (the owner's key): from the roll, once at a time, and again after it has been spent", () => {
    const m = make();
    let told = 0;
    m.onCinematic = () => told++;
    const now = run(m, 2000); // (long before its moment)
    expect(m.phase).toBe("rest");
    expect(m.replayEgg(now)).toBe(true);
    expect(m.phase).toBe("egg");
    expect(told).toBe(1);
    expect(m.replayEgg(now)).toBe(false); // (one is under way)
    expect(told).toBe(1);
    // to its end: spent, the rows begin again
    const end = run(m, now + eggMs(plan.shape) + 100, now);
    expect(m.egg).toBeNull();
    expect(m.replayEgg(end)).toBe(false); // (no plan: the layer makes one)
    m.egg = { ...plan, shape: { ...plan.shape } };
    run(m, end + entranceMs(2) + 100, end); // (the showing is in again)
    expect(m.replayEgg(end + entranceMs(2) + 100)).toBe(m.phase === "rest");
  });
  it("an interlude cut short by a gesture (the showcase ends) tells its sound at once, and an interlude that was not under way tells nothing", () => {
    const m = make();
    let ended = 0;
    m.onCinematicEnd = () => ended++;
    const now = run(m, at() + 3000); // (the word is coming in)
    expect(m.phase).toBe("egg");
    m.leave(now);
    expect(ended).toBe(1);
    const r = make();
    r.onCinematicEnd = () => ended++;
    const t = run(r, 2000); // (the resting roll)
    r.leave(t);
    expect(ended).toBe(1);
  });
  it("the camera's flight runs from the interlude's start to the word's landing, and is over (1) outside it", () => {
    const m = make();
    expect(m.eggFlight()).toBe(1); // (not under way)
    const s = plan.shape;
    const land = s.leaveMs + s.gapMs + s.enterMs;
    let now = run(m, at() + 20);
    expect(m.phase).toBe("egg");
    expect(m.eggFlight()).toBeLessThan(0.01);
    now = run(m, at() + land / 2, now);
    expect(m.eggFlight()).toBeGreaterThan(0.4);
    expect(m.eggFlight()).toBeLessThan(0.6);
    now = run(m, at() + land + 100, now);
    expect(m.eggFlight()).toBe(1);
  });
  it("every row leaves by the orbit exit's own path and is behind the planet when it is over", () => {
    const m = make();
    const t0 = run(m, at() + 20);
    const from = rows(m, t0);
    const mid = run(m, at() + plan.shape.leaveMs / 2, t0);
    for (let i = 0; i < 4; i++) {
      // on its way: between where it was and behind the planet, and still moving the way it left
      expect(Math.abs(rows(m, mid)[i]!)).toBeGreaterThan(Math.abs(from[i]!) - 1e-9);
    }
    const done = run(m, at() + plan.shape.leaveMs + 50, mid);
    starts.forEach((s, i) => expect(Math.abs(rows(m, done)[i]!)).toBeCloseTo(s, 9));
  });
  it("the stage is empty for a beat, then the big row comes in from the east, slowly, and holds near the centre", () => {
    const m = make();
    const s = plan.shape;
    let now = run(m, at() + s.leaveMs + s.gapMs / 2);
    expect(m.eggTheta()).toBeNull(); // (the beat)
    now = run(m, at() + s.leaveMs + s.gapMs + 300, now);
    const early = m.eggTheta()!;
    expect(early).toBeGreaterThan(0); // from the east
    expect(Math.abs(early)).toBeLessThan(2.4); // not yet in
    now = run(m, at() + s.leaveMs + s.gapMs + s.enterMs + s.holdMs / 2, now);
    expect(Math.abs(m.eggTheta()!)).toBeLessThan(0.05); // (the roll's amplitude: 2.5 degrees)
    // and it was slow: a third of the way through its entrance it has not yet got half way in
    const m2 = make();
    run(m2, at() + s.leaveMs + s.gapMs + s.enterMs / 3);
    expect(Math.abs(m2.eggTheta()!)).toBeGreaterThan(1.0);
  });
  it("goes on round to the west, is gone, and the normal showing begins again from its start, once", () => {
    const m = make();
    let resumed = 0;
    m.onResume = () => resumed++;
    const s = plan.shape;
    // (the word's exit ends `zoomOutMs` before the interlude does: the globe comes back upright after it)
    const wordGone = eggMs(s) - s.zoomOutMs;
    let now = run(m, at() + wordGone - 60);
    expect(m.phase).toBe("egg");
    expect(Math.abs(m.eggTheta() ?? 9)).toBeGreaterThan(1.8); // (gone round the far side, west: the other way from where it came in)
    expect(m.eggTheta()!).toBeLessThan(0);
    now = run(m, at() + wordGone + 60, now);
    expect(m.eggTheta()).toBeNull(); // (gone), the globe on its way back
    expect(m.phase).toBe("egg");
    now = run(m, at() + eggMs(s) + 60, now);
    expect(m.phase).toBe("in");
    expect(m.animating).toBe(true);
    expect(resumed).toBe(1);
    expect(m.egg).toBeNull();
    // (the rows are behind the planet again, and they come in as at load: staggered, from the start of the clock)
    for (let i = 0; i < 4; i++) expect(Math.abs(rows(m, now)[i]!)).toBeGreaterThan(1.5);
    run(m, now + entranceMs(2) + 6 * cycleMs(), now);
    expect(resumed).toBe(1);
    expect(m.eggTheta()).toBeNull();
  });
  it("runs on the globe's own frames (the globe is pulled back meanwhile), not the caption's alone", () => {
    const m = make();
    run(m, at() + 1000);
    expect(m.phase).toBe("egg");
    expect(m.animating).toBe(true);
    expect(m.drifting).toBe(false);
  });
  it("pulls the globe back smoothly and gives it back by the time it is over", () => {
    const m = make();
    const s = plan.shape;
    expect(m.eggZoom()).toBe(0); // (outside it)
    let now = run(m, at() + 20);
    expect(m.eggZoom()).toBeLessThan(0.01);
    let last = m.eggZoom();
    // up over `zoomInMs`: monotone, no jump between frames
    for (; now < at() + s.zoomInMs; now = run(m, now + 16, now)) {
      const k = m.eggZoom();
      expect(k).toBeGreaterThanOrEqual(last - 1e-9);
      expect(k - last).toBeLessThan(0.05);
      last = k;
    }
    now = run(m, at() + s.zoomInMs + 50, now);
    expect(m.eggZoom()).toBeCloseTo(1, 6);
    // held through the middle, then back down over the last `zoomOutMs`
    now = run(m, at() + eggMs(s) - s.zoomOutMs - 100, now);
    expect(m.eggZoom()).toBeCloseTo(1, 6);
    last = m.eggZoom();
    for (; now < at() + eggMs(s) - 20; now = run(m, now + 16, now)) {
      const k = m.eggZoom();
      expect(k).toBeLessThanOrEqual(last + 1e-9);
      expect(last - k).toBeLessThan(0.05);
      last = k;
    }
    expect(m.eggZoom()).toBeLessThan(0.02);
    run(m, at() + eggMs(s) + 100, now);
    expect(m.eggZoom()).toBe(0);
  });
  it("keeps the globe pulled back and leaning until the word has LEFT, and only then gives it back", () => {
    const m = make();
    const s = plan.shape;
    const wordGone = s.leaveMs + s.gapMs + s.enterMs + s.holdMs + s.exitMs;
    let now = run(m, at() + 20);
    now = run(m, at() + s.zoomInMs + 100, now);
    // the word is still on the stage up to `wordGone` (its exit runs to there): the globe is as far back as it was, all the time
    for (; now < at() + wordGone - 120; now = run(m, now + 50, now)) expect(m.eggZoom(), `at ${Math.round(now - at())} ms`).toBeCloseTo(1, 6);
    expect(m.eggTheta()).not.toBeNull();
    // and it comes back in the `zoomOutMs` after
    now = run(m, at() + wordGone + s.zoomOutMs / 2, now);
    expect(m.eggTheta()).toBeNull();
    expect(m.eggZoom()).toBeGreaterThan(0.1);
    expect(m.eggZoom()).toBeLessThan(0.9);
    expect(wordGone + s.zoomOutMs).toBe(eggMs(s));
  });
  it("a modest pull-back: the word stays the size it was relative to the planet", () => {
    expect(CINEMATIC.shape.zoomLevels).toBeGreaterThan(0.3);
    expect(CINEMATIC.shape.zoomLevels).toBeLessThan(1.2);
    expect(CINEMATIC.shape.zoomInMs + CINEMATIC.shape.zoomOutMs).toBeLessThan(eggMs(CINEMATIC.shape));
  });
  it("stands still with the energy pass's hold: it does not begin frozen, and it holds where it is", () => {
    const m = make();
    let now = run(m, at() - 200);
    m.frozen = true;
    now = run(m, now + 5000, now);
    expect(m.phase).toBe("rest"); // (the clock did not move: the moment has not come)
    expect(m.drifting).toBe(false);
    m.frozen = false;
    now = run(m, now + 1500, now);
    expect(m.phase).toBe("egg");
    m.frozen = true;
    const where = m.eggTheta();
    now = run(m, now + 5000, now);
    expect(m.eggTheta()).toBe(where);
    expect(m.phase).toBe("egg");
  });
  it("is not parked (the idle settle leaves it alone)", () => {
    const m = make();
    const now = run(m, at() + 1500);
    m.beginPark(now);
    expect(m.isParking).toBe(false);
    expect(m.phase).toBe("egg");
  });
  it("a gesture cuts it short: the rows are gone, the big row fades where it is, and it is not shown again", () => {
    const m = make();
    const s = plan.shape;
    const now = run(m, at() + s.leaveMs + s.gapMs + 2000);
    const where = m.eggTheta();
    expect(where).not.toBeNull();
    m.leave(now, "fade");
    expect(m.phase).toBe("fade");
    expect(m.eggTheta()).toBe(where);
    m.enter(now + 1000);
    expect(m.egg).toBeNull();
    expect(m.eggTheta()).toBeNull();
  });
  it("reduced motion, a parked or a pinned caption never begins it", () => {
    const m = make();
    m.continuous = false;
    run(m, at() + 3000);
    expect(m.phase).toBe("rest");
    const p = make();
    p.pinned = 0;
    run(p, at() + 3000);
    expect(p.phase).toBe("rest");
  });
  it("a plan that has not begun survives a showing (the clock goes back to the start: it is still ahead); one that has does not", () => {
    const m = make();
    run(m, cycleMs() / 2);
    m.enter(5000);
    expect(m.egg).not.toBeNull();
    const b = make();
    run(b, at() + 100);
    expect(b.phase).toBe("egg");
    b.settle(true); // (the street map took the view)
    expect(b.egg).toBeNull();
    expect(b.phase).toBe("rest");
  });
  it("with no plan nothing changes", () => {
    const m = make(null);
    run(m, 60000);
    expect(m.phase).toBe("rest");
    expect(m.eggTheta()).toBeNull();
  });
});
