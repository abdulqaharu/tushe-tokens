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

// next/font/google self-hosts fonts under a synthetic, scoped family name,
// it never registers the plain Google Fonts name ("DM Sans") globally in the
// browser. So the literal names in tokens.json's font.family.sans mode-map
// can't be used directly as CSS font-family values, they need to become
// references to whatever CSS variable the consuming Next.js app exposes via
// next/font/google's `variable` option. This mapping is that hand-curated
// translation, consistent with the standing principle that naming is
// decoupled from Figma paths rather than auto-derived.
const FONT_NAME_TO_CSS_VAR = {
  "Google Sans Flex": "--font-preset-1",
  "DM Sans": "--font-preset-2",
  "Outfit": "--font-preset-3",
  "Manrope": "--font-preset-4",
  "Inter": "--font-preset-5",
};
const FONT_TOKEN_PATH = "primitives.font.family.sans";

function resolveFontValue(rawValue, dottedPath) {
  if (dottedPath !== FONT_TOKEN_PATH) return null; // not the font token, handle normally
  const cssVar = FONT_NAME_TO_CSS_VAR[rawValue];
  if (!cssVar) {
    throw new Error(
      `Font preset "${rawValue}" at ${dottedPath} has no entry in FONT_NAME_TO_CSS_VAR. ` +
        `Every font name in the font.family.sans mode-map needs a matching CSS variable ` +
        `here, add it before rebuilding, this can't fall back to the literal name.`
    );
  }
  return `var(${cssVar})`;
}

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
        const fontValue = resolveFontValue(raw, dottedPath);
        const resolved =
          fontValue !== null
            ? fontValue
            : isReference(raw)
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

// --- 3. theme-map.css: clean 1:1 Tailwind @theme namespaces -----------------
//
// Only categories with a confirmed real Tailwind v4 @theme namespace are
// included here. border-width, opacity, and skew are deliberately left out:
// Tailwind v4 doesn't expose a documented @theme namespace for customizing
// those scales the way it does for spacing/radius/font/etc, and guessing one
// would silently ship a mapping that does nothing. Those tokens are still
// fully available as plain CSS variables via tokens.css, just not bridged
// into a Tailwind utility here.
const THEME_MAP_RULES = [
  { pathPrefix: "primitives.spacing.", tailwindPrefix: "--spacing-" },
  { pathPrefix: "primitives.font.size.", tailwindPrefix: "--text-" },
  { pathPrefix: "primitives.font.family.", tailwindPrefix: "--font-" },
  { pathPrefix: "primitives.font.weight.", tailwindPrefix: "--font-weight-" },
  { pathPrefix: "primitives.font.tracking.", tailwindPrefix: "--tracking-" },
  { pathPrefix: "primitives.font.leading.", tailwindPrefix: "--leading-" },
  { pathPrefix: "radius.radius.", tailwindPrefix: "--radius-" },
  { pathPrefix: "primitives.breakpoint.", tailwindPrefix: "--breakpoint-" },
  { pathPrefix: "primitives.container.", tailwindPrefix: "--container-" },
  { pathPrefix: "primitives.blur.", tailwindPrefix: "--blur-" },
];

// breakpoint and container feed @media/@container conditions specifically,
// and CSS media/container query conditions cannot contain var(), browsers
// require a literal value there. Every other category below is used in
// ordinary property values (padding, border-radius, font-family, ...),
// where var() works fine and is preferred so this file stays a thin
// reference layer over tokens.css rather than duplicating values.
const THEME_MAP_LITERAL_PREFIXES = ["primitives.breakpoint.", "primitives.container."];

