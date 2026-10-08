import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LabelLayer, type LabelView } from "./label-dom";

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
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, right: 10, bottom: 10 };
  }
}

const view = (extra: Partial<LabelView> = {}): LabelView => ({ x: 10, y: 20, name: "Paris", chip: null, mode: "rest", over: false, alpha: 1, glide: false, ...extra });
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
const el = (n = 0) => root.children[n]!;

describe("the label layer: real text in pooled elements, positioned by transform only", () => {
  it("one element per label with its name, positioned by translate3d and nothing else", () => {
    frame(() => layer.put(1, "paris", view()));
    expect(root.children.length).toBe(1);
    const e = el();
    expect(e.className).toBe("map-label");
    expect(e.children[0]!.textContent).toBe("Paris");
    expect(e.style.transform).toBe("translate3d(10px,20px,0)");
    expect(e.style.left).toBe("0"); // placement is the transform
    expect(e.style.display).toBe("");
    expect(e.dataset.slug).toBe("paris");
  });
  it("positions are rounded to whole DEVICE pixels (at 2x a half px is kept, a quarter is not)", () => {
    frame(() => layer.put(1, "a", view({ x: 10.3, y: 20.8 })));
    expect(el().style.transform).toBe("translate3d(10.5px,21px,0)");
  });
  it("a group's counter is a second run", () => {
    frame(() => layer.put(1, "eu", view({ name: "Europe", chip: "12 entries" })));
    const [name, chip] = el().children;
    expect(name!.textContent).toBe("Europe");
    expect(chip!.textContent).toBe("12 entries");
    expect(chip!.style.display).toBe("");
    frame(() => layer.put(1, "eu", view({ name: "Europe", chip: null })));
    expect(el().children[1]!.style.display).toBe("none");
  });
  it("writes only what changed: a frame with the same values touches nothing", () => {
    frame(() => layer.put(1, "a", view()));
    const w = layer.writes;
    frame(() => layer.put(1, "a", view()));
    frame(() => layer.put(1, "a", view({ glide: false })));
    expect(layer.writes).toBe(w);
    frame(() => layer.put(1, "a", view({ x: 11 })));
    expect(layer.writes).toBe(w + 1);
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
    expect(layer.count).toBe(0);
    frame(() => layer.put(2, "b", view({ name: "Lyon" })));
    expect(root.children.length).toBe(1); // the same element
    expect(el().dataset.slug).toBe("b");
    expect(el().children[0]!.textContent).toBe("Lyon");
    expect(el().style.display).toBe("");
  });
});

describe("gliding: a transition only for a label a re-plan moved at rest", () => {
  it("the glide attribute is set with the move that needs it and removed with the next move that does not", () => {
    frame(() => layer.put(1, "a", view()));
    expect("glide" in el().dataset).toBe(false);
    frame(() => layer.put(1, "a", view({ x: 50, glide: true })));
    expect("glide" in el().dataset).toBe(true);
    frame(() => layer.put(1, "a", view({ x: 52, glide: false })));
    expect("glide" in el().dataset).toBe(false);
  });
  it("a still frame never cancels a glide that is running (the attribute only changes with a move)", () => {
    frame(() => layer.put(1, "a", view()));
    frame(() => layer.put(1, "a", view({ x: 50, glide: true })));
    frame(() => layer.put(1, "a", view({ x: 50, glide: false })));
    expect("glide" in el().dataset).toBe(true);
  });
  it("a released element does not keep its glide for the next label", () => {
    frame(() => layer.put(1, "a", view()));
    frame(() => layer.put(1, "a", view({ x: 50, glide: true })));
    frame(() => undefined);
    frame(() => layer.put(2, "b", view({ x: 7 })));
    expect("glide" in el().dataset).toBe(false);
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
