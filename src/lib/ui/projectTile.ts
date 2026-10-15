// A project's tile: two letters and a hue from its folder name, the same everywhere it shows
// (the rail, the project list, the palette). Pure, so it runs under `node --test`.
import type { CSSProperties } from "react";

/** Two letters from the name's words (`billing-api` BA, `myRepo` MR), else its first two; letters and digits only. */
export function tileInitials(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  const two = words.length >= 2 ? words[0][0] + words[1][0] : (words[0] ?? "").slice(0, 2);
  return two.toUpperCase() || "?";
}

/** A stable hue per name. */
export function tileHue(name: string): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

/** A tinted tile with letters in its hue, readable on dark and light themes alike. */
export function tileStyle(name: string, strong = false) {
  const h = tileHue(name);
  return {
    background: `hsl(${h} 70% 55% / ${strong ? 0.26 : 0.15})`,
    color: `color-mix(in oklab, hsl(${h} 75% 62%) 70%, var(--foreground))`,
    "--tile": `hsl(${h} 75% 60%)`,
  } as CSSProperties;
}
