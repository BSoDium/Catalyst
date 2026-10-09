import { describe, expect, it } from "vitest";
import { FrameDriver, type FrameDriverHost } from "./frame-driver";

/** A display: frames at 16 ms; callbacks requested during a frame run in the next one. */
function rig(activeFor: number) {
  let t = 0;
  let id = 0;
  const queue = new Map<number, (ts: number) => void>();
  let active = true;
  let left = activeFor;
  const log: number[] = [];
  const host: FrameDriverHost = {
    request: (cb) => (queue.set(++id, cb), id),
    cancel: (i) => void queue.delete(i),
    run: (now) => {
      log.push(now);
      left--;
      if (left <= 0) active = false;
      driver.ride();
    },
    active: () => active,
    now: () => t + 1,
  };
  const driver = new FrameDriver(host);
  driver.enabled = true;
  const frame = (hostFrame?: () => void) => {
    t += 16;
    hostFrame?.();
    const cbs = [...queue.values()];
    queue.clear();
    for (const cb of cbs) cb(t);
  };
  return { driver, frame, log, queue, setActive: (a: boolean) => (active = a) };
}

describe("the frame driver of a glide: frames only while something moves, never two runs in a frame", () => {
  it("runs a frame per display frame while active, then stops asking", () => {
    const r = rig(3);
    r.driver.ride();
    for (let i = 0; i < 6; i++) r.frame();
    expect(r.log.length).toBe(3);
    expect(r.queue.size).toBe(0);
  });
  it("asks for nothing when nothing moves (an idle map costs no frame)", () => {
    const r = rig(3);
    r.setActive(false);
    r.driver.ride();
    expect(r.queue.size).toBe(0);
    r.frame();
    expect(r.log.length).toBe(0);
  });
  it("a disabled driver never asks", () => {
    const r = rig(3);
    r.driver.enabled = false;
    r.driver.ride();
    expect(r.queue.size).toBe(0);
  });
  it("never schedules twice", () => {
    const r = rig(3);
    r.driver.ride();
    r.driver.ride();
    r.driver.ride();
    expect(r.queue.size).toBe(1);
  });
  it("a host frame that ran first withdraws the pending frame: one run per display frame, and the loop goes on", () => {
    const r = rig(10);
    r.driver.ride();
    for (let i = 0; i < 4; i++) {
      r.frame(() => {
        r.driver.stop();
        r.log.push(-1); // the host's own run in this frame
        r.driver.ran(1e9);
        r.driver.ride();
      });
    }
    expect(r.log.filter((x) => x >= 0).length).toBe(0); // the host's run covered every frame
    expect(r.driver.driven).toBe(0);
  });
  it("a run of the host in the same frame, after the pending callback was queued before it, is skipped by the callback", () => {
    const r = rig(10);
    r.driver.ride();
    r.frame(() => r.driver.ran(1e9)); // the host ran in this frame without cancelling
    expect(r.log.length).toBe(0);
    expect(r.queue.size).toBe(1); // but the next frame is still asked for
  });
  it("stop() withdraws the pending frame", () => {
    const r = rig(3);
    r.driver.ride();
    r.driver.stop();
    expect(r.queue.size).toBe(0);
  });
});
