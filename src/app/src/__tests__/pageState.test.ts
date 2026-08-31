import { describe, it, expect, afterEach } from "vitest";
import { showState, fillSlot, el } from "../lib/ui/pageState.js";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("showState", () => {
  it("reveals the named [data-state] section and hides its siblings", () => {
    document.body.innerHTML = `
      <main id="skye-app">
        <p data-state id="a"></p>
        <section data-state id="b" hidden></section>
        <section data-state id="c" hidden></section>
      </main>`;
    const root = document.getElementById("skye-app")!;

    const b = showState(root, "b");
    expect(b.id).toBe("b");
    expect(b.hidden).toBe(false);
    expect(document.getElementById("a")!.hidden).toBe(true);
    expect(document.getElementById("c")!.hidden).toBe(true);

    showState(root, "a");
    expect(document.getElementById("a")!.hidden).toBe(false);
    expect(document.getElementById("b")!.hidden).toBe(true);
  });

  it("throws for an unknown id (skeleton/script drift)", () => {
    document.body.innerHTML = `<main id="skye-app"><p data-state id="a"></p></main>`;
    expect(() => showState(document.getElementById("skye-app")!, "nope")).toThrow();
  });
});

describe("fillSlot / el", () => {
  it("fillSlot sets the [data-slot] text and returns it", () => {
    document.body.innerHTML = `<div><span data-slot="x"></span></div>`;
    const node = fillSlot(document.body, "x", "hello");
    expect(node.textContent).toBe("hello");
  });

  it("el returns the [data-el] control, throwing when it's missing", () => {
    document.body.innerHTML = `<div><input data-el="y" /></div>`;
    expect(el(document.body, "y").tagName).toBe("INPUT");
    expect(() => el(document.body, "z")).toThrow();
  });
});
