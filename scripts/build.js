#!/usr/bin/env node
// Builds dist/tokens.css from src/tokens.json.
//
// Core idea: CSS custom properties can reference other custom properties via
// var(), and the browser resolves the whole chain at paint time. That means
// a token like background.surface.faint, which depends on BOTH light/dark
// AND which of five Neutral flavors is active, never needs to be "flattened"
// into 10 baked combinations. It just becomes:
//
//   :root { --semantics-surface-background-surface-faint: var(--neutral-neutral-50); }
//
// and --neutral-neutral-50 is separately redefined per [data-neutral="..."]
// selector. The cascade composes the two independent axes for free. This
// generalizes to all four dimensions (theme, neutral, accent, radius, font)
// with the same mechanism, no combinatorial explosion, no per-combination
// build.

const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "src", "tokens.json");
const OUT = path.join(__dirname, "..", "dist", "tokens.css");

// Each entry: the CSS attribute that switches this dimension, the exact set
// of mode names as they appear in tokens.json (case-sensitive, matches the
// real Figma mode names), and which mode is the baseline written into :root.
const MODE_SETS = [
  { attr: "data-theme", modes: ["Light", "Dark"], default: "Light" },
  { attr: "data-neutral", modes: ["Neutral", "Slate", "Mauve", "Taupe", "Cream"], default: "Neutral" },
  { attr: "data-accent", modes: ["Purple", "Blue", "Teal", "Green", "tushe"], default: "Purple" },
  { attr: "data-radius", modes: ["default", "sharp", "round"], default: "default" },
  { attr: "data-font", modes: ["preset-1", "preset-2", "preset-3", "preset-4", "preset-5"], default: "preset-5" },
];

// First-pass unit heuristic, keyed by path prefix. This is deliberately a
// stopgap: the real pipeline should decide units via a hand-curated,
// path-based transform table (matching the "naming decoupled from Figma
// paths" principle already established), not this hardcoded list. Good
// enough to produce valid, sensible CSS for a first working build.
const UNIT_RULES = [
  { prefix: "primitives-spacing", unit: "px" },
  { prefix: "primitives-size", unit: "px" },
  { prefix: "primitives-font-size", unit: "px" },
  { prefix: "primitives-border-width", unit: "px" },
  { prefix: "primitives-blur", unit: "px" },
  { prefix: "primitives-breakpoint", unit: "px" },
  { prefix: "primitives-container", unit: "px" },
  { prefix: "radius-radius", unit: "px" },
  { prefix: "primitives-skew", unit: "deg" },
  { prefix: "primitives-opacity", unit: "%" },
  { prefix: "primitives-duration", unit: "ms" },
];

function unitFor(cssVarName) {
  const rule = UNIT_RULES.find((r) => cssVarName.startsWith(r.prefix));
  return rule ? rule.unit : "";
}

function isModeMap(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (keys.length < 2) return null; // not a mode-map, just a coincidental single-key object

  // A value counts as belonging to a dimension if every key it has is a
  // known mode of that dimension. It does NOT need to have every possible
  // mode present (a token could legitimately omit one), but it must never
  // contain a mode name we don't recognize, that's the case that used to
  // silently produce `[object Object]` in the output.
  const candidates = MODE_SETS.filter((set) => keys.every((k) => set.modes.includes(k)));

  if (candidates.length === 1) return candidates[0];

  if (candidates.length === 0) {
    throw new Error(
      `Unrecognized mode set: {${keys.join(", ")}}. This looks like a mode-map ` +
        `(a token with multiple named variants) but its keys don't match any ` +
        `dimension in MODE_SETS. If this is a new preset (e.g. a 6th Neutral ` +
        `flavor like "Zinc"), add its name to the matching entry in MODE_SETS ` +
        `at the top of this file before rebuilding. Refusing to guess rather ` +
        `than silently writing invalid CSS.`
    );
  }

  // More than one dimension's mode list could contain all these keys
  // (shouldn't happen with today's five dimensions, since none share mode
  // names, but worth failing loudly if a future dimension's naming
  // collides rather than silently picking the first match).
  throw new Error(
    `Ambiguous mode set: {${keys.join(", ")}} matches more than one dimension ` +
      `(${candidates.map((c) => c.attr).join(", ")}). Mode names need to stay ` +
      `unique across dimensions for this detection to work.`
  );
}

function isReference(value) {
  return typeof value === "string" && /^\{[\w.-]+\}$/.test(value);
}

function referencePath(value) {
  return value.slice(1, -1); // strip { and }
}

// --- 1. flatten the tree into a path -> token map ---------------------------

function walk(node, pathParts, tokens) {
  if (node && typeof node === "object" && "value" in node) {
    tokens.set(pathParts.join("."), { value: node.value, description: node.description });
  }
  if (node && typeof node === "object" && !Array.isArray(node)) {
    for (const [key, child] of Object.entries(node)) {
      if (key === "value" || key === "description") continue;
      if (child && typeof child === "object") {
        walk(child, [...pathParts, key], tokens);
      }
    }
  }
}

function cssVarName(dottedPath) {
  return dottedPath.replace(/\./g, "-");
}

function formatLiteral(value, cssVarName) {
  if (typeof value === "number") {
    return `${value}${unitFor(cssVarName)}`;
  }
  return value; // hex strings, rgba() strings, plain strings (font names, easing curves) pass through
}

// --- 2. build CSS ------------------------------------------------------------

function buildCss(tokens) {
  const rootLines = [];
  // one array of declaration lines per non-default mode value, keyed by
  // `${attr}="${mode}"` selector
  const modeBlocks = new Map();

  function pushModeLine(attr, mode, line) {
    const key = `[${attr}="${mode}"]`;
    if (!modeBlocks.has(key)) modeBlocks.set(key, []);
    modeBlocks.get(key).push(line);
  }

  for (const [dottedPath, token] of tokens.entries()) {
    const varName = cssVarName(dottedPath);
    const modeSet = isModeMap(token.value);

    if (modeSet) {
      for (const mode of modeSet.modes) {
        const raw = token.value[mode];
        const resolved = isReference(raw)
          ? `var(--${cssVarName(referencePath(raw))})`
          : formatLiteral(raw, varName);
        const line = `  --${varName}: ${resolved};`;
        if (mode === modeSet.default) {
          rootLines.push(line);
        }
        // emit every mode (including default) as an explicit selector too,
        // so switching never silently depends on :root's fallback alone
        pushModeLine(modeSet.attr, mode, line);
      }
    } else if (isReference(token.value)) {
      rootLines.push(`  --${varName}: var(--${cssVarName(referencePath(token.value))});`);
    } else {
      rootLines.push(`  --${varName}: ${formatLiteral(token.value, varName)};`);
    }
  }

  let css = `/* Generated by scripts/build.js from src/tokens.json. Do not hand-edit. */\n\n`;
  css += `:root {\n${rootLines.join("\n")}\n}\n`;
  for (const [selector, lines] of modeBlocks.entries()) {
    css += `\n${selector} {\n${lines.join("\n")}\n}\n`;
  }
  return css;
}

// --- run ----------------------------------------------------------------------

const raw = JSON.parse(fs.readFileSync(SRC, "utf8"));
const tokens = new Map();
for (const [key, value] of Object.entries(raw)) {
  if (key === "$description" || key === "pulledAt") continue;
  walk(value, [key], tokens);
}

const css = buildCss(tokens);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, css);
console.log(`Wrote ${OUT} (${tokens.size} tokens, ${css.length} bytes)`);
