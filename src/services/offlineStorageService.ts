import { Donor, UrgentRequest } from '../types';
import { INITIAL_SEED_DONORS } from '../data/initialData';
import { BUNDLED_SHEETS_DONORS } from '../data/bundledSheetsDonors';

/**
 * نظام التخزين المحلي الدائم (Offline-First) لبنك الدم - قعطبة
 * يعتمد على IndexedDB مع مرآة متزامنة فورية (Synchronous LocalStorage Cache)
 * ومخازن مستقلة لكل مصدر (Firestore + Google Sheets) لضمان عدم ضياع أي متبرع بدون إنترنت.
 */

const DB_NAME = 'QatabaBloodBankDB';
const DB_VERSION = 1;
const STORE_DONORS = 'donors';
const STORE_URGENT = 'urgent_requests';
const STORE_METADATA = 'sync_metadata';

const LOCAL_STORAGE_DONORS_KEY = 'qataba_offline_donors_v1';
const LOCAL_STORAGE_SHEETS_KEY = 'qataba_offline_sheets_donors_v1';
const LOCAL_STORAGE_FIRESTORE_KEY = 'qataba_offline_firestore_donors_v1';
const LOCAL_STORAGE_DELETED_DONORS_KEY = 'qataba_offline_deleted_donors_v1';
const LOCAL_STORAGE_URGENT_KEY = 'qataba_offline_urgent_v1';
const LOCAL_STORAGE_META_KEY = 'qataba_offline_meta_v1';

export interface SyncMetadata {
  key?: string;
  lastSyncTime: string;
  lastSyncTimestamp: number;
  donorCount: number;
  sheetsCount?: number;
  firestoreCount?: number;
  isOfflineSnapshot: boolean;
  version: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

export function normalizePhoneKey(phone?: string): string {
  if (!phone) return '';
  let clean = String(phone).replace(/\D/g, '');
  if (clean.startsWith('00967')) clean = clean.slice(5);
  else if (clean.startsWith('967')) clean = clean.slice(3);
  else if (clean.startsWith('0') && clean.length === 10) clean = clean.slice(1);
  if (clean === '0' || clean.length < 7) return '';
  return clean;
}

function sanitizeTimestampForStorage(val: any): string | undefined {
  if (!val) return undefined;
  if (typeof val === 'string') return val;
  if (typeof val?.toDate === 'function') {
    try {
      return val.toDate().toISOString();
    } catch {
      return undefined;
    }
  }
  if (typeof val?.seconds === 'number') {
    try {
      return new Date(val.seconds * 1000).toISOString();
    } catch {
      return undefined;
    }
  }
  if (val instanceof Date) {
    return val.toISOString();
  }
  return String(val);
}

export function sanitizeDonorForStorage(donor: Donor): Donor {
  const sanitized: Donor = {
    id: String(donor.id || ''),
    userId: String(donor.userId || ''),
    fullName: String(donor.fullName || '').trim(),
    bloodType: donor.bloodType || 'O+',
    phone: donor.phone !== undefined && donor.phone !== null ? String(donor.phone).trim() : '',
    phoneVerified: Boolean(donor.phoneVerified ?? true),
    residence: String(donor.residence || 'قعطبة').trim(),
    notes: donor.notes ? String(donor.notes) : '',
    lastDonationDate: donor.lastDonationDate ? String(donor.lastDonationDate) : '',
    isAvailable: donor.isAvailable ?? true,
    allowContact: donor.allowContact ?? true,
    source: donor.source || (String(donor.id || '').startsWith('sheet_') ? 'google_sheets' : 'firestore'),
  };

  const created = sanitizeTimestampForStorage(donor.createdAt);
  if (created) sanitized.createdAt = created;
  const updated = sanitizeTimestampForStorage(donor.updatedAt);
  if (updated) sanitized.updatedAt = updated;

  return sanitized;
}

function isSheetDonorRecord(donor: Donor): boolean {
  return donor.source === 'google_sheets' || String(donor.id || '').startsWith('sheet_');
}

export function getInitialSeedDonorsAsDonors(): Donor[] {
  return INITIAL_SEED_DONORS.map((d, idx) => ({
    id: `seed_${idx + 1}`,
    userId: `seed_user_${idx + 1}`,
    fullName: d.fullName,
    bloodType: d.bloodType,
    phone: d.phone,
    phoneVerified: true,
    residence: d.residence,
    notes: d.notes,
    isAvailable: d.isAvailable,
    allowContact: true,
    source: 'firestore' as const,
  }));
}

export function getInstantDeletedDonorsSync(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_DELETED_DONORS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((id) => String(id).trim()).filter(Boolean);
      }
    }
  } catch {
    // ignore storage read errors
  }
  return [];
}

