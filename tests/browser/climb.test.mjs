// Tests the climb in a real browser: hovering a stage previews it only
// while the pointer is on the tower, a click pins a stage until it is
// clicked again or Escape is pressed, a pin is kept in the URL fragment,
// and the page never scrolls sideways. Each test opens the page in
// headless Chromium (harness.mjs) and drives it with pointer and key
// events.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { launch } from "./harness.mjs";

const DESKTOP = { width: 1400, height: 900 };
const PHONE_WIDTHS = [360, 390, 768];

// The stage the card shows, the stage pinned on the tower (null when none)
// and the URL fragment.
const STATE = `({
  card: document.getElementById("stage-card").dataset.stage,
  pinned: document.querySelector("#tower .row.pinned")?.dataset.stage ?? null,
  pressed: [...document.querySelectorAll('#tower .row[aria-pressed="true"]')].length,
  hash: location.hash,
})`;

// Scroll the tower so that row `index` sits mid-screen, and return the
// middle of its bar.
const rowCentre = (index) => `(() => {
  const row = document.querySelector('#tower .row[data-index="${index}"]');
  row.querySelector(".hit").scrollIntoView({ block: "center" });
  const box = row.querySelector(".hit").getBoundingClientRect();
  return { x: box.left + box.width / 3, y: box.top + box.height / 2, id: row.dataset.stage };
})()`;

// A point on the page well clear of the tower: the left margin of the
// header.
const OFF_TOWER = { x: 2, y: 2 };

let browser;
before(async () => {
  browser = await launch();
});
after(async () => {
  await browser.close();
});

// Hovering a row shows that stage on the card; moving off the tower
// returns the card to the stage at the reading line.
test("hover previews a stage only while the pointer is on the tower", async () => {
  const page = await browser.open("/", DESKTOP.width, DESKTOP.height);
  const target = await page.evaluate(rowCentre(8));
  await page.move(OFF_TOWER.x, OFF_TOWER.y);
  const reading = (await page.evaluate(STATE)).card;
  assert.notEqual(reading, target.id);

  await page.move(target.x, target.y);
  assert.equal((await page.evaluate(STATE)).card, target.id);

  await page.move(OFF_TOWER.x, OFF_TOWER.y);
  const after = await page.evaluate(STATE);
  assert.equal(after.card, reading);
  assert.equal(after.pinned, null);
  page.close();
});

// A click pins: the row is marked, the fragment names the stage, and the
// card stays on it when the pointer leaves and when the page scrolls.
// Hovering another row previews it, and leaving goes back to the pin.
test("a click pins a stage through pointer moves and scrolling", async () => {
  const page = await browser.open("/", DESKTOP.width, DESKTOP.height);
  const target = await page.evaluate(rowCentre(8));
  await page.click(target.x, target.y);
  await page.move(OFF_TOWER.x, OFF_TOWER.y);

  let state = await page.evaluate(STATE);
  assert.equal(state.card, target.id);
  assert.equal(state.pinned, target.id);
  assert.equal(state.pressed, 1);
  assert.equal(state.hash, `#stage-${target.id}`);

  await page.evaluate("window.scrollBy(0, 700)");
  await page.evaluate(
    "new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))",
  );
  assert.equal((await page.evaluate(STATE)).card, target.id);

  const other = await page.evaluate(rowCentre(14));
  await page.move(other.x, other.y);
  assert.equal((await page.evaluate(STATE)).card, other.id);
  await page.move(OFF_TOWER.x, OFF_TOWER.y);
  state = await page.evaluate(STATE);
  assert.equal(state.card, target.id);
  assert.equal(state.pinned, target.id);
  page.close();
});

// Clicking the pinned stage again unpins it, and so does Escape; either
// way the fragment is cleared and the card follows the reading line.
test("clicking the pinned stage or pressing Escape unpins", async () => {
  const page = await browser.open("/", DESKTOP.width, DESKTOP.height);
  const target = await page.evaluate(rowCentre(8));
  await page.click(target.x, target.y);
  await page.click(target.x, target.y);
  let state = await page.evaluate(STATE);
  assert.equal(state.pinned, null);
  assert.equal(state.pressed, 0);
  assert.equal(state.hash, "");

  await page.click(target.x, target.y);
  assert.equal((await page.evaluate(STATE)).pinned, target.id);
  await page.key("Escape");
  await page.move(OFF_TOWER.x, OFF_TOWER.y);
  state = await page.evaluate(STATE);
  assert.equal(state.pinned, null);
  assert.equal(state.hash, "");
  assert.notEqual(state.card, target.id);
  page.close();
});

// A fragment naming a stage opens the page with that stage pinned.
test("a #stage- fragment opens with that stage pinned", async () => {
  const page = await browser.open(
    "/#stage-gcc46",
    DESKTOP.width,
    DESKTOP.height,
  );
  const state = await page.evaluate(STATE);
  assert.equal(state.pinned, "gcc46");
  assert.equal(state.card, "gcc46");
  page.close();
});

// No width from a phone to a tablet scrolls sideways.
test("the page never scrolls sideways", async () => {
  for (const width of [...PHONE_WIDTHS, DESKTOP.width]) {
    const page = await browser.open("/", width, DESKTOP.height);
    const { scroll, client } = await page.evaluate(
      "({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth })",
    );
    assert.ok(scroll <= client, `${scroll} > ${client} at ${width}px`);
    page.close();
  }
});
