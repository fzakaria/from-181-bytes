// A small element builder: el("a", { href, class: "x" }, "text", child).
// Attributes starting with "on" become event listeners.
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) {
      continue;
    }
    if (name.startsWith("on")) {
      node.addEventListener(name.slice(2), value);
      continue;
    }
    node.setAttribute(name, value === true ? "" : value);
  }
  node.append(
    ...children.flat().filter((child) => child !== null && child !== undefined),
  );
  return node;
}

// Replace the tabs in `container` with one button per option and call
// `choose` with the picked value. Returns a function that marks a value
// selected without calling `choose`.
export function tabs(container, options, choose) {
  const buttons = options.map(({ value, label }) =>
    el(
      "button",
      { role: "tab", "aria-selected": "false", onclick: () => choose(value) },
      label,
    ),
  );
  container.replaceChildren(...buttons);
  return (selected) => {
    options.forEach(({ value }, index) => {
      buttons[index].setAttribute("aria-selected", String(value === selected));
    });
  };
}