export function saveDeletedDonorsSync(ids: string[]): void {
  if (typeof window === 'undefined' || !Array.isArray(ids)) return;
  try {
    const unique = Array.from(new Set(ids.map((id) => String(id).trim()).filter(Boolean)));
    localStorage.setItem(LOCAL_STORAGE_DELETED_DONORS_KEY, JSON.stringify(unique));
  } catch {
    // ignore quota errors
  }
}

function filterDeletedDonors(donors: Donor[], deletedIds: string[]): Donor[] {
  if (!deletedIds || deletedIds.length === 0) return donors;
  const deletedSet = new Set(deletedIds.map((id) => String(id).trim()).filter(Boolean));
  if (deletedSet.size === 0) return donors;
  return donors.filter((d) => {
    if (deletedSet.has(String(d.id))) return false;
    const cleanPhone = normalizePhoneKey(d.phone);
    return !(cleanPhone && deletedSet.has(cleanPhone));
  });
}

export function mergeSourceDonors(
  firestoreList: Donor[],
  sheetsList: Donor[]
): { merged: Donor[]; duplicateCount: number } {
  const seenPhones = new Set<string>();
  const seenIds = new Set<string>();
  const merged: Donor[] = [];
  let duplicateCount = 0;

  for (const d of firestoreList) {
    if (!d || !d.fullName) continue;
    const cleanPhone = normalizePhoneKey(d.phone);
    if (cleanPhone) seenPhones.add(cleanPhone);
    if (d.id) seenIds.add(String(d.id));
    merged.push({ ...d, source: d.source || 'firestore' });
  }

  for (const d of sheetsList) {
    if (!d || !d.fullName) continue;
    if (d.id && seenIds.has(String(d.id))) {
      duplicateCount++;
      continue;
    }
    const cleanPhone = normalizePhoneKey(d.phone);
    if (cleanPhone) {
      if (seenPhones.has(cleanPhone)) {
        duplicateCount++;
      } else {
        seenPhones.add(cleanPhone);
        if (d.id) seenIds.add(String(d.id));
        merged.push({ ...d, source: 'google_sheets' });
      }
    } else {
      if (d.id) seenIds.add(String(d.id));
      merged.push({ ...d, source: 'google_sheets' });
    }
  }

  return { merged, duplicateCount };
}

/**
 * فتح قاعدة بيانات IndexedDB وضمان إنشاء الجداول (Object Stores) والفهارس
 */
