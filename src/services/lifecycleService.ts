import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { ActiveTab, BLOOD_TYPES, BloodType } from '../types';

const UI_SNAPSHOT_KEY = 'qataba_ui_state_v1';
const UI_SNAPSHOT_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const RESUME_EVENT_DEBOUNCE_MS = 1200;

const RESTORABLE_TABS: ReadonlySet<ActiveTab> = new Set<ActiveTab>([
  'home',
  'search',
  'urgent',
  'info',
  'register',
  'hospitals',
  'chat',
]);

export interface UiSnapshot {
  activeTab: ActiveTab;
  searchInitialBloodType: BloodType | 'ALL';
  scrollY: number;
  savedAt: number;
}

export interface ResumeEventInfo {
  backgroundDurationMs: number;
  source: 'native_app_state' | 'native_resume' | 'visibility' | 'pageshow';
}

function isValidBloodFilter(value: unknown): value is BloodType | 'ALL' {
  return value === 'ALL' || (typeof value === 'string' && (BLOOD_TYPES as string[]).includes(value));
}

function isValidTab(value: unknown): value is ActiveTab {
  return typeof value === 'string' && RESTORABLE_TABS.has(value as ActiveTab);
}

export function getRestoredUiSnapshot(): UiSnapshot {
  const fallback: UiSnapshot = {
    activeTab: 'home',
    searchInitialBloodType: 'ALL',
    scrollY: 0,
    savedAt: 0,
  };

  if (typeof window === 'undefined') {
    return fallback;
  }

  try {
    const raw =
      window.sessionStorage.getItem(UI_SNAPSHOT_KEY) ||
      window.localStorage.getItem(UI_SNAPSHOT_KEY);
    if (!raw) return fallback;

    const parsed = JSON.parse(raw) as Partial<UiSnapshot>;
    const savedAt = typeof parsed.savedAt === 'number' ? parsed.savedAt : 0;
    if (!savedAt || Date.now() - savedAt > UI_SNAPSHOT_TTL_MS) {
      return fallback;
    }

    return {
      activeTab: isValidTab(parsed.activeTab) ? parsed.activeTab : 'home',
      searchInitialBloodType: isValidBloodFilter(parsed.searchInitialBloodType)
        ? parsed.searchInitialBloodType
        : 'ALL',
      scrollY:
        typeof parsed.scrollY === 'number' && parsed.scrollY > 0 && parsed.scrollY < 50000
          ? Math.round(parsed.scrollY)
          : 0,
      savedAt,
    };
  } catch {
    return fallback;
  }
}

export function saveUiSnapshot(snapshot: {
  activeTab: ActiveTab;
  searchInitialBloodType: BloodType | 'ALL';
  scrollY?: number;
}): void {
  if (typeof window === 'undefined') return;

  try {
    const payload: UiSnapshot = {
      activeTab: isValidTab(snapshot.activeTab) ? snapshot.activeTab : 'home',
      searchInitialBloodType: isValidBloodFilter(snapshot.searchInitialBloodType)
        ? snapshot.searchInitialBloodType
        : 'ALL',
      scrollY:
        typeof snapshot.scrollY === 'number'
          ? Math.max(0, Math.round(snapshot.scrollY))
          : Math.max(0, Math.round(window.scrollY || 0)),
      savedAt: Date.now(),
    };
    const serialized = JSON.stringify(payload);
    window.sessionStorage.setItem(UI_SNAPSHOT_KEY, serialized);
    window.localStorage.setItem(UI_SNAPSHOT_KEY, serialized);
  } catch {
    // Ignore storage quota / restricted storage errors
  }
}

export function clearRestoredUiSnapshot(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(UI_SNAPSHOT_KEY);
    window.localStorage.removeItem(UI_SNAPSHOT_KEY);
  } catch {
    // Ignore storage errors
  }
}

export function subscribeAppLifecycle(handlers: {
  onPause?: () => void;
  onResume?: (info: ResumeEventInfo) => void;
}): () => void {
  let disposed = false;
  let pausedAtMs = 0;
  let lastResumeDispatchedAtMs = 0;
  const cleanupCallbacks: Array<() => void> = [];

  const markPaused = () => {
    if (pausedAtMs === 0) {
      pausedAtMs = Date.now();
    }
    try {
      handlers.onPause?.();
    } catch (err) {
      console.warn('Lifecycle onPause handler warning:', err);
    }
  };

  const dispatchResume = (source: ResumeEventInfo['source']) => {
    if (disposed) return;
    const now = Date.now();
    if (now - lastResumeDispatchedAtMs < RESUME_EVENT_DEBOUNCE_MS) {
      return;
    }
    lastResumeDispatchedAtMs = now;
    const backgroundDurationMs = pausedAtMs > 0 ? Math.max(0, now - pausedAtMs) : 0;
    pausedAtMs = 0;

    try {
      handlers.onResume?.({ backgroundDurationMs, source });
    } catch (err) {
      console.warn('Lifecycle onResume handler warning:', err);
    }
  };

  if (typeof document !== 'undefined') {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        markPaused();
      } else if (document.visibilityState === 'visible') {
        dispatchResume('visibility');
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    cleanupCallbacks.push(() => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    });
  }

  if (typeof window !== 'undefined') {
    const handlePageHide = () => markPaused();
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        dispatchResume('pageshow');
      }
    };
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);
    cleanupCallbacks.push(() => {
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow);
    });
  }

  const hasNativeAppPlugin = (() => {
    try {
      return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('App');
    } catch {
      return false;
    }
  })();

  if (hasNativeAppPlugin) {
    void CapApp.addListener('appStateChange', ({ isActive }) => {
      if (disposed) return;
      if (isActive) {
        dispatchResume('native_app_state');
      } else {
        markPaused();
      }
    })
      .then((handle) => {
        if (disposed) {
          void handle.remove();
        } else {
          cleanupCallbacks.push(() => {
            void handle.remove();
          });
        }
      })
      .catch(() => {});

    void CapApp.addListener('pause', () => {
      if (!disposed) markPaused();
    })
      .then((handle) => {
        if (disposed) {
          void handle.remove();
        } else {
          cleanupCallbacks.push(() => {
            void handle.remove();
          });
        }
      })
      .catch(() => {});

    void CapApp.addListener('resume', () => {
      if (!disposed) dispatchResume('native_resume');
    })
      .then((handle) => {
        if (disposed) {
          void handle.remove();
        } else {
          cleanupCallbacks.push(() => {
            void handle.remove();
          });
        }
      })
      .catch(() => {});
  }

  return () => {
    disposed = true;
    for (const cleanup of cleanupCallbacks) {
      try {
        cleanup();
      } catch {
        // Ignore teardown warnings
      }
    }
  };
}
