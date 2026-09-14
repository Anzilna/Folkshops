"use client";

import { useEffect, useState } from "react";

/**
 * Keeps an element mounted long enough to play its exit transition, and
 * delays the "open" state one frame so the entrance starts from the
 * hidden style instead of snapping. Drives `data-state="open|closed"`;
 * the element's CSS transitions do the rest — transitions, not keyframes,
 * so a dropdown toggled twice in a second retargets from wherever it is
 * rather than restarting (see .claude/skills/animate, step 6).
 */
export function usePresence(open: boolean, exitMs: number): { mounted: boolean; state: "open" | "closed" } {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      // Two frames: the first commits the closed style, the second flips
      // it so the browser has something to transition from.
      let inner = 0;
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => setVisible(true));
      });
      return () => {
        cancelAnimationFrame(outer);
        cancelAnimationFrame(inner);
      };
    }
    setVisible(false);
    const t = setTimeout(() => setMounted(false), exitMs);
    return () => clearTimeout(t);
  }, [open, exitMs]);

  return { mounted, state: visible ? "open" : "closed" };
}