export function openOfflineDB(): Promise<IDBDatabase> {
  if (typeof window === 'undefined' || !window.indexedDB) {
    return Promise.reject(new Error('IndexedDB غير مدعوم في هذه البيئة'));
  }

  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains(STORE_DONORS)) {
          const donorStore = db.createObjectStore(STORE_DONORS, { keyPath: 'id' });
          donorStore.createIndex('bloodType', 'bloodType', { unique: false });
          donorStore.createIndex('residence', 'residence', { unique: false });
          donorStore.createIndex('phone', 'phone', { unique: false });
          donorStore.createIndex('source', 'source', { unique: false });
        }

        if (!db.objectStoreNames.contains(STORE_URGENT)) {
          const urgentStore = db.createObjectStore(STORE_URGENT, { keyPath: 'id' });
          urgentStore.createIndex('bloodType', 'bloodType', { unique: false });
          urgentStore.createIndex('status', 'status', { unique: false });
          urgentStore.createIndex('urgencyLevel', 'urgencyLevel', { unique: false });
        }

        if (!db.objectStoreNames.contains(STORE_METADATA)) {
          db.createObjectStore(STORE_METADATA, { keyPath: 'key' });
        }
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        console.warn('⚠️ فشل فتح IndexedDB:', request.error);
        reject(request.error);
      };
    } catch (err) {
      console.warn('⚠️ خطأ استثنائي أثناء محاولة فتح IndexedDB:', err);
      reject(err);
    }
  });

  return dbPromise;
}

export function getInstantCachedSheetsDonorsSync(): Donor[] {
  const deleted = getInstantDeletedDonorsSync();
  let stored: Donor[] = [];
  try {
    const rawSheets = localStorage.getItem(LOCAL_STORAGE_SHEETS_KEY);
    if (rawSheets !== null) {
      const parsed = JSON.parse(rawSheets);
      if (Array.isArray(parsed) && parsed.length > 0) {
        stored = parsed.map(sanitizeDonorForStorage);
      }
    }

    const rawCombined = localStorage.getItem(LOCAL_STORAGE_DONORS_KEY);
    if (rawCombined) {
      const parsedCombined = JSON.parse(rawCombined);
      if (Array.isArray(parsedCombined)) {
        const sheetSlice = parsedCombined.filter(isSheetDonorRecord).map(sanitizeDonorForStorage);
        if (sheetSlice.length > stored.length) {
          stored = sheetSlice;
        }
      }
    }
  } catch (err) {
    console.warn('تعذر قراءة كاش متبرعي Google Sheets:', err);
  }

  // Always ensure all bundled sheets donors are included
  if (stored.length < BUNDLED_SHEETS_DONORS.length) {
    const map = new Map<string, Donor>();
    for (const d of BUNDLED_SHEETS_DONORS) map.set(d.id, d);
    for (const d of stored) map.set(d.id, d);
    stored = Array.from(map.values());
  }

  return filterDeletedDonors(stored, deleted);
}

export function getInstantCachedFirestoreDonorsSync(): Donor[] {
  const deleted = getInstantDeletedDonorsSync();
  if (typeof window === 'undefined') return filterDeletedDonors(getInitialSeedDonorsAsDonors(), deleted);

  try {
    const rawFirestore = localStorage.getItem(LOCAL_STORAGE_FIRESTORE_KEY);
    if (rawFirestore !== null) {
      const parsed = JSON.parse(rawFirestore);
      if (Array.isArray(parsed)) {
        return filterDeletedDonors(parsed.map(sanitizeDonorForStorage), deleted);
      }
    }

    const rawCombined = localStorage.getItem(LOCAL_STORAGE_DONORS_KEY);
    if (rawCombined) {
      const parsedCombined = JSON.parse(rawCombined);
      if (Array.isArray(parsedCombined)) {
        const firestoreSlice = parsedCombined
          .filter((d) => !isSheetDonorRecord(d))
          .map(sanitizeDonorForStorage);
        if (firestoreSlice.length > 0) {
          return filterDeletedDonors(firestoreSlice, deleted);
        }
      }
    }
  } catch (err) {
    console.warn('تعذر قراءة كاش متبرعي Firestore:', err);
  }

  return filterDeletedDonors(getInitialSeedDonorsAsDonors(), deleted);
}

