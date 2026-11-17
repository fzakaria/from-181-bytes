// The climb: the chain drawn as a tower (tower-view.js), a card for the
// floor in view, and gauges pinned above that count what has been built
// by that floor. Scrolling moves the floor in view; hovering or tapping a
// row shows that floor instead, until the pointer leaves or the page
// scrolls on.

import { el } from "./dom.js";
import { humanBytes, count } from "./format.js";
import { milestonesReached } from "./view.js";
import { drawTower } from "./tower-view.js";

// How far below the top of the window a row has to pass to count as the
// floor being read: past the pinned gauges.
const READING_LINE_PX = 190;

const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// The joke the seed floor carries. It is a card in the site's own style
// and makes no claim to be anything else.
function citation(trustBytes) {
  return el(
    "div",
    { class: "citation" },
    el("p", { class: "kicker" }, "Citation, from a committee of one"),
    el(
      "p",
      {},
      `To stage0, Jeremiah Orians and everyone who wrote and checked the hex0 seeds, for getting the binary a C toolchain has to trust down to ${trustBytes} bytes and then writing a comment for every one of them.`,
    ),
    el(
      "p",
      { class: "muted small" },
      "The committee (Farid) thinks this deserves a Nobel prize. The committee cannot award one. It has no medal and no prize money, and it has this card.",
    ),
  );
}

// The card for one floor.
function card(view, views, trustBytes, onJump) {
  const link = (id, title) =>
    el(
      "a",
      { href: `#floor-${id}`, onclick: (event) => onJump(event, id) },
      title,
    );
  const facts = [
    ["written in", view.writtenIn],
    view.reads ? ["reads", view.reads] : null,
    ["output", `${humanBytes(view.bytes)} (${count(view.bytes)} bytes)`],
    [
      "built by",
      view.builtByTitle
        ? link(view.builtBy, view.builtByTitle)
        : "nothing here: fetched and checked by hash",
    ],
    view.using.some(({ id }) => id !== view.builtBy)
      ? [
          "also used",
          view.using
            .filter(({ id }) => id !== view.builtBy)
            .flatMap(({ id, title }, i) => [i ? ", " : null, link(id, title)]),
        ]
      : null,
    ["derivation", el("code", {}, view.node.drv)],
  ].filter(Boolean);

  return [
    el(
      "h3",
      { id: `floor-${view.id}` },
      el("span", { class: "floor-number" }, `floor ${view.index}`),
      el("a", { href: view.link }, view.title),
      view.milestone ? el("span", { class: "badge" }, view.milestone) : null,
    ),
    el("p", {}, view.note),
    el(
      "dl",
      { class: "facts" },
      facts.flatMap(([term, value]) => [
        el("dt", {}, term),
        el("dd", {}, value),
      ]),
    ),
    view.compiledNames.length
      ? el(
          "details",
          { class: "also" },
          el(
            "summary",
            {},
            `${view.compiledNames.length} more derivations this floor built`,
          ),
          el("p", {}, view.compiledNames.join(", ")),
        )
      : null,
    view.index === 0 ? citation(trustBytes) : null,
    el(
      "p",
      { class: "card-nav small" },
      view.index > 0
        ? link(views[view.index - 1].id, `↑ ${views[view.index - 1].title}`)
        : null,
      view.index + 1 < views.length
        ? link(views[view.index + 1].id, `${views[view.index + 1].title} ↓`)
        : null,
    ),
  ];
}

// The source fetched at each floor: the step in the running source total.
const sourceDeltas = (views) =>
  views.map(
    (view, i) =>
      view.cumulative.source - (i === 0 ? 0 : views[i - 1].cumulative.source),
  );

// Render the climb. Returns { stop, setTrace }: stop removes the
// listeners, setTrace draws a "who built you?" trace on the picture.
export function renderClimb(views, { trustBytes }) {
  const svg = document.getElementById("tower");
  const cardNode = document.getElementById("floor-card");
  const built = document.getElementById("gauge-built");
  const builtCount = document.getElementById("gauge-count");
  const source = document.getElementById("gauge-source");
  const milestones = document.getElementById("milestones");
  document.getElementById("gauge-trust").textContent = `${trustBytes} B`;

  let tower = null;
  let inView = 0;
  let shownCard = -1;
  let picked = null;
  let trace = null;

  // Bring a floor's row to the reading line.
  function jumpTo(index) {
    const row = tower.rows[index];
    const top =
      svg.getBoundingClientRect().top +
      window.scrollY +
      row.y -
      READING_LINE_PX +
      4;
    window.scrollTo({ top, behavior: reducedMotion() ? "auto" : "smooth" });
  }
  const onJump = (event, id) => {
    event.preventDefault();
    jumpTo(views.findIndex((view) => view.id === id));
  };

  const chips = milestonesReached(views, 0).map(({ label, index }) =>
    el("li", {}, el("button", { onclick: () => jumpTo(index) }, label)),
  );
  milestones.replaceChildren(...chips);

  // Show the picked floor if there is one, else the floor in view.
  function show() {
    const index = picked ?? inView;
    tower.setFocus(index);
    if (index !== shownCard) {
      shownCard = index;
      cardNode.replaceChildren(
        ...card(views[index], views, trustBytes, onJump).filter(Boolean),
      );
    }

    const totals = views[inView].cumulative;
    built.textContent = humanBytes(totals.built);
    built.title = `${count(totals.built)} bytes`;
    builtCount.textContent = count(totals.builtCount);
    source.textContent = humanBytes(totals.source);
    source.title = `${count(totals.source)} bytes in ${count(totals.sourceCount)} fetched paths`;
    milestonesReached(views, inView).forEach(({ reached }, i) => {
      chips[i].firstChild.classList.toggle("reached", reached);
    });
  }

  function onPick(index, how) {
    if (how === "leave") {
      picked = null;
    } else {
      picked = index;
    }
    show();
  }

  function draw() {
    tower = drawTower(svg, views, {
      trustBytes,
      sourceDelta: sourceDeltas(views),
      onPick,
    });
    tower.setTrace(trace);
    shownCard = -1;
    show();
  }

  // The floor in view is the last row whose top has passed the reading
  // line; above the picture, the seed.
  function onScroll() {
    const top = svg.getBoundingClientRect().top;
    let current = 0;
    for (const row of tower.rows) {
      if (top + row.y > READING_LINE_PX) {
        break;
      }
      current = row.index;
    }
    if (current === inView && picked === null) {
      return;
    }
    inView = current;
    picked = null;
    show();
  }

  let pending = false;
  const scheduled = () => {
    if (pending) {
      return;
    }
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      onScroll();
    });
  };

  // Redraw when the column changes width: the geometry depends on it.
  let lastWidth = 0;
  const resize = new ResizeObserver(() => {
    const width = svg.parentElement.clientWidth;
    if (width === lastWidth) {
      return;
    }
    lastWidth = width;
    draw();
  });
  resize.observe(svg.parentElement);

  // On a phone the card is a sheet over the page; it shows only while
  // the picture is on screen, so it never covers the seed or the trace.
  const onScreen = new IntersectionObserver(([entry]) => {
    cardNode.classList.toggle("in-view", entry.isIntersecting);
  });
  onScreen.observe(svg);
  window.addEventListener("scroll", scheduled, { passive: true });
  draw();
  onScroll();

  return {
    stop() {
      window.removeEventListener("scroll", scheduled);
      resize.disconnect();
      onScreen.disconnect();
    },
    setTrace(floorIds) {
      trace = floorIds;
      tower.setTrace(trace);
    },
    jumpTo,
  };
}
