import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LabelLayer, featherShadow, type LabelView } from "./label-dom";
import { LABEL_TYPE } from "./label-text";

/** The smallest DOM the layer needs: elements with a style, a dataset, children and remove(). */
class FakeEl {
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  children: FakeEl[] = [];
  className = "";
  textContent = "";
  parent: FakeEl | null = null;
  append(...c: FakeEl[]) {
    for (const x of c) {
      x.parent = this;
      this.children.push(x);
    }
  }
  prepend(...c: FakeEl[]) {
    for (const x of c) {
      x.parent = this;
      this.children.unshift(x);
    }
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, right: 10, bottom: 10 };
  }
}

const view = (extra: Partial<LabelView> = {}): LabelView => ({ x: 10, y: 20, w: 60, h: 24, name: "Paris", sub: null, mode: "rest", over: false, alpha: 1, ...extra });
let root: FakeEl;
let layer: LabelLayer;

beforeEach(() => {
  vi.stubGlobal("document", { createElement: () => new FakeEl() });
  vi.stubGlobal("window", { devicePixelRatio: 2 });
  root = new FakeEl();
  layer = new LabelLayer(root as unknown as HTMLElement);
});
afterEach(() => vi.unstubAllGlobals());

const frame = (fn: () => void) => {
  layer.begin();
  fn();
  layer.end();
};
/** The layer of the feathers is the root's FIRST child (below the boxes' canvas); the labels follow it. */
const halos = () => root.children[0]!;
const halo = (n = 0) => halos().children[n]!;
const el = (n = 0) => root.children[n + 1]!;