export function saveSourceDonorsToOfflineStorage(
  source: 'sheets' | 'firestore',
  donors: Donor[]
): void {
  if (typeof window === 'undefined' || !Array.isArray(donors)) return;
  try {
    const sanitized = donors.map(sanitizeDonorForStorage);
    const key = source === 'sheets' ? LOCAL_STORAGE_SHEETS_KEY : LOCAL_STORAGE_FIRESTORE_KEY;
    localStorage.setItem(key, JSON.stringify(sanitized));
  } catch (err) {
    console.warn(`تعذر حفظ كاش ${source} المحلي:`, err);
  }
}

/**
 * 0-Millisecond Synchronous Hydration:
 * جلب فوري من الذاكرة المحلية المخزنة مسبقاً قبل انتظار أي وعود (Promises) غير متزامنة.
 * يضمن دمج بيانات Firestore و Google Sheets المخزنة (أو الحزمة المدمجة الكاملة عند أول تشغيل بدون نت).
 */
export function getInstantLocalDonorsSync(): Donor[] {
  const deleted = getInstantDeletedDonorsSync();
  if (typeof window === 'undefined') {
    const { merged } = mergeSourceDonors(getInitialSeedDonorsAsDonors(), BUNDLED_SHEETS_DONORS);
    return filterDeletedDonors(merged, deleted);
  }

  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_DONORS_KEY);
    const rawSheets = localStorage.getItem(LOCAL_STORAGE_SHEETS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const hasSheetsInCombined = parsed.some(isSheetDonorRecord);
        if (hasSheetsInCombined || rawSheets !== null) {
          return filterDeletedDonors(parsed.map(sanitizeDonorForStorage), deleted);
        }
      }
    }
  } catch (err) {
    console.warn('تعذر قراءة الكاش المتزامن للمتبرعين:', err);
  }

  const cachedFirestore = getInstantCachedFirestoreDonorsSync();
  const cachedSheets = getInstantCachedSheetsDonorsSync();
  const { merged } = mergeSourceDonors(cachedFirestore, cachedSheets);
  return filterDeletedDonors(merged, deleted);
}

/**
 * جلب الكاش المتزامن لطلبات الدم العاجلة
 */
export function getInstantLocalUrgentSync(): UrgentRequest[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_URGENT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err) {
    console.warn('تعذر قراءة الكاش المتزامن لطلبات الدم:', err);
  }
  return [];
}

/**
 * جلب البيانات الوصفية للمزامنة بشكل متزامن
 */
export function getInstantSyncMetaSync(): SyncMetadata | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_META_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {
    // تجاهل الأخطاء
  }
  return null;
}

/**
 * حفظ قائمة المتبرعين في قاعدة البيانات المحلية الدائمة (IndexedDB)
 * وتحديث المرآة السريعة (LocalStorage) والبيانات الوصفية
 */
