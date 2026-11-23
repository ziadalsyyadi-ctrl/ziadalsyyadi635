import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { LiveUpdate } from '@capawesome/capacitor-live-update';

const MANIFEST_URL = 'https://github.com/ziadalsyyadi-ctrl/ziadalsyyadi635/releases/download/ota-latest/manifest.json';
const BUNDLE_BASE_URL = 'https://github.com/ziadalsyyadi-ctrl/ziadalsyyadi635/releases/download/';
const MIN_AUTO_CHECK_INTERVAL_MS = 5 * 60_000;

type LiveUpdateManifest = {
  bundleId: string;
  url: string;
  checksum: string;
  signature: string;
};

export type LiveUpdateCheckResult = {
  status: 'skipped' | 'up-to-date' | 'pending' | 'downloaded' | 'error';
  bundleId?: string;
};

let initialized = false;
let readyCompleted = false;
let lastCheckStartedAt = 0;
let activeCheckPromise: Promise<LiveUpdateCheckResult> | null = null;

function otaLog(stage: string, details?: unknown): void {
  // Diagnostic messages are available in Android WebView logs without exposing secrets.
  if (details instanceof Error) {
    console.info(`[BankAlDam OTA] ${stage}: ${details.name}: ${details.message}`);
  } else if (details !== undefined) {
    console.info(`[BankAlDam OTA] ${stage}`, details);
  } else {
    console.info(`[BankAlDam OTA] ${stage}`);
  }
}

function isValidManifest(value: unknown): value is LiveUpdateManifest {
  if (!value || typeof value !== 'object') return false;
  const manifest = value as Record<string, unknown>;

  return (
    typeof manifest.bundleId === 'string' &&
    /^[A-Za-z0-9._-]{1,80}$/.test(manifest.bundleId) &&
    manifest.bundleId !== 'public' &&
    typeof manifest.url === 'string' &&
    manifest.url.startsWith(BUNDLE_BASE_URL) &&
    manifest.url.endsWith('.zip') &&
    typeof manifest.checksum === 'string' &&
    /^[a-fA-F0-9]{64}$/.test(manifest.checksum) &&
    typeof manifest.signature === 'string' &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(manifest.signature)
  );
}

