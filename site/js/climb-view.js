// The climb: the chain drawn as a tower (tower-view.js), a card for one
// stage, and gauges pinned above that count what has been built by the
// stage at the reading line.
//
// The card shows, in order of precedence: the stage under the pointer
// while the pointer is on the tower, the pinned stage, and the stage at
// the reading line. A click pins a stage and names it in the URL
// fragment; clicking it again or pressing Escape unpins it.

import { el } from "./dom.js";
import { humanBytes, count } from "./format.js";
import { drawTower } from "./tower-view.js";

// How far below the pinned gauges a row has to pass to count as the
// stage being read.
const READING_GAP_PX = 48;

// The fragment that names a stage: #stage-<id>.
const STAGE_FRAGMENT = "#stage-";
const ESCAPE = "Escape";

const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// The joke the seed stage carries. It is a card in the site's own style
// and makes no claim to be anything else.
function citation() {
  return el(
    "div",
    { class: "citation" },
    el("p", { class: "kicker" }, "Citation, from a committee of one"),
    el(
      "p",
      {},
      "The committee cannot award a Nobel prize. It has no medal and no prize money, and it has this card.",
    ),
  );
}

// The card for one stage. `onLink` is called with a stage id when one of
// the card's links to another stage is followed.
function card(view, views, onLink) {
  const link = (id, title) =>
    el(
      "a",
      {
        href: `${STAGE_FRAGMENT}${id}`,
        onclick: (event) => {
          event.preventDefault();
          onLink(id);
        },
      },
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
        : "nothing: fetched and checked by hash",
    ],
    view.using.some(({ id }) => id !== view.builtBy)
      ? [
          "also used",
          view.using
            .filter(({ id }) => id !== view.builtBy)
            .flatMap(({ id, title }, i) => [i ? ", " : null, link(id, title)]),
        ]
      : null,
    view.texture
      ? [
          "texture",
          [
            el("code", {}, view.texture.file),
            ` (${humanBytes(view.texture.size)})`,
          ],
        ]
      : null,
    ["derivation", el("code", {}, view.node.drv)],
  ].filter(Boolean);

  return [
    el(
      "h3",
      {},
      el("span", { class: "stage-number" }, `stage ${view.index}`),
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
          el("summary", {}, `${view.compiledNames.length} more derivations`),
          el("p", {}, view.compiledNames.join(", ")),
        )
      : null,
    view.index === 0 ? citation() : null,
    el(
      "p",
      { class: "card-nav" },
      view.index > 0
        ? link(views[view.index - 1].id, `↑ ${views[view.index - 1].title}`)
        : null,
      view.index + 1 < views.length
        ? link(views[view.index + 1].id, `${views[view.index + 1].title} ↓`)
        : null,
    ),
  ];
}

// The source fetched at each stage: the step in the running source total.
const sourceDeltas = (views) =>
  views.map(
    (view, i) =>
      view.cumulative.source - (i === 0 ? 0 : views[i - 1].cumulative.source),
  );

// Render the climb.
export function renderClimb(views, { trustBytes, seedBytes }) {
  const svg = document.getElementById("tower");
  const cardNode = document.getElementById("stage-card");
  const gauges = document.getElementById("gauges");
  const built = document.getElementById("gauge-built");
  const builtCount = document.getElementById("gauge-count");
  const source = document.getElementById("gauge-source");
  document.getElementById("gauge-trust").textContent = `${trustBytes} B`;

  const indexOf = new Map(views.map((view, index) => [view.id, index]));
  let tower = null;
  let inView = 0;
  let hovered = null;
  let pinned = null;
  let shownCard = -1;

  // Where a row's top has to be for its stage to count as being read.
  const readingLine = () => gauges.offsetHeight + READING_GAP_PX;

  // Bring a stage's row to the reading line.
  function jumpTo(index) {
    const row = tower.rows[index];
    const top =
      svg.getBoundingClientRect().top + window.scrollY + row.y - readingLine();
    window.scrollTo({ top, behavior: reducedMotion() ? "auto" : "smooth" });
  }

  // Show the card for the hovered, pinned or read stage, outline it and
  // its builder, and count what has been built by the stage being read.
  function show() {
    const index = hovered ?? pinned ?? inView;
    tower.setFocus(index);
    tower.setPinned(pinned);
    if (index !== shownCard) {
      shownCard = index;
      cardNode.dataset.stage = views[index].id;
      cardNode.replaceChildren(
        ...card(views[index], views, follow).filter(Boolean),
      );
    }

    const totals = views[inView].cumulative;
    built.textContent = humanBytes(totals.built);
    built.title = `${count(totals.built)} bytes`;
    builtCount.textContent = count(totals.builtCount);
    source.textContent = humanBytes(totals.source);
    source.title = `${count(totals.source)} bytes in ${count(totals.sourceCount)} fetched paths`;
  }

  // Pin a stage, or unpin with null, and keep the fragment in step.
  function pin(index) {
    pinned = index;
    const url =
      index === null
        ? `${location.pathname}${location.search}`
        : `${STAGE_FRAGMENT}${views[index].id}`;
    history.replaceState(null, "", url);
    show();
  }

  // A card link to another stage pins it and brings it into view.
  function follow(id) {
    const index = indexOf.get(id);
    pin(index);
    jumpTo(index);
  }

  // The pointer previews; a click pins, or unpins the pinned stage.
  const onHover = (index) => {
    hovered = index;
    show();
  };
  const onToggle = (index) => pin(pinned === index ? null : index);

  function draw() {
    tower = drawTower(svg, views, {
      trustBytes,
      seedBytes,
      sourceDelta: sourceDeltas(views),
      onHover,
      onToggle,
    });
    shownCard = -1;
    show();
  }

  // The stage being read is the last row whose top has passed the
  // reading line; above the picture, the seed.
  function onScroll() {
    const top = svg.getBoundingClientRect().top;
    const line = readingLine();
    let current = 0;
    for (const row of tower.rows) {
      if (top + row.y > line) {
        break;
      }
      current = row.index;
    }
    if (current === inView) {
      return;
    }
    inView = current;
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
  // the picture is on screen, so it never covers the seed.
  const onScreen = new IntersectionObserver(([entry]) => {
    cardNode.classList.toggle("in-view", entry.isIntersecting);
  });
  onScreen.observe(svg);
  window.addEventListener("scroll", scheduled, { passive: true });

  // Escape unpins.
  document.addEventListener("keydown", (event) => {
    if (event.key !== ESCAPE || pinned === null) {
      return;
    }
    pin(null);
  });

  draw();
  onScroll();

  // A fragment naming a stage opens with that stage pinned and in view.
  const fromFragment = indexOf.get(
    location.hash.startsWith(STAGE_FRAGMENT)
      ? location.hash.slice(STAGE_FRAGMENT.length)
      : null,
  );
  if (fromFragment !== undefined) {
    pin(fromFragment);
    jumpTo(fromFragment);
  }
}
