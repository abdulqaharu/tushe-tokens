# @tushe/tokens

Tushe Design System tokens, compiled to CSS custom properties. Zero runtime dependencies, nothing to install alongside it, just a CSS file to import.

## Install

```sh
npm install @tushe/tokens
```

## Use

```css
@import "@tushe/tokens/tokens.css";
```

Every token from the Tushe DS Figma file is available as a CSS custom property, e.g. `var(--semantics-surface-background-surface-faint)`.

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

## What's in this package, and what's still to come

This package currently ships `tokens.css`, every token as a custom property. Two more files from the original pipeline plan are not yet built: `theme-map.css` (a Tailwind v4 `@theme inline` bridge for spacing/radius/type/easing) and `utilities.css` (`@utility` classes for semantic color and duration, e.g. `bg-brand-bold`). Both read from the same custom properties this package already generates, adding them doesn't change anything documented here.