function buildThemeMap(tokens) {
  const lines = [];
  for (const [dottedPath, token] of tokens.entries()) {
    const rule = THEME_MAP_RULES.find((r) => dottedPath.startsWith(r.pathPrefix));
    if (!rule) continue;
    const suffix = dottedPath.slice(rule.pathPrefix.length);
    const needsLiteral = THEME_MAP_LITERAL_PREFIXES.some((p) => dottedPath.startsWith(p));

    if (needsLiteral) {
      if (isReference(token.value) || isModeMap(token.value)) {
        throw new Error(
          `${dottedPath} is a breakpoint/container token but its value is a reference ` +
            `or mode-map, not a literal. @media/@container conditions can't contain ` +
            `var(), so this token must resolve to a plain number in Figma.`
        );
      }
      lines.push(`  ${rule.tailwindPrefix}${suffix}: ${formatLiteral(token.value, cssVarName(dottedPath))};`);
    } else {
      lines.push(`  ${rule.tailwindPrefix}${suffix}: var(--${cssVarName(dottedPath)});`);
    }
  }
  return (
    `/* Generated by scripts/build.js from src/tokens.json. Do not hand-edit. */\n` +
    `/* Requires tokens.css to be imported first: every value here (except breakpoint/container, which need literals) is a reference to it. */\n\n` +
    `@theme inline {\n${lines.join("\n")}\n}\n`
  );
}

// --- 4. utilities.css: role-aware semantic color, driven by real data -------
//
// Tailwind v4's shared --color-* namespace generates bg-/text-/border-
// utilities off ONE value per name, but background.brand.bold and
// text.brand.bold deliberately hold different values (confirmed with 50 real
// collision cases earlier this session). Hand-authored @utility classes
// sidestep that entirely, each one locked to its own CSS variable.
const UTILITY_CATEGORY_MAP = {
  background: { prefix: "bg", property: "background-color" },
  text: { prefix: "text", property: "color" },
  icon: { prefix: "icon", property: "color" },
  border: { prefix: "border", property: "border-color" },
};

function buildUtilities(tokens) {
  const blocks = [];
  const seen = new Set();

  for (const dottedPath of tokens.keys()) {
    const parts = dottedPath.split(".");
    // only semantic collections carry role-aware color; skip everything else
    if (parts[0] !== "semantics-surface" && parts[0] !== "semantics-state") continue;

    const category = parts[1];
    const rest = parts.slice(2).join("-");
    if (!rest) continue;
    const varName = cssVarName(dottedPath);

    if (category === "focus-ring") {
      for (const [utilityName, prop] of [
        [`ring-${rest}`, "--tw-ring-color"],
        [`outline-${rest}`, "outline-color"],
      ]) {
        if (seen.has(utilityName)) continue;
        seen.add(utilityName);
        blocks.push(`@utility ${utilityName} {\n  ${prop}: var(--${varName});\n}`);
      }
      continue;
    }

    const mapping = UTILITY_CATEGORY_MAP[category];
    if (!mapping) continue; // category exists in the tree but isn't one we generate utilities for

    const utilityName = `${mapping.prefix}-${rest}`;
    if (seen.has(utilityName)) {
      console.warn(`Duplicate utility name "${utilityName}" from ${dottedPath}, keeping the first one seen.`);
      continue;
    }
    seen.add(utilityName);
    blocks.push(`@utility ${utilityName} {\n  ${mapping.property}: var(--${varName});\n}`);
  }

  return (
    `/* Generated by scripts/build.js from src/tokens.json. Do not hand-edit. */\n` +
    `/* Requires tokens.css to be imported first: every value here is a reference to it. */\n\n` +
    blocks.join("\n\n") +
    "\n"
  );
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

const THEME_MAP_OUT = path.join(__dirname, "..", "dist", "theme-map.css");
const themeMapCss = buildThemeMap(tokens);
fs.writeFileSync(THEME_MAP_OUT, themeMapCss);
console.log(`Wrote ${THEME_MAP_OUT} (${themeMapCss.length} bytes)`);

const UTILITIES_OUT = path.join(__dirname, "..", "dist", "utilities.css");
const utilitiesCss = buildUtilities(tokens);
fs.writeFileSync(UTILITIES_OUT, utilitiesCss);
console.log(`Wrote ${UTILITIES_OUT} (${utilitiesCss.length} bytes)`);