describe("the label layer: real text in pooled elements, positioned by transform only", () => {
  it("a plate with its name, positioned by translate3d and nothing else, and its feather in the layer below", () => {
    frame(() => layer.put(1, "paris", view()));
    expect(root.children.length).toBe(2); // the feathers' layer, then the plate
    expect(halos().className).toBe("map-halos");
    const e = el();
    expect(e.className).toBe("map-label");
    expect(e.children[0]!.textContent).toBe("Paris");
    expect(e.children[0]!.className).toBe("map-label-name");
    expect(e.style.transform).toBe("translate3d(10px,20px,0)");
    expect(e.style.left).toBe("0"); // placement is the transform
    expect(e.style.display).toBe("");
    expect(e.dataset.slug).toBe("paris");
    const h = halo();
    expect(h.className).toBe("map-halo");
    expect(h.style.transform).toBe(e.style.transform); // the feather follows the plate
    expect([h.style.width, h.style.height]).toEqual(["60px", "24px"]);
    expect(e.style.minWidth).toBe("60px"); // the plate is never narrower than what the plan reserved
    expect(h.style.boxShadow).toBe(featherShadow());
    expect(h.dataset.slug).toBeUndefined(); // only the plate is a label for the checks
  });
  it("the type comes from LABEL_TYPE: two lines, the name 14 px / 500 and the second line 11 px / 400, block lines with their own line height", () => {
    frame(() => layer.put(1, "a", view()));
    const [name, sub] = el().children;
    expect([name!.style.fontSize, name!.style.fontWeight, name!.style.lineHeight, name!.style.display]).toEqual([`${LABEL_TYPE.name.size}px`, String(LABEL_TYPE.name.weight), `${LABEL_TYPE.name.lineHeight}px`, "block"]);
    expect([sub!.style.fontSize, sub!.style.fontWeight, sub!.style.lineHeight]).toEqual([`${LABEL_TYPE.sub.size}px`, String(LABEL_TYPE.sub.weight), `${LABEL_TYPE.sub.lineHeight}px`]);
    expect(el().style.padding).toBe(`${LABEL_TYPE.padY}px ${LABEL_TYPE.padX}px`);
  });
  it("the feather is two stacked page-colour shadows from LABEL_TYPE.feather", () => {
    const { blur, spread } = LABEL_TYPE.feather;
    expect(featherShadow()).toBe(`0 0 ${blur}px ${spread}px var(--background), 0 0 ${blur * 2}px ${spread}px var(--background)`);
  });
  it("positions are rounded to whole DEVICE pixels (at 2x a half px is kept, a quarter is not)", () => {
    frame(() => layer.put(1, "a", view({ x: 10.3, y: 20.8 })));
    expect(el().style.transform).toBe("translate3d(10.5px,21px,0)");
  });
  it("the second line is its own line, and absent when there is none", () => {
    frame(() => layer.put(1, "eu", view({ name: "Europe", sub: "12 places" })));
    const [name, sub] = el().children;
    expect(name!.textContent).toBe("Europe");
    expect(sub!.textContent).toBe("12 places");
    expect(sub!.className).toBe("map-label-sub");
    expect(sub!.style.display).toBe("block");
    frame(() => layer.put(1, "eu", view({ name: "Europe", sub: null })));
    expect(el().children[1]!.style.display).toBe("none");
  });
  it("writes only what changed: a frame with the same values touches nothing", () => {
    frame(() => layer.put(1, "a", view()));
    const w = layer.writes;
    frame(() => layer.put(1, "a", view()));
    expect(layer.writes).toBe(w);
    frame(() => layer.put(1, "a", view({ x: 11 })));
    expect(layer.writes).toBe(w + 1); // the plate and its feather move together: one write
    frame(() => layer.put(1, "a", view({ x: 11, w: 70 })));
    expect(layer.writes).toBe(w + 2);
  });
  it("the feather follows the plate's opacity and state; a selected plate has none (CSS hides it: the plate is inverted)", () => {
    frame(() => layer.put(1, "a", view({ alpha: 0.5 })));
    expect(halo().style.opacity).toBe("0.5");
    frame(() => layer.put(1, "a", view({ mode: "selected" })));
    expect(halo().dataset.mode).toBe("selected");
    expect(el().dataset.mode).toBe("selected");
  });
  it("state, plate and opacity are attributes and a style; a full opacity writes none", () => {
    frame(() => layer.put(1, "a", view({ mode: "selected", over: true, alpha: 0.5 })));
    expect(el().dataset.mode).toBe("selected");
    expect("over" in el().dataset).toBe(true);
    expect(el().style.opacity).toBe("0.5");
    frame(() => layer.put(1, "a", view({ mode: "rest", over: false, alpha: 1 })));
    expect(el().dataset.mode).toBe("rest");
    expect("over" in el().dataset).toBe(false);
    expect(el().style.opacity).toBe("");
  });
  it("a label that is not put goes back to the pool, hidden, and the element is reused (no node is created in a warm frame)", () => {
    frame(() => layer.put(1, "a", view()));
    frame(() => undefined);
    expect(el().style.display).toBe("none");
    expect(halo().style.display).toBe("none");
    expect(layer.count).toBe(0);
    frame(() => layer.put(2, "b", view({ name: "Lyon" })));
    expect(root.children.length).toBe(2); // the same elements
    expect(halo().style.display).toBe("");
    expect(el().dataset.slug).toBe("b");
    expect(el().children[0]!.textContent).toBe("Lyon");
    expect(el().style.display).toBe("");
  });
});

describe("moving: only a transform, no CSS transition (the motion is computed per frame)", () => {
  it("a moved label gets a new transform for the plate and its feather and no glide attribute or transition", () => {
    frame(() => layer.put(1, "a", view()));
    frame(() => layer.put(1, "a", view({ x: 50 })));
    expect(el().style.transform).toBe(halo().style.transform);
    expect(el().style.transform).toContain("50px");
    expect("glide" in el().dataset).toBe(false);
    expect(el().style.transition ?? "").toBe("");
  });
});

describe("dispose", () => {
  it("removes every element", () => {
    frame(() => layer.put(1, "a", view()));
    frame(() => layer.put(2, "b", view()));
    layer.dispose();
    expect(root.children.length).toBe(0);
  });
});
