
import { Capacitor } from '@capacitor/core';
import { LiveUpdate } from '@capawesome/capacitor-live-update';

const MANIFEST_URL =
  'https://github.com/ziadalsyyadi-ctrl/ziadalsyyadi635/releases/download/ota-latest/manifest.json';

const BUNDLE_BASE_URL =
  'https://github.com/ziadalsyyadi-ctrl/ziadalsyyadi635/releases/download/';

const MIN_AUTO_CHECK_INTERVAL_MS = 5 * 60_000;
const MAX_OTA_LOGS = 30;
const OTA_STORAGE_KEY = 'bank_aldam_ota_logs_v1';

type LiveUpdateManifest = {
  bundleId: string;
  url: string;
  checksum: string;
  signature: string;
};

export type LiveUpdateCheckResult = {
  status: 'skipped' | 'up-to-date' | 'pending' | 'downloaded' | 'error';
  bundleId?: string;
  message?: string;
};

export type OtaLogEntry = {
  time: string;
  timestamp: number;
  stage: string;
  detail?: string;
};

let initialized = false;
let readyCompleted = false;
let onlineListenerRegistered = false;
let lastCheckStartedAt = 0;

let activeCheckPromise: Promise<LiveUpdateCheckResult> | null = null;
let initializationPromise: Promise<void> | null = null;

let otaLogs: OtaLogEntry[] = [];
let logsLoaded = false;

function safeStringify(value: unknown): string {
  try {
    const result = JSON.stringify(value);
    return result ?? String(value);
  } catch {
    return String(value);
  }
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  if (typeof error === 'string') {
    return error;
  }

  return safeStringify(error);
}

function loadOtaLogs(): void {
  if (logsLoaded) return;

  logsLoaded = true;

  try {
    if (typeof localStorage === 'undefined') return;

    const saved = localStorage.getItem(OTA_STORAGE_KEY);
    if (!saved) return;

    const parsed: unknown = JSON.parse(saved);

    if (Array.isArray(parsed)) {
      otaLogs = parsed
        .filter(
          (item): item is OtaLogEntry =>
            !!item &&
            typeof item === 'object' &&
            typeof item.stage === 'string' &&
            typeof item.time === 'string' &&
            typeof item.timestamp === 'number'
        )
        .slice(-MAX_OTA_LOGS);
    }
  } catch {
    otaLogs = [];
  }
}

function persistOtaLogs(): void {
  try {
    if (typeof localStorage === 'undefined') return;

    localStorage.setItem(
      OTA_STORAGE_KEY,
      JSON.stringify(otaLogs.slice(-MAX_OTA_LOGS))
    );
  } catch (error) {
    console.info('[BankAlDam OTA] تعذر حفظ سجل OTA محلياً', error);
  }
}

function otaLog(stage: string, details?: unknown): void {
  loadOtaLogs();

  const timestamp = Date.now();
  const time = new Date(timestamp).toLocaleTimeString('ar-YE', {
    hour12: false,
  });

  const detailText =
    details === undefined
      ? undefined
      : details instanceof Error
        ? formatErrorMessage(details)
        : typeof details === 'string'
          ? details
          : safeStringify(details);

  otaLogs.push({
    time,
    timestamp,
    stage,
    detail: detailText,
  });

  if (otaLogs.length > MAX_OTA_LOGS) {
    otaLogs = otaLogs.slice(-MAX_OTA_LOGS);
  }

  persistOtaLogs();

  if (details !== undefined) {
    console.info(`[BankAlDam OTA] ${stage}`, details);
  } else {
    console.info(`[BankAlDam OTA] ${stage}`);
  }
}

export function getOtaLogs(): OtaLogEntry[] {
  loadOtaLogs();
  return [...otaLogs];
}