export async function saveDonorsToOfflineStorage(
  donors: Donor[],
  extraMeta?: { sheetsCount?: number; firestoreCount?: number; forceOverwrite?: boolean }
): Promise<boolean> {
  if (!Array.isArray(donors) || donors.length === 0) return false;

  const sanitizedDonors = donors.map(sanitizeDonorForStorage);

  // Do not allow a partial non-Sheets snapshot to overwrite a full offline cache that includes Sheets.
  if (!extraMeta?.forceOverwrite) {
    const cachedDonors = getInstantLocalDonorsSync();
    const cachedHasSheets = cachedDonors.some(isSheetDonorRecord);
    const incomingHasSheets = sanitizedDonors.some(isSheetDonorRecord);
    if (cachedHasSheets && !incomingHasSheets && cachedDonors.length > sanitizedDonors.length) {
      console.warn('رفض استبدال النسخة الكاملة بقائمة جزئية لا تحتوي على سجل الشيت.');
      return false;
    }
  }

  const timestamp = Date.now();
  const timeFormatted = new Date().toLocaleTimeString('ar-YE', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const metadata: SyncMetadata = {
    key: 'latest',
    lastSyncTime: timeFormatted,
    lastSyncTimestamp: timestamp,
    donorCount: sanitizedDonors.length,
    sheetsCount: extraMeta?.sheetsCount,
    firestoreCount: extraMeta?.firestoreCount,
    isOfflineSnapshot: typeof navigator !== 'undefined' ? !navigator.onLine : false,
    version: 1,
  };

  try {
    localStorage.setItem(LOCAL_STORAGE_DONORS_KEY, JSON.stringify(sanitizedDonors));
    localStorage.setItem(LOCAL_STORAGE_META_KEY, JSON.stringify(metadata));
  } catch {
    console.warn('تنبيه: حجم LocalStorage ممتلئ، الاعتماد الأساسي على IndexedDB.');
  }

  try {
    const db = await openOfflineDB();
    return await new Promise((resolve) => {
      const tx = db.transaction([STORE_DONORS, STORE_METADATA], 'readwrite');
      const donorStore = tx.objectStore(STORE_DONORS);
      const metaStore = tx.objectStore(STORE_METADATA);

      donorStore.clear();

      for (const donor of sanitizedDonors) {
        donorStore.put(donor);
      }

      metaStore.put(metadata);

      tx.oncomplete = () => {
        resolve(true);
      };

      tx.onerror = () => {
        console.warn('⚠️ خطأ أثناء حفظ المتبرعين في IndexedDB:', tx.error);
        resolve(false);
      };
    });
  } catch (err) {
    console.warn('⚠️ تعذر إتمام عملية الحفظ في IndexedDB:', err);
    return false;
  }
}

/**
 * استرجاع جميع المتبرعين من قاعدة البيانات المحلية IndexedDB مع التحقق من اكتمال المرآة المحلية
 */
export async function getDonorsFromOfflineStorage(): Promise<Donor[]> {
  const deleted = getInstantDeletedDonorsSync();
  const instantMerged = getInstantLocalDonorsSync();

  try {
    const db = await openOfflineDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_DONORS, 'readonly');
      const store = tx.objectStore(STORE_DONORS);
      const request = store.getAll();

      request.onsuccess = () => {
        const rawResults = Array.isArray(request.result)
          ? filterDeletedDonors(request.result.map(sanitizeDonorForStorage), deleted)
          : [];
        const idbHasSheets = rawResults.some(isSheetDonorRecord);
        const instantHasSheets = instantMerged.some(isSheetDonorRecord);

        // Prefer IndexedDB when it holds a fuller or equally complete snapshot (including Sheets).
        if (
          rawResults.length > 0 &&
          (rawResults.length >= instantMerged.length || (idbHasSheets && !instantHasSheets))
        ) {
          resolve(rawResults);
          return;
        }

        // Otherwise heal IndexedDB with the fuller merged snapshot.
        if (instantMerged.length > 0) {
          void saveDonorsToOfflineStorage(instantMerged, { forceOverwrite: true });
          resolve(instantMerged);
        } else {
          resolve(rawResults);
        }
      };

      request.onerror = () => {
        resolve(instantMerged);
      };
    });
  } catch {
    return instantMerged;
  }
}

/**
 * حفظ طلبات الدم العاجلة محلياً
 */
export async function saveUrgentRequestsToOfflineStorage(requests: UrgentRequest[]): Promise<boolean> {
  if (!Array.isArray(requests)) return false;

  const sanitizedRequests = requests.map((req) => ({
    ...req,
    createdAt: sanitizeTimestampForStorage(req.createdAt),
    updatedAt: sanitizeTimestampForStorage(req.updatedAt),
  }));

  try {
    localStorage.setItem(LOCAL_STORAGE_URGENT_KEY, JSON.stringify(sanitizedRequests));
  } catch {}

  try {
    const db = await openOfflineDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_URGENT, 'readwrite');
      const store = tx.objectStore(STORE_URGENT);
      store.clear();

      for (const req of sanitizedRequests) {
        store.put(req);
      }

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

/**
 * استرجاع طلبات الدم العاجلة من التخزين المحلي
 */
export async function getUrgentRequestsFromOfflineStorage(): Promise<UrgentRequest[]> {
  try {
    const db = await openOfflineDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_URGENT, 'readonly');
      const store = tx.objectStore(STORE_URGENT);
      const req = store.getAll();

      req.onsuccess = () => {
        if (Array.isArray(req.result) && req.result.length > 0) {
          resolve(req.result);
        } else {
          resolve(getInstantLocalUrgentSync());
        }
      };

      req.onerror = () => resolve(getInstantLocalUrgentSync());
    });
  } catch {
    return getInstantLocalUrgentSync();
  }
}

