# @folkshops/ui

Shared React component library used by marketing, storefront, merchant-admin, platform-admin.

Ships as raw TypeScript source (no build step) — consuming Next.js apps add it to
`transpilePackages` in `next.config.ts` and compile it themselves.

## What's here

- `theme.tsx` — `ThemeProvider`, `useTheme`, `ThemeToggle`, `ThemeScript`: light/dark/system theme
  switching, persisted to `localStorage`, no flash of the wrong theme on load.
- `theme.css` — the CSS custom properties (`--background`, `--foreground`, `--border`, `--muted`,
  `--accent`, ...) that `.dark` flips, registered as Tailwind v4 theme colors via `@theme inline`.

Any future shared component (buttons, inputs, cards, ...) should use the semantic Tailwind classes
this provides (`bg-background`, `text-foreground`, `border-border`, etc.) instead of hardcoded
colors, so it's dark-mode-correct automatically — see `docs/decisions/` for the full rationale.

## Using it in an app

```ts
// next.config.ts
transpilePackages: ["@folkshops/ui"],
```

```tsx
// app/layout.tsx
import { ThemeProvider, ThemeScript } from "@folkshops/ui";
import "@folkshops/ui/css"; // usually re-exported through the app's own globals.css instead

<html lang="en" suppressHydrationWarning>
  <head><ThemeScript /></head>
  <body><ThemeProvider>{children}</ThemeProvider></body>
</html>
```

```css
/* app/globals.css */
@import "tailwindcss";
@import "@folkshops/ui/css";
```
