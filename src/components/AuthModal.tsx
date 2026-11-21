import React, { useState } from 'react';
import {
  LogIn,
  UserPlus,
  Lock,
  X,
  AlertTriangle,
  CheckCircle2,
  User,
  ShieldCheck,
  ExternalLink,
  Eye,
  EyeOff,
  Heart,
  KeyRound,
  MessageCircle,
  ArrowRight
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { useAuth } from '../context/AuthContext';
import { YemenPhoneInput } from './YemenPhoneInput';
import {
  requestAccountRecoveryByPhone,
  completeAccountRecoveryByCode,
} from '../services/accountRecoveryService';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  isInitialScreen?: boolean;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, isInitialScreen = false }) => {
  const {
    loginWithPhone,
    registerWithPhone,
    loginWithGoogle,
    continueAsGuest
  } = useAuth();

  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');
  const [phone, setPhone] = useState(() => localStorage.getItem('qataba_recovery_phone') || '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [fullName, setFullName] = useState(() => localStorage.getItem('qataba_recovery_name') || '');
  const [recoveryNote, setRecoveryNote] = useState('');
  const [recoveryRequestId, setRecoveryRequestId] = useState(() => localStorage.getItem('qataba_recovery_request_id') || '');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [recoveryRequested, setRecoveryRequested] = useState(() => Boolean(localStorage.getItem('qataba_recovery_request_id')));

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [showProviderSetupHelp, setShowProviderSetupHelp] = useState(false);

  if (!isOpen) return null;

  const handleResetForm = (preservePhone = false) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setShowProviderSetupHelp(false);
    if (!preservePhone) {
      setFullName('');
      setRecoveryRequestId('');
      setRecoveryRequested(false);
    }
    setRecoveryNote('');
    setRecoveryCode('');
    setNewPassword('');
    setConfirmNewPassword('');
  };

  const handleGoogleSignIn = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setShowProviderSetupHelp(false);
    setLoading(true);
    try {
      const googleUser = await loginWithGoogle();
      localStorage.removeItem('has_logged_out');
      confetti({
        particleCount: 80,
        spread: 60,
        origin: { y: 0.6 },
      });
      setSuccessMsg(`تم تسجيل الدخول بنجاح باستخدام ${googleUser.email || 'حساب Google'}`);
      setTimeout(() => {
        onClose();
        handleResetForm();
      }, 1000);
    } catch (err: any) {
      console.error('Google sign in error:', err);
      const wasCancelled = ['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/cancelled'].includes(err.code) || /cancelled|canceled/i.test(err.message || '');
      if (!wasCancelled) {
        setErrorMsg('حدث خطأ أثناء تسجيل الدخول عبر Google. يرجى المحاولة مرة أخرى.');
      }
    } finally {
      setLoading(false);
    }
  };

  // 1. Direct Login (Phone + Password only)
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    setLoading(true);
    try {
      if (!phone) {
        throw new Error('يرجى إدخال رقم الهاتف');
      }
      await loginWithPhone(phone, password);
      localStorage.removeItem('has_logged_out');
      onClose();
      handleResetForm();
    } catch (err: any) {
      console.error('Login error:', err);
      if (
        err.code === 'auth/firebase-app-check-token-is-invalid' ||
        err.message?.includes('firebase-app-check-token-is-invalid') ||
        err.message?.includes('app-check')
      ) {
        setErrorMsg('⚠️ حماية App Check في مشروعك بـ Firebase تمنع الدخول بدون توثيق (App Check Token Invalid). يرجى فتح Firebase Console ⬅️ App Check ⬅️ اختيار (Authentication / Identity Platform) وتغيير حالتها من Enforced إلى Un-enforced.');
      } else if (err.code === 'auth/operation-not-allowed' || err.message?.includes('operation-not-allowed')) {
        setShowProviderSetupHelp(true);
        setErrorMsg('خدمة تسجيل الدخول بكلمة المرور (Email/Password) غير مفعلة في مشروع Firebase حتى الآن.');
      } else if (
        err.code === 'auth/wrong-password' || 
        err.code === 'auth/user-not-found' || 
        err.code === 'auth/invalid-credential'
      ) {
        setErrorMsg('رقم الهاتف/البريد أو كلمة المرور غير صحيحة');
      } else {
        setErrorMsg(err.message || 'حدث خطأ أثناء تسجيل الدخول. يرجى التأكد من البيانات والمحاولة مجدداً.');
      }
    } finally {
      setLoading(false);
    }
  };

  // 2. Direct Register (Phone + Password only, no OTP code, instant login)
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!phone || phone.length < 7) {
      setErrorMsg('يرجى إدخال رقم الهاتف اليمني المكون من 9 أرقام');
      return;
    }

    if (!password || password.length < 6) {
      setErrorMsg('كلمة المرور يجب أن لا تقل عن 6 خانات');
      return;
    }

    if (!fullName || fullName.trim().length < 3) {
      setErrorMsg('يرجى إدخال اسمك الكامل بشكل صحيح (3 أحرف على الأقل)');
      return;
    }

    setLoading(true);
    try {
      await registerWithPhone(phone, password, fullName);
      localStorage.removeItem('has_logged_out');
      confetti({
        particleCount: 90,
        spread: 70,
        origin: { y: 0.6 },
      });
      setSuccessMsg('تم إنشاء حسابك وحفظه بنجاح والدخول تلقائياً!');
      setTimeout(() => {
        onClose();
        handleResetForm();
      }, 1200);
    } catch (err: any) {
      console.error('Register error:', err);
      if (
        err.code === 'auth/firebase-app-check-token-is-invalid' ||
        err.message?.includes('firebase-app-check-token-is-invalid') ||
        err.message?.includes('app-check')
      ) {
        setErrorMsg('⚠️ حماية App Check في مشروعك بـ Firebase تمنع إنشاء الحسابات بدون توثيق (App Check Token Invalid). يرجى فتح Firebase Console ⬅️ App Check ⬅️ اختيار (Authentication / Identity Platform) وتغيير حالتها من Enforced إلى Un-enforced.');
      } else if (err.code === 'auth/operation-not-allowed' || err.message?.includes('operation-not-allowed')) {
        setShowProviderSetupHelp(true);
        setErrorMsg('خدمة إنشاء الحسابات بكلمة المرور (Email/Password) غير مفعلة في مشروعك حتى الآن.');
      } else if (err.code === 'auth/email-already-in-use' || err.message?.includes('مسجل بالفعل')) {
        setErrorMsg('هذا الرقم مسجل بالفعل في التطبيق. يمكنك تسجيل الدخول مباشرة أو استعادة كلمة المرور.');
      } else if (err.code === 'auth/weak-password' || err.message?.includes('كلمة المرور ضعيفة')) {
        setErrorMsg('كلمة المرور ضعيفة. يرجى اختيار كلمة مرور لا تقل عن 6 خانات.');
      } else if (err.message?.includes('Missing or insufficient permissions') || err.code === 'permission-denied') {
        setErrorMsg('تعذر حفظ بيانات الحساب في Firestore بسبب الصلاحيات. لم يكتمل التسجيل؛ تحقق من إعدادات قاعدة البيانات قبل إعادة المحاولة.');
      } else {
        setErrorMsg(err.message || 'حدث خطأ أثناء إنشاء الحساب. يرجى المحاولة مرة أخرى.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGuest = () => {
    localStorage.removeItem('has_logged_out');
    continueAsGuest();
    onClose();
    handleResetForm();
  };

  return (
    <div
      className={
        isInitialScreen
          ? "min-h-screen w-full bg-linear-to-b from-[#2a0408] via-[#4d070e] to-[#1a0204] flex flex-col items-center justify-center p-4 py-8 sm:py-12 font-['Cairo',sans-serif] dir-rtl"
          : "fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 font-['Cairo',sans-serif] dir-rtl"
      }
    >
      <div
        className={`bg-white rounded-[32px] max-w-md w-full p-6 sm:p-7 shadow-2xl relative space-y-4 text-right border border-white/20 ${
          isInitialScreen ? 'shadow-red-950/80 my-auto' : ''
        }`}
      >
        
        {/* Close Button (Hidden on initial startup screen) */}
        {!isInitialScreen && (
          <button
            onClick={() => {
              onClose();
              handleResetForm();
            }}
            className="absolute top-4 left-4 p-2 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        )}

        {/* Modal Branding Header */}
        <div className="text-center space-y-2 pt-1 flex flex-col items-center">
          <div className="relative w-22 h-22 sm:w-24 sm:h-24 rounded-2xl overflow-hidden flex items-center justify-center shadow-md border border-red-100 bg-white mb-1">
            <img
              src="/assets/aistudio/file_0000000045e882119c7c9319efd48f08_cf9f259d.webp"
              alt="شعار أنقذني - بنك الدم قعطبه"
              className="w-full h-full object-cover"
            />
          </div>

          <h2 className="text-3xl sm:text-[32px] font-black text-[#d3101c] tracking-tight leading-none">
            أنقذني
          </h2>
          <p className="text-xs sm:text-sm font-extrabold text-slate-700">
            بنك الدم مديرية قعطبة م/الضالع
          </p>

          <div className="pt-0.5">
            <span className="inline-flex items-center gap-1 text-xs font-black text-red-600 bg-[#ffecee] border border-red-100 px-4 py-1.5 rounded-full shadow-2xs">
              <Heart className="w-3.5 h-3.5 fill-red-600 text-red-600" />
              <span>«معاً لإنقاذ الأرواح» ❤️</span>
            </span>
          </div>
        </div>

        {/* Mode Switch Segmented Tabs Control (تسجيل الدخول / حساب جديد) */}
        {mode !== 'forgot' && (
          <div className="grid grid-cols-2 bg-[#f0f3f8] p-1.5 rounded-2xl text-xs sm:text-sm font-bold text-slate-600 shadow-inner">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                handleResetForm();
              }}
              className={`py-2.5 rounded-xl transition-all cursor-pointer ${
                mode === 'login'
                  ? 'bg-white text-red-600 shadow-sm border border-slate-200/60 font-black'
                  : 'hover:text-slate-900'
              }`}
            >
              تسجيل الدخول
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                handleResetForm();
              }}
              className={`py-2.5 rounded-xl transition-all cursor-pointer ${
                mode === 'register'
                  ? 'bg-white text-red-600 shadow-sm border border-slate-200/60 font-black'
                  : 'hover:text-slate-900'
              }`}
            >
              حساب جديد لأول مرة
            </button>
          </div>
        )}

        {/* Error Alert */}
        {errorMsg && (
          <div className="p-3 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2 font-bold">
            <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Firebase Email/Password Provider Activation Notice */}
        {showProviderSetupHelp && (
          <div className="p-3.5 rounded-2xl bg-amber-50 border-2 border-amber-300 text-amber-950 space-y-2.5 text-xs shadow-xs">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-extrabold text-amber-950 text-xs sm:text-sm">
                  خطوة تفعيل سريعة في Firebase (لمرة واحدة فقط)
                </p>
                <p className="text-amber-800 text-[11px] mt-0.5 leading-relaxed font-bold">
                  مشروع Firebase يتطلب تفعيل خيار <strong>Email/Password</strong> لتمكين إنشاء الحسابات بكلمة المرور:
                </p>
              </div>
            </div>

            <div className="bg-white/95 p-2.5 rounded-xl border border-amber-200 space-y-1 text-[11px] text-slate-700 font-bold">
              <p>1. اضغط على الزر أدناه لفتح صفحة مزودي الدخول في مشروعك.</p>
              <p>2. اضغط على <strong>البريد الإلكتروني/كلمة المرور (Email/Password)</strong>.</p>
              <p>3. قم بتفعيل الخيار الأول (Enable) واضغط <strong>حفظ (Save)</strong>.</p>
            </div>

            <a
              href="https://console.firebase.google.com/project/a-drop-of-blood-saves-a-life/authentication/providers"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 w-full py-2.5 px-3 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-black text-xs shadow-xs transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              <span>فتح صفحة تفعيل Email/Password في Firebase</span>
            </a>
          </div>
        )}

        {/* Success Alert */}
        {successMsg && (
          <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs flex items-center gap-2 font-bold">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* 1. LOGIN FORM: Phone + Password matching exact screenshot layout */}
        {mode === 'login' && (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs sm:text-sm font-black text-slate-800 mb-1.5 text-right">
                رقم الهاتف
              </label>
              <YemenPhoneInput
                value={phone}
                onChange={setPhone}
                placeholder="773 633 918"
                required
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs sm:text-sm font-black text-slate-800 text-right">
                  كلمة المرور
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setMode('forgot');
                    handleResetForm(true);
                  }}
                  className="text-xs text-red-600 hover:underline font-bold cursor-pointer"
                >
                  نسيت كلمة المرور؟
                </button>
              </div>
              <div className="relative flex items-center rounded-2xl border border-slate-200 focus-within:border-red-500 focus-within:ring-2 focus-within:ring-red-100 bg-white overflow-hidden shadow-xs transition-all">
                <div className="pr-3.5 text-slate-400 pointer-events-none shrink-0">
                  <Lock className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400 stroke-[2]" />
                </div>
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="أدخل كلمة المرور"
                  className="w-full px-3 py-3 text-xs sm:text-sm outline-hidden font-bold text-slate-900 placeholder:text-slate-300 bg-transparent text-right"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="pl-3.5 pr-1 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer shrink-0"
                  title={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 sm:py-4 rounded-2xl bg-[#e50914] hover:bg-red-700 text-white font-black text-sm sm:text-base shadow-lg shadow-red-500/25 transition-all flex items-center justify-center gap-2.5 disabled:opacity-50 active:scale-[0.98] cursor-pointer mt-2"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <>
                  <LogIn className="w-5 h-5 stroke-[2.5]" />
                  <span>تسجيل الدخول</span>
                </>
              )}
            </button>
          </form>
        )}

        {/* 2. REGISTER FORM: Name + Phone + Password */}
        {mode === 'register' && (
          <form onSubmit={handleRegister} className="space-y-4">
            <div>
              <label className="block text-xs sm:text-sm font-black text-slate-800 mb-1.5 text-right">
                1. الاسم الرباعي
              </label>
              <div className="relative flex items-center rounded-2xl border border-slate-200 focus-within:border-red-500 focus-within:ring-2 focus-within:ring-red-100 bg-white overflow-hidden shadow-xs">
                <div className="pr-3.5 text-slate-400 pointer-events-none shrink-0">
                  <UserPlus className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400 stroke-[2]" />
                </div>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="أدخل اسمك الرباعي الكامل"
                  className="w-full px-3 py-3 text-xs sm:text-sm outline-hidden font-bold text-slate-900 placeholder:text-slate-300 bg-transparent text-right"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs sm:text-sm font-black text-slate-800 mb-1.5 text-right">
                2. رقم الهاتف
              </label>
              <YemenPhoneInput
                value={phone}
                onChange={setPhone}
                placeholder="773 633 918"
                required
              />
            </div>

            <div>
              <label className="block text-xs sm:text-sm font-black text-slate-800 mb-1.5 text-right">
                3. كلمة المرور
              </label>
              <div className="relative flex items-center rounded-2xl border border-slate-200 focus-within:border-red-500 focus-within:ring-2 focus-within:ring-red-100 bg-white overflow-hidden shadow-xs">
                <div className="pr-3.5 text-slate-400 pointer-events-none shrink-0">
                  <Lock className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400 stroke-[2]" />
                </div>
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="اختر كلمة مرور (6 خانات على الأقل)"
                  className="w-full px-3 py-3 text-xs sm:text-sm outline-hidden font-bold text-slate-900 placeholder:text-slate-300 bg-transparent text-right"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="pl-3.5 pr-1 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer shrink-0"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="p-3 rounded-2xl bg-red-50/70 border border-red-100 text-slate-700 text-[11px] leading-relaxed flex items-start gap-2 font-bold">
              <ShieldCheck className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>
                سيتم حفظ حسابك تلقائياً وتبقى مسجلاً في التطبيق. ولن تحتاج لتسجيل الدخول مرة أخرى إلا إذا قمت بعمل تسجيل خروج يدوي.
              </span>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 sm:py-4 rounded-2xl bg-[#e50914] hover:bg-red-700 text-white font-black text-sm sm:text-base shadow-lg shadow-red-500/25 transition-all flex items-center justify-center gap-2.5 disabled:opacity-50 active:scale-[0.98] cursor-pointer"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <>
                  <UserPlus className="w-5 h-5 stroke-[2.5]" />
                  <span>إنشاء الحساب والدخول تلقائياً</span>
                </>
              )}
            </button>
          </form>
        )}

        {mode === 'forgot' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-red-600" />
                <span className="text-sm font-black text-slate-900">استعادة كلمة المرور</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  handleResetForm(true);
                }}
                className="text-xs text-red-600 hover:underline font-bold flex items-center gap-1 cursor-pointer"
              >
                <ArrowRight className="w-3.5 h-3.5" />
                <span>العودة للدخول</span>
              </button>
            </div>

            {!recoveryRequested ? (
              <div className="space-y-3.5">
                <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200 text-xs leading-relaxed text-amber-950 font-bold">
                  أدخل رقم هاتفك واسمك الكامل لإرسال طلب استعادة كلمة المرور إلى مسؤول التطبيق. بعد التحقق من هويتك سيرسل لك المسؤول رمزاً من 6 أرقام لتعيين كلمة مرور جديدة لحسابك.
                </div>

                <div>
                  <label className="block text-xs font-black text-slate-800 mb-1">
                    1. رقم الهاتف المسجل
                  </label>
                  <YemenPhoneInput
                    value={phone}
                    onChange={setPhone}
                    placeholder="773 633 918"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-black text-slate-800 mb-1">
                    2. الاسم الكامل (لتأكيد هويتك لدى المسؤول)
                  </label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="مثال: أحمد محمد علي"
                    className="w-full p-3 rounded-2xl border border-slate-200 focus:border-red-500 outline-hidden text-xs sm:text-sm font-bold text-slate-900 text-right"
                  />
                </div>

                <div>
                  <label className="block text-xs font-black text-slate-600 mb-1">
                    ملاحظة إضافية للمسؤول (اختياري: فصيلة الدم أو المنطقة)
                  </label>
                  <input
                    type="text"
                    value={recoveryNote}
                    onChange={(e) => setRecoveryNote(e.target.value)}
                    placeholder="مثال: فصيلتي O+ من منطقة قعطبة"
                    className="w-full p-3 rounded-2xl border border-slate-200 focus:border-red-500 outline-hidden text-xs font-bold text-slate-800 text-right"
                  />
                </div>

                <button
                  type="button"
                  disabled={loading || !phone.trim() || fullName.trim().length < 2}
                  onClick={async () => {
                    setLoading(true);
                    setErrorMsg(null);
                    setSuccessMsg(null);
                    try {
                      const result = await requestAccountRecoveryByPhone(phone, fullName, recoveryNote);
                      setRecoveryRequestId(result.requestId);
                      setPhone(result.phone);
                      localStorage.setItem('qataba_recovery_phone', result.phone);
                      localStorage.setItem('qataba_recovery_name', result.fullName);
                      localStorage.setItem('qataba_recovery_request_id', result.requestId);
                      setRecoveryRequested(true);
                      setSuccessMsg(result.message);
                    } catch (error: any) {
                      setErrorMsg(error?.message || 'تعذر إرسال طلب الاستعادة.');
                    } finally {
                      setLoading(false);
                    }
                  }}
                  className="w-full py-3.5 rounded-2xl bg-[#e50914] hover:bg-red-700 text-white font-black text-sm shadow-md shadow-red-500/20 disabled:opacity-50 transition-all cursor-pointer"
                >
                  {loading ? 'جارٍ إرسال الطلب...' : 'إرسال طلب استعادة كلمة المرور للمسؤول'}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setErrorMsg(null);
                    setSuccessMsg(null);
                    setRecoveryRequested(true);
                  }}
                  className="w-full py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-black transition-colors cursor-pointer"
                >
                  لدي رمز استعادة (6 أرقام) من المسؤول بالفعل
                </button>
              </div>
            ) : (
              <div className="space-y-3.5">
                <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-xs leading-relaxed text-emerald-950 font-bold space-y-1.5">
                  <p>
                    تواصل مع المسؤول عبر واتساب لتأكيد هويتك واستلام رمز التفعيل المكون من 6 أرقام، ثم أدخل الرمز وكلمة المرور الجديدة أدناه.
                  </p>
                  {recoveryRequestId && (
                    <div className="text-[11px] text-emerald-800 font-mono break-all">
                      رقم الطلب: {recoveryRequestId}
                    </div>
                  )}
                </div>

                <a
                  href={`https://wa.me/967773633918?text=${encodeURIComponent(
                    `السلام عليكم، أرجو مساعدتي في استعادة كلمة مرور حسابي في تطبيق بنك الدم قعطبة.\nالاسم: ${fullName || 'غير محدد'}\nرقم الهاتف: ${phone || 'غير محدد'}${recoveryRequestId ? `\nرقم الطلب: ${recoveryRequestId}` : ''}`
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full py-3 rounded-2xl bg-green-600 hover:bg-green-700 text-white text-center font-black text-sm flex items-center justify-center gap-2 shadow-sm transition-colors"
                >
                  <MessageCircle className="w-4.5 h-4.5" />
                  <span>التواصل مع المسؤول عبر واتساب لاستلام الرمز</span>
                </a>

                <div>
                  <label className="block text-xs font-black text-slate-800 mb-1">
                    رقم الهاتف
                  </label>
                  <YemenPhoneInput
                    value={phone}
                    onChange={setPhone}
                    placeholder="773 633 918"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-black text-slate-800 mb-1">
                    رمز الاستعادة من المسؤول (6 أرقام)
                  </label>
                  <input
                    value={recoveryCode}
                    onChange={(e) => setRecoveryCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="000000"
                    dir="ltr"
                    className="w-full p-3 rounded-2xl border border-slate-200 focus:border-red-500 outline-hidden text-center font-mono text-xl font-black tracking-[0.4em] text-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-black text-slate-800 mb-1">
                    كلمة المرور الجديدة
                  </label>
                  <div className="relative flex items-center rounded-2xl border border-slate-200 focus-within:border-red-500 bg-white overflow-hidden">
                    <input
                      type={showNewPassword ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      autoComplete="new-password"
                      placeholder="6 خانات على الأقل"
                      className="w-full px-3.5 py-3 text-xs sm:text-sm outline-hidden font-bold text-slate-900 text-right bg-transparent"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="pl-3.5 pr-1 text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-black text-slate-800 mb-1">
                    تأكيد كلمة المرور الجديدة
                  </label>
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    autoComplete="new-password"
                    placeholder="أعد كتابة كلمة المرور الجديدة"
                    className="w-full p-3 rounded-2xl border border-slate-200 focus:border-red-500 outline-hidden text-xs sm:text-sm font-bold text-slate-900 text-right"
                  />
                  {confirmNewPassword && newPassword !== confirmNewPassword && (
                    <p className="text-[11px] text-red-600 font-bold mt-1">
                      كلمتا المرور غير متطابقتين
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  disabled={
                    loading ||
                    !phone.trim() ||
                    recoveryCode.length !== 6 ||
                    newPassword.length < 6 ||
                    newPassword !== confirmNewPassword
                  }
                  onClick={async () => {
                    setLoading(true);
                    setErrorMsg(null);
                    setSuccessMsg(null);
                    try {
                      const result = await completeAccountRecoveryByCode({
                        phone,
                        code: recoveryCode,
                        newPassword,
                        fullName,
                        requestId: recoveryRequestId,
                      });
                      confetti({
                        particleCount: 90,
                        spread: 70,
                        origin: { y: 0.6 },
                      });
                      setSuccessMsg(`${result.message} تم تسجيل دخولك تلقائياً بحسابك.`);
                      localStorage.removeItem('qataba_recovery_phone');
                      localStorage.removeItem('qataba_recovery_name');
                      localStorage.removeItem('qataba_recovery_request_id');
                      setRecoveryRequested(false);
                      setRecoveryRequestId('');
                      setRecoveryCode('');
                      setNewPassword('');
                      setConfirmNewPassword('');
                      setTimeout(() => {
                        onClose();
                        handleResetForm();
                      }, 1500);
                    } catch (error: any) {
                      setErrorMsg(error?.message || 'تعذر إكمال استعادة كلمة المرور.');
                    } finally {
                      setLoading(false);
                    }
                  }}
                  className="w-full py-3.5 rounded-2xl bg-[#e50914] hover:bg-red-700 text-white font-black text-sm shadow-md shadow-red-500/20 disabled:opacity-50 transition-all cursor-pointer"
                >
                  {loading ? 'جارٍ التحقق وتعيين كلمة المرور...' : 'تأكيد الرمز وتعيين كلمة المرور الجديدة'}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    localStorage.removeItem('qataba_recovery_request_id');
                    setRecoveryRequestId('');
                    setRecoveryRequested(false);
                    setErrorMsg(null);
                    setSuccessMsg(null);
                  }}
                  className="w-full py-2 text-xs text-slate-500 hover:text-slate-800 font-bold cursor-pointer"
                >
                  إرسال طلب استعادة جديد
                </button>
              </div>
            )}
          </div>
        )}

        {/* Divider: ── أو ── */}
        <div className="relative flex items-center justify-center my-3">
          <div className="border-t border-slate-200 w-full"></div>
          <span className="bg-white px-3 text-xs text-slate-400 font-bold">
            أو
          </span>
        </div>

        {/* Quick Google Sign In */}
        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={loading}
          className="w-full py-3.5 px-4 rounded-2xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-800 text-xs sm:text-sm font-bold flex items-center justify-center gap-2.5 shadow-xs transition-colors cursor-pointer active:scale-[0.98]"
        >
          <svg className="w-4.5 h-4.5 shrink-0" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"/>
            <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.34 24 12 24z"/>
            <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 10.03 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/>
            <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.34 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/>
          </svg>
          <span>تسجيل الدخول السريع بحساب Google</span>
        </button>

        {/* Continue as Guest Button */}
        <button
          type="button"
          onClick={handleGuest}
          className="w-full py-3.5 px-4 rounded-2xl bg-[#f0f4f9] hover:bg-slate-200/80 text-slate-800 text-xs sm:text-sm font-bold flex items-center justify-center gap-2.5 transition-colors cursor-pointer active:scale-[0.98]"
        >
          <User className="w-4.5 h-4.5 text-slate-600 stroke-[2]" />
          <span>المتابعة كزائر دون تسجيل حساب</span>
        </button>

      </div>
    </div>
  );
};