export function clearOtaLogs(): void {
  otaLogs = [];
  logsLoaded = true;

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(OTA_STORAGE_KEY);
    }
  } catch {
    // تجاهل فشل التخزين
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

async function ensureReadyAndInspectActiveBundle(): Promise<boolean> {
  if (readyCompleted) return true;

  try {
    let previousNextBundleId: string | undefined;

    try {
      const nextInfo = await LiveUpdate.getNextBundle();
      previousNextBundleId = nextInfo?.bundleId;
    } catch {
      // لا توجد حزمة تالية أو تعذر قراءتها
    }

    otaLog('بدء تهيئة LiveUpdate');

    const readyResult = await LiveUpdate.ready();

    readyCompleted = true;

    otaLog('اكتملت تهيئة LiveUpdate بنجاح', readyResult ?? '');

    try {
      const [
        { bundleId: activeBundleId },
        { bundleId: remainingNextBundleId },
      ] = await Promise.all([
        LiveUpdate.getCurrentBundle(),
        LiveUpdate.getNextBundle(),
      ]);

      otaLog('حالة الحزم بعد التهيئة', {
        activeBundleId: activeBundleId || 'builtin/default',
        remainingNextBundleId: remainingNextBundleId || null,
        expectedPreviousNextBundleId: previousNextBundleId || null,
      });

      if (
        previousNextBundleId &&
        activeBundleId &&
        activeBundleId !== previousNextBundleId
      ) {
        otaLog('تحذير: الحزمة المنتظرة ليست الحزمة النشطة', {
          expected: previousNextBundleId,
          actual: activeBundleId,
        });
      }
    } catch (error) {
      otaLog('تعذر فحص الحزمة النشطة', formatErrorMessage(error));
    }

    return true;
  } catch (error) {
    readyCompleted = false;

    otaLog('فشل LiveUpdate.ready', formatErrorMessage(error));

    return false;
  }
}

async function runLiveUpdateCheck(): Promise<LiveUpdateCheckResult> {
  otaLog('بدء فحص ملف manifest', MANIFEST_URL);

  try {
    const response = await fetch(MANIFEST_URL, {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const message =
        `فشل جلب manifest: ${response.status} ${response.statusText}`;

      otaLog(message);

      return {
        status: 'error',
        message,
      };
    }

    otaLog('تم الوصول إلى manifest بنجاح');

    const manifest: unknown = await response.json();

    if (!isValidManifest(manifest)) {
      const message = 'ملف manifest غير صالح أو تنسيقه غير مطابق';

      otaLog(message);

      return {
        status: 'error',
        message,
      };
    }

    otaLog('تم التحقق من بنية manifest', {
      bundleId: manifest.bundleId,
    });

    const [
      { bundleId: currentBundleId },
      { bundleId: nextBundleId },
    ] = await Promise.all([
      LiveUpdate.getCurrentBundle(),
      LiveUpdate.getNextBundle(),
    ]);

    otaLog('حالة الحزم قبل التحديث', {
      publishedBundleId: manifest.bundleId,
      currentBundleId: currentBundleId || 'builtin/default',
      nextBundleId: nextBundleId || null,
    });

    if (manifest.bundleId === currentBundleId) {
      const message = 'التطبيق يعمل بالفعل على أحدث حزمة OTA';

      otaLog(message);

      return {
        status: 'up-to-date',
        bundleId: manifest.bundleId,
        message,
      };
    }

    if (manifest.bundleId === nextBundleId) {
      const message = 'الحزمة موجودة مسبقاً وتنتظر التفعيل عند التشغيل';

      otaLog(message);

      return {
        status: 'pending',
        bundleId: manifest.bundleId,
        message,
      };
    }

    otaLog('بدء تنزيل حزمة OTA', {
      bundleId: manifest.bundleId,
      url: manifest.url,
    });

    await LiveUpdate.downloadBundle({
      artifactType: 'zip',
      bundleId: manifest.bundleId,
      url: manifest.url,
      checksum: manifest.checksum.toLowerCase(),
      signature: manifest.signature,
    });

    otaLog('اكتمل تنزيل الحزمة والتحقق منها', manifest.bundleId);

    await LiveUpdate.setNextBundle({
      bundleId: manifest.bundleId,
    });

    otaLog('تم تعيين الحزمة للتشغيل القادم', manifest.bundleId);

    return {
      status: 'downloaded',
      bundleId: manifest.bundleId,
      message: 'تم تنزيل التحديث وتجهيزه. أعد تشغيل التطبيق لتفعيله.',
    };
  } catch (error) {
    const message = formatErrorMessage(error);

    otaLog('فشل فحص أو تنزيل OTA', message);

    return {
      status: 'error',
      message,
    };
  }
}

export async function checkForLiveUpdate(
  options?: { force?: boolean }
): Promise<LiveUpdateCheckResult> {
  if (!Capacitor.isNativePlatform()) {
    return {
      status: 'skipped',
      message: 'التشغيل ليس على منصة Android أو iOS',
    };
  }

  const isReady = await ensureReadyAndInspectActiveBundle();

  if (!isReady) {
    return {
      status: 'error',
      message: 'تعذر تهيئة LiveUpdate',
    };
  }

  if (activeCheckPromise) {
    otaLog('يوجد فحص OTA جارٍ؛ انتظار نتيجته');
    return activeCheckPromise;
  }

  const force = Boolean(options?.force);
  const now = Date.now();

  if (
    !force &&
    lastCheckStartedAt > 0 &&
    now - lastCheckStartedAt < MIN_AUTO_CHECK_INTERVAL_MS
  ) {
    const message = 'تم تجاوز الفحص التلقائي بسبب مهلة الخمس دقائق';

    otaLog(message);

    return {
      status: 'skipped',
      message,
    };
  }

  lastCheckStartedAt = now;

  activeCheckPromise = runLiveUpdateCheck().finally(() => {
    activeCheckPromise = null;
  });

  return activeCheckPromise;
}

function registerOnlineListener(): void {
  if (onlineListenerRegistered || typeof window === 'undefined') {
    return;
  }

  window.addEventListener('online', () => {
    otaLog('عاد الاتصال بالإنترنت؛ بدء فحص OTA إجباري');

    void checkForLiveUpdate({ force: true });
  });

  onlineListenerRegistered = true;

  otaLog('تم تسجيل مراقبة عودة الاتصال بالإنترنت');
}

async function performInitialization(): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    otaLog('تخطي OTA: التشغيل ليس على منصة أصلية');
    initialized = true;
    return;
  }

  if (typeof window !== 'undefined') {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }

  const isReady = await ensureReadyAndInspectActiveBundle();

  if (!isReady) {
    initialized = false;

    otaLog('لم تكتمل التهيئة؛ ستتم إعادة المحاولة لاحقاً');

    return;
  }

  initialized = true;

  registerOnlineListener();

  otaLog('اكتملت تهيئة نظام OTA');

  void checkForLiveUpdate({ force: true });
}

export async function initializeLiveUpdates(): Promise<void> {
  if (initialized) return;

  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = performInitialization().finally(() => {
    initializationPromise = null;
  });

  return initializationPromise;
}
