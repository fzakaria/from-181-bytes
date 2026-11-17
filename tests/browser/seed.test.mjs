// Tests the seed explorer's source pane in a real browser. Hovering bytes
// in quick succession must never scroll the page, and must scroll the
// pane at most once per hover, and only when the byte's line is out of
// view. Hovering lines inside the pane, or wheeling it, must never make
// the pane scroll itself.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { launch } from "./harness.mjs";

const DESKTOP = { width: 1400, height: 900 };
const PHONE = { width: 390, height: 844 };

// Bytes hovered one after another: far jumps across the seed, each
// followed by a neighbour whose line is already in view but not centred.
const BYTE_PATH = [0, 8, 170, 160, 3, 16, 120, 112, 60, 180, 10];

// Count the pane's scroll events from here on, in the page.
const COUNT_SCROLLS = `(() => {
  const pane = document.getElementById("seed-source");
  window.__paneScrolls = 0;
  pane.addEventListener("scroll", () => { window.__paneScrolls += 1; });
})()`;

// Where byte `offset` is, and whether its source line is inside the
// pane's visible rows now.
const byteState = (offset) => `(() => {
  const pane = document.getElementById("seed-source");
  const button = document.querySelectorAll("#seed-grid button")[${offset}];
  const line = pane.children[Number(button.dataset.line)];
  const box = button.getBoundingClientRect();
  const top = line.offsetTop;
  return {
    x: box.left + box.width / 2,
    y: box.top + box.height / 2,
    visible: top >= pane.scrollTop && top + line.offsetHeight <= pane.scrollTop + pane.clientHeight,
    scrollTop: pane.scrollTop,
    scrollY: window.scrollY,
    scrolls: window.__paneScrolls,
    paneTop: pane.getBoundingClientRect().top,
  };
})()`;

const PANE = `(() => {
  const pane = document.getElementById("seed-source");
  const box = pane.getBoundingClientRect();
  return {
    x: box.left + box.width / 2,
    top: box.top,
    height: box.height,
    scrollTop: pane.scrollTop,
    scrollY: window.scrollY,
    scrolls: window.__paneScrolls,
  };
})()`;

// Let scroll events from the last input arrive.
const SETTLE = "new Promise((r) => setTimeout(r, 150))";

let browser;
before(async () => {
  browser = await launch();
});
after(async () => {
  await browser.close();
});

// Bytes hovered in quick succession: the page stays put, nothing above
// the pane changes height, and the pane scrolls once for a byte whose
// line was out of view and not at all for one already in view.
for (const size of [DESKTOP, PHONE]) {
  test(`hovering bytes never moves the page and moves the pane once at most (${size.width}px)`, async () => {
    const page = await browser.open("/", size.width, size.height);
    await page.evaluate(
      'document.getElementById("seed-grid").scrollIntoView({ block: "start" })',
    );
    await page.evaluate(COUNT_SCROLLS);
    for (const offset of BYTE_PATH) {
      const before = await page.evaluate(byteState(offset));
      await page.move(before.x, before.y);
      await page.evaluate(SETTLE);
      const after = await page.evaluate(byteState(offset));
      assert.equal(
        after.scrollY,
        before.scrollY,
        `byte ${offset} moved the page`,
      );
      assert.equal(
        after.paneTop,
        before.paneTop,
        `byte ${offset} moved the pane`,
      );
      const moves = after.scrolls - before.scrolls;
      if (before.visible) {
        assert.equal(moves, 0, `byte ${offset}'s line was in view`);
        assert.equal(after.scrollTop, before.scrollTop);
      } else {
        assert.ok(
          moves <= 1,
          `byte ${offset} scrolled the pane ${moves} times`,
        );
        assert.ok(after.visible, `byte ${offset}'s line is still out of view`);
      }
    }
    page.close();
  });
}

// Moving the pointer down the pane over line after line, and wheeling
// it, never makes the pane scroll itself: only the wheel moves it.
test("hovering and wheeling the pane never makes it scroll itself", async () => {
  const page = await browser.open("/", DESKTOP.width, DESKTOP.height);
  await page.evaluate(
    'document.getElementById("seed-source").scrollIntoView({ block: "center" })',
  );
  await page.evaluate(COUNT_SCROLLS);
  const pane = await page.evaluate(PANE);
  for (let y = pane.top + 10; y < pane.top + pane.height - 10; y += 15) {
    await page.move(pane.x, y);
  }
  await page.evaluate(SETTLE);
  const hovered = await page.evaluate(PANE);
  assert.equal(hovered.scrolls, 0, "hovering lines scrolled the pane");
  assert.equal(hovered.scrollY, pane.scrollY);

  // One wheel notch: the pane moves by the wheel and then stays.
  const WHEEL = 120;
  await page.send("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x: pane.x,
    y: pane.top + pane.height / 2,
    deltaX: 0,
    deltaY: WHEEL,
  });
  await page.evaluate(SETTLE);
  const wheeled = await page.evaluate(PANE);
  await page.move(pane.x, pane.top + pane.height / 2 + 7);
  await page.move(pane.x, pane.top + pane.height / 2 + 30);
  await page.evaluate(SETTLE);
  const after = await page.evaluate(PANE);
  assert.equal(
    after.scrollTop,
    wheeled.scrollTop,
    "the pane moved after the wheel stopped",
  );
  assert.equal(after.scrollY, pane.scrollY);
  page.close();
});
