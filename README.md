# @tushe-abdulqahar/tokens

Tushe Design System tokens, compiled to CSS custom properties. Zero runtime dependencies, nothing to install alongside it, just a CSS file to import.

## Install

```sh
npm install @tushe-abdulqahar/tokens
```

## Use

```css
@import "@tushe-abdulqahar/tokens/tokens.css";
@import "@tushe-abdulqahar/tokens/theme-map.css";
@import "@tushe-abdulqahar/tokens/utilities.css";
@import "@tushe-abdulqahar/tokens/text-styles.css";
```

`tokens.css` gives you every token as a CSS custom property, e.g. `var(--semantics-surface-background-surface-faint)`. `theme-map.css`, `utilities.css`, and `text-styles.css` all need Tailwind v4 to actually compile them into classes, if you're not using Tailwind, the `tokens.css` import alone is all you need. Import order matters, the other three all reference variables `tokens.css` defines. `text-styles.css` gives compound `text-*` classes (`text-body-base-normal`) covering font-size, line-height, letter-spacing, and weight in one class, mobile-first with a 768px breakpoint override for the web-sized values. It deliberately excludes font-family, pair it with `font-sans` (already inherited from the root layout) or `font-mono` for `text-code-*`.

## Switching dimensions

Four partner-theming dimensions switch independently, each via its own `data-*` attribute on any ancestor element (typically `<html>`):

| Dimension | Attribute | Values |
|---|---|---|
| Theme (light/dark) | `data-theme` | `Light`, `Dark` |
| Neutral (gray family) | `data-neutral` | `Neutral`, `Slate`, `Mauve`, `Taupe`, `Cream` |
| Accent (brand color) | `data-accent` | `Purple`, `Blue`, `Teal`, `Green`, `tushe` |
| Radius | `data-radius` | `default`, `sharp`, `round` |
| Font | `data-font` | `preset-1` (Google Sans Flex), `preset-2` (DM Sans), `preset-3` (Outfit), `preset-4` (Manrope), `preset-5` (Inter) |

```html
<html data-theme="Dark" data-neutral="Cream" data-accent="tushe" data-radius="round" data-font="preset-2">
```

Any dimension left unset falls back to its default (`Light`, `Neutral`, `Purple`, `default`, `preset-5`). Dimensions compose freely, all 750 combinations across the five dimensions work from this one file, nothing is baked per combination.

## Rebuilding from source

```sh
npm run build
```

Regenerates `dist/tokens.css` from `src/tokens.json`, the export from the Tushe Token Export Figma plugin. `src/tokens.json` is the only thing that should ever be hand-replaced (by re-running the plugin export); `dist/tokens.css` is always generated, never hand-edited.

## What's in this package

This package ships all four CSS files: `tokens.css` (every token as a custom property), `theme-map.css` (a Tailwind v4 `@theme inline` bridge for spacing, radius, and type, generated only for categories with a confirmed Tailwind namespace), `utilities.css` (`@utility` classes for role-aware semantic color, e.g. `bg-brand-bold`, plus focus-ring `ring-*`/`outline-*` pairs), and `text-styles.css` (compound `text-*` classes from Figma's 75 text styles, mobile-first, font-family deliberately excluded so `data-font` switching still works underneath). All four are generated directly from Figma data, nothing is copied from another project's shape, so categories that don't exist in the Tushe DS (there's currently no `duration` or `easing` primitive) simply don't appear, rather than being faked to match a template.