# Design

## The seed first

The page opens on a note from the owner and then the 181 bytes, because
they are the claim. Each byte is a button. Hovering, focusing or tapping
one lights every byte from the same source line and the line itself, and
describes it: offset, value, the hex on the line, the instruction after
`;`, the comment after `#`, and the `## Section` or `#:label` it sits
under.

The source pane only moves when a byte picked in the grid has its line
out of view, in one instant move, and never moves the page. Pointing at
lines in the pane highlights them without scrolling, and once the reader
scrolls the pane themselves it is left alone until the pointer is back
on the grid. The highlight is background colour only, and on a phone the
byte description sits under the pane, so nothing shifts as the pointer
moves. `tests/browser/seed.test.mjs` holds the page to this.

The mapping is not precomputed. `site/js/hex0.js` is a port of the seed's
own loop (hex digits pair into bytes, `#` and `;` start a comment that
ends at a newline), and the page runs it over `hex0_x86.hex0` and
compares the result with the seed. The line under the grid reports that
comparison. `tests/hex0.test.mjs` runs the same code over the seed.

The listing is highlighted: bytes, the mnemonic after `;`, label
references (`!loop`, `$output`), label definitions (`#:ELF_base`) and
comments each get a colour. It wraps rather than scrolling sideways: each
line hangs its continuation rows from the rightmost of its own columns
(the hex, the `;` or the `#`) that leaves room to read. The tokenizer and
the hang are tested in `tests/hex0.test.mjs`.

## Seed at the top, scrolling forward in build order

The climb runs from the seed down the page to GCC 16. Build order wins
because the gauges only read correctly in it: "bytes produced" climbs to
1.6 GiB as you scroll instead of draining.

## The picture

The chain is drawn as a tower in SVG on a dark panel, one row per stage:

- the **seed row** at the top is twice as tall and draws the seed itself:
  one cell per byte, filled row by row in the hex era's colour, darker
  for larger values;
- every other row is a **bar** as wide as that stage's output on a log10
  scale, so a stage that outputs less than the one above it is narrower;
- each bar is **textured** from the stage's largest output file: the file
  cut into at most 128 slices, each shaded by its byte entropy (0 to 8
  bits per byte). Zero padding is dark, text is in the middle, machine
  code and compressed data are bright, so hand-written hex, M2-Planet's
  output and GCC's read differently;
- dashed **gridlines** mark where a 1 KiB and a 1 MiB bar end;
- the grey **tick** right of the bar is source fetched at that stage;
- **arcs** on the left join each stage to the stage that built it, bulging
  further the more stages they span, so the seven stages M2-Planet built
  read as a fan clear of the one-row steps;
- **era bands** behind the rows group the stages by what they compile:
  hex and assembly, M2-Planet's C subset, GNU Mes, TinyCC, GCC written in
  C, GCC with C++.

The geometry is `site/js/tower.js`, pure functions under
`tests/tower.test.mjs`; `tower-view.js` draws it. The label column is
measured in the page, and the bars take what the arcs and labels leave,
so the picture fits a 360 pixel phone without scrolling sideways. On a
narrow tower a stage's milestone gets its own line under its size. There
is no graph library. Every stage has exactly one builder, so the graph
the picture shows is a tree laid along a known order, and an arc diagram
needs no layout algorithm. seenix and the other sites ship vanilla
modules with no CDN dependency; this keeps that.

## The card, hovering and pinning

A card beside the picture describes one stage. It shows the stage under
the mouse while the mouse is on the tower; otherwise the pinned stage;
otherwise the stage at the reading line, just under the pinned gauges.
A click, or Enter or Space on a focused row, pins a stage: it gets a
marker and an accent title, the URL fragment becomes `#stage-<id>`, and
the card stays on it while the page scrolls. Clicking it again or
pressing Escape unpins it. A page opened on `#stage-<id>` starts with
that stage pinned. Touch has no hover, so a tap pins.

The gauges count through the same stage as the card, so the two never
disagree: bytes produced, derivations built and source read up to and
including it, with a caption naming it.

Highlighting stays light: the stage shown is outlined, its builder
outlined dashed, and the arc between them tinted. On a phone the card is
a sheet at the bottom of the screen, shown only while the picture is on
screen. `tests/browser/climb.test.mjs` drives all of this in headless
Chromium.

## The last stage

The chain ends at GCC 16.2.0 built against glibc. The standard
environment receives it through `gcc-wrapper-16.2.0`, 16 KiB of shell
scripts and symlinks that bash writes; no compiler builds it, so it is not
a stage. The last card names it and links its store path, and the totals
end before it. `tests/data.test.mjs` fails if a stage written in shell
claims a compiler, assembler or linker as its builder.

## One system

nixpkgs builds this chain for `i686-linux` and `x86_64-linux`. The page
shows i686, whose seed is the 181 bytes in the title; the x86_64 chain is
the same stages from a 229 byte AMD64 seed, and the aside under the seed
says so.

## Words

The site's copy is short and set small, and follows the same rules as
its code comments: short sentences, numbers that were measured, sources
linked. The citation on the seed's card is a joke and says so: a card
from a committee of one, with no medal and no prize money.