/**
 * حذف متبرع من التخزين المحلي فوراً عند قيام المسؤول بحذفه
 */
export async function deleteDonorFromOfflineStorage(donorId: string, phone?: string): Promise<boolean> {
  try {
    const cleanP = normalizePhoneKey(phone);
    const rawCleanDigits = phone ? String(phone).replace(/\D/g, '') : '';
    const matchesDeleted = (d: Donor) => {
      if (String(d.id) === String(donorId)) return true;
      const dClean = normalizePhoneKey(d.phone);
      const dDigits = d.phone ? String(d.phone).replace(/\D/g, '') : '';
      if (cleanP && dClean && dClean === cleanP) return true;
      if (rawCleanDigits && dDigits && dDigits === rawCleanDigits) return true;
      return false;
    };

    const existingDeleted = getInstantDeletedDonorsSync();
    const nextDeleted = Array.from(
      new Set([
        ...existingDeleted,
        String(donorId).trim(),
        ...(cleanP ? [cleanP] : []),
        ...(rawCleanDigits ? [rawCleanDigits] : []),
      ].filter(Boolean))
    );
    saveDeletedDonorsSync(nextDeleted);

    const filterKey = (storageKey: string) => {
      try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          localStorage.setItem(storageKey, JSON.stringify(parsed.filter((d) => !matchesDeleted(d))));
        }
      } catch {}
    };

    filterKey(LOCAL_STORAGE_DONORS_KEY);
    filterKey(LOCAL_STORAGE_SHEETS_KEY);
    filterKey(LOCAL_STORAGE_FIRESTORE_KEY);

    const db = await openOfflineDB();
    return await new Promise<boolean>((resolve) => {
      const tx = db.transaction([STORE_DONORS, STORE_METADATA], 'readwrite');
      const store = tx.objectStore(STORE_DONORS);
      const metaStore = tx.objectStore(STORE_METADATA);
      const request = store.getAll();

      request.onsuccess = () => {
        const remaining = (request.result as Donor[]).filter((d) => !matchesDeleted(d));
        store.clear();
        for (const donor of remaining) store.put(sanitizeDonorForStorage(donor));

        const rawMeta = localStorage.getItem(LOCAL_STORAGE_META_KEY);
        let previousMeta: SyncMetadata | null = null;
        try { previousMeta = rawMeta ? JSON.parse(rawMeta) : null; } catch {}
        const metadata: SyncMetadata = {
          key: 'latest',
          lastSyncTime: new Date().toLocaleTimeString('ar-YE', { hour: '2-digit', minute: '2-digit' }),
          lastSyncTimestamp: Date.now(),
          donorCount: remaining.length,
          sheetsCount: previousMeta?.sheetsCount,
          firestoreCount: previousMeta?.firestoreCount,
          isOfflineSnapshot: typeof navigator !== 'undefined' ? !navigator.onLine : false,
          version: 1,
        };
        try { localStorage.setItem(LOCAL_STORAGE_META_KEY, JSON.stringify(metadata)); } catch {}
        metaStore.put(metadata);
      };

      request.onerror = () => {
        tx.abort();
      };
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    });
  } catch (error) {
    console.warn('تعذر حذف المتبرع من التخزين المحلي:', error);
    return false;
  }
}
