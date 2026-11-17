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
