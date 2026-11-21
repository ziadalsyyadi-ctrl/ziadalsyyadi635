import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  CheckCircle2,
  Droplet,
  HardDriveDownload,
  Heart,
  Hospital,
  Megaphone,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, reconnectFirestoreNetwork } from './firebase';
import { checkForLiveUpdate } from './live-update';
import {
  clearRestoredUiSnapshot,
  getRestoredUiSnapshot,
  saveUiSnapshot,
  subscribeAppLifecycle,
} from './services/lifecycleService';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ActiveTab, BloodType, Donor, UrgentRequest } from './types';
import {
  subscribeToDonors,
  subscribeToUrgentRequests,
  seedInitialCommunityData,
  deleteDonorProfile,
} from './services/donorService';
import { fetchDonorsFromGoogleSheets } from './services/googleSheetsService';
import {
  getInstantLocalDonorsSync,
  getInstantLocalUrgentSync,
  getInstantSyncMetaSync,
  getInstantCachedFirestoreDonorsSync,
  getInstantCachedSheetsDonorsSync,
  getInstantDeletedDonorsSync,
  saveDeletedDonorsSync,
  saveSourceDonorsToOfflineStorage,
  mergeSourceDonors,
  normalizePhoneKey,
  getDonorsFromOfflineStorage,
  getUrgentRequestsFromOfflineStorage,
  saveDonorsToOfflineStorage,
  saveUrgentRequestsToOfflineStorage,
  deleteDonorFromOfflineStorage,
} from './services/offlineStorageService';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { BottomNav } from './components/BottomNav';
import { HeroBanner } from './components/HeroBanner';
import { DonorSearch } from './components/DonorSearch';
import { UrgentRequests, isUrgentRequestExpired } from './components/UrgentRequests';
import { DonorRegistration } from './components/DonorRegistration';
import { BloodDonationEducationalInfo } from './components/BloodDonationEducationalInfo';
import { QaetabahHospitalsDirectory } from './components/QaetabahHospitalsDirectory';
import { AdminDashboard } from './components/AdminDashboard';
import { SupervisorManagement } from './components/SupervisorManagement';
import ChatSupport from './components/ChatSupport';
import { AuthModal } from './components/AuthModal';
import { VisitorRestrictionModal } from './components/VisitorRestrictionModal';
import { AndroidInstallModal } from './components/AndroidInstallModal';
import { BloodCompatibilityModal } from './components/BloodCompatibilityModal';
import { ConfirmExitModal } from './components/ConfirmExitModal';
import { AppExitConfirmModal } from './components/AppExitConfirmModal';
import { SubpageBackBar } from './components/SubpageBackBar';
import { RoleSelectionModal } from './components/RoleSelectionModal';
import { NotificationsModal } from './components/NotificationsModal';
import { UrgentAlertModal } from './components/UrgentAlertModal';
import { subscribeToConversation } from './services/chatService';
import { logAdminAction } from './services/supervisorService';
import {
  addNativeBackButtonListener,
  dispatchRegisteredBackHandlers,
  exitApplication,
  isNativeBackPluginAvailable,
} from './utils/backNavigation';
import {
  UrgentAlertPayload,
  dispatchUrgentAlert,
  hasSeenAlertId,
  markAlertIdSeen,
  isAlertSoundEnabled,
  setAlertSoundEnabled,
  installAudioUnlockListeners,
  setNotificationTapHandler,
  initializePushNotifications,
} from './services/notificationService';
import {
  WebsiteConfigState,
  ensureWebsiteConfigSeededForAdmin,
  getInitialWebsiteConfig,
  openWebsiteInExternalBrowser,
  refreshWebsiteConfigFromServer,
  subscribeToWebsiteConfig,
} from './services/websiteConfigService';

