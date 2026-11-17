# Design

## The seed first

The page opens on the 181 bytes, because they are the claim. Each byte is a
button. Hovering, focusing or tapping one lights every byte from the same
source line and the line itself, and describes it: offset, value, the hex
on the line, the instruction after `;`, the comment after `#`, and the
`## Section` or `#:label` it sits under.

The mapping is not precomputed. `site/js/hex0.js` is a port of the seed's
own loop (hex digits pair into bytes, `#` and `;` start a comment that
ends at a newline), and the page runs it over `hex0_<arch>.hex0` and
compares the result with the seed. The line under the grid reports that
comparison. `tests/hex0.test.mjs` runs the same code over all four seeds.

## Seed at the top, scrolling forward in build order

The climb runs from the seed down the page to GCC 16. The brief offered
either direction. Build order wins because the gauges and milestones only
read correctly in it. "Bytes produced" climbs as you scroll instead of
draining, and each milestone lights the first time the reader reaches a
floor that can do something new. The opposite direction, from a finished
file back to the seed, is what "who built you?" is for, and it draws on
the same picture.

## The picture

The chain is drawn as a tower in SVG, one row per floor:

- the **seed row** at the top is twice as tall and draws the seed itself:
  one cell per byte, filled row by row in the hex era's colour, darker
  for larger values, inside the seed's log-scaled width;
- the **band** is everything built so far, on a log10 scale from the seed
  to the last floor's total, so the tower visibly widens from 181 bytes to
  1.6 GiB and never narrows;
- the **core** inside it is what that floor produced, on the same scale;
- the grey **tick** right of the band is source fetched at that floor;
- **arcs** on the left join each floor to the floor that built it, bulging
  further the more floors they span, so the seven floors M2-Planet built,
  up to seven rows below it, read as a fan clear of the one-row steps;
- **era bands** behind the rows group the floors by what they compile:
  hex and assembly, M2-Planet's C subset, GNU Mes, TinyCC, GCC written in
  C, GCC with C++.

The geometry is `site/js/tower.js`, pure functions under
`tests/tower.test.mjs`; `tower-view.js` draws it. The label column is
measured in the page, and the bands take what the arcs and labels leave,
so the picture fits a 360 pixel phone without scrolling sideways. The
hex0 listing beside the seed wraps for the same reason: each line hangs
its continuation rows from the rightmost of its own columns (the hex,
the `;` or the `#`) that leaves room to read, and `tests/hex0.test.mjs`
covers how that column is picked. There is no graph library. Every
floor has exactly one builder, so the graph the picture shows is a tree
laid along a known order, and an arc diagram needs no layout algorithm.
seenix and the other sites ship vanilla modules with no CDN dependency;
this keeps that.

A card beside the picture describes the floor at the reading line, just
under the pinned gauges, and follows the scroll. Hovering or tapping a row
shows that floor instead and highlights its builder (dashed), the arc
between them, and the floors it also used. On a phone the card becomes a
sheet at the bottom of the screen, shown only while the picture is on
screen. Transitions are skipped under `prefers-reduced-motion`.

## Who built you?

The file list is the runtime closure of the last floor. Picking a file
walks built-by from its store path's derivation to the seed
(`site/js/trace.js`). The trace is drawn three ways: as a list naming
every hop and the derivations between hops, on a compact copy of the
tower beside the list, and on the main tower once a reader has picked a
file. The default trace, `bin/gcc`, is drawn only on the compact copy, so
the climb opens without it.

## Two systems, four seeds

nixpkgs builds this chain for `i686-linux` and `x86_64-linux`. The page
defaults to i686, whose seed is the 181 bytes in the title; x86_64-linux
starts from a 229 byte AMD64 seed, and the "bytes you trust" gauge says so
when that system is picked. The seed explorer also offers the AArch64 (526
bytes) and riscv64 (392 bytes) seeds that stage0-posix ships, which have
no chain on this page.

## Words

The site's copy follows the same rules as its code comments: short
sentences, numbers that were measured, sources linked. The citation on the
seed's card is a joke and says so: a card from a committee of one, with no
medal and no prize money.
