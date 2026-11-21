
import React, { useState } from 'react';
import { Bell, RefreshCw, Menu, UserCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface HeaderProps {
  onOpenAuth: () => void;
  onOpenInstallModal: () => void;
  onOpenSidebar: () => void;
  onGoToUrgent?: () => void;
  onOpenNotifications?: () => void;
  onOpenRoleModal: () => void;
  onGlobalRefresh?: () => void;
  isRefreshing?: boolean;
  unreadCount?: number;
}

const APP_ICON =
  '/assets/aistudio/file_0000000045e882119c7c9319efd48f08.webp';

export const Header: React.FC<HeaderProps> = ({
  onOpenSidebar,
  onGoToUrgent,
  onOpenNotifications,
  onOpenRoleModal,
  onGlobalRefresh,
  isRefreshing = false,
  unreadCount = 2,
}) => {
  const { activeRole } = useAuth();
  const [imageFailed, setImageFailed] = useState(false);

  return (
    <header
      dir="rtl"
      className="sticky top-0 z-40 bg-white border-b border-slate-100 shadow-xs"
    >
      <div className="max-w-4xl mx-auto px-3 py-2 flex items-center justify-between gap-1.5">

        {/* القائمة وهوية التطبيق */}
        <div className="flex items-center gap-2.5 shrink-0">

          <button
            onClick={onOpenSidebar}
            aria-label="القائمة"
            className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-200 text-slate-600 hover:text-red-600 hover:bg-red-50 flex items-center justify-center transition-all shadow-xs active:scale-95"
          >
            <Menu className="w-5 h-5" />
          </button>

          {/* أيقونة أنقذني بجوار الاسم */}
          <div className="flex items-center gap-2.5">

            <div className="w-11 h-11 sm:w-12 sm:h-12 shrink-0 rounded-full border-2 border-[#e11d48] bg-white shadow-sm overflow-hidden flex items-center justify-center">
              {!imageFailed ? (
                <img
                  src={APP_ICON}
                  alt="أيقونة أنقذني"
                  onError={() => setImageFailed(true)}
                  className="w-full h-full object-contain"
                />
              ) : (
                <span className="text-red-600 font-black text-xl">♥</span>
              )}
            </div>

            <div className="flex flex-col text-right">
              <h1 className="text-base sm:text-lg font-black text-[#d3101c] leading-tight whitespace-nowrap">
                أنقذني
              </h1>
              <p className="text-[10px] sm:text-[11px] text-slate-600 font-bold mt-1 whitespace-nowrap leading-none">
                بنك الدم - قعطبه
              </p>
            </div>

          </div>
        </div>

        {/* أزرار التحكم */}
        <div className="flex items-center gap-1.5 shrink-0">

          {activeRole === 'admin' && (
            <button
              onClick={onOpenRoleModal}
              className="px-2 py-1 rounded-lg bg-amber-50 text-amber-700 border border-amber-100 text-[9px] font-black shadow-xs hidden sm:block"
            >
              وضع المسؤول ✓
            </button>
          )}

          <button
            onClick={onOpenRoleModal}
            title="تبديل وضع المستخدم"
            className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition-all shadow-xs active:scale-95 ${
              activeRole === 'admin'
                ? 'bg-amber-100 text-amber-700 border border-amber-200'
                : 'bg-slate-50 text-slate-600 border border-slate-200 hover:text-red-600 hover:bg-red-50'
            }`}
          >
            <UserCircle className="w-5 h-5" />
          </button>

          {onGlobalRefresh && (
            <button
              onClick={onGlobalRefresh}
              disabled={isRefreshing}
              title="تحديث ومزامنة التطبيق"
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-slate-50 border border-slate-200 text-slate-700 hover:text-emerald-700 flex items-center justify-center shadow-xs disabled:opacity-60"
            >
              <RefreshCw
                className={`w-4 h-4 ${
                  isRefreshing ? 'animate-spin text-emerald-600' : ''
                }`}
              />
            </button>
          )}

          <button
            onClick={() => {
              if (onOpenNotifications) {
                onOpenNotifications();
              } else if (onGoToUrgent) {
                onGoToUrgent();
              }
            }}
            title="الإشعارات والتنبيهات"
            aria-label="الإشعارات"
            className="relative w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-slate-50 border border-slate-200 text-slate-600 hover:text-red-600 flex items-center justify-center shadow-xs"
          >
            <Bell className="w-4 h-4" />

            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-red-600 text-white font-black text-[9px] flex items-center justify-center border-2 border-white">
                {unreadCount}
              </span>
            )}
          </button>

        </div>
      </div>
    </header>
  );
};
