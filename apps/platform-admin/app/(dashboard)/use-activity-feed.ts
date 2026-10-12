"use client";

import type { NotificationItem } from "@folkshops/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { subscribeDashboardRealtime } from "../../lib/dashboard-api";
import { fetchActivity, type ActivityItem } from "../../lib/platform-api";

const STORAGE_KEY = "fk_pa_activity_seen";
const MAX_REMEMBERED_IDS = 200;

interface SeenState {
  /** Everything at or before this moment counts as read. */
  seenAt: number;
  readIds: string[];
}

/**
 * Read state lives in this browser's localStorage, not on the server: the
 * feed is a shared stream of platform events with no per-admin rows, and
 * "have I looked at this yet" is a per-person convenience, not data. A
 * first-ever visit starts with everything already read, so a new admin
 * isn't greeted by twenty "unread" items from before they joined. Storage
 * can be blocked or cleared — every access is guarded and the bell still
 * works without it (it just forgets what you've read).
 */
function loadSeen(): SeenState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SeenState;
      if (typeof parsed.seenAt === "number" && Array.isArray(parsed.readIds)) return parsed;
    }
  } catch {
    /* fall through to a fresh state */
  }
  const fresh: SeenState = { seenAt: Date.now(), readIds: [] };
  saveSeen(fresh);
  return fresh;
}

function saveSeen(state: SeenState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, readIds: state.readIds.slice(-MAX_REMEMBERED_IDS) }));
  } catch {
    /* storage unavailable — read state just won't persist */
  }
}

/** Platform events (stores signing up, billing changes, admin actions) as bell items, refreshed live over the shared dashboard stream. */
export function useActivityFeed() {
  const [feed, setFeed] = useState<ActivityItem[] | null>(null);
  const [seen, setSeen] = useState<SeenState | null>(null);

  const load = useCallback(() => {
    fetchActivity(20)
      .then(setFeed)
      .catch(() => setFeed((prev) => prev ?? []));
  }, []);

  useEffect(() => {
    setSeen(loadSeen());
    load();
    return subscribeDashboardRealtime(load);
  }, [load]);

  // Memoised: NotificationBell re-syncs its own state whenever the array
  // identity changes, so a fresh array every render would loop.
  const items = useMemo<NotificationItem[] | undefined>(() => {
    if (!feed || !seen) return undefined;
    return feed.map((a) => ({
      id: a.id,
      kind: a.kind,
      title: a.title,
      body: a.body,
      at: a.at,
      href: a.href,
      read: new Date(a.at).getTime() <= seen.seenAt || seen.readIds.includes(a.id),
    }));
  }, [feed, seen]);

  const markRead = useCallback((id: string) => {
    setSeen((prev) => {
      if (!prev || prev.readIds.includes(id)) return prev;
      const next = { ...prev, readIds: [...prev.readIds, id] };
      saveSeen(next);
      return next;
    });
  }, []);

  const markAllRead = useCallback(() => {
    setSeen((prev) => {
      const next = { seenAt: Date.now(), readIds: prev?.readIds ?? [] };
      saveSeen(next);
      return next;
    });
  }, []);

  return { items, markRead, markAllRead };
}
