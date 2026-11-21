import { Capacitor } from '@capacitor/core';
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

async function runLiveUpdateCheck(): Promise<LiveUpdateCheckResult> {
  otaLog('بدء فحص manifest', MANIFEST_URL);

  try {
    const response = await fetch(MANIFEST_URL, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      otaLog('فشل جلب manifest', { status: response.status, statusText: response.statusText });
      return { status: 'error' };
    }

    const manifest: unknown = await response.json();
    if (!isValidManifest(manifest)) {
      otaLog('manifest غير صالح أو حقوله لا تطابق التنسيق المتوقع');
      return { status: 'error' };
    }

    const [{ bundleId: currentBundleId }, { bundleId: nextBundleId }] =
      await Promise.all([
        LiveUpdate.getCurrentBundle(),
        LiveUpdate.getNextBundle(),
      ]);

    otaLog('تم فحص الحزم', { publishedBundleId: manifest.bundleId, currentBundleId, nextBundleId });

    if (manifest.bundleId === currentBundleId) {
      otaLog('التطبيق يستخدم بالفعل الحزمة المنشورة');
      return { status: 'up-to-date', bundleId: manifest.bundleId };
    }

    if (manifest.bundleId === nextBundleId) {
      otaLog('الحزمة المنشورة محددة مسبقاً للتطبيق عند التشغيل القادم');
      return { status: 'pending', bundleId: manifest.bundleId };
    }

    otaLog('بدء تنزيل الحزمة', manifest.bundleId);
    await LiveUpdate.downloadBundle({
      artifactType: 'zip',
      bundleId: manifest.bundleId,
      url: manifest.url,
      checksum: manifest.checksum.toLowerCase(),
      signature: manifest.signature,
    });
    otaLog('اكتمل تنزيل الحزمة والتحقق منها', manifest.bundleId);

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
