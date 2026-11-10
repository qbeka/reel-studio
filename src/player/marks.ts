import type { Rect } from '../core/camera';

/**
 * Finds what two renders of one scene show differently, by reading both.
 *
 * A scene is drawn from its state alone, so two states of one scene give two trees of the
 * same shape wherever the states agree. Walking them side by side finds the places that
 * do not: a text that reads differently, a field with another value, a control that is on
 * in one and off in the other, a part that exists in only one. It knows nothing about the
 * scene, so it works for any of them.
 */

/** Attributes that say nothing about what a person sees. */
const IGNORED = new Set(['data-reel-point', 'data-reel-target', 'data-idle', 'id', 'for', 'name', 'tabindex', 'inert']);

function ownText(element: Element): string {
  let text = '';
  for (const node of element.childNodes) if (node.nodeType === 3) text += node.nodeValue;
  return text.trim();
}

function sameOwn(a: Element, b: Element): boolean {
  if (ownText(a) !== ownText(b)) return false;
  if (a instanceof HTMLInputElement && b instanceof HTMLInputElement) {
    if (a.value !== b.value || a.checked !== b.checked) return false;
  }
  const names = new Set<string>();
  for (const { name } of a.attributes) names.add(name);
  for (const { name } of b.attributes) names.add(name);
  for (const name of names) {
    // A field's value attribute lags behind its value, which was compared above.
    if (IGNORED.has(name) || name === 'value' || name === 'checked') continue;
    if (a.getAttribute(name) !== b.getAttribute(name)) return false;
  }
  return true;
}

/** What makes two children the same part of a scene: what they are and what they are called. */
const kind = (element: Element) => `${element.tagName} ${element.getAttribute('class') ?? ''}`;

function walk(a: Element, b: Element, out: HTMLElement[]): boolean {
  if (a.tagName !== b.tagName) {
    out.push(b as HTMLElement);
    return true;
  }
  let inside = false;
  // A scene shows some parts only in some states, such as an error or a notice. Children
  // are paired in order by kind, so a part that came or went does not hide the ones that
  // stayed, and a part with no partner is itself the difference.
  let from = 0;
  for (const child of b.children) {
    let match = -1;
    for (let i = from; i < a.children.length; i++) {
      if (kind(a.children[i]!) === kind(child)) {
        match = i;
        break;
      }
    }
    if (match < 0) {
      out.push(child as HTMLElement);
      inside = true;
      continue;
    }
    from = match + 1;
    if (walk(a.children[match]!, child, out)) inside = true;
  }
  // The smallest part that differs is the one to point at, so a parent gives way to it.
  if (inside) return true;
  if (sameOwn(a, b)) return false;
  out.push(b as HTMLElement);
  return true;
}

/** The elements of `shown` that differ from their counterparts in `other`, smallest first found. */
export function changedElements(other: Element, shown: Element): HTMLElement[] {
  const out: HTMLElement[] = [];
  const a = other.firstElementChild;
  const b = shown.firstElementChild;
  if (a === null || b === null) return out;
  walk(a, b, out);
  return out;
}

/** Layout bounds of `elements` inside `root`, ignoring transforms, with boxes of no size left out. */
export function boundsOf(elements: readonly HTMLElement[], root: HTMLElement): Rect[] {
  const rects: Rect[] = [];
  for (const element of elements) {
    let x = 0;
    let y = 0;
    let node: HTMLElement | null = element;
    while (node !== null && node !== root) {
      x += node.offsetLeft;
      y += node.offsetTop;
      node = node.offsetParent as HTMLElement | null;
    }
    // An element that is not laid out has no offset parent and no size.
    if (node === null || element.offsetWidth === 0 || element.offsetHeight === 0) continue;
    rects.push({ x, y, width: element.offsetWidth, height: element.offsetHeight });
  }
  return rects;
}
