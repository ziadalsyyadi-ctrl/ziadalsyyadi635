import React, { useState } from 'react';
import {
  Clock,
  Droplet,
  ShieldCheck,
  FileSpreadsheet,
  Settings,
  Upload,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Database,
  Trash2,
  Lock,
  Search,
  ExternalLink,
  FolderOpen,
  Edit3,
  Phone,
  MapPin,
  Megaphone,
  RefreshCw,
  Plus,
  X,
  Users,
  UserPlus,
  KeyRound,
  Copy,
  MessageCircle,
  Globe,
} from 'lucide-react';
import { doc, getDoc, setDoc, deleteDoc, serverTimestamp, collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { importRawDonors, pushAllDonorsToSheets, fetchDonorsFromGoogleSheets, GOOGLE_SHEETS_CONFIG } from '../services/googleSheetsService';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { useAuth } from '../context/AuthContext';
import { Donor, BloodType, BLOOD_TYPES, Hospital, UrgentRequest } from '../types';
import { BloodDonationEducationalInfo } from './BloodDonationEducationalInfo';
import { subscribeToHospitals, saveHospital, deleteHospital, seedHospitals } from '../services/hospitalService';
import { subscribeToLocations, saveLocation, deleteLocation } from '../services/locationService';
import { updateRequestStatus, deleteUrgentRequest } from '../services/donorService';
import {
  ALL_SUPERVISOR_LEVEL_LABELS,
  isOwnerEmail,
  logAdminAction,
  subscribeToAllSupervisors,
} from '../services/supervisorService';
import { Hospital as HospitalIcon, MessageSquare } from 'lucide-react';
import AdminChatManager from './AdminChatManager';
import {
  listAccountRecoveryRequests,
  listAppUsers,
  deleteAppUser,
  approveAccountRecovery,
  issueDirectRecoveryByPhone,
  revokeAccountRecovery,
  deleteAccountRecoveryRequest,
  RecoveryRequest,
  IssuedRecoveryResult,
} from '../services/accountRecoveryService';
import {
  DEFAULT_WEBSITE_URL,
  WEBSITE_CONFIG_PATH,
  WebsiteConfigState,
  ensureWebsiteConfigSeededForAdmin,
  getInitialWebsiteConfig,
  openWebsiteInExternalBrowser,
  saveRemoteWebsiteUrl,
  subscribeToWebsiteConfig,
  validateWebsiteUrl,
} from '../services/websiteConfigService';
import { useRegisterBackHandler } from '../utils/backNavigation';

interface AdminDashboardProps {
  onBack: () => void;
  donors?: Donor[];
  urgentRequests?: UrgentRequest[];
  onEditDonor?: (donorId: string) => void;
  onDeleteDonor?: (donorId: string, phone?: string) => Promise<void>;
  onGlobalRefresh?: () => Promise<void>;
  onOpenSupervisors?: () => void;
  isRefreshing?: boolean;
  heroBannerUrl?: string;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ 
  onBack,
  donors = [],
  urgentRequests = [],
  onEditDonor,
  onDeleteDonor,
  onGlobalRefresh,
  onOpenSupervisors,
  isRefreshing = false,
  heroBannerUrl = '',
}) => {
  const {
    userProfile,
    currentUser,
    switchActiveRole,
    isOwner,
    isAuthorizedAdmin,
    adminLevel,
    adminPermissions,
  } = useAuth();

  const canManageDonors = isAuthorizedAdmin && adminPermissions.manageDonors;
  const canManageUrgent = isAuthorizedAdmin && adminPermissions.manageUrgentRequests;
  const canManageSupport = isAuthorizedAdmin && adminPermissions.manageSupportChat;
  const canManageHospitals = isAuthorizedAdmin && adminPermissions.manageHospitals;
  const canManageLocations = isAuthorizedAdmin && adminPermissions.manageLocations;
  const canManageSettings = isAuthorizedAdmin && adminPermissions.manageSettings;
  const canManageUsersRecovery = isAuthorizedAdmin && adminPermissions.manageUsersRecovery;

  const writeAudit = (
    actionType: string,
    targetId?: string,
    targetLabel?: string,
    details?: string
  ) => {
    if (!currentUser?.uid) return;
    void logAdminAction({
      actorUid: currentUser.uid,
      actorName: userProfile?.displayName || currentUser.displayName || 'مسؤول',
      actorLevel: adminLevel || 'legacy_admin',
      actionType,
      targetId,
      targetLabel,
      details,
    });
  };
  const [importText, setImportText] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [announcementType, setAnnouncementType] = useState<'general' | 'urgent' | 'campaign'>('general');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [adminAuthLoading, setAdminAuthLoading] = useState(false);

  // Hero Banner management states
  const [bannerUrlInput, setBannerUrlInput] = useState(heroBannerUrl);
  const [isSavingBanner, setIsSavingBanner] = useState(false);
  const [bannerSaveResult, setBannerSaveResult] = useState<{ success: boolean; message: string } | null>(null);
  const bannerFileInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (heroBannerUrl !== undefined) {
      setBannerUrlInput(heroBannerUrl);
    }
  }, [heroBannerUrl]);

  const handleSaveHeroBanner = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !canManageSettings) return;
    setIsSavingBanner(true);
    setBannerSaveResult(null);
    try {
      await setDoc(
        doc(db, 'settings', 'global'),
        {
          heroBannerUrl: bannerUrlInput.trim(),
          updatedAt: serverTimestamp(),
          updatedBy: currentUser.uid,
        },
        { merge: true }
      );
      writeAudit('تحديث البنر الرئيسي', undefined, 'إدارة البنر الرئيسي');
      setBannerSaveResult({ success: true, message: 'تم تحديث البنر الرئيسي بنجاح للجميع! ✓' });
      setTimeout(() => setBannerSaveResult(null), 4000);
    } catch (err: any) {
      setBannerSaveResult({ success: false, message: `فشل حفظ البنر: ${err.message}` });
    } finally {
      setIsSavingBanner(false);
    }
  };

  const handleBannerFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      if (result) {
        setBannerUrlInput(result);
        setBannerSaveResult({ success: true, message: 'تم تحميل الصورة بنجاح. اضغط "حفظ وتحديث البنر للجميع" لتطبيقها فوراً.' });
      }
    };
    reader.readAsDataURL(file);
  };

  // Donors management states
  const [adminSearchQuery, setAdminSearchQuery] = useState('');
  const [adminBloodFilter, setAdminBloodFilter] = useState<BloodType | 'ALL'>('ALL');
  const [adminDonorToDelete, setAdminDonorToDelete] = useState<Donor | null>(null);
  const [adminIsDeleting, setAdminIsDeleting] = useState(false);
  const [adminDeleteError, setAdminDeleteError] = useState<string | null>(null);
  const [showDonorsSection, setShowDonorsSection] = useState(true);

  // Hospital management states
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [showHospitalsSection, setShowHospitalsSection] = useState(false);
  const [editingHospital, setEditingHospital] = useState<Hospital | null>(null);
  const [isHospitalFormOpen, setIsHospitalFormOpen] = useState(false);
  const [hospitalForm, setHospitalForm] = useState<Omit<Hospital, 'id'>>({
    name: '',
    type: '',
    address: '',
    phone: '',
    services: ''
  });
  const [hospitalLoading, setHospitalLoading] = useState(false);
  const [showChatManager, setShowChatManager] = useState(false);

  useRegisterBackHandler(isHospitalFormOpen, () => setIsHospitalFormOpen(false));
  useRegisterBackHandler(showChatManager, () => setShowChatManager(false));
  useRegisterBackHandler(Boolean(adminDonorToDelete), () => {
    if (!adminIsDeleting) {
      setAdminDonorToDelete(null);
      setAdminDeleteError(null);
    }
  });

  // Subscribe to hospitals
  React.useEffect(() => {
    const unsub = subscribeToHospitals((data) => {
      setHospitals(data);
    });
    return () => unsub();
  }, []);

  // User Accounts Stats State
  const [totalUsersCount, setTotalUsersCount] = useState<number>(0);
  const [todaySignupsCount, setTodaySignupsCount] = useState<number>(0);
  const [adminsCount, setAdminsCount] = useState<number>(0);
  const [supervisorsCount, setSupervisorsCount] = useState<number>(0);
  const [adminsList, setAdminsList] = useState<any[]>([]);
  const [allUsersList, setAllUsersList] = useState<any[]>([]);
  const [isCleaningUp, setIsCleaningUp] = useState(false);
  const [showUsersSection, setShowUsersSection] = useState(false);
  const [recoveryRequests, setRecoveryRequests] = useState<RecoveryRequest[]>([]);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [approvingRecoveryId, setApprovingRecoveryId] = useState<string | null>(null);
  const [revokingRecoveryId, setRevokingRecoveryId] = useState<string | null>(null);
  const [deletingRecoveryId, setDeletingRecoveryId] = useState<string | null>(null);
  const [issuedRecoveryCode, setIssuedRecoveryCode] = useState<IssuedRecoveryResult | null>(null);
  const [directRecoveryPhone, setDirectRecoveryPhone] = useState('');
  const [directRecoveryName, setDirectRecoveryName] = useState('');
  const [issuingDirectRecovery, setIssuingDirectRecovery] = useState(false);
  const [copiedRecoveryCode, setCopiedRecoveryCode] = useState(false);

  // Urgent requests management states
  const [urgentFilter, setUrgentFilter] = useState<'all' | 'open' | 'fulfilled'>('all');
  const [busyUrgentId, setBusyUrgentId] = useState<string | null>(null);

  // Locations management states
  const [locations, setLocations] = useState<any[]>([]);
  const [showLocationsSection, setShowLocationsSection] = useState(false);
  const [editingLocationId, setEditingLocationId] = useState<string | null>(null);
  const [locationNameInput, setLocationLocationNameInput] = useState('');

  // Remote official website URL states
  const [websiteConfig, setWebsiteConfig] = useState<WebsiteConfigState>(() => getInitialWebsiteConfig());
  const [websiteUrlInput, setWebsiteUrlInput] = useState<string>(() => getInitialWebsiteConfig().url);
  const [websiteInputDirty, setWebsiteInputDirty] = useState(false);
  const [isSavingWebsiteUrl, setIsSavingWebsiteUrl] = useState(false);
  const [websiteSaveResult, setWebsiteSaveResult] = useState<{ success: boolean; message: string } | null>(null);

  const fetchUserStats = async () => {
    if (!isOwner && !canManageUsersRecovery) return;
    try {
      let authUsers: any[] = [];
      try { authUsers = await listAppUsers(); }
      catch (listErr) { console.warn('Could not fetch users list:', listErr); }
      const usersSnap = await getDocs(collection(db, 'users'));
      const total = authUsers.length || usersSnap.size;
      setTotalUsersCount(total);

      // Count signups created today
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

      let todayCount = 0;
      const admins: any[] = [];
      const allUsers: any[] = authUsers;

      usersSnap.forEach((docSnap) => {
        const data = docSnap.data();
        const userWithId = { id: docSnap.id, ...data };
        const authRecord = allUsers.find((item: any) => item.uid === docSnap.id);
        if (authRecord) Object.assign(authRecord, userWithId);
        else allUsers.push(userWithId);
        
        // Admin check
        if (data.role === 'admin' || isOwnerEmail(data.email)) {
          admins.push(userWithId);
        }

        let createdTime: number | null = null;
        if (data.createdAt?.toDate) {
          createdTime = data.createdAt.toDate().getTime();
        } else if (data.createdAt) {
          createdTime = new Date(data.createdAt).getTime();
        }
        if (createdTime && createdTime >= startOfDay) {
          todayCount++;
        }
      });

      setTodaySignupsCount(todayCount);
      setAdminsCount(admins.length);
      setAdminsList(admins);
      setAllUsersList(allUsers);
    } catch (e) {
      console.warn('Could not fetch user stats:', e);
    }
  };

  const refreshRecoveryRequests = async () => {
    if (!canManageUsersRecovery) return;
    try { setRecoveryRequests(await listAccountRecoveryRequests()); }
    catch (error) { console.warn('Could not load recovery requests:', error); }
  };

  const toWhatsAppNumber = (phone: string) => {
    const digits = phone.replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('967')) return digits;
    if (digits.length === 9 && digits.startsWith('7')) return `967${digits}`;
    return digits;
  };

  const handleApproveRecovery = async (requestId: string) => {
    setApprovingRecoveryId(requestId);
    setIssuedRecoveryCode(null);
    setCopiedRecoveryCode(false);
    try {
      const issued = await approveAccountRecovery(requestId);
      setIssuedRecoveryCode(issued);
      await refreshRecoveryRequests();
      writeAudit('اعتماد استعادة حساب', requestId, issued.phone, `إصدار رمز استعادة للرقم ${issued.phone}`);
      setResult({ success: true, message: `تم إصدار رمز الاستعادة للرقم ${issued.phone} بنجاح.` });
    } catch (error: any) {
      setResult({ success: false, message: error?.message || 'تعذر إصدار رمز الاستعادة.' });
    } finally { setApprovingRecoveryId(null); }
  };

  const handleIssueDirectRecovery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!directRecoveryPhone.trim()) return;
    setIssuingDirectRecovery(true);
    setIssuedRecoveryCode(null);
    setCopiedRecoveryCode(false);
    try {
      const issued = await issueDirectRecoveryByPhone(directRecoveryPhone, directRecoveryName);
      setIssuedRecoveryCode(issued);
      setDirectRecoveryPhone('');
      setDirectRecoveryName('');
      await refreshRecoveryRequests();
      writeAudit('إصدار رمز استعادة مباشر', issued.requestId, issued.phone, `الاسم: ${issued.fullName}`);
      setResult({ success: true, message: `تم إصدار رمز استعادة مباشر للرقم ${issued.phone}.` });
    } catch (error: any) {
      setResult({ success: false, message: error?.message || 'تعذر إصدار رمز الاستعادة المباشر.' });
    } finally { setIssuingDirectRecovery(false); }
  };

  const handleRevokeRecovery = async (requestId: string) => {
    setRevokingRecoveryId(requestId);
    try {
      await revokeAccountRecovery(requestId);
      setIssuedRecoveryCode(current => current?.requestId === requestId ? null : current);
      await refreshRecoveryRequests();
      writeAudit('إلغاء رمز استعادة', requestId, requestId);
      setResult({ success: true, message: 'تم إلغاء الرمز بنجاح. يمكن للمستخدم طلب رمز جديد.' });
    } catch (error: any) {
      setResult({ success: false, message: error?.message || 'تعذر إلغاء رمز الاستعادة.' });
    } finally { setRevokingRecoveryId(null); }
  };

  const handleDeleteRecoveryRequest = async (requestId: string) => {
    setDeletingRecoveryId(requestId);
    try {
      await deleteAccountRecoveryRequest(requestId);
      setRecoveryRequests(prev => prev.filter(r => r.id !== requestId));
      setIssuedRecoveryCode(current => current?.requestId === requestId ? null : current);
      writeAudit('حذف سجل طلب استعادة', requestId, requestId);
      setResult({ success: true, message: 'تم حذف سجل طلب الاستعادة.' });
    } catch (error: any) {
      setResult({ success: false, message: error?.message || 'تعذر حذف سجل الطلب.' });
    } finally { setDeletingRecoveryId(null); }
  };

  const handleDeleteAppUser = async (uid: string) => {
    if (!window.confirm('سيتم حذف حساب المستخدم وملفه من قاعدة البيانات. هل تريد المتابعة؟')) return;
    setDeletingUserId(uid);
    try {
      await deleteAppUser(uid);
      setAllUsersList(prev => prev.filter((item: any) => (item.uid || item.id) !== uid));
      setTotalUsersCount(prev => Math.max(0, prev - 1));
      writeAudit('حذف ملف مستخدم', uid, uid);
      setResult({ success: true, message: 'تم حذف ملف المستخدم بنجاح.' });
    } catch (error: any) {
      setResult({ success: false, message: error?.message || 'تعذر حذف حساب المستخدم.' });
    } finally { setDeletingUserId(null); }
  };

  // Subscribe to locations
  React.useEffect(() => {
    const unsub = subscribeToLocations((data: any[]) => {
      setLocations(data);
    });
    return () => unsub();
  }, []);

  React.useEffect(() => {
    if (isOwner || canManageUsersRecovery) {
      void fetchUserStats();
    }
    if (canManageUsersRecovery) {
      void refreshRecoveryRequests();
    }
  }, [donors.length, isOwner, canManageUsersRecovery]);

  React.useEffect(() => {
    if (!isOwner) {
      setSupervisorsCount(0);
      return;
    }
    const unsub = subscribeToAllSupervisors(
      (records) => {
        setSupervisorsCount(records.filter((r) => r.isActive).length);
      },
      () => {}
    );
    return () => unsub();
  }, [isOwner]);

  // Filtered donors in admin panel
  const filteredDonors = React.useMemo(() => {
    return donors.filter((d) => {
      if (adminBloodFilter !== 'ALL' && d.bloodType !== adminBloodFilter) return false;
      if (adminSearchQuery.trim()) {
        const q = adminSearchQuery.toLowerCase().trim();
        return (
          d.fullName.toLowerCase().includes(q) ||
          d.residence.toLowerCase().includes(q) ||
          d.phone.includes(q)
        );
      }
      return true;
    });
  }, [donors, adminBloodFilter, adminSearchQuery]);

  const filteredUrgentRequests = React.useMemo(() => {
    return urgentRequests.filter((req) => {
      if (urgentFilter === 'open') return req.status === 'open';
      if (urgentFilter === 'fulfilled') return req.status === 'fulfilled';
      return true;
    });
  }, [urgentRequests, urgentFilter]);

  // Load existing settings
  React.useEffect(() => {
    const fetchSettings = async () => {
      try {
        const snap = await getDoc(doc(db, 'settings', 'global'));
        if (snap.exists()) {
          const data = snap.data();
          setAnnouncement(data.announcement || data.noticeMessage || '');
          if (data.announcementType) {
            setAnnouncementType(data.announcementType);
          }
        }
      } catch (e) {}
    };
    fetchSettings();
  }, []);

  React.useEffect(() => {
    const unsub = subscribeToWebsiteConfig((nextConfig) => {
      setWebsiteConfig(nextConfig);
      if (!websiteInputDirty) {
        setWebsiteUrlInput(nextConfig.url);
      }
    });
    return () => unsub();
  }, [websiteInputDirty]);

  React.useEffect(() => {
    if (isOwner) {
      void ensureWebsiteConfigSeededForAdmin();
    }
  }, [isOwner]);

  const handlePinLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setPinError('يجب تسجيل الدخول بحساب المسؤول المعتمد؛ رمز PIN غير مستخدم.');
  };

  const handleExportExcel = async () => {
    setLoading(true);
    setResult(null);
    let objectUrl: string | null = null;
    try {
      // Use the complete list already loaded by the app; only query Sheets if it is empty.
      let donorsList: any[] = Array.isArray(donors) ? [...donors] : [];
      if (donorsList.length === 0) {
        const sheetsRes = await fetchDonorsFromGoogleSheets();
        if (!sheetsRes.success || !Array.isArray(sheetsRes.donors)) {
          throw new Error(sheetsRes.error || 'تعذر جلب بيانات المتبرعين من الجدول.');
        }
        donorsList = sheetsRes.donors;
      }
      if (donorsList.length === 0) {
        setResult({ success: false, message: 'لا توجد بيانات متبرعين للتصدير حالياً' });
        return;
      }

      const escapeCsv = (value: unknown) => '"' + String(value ?? '').replace(/"/g, '""') + '"';
      const headers = ['الاسم الكامل', 'فصيلة الدم', 'رقم الهاتف', 'العنوان / السكن', 'الملاحظات'];
      const csvRows = [headers.map(escapeCsv).join(',')];
      donorsList.forEach((d: any) => {
        csvRows.push([
          d.fullName || d.name || '',
          d.bloodType || '',
          d.phone || '',
          d.residence || d.address || 'قعطبة',
          d.notes || '',
        ].map(escapeCsv).join(','));
      });

      // UTF-8 BOM makes Arabic columns display correctly in Excel.
      const csvContent = '\uFEFF' + csvRows.join('\r\n');
      const fileName = `Bank_AlDam_Donors_${new Date().toISOString().slice(0, 10)}.csv`;

      // Native Android/iOS APK flow: WebView ignores blob: <a download>, so write a real file and share/save it natively.
      if (Capacitor.isNativePlatform()) {
        if (Capacitor.isPluginAvailable('Filesystem') && Capacitor.isPluginAvailable('Share')) {
          const writeRes = await Filesystem.writeFile({
            path: fileName,
            data: csvContent,
            directory: Directory.Cache,
            encoding: Encoding.UTF8,
            recursive: true,
          });
          await Share.share({
            title: 'سجل متبرعي بنك الدم قعطبة',
            text: `ملف إكسل (CSV) يحتوي على ${donorsList.length} متبرعاً`,
            files: [writeRes.uri],
            dialogTitle: 'حفظ أو مشاركة ملف الإكسل',
          });
          setResult({
            success: true,
            message: `تم تجهيز ملف ${fileName} (${donorsList.length} متبرعاً). اختر «حفظ في الملفات» أو برنامج الإكسل أو المشاركة.`,
          });
          return;
        }

        // Fallback if an older APK received this code via OTA before rebuilding with @capacitor/filesystem.
        try {
          await navigator.clipboard.writeText(csvContent);
        } catch {}
        if (Capacitor.isPluginAvailable('Share')) {
          await Share.share({
            title: fileName,
            text: csvContent,
            dialogTitle: 'مشاركة بيانات الإكسل (CSV)',
          });
          setResult({
            success: true,
            message: `تم فتح مشاركة بيانات ${fileName} (${donorsList.length} متبرعاً) ونسخها للحافظة. لحفظه كملف .csv مباشرة يُنصح بتحديث نسخة الـ APK الجديدة.`,
          });
          return;
        }
        setResult({
          success: true,
          message: `تم نسخ بيانات ${donorsList.length} متبرعاً بصيغة CSV إلى الحافظة؛ حدّث نسخة الـ APK لتفعيل التصدير كملف مباشرة.`,
        });
        return;
      }

      const file = new File([csvContent], fileName, { type: 'text/csv;charset=utf-8' });

      // Prefer the native share sheet with a real file when the mobile browser supports file sharing.
      const nav = navigator as Navigator & {
        canShare?: (data?: ShareData) => boolean;
        share?: (data: ShareData) => Promise<void>;
      };
      if (typeof nav.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], title: 'سجل متبرعي بنك الدم قعطبة' });
        setResult({ success: true, message: `تم فتح المشاركة للملف ${fileName} ويحتوي على ${donorsList.length} متبرعاً.` });
        return;
      }

      // Desktop/Web fallback: start a real browser download.
      objectUrl = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = fileName;
      link.style.position = 'fixed';
      link.style.left = '-10000px';
      document.body.appendChild(link);
      link.click();
      link.remove();

      setResult({
        success: true,
        message: `تم إنشاء ملف ${fileName} ويحتوي على ${donorsList.length} متبرعاً. بدأ طلب التنزيل؛ افحص مجلد التنزيلات.`,
      });
    } catch (err: any) {
      const msg = String(err?.message || '');
      if (err?.name === 'AbortError' || msg.toLowerCase().includes('cancel')) {
        setResult({ success: false, message: 'تم إلغاء مشاركة الملف؛ لم يتم إرسال أي بيانات.' });
      } else {
        console.error('Donor export failed:', err);
        setResult({ success: false, message: err?.message || 'تعذر إنشاء أو مشاركة ملف المتبرعين.' });
      }
    } finally {
      if (objectUrl) window.setTimeout(() => URL.revokeObjectURL(objectUrl!), 60000);
      setLoading(false);
    }
  };

  // Client-side display guard. Firestore rules remain the authority for data access.
  if (!isAuthorizedAdmin) {
    return (
      <div className="max-w-md mx-auto my-8 p-6 rounded-3xl bg-white border border-slate-200 shadow-xl space-y-4 text-right">
        <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto">
          <Lock className="w-7 h-7" />
        </div>
        <h2 className="text-lg font-black text-center text-slate-900">الدخول للمسؤول أو المشرف المعتمد فقط</h2>
        <p className="text-xs text-center text-slate-600">سجّل الدخول بحساب المالك أو بحساب مشرف مفعّل في قاعدة البيانات.</p>
        <button type="button" onClick={onBack}
          className="w-full py-3 rounded-xl bg-slate-100 text-slate-700 font-bold text-xs">
          العودة
        </button>
      </div>
    );
  }

  const handleSaveSettings = async () => {
    if (!currentUser) return;
    setLoading(true);
    setResult(null);
    try {
      await setDoc(doc(db, 'settings', 'global'), {
        announcement: announcement.trim(),
        noticeMessage: announcement.trim(),
        announcementType,
        announcementTime: new Date().toISOString(),
        announcementActive: Boolean(announcement.trim()),
        updatedAt: serverTimestamp(),
        updatedBy: currentUser.uid
      }, { merge: true });
      writeAudit('نشر تعميم عام', 'settings/global', announcementType, announcement.trim().slice(0, 120));
      setResult({ 
        success: true, 
        message: announcement.trim() 
          ? 'تم تعميم الرسالة ونشرها بنجاح لتظهر فوراً عند جميع المشتركين في الإشعارات! ✓' 
          : 'تم تحديث الإعدادات بنجاح!' 
      });
    } catch (err: any) {
      setResult({ success: false, message: `فشل الحفظ: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  const handleClearAnnouncement = async () => {
    if (!currentUser) return;
    setLoading(true);
    setResult(null);
    try {
      await setDoc(doc(db, 'settings', 'global'), {
        announcement: '',
        noticeMessage: '',
        announcementActive: false,
        updatedAt: serverTimestamp(),
        updatedBy: currentUser.uid
      }, { merge: true });
      setAnnouncement('');
      writeAudit('مسح التعميم العام', 'settings/global', 'announcement');
      setResult({ success: true, message: 'تم إلغاء ومسح الرسالة من إشعارات جميع المشتركين بنجاح. ✓' });
    } catch (err: any) {
      setResult({ success: false, message: `فشل المسح: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveWebsiteUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    setWebsiteSaveResult(null);
    const valid = validateWebsiteUrl(websiteUrlInput);
    if (!valid) {
      setWebsiteSaveResult({
        success: false,
        message: 'الرابط غير صالح. تأكد أنه يبدأ بـ https:// أو http:// ولا يحتوي على مسافات.',
      });
      return;
    }

    setIsSavingWebsiteUrl(true);
    try {
      const savedUrl = await saveRemoteWebsiteUrl(valid);
      setWebsiteUrlInput(savedUrl);
      setWebsiteInputDirty(false);
      writeAudit('تحديث رابط الموقع الرسمي', WEBSITE_CONFIG_PATH, savedUrl);
      setWebsiteSaveResult({
        success: true,
        message: 'تم حفظ وتحديث رابط الموقع في Firebase بنجاح وسيتحدث تلقائياً لدى جميع المستخدمين! ✓',
      });
    } catch (err: any) {
      setWebsiteSaveResult({
        success: false,
        message: `تعذر تحديث رابط الموقع في Firebase: ${err?.message || 'خطأ غير متوقع'}`,
      });
    } finally {
      setIsSavingWebsiteUrl(false);
    }
  };

  const handleImport = async () => {
    if (!importText.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await importRawDonors(importText);
      if (res.success) {
        writeAudit('استيراد متبرعين نصي', undefined, `${res.count} متبرع`);
        setResult({ 
          success: true, 
          message: `تم استيراد ${res.count} متبرعاً بنجاح إلى قاعدة البيانات!` 
        });
        setImportText('');
      } else {
        setResult({ success: false, message: res.error || 'فشل الاستيراد' });
      }
    } catch (err: any) {
      setResult({ success: false, message: err.message });
    } finally {
      setLoading(false);
    }
  };

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setResult(null);

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        if (!text || !text.trim()) {
          setResult({ success: false, message: 'الملف المختار فارغ أو تعذر قراءته' });
          setLoading(false);
          return;
        }

        setImportText(text);

        // Automatically trigger import
        const res = await importRawDonors(text);
        if (res.success) {
          writeAudit('استيراد ملف متبرعين', undefined, file.name, `تم استيراد ${res.count} متبرع`);
          setResult({ 
            success: true, 
            message: `تم اختيار الملف (${file.name}) واستيراد ${res.count} متبرعاً بنجاح إلى قاعدة البيانات!` 
          });
        } else {
          setResult({ 
            success: false, 
            message: res.error || 'حدث خطأ أثناء تحليل بيانات الملف المختار' 
          });
        }
      } catch (err: any) {
        setResult({ success: false, message: `فشل قراءة الملف: ${err.message}` });
      } finally {
        setLoading(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    };

    reader.onerror = () => {
      setResult({ success: false, message: 'حدث خطأ أثناء فتح ملف الهاتف' });
      setLoading(false);
    };

    reader.readAsText(file);
  };

  const handleCleanupUsers = async () => {
    if (!isOwner) return;
    if (!window.confirm('هل أنت متأكد من حذف كافة المستخدمين التجريبيين؟ سيتم الإبقاء على حسابك وحسابات المسؤولين الموثقة فقط.')) return;
    setIsCleaningUp(true);
    setResult(null);
    try {
      const usersSnap = await getDocs(collection(db, 'users'));
      let deletedCount = 0;
      for (const userDoc of usersSnap.docs) {
        const data = userDoc.data();
        const email = data.email || '';
        
        // Protection: Don't delete main admin or anyone with admin role or current user
        if (isOwnerEmail(email) || data.role === 'admin' || userDoc.id === currentUser?.uid) {
          continue;
        }
        
        await deleteDoc(doc(db, 'users', userDoc.id));
        deletedCount++;
      }
      writeAudit('تنظيف الحسابات التجريبية', 'users', `${deletedCount} حساب`);
      setResult({ success: true, message: `تم تنظيف قاعدة البيانات وحذف ${deletedCount} مستخدم تجريبي بنجاح.` });
      void fetchUserStats(); 
    } catch (e: any) {
      setResult({ success: false, message: `فشل التنظيف: ${e.message}` });
    } finally {
      setIsCleaningUp(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Hidden native file input */}
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileSelect} 
        accept=".csv,.txt,.tsv,.xlsx,.xls" 
        className="hidden" 
      />

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl bg-amber-500/10 border border-amber-200">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-amber-500 text-white shadow-md shadow-amber-200">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-black text-slate-900">لوحة تحكم المسؤول</h1>
              <span className="text-[10px] bg-amber-500 text-white font-bold px-2.5 py-0.5 rounded-full">
                {adminLevel ? ALL_SUPERVISOR_LEVEL_LABELS[adminLevel] : 'مسؤول'} ✓
              </span>
            </div>
            <p className="text-xs text-slate-600 font-medium">
              {isOwner
                ? 'صلاحيات المالك الكاملة وإدارة المشرفين والنظام'
                : 'الأقسام المتاحة حسب صلاحيات الإشراف المعتمدة في قاعدة البيانات'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isOwner && onOpenSupervisors && (
            <button
              type="button"
              onClick={onOpenSupervisors}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 text-amber-300 hover:bg-slate-800 transition-colors text-xs font-black shadow-xs cursor-pointer"
            >
              <Users className="w-3.5 h-3.5" />
              <span>إدارة المشرفين</span>
            </button>
          )}

          {onGlobalRefresh && (
            <button
              onClick={onGlobalRefresh}
              disabled={isRefreshing}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white transition-colors text-xs font-black shadow-xs active:scale-95 disabled:opacity-50 cursor-pointer"
              title="تحديث شامل ومزامنة فورية لكل البيانات وحزم OTA (التحديث يتم تلقائياً دائماً وهذا الزر عامل مساعد)"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>{isRefreshing ? 'جارٍ التحديث الشامل...' : 'تحديث شامل (بيانات + OTA)'}</span>
            </button>
          )}

          <button 
            onClick={() => {
              switchActiveRole('user');
              onBack();
            }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors text-xs font-bold shadow-xs"
          >
            <span>الرجوع لوضع المستخدم</span>
          </button>

          <button 
            onClick={onBack}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 text-white hover:bg-black transition-colors text-xs font-bold"
          >
            <ArrowRight className="w-4 h-4" />
            <span>الرئيسية</span>
          </button>
        </div>
      </div>

      {result && (
        <div className={`p-3 rounded-2xl flex items-center gap-2 text-xs font-bold ${
          result.success ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {result.success ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
          <span>{result.message}</span>
        </div>
      )}

      {showChatManager && canManageSupport && (
        <div className="fixed inset-0 z-50 bg-white lg:bg-black/50 lg:backdrop-blur-sm lg:p-4 flex items-center justify-center animate-in fade-in zoom-in duration-200">
          <div className="w-full h-full lg:max-w-6xl lg:h-[90vh] relative">
            <button 
              onClick={() => setShowChatManager(false)}
              className="absolute top-4 left-4 z-50 p-2 bg-white rounded-full shadow-lg hover:bg-gray-100 transition-colors"
            >
              <X className="w-6 h-6 text-gray-900" />
            </button>
            <AdminChatManager />
          </div>
        </div>
      )}

      {/* Live User Statistics Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {(isOwner || canManageUsersRecovery) && (
          <>
            <div className="p-4 rounded-3xl bg-linear-to-br from-amber-500 to-amber-600 text-white shadow-md shadow-amber-200 flex flex-col items-center justify-center text-center space-y-1">
              <div className="p-2 rounded-2xl bg-white/20 backdrop-blur-xs">
                <Users className="w-5 h-5 text-white" />
              </div>
              <div className="text-xl font-black">{totalUsersCount}</div>
              <div className="text-[10px] font-extrabold text-amber-100">إجمالي مستخدمي التطبيق</div>
            </div>

            <div className="p-4 rounded-3xl bg-linear-to-br from-emerald-500 to-emerald-600 text-white shadow-md shadow-emerald-200 flex flex-col items-center justify-center text-center space-y-1">
              <div className="p-2 rounded-2xl bg-white/20 backdrop-blur-xs">
                <UserPlus className="w-5 h-5 text-white" />
              </div>
              <div className="text-xl font-black">+{todaySignupsCount}</div>
              <div className="text-[10px] font-extrabold text-emerald-100">المنضمين الجدد اليوم</div>
            </div>
          </>
        )}

        {canManageDonors && (
          <div className="p-4 rounded-3xl bg-linear-to-br from-red-600 to-red-700 text-white shadow-md shadow-red-200 flex flex-col items-center justify-center text-center space-y-1">
            <div className="p-2 rounded-2xl bg-white/20 backdrop-blur-xs">
              <Database className="w-5 h-5 text-white" />
            </div>
            <div className="text-xl font-black">{donors.length}</div>
            <div className="text-[10px] font-extrabold text-red-100">إجمالي المتبرعين المسجلين</div>
          </div>
        )}

        {canManageUrgent && (
          <div className="p-4 rounded-3xl bg-linear-to-br from-rose-600 to-rose-700 text-white shadow-md shadow-rose-200 flex flex-col items-center justify-center text-center space-y-1">
            <div className="p-2 rounded-2xl bg-white/20 backdrop-blur-xs">
              <Droplet className="w-5 h-5 text-white" />
            </div>
            <div className="text-xl font-black">{urgentRequests.filter((r) => r.status === 'open').length}</div>
            <div className="text-[10px] font-extrabold text-rose-100">طلبات دم عاجلة مفتوحة</div>
          </div>
        )}

        {isOwner && (
          <div className="p-4 rounded-3xl bg-linear-to-br from-blue-600 to-blue-700 text-white shadow-md shadow-blue-200 flex flex-col items-center justify-center text-center space-y-1">
            <div className="p-2 rounded-2xl bg-white/20 backdrop-blur-xs">
              <ShieldCheck className="w-5 h-5 text-white" />
            </div>
            <div className="text-xl font-black">{supervisorsCount}</div>
            <div className="text-[10px] font-extrabold text-blue-100">المشرفون المفعّلون</div>
          </div>
        )}

        {canManageHospitals && (
          <div className="p-4 rounded-3xl bg-linear-to-br from-slate-800 to-slate-900 text-white shadow-md shadow-slate-200 flex flex-col items-center justify-center text-center space-y-1">
            <div className="p-2 rounded-2xl bg-white/20 backdrop-blur-xs">
              <HospitalIcon className="w-5 h-5 text-white" />
            </div>
            <div className="text-xl font-black">{hospitals.length}</div>
            <div className="text-[10px] font-extrabold text-slate-300">المستشفيات والمراكز</div>
          </div>
        )}
      </div>

      {/* Admin Quick Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {canManageDonors && (
        <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-xs space-y-4">
          <div className="flex items-center gap-2 text-red-600">
            <FileSpreadsheet className="w-5 h-5" />
            <h2 className="text-sm font-black">استيراد بيانات من إكسل / ملفات الهاتف</h2>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            اضغط الزر أدناه لفتح ملفات الهاتف مباشرة واختيار ملف إكسل أو ملف نصي للاستيراد التلقائي.
          </p>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
            className="w-full py-3 px-4 rounded-2xl bg-amber-500 hover:bg-amber-600 text-white font-black text-xs sm:text-sm shadow-md shadow-amber-200 transition-all flex items-center justify-center gap-2 active:scale-98 cursor-pointer"
          >
            <FolderOpen className="w-5 h-5" />
            <span>📁 فتح ملفات الهاتف واختيار الملف تلقائياً</span>
          </button>

          <div className="relative flex items-center justify-center my-1">
            <div className="border-t border-slate-200 w-full"></div>
            <span className="bg-white px-2 text-[10px] text-slate-400 uppercase font-bold">أو لصق نصي يدوي</span>
          </div>

          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder="ألصق النص هنا (الاسم، الفصيلة، الهاتف، العنوان...)"
            className="w-full h-24 p-3 rounded-2xl border border-slate-200 focus:border-red-500 focus:ring-2 focus:ring-red-100 outline-hidden text-xs font-medium"
          />
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              onClick={handleImport}
              disabled={loading || !importText.trim()}
              className="flex-1 py-3 px-3 rounded-xl bg-red-600 hover:bg-red-700 text-white font-black text-xs sm:text-sm shadow-md shadow-red-100 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  <span>بدء الاستيراد النصي</span>
                </>
              )}
            </button>

            <button
              onClick={handleExportExcel}
              disabled={loading}
              className="py-3 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs sm:text-sm shadow-md shadow-emerald-100 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>تصدير السجل إلى Excel</span>
            </button>
          </div>
          
          {result && (
            <div className={`p-3 rounded-xl flex items-center gap-2 text-xs font-bold ${
              result.success ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-red-50 text-red-700 border border-red-100'
            }`}>
              {result.success ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
              <span>{result.message}</span>
            </div>
          )}
        </div>
        )}

        {canManageSettings && (
        <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-900">
              <Megaphone className="w-5 h-5 text-amber-600" />
              <h2 className="text-sm font-black">إرسال رسالة تظهر عند الجميع في الإشعارات</h2>
            </div>
            {announcement && (
              <span className="text-[10px] bg-emerald-100 text-emerald-800 font-extrabold px-2 py-0.5 rounded-full flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-ping"></span>
                <span>نشط حالياً</span>
              </span>
            )}
          </div>
          <p className="text-xs text-slate-600 leading-relaxed font-medium">
            اكتب رسالة أو تعميم لتظهر لجميع المشتركين في نافذة الإشعارات والشريط التنبيهي فوراً:
          </p>
          
          <div className="space-y-3">
            {/* Announcement Category Selector */}
            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-1">نوع الإشعار:</label>
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  onClick={() => setAnnouncementType('general')}
                  className={`py-1.5 px-2 rounded-xl text-center text-xs font-bold border transition-all ${
                    announcementType === 'general'
                      ? 'bg-amber-500 text-white border-amber-500 shadow-2xs'
                      : 'bg-slate-50 text-slate-700 border-slate-200'
                  }`}
                >
                  تنويه عام
                </button>
                <button
                  type="button"
                  onClick={() => setAnnouncementType('urgent')}
                  className={`py-1.5 px-2 rounded-xl text-center text-xs font-bold border transition-all ${
                    announcementType === 'urgent'
                      ? 'bg-red-600 text-white border-red-600 shadow-2xs'
                      : 'bg-slate-50 text-slate-700 border-slate-200'
                  }`}
                >
                  نداء طارئ
                </button>
                <button
                  type="button"
                  onClick={() => setAnnouncementType('campaign')}
                  className={`py-1.5 px-2 rounded-xl text-center text-xs font-bold border transition-all ${
                    announcementType === 'campaign'
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-2xs'
                      : 'bg-slate-50 text-slate-700 border-slate-200'
                  }`}
                >
                  حملة تبرع
                </button>
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase">نص الرسالة المنشورة للجميع:</label>
              <textarea
                value={announcement}
                onChange={(e) => setAnnouncement(e.target.value)}
                placeholder="اكتب التنويه أو الإشعار الذي تريده أن يظهر لجميع المستخدمين فوراً..."
                rows={3}
                className="w-full p-2.5 rounded-xl border border-slate-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-100 outline-hidden text-xs font-medium"
              />
            </div>
            
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleSaveSettings}
                disabled={loading || !announcement.trim()}
                className="flex-1 py-2.5 px-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-extrabold text-xs shadow-md shadow-amber-200 transition-all flex items-center justify-center gap-1.5 active:scale-98 disabled:opacity-50 cursor-pointer"
              >
                <Megaphone className="w-4 h-4" />
                <span>إرسال وتعميم في الإشعارات للجميع</span>
              </button>

              {announcement.trim() && (
                <button
                  type="button"
                  onClick={handleClearAnnouncement}
                  disabled={loading}
                  className="py-2.5 px-3 rounded-xl bg-slate-100 hover:bg-red-50 text-slate-700 hover:text-red-700 border border-slate-200 text-xs font-bold transition-colors cursor-pointer"
                  title="مسح الإشعار الحالي"
                >
                  مسح الإشعار
                </button>
              )}
            </div>

            {/* Comprehensive App Refresh Button in Admin Dashboard */}
            {onGlobalRefresh && (
              <div className="pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={onGlobalRefresh}
                  disabled={isRefreshing}
                  className="w-full py-3 px-3 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-900 font-black text-xs transition-all flex items-center justify-center gap-2 shadow-xs active:scale-98 cursor-pointer"
                >
                  <RefreshCw className={`w-4 h-4 text-emerald-600 ${isRefreshing ? 'animate-spin' : ''}`} />
                  <span>{isRefreshing ? 'جارٍ التحديث الشامل ومزامنة البيانات وتحديثات OTA...' : '🔄 زر التحديث الشامل للتطبيق (مزامنة البيانات + فحص تحديثات OTA)'}</span>
                </button>
                <p className="text-[10px] text-slate-500 font-medium text-center mt-1.5 leading-relaxed">
                  * ملاحظة: يتم تحديث البيانات وتحديثات OTA تلقائياً باستمرار في الخلفية وعند توفر الإنترنت، وهذا الزر عامل مساعد لإجراء المزامنة الفورية الشاملة بضغطة واحدة.
                </p>
              </div>
            )}
          </div>

          {(canManageDonors || isOwner) && (
          <div className="pt-2 border-t border-slate-100">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold text-slate-400">روابط الربط والتحكم</span>
              <span className="text-[9px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-bold">متصل</span>
            </div>
            <div className="space-y-2">
              <a 
                href={`https://docs.google.com/spreadsheets/d/${GOOGLE_SHEETS_CONFIG.spreadsheetId}/edit`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center justify-between p-2.5 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 transition-all shadow-sm active:scale-95"
              >
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4" />
                  <span className="text-xs font-black">فتح جدول بيانات Google Sheets</span>
                </div>
                <ExternalLink className="w-3.5 h-3.5 opacity-80" />
              </a>

              <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 border border-slate-100">
                <code className="text-[9px] text-slate-500 truncate flex-1 font-mono" dir="ltr">
                  {GOOGLE_SHEETS_CONFIG.appsScriptUrl}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(GOOGLE_SHEETS_CONFIG.appsScriptUrl);
                    setResult({ success: true, message: 'تم نسخ رابط Google Apps Script بنجاح.' });
                  }}
                  title="نسخ رابط Apps Script"
                  className="p-1 rounded hover:bg-slate-200 text-slate-500 transition-colors cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <a
                  href={GOOGLE_SHEETS_CONFIG.appsScriptUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="فحص رابط Apps Script"
                  className="p-1 rounded hover:bg-slate-200 text-slate-500 transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          </div>
          )}
        </div>
        )}

        {/* Remote Website URL Card (appConfig/websiteUrl) - Owner Only */}
        {isOwner && (
        <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-xs space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-slate-900">
              <Globe className="w-5 h-5 text-sky-600" />
              <h2 className="text-sm font-black">🌐 موقع بنك الدم – قعطبة (عن بُعد)</h2>
            </div>
            <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
              websiteConfig.source === 'firebase'
                ? 'bg-emerald-100 text-emerald-800'
                : websiteConfig.source === 'cache'
                ? 'bg-amber-100 text-amber-800'
                : 'bg-slate-100 text-slate-700'
            }`}>
              {websiteConfig.source === 'firebase'
                ? 'متزامن مع Firebase ✓'
                : websiteConfig.source === 'cache'
                ? 'نسخة محفوظة محلياً'
                : 'الرابط الافتراضي'}
            </span>
          </div>

          <p className="text-xs text-slate-600 leading-relaxed">
            حدّث رابط الموقع الرسمي من هنا أو من لوحة Firebase في المسار{' '}
            <code className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-800 font-mono text-[10px]" dir="ltr">
              {WEBSITE_CONFIG_PATH}
            </code>{' '}
            ليصل التغيير لجميع المستخدمين تلقائياً دون الحاجة لإصدار APK أو AAB جديد.
          </p>

          <form onSubmit={handleSaveWebsiteUrl} className="space-y-2.5">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-1">
                رابط الموقع الحالي (Field: websiteUrl):
              </label>
              <input
                type="url"
                dir="ltr"
                value={websiteUrlInput}
                onChange={(e) => {
                  setWebsiteUrlInput(e.target.value);
                  setWebsiteInputDirty(true);
                  setWebsiteSaveResult(null);
                }}
                placeholder={DEFAULT_WEBSITE_URL}
                className="w-full p-2.5 rounded-xl border border-slate-200 focus:border-sky-500 focus:ring-2 focus:ring-sky-100 outline-hidden text-xs font-mono font-bold text-left bg-slate-50"
                required
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={isSavingWebsiteUrl}
                className="flex-1 py-2.5 px-3 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-black text-xs shadow-md shadow-sky-100 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                <Globe className="w-4 h-4" />
                <span>{isSavingWebsiteUrl ? 'جارٍ الحفظ في Firebase...' : 'حفظ وتحديث الرابط للجميع'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  const res = openWebsiteInExternalBrowser(websiteUrlInput);
                  if (!res.opened) {
                    setWebsiteSaveResult({
                      success: false,
                      message: res.errorMessage || 'تعذر فتح الرابط للمعاينة.',
                    });
                  }
                }}
                className="py-2.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                title="معاينة الرابط في المتصفح"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>معاينة</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setWebsiteUrlInput(DEFAULT_WEBSITE_URL);
                  setWebsiteInputDirty(true);
                  setWebsiteSaveResult(null);
                }}
                className="py-2.5 px-3 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 font-bold text-xs transition-colors cursor-pointer"
                title="تعبئة الرابط الافتراضي"
              >
                الافتراضي
              </button>
            </div>

            {websiteSaveResult && (
              <div className={`p-2.5 rounded-xl flex items-center gap-2 text-xs font-bold ${
                websiteSaveResult.success
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                  : 'bg-red-50 text-red-700 border border-red-100'
              }`}>
                {websiteSaveResult.success ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
                <span>{websiteSaveResult.message}</span>
              </div>
            )}
          </form>
        </div>
        )}

        {/* Hero Banner Management Card - Settings / Admin */}
        {canManageSettings && (
        <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-xs space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-slate-900">
              <Upload className="w-5 h-5 text-red-600" />
              <h2 className="text-sm font-black">🖼️ إدارة البنر الرئيسي (صورة الواجهة)</h2>
            </div>
            <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-red-100 text-red-800">
              تخزين سحابي فوري ✓
            </span>
          </div>

          <p className="text-xs text-slate-600 leading-relaxed">
            قم بتغيير الصورة الرئيسية للبنر من هنا. يتم حفظ الصورة في سحابة Firebase Firestore دون تعديل أي ملفات في المشروع، ويظهر التحديث فوراً لجميع المستخدمين.
          </p>

          <form onSubmit={handleSaveHeroBanner} className="space-y-3">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-1">
                رابط الصورة أو معاينة البنر:
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="url"
                  dir="ltr"
                  value={bannerUrlInput}
                  onChange={(e) => {
                    setBannerUrlInput(e.target.value);
                    setBannerSaveResult(null);
                  }}
                  placeholder="https://example.com/banner.webp"
                  className="flex-1 p-2.5 rounded-xl border border-slate-200 focus:border-red-500 focus:ring-2 focus:ring-red-100 outline-hidden text-xs font-mono font-bold text-left bg-slate-50"
                />
                <input
                  type="file"
                  ref={bannerFileInputRef}
                  onChange={handleBannerFileSelect}
                  accept="image/*"
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => bannerFileInputRef.current?.click()}
                  className="py-2.5 px-3.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs flex items-center gap-1.5 transition-colors shrink-0 cursor-pointer"
                >
                  <Upload className="w-4 h-4 text-slate-600" />
                  <span>رفع صورة</span>
                </button>
              </div>
            </div>

            {bannerUrlInput && (
              <div className="p-2 rounded-2xl bg-slate-50 border border-slate-200 overflow-hidden">
                <p className="text-[10px] font-bold text-slate-500 mb-1.5 px-1">معاينة البنر الحالي:</p>
                <div className="w-full h-32 rounded-xl overflow-hidden bg-white flex items-center justify-center border border-slate-200">
                  <img
                    src={bannerUrlInput}
                    alt="معاينة البنر"
                    className="w-full h-full object-contain"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={isSavingBanner}
                className="flex-1 py-2.5 px-3 rounded-xl bg-red-600 hover:bg-red-700 text-white font-black text-xs shadow-md shadow-red-100 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                <Upload className="w-4 h-4" />
                <span>{isSavingBanner ? 'جارٍ الحفظ في السحابة...' : 'حفظ وتحديث البنر للجميع'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setBannerUrlInput('');
                  setBannerSaveResult(null);
                }}
                className="py-2.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs transition-colors cursor-pointer"
                title="استعادة البنر الافتراضي"
              >
                استعادة الافتراضي
              </button>
            </div>

            {bannerSaveResult && (
              <div className={`p-2.5 rounded-xl flex items-center gap-2 text-xs font-bold ${
                bannerSaveResult.success
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                  : 'bg-red-50 text-red-700 border border-red-100'
              }`}>
                {bannerSaveResult.success ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
                <span>{bannerSaveResult.message}</span>
              </div>
            )}
          </form>
        </div>
        )}

        {/* Message Center Card */}
        {canManageSupport && (
        <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-xs flex flex-col items-center justify-center gap-4 text-center">
          <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center text-red-600 shadow-inner">
            <MessageSquare className="w-8 h-8" />
          </div>
          <div>
            <h2 className="text-base font-black text-slate-900">مركز الرسائل والدعم</h2>
            <p className="text-xs text-slate-500 mt-1 max-w-[200px]">الرد على استفسارات المستخدمين وحل مشكلاتهم عبر المحادثة المباشرة</p>
          </div>
          <button
            onClick={() => setShowChatManager(true)}
            className="w-full py-3 px-4 rounded-2xl bg-red-600 hover:bg-red-700 text-white font-black text-xs shadow-md shadow-red-100 transition-all flex items-center justify-center gap-2 active:scale-98"
          >
            <MessageSquare className="w-5 h-5" />
            <span>فتح مركز الرسائل</span>
          </button>
        </div>
        )}

        {/* Urgent Requests Management Card */}
        {canManageUrgent && (
        <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-xs space-y-4 sm:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-slate-900">
              <Droplet className="w-5 h-5 text-rose-600" />
              <h2 className="text-sm font-black">إدارة طلبات الدم العاجلة ({urgentRequests.length})</h2>
            </div>
            <div className="flex items-center gap-1.5">
              {(['all', 'open', 'fulfilled'] as const).map((statusKey) => (
                <button
                  key={statusKey}
                  type="button"
                  onClick={() => setUrgentFilter(statusKey)}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-black cursor-pointer transition-colors ${
                    urgentFilter === statusKey
                      ? 'bg-rose-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {statusKey === 'all' ? 'الكل' : statusKey === 'open' ? 'مفتوحة' : 'مكتملة'}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2.5 max-h-[340px] overflow-y-auto pr-1">
            {filteredUrgentRequests.length === 0 ? (
              <div className="p-6 text-center rounded-2xl bg-slate-50 border border-dashed border-slate-200 text-xs text-slate-500">
                لا توجد طلبات دم مطابقة للتصفية الحالية.
              </div>
            ) : (
              filteredUrgentRequests.map((req) => (
                <div
                  key={req.id}
                  className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2 py-0.5 rounded-lg bg-rose-600 text-white text-xs font-black">
                        {req.bloodType}
                      </span>
                      <span className="text-xs font-black text-slate-900">{req.patientName}</span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                          req.status === 'fulfilled'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {req.status === 'fulfilled' ? 'مكتمل ✓' : 'مفتوح'}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-600 flex flex-wrap items-center gap-3">
                      <span>المستشفى: {req.hospital}</span>
                      <span className="font-mono" dir="ltr">{req.contactPhone}</span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-slate-400" />
                        {req.unitsNeeded} وحدة
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={busyUrgentId === req.id}
                      onClick={async () => {
                        const nextStatus = req.status === 'fulfilled' ? 'open' : 'fulfilled';
                        setBusyUrgentId(req.id);
                        try {
                          await updateRequestStatus(req.id, nextStatus);
                          writeAudit(
                            nextStatus === 'fulfilled' ? 'إغلاق طلب دم عاجل' : 'إعادة فتح طلب دم عاجل',
                            req.id,
                            req.patientName,
                            `الفصيلة: ${req.bloodType} | المستشفى: ${req.hospital}`
                          );
                          setResult({
                            success: true,
                            message:
                              nextStatus === 'fulfilled'
                                ? `تم تحديث حالة طلب (${req.patientName}) إلى مكتمل.`
                                : `تمت إعادة فتح طلب (${req.patientName}).`,
                          });
                        } catch (err: any) {
                          setResult({ success: false, message: err?.message || 'تعذر تحديث الطلب.' });
                        } finally {
                          setBusyUrgentId(null);
                        }
                      }}
                      className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-black transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      {req.status === 'fulfilled' ? 'إعادة فتح' : 'تم توفير الدم'}
                    </button>

                    <button
                      type="button"
                      disabled={busyUrgentId === req.id}
                      onClick={async () => {
                        if (!window.confirm(`هل تريد حذف طلب (${req.patientName}) نهائياً؟`)) return;
                        setBusyUrgentId(req.id);
                        try {
                          await deleteUrgentRequest(req.id);
                          writeAudit('حذف طلب دم عاجل', req.id, req.patientName, `الفصيلة: ${req.bloodType}`);
                          setResult({ success: true, message: `تم حذف طلب (${req.patientName}) بنجاح.` });
                        } catch (err: any) {
                          setResult({ success: false, message: err?.message || 'تعذر حذف الطلب.' });
                        } finally {
                          setBusyUrgentId(null);
                        }
                      }}
                      className="p-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 disabled:opacity-50 cursor-pointer"
                      title="حذف الطلب"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
        )}

        {/* Cleanup & Supervisor Management Card - Owner Only */}
        {isOwner && (
        <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-xs space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-slate-900">
              <ShieldCheck className="w-5 h-5 text-blue-600" />
              <h2 className="text-sm font-black">إدارة النظام والمشرفين</h2>
            </div>
            <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-slate-900 text-amber-300">
              المالك فقط
            </span>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            يمكنك إضافة أو تعديل أو تعطيل المشرفين ومراجعة سجل العمليات الإدارية، أو تنظيف الحسابات التجريبية.
          </p>

          {onOpenSupervisors && (
            <button
              type="button"
              onClick={onOpenSupervisors}
              className="w-full py-3 px-4 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs shadow-md transition-all flex items-center justify-center gap-2 active:scale-98 cursor-pointer"
            >
              <Users className="w-4 h-4" />
              <span>إدارة المشرفين وصلاحياتهم ({supervisorsCount})</span>
            </button>
          )}

          <button
            onClick={handleCleanupUsers}
            disabled={isCleaningUp}
            className="w-full py-3 px-4 rounded-2xl bg-slate-900 hover:bg-black text-white font-black text-xs shadow-md transition-all flex items-center justify-center gap-2 active:scale-98 disabled:opacity-50"
          >
            {isCleaningUp ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4 text-red-400" />
            )}
            <span>حذف كافة المستخدمين التجريبيين (تنظيف)</span>
          </button>

          <div className="pt-3 border-t border-slate-100">
             <h3 className="text-[10px] font-black text-slate-400 mb-2 uppercase">حسابات الإدارة ({adminsCount}):</h3>
             <div className="space-y-1.5 max-h-[120px] overflow-y-auto pr-1">
               {adminsList.map(admin => (
                 <div key={admin.id} className="flex items-center justify-between p-2 rounded-lg bg-blue-50/50 border border-blue-100/50">
                    <div className="flex flex-col">
                      <span className="text-[11px] font-bold text-slate-800">{admin.displayName || admin.fullName || 'بدون اسم'}</span>
                      <span className="text-[9px] text-slate-500 font-mono truncate max-w-[120px]">{admin.email || admin.phone || admin.id}</span>
                    </div>
                    <span className="text-[8px] bg-blue-600 text-white px-1.5 py-0.5 rounded-full font-bold">
                      {isOwnerEmail(admin.email) ? 'المالك' : 'مشرف'}
                    </span>
                 </div>
               ))}
             </div>
          </div>
        </div>
        )}

        {/* Users Management Card */}
        {canManageUsersRecovery && (
        <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-900">
              <Users className="w-5 h-5 text-indigo-600" />
              <h2 className="text-sm font-black">إدارة مستخدمي التطبيق</h2>
            </div>
            <button 
              onClick={() => setShowUsersSection(!showUsersSection)}
              className="text-[10px] font-bold text-indigo-600 hover:underline"
            >
              {showUsersSection ? 'إخفاء القائمة' : 'عرض كافة المستخدمين'}
            </button>
          </div>
          <p className="text-xs text-slate-500 leading-relaxed font-medium">عرض أسماء وبيانات المسجلين في التطبيق (يُستثنى المالك والمشرفون من الحذف).</p>
          
          {showUsersSection && (
            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1 pt-2 border-t border-slate-50">
              {allUsersList.map(u => {
                const targetUid = u.uid || u.id;
                const isProtected =
                  isOwnerEmail(u.email) || u.role === 'admin' || targetUid === currentUser?.uid;
                return (
                <div key={targetUid} className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between gap-2">
                  <div className="flex flex-col">
                    <span className="text-xs font-black text-slate-900">{u.displayName || u.fullName || 'مستخدم غير معروف'}</span>
                    <span className="text-[10px] text-slate-500 font-mono">{u.phone || u.email || 'بدون هاتف'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {(isOwnerEmail(u.email) || u.role === 'admin') && (
                      <span className="text-[8px] bg-amber-500 text-white px-1.5 py-0.5 rounded-full font-bold">
                        {isOwnerEmail(u.email) ? 'المالك' : 'مشرف'}
                      </span>
                    )}
                    {!isProtected && (
                      <button type="button" onClick={() => handleDeleteAppUser(targetUid)} disabled={deletingUserId === targetUid}
                        className="p-1.5 rounded-lg bg-red-50 text-red-600 disabled:opacity-40" title="حذف الحساب">
                        {deletingUserId === targetUid ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                    )}
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </div>
        )}

        {/* Account Recovery Requests & Direct Recovery Code Issuance */}
        {canManageUsersRecovery && (
        <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-900">
              <KeyRound className="w-5 h-5 text-rose-600" />
              <h2 className="text-sm font-black">استعادة كلمات المرور ({recoveryRequests.length})</h2>
            </div>
            <button
              type="button"
              onClick={refreshRecoveryRequests}
              className="text-xs font-bold text-indigo-600 hover:underline flex items-center gap-1"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>تحديث</span>
            </button>
          </div>
          <p className="text-[11px] text-slate-600 leading-relaxed">
            <strong>من أين تحصل على الرمز؟</strong> يقوم التطبيق بتوليد رمز المكوّن من 6 أرقام تلقائياً هنا في لوحة المسؤول فور ضغطك على «اعتماد وإصدار رمز» أو «توليد رمز استعادة»، ليظهر لك مباشرةً مع زر نسخه وإرساله للمستخدم عبر واتساب.
          </p>

          {/* Direct Issue by Phone Form */}
          <form onSubmit={handleIssueDirectRecovery} className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-2.5">
            <div className="text-xs font-black text-slate-800 flex items-center gap-1.5">
              <Phone className="w-3.5 h-3.5 text-rose-600" />
              <span>إصدار رمز استعادة فوري برقم الهاتف</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                type="tel"
                dir="ltr"
                value={directRecoveryPhone}
                onChange={(e) => setDirectRecoveryPhone(e.target.value)}
                placeholder="رقم هاتف المستخدم (مثال: 773633918)"
                className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs font-bold text-right outline-hidden focus:ring-2 focus:ring-rose-500"
                required
              />
              <input
                type="text"
                value={directRecoveryName}
                onChange={(e) => setDirectRecoveryName(e.target.value)}
                placeholder="اسم المستخدم (اختياري)"
                className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs font-bold outline-hidden focus:ring-2 focus:ring-rose-500"
              />
            </div>
            <button
              type="submit"
              disabled={issuingDirectRecovery || !directRecoveryPhone.trim()}
              className="w-full py-2.5 px-3 rounded-xl bg-slate-900 hover:bg-black text-white text-xs font-black transition-all disabled:opacity-50 cursor-pointer"
            >
              {issuingDirectRecovery ? 'جارٍ توليد الرمز...' : 'توليد رمز استعادة من 6 أرقام الآن'}
            </button>
          </form>

          {/* Issued Code Banner with Copy + WhatsApp One-Tap Send */}
          {issuedRecoveryCode && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-black text-emerald-950">
                  رمز الاستعادة لـ {issuedRecoveryCode.fullName}
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  issuedRecoveryCode.matchedExistingAccount
                    ? 'bg-emerald-200 text-emerald-900'
                    : 'bg-amber-100 text-amber-800'
                }`}>
                  {issuedRecoveryCode.matchedExistingAccount ? 'تم ربطه بالحساب السابق' : 'تفعيل/تعيين للرقم'}
                </span>
              </div>
              <div className="text-[11px] font-bold text-emerald-800" dir="ltr">
                {issuedRecoveryCode.phone}
              </div>
              <div className="text-3xl font-black tracking-[0.35em] text-center text-emerald-950 bg-white/80 py-2 rounded-xl border border-emerald-100 select-all" dir="ltr">
                {issuedRecoveryCode.code}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(issuedRecoveryCode.code);
                    setCopiedRecoveryCode(true);
                  }}
                  className="py-2.5 px-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-black flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>{copiedRecoveryCode ? 'تم نسخ الرمز ✓' : 'نسخ الرمز'}</span>
                </button>
                <a
                  href={`https://wa.me/${toWhatsAppNumber(issuedRecoveryCode.phone)}?text=${encodeURIComponent(
                    `مرحباً ${issuedRecoveryCode.fullName}، تم التحقق من حسابك في تطبيق بنك الدم قعطبة.\nرمز استعادة كلمة المرور الخاص بك هو: *${issuedRecoveryCode.code}*\nافتح شاشة "نسيت كلمة المرور؟" وأدخل رقم هاتفك (${issuedRecoveryCode.phone}) وهذا الرمز لتعيين كلمة مرور جديدة.`
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="py-2.5 px-3 rounded-xl bg-green-600 hover:bg-green-700 text-white text-xs font-black flex items-center justify-center gap-1.5"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  <span>إرسال عبر واتساب</span>
                </a>
              </div>
              <p className="text-[10px] text-emerald-800">
                لا يظهر هذا الرمز السري مرة أخرى بعد إغلاق أو تحديث الصفحة؛ أرسله الآن لصاحب الحساب.
              </p>
            </div>
          )}

          {/* Requests List */}
          {recoveryRequests.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-2">لا توجد طلبات استعادة مسجلة حالياً.</p>
          ) : (
            <div className="space-y-2.5 max-h-[360px] overflow-y-auto pr-1">
              {recoveryRequests.map(item => {
                const statusInfo =
                  item.status === 'pending'
                    ? { label: 'بانتظار الموافقة', cls: 'bg-amber-100 text-amber-800' }
                    : item.status === 'approved'
                    ? { label: 'تم إصدار الرمز', cls: 'bg-blue-100 text-blue-800' }
                    : item.status === 'used'
                    ? { label: 'تم التعيين بنجاح', cls: 'bg-emerald-100 text-emerald-800' }
                    : { label: 'ملغي', cls: 'bg-rose-100 text-rose-800' };

                return (
                  <div key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-xs font-black text-slate-900">{item.fullName}</div>
                        <div className="text-xs font-mono font-bold text-slate-700 select-all" dir="ltr">
                          {item.phone || `...${item.phoneLast4}`}
                        </div>
                      </div>
                      <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${statusInfo.cls}`}>
                        {statusInfo.label}
                      </span>
                    </div>

                    {item.note && (
                      <div className="text-[11px] text-slate-600 bg-white px-2.5 py-1.5 rounded-lg border border-slate-100">
                        {item.note}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
                      <span>{item.matchedUid ? '✓ حساب مسجل مرتبط' : 'التحقق بالرقم'}</span>
                      <span>·</span>
                      <span className="font-mono">{item.id}</span>
                    </div>

                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {(item.status === 'pending' || item.status === 'approved') && (
                        <button
                          type="button"
                          disabled={approvingRecoveryId === item.id}
                          onClick={() => handleApproveRecovery(item.id)}
                          className="flex-1 py-2 px-2.5 rounded-xl bg-slate-900 hover:bg-black text-white text-[11px] font-black disabled:opacity-50 cursor-pointer"
                        >
                          {approvingRecoveryId === item.id
                            ? 'جارٍ الإصدار...'
                            : item.status === 'approved'
                            ? 'إصدار رمز جديد'
                            : 'اعتماد وإصدار رمز'}
                        </button>
                      )}

                      {item.status === 'approved' && (
                        <button
                          type="button"
                          disabled={revokingRecoveryId === item.id}
                          onClick={() => handleRevokeRecovery(item.id)}
                          className="py-2 px-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-black disabled:opacity-50 cursor-pointer"
                        >
                          {revokingRecoveryId === item.id ? 'جارٍ الإلغاء...' : 'إلغاء الرمز'}
                        </button>
                      )}

                      {item.phone && (
                        <a
                          href={`https://wa.me/${toWhatsAppNumber(item.phone)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="py-2 px-2.5 rounded-xl bg-green-600 hover:bg-green-700 text-white text-[11px] font-black flex items-center gap-1"
                        >
                          <MessageCircle className="w-3 h-3" />
                          <span>واتساب</span>
                        </a>
                      )}

                      <button
                        type="button"
                        disabled={deletingRecoveryId === item.id}
                        onClick={() => handleDeleteRecoveryRequest(item.id)}
                        className="p-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 disabled:opacity-40 cursor-pointer"
                        title="حذف السجل"
                      >
                        {deletingRecoveryId === item.id ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        )}

        {/* Locations Management Card */}
        {canManageLocations && (
        <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-900">
              <MapPin className="w-5 h-5 text-rose-600" />
              <h2 className="text-sm font-black">إدارة المناطق السكنية</h2>
            </div>
            <button 
              onClick={() => setShowLocationsSection(!showLocationsSection)}
              className="text-[10px] font-bold text-rose-600 hover:underline"
            >
              {showLocationsSection ? 'إخفاء المناطق' : 'إدارة قائمة المناطق'}
            </button>
          </div>
          <p className="text-xs text-slate-500 leading-relaxed font-medium">تعديل أو حذف المناطق التي تظهر للمتبرعين عند التسجيل.</p>

          {showLocationsSection && (
            <div className="space-y-4 pt-2 border-t border-slate-50">
              <div className="flex gap-2">
                <input 
                  type="text"
                  value={locationNameInput}
                  onChange={(e) => setLocationLocationNameInput(e.target.value)}
                  placeholder="إضافة منطقة جديدة..."
                  className="flex-1 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold outline-hidden focus:ring-2 focus:ring-rose-500"
                />
                <button 
                  onClick={async () => {
                    if (!locationNameInput.trim()) return;
                    const trimmedLoc = locationNameInput.trim();
                    await saveLocation(trimmedLoc, editingLocationId || undefined);
                    writeAudit(
                      editingLocationId ? 'تعديل منطقة سكنية' : 'إضافة منطقة سكنية',
                      editingLocationId || undefined,
                      trimmedLoc
                    );
                    setLocationLocationNameInput('');
                    setEditingLocationId(null);
                    setResult({ success: true, message: 'تم حفظ المنطقة بنجاح! ✓' });
                  }}
                  className="px-4 py-2 bg-rose-600 text-white rounded-xl text-xs font-black shadow-md shadow-rose-100"
                >
                  {editingLocationId ? 'تعديل' : 'إضافة'}
                </button>
              </div>

              <div className="grid grid-cols-1 gap-2 max-h-[250px] overflow-y-auto pr-1">
                {locations.map(loc => (
                  <div key={loc.id} className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800">{loc.name}</span>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => {
                          setEditingLocationId(loc.id);
                          setLocationLocationNameInput(loc.name);
                        }}
                        className="p-1.5 text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button 
                        onClick={async () => {
                          if (window.confirm(`هل أنت متأكد من حذف منطقة "${loc.name}"؟`)) {
                            await deleteLocation(loc.id);
                            writeAudit('حذف منطقة سكنية', loc.id, loc.name);
                            setResult({ success: true, message: 'تم حذف المنطقة بنجاح.' });
                          }
                        }}
                        className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        )}
      </div>

      {/* System Stats & Detailed Management */}
      {canManageDonors && (
      <div className="space-y-4">
        <h2 className="text-sm font-black text-slate-900 flex items-center gap-2">
          <Database className="w-4 h-4 text-red-600" />
          <span>إدارة بيانات المجتمع</span>
        </h2>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-4 sm:p-5 rounded-3xl bg-white border border-slate-200 shadow-xs flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-base sm:text-lg font-black text-slate-900">سجل المتبرعين (تعديل وحذف)</div>
                <p className="text-[11px] text-slate-500 font-medium">التحكم المباشر في بيانات المتبرعين، التعديل أو الحذف الفوري</p>
              </div>
              <button 
                type="button"
                onClick={() => setShowDonorsSection(prev => !prev)}
                className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-black shadow-xs transition-all"
              >
                {showDonorsSection ? 'إخفاء القائمة' : 'عرض السجل للتحكم'}
              </button>
            </div>

            <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100">
              <span className="text-slate-500 font-bold">إجمالي المتبرعين المسجلين:</span>
              <span className="bg-red-50 text-red-700 font-black px-2 py-0.5 rounded-full border border-red-200">
                {donors.length} متبرع
              </span>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-lg font-black text-slate-900">مزامنة الأرشيف</div>
                <p className="text-[10px] text-slate-500">جلب أحدث البيانات من Google Sheets</p>
              </div>
              <button 
                onClick={async () => {
                  setLoading(true);
                  setResult(null);
                  try {
                    const data = await fetchDonorsFromGoogleSheets();
                    if (data.success) {
                      if (onGlobalRefresh) {
                        await onGlobalRefresh();
                      }
                      writeAudit('مزامنة من Google Sheets', undefined, `${data.count || 0} سجل`);
                      setResult({ success: true, message: `تم مزامنة ${data.count || 0} اسماً من الأرشيف (Sheets ➔ App) بنجاح!` });
                    } else {
                      setResult({ success: false, message: data.error || 'فشل المزامنة' });
                    }
                  } catch (e: any) {
                    setResult({ success: false, message: e?.message || 'خطأ في الاتصال بالخادم' });
                  } finally {
                    setLoading(false);
                  }
                }}
                disabled={loading}
                className="px-4 py-2 rounded-xl bg-emerald-50 text-emerald-700 text-xs font-bold hover:bg-emerald-100 border border-emerald-100 transition-all flex items-center gap-1.5 disabled:opacity-50"
              >
                <Database className="w-3.5 h-3.5" />
                <span>مزامنة (من الجدول للتطبيق)</span>
              </button>
            </div>
            
            <div className="flex flex-col gap-3 p-4 rounded-2xl bg-rose-50 border border-rose-100 shadow-xs">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center">
                  <Upload className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-base font-black text-rose-900">مزامنة التطبيق ➔ جدول غوغل</div>
                  <p className="text-[11px] text-rose-600 font-medium">تحديث جدول البيانات بكافة متبرعي التطبيق دفعة واحدة</p>
                </div>
              </div>
              <button 
                onClick={async () => {
                  setLoading(true);
                  setResult(null);
                  try {
                    const snap = await getDocs(collection(db, 'donors'));
                    const donors = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    
                    if (donors.length === 0) {
                      setResult({ success: false, message: 'لا توجد بيانات متبرعين في التطبيق لمزامنتها حالياً' });
                      setLoading(false);
                      return;
                    }

                    const res = await pushAllDonorsToSheets(donors);
                    if (res.success) {
                      writeAudit('تحديث جدول Google Sheets', undefined, `${res.count} متبرع`);
                      setResult({ success: true, message: `تم تحديث جدول البيانات بـ ${res.count} متبرع من التطبيق بنجاح! ✓` });
                    } else {
                      setResult({ success: false, message: res.error || 'فشل تحديث جدول البيانات. تأكد من صلاحية Anyone في Apps Script.' });
                    }
                  } catch (err: any) {
                    setResult({ success: false, message: `خطأ أثناء المزامنة: ${err.message}` });
                  } finally {
                    setLoading(false);
                  }
                }}
                disabled={loading}
                className="w-full py-3.5 rounded-xl bg-rose-600 text-white font-black text-sm hover:bg-rose-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50 shadow-md shadow-rose-200 active:scale-98"
              >
                {loading ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  <>
                    <Database className="w-4 h-4" />
                    <span>بدء المزامنة الشاملة للجدول</span>
                  </>
                )}
              </button>
            </div>

          </div>
        </div>
      </div>
      )}

      {/* Interactive Donors Management Panel (Edit & Delete any donor) */}
      {canManageDonors && showDonorsSection && (
        <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-red-50 text-red-600">
                <Database className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-black text-slate-900">إدارة وتعديل وحذف أي متبرع</h3>
                <p className="text-[11px] text-slate-500 font-medium">
                  بصفتك مسؤول التطبيق، يمكنك إضافة، تعديل أو حذف أي متبرع نهائياً
                </p>
              </div>

              <button 
                onClick={() => onEditDonor?.('')}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-black shadow-md shadow-red-200 transition-all flex items-center gap-2 active:scale-95"
              >
                <Plus className="w-4 h-4" />
                <span>إضافة متبرع جديد</span>
              </button>
            </div>

            <div className="flex items-center gap-2 text-xs font-bold text-slate-600">
              <span className="bg-slate-100 px-3 py-1 rounded-full">
                {filteredDonors.length} من أصل {donors.length} متبرع
              </span>
            </div>
          </div>

          {/* Search & Blood Filter */}
          <div className="space-y-3">
            <div className="relative">
              <input
                type="text"
                value={adminSearchQuery}
                onChange={(e) => setAdminSearchQuery(e.target.value)}
                placeholder="ابحث بالاسم، السكن، أو رقم الهاتف..."
                className="w-full pl-3 pr-10 py-2.5 rounded-xl border border-slate-200 text-xs font-medium focus:border-red-500 focus:ring-2 focus:ring-red-100 outline-hidden"
              />
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-3" />
              {adminSearchQuery && (
                <button
                  onClick={() => setAdminSearchQuery('')}
                  className="absolute left-3 top-2.5 text-[10px] text-slate-400 hover:text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded"
                >
                  مسح
                </button>
              )}
            </div>

            {/* Blood Type Filter Pills */}
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setAdminBloodFilter('ALL')}
                className={`py-1 px-2.5 rounded-lg text-xs font-bold transition-all ${
                  adminBloodFilter === 'ALL'
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                الكل ({donors.length})
              </button>
              {BLOOD_TYPES.map((bt) => (
                <button
                  key={bt}
                  type="button"
                  onClick={() => setAdminBloodFilter(bt)}
                  className={`py-1 px-2.5 rounded-lg text-xs font-black transition-all ${
                    adminBloodFilter === bt
                      ? 'bg-red-600 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-700 hover:bg-red-50'
                  }`}
                >
                  {bt}
                </button>
              ))}
            </div>
          </div>

          {/* Donors Cards List */}
          <div className="space-y-2.5 max-h-[460px] overflow-y-auto pr-1">
            {filteredDonors.length > 0 ? (
              filteredDonors.map((donor) => (
                <div
                  key={donor.id}
                  className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 hover:border-slate-300 transition-all flex flex-wrap items-center justify-between gap-3 text-right"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-red-600 text-white font-black flex items-center justify-center text-sm shrink-0 shadow-sm shadow-red-200">
                      {donor.bloodType}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs sm:text-sm font-extrabold text-slate-900">
                          {donor.fullName}
                        </span>
                        {donor.isAvailable ? (
                          <span className="text-[9px] bg-emerald-100 text-emerald-800 font-bold px-1.5 py-0.5 rounded-full">
                            متاح
                          </span>
                        ) : (
                          <span className="text-[9px] bg-slate-200 text-slate-600 font-medium px-1.5 py-0.5 rounded-full">
                            غير متاح
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-slate-500 mt-0.5">
                        <span className="flex items-center gap-1 font-mono font-bold">
                          <Phone className="w-3 h-3 text-slate-400" />
                          {donor.phone}
                        </span>
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3 text-red-500" />
                          {donor.residence}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Actions: Edit & Delete */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onEditDonor?.(donor.id)}
                      className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-black shadow-xs transition-all flex items-center gap-1.5 active:scale-95"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>تعديل</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setAdminDonorToDelete(donor)}
                      className="px-3 py-1.5 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 text-xs font-black transition-all flex items-center gap-1.5 active:scale-95"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-red-600" />
                      <span>حذف</span>
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="p-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-slate-500 text-xs">
                لا يوجد متبرعون يطابقون معايير البحث الحالية
              </div>
            )}
          </div>
        </div>
      )}

      {/* Hospital Management Section */}
      {canManageHospitals && (
      <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2 text-slate-900">
            <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600">
              <HospitalIcon className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-black">إدارة دليل المستشفيات</h3>
              <p className="text-[11px] text-slate-500 font-medium">إضافة وتعديل بيانات المستشفيات والمختبرات في الدليل</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {hospitals.length === 0 && (
              <button 
                onClick={async () => {
                  setLoading(true);
                  setResult(null);
                  try {
                    await seedHospitals();
                    writeAudit('تهيئة دليل المستشفيات');
                    setResult({ success: true, message: 'تم إدراج البيانات الأولية للمستشفيات بنجاح! ✓' });
                  } catch (err: any) {
                    console.error('Seed hospitals error:', err);
                    setResult({ success: false, message: 'فشل تحميل البيانات الافتراضية. تأكد من صلاحيات المسؤول.' });
                  } finally {
                    setLoading(false);
                  }
                }}
                className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-black transition-all"
              >
                تحميل البيانات الافتراضية
              </button>
            )}
            <button 
              onClick={() => {
                setEditingHospital(null);
                setHospitalForm({ name: '', type: '', address: '', phone: '', services: '' });
                setIsHospitalFormOpen(true);
              }}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black shadow-md shadow-emerald-200 transition-all flex items-center gap-2 active:scale-95"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة مستشفى جديد</span>
            </button>
            <button 
              type="button"
              onClick={() => setShowHospitalsSection(prev => !prev)}
              className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-black shadow-xs transition-all"
            >
              {showHospitalsSection ? 'إخفاء الدليل' : 'عرض الدليل للتحكم'}
            </button>
          </div>
        </div>

        {showHospitalsSection && (
          <div className="space-y-2.5 max-h-[460px] overflow-y-auto pr-1">
            {hospitals.length > 0 ? (
              hospitals.map((h) => (
                <div
                  key={h.id}
                  className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 hover:border-slate-300 transition-all flex flex-wrap items-center justify-between gap-3 text-right"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white font-black flex items-center justify-center text-sm shrink-0 shadow-sm shadow-emerald-200">
                      <HospitalIcon className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-xs sm:text-sm font-extrabold text-slate-900">{h.name}</h4>
                      <div className="flex items-center gap-3 text-[11px] text-slate-500 mt-0.5">
                        <span className="bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded font-bold">{h.type}</span>
                        <span className="flex items-center gap-1">
                          <Phone className="w-3 h-3 text-slate-400" />
                          {h.phone}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setEditingHospital(h);
                        setHospitalForm({
                          name: h.name,
                          type: h.type,
                          address: h.address,
                          phone: h.phone,
                          services: h.services
                        });
                        setIsHospitalFormOpen(true);
                      }}
                      className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-black shadow-xs transition-all flex items-center gap-1.5 active:scale-95"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>تعديل</span>
                    </button>
                    <button
                      onClick={async () => {
                        if (window.confirm(`هل أنت متأكد من حذف ${h.name} من الدليل؟`)) {
                          await deleteHospital(h.id);
                          writeAudit('حذف مرفق طبي', h.id, h.name);
                          setResult({ success: true, message: 'تم حذف المستشفى بنجاح' });
                        }
                      }}
                      className="px-3 py-1.5 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 text-xs font-black transition-all flex items-center gap-1.5 active:scale-95"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>حذف</span>
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="p-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-slate-500 text-xs">
                دليل المستشفيات فارغ حالياً. يمكنك إضافة مستشفيات يدوياً أو تحميل البيانات الافتراضية.
              </div>
            )}
          </div>
        )}
      </div>
      )}

      {/* Hospital Form Modal */}
      {isHospitalFormOpen && canManageHospitals && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 text-right">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-150 overflow-y-auto max-h-[90vh]">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-lg font-black text-slate-900">
                {editingHospital ? 'تعديل بيانات مستشفى' : 'إضافة مستشفى جديد'}
              </h3>
              <button onClick={() => setIsHospitalFormOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-6 h-6" />
              </button>
            </div>

            <form 
              onSubmit={async (e) => {
                e.preventDefault();
                setHospitalLoading(true);
                setResult(null);
                try {
                  await saveHospital(hospitalForm, editingHospital?.id);
                  writeAudit(
                    editingHospital ? 'تعديل مرفق طبي' : 'إضافة مرفق طبي',
                    editingHospital?.id,
                    hospitalForm.name
                  );
                  setResult({ success: true, message: editingHospital ? 'تم تحديث بيانات المستشفى بنجاح! ✓' : 'تم إضافة المستشفى الجديد بنجاح! ✓' });
                  setIsHospitalFormOpen(false);
                } catch (err: any) {
                  console.error('Hospital save error:', err);
                  setResult({ 
                    success: false, 
                    message: `فشل حفظ البيانات: ${err.message?.includes('Permission denied') ? 'عذراً، لا تمتلك صلاحيات كافية للقيام بهذا الإجراء.' : 'حدث خطأ تقني أثناء الحفظ.'}` 
                  });
                } finally {
                  setHospitalLoading(false);
                }
              }}
              className="space-y-3"
            >
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">اسم المستشفى / المختبر:</label>
                <input 
                  type="text" 
                  value={hospitalForm.name}
                  onChange={(e) => setHospitalForm({...hospitalForm, name: e.target.value})}
                  className="w-full p-2.5 rounded-xl border border-slate-200 text-xs font-bold focus:ring-2 focus:ring-emerald-500 outline-hidden"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">النوع (حكومي، خاص، مختبر...):</label>
                <input 
                  type="text" 
                  value={hospitalForm.type}
                  onChange={(e) => setHospitalForm({...hospitalForm, type: e.target.value})}
                  className="w-full p-2.5 rounded-xl border border-slate-200 text-xs font-bold focus:ring-2 focus:ring-emerald-500 outline-hidden"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">العنوان / الموقع:</label>
                <input 
                  type="text" 
                  value={hospitalForm.address}
                  onChange={(e) => setHospitalForm({...hospitalForm, address: e.target.value})}
                  className="w-full p-2.5 rounded-xl border border-slate-200 text-xs font-bold focus:ring-2 focus:ring-emerald-500 outline-hidden"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">رقم الهاتف:</label>
                <input 
                  type="text" 
                  value={hospitalForm.phone}
                  onChange={(e) => setHospitalForm({...hospitalForm, phone: e.target.value})}
                  className="w-full p-2.5 rounded-xl border border-slate-200 text-xs font-bold focus:ring-2 focus:ring-emerald-500 outline-hidden font-mono"
                  dir="ltr"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">الخدمات المتوفرة:</label>
                <textarea 
                  value={hospitalForm.services}
                  onChange={(e) => setHospitalForm({...hospitalForm, services: e.target.value})}
                  className="w-full p-2.5 rounded-xl border border-slate-200 text-xs font-bold focus:ring-2 focus:ring-emerald-500 outline-hidden"
                  rows={3}
                />
              </div>

              <button
                type="submit"
                disabled={hospitalLoading}
                className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs shadow-md transition-all flex items-center justify-center gap-2"
              >
                {hospitalLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                <span>{editingHospital ? 'تحديث البيانات' : 'إضافة إلى الدليل'}</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Admin Delete Confirmation Modal */}
      {adminDonorToDelete && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 text-right">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-150">
            <div className="w-14 h-14 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center mx-auto shadow-inner">
              <Trash2 className="w-7 h-7" />
            </div>
            
            <div className="text-center space-y-1.5">
              <h3 className="text-base font-black text-slate-900">تأكيد حذف المتبرع كمسؤول</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                هل أنت متأكد من حذف بيانات المتبرع <span className="font-black text-red-600 underline underline-offset-2">{adminDonorToDelete.fullName}</span> (فصيلة {adminDonorToDelete.bloodType}) من السجل نهائياً؟
              </p>
              <p className="text-[11px] text-slate-400 font-medium">
                سيتم حذف المتبرع فوراً واستبعاده من كافة الشاشات وقواعد البيانات.
              </p>
            </div>

            {adminDeleteError && (
              <div className="p-2.5 rounded-xl bg-red-50 text-red-700 text-xs font-bold text-center border border-red-200 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
                <span>{adminDeleteError}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                type="button"
                onClick={async () => {
                  if (!adminDonorToDelete || !onDeleteDonor) return;
                  setAdminIsDeleting(true);
                  setAdminDeleteError(null);
                    try {
                      await onDeleteDonor(adminDonorToDelete.id, adminDonorToDelete.phone);
                      writeAudit('حذف متبرع', adminDonorToDelete.id, adminDonorToDelete.fullName, `الفصيلة: ${adminDonorToDelete.bloodType}`);
                      setResult({ success: true, message: `تم حذف بيانات المتبرع (${adminDonorToDelete.fullName}) بنجاح! ✓` });
                      setAdminDonorToDelete(null);
                    } catch (err: any) {
                    setAdminDeleteError(err.message || 'حدث خطأ أثناء محاولة الحذف');
                  } finally {
                    setAdminIsDeleting(false);
                  }
                }}
                disabled={adminIsDeleting}
                className="py-2.5 px-3 rounded-xl bg-red-600 hover:bg-red-700 text-white font-black text-xs shadow-md shadow-red-200 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {adminIsDeleting ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    <span>تأكيد الحذف</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setAdminDonorToDelete(null);
                  setAdminDeleteError(null);
                }}
                disabled={adminIsDeleting}
                className="py-2.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition-colors"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stats Summary */}
      {canManageDonors && (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'إجمالي المتبرعين', value: donors.length.toString(), icon: Database, color: 'blue' },
          { label: 'متاحين للتبرع', value: donors.filter(d => d.isAvailable).length.toString(), icon: CheckCircle2, color: 'emerald' },
          { label: 'متبرعين بدم إيجابي', value: donors.filter(d => d.bloodType.includes('+')).length.toString(), icon: ShieldCheck, color: 'rose' },
          { label: 'متبرعين بدم سلبي', value: donors.filter(d => d.bloodType.includes('-')).length.toString(), icon: Search, color: 'amber' },
        ].map((stat, idx) => (
          <div key={idx} className="p-4 rounded-3xl bg-white border border-slate-100 shadow-xs flex flex-col items-center justify-center text-center space-y-1">
            <stat.icon className={`w-5 h-5 text-${stat.color}-500 mb-1`} />
            <div className="text-lg font-black text-slate-900">{stat.value}</div>
            <div className="text-[10px] font-bold text-slate-500">{stat.label}</div>
          </div>
        ))}
      </div>
      )}
      <BloodDonationEducationalInfo />
    </div>
  );
};