function AppContent() {
  const {
    currentUser,
    userProfile,
    activeRole,
    switchActiveRole,
    isOwner,
    isAuthorizedAdmin,
    adminLevel,
    adminPermissions,
    isLoading,
    logout,
    isGuest,
  } = useAuth();

  const initialSnapshotRef = useRef(getRestoredUiSnapshot());
  const [activeTab, setActiveTab] = useState<ActiveTab>(() => initialSnapshotRef.current.activeTab);
  const [searchInitialBloodType, setSearchInitialBloodType] = useState<BloodType | 'ALL'>(
    () => initialSnapshotRef.current.searchInitialBloodType
  );
  const [rawDonors, setRawDonors] = useState<Donor[]>(() => getInstantLocalDonorsSync());
  const [deletedDonors, setDeletedDonors] = useState<string[]>(() => getInstantDeletedDonorsSync());
  const [urgentRequests, setUrgentRequests] = useState<UrgentRequest[]>(() => getInstantLocalUrgentSync());

  const [announcement, setAnnouncement] = useState('');
  const [announcementType, setAnnouncementType] = useState<'general' | 'urgent' | 'campaign'>('general');
  const [announcementTime, setAnnouncementTime] = useState('');
  const [draftAnnouncement, setDraftAnnouncement] = useState('');
  const [draftAnnouncementType, setDraftAnnouncementType] = useState<'general' | 'urgent' | 'campaign'>('general');
  const [isSavingAnnouncement, setIsSavingAnnouncement] = useState(false);

  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const firestoreDonorsRef = useRef<Donor[]>(getInstantCachedFirestoreDonorsSync());
  const sheetsDonorsRef = useRef<Donor[]>(getInstantCachedSheetsDonorsSync());

  const [syncStats, setSyncStats] = useState(() => {
    const meta = getInstantSyncMetaSync();
    const initialList = getInstantLocalDonorsSync();
    const initialSheets = sheetsDonorsRef.current.length;
    const initialFirestore = firestoreDonorsRef.current.length;
    return {
      firestoreCount: meta?.firestoreCount || initialFirestore,
      sheetsCount: meta?.sheetsCount && meta.sheetsCount > 0 ? meta.sheetsCount : initialSheets,
      duplicateCount: 0,
      excludedCount: 0,
      finalCount: Math.max(meta?.donorCount || 0, initialList.length),
      lastSyncTime: meta?.lastSyncTime || 'محفوظ محلياً',
    };
  });
  const [pendingAlerts, setPendingAlerts] = useState<UrgentAlertPayload[]>([]);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => isAlertSoundEnabled());
  const activeTabRef = useRef<ActiveTab>(activeTab);
  const currentUserIdRef = useRef<string | null>(currentUser?.uid || null);
  const hasInitialUrgentRef = useRef(false);
  const knownUrgentIdsRef = useRef<Set<string>>(new Set(getInstantLocalUrgentSync().map((r) => r.id)));
  const hasInitialSettingsRef = useRef(false);
  const justSavedAnnouncementAtRef = useRef(0);
  const [websiteConfig, setWebsiteConfig] = useState<WebsiteConfigState>(() => getInitialWebsiteConfig());

  // 5-second maximum cap for initial splash screen to guarantee fast entry
  const [initTimeoutExceeded, setInitTimeoutExceeded] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      setInitTimeoutExceeded(true);
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

  const isInitializing = isLoading && !initTimeoutExceeded;

  const searchBloodTypeRef = useRef<BloodType | 'ALL'>(searchInitialBloodType);
  const hasRestoredScrollRef = useRef(false);

  useEffect(() => {
    activeTabRef.current = activeTab;
    searchBloodTypeRef.current = searchInitialBloodType;
    saveUiSnapshot({
      activeTab,
      searchInitialBloodType,
    });
  }, [activeTab, searchInitialBloodType]);

  useEffect(() => {
    if (isInitializing || hasRestoredScrollRef.current) return;
    hasRestoredScrollRef.current = true;
    const savedScrollY = initialSnapshotRef.current.scrollY;
    if (savedScrollY > 0 && initialSnapshotRef.current.activeTab === activeTab) {
      requestAnimationFrame(() => {
        window.scrollTo({ top: savedScrollY, behavior: 'auto' });
      });
    }
  }, [isInitializing, activeTab]);

  useEffect(() => {
    currentUserIdRef.current = currentUser?.uid || null;
  }, [currentUser]);

  const enqueueAlert = (alert: UrgentAlertPayload) => {
    if (hasSeenAlertId(alert.id)) return;
    markAlertIdSeen(alert.id);
    setPendingAlerts((prev) => (prev.some((item) => item.id === alert.id) ? prev : [...prev, alert]));
    void dispatchUrgentAlert(alert);
  };

  const silentForegroundResyncRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      setToastMessage('تمت استعادة الاتصال بالإنترنت! جاري تحديث ومزامنة البيانات مع السحابة...');
      void reconnectFirestoreNetwork();
      void handleGlobalRefresh();
    };
    const handleOffline = () => {
      setIsOffline(true);
      setToastMessage('انقطع الاتصال بالإنترنت. تم تفعيل وضع التخزين المحلي (Offline) وجميع المتبرعين متاحون فوراً!');
    };

    const unsubscribeLifecycle = subscribeAppLifecycle({
      onPause: () => {
        saveUiSnapshot({
          activeTab: activeTabRef.current,
          searchInitialBloodType: searchBloodTypeRef.current,
          scrollY: window.scrollY || 0,
        });
      },
      onResume: ({ backgroundDurationMs }) => {
        const online = typeof navigator === 'undefined' ? true : navigator.onLine;
        setIsOffline(!online);

        if (online && backgroundDurationMs >= 10_000) {
          void reconnectFirestoreNetwork();
        }
        if (online && backgroundDurationMs >= 60_000) {
          void silentForegroundResyncRef.current();
        }
      },
    });

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      unsubscribeLifecycle();
    };
  }, []);

  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isInstallModalOpen, setIsInstallModalOpen] = useState(false);
  const [isCompatibilityOpen, setIsCompatibilityOpen] = useState(false);
  const [isExitConfirmOpen, setIsExitConfirmOpen] = useState(false);
  const [isAppExitModalOpen, setIsAppExitModalOpen] = useState(false);
  const [isRoleModalOpen, setIsRoleModalOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isHospitalsModalOpen, setIsHospitalsModalOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [editingDonorId, setEditingDonorId] = useState<string | null>(null);
  const [isVisitorRestrictionOpen, setIsVisitorRestrictionOpen] = useState(false);

  const navigateToHome = () => {
    setActiveTab('home');
    setEditingDonorId(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openSupervisorsTab = () => {
    if (!isOwner) return;
    setActiveTab('supervisors');
    setEditingDonorId(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  useEffect(() => {
    if (isLoading) return;
    if (activeTab === 'supervisors' && !isOwner) {
      setActiveTab('home');
    } else if (activeTab === 'admin' && !isAuthorizedAdmin) {
      setActiveTab('home');
    }
  }, [activeTab, isLoading, isOwner, isAuthorizedAdmin]);

  const handleEditDonor = (donorId?: string) => {
    setEditingDonorId(donorId || null);
    setActiveTab('register');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteDonor = async (donorId: string, phone?: string) => {
    try {
      await deleteDonorProfile(donorId, phone);
      await deleteDonorFromOfflineStorage(donorId, phone).catch(() => {});
      const cleanPhone = normalizePhoneKey(phone);
      const rawDigits = phone ? phone.trim().replace(/\D/g, '') : '';
      const idsToExclude = [donorId];
      if (cleanPhone) idsToExclude.push(cleanPhone);
      if (rawDigits && rawDigits !== cleanPhone) idsToExclude.push(rawDigits);
      const excludeSet = new Set(idsToExclude);
      const matchesDeleted = (d: Donor) => {
        if (excludeSet.has(d.id)) return true;
        const dClean = normalizePhoneKey(d.phone);
        const dDigits = d.phone ? String(d.phone).replace(/\D/g, '') : '';
        return Boolean((dClean && excludeSet.has(dClean)) || (dDigits && excludeSet.has(dDigits)));
      };
      firestoreDonorsRef.current = firestoreDonorsRef.current.filter((d) => !matchesDeleted(d));
      sheetsDonorsRef.current = sheetsDonorsRef.current.filter((d) => !matchesDeleted(d));
      setDeletedDonors((prev) => {
        const next = Array.from(new Set([...prev, ...idsToExclude]));
        saveDeletedDonorsSync(next);
        return next;
      });
      setRawDonors((prev) => prev.filter((d) => !matchesDeleted(d)));
    } catch (err) {
      console.error('Failed to delete donor:', err);
      throw err;
    }
  };

  const handleHeroNavigate = (target: ActiveTab | BloodType) => {
    if (target === 'register' && !currentUser) {
      setIsVisitorRestrictionOpen(true);
      return;
    }
    if (
      target === 'home' ||
      target === 'search' ||
      target === 'urgent' ||
      target === 'register' ||
      target === 'admin'
    ) {
      if (target === 'search') setSearchInitialBloodType('ALL');
      setActiveTab(target);
      if (target !== 'register') setEditingDonorId(null);
    } else {
      setSearchInitialBloodType(target as BloodType);
      setActiveTab('search');
      setEditingDonorId(null);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  useEffect(() => {
    if (announcement) setDraftAnnouncement(announcement);
  }, [announcement]);

  const handleSaveAnnouncement = async () => {
    if (!currentUser || !adminPermissions.manageSettings) return;
    setIsSavingAnnouncement(true);
    justSavedAnnouncementAtRef.current = Date.now();
    try {
      await setDoc(
        doc(db, 'settings', 'global'),
        {
          announcement: draftAnnouncement.trim(),
          noticeMessage: draftAnnouncement.trim(),
          announcementType: draftAnnouncementType,
          announcementTime: new Date().toISOString(),
          announcementActive: Boolean(draftAnnouncement.trim()),
          updatedAt: serverTimestamp(),
          updatedBy: currentUser.uid,
        },
        { merge: true }
      );
      void logAdminAction({
        actorUid: currentUser.uid,
        actorName: userProfile?.displayName || currentUser.displayName || 'مسؤول',
        actorLevel: adminLevel || 'legacy_admin',
        actionType: 'نشر تعميم من الرئيسية',
        targetId: 'settings/global',
        targetLabel: draftAnnouncementType,
        details: draftAnnouncement.trim().slice(0, 120),
      });
      setToastMessage('تم نشر وتحديث التعميم بنجاح لتظهر فوراً لدى جميع المستخدمين! ✓');
      setTimeout(() => setToastMessage(null), 4000);
    } catch (err: any) {
      console.error('Error saving announcement:', err);
      setToastMessage(`فشل حفظ التعميم: ${err.message}`);
      setTimeout(() => setToastMessage(null), 4000);
    } finally {
      setIsSavingAnnouncement(false);
    }
  };

  const handleClearAnnouncement = async () => {
    if (!currentUser || !adminPermissions.manageSettings) return;
    setIsSavingAnnouncement(true);
    try {
      await setDoc(
        doc(db, 'settings', 'global'),
        {
          announcement: '',
          noticeMessage: '',
          announcementActive: false,
          updatedAt: serverTimestamp(),
          updatedBy: currentUser.uid,
        },
        { merge: true }
      );
      setDraftAnnouncement('');
      void logAdminAction({
        actorUid: currentUser.uid,
        actorName: userProfile?.displayName || currentUser.displayName || 'مسؤول',
        actorLevel: adminLevel || 'legacy_admin',
        actionType: 'مسح التعميم من الرئيسية',
        targetId: 'settings/global',
      });
      setToastMessage('تم مسح التعميم بنجاح! ✓');
      setTimeout(() => setToastMessage(null), 3000);
    } catch (err) {
      console.error('Error clearing announcement:', err);
    } finally {
      setIsSavingAnnouncement(false);
    }
  };

  const handleConfirmLogout = async () => {
    try {
      await logout();
    } catch (err) {
      console.error('Logout error:', err);
    }
    clearRestoredUiSnapshot();
    localStorage.removeItem('blood_app_guest');
    localStorage.setItem('has_logged_out', 'true');
    setIsExitConfirmOpen(false);
    setActiveTab('home');
    setIsAuthModalOpen(true);
  };

  const normalizePhoneForDedupe = (phone?: string): string => {
    if (!phone) return '';
    let clean = String(phone).replace(/\D/g, '');
    if (clean.startsWith('00967')) clean = clean.slice(5);
    else if (clean.startsWith('967')) clean = clean.slice(3);
    else if (clean.startsWith('0') && clean.length === 10) clean = clean.slice(1);
    if (clean === '0' || clean.length < 7) return '';
    return clean;
  };

  const donors = useMemo(() => {
    if (!deletedDonors || deletedDonors.length === 0) return rawDonors;
    const deletedSet = new Set(deletedDonors.map((id) => String(id).trim()).filter(Boolean));
    if (deletedSet.size === 0) return rawDonors;
    return rawDonors.filter((d) => {
      if (deletedSet.has(d.id)) return false;
      const cleanPhone = normalizePhoneForDedupe(d.phone);
      const rawDigits = d.phone ? String(d.phone).replace(/\D/g, '') : '';
      return !(
        (cleanPhone && deletedSet.has(cleanPhone)) ||
        (rawDigits && deletedSet.has(rawDigits))
      );
    });
  }, [rawDonors, deletedDonors]);

  const mergeAndSaveDonors = (firestoreList: Donor[], sheetsList: Donor[]): number => {
    const effectiveFirestoreList =
      firestoreList.length > 0
        ? firestoreList
        : !navigator.onLine && firestoreDonorsRef.current.length > 0
        ? firestoreDonorsRef.current
        : firestoreList;

    const effectiveSheetsList =
      sheetsList.length > 0 ? sheetsList : sheetsDonorsRef.current;

    if (effectiveFirestoreList.length === 0 && effectiveSheetsList.length === 0) {
      return rawDonors.length;
    }

    const { merged, duplicateCount } = mergeSourceDonors(
      effectiveFirestoreList,
      effectiveSheetsList
    );

    const stats = {
      firestoreCount: effectiveFirestoreList.length,
      sheetsCount: effectiveSheetsList.length,
      duplicateCount,
      excludedCount: 0,
      finalCount: merged.length,
      lastSyncTime: new Date().toLocaleTimeString('ar-YE'),
    };

    console.log('📊 [Donor Sync Diagnostic]:', stats);
    setSyncStats(stats);

    setRawDonors((prev) => {
      // Never wipe a fuller offline snapshot that contains Sheets donors with a smaller non-Sheets slice.
      const prevHasSheets = prev.some((d) => d.source === 'google_sheets' || d.id.startsWith('sheet_'));
      const nextHasSheets = merged.some((d) => d.source === 'google_sheets' || d.id.startsWith('sheet_'));
      if (prevHasSheets && !nextHasSheets && prev.length > merged.length) {
        console.warn('Prevented replacing full donor list with partial non-Sheets result');
        return prev;
      }
      return merged;
    });

    if (effectiveFirestoreList.length > 0) {
      saveSourceDonorsToOfflineStorage('firestore', effectiveFirestoreList);
    }
    if (effectiveSheetsList.length > 0) {
      saveSourceDonorsToOfflineStorage('sheets', effectiveSheetsList);
    }

    saveDonorsToOfflineStorage(merged, {
      sheetsCount: effectiveSheetsList.length,
      firestoreCount: effectiveFirestoreList.length,
      forceOverwrite: effectiveSheetsList.length > 0,
    }).catch((err) => console.warn('Offline storage save warning:', err));

    return merged.length;
  };

  const loadSheetsDonors = async (): Promise<Donor[]> => {
    try {
      const result = await fetchDonorsFromGoogleSheets();
      if (result.success && Array.isArray(result.donors) && result.donors.length > 0) {
        const mapped: Donor[] = result.donors.map((d: any, idx: number) => ({
          id: d.donorId ? `sheet_${d.donorId}` : `sheet_row_${idx + 1}`,
          userId: '',
          fullName: d.fullName || d.name || 'متبرع بدون اسم',
          bloodType: ((d.bloodType || 'O+').toUpperCase()) as BloodType,
          phone: d.phone || '',
          phoneVerified: false,
          residence: d.residence || d.address || 'قعطبة',
          notes: d.notes || 'من سجل جدول غوغل',
          isAvailable: true,
          allowContact: true,
          source: 'google_sheets',
        }));
        sheetsDonorsRef.current = mapped;
        saveSourceDonorsToOfflineStorage('sheets', mapped);
        return mapped;
      }
    } catch (err) {
      console.warn('Sheets fetch caught error:', err);
    }
    return sheetsDonorsRef.current;
  };

  useEffect(() => {
    let active = true;
    installAudioUnlockListeners();
    setNotificationTapHandler((targetTab) => {
      if (targetTab === 'notifications') {
        setIsNotificationsOpen(true);
      } else {
        setActiveTab(targetTab);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });

    getDonorsFromOfflineStorage().then((cached) => {
      if (active && cached.length > 0) {
        const cachedSheets = cached.filter((d) => d.source === 'google_sheets' || d.id.startsWith('sheet_'));
        const cachedFirestore = cached.filter((d) => d.source !== 'google_sheets' && !d.id.startsWith('sheet_'));
        if (cachedSheets.length > sheetsDonorsRef.current.length) {
          sheetsDonorsRef.current = cachedSheets;
        }
        if (cachedFirestore.length > firestoreDonorsRef.current.length) {
          firestoreDonorsRef.current = cachedFirestore;
        }
        setRawDonors((prev) => (cached.length >= prev.length ? cached : prev));
      }
    });

    getUrgentRequestsFromOfflineStorage().then((cachedReqs) => {
      if (active && cachedReqs.length > 0) {
        setUrgentRequests((prev) => (cachedReqs.length >= prev.length ? cachedReqs : prev));
      }
    });

    loadSheetsDonors().then((sheetsList) => {
      if (active && sheetsList.length > 0) {
        mergeAndSaveDonors(firestoreDonorsRef.current, sheetsList);
      }
    });

    const unsubDonors = subscribeToDonors((firestoreList) => {
      if (firestoreList.length > 0 || navigator.onLine) {
        firestoreDonorsRef.current = firestoreList;
      }
      if (active) {
        mergeAndSaveDonors(firestoreDonorsRef.current, sheetsDonorsRef.current);
      }
    });

    const getUrgentCreatedMs = (req: UrgentRequest): number => {
      const val = req.createdAt;
      if (!val) return 0;
      if (typeof val?.toMillis === 'function') return val.toMillis();
      if (typeof val?.seconds === 'number') return val.seconds * 1000;
      const parsed = Date.parse(String(val));
      return Number.isFinite(parsed) ? parsed : 0;
    };

    const unsubUrgent = subscribeToUrgentRequests((reqs) => {
      if (!active) return;
      setUrgentRequests(reqs);
      saveUrgentRequestsToOfflineStorage(reqs).catch(() => {});

      const now = Date.now();
      const openReqs = reqs.filter((r) => r.status === 'open' && !isUrgentRequestExpired(r));

      for (const req of openReqs) {
        const alertId = `urgent_${req.id}`;
        const isOwnRequest = Boolean(currentUserIdRef.current && req.userId === currentUserIdRef.current);

        if (!hasInitialUrgentRef.current) {
          const createdMs = getUrgentCreatedMs(req);
          const isVeryRecent = createdMs > 0 && now - createdMs < 30 * 60 * 1000;
          if (isVeryRecent && !isOwnRequest && !hasSeenAlertId(alertId)) {
            enqueueAlert({
              id: alertId,
              kind: 'urgent_request',
              title: `طلب دم عاجل (${req.bloodType})`,
              body: `المريض: ${req.patientName} — مطلوب ${req.unitsNeeded} أكياس فصيلة ${req.bloodType}`,
              targetTab: 'urgent',
              bloodType: req.bloodType,
              hospital: req.hospital,
              contactPhone: req.contactPhone,
              contactName: req.contactName,
              unitsNeeded: req.unitsNeeded,
            });
          } else {
            markAlertIdSeen(alertId);
          }
        } else if (!knownUrgentIdsRef.current.has(req.id) && !isOwnRequest) {
          enqueueAlert({
            id: alertId,
            kind: 'urgent_request',
            title: `طلب دم عاجل جديد (${req.bloodType})`,
            body: `المريض: ${req.patientName} — مطلوب ${req.unitsNeeded} أكياس فصيلة ${req.bloodType}`,
            targetTab: 'urgent',
            bloodType: req.bloodType,
            hospital: req.hospital,
            contactPhone: req.contactPhone,
            contactName: req.contactName,
            unitsNeeded: req.unitsNeeded,
          });
        }
      }

      knownUrgentIdsRef.current = new Set(reqs.map((r) => r.id));
      hasInitialUrgentRef.current = true;
    });

    const unsubSettings = onSnapshot(doc(db, 'settings', 'global'), (snap) => {
      if (active && snap.exists()) {
        const data = snap.data();
        const notice = String(data.announcement || data.noticeMessage || '').trim();
        const noticeType = (data.announcementType as 'general' | 'urgent' | 'campaign') || 'general';
        const noticeTime = String(data.announcementTime || '');

        setAnnouncement(notice);
        setAnnouncementType(noticeType);
        if (noticeTime) setAnnouncementTime(noticeTime);
        if (Array.isArray(data.deletedDonors)) {
          setDeletedDonors(data.deletedDonors);
          saveDeletedDonorsSync(data.deletedDonors);
        }

        if (notice) {
          const annKey = `ann_${noticeTime}|${notice}`;
          const noticeTimeMs = Date.parse(noticeTime);
          const savedBySelf =
            Date.now() - justSavedAnnouncementAtRef.current < 8000 ||
            Boolean(
              currentUserIdRef.current &&
                data.updatedBy === currentUserIdRef.current &&
                Number.isFinite(noticeTimeMs) &&
                Date.now() - noticeTimeMs < 15000
            );

          if (!savedBySelf && !hasSeenAlertId(annKey)) {
            if (noticeType === 'urgent' || hasInitialSettingsRef.current) {
              enqueueAlert({
                id: annKey,
                kind: noticeType === 'urgent' ? 'admin_urgent' : 'admin_notice',
                title:
                  noticeType === 'urgent'
                    ? 'نداء استغاثة عاجل من المسؤول'
                    : noticeType === 'campaign'
                    ? 'إعلان حملة تبرع بالدم'
                    : 'رسالة جديدة من إدارة التطبيق',
                body: notice,
                targetTab: 'notifications',
              });
            } else {
              markAlertIdSeen(annKey);
            }
          }
        }
        hasInitialSettingsRef.current = true;
      }
    });

    const unsubWebsiteConfig = subscribeToWebsiteConfig((nextConfig) => {
      if (active) {
        setWebsiteConfig(nextConfig);
      }
    });

    const intervalId = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        return;
      }
      loadSheetsDonors().then((sheetsList) => {
        if (active && sheetsList.length > 0) {
          mergeAndSaveDonors(firestoreDonorsRef.current, sheetsList);
        }
      });
    }, 300000);

    return () => {
      active = false;
      setNotificationTapHandler(null);
      unsubDonors();
      unsubUrgent();
      unsubSettings();
      unsubWebsiteConfig();
      clearInterval(intervalId);
    };
  }, []);

  const silentForegroundResync = async () => {
    try {
      const [sheetsList, , latestWebsiteConfig] = await Promise.all([
        loadSheetsDonors(),
        checkForLiveUpdate(),
        refreshWebsiteConfigFromServer().catch(() => null),
      ]);
      if (latestWebsiteConfig) {
        setWebsiteConfig(latestWebsiteConfig);
      }
      if (sheetsList.length > 0) {
        mergeAndSaveDonors(firestoreDonorsRef.current, sheetsList);
      }
    } catch (err) {
      console.warn('Silent foreground resync note:', err);
    }
  };
  silentForegroundResyncRef.current = silentForegroundResync;

  const handleGlobalRefresh = async () => {
    try {
      setIsRefreshing(true);
      setToastMessage(null);
      await reconnectFirestoreNetwork();
      if (!Capacitor.isNativePlatform() && 'serviceWorker' in navigator) {
        try {
          const regs = await navigator.serviceWorker.getRegistrations();
          for (const reg of regs) await reg.update();
        } catch {}
      }
      const [sheetsList, otaResult, latestWebsiteConfig] = await Promise.all([
        loadSheetsDonors(),
        checkForLiveUpdate({ force: true }),
        refreshWebsiteConfigFromServer(),
      ]);
      setWebsiteConfig(latestWebsiteConfig);
      const count = mergeAndSaveDonors(firestoreDonorsRef.current, sheetsList);
      if (otaResult.status === 'downloaded' || otaResult.status === 'pending') {
        setToastMessage(`تم تحديث البيانات (${count} متبرع) وتنزيل حزمة تحديث جديدة للتطبيق (OTA) بنجاح! سيتم تطبيقها تلقائياً عند إعادة فتح التطبيق.`);
      } else {
        setToastMessage(`تم التحديث الشامل بنجاح! تم مزامنة ${count} متبرع وتأكيد أحدث إصدار متاح.`);
      }
      setTimeout(() => setToastMessage(null), 4000);
    } catch {
      setToastMessage('تم فحص الاتصال ومزامنة البيانات.');
      setTimeout(() => setToastMessage(null), 2500);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleOpenOfficialWebsite = () => {
    const launchResult = openWebsiteInExternalBrowser(websiteConfig.url);
    if (!launchResult.opened) {
      setToastMessage(launchResult.errorMessage || 'تعذر فتح موقع بنك الدم حالياً.');
      setTimeout(() => setToastMessage(null), 3500);
    }
  };

  useEffect(() => {
    if (rawDonors.length === 0 && currentUser) {
      seedInitialCommunityData(currentUser.uid);
    }
  }, [rawDonors.length, currentUser]);

  useEffect(() => {
    if (currentUser) {
      void initializePushNotifications(currentUser.uid);
      if (isOwner) {
        void ensureWebsiteConfigSeededForAdmin();
      }
    }
  }, [currentUser, isOwner]);

  useEffect(() => {
    if (!currentUser || currentUser.isAnonymous) return;
    let active = true;
    const unsub = subscribeToConversation(currentUser.uid, (conv) => {
      if (!active || !conv) return;
      if (Number(conv.unreadCountByUser || 0) > 0 && conv.status === 'replied' && activeTabRef.current !== 'chat') {
        const msgTime =
          typeof conv.lastMessageAt?.toMillis === 'function'
            ? conv.lastMessageAt.toMillis()
            : conv.lastMessageAt?.seconds || '';
        const chatAlertId = `chat_${currentUser.uid}_${msgTime}_${String(conv.lastMessage || '').slice(0, 32)}`;
        enqueueAlert({
          id: chatAlertId,
          kind: 'admin_reply',
          title: 'رسالة جديدة من المسؤول',
          body: String(conv.lastMessage || 'لديك رد جديد من إدارة التطبيق.'),
          targetTab: 'chat',
        });
      }
    });
    return () => {
      active = false;
      unsub();
    };
  }, [currentUser]);

  const activeUrgentRequests = urgentRequests.filter((r) => !isUrgentRequestExpired(r));
  const openUrgentCount = activeUrgentRequests.filter((r) => r.status === 'open').length;
  const unreadNotificationsCount = openUrgentCount + (announcement ? 1 : 0);

  const hasLoggedOut = typeof window !== 'undefined' && localStorage.getItem('has_logged_out') === 'true';
  const showInitialAuth = !currentUser && (!isGuest || hasLoggedOut);

  const handleBackPressRef = useRef<() => void>(() => {});
  handleBackPressRef.current = () => {
    if (isAppExitModalOpen) {
      setIsAppExitModalOpen(false);
      return;
    }

    if (dispatchRegisteredBackHandlers()) {
      return;
    }

    if (pendingAlerts.length > 0) {
      setPendingAlerts((prev) => prev.slice(1));
      return;
    }

    if (isHospitalsModalOpen) {
      setIsHospitalsModalOpen(false);
      return;
    }

    if (isNotificationsOpen) {
      setIsNotificationsOpen(false);
      return;
    }

    if (isRoleModalOpen) {
      setIsRoleModalOpen(false);
      return;
    }

    if (isExitConfirmOpen) {
      setIsExitConfirmOpen(false);
      return;
    }

    if (isCompatibilityOpen) {
      setIsCompatibilityOpen(false);
      return;
    }

    if (isInstallModalOpen) {
      setIsInstallModalOpen(false);
      return;
    }

    if (isVisitorRestrictionOpen) {
      setIsVisitorRestrictionOpen(false);
      return;
    }

    if (isAuthModalOpen && !showInitialAuth) {
      setIsAuthModalOpen(false);
      return;
    }

    if (isSidebarOpen) {
      setIsSidebarOpen(false);
      return;
    }

    if (showInitialAuth) {
      setIsAppExitModalOpen(true);
      return;
    }

    if (activeTab !== 'home') {
      navigateToHome();
      return;
    }

    setIsAppExitModalOpen(true);
  };

  const handleConfirmAppExit = async () => {
    const result = await exitApplication();
    if (result === 'browser_fallback') {
      setIsAppExitModalOpen(false);
      setToastMessage('تم تأكيد الخروج — يمكنك إغلاق علامة تبويب المتصفح بأمان.');
      setTimeout(() => setToastMessage(null), 3500);
    }
  };

  useEffect(() => {
    let removeNativeListener: (() => void) | null = null;
    let disposed = false;

    const useNativeBack = isNativeBackPluginAvailable();

    if (useNativeBack) {
      void addNativeBackButtonListener(() => {
        handleBackPressRef.current();
      }).then((cleanup) => {
        if (disposed) {
          cleanup?.();
        } else {
          removeNativeListener = cleanup;
        }
      });

      return () => {
        disposed = true;
        removeNativeListener?.();
      };
    }

    const ensureGuardHistoryEntry = () => {
      try {
        if (!window.history.state?.__qatabaBackGuard) {
          window.history.replaceState(
            { ...(window.history.state || {}), __qatabaBase: true },
            ''
          );
          window.history.pushState({ __qatabaBackGuard: true }, '');
        }
      } catch {
        // Ignore restricted history APIs
      }
    };

    ensureGuardHistoryEntry();

    const handlePopState = () => {
      handleBackPressRef.current();
      try {
        if (!window.history.state?.__qatabaBackGuard) {
          window.history.pushState({ __qatabaBackGuard: true }, '');
        }
      } catch {
        // Ignore restricted history APIs
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      disposed = true;
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  if (isInitializing) {
    return (
      <div className="min-h-screen bg-linear-to-b from-slate-950 via-red-950 to-slate-950 flex flex-col items-center justify-center p-6 text-white text-center font-['Cairo',sans-serif]">
        <div className="relative mb-6">
          <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-3xl bg-white p-1 flex items-center justify-center shadow-2xl shadow-red-600/50 overflow-hidden border-2 border-red-400/50">
            <img
              src="/assets/aistudio/file_0000000045e882119c7c9319efd48f08_cf9f259d.webp"
              alt="شعار أنقذني - بنك الدم قعطبه"
              className="w-full h-full object-cover rounded-2xl"
            />
          </div>
        </div>
        <h1 className="text-3xl sm:text-4xl font-black tracking-tight mb-2 text-white">
          أنقذني
        </h1>
        <p className="text-xs sm:text-sm text-red-200/90 font-bold max-w-xs mb-8">
          بنك الدم مديرية قعطبة م/الضالع
        </p>
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-full bg-white/10 backdrop-blur-md text-red-100 text-xs font-bold border border-white/10">
          <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
          <span>جاري تهيئة التطبيق وفحص البيانات...</span>
        </div>
      </div>
    );
  }

  if (showInitialAuth) {
    return (
      <div className="min-h-screen bg-linear-to-b from-slate-950 via-red-950 to-slate-950 font-['Cairo',sans-serif]">
        <AuthModal isOpen={true} isInitialScreen={true} onClose={() => {}} />
        <AppExitConfirmModal
          isOpen={isAppExitModalOpen}
          onCancel={() => setIsAppExitModalOpen(false)}
          onConfirm={handleConfirmAppExit}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 pb-20 font-['Cairo',sans-serif]">
      <Header
        onOpenAuth={() => setIsAuthModalOpen(true)}
        onOpenInstallModal={() => setIsInstallModalOpen(true)}
        onOpenSidebar={() => setIsSidebarOpen(true)}
        onGoToUrgent={() => setActiveTab('urgent')}
        onOpenNotifications={() => setIsNotificationsOpen(true)}
        onOpenRoleModal={() => setIsRoleModalOpen(true)}
        onGlobalRefresh={handleGlobalRefresh}
        isRefreshing={isRefreshing}
        unreadCount={unreadNotificationsCount}
      />

      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        donors={donors}
        onOpenExitConfirm={() => setIsExitConfirmOpen(true)}
        onOpenChat={() => setActiveTab('chat')}
        onOpenWebsite={handleOpenOfficialWebsite}
        onOpenSupervisors={isOwner ? openSupervisorsTab : undefined}
      />

      {toastMessage && (
        <div className="fixed top-16 left-4 right-4 sm:left-auto sm:right-6 sm:max-w-md z-50 bg-emerald-700 text-white px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-3 border border-emerald-500/50 animate-in slide-in-from-top-3 duration-300">
          <CheckCircle2 className="w-5 h-5 text-emerald-200 shrink-0" />
          <p className="text-xs sm:text-sm font-bold flex-1 leading-snug">{toastMessage}</p>
          <button
            onClick={() => setToastMessage(null)}
            className="text-white/80 hover:text-white p-1 rounded-lg hover:bg-emerald-600 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <main className="max-w-5xl mx-auto px-3 sm:px-6 py-4 pb-28 sm:pb-16 min-h-[calc(100vh-4rem)]">
        {isOffline && (
          <div className="mb-4 p-3.5 rounded-2xl bg-linear-to-r from-amber-600 to-amber-700 text-white shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3 border border-amber-400/40 dir-rtl">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                <HardDriveDownload className="w-5 h-5 text-amber-100 animate-pulse" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] bg-white text-amber-900 px-2 py-0.5 rounded-full font-black">
                    وضع عدم الاتصال (Offline)
                  </span>
                  <span className="text-xs sm:text-sm font-bold">
                    البيانات محفوظة بالكامل على جهازك ({donors.length} متبرع)
                  </span>
                </div>
                <p className="text-[11px] text-amber-100">
                  يمكنك البحث والاتصال بجميع المتبرعين فوراً بدون انتظار الإنترنت. ستتم المزامنة تلقائياً عند الاتصال.
                </p>
              </div>
            </div>
            <button
              onClick={() => {
                if (navigator.onLine) setIsOffline(false);
                handleGlobalRefresh();
              }}
              className="px-3.5 py-1.5 bg-white text-amber-800 hover:bg-amber-50 font-bold text-xs rounded-xl transition-all shadow-sm flex items-center justify-center gap-1.5 shrink-0 active:scale-95 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              فحص الاتصال والتحديث
            </button>
          </div>
        )}

        <>
          {announcement && (
            <div
              onClick={() => setIsNotificationsOpen(true)}
              className={`mb-4 p-3 rounded-2xl text-white shadow-lg flex items-center justify-between gap-3 overflow-hidden relative group cursor-pointer transition-all active:scale-99 ${
                announcementType === 'urgent'
                  ? 'bg-linear-to-r from-red-700 via-rose-700 to-red-800 border-2 border-red-400'
                  : announcementType === 'campaign'
                  ? 'bg-linear-to-r from-emerald-700 via-teal-700 to-emerald-800 border-2 border-emerald-400'
                  : 'bg-linear-to-r from-amber-600 via-orange-600 to-amber-700 border-2 border-amber-300'
              }`}
            >
              <div className="flex items-center gap-2.5 overflow-hidden">
                <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                  <Megaphone className="w-4.5 h-4.5 fill-white animate-pulse" />
                </div>
                <div className="overflow-hidden">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] bg-white/25 px-2 py-0.5 rounded-full font-black">
                      {announcementType === 'urgent'
                        ? 'نداء استغاثة عاجل'
                        : announcementType === 'campaign'
                        ? 'حملة تبرع'
                        : 'تنويه الإدارة'}
                    </span>
                    <span className="text-xs font-black truncate">{announcement}</span>
                  </div>
                </div>
              </div>
              <span className="text-[10px] bg-white text-slate-900 px-2 py-1 rounded-lg font-bold shrink-0">
                عرض التفاصيل
              </span>
            </div>
          )}

          {activeTab === 'home' && (
            <div className="space-y-6">
              {activeRole === 'admin' && isAuthorizedAdmin && adminPermissions.manageSettings && (
                <div className="bg-linear-to-r from-amber-600 via-amber-700 to-rose-700 text-white rounded-2xl p-4 shadow-md space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-5 h-5 text-amber-200 shrink-0" />
                      <div>
                        <h3 className="text-sm font-black">أدوات الإدارة والتعميم (وضع المسؤول)</h3>
                        <p className="text-[11px] text-amber-100">تحكم بالرسائل العامة والإشعارات وتحديث النظام</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleGlobalRefresh}
                        disabled={isRefreshing}
                        className="px-3 py-1.5 rounded-xl bg-white text-amber-950 hover:bg-amber-50 text-xs font-black flex items-center gap-1.5 shadow-xs transition-colors active:scale-95 disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                        <span>تحديث شامل</span>
                      </button>
                    </div>
                  </div>

                  <div className="bg-amber-950/40 p-3 rounded-xl border border-amber-500/30 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-amber-100">التعميم الحالي المنشور:</span>
                      <div className="flex items-center gap-1 text-[11px]">
                        <button
                          type="button"
                          onClick={() => setDraftAnnouncementType('general')}
                          className={`px-2 py-0.5 rounded-lg font-bold ${
                            draftAnnouncementType === 'general'
                              ? 'bg-amber-500 text-white'
                              : 'text-amber-200 hover:bg-amber-800'
                          }`}
                        >
                          عام
                        </button>
                        <button
                          type="button"
                          onClick={() => setDraftAnnouncementType('urgent')}
                          className={`px-2 py-0.5 rounded-lg font-bold ${
                            draftAnnouncementType === 'urgent'
                              ? 'bg-rose-600 text-white'
                              : 'text-amber-200 hover:bg-amber-800'
                          }`}
                        >
                          عاجل
                        </button>
                        <button
                          type="button"
                          onClick={() => setDraftAnnouncementType('campaign')}
                          className={`px-2 py-0.5 rounded-lg font-bold ${
                            draftAnnouncementType === 'campaign'
                              ? 'bg-emerald-600 text-white'
                              : 'text-amber-200 hover:bg-amber-800'
                          }`}
                        >
                          حملة
                        </button>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={draftAnnouncement}
                        onChange={(e) => setDraftAnnouncement(e.target.value)}
                        placeholder="اكتب رسالة أو تعميم ليظهر كشريط إشعارات عند جميع المستخدمين..."
                        className="flex-1 px-3 py-2 rounded-xl bg-white text-slate-800 text-xs font-bold outline-hidden shadow-inner"
                      />
                      <button
                        type="button"
                        onClick={handleSaveAnnouncement}
                        disabled={isSavingAnnouncement}
                        className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-amber-950 font-black text-xs transition-colors shrink-0 disabled:opacity-50"
                      >
                        {isSavingAnnouncement ? 'جارٍ النشر...' : 'نشر'}
                      </button>
                      {announcement && (
                        <button
                          type="button"
                          onClick={handleClearAnnouncement}
                          className="px-2.5 py-2 rounded-xl bg-rose-900/60 hover:bg-rose-900 text-rose-200 text-xs font-bold shrink-0"
                          title="مسح التعميم"
                        >
                          مسح
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <HeroBanner
                onNavigate={handleHeroNavigate}
                donors={donors}
                urgentRequests={activeUrgentRequests}
                onOpenCompatibility={() => setIsCompatibilityOpen(true)}
                onOpenWebsite={handleOpenOfficialWebsite}
              />
            </div>
          )}

          {activeTab === 'search' && (
            <DonorSearch
              donors={donors}
              onBack={navigateToHome}
              onNavigateToRegister={() => {
                if (currentUser) setActiveTab('register');
                else setIsVisitorRestrictionOpen(true);
              }}
              initialBloodType={searchInitialBloodType}
              onEditDonor={handleEditDonor}
              onDeleteDonor={handleDeleteDonor}
              syncStats={syncStats}
              isOffline={isOffline}
              onOpenAuth={() => setIsAuthModalOpen(true)}
            />
          )}

          {activeTab === 'urgent' && (
            <UrgentRequests
              urgentRequests={urgentRequests}
              onBack={navigateToHome}
              onOpenAuth={() => setIsAuthModalOpen(true)}
            />
          )}

          {activeTab === 'register' && (
            <DonorRegistration
              onBack={navigateToHome}
              onSuccessNavigate={() => {
                setActiveTab('search');
                setEditingDonorId(null);
              }}
              donors={donors}
              onOpenAuth={() => setIsAuthModalOpen(true)}
              editingDonorId={editingDonorId}
              onDeleteDonor={handleDeleteDonor}
            />
          )}

          {activeTab === 'info' && (
            <BloodDonationEducationalInfo onBack={navigateToHome} showSponsorCard={true} />
          )}

          {activeTab === 'hospitals' && (
            <div className="w-full max-w-4xl mx-auto space-y-4">
              <SubpageBackBar
                title="دليل المستشفيات والنقاط الطبية"
                onBack={navigateToHome}
              />
              <div className="bg-white rounded-3xl p-5 sm:p-6 shadow-sm border border-slate-200/90 text-center">
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center mx-auto mb-3 sm:mb-4 shadow-inner">
                  <Hospital className="w-7 h-7 sm:w-8 sm:h-8" />
                </div>
                <h2 className="text-lg sm:text-xl font-black text-slate-900">دليل المستشفيات والنقاط الطبية</h2>
                <p className="text-xs sm:text-sm text-slate-500 font-bold mt-1">مديرية قعطبة - الضالع</p>
              </div>
              <QaetabahHospitalsDirectory isOpen={true} isEmbedded={true} onClose={navigateToHome} />
            </div>
          )}

          {activeTab === 'admin' && (
            <AdminDashboard
              onBack={navigateToHome}
              donors={donors}
              urgentRequests={urgentRequests}
              onEditDonor={handleEditDonor}
              onDeleteDonor={handleDeleteDonor}
              onGlobalRefresh={handleGlobalRefresh}
              onOpenSupervisors={isOwner ? openSupervisorsTab : undefined}
              isRefreshing={isRefreshing}
            />
          )}

          {activeTab === 'supervisors' && isOwner && (
            <div className="space-y-4">
              <SubpageBackBar
                title="إدارة المشرفين"
                onBack={navigateToHome}
              />
              <SupervisorManagement
                onBackToAdmin={() => {
                  switchActiveRole('admin');
                  setActiveTab('admin');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              />
            </div>
          )}

          {activeTab === 'chat' && (
            <ChatSupport userProfile={userProfile} onBack={navigateToHome} />
          )}
        </>
      </main>

      <BottomNav
        activeTab={activeTab}
        onTabChange={(tab) => {
          if (tab === 'register' && !currentUser) {
            setIsVisitorRestrictionOpen(true);
            return;
          }
          if (tab === 'search') setSearchInitialBloodType('ALL');
          setActiveTab(tab);
          if (tab === 'register') setEditingDonorId(null);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        urgentCount={openUrgentCount}
      />

      <AuthModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} />

      <VisitorRestrictionModal
        isOpen={isVisitorRestrictionOpen}
        onClose={() => setIsVisitorRestrictionOpen(false)}
        onOpenRegister={() => {
          setIsVisitorRestrictionOpen(false);
          setIsAuthModalOpen(true);
        }}
        onOpenLogin={() => {
          setIsVisitorRestrictionOpen(false);
          setIsAuthModalOpen(true);
        }}
      />

      <AndroidInstallModal isOpen={isInstallModalOpen} onClose={() => setIsInstallModalOpen(false)} />

      <BloodCompatibilityModal isOpen={isCompatibilityOpen} onClose={() => setIsCompatibilityOpen(false)} />

      <ConfirmExitModal
        isOpen={isExitConfirmOpen}
        onClose={() => setIsExitConfirmOpen(false)}
        onConfirm={handleConfirmLogout}
      />

      <RoleSelectionModal
        isOpen={isRoleModalOpen}
        onClose={() => setIsRoleModalOpen(false)}
        currentRole={activeRole}
        onRoleChange={(role) => {
          switchActiveRole(role);
          setActiveTab(role === 'admin' ? 'admin' : 'home');
        }}
        onOpenAdminAuth={() => setIsAuthModalOpen(true)}
        onOpenSupervisors={isOwner ? openSupervisorsTab : undefined}
      />

      <NotificationsModal
        isOpen={isNotificationsOpen}
        onClose={() => setIsNotificationsOpen(false)}
        urgentRequests={activeUrgentRequests}
        announcement={announcement}
        announcementType={announcementType}
        announcementTime={announcementTime}
        onGoToUrgent={() => {
          setActiveTab('urgent');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />

      <QaetabahHospitalsDirectory
        isOpen={isHospitalsModalOpen}
        onClose={() => setIsHospitalsModalOpen(false)}
      />

      <UrgentAlertModal
        alerts={pendingAlerts}
        soundEnabled={soundEnabled}
        onToggleSound={() => {
          const next = !soundEnabled;
          setAlertSoundEnabled(next);
          setSoundEnabled(next);
        }}
        onDismissCurrent={() => setPendingAlerts((prev) => prev.slice(1))}
        onDismissAll={() => setPendingAlerts([])}
        onNavigateTarget={(targetTab) => {
          if (targetTab === 'notifications') {
            setIsNotificationsOpen(true);
          } else {
            setActiveTab(targetTab);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }
        }}
      />

      <AppExitConfirmModal
        isOpen={isAppExitModalOpen}
        onCancel={() => setIsAppExitModalOpen(false)}
        onConfirm={handleConfirmAppExit}
      />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
