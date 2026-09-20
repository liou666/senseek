import { LIMITS, splitTextSpans } from "../extension/core/text.js";

const OMIT = 'script,style,noscript,template,svg,canvas,iframe,input,textarea,select,[hidden],[aria-hidden="true"],[data-jev-find-root]';
const PROSE = "p,li,pre,blockquote,h1,h2,h3,h4,h5,h6,td,th,figcaption,dd,dt,summary";
const NAVIGATION = 'nav,[role="navigation"]';
const BLOCK = `${PROSE},div,section,article,main,details,header,footer,${NAVIGATION}`;

function textBlock(parent) {
  const block = parent.closest(BLOCK);
  const label = parent.closest('a,button,[role="link"],[role="button"],[role="menuitem"],[role="tab"]');
  // Keep adjacent controls separate while preserving links within prose.
  if (label && (!block || !block.matches(PROSE) || label.closest(NAVIGATION))) return label;
  return block || parent;
}

export function collectPage(doc = document) {
  const blocks = [];
  if (!doc.body) return { blocks, truncated: false, chars: 0 };
  const win = doc.defaultView;
  const visibility = new WeakMap();
  function readable(parent) {
    if (visibility.has(parent)) return visibility.get(parent);
    const style = win.getComputedStyle(parent);
    const visible = !parent.closest(OMIT) && !parent.isContentEditable
      && parent.getClientRects().length > 0 && style.visibility === "visible" && style.display !== "none";
    visibility.set(parent, Boolean(visible));
    return visible;
  }
  let group = null, size = 0, truncated = false;
  function flush() {
    if (!group) return;
    for (const span of splitTextSpans(group.text)) {
      if (span.text.length < 2) continue;
      if (blocks.length >= LIMITS.blocks || size + span.text.length > LIMITS.totalChars) {
        truncated = true;
        break;
      }
      blocks.push({ id: `b${blocks.length}`, text: span.text, start: span.start, end: span.end, nodes: group.nodes, el: group.el });
      size += span.text.length;
    }
    group = null;
  }
  const walker = doc.createTreeWalker(doc.body, win.NodeFilter.SHOW_TEXT);
  let node, visited = 0;
  while ((node = walker.nextNode())) {
    if (++visited > 50000) { truncated = true; break; }
    if (!node.textContent || !node.parentElement || !readable(node.parentElement)) continue;
    const el = textBlock(node.parentElement);
    if (group?.el !== el) flush();
    if (truncated) break;
    if (!group) group = { el, text: "", nodes: [] };
    group.nodes.push({ node, start: group.text.length, text: node.textContent });
    group.text += node.textContent;
    // Bound collection memory even for a single enormous rendered container.
    if (group.text.length > LIMITS.totalChars + LIMITS.blockChars) { flush(); truncated = true; break; }
  }
  flush();
  return { blocks, truncated, chars: size };
}

// Like browser find, reveal only the disclosures containing the active match.
// A match in a summary needs its outer disclosures open, not its own details.
export function revealRange(range) {
  const disclosures = [];
  for (let el = range.startContainer.parentElement; el; el = el.parentElement) {
    if (el.localName !== "details" || el.open) continue;
    const summary = [...el.children].find((child) => child.localName === "summary");
    if (summary?.contains(range.startContainer) && summary.contains(range.endContainer)) continue;
    disclosures.push(el);
  }
  for (const details of disclosures.reverse()) details.open = true;
}

// Map UTF-16 offsets through the same visible text nodes sent to Jev.
export function rangeFor(block, focus = { start: 0, end: block.text.length, text: block.text }) {
  if (block.stale || !focus || !Number.isInteger(focus.start) || !Number.isInteger(focus.end)
    || focus.start < 0 || focus.end <= focus.start || focus.end > block.text.length
    || block.text.slice(focus.start, focus.end) !== focus.text) return null;
  const start = block.start + focus.start, end = block.start + focus.end;
  const nodes = block.nodes.filter((n) => n.start + n.text.length > block.start && n.start < block.end);
  if (nodes.some(({ node, text }) => !node.isConnected || node.textContent !== text)) return null;
  const first = nodes.find((n) => start >= n.start && start < n.start + n.text.length);
  const last = nodes.find((n) => end > n.start && end <= n.start + n.text.length);
  if (!first || !last) return null;
  const range = block.el.ownerDocument.createRange();
  range.setStart(first.node, start - first.start);
  range.setEnd(last.node, end - last.start);
  return range;
}