async function fetchManifestData(): Promise<unknown | null> {
  // In native Android/iOS, use CapacitorHttp to bypass WebView CORS and redirect blocks on GitHub
  if (Capacitor.isNativePlatform()) {
    try {
      const nativeRes = await CapacitorHttp.get({
        url: MANIFEST_URL,
        headers: {
          Accept: 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
        connectTimeout: 12000,
        readTimeout: 15000,
      });

      if (nativeRes.status >= 200 && nativeRes.status < 300) {
        if (typeof nativeRes.data === 'string') {
          try {
            return JSON.parse(nativeRes.data);
          } catch {
            return null;
          }
        }
        return nativeRes.data;
      }
      otaLog('CapacitorHttp returned non-200 status', { status: nativeRes.status });
    } catch (nativeErr) {
      otaLog('CapacitorHttp fetch error, falling back to window.fetch', nativeErr);
    }
  }

  // Fallback to standard fetch
  try {
    const response = await fetch(MANIFEST_URL, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (response.ok) {
      return await response.json();
    }
    otaLog('Fetch failed with status', { status: response.status, statusText: response.statusText });
  } catch (fetchErr) {
    otaLog('Fetch caught error', fetchErr);
  }

  return null;
}

async function runLiveUpdateCheck(): Promise<LiveUpdateCheckResult> {
  otaLog('بدء فحص manifest', MANIFEST_URL);

  try {
    const manifestData = await fetchManifestData();
    if (!manifestData || !isValidManifest(manifestData)) {
      otaLog('manifest غير متاح أو لا يطابق التنسيق المطلوب');
      return { status: 'error' };
    }

    const manifest = manifestData;

    const [
      currentBundleRes,
      nextBundleRes,
      downloadedRes,
    ] = await Promise.all([
      LiveUpdate.getCurrentBundle().catch(() => ({ bundleId: '' })),
      LiveUpdate.getNextBundle().catch(() => ({ bundleId: '' })),
      LiveUpdate.getDownloadedBundles().catch(() => ({ bundleIds: [] })),
    ]);

    const currentBundleId = currentBundleRes?.bundleId || '';
    const nextBundleId = nextBundleRes?.bundleId || '';
    const downloadedBundleIds: string[] = Array.isArray(downloadedRes?.bundleIds)
      ? downloadedRes.bundleIds
      : [];

    otaLog('تم فحص الحزم', {
      publishedBundleId: manifest.bundleId,
      currentBundleId,
      nextBundleId,
      downloadedCount: downloadedBundleIds.length,
    });

    if (manifest.bundleId === currentBundleId) {
      otaLog('التطبيق يستخدم بالفعل الحزمة المنشورة');
      return { status: 'up-to-date', bundleId: manifest.bundleId };
    }

    if (manifest.bundleId === nextBundleId) {
      otaLog('الحزمة المنشورة محددة مسبقاً للتطبيق عند التشغيل القادم');
      return { status: 'pending', bundleId: manifest.bundleId };
    }

    // If the bundle is already downloaded locally, skip re-downloading to prevent BUNDLE_EXISTS error
    if (!downloadedBundleIds.includes(manifest.bundleId)) {
      otaLog('بدء تنزيل الحزمة', manifest.bundleId);
      try {
        await LiveUpdate.downloadBundle({
          artifactType: 'zip',
          bundleId: manifest.bundleId,
          url: manifest.url,
          checksum: manifest.checksum.toLowerCase(),
          signature: manifest.signature,
        });
        otaLog('اكتمل تنزيل الحزمة والتحقق منها بنجاح', manifest.bundleId);
      } catch (dlError: any) {
        const errorMsg = String(dlError?.message || dlError || '').toLowerCase();
        if (errorMsg.includes('already exists') || errorMsg.includes('bundle_exists')) {
          otaLog('الحزمة موجودة بالفعل محلياً، المتابعة بتعيينها');
        } else {
          throw dlError;
        }
      }
    } else {
      otaLog('الحزمة المنشورة تم تحميلها مسبقاً في الذاكرة المحلية', manifest.bundleId);
    }

    await LiveUpdate.setNextBundle({ bundleId: manifest.bundleId });
    otaLog('تم تعيين الحزمة لتطبيقها عند التشغيل القادم', manifest.bundleId);
    return { status: 'downloaded', bundleId: manifest.bundleId };
  } catch (error) {
    otaLog('حدث خطأ أثناء فحص أو تنزيل OTA', error);
    return { status: 'error' };
  }
}

export async function checkForLiveUpdate(options?: { force?: boolean }): Promise<LiveUpdateCheckResult> {
  if (!Capacitor.isNativePlatform()) {
    return { status: 'skipped' };
  }

  if (options?.force) {
    lastCheckStartedAt = 0;
    activeCheckPromise = null;
  }

  if (!readyCompleted) {
    try {
      await LiveUpdate.ready();
      readyCompleted = true;
    } catch (error) {
      otaLog('تعذر إكمال LiveUpdate.ready قبل الفحص', error);
      return { status: 'error' };
    }
  }

  if (activeCheckPromise) {
    return activeCheckPromise;
  }

  const now = Date.now();
  if (!options?.force && now - lastCheckStartedAt < MIN_AUTO_CHECK_INTERVAL_MS) {
    return { status: 'skipped' };
  }

  lastCheckStartedAt = now;
  activeCheckPromise = runLiveUpdateCheck().finally(() => {
    activeCheckPromise = null;
  });

  return activeCheckPromise;
}

export async function initializeLiveUpdates(): Promise<void> {
  if (initialized) {
    return;
  }
  initialized = true;

  if (!Capacitor.isNativePlatform()) {
    otaLog('تخطي OTA: التشغيل ليس على منصة Android/iOS');
    return;
  }

  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });

  try {
    const readyResult = await LiveUpdate.ready();
    readyCompleted = true;
    otaLog('LiveUpdate.ready اكتمل', readyResult);
  } catch (error) {
    otaLog('فشل LiveUpdate.ready', error);
    return;
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      void checkForLiveUpdate();
    });
  }

  void checkForLiveUpdate({ force: true });
}
