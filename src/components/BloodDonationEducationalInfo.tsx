import React from 'react';
import { Heart, Sparkles, Award } from 'lucide-react';
import { SubpageBackBar } from './SubpageBackBar';

interface BloodDonationEducationalInfoProps {
  onBack?: () => void;
  showSponsorCard?: boolean;
}

export const BloodDonationEducationalInfo: React.FC<BloodDonationEducationalInfoProps> = ({
  onBack,
  showSponsorCard = false,
}) => {
  const posterImagePath = '/assets/aistudio/file_0000000030cc821193cd25a471968ca3_9d4f13f6.webp';

  return (
    <div className="w-full max-w-4xl mx-auto space-y-4 text-right font-['Cairo',sans-serif] select-none">
      {onBack && (
        <SubpageBackBar
          title="فوائد وتعليمات التبرع بالدم"
          onBack={onBack}
        />
      )}

      {/* 1. Main Poster Image Container - Static & Fixed at the top */}
      <div className="bg-white rounded-3xl p-2 sm:p-3 border border-slate-200/90 shadow-sm relative overflow-hidden">
        <div className="relative rounded-2xl overflow-hidden bg-slate-50 flex items-center justify-center border border-slate-100">
          <img
            src={posterImagePath}
            alt="فوائد وشروط التبرع بالدم"
            className="w-full h-auto object-contain rounded-2xl shadow-xs pointer-events-none"
            loading="eager"
            draggable={false}
          />
        </div>
      </div>

      {/* 2. بطاقة العنوان والمعلومات (تم إنزالها للأسفل تحت الصورة) */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200/90 shadow-xs flex items-center justify-between">
        <div>
          <h2 className="text-base sm:text-lg font-black text-slate-900">
            فوائد وتعليمات التبرع بالدم
          </h2>
          <p className="text-xs text-slate-500 font-medium mt-0.5">
            الملصق التوعوي الطبي المعتمد • مديرية قعطبة
          </p>
        </div>
        <div className="w-9 h-9 rounded-xl bg-red-50 text-red-600 flex items-center justify-center shrink-0">
          <Heart className="w-5 h-5 fill-red-600 text-red-600" />
        </div>
      </div>

      {/* 3. البطاقة السفلية البارزة والمميزة */}
      <div className="relative overflow-hidden rounded-3xl bg-linear-to-r from-red-600 via-rose-600 to-red-700 p-6 text-white shadow-xl shadow-red-500/20 border-2 border-red-500/30">
        {/* Glow & Pattern Accents */}
        <div className="absolute -top-12 -left-12 w-36 h-36 bg-white/15 rounded-full blur-2xl pointer-events-none"></div>
        <div className="absolute -bottom-12 -right-12 w-36 h-36 bg-amber-400/20 rounded-full blur-2xl pointer-events-none"></div>
        
        <div className="relative z-10 flex flex-col items-center text-center space-y-3.5">
          {/* Top Badge */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-white/20 backdrop-blur-md text-white text-xs font-black border border-white/20 shadow-xs">
            <Award className="w-4 h-4 text-amber-300" />
            <span>وسام العطاء الإنساني</span>
            <Sparkles className="w-3.5 h-3.5 text-amber-300 animate-pulse" />
          </div>

          {/* Big Featured Title */}
          <h2 className="text-xl sm:text-2xl md:text-3xl font-black text-white tracking-tight flex items-center justify-center gap-2 flex-wrap drop-shadow-sm">
            <span>«دمك أمانة، وتبرعك وسام حياة»</span>
            <Heart className="w-6 h-6 sm:w-7 sm:h-7 fill-white text-white shrink-0 animate-pulse" />
          </h2>

          {/* Quranic Verse / Inspirational Subtext */}
          <p className="text-xs sm:text-sm font-bold text-amber-200/95 max-w-md bg-black/15 px-4 py-2 rounded-2xl border border-white/10">
            ﴿ وَمَنْ أَحْيَاهَا فَكَأَنَّمَا أَحْيَا النَّاسَ جَمِيعًا ﴾
          </p>

          {/* Divider */}
          <div className="w-20 h-0.5 bg-white/30 rounded-full my-1"></div>

          {/* Bottom Attribution */}
          <div className="space-y-1">
            <p className="text-sm font-extrabold text-white">
              شكراً لكل بطل ومتبرع يبادر لإنقاذ الأرواح
            </p>
            <p className="text-xs text-red-100/90 font-medium">
              تطبيق بنك الدم في مديرية قعطبة - محافظة الضالع
            </p>
          </div>
        </div>
      </div>

      {/* بطاقة رعاية نادي جيشان - تظهر فقط في تبويب فوائد التبرع */}
      {showSponsorCard && (
        <div
          dir="rtl"
          className="flex items-center justify-start gap-3 bg-white rounded-2xl px-4 py-3.5 my-3.5 shadow-sm border border-gray-100"
        >
          <div className="w-14 h-14 rounded-full overflow-hidden shrink-0 flex items-center justify-center bg-[#fdf8f8] border border-[#f3e5e5]">
            <img
              src="/assets/aistudio/1794594460673_53a90780.jpg"
              alt="شعار نادي جيشان"
              className="w-full h-full object-cover"
            />
          </div>

          <div className="flex flex-col text-right">
            <p className="text-[15px] font-bold text-gray-800 leading-snug m-0">
              برعاية نادي جيشان الرياضي الثقافي الاجتماعي
            </p>
            <p className="text-[13px] font-medium text-gray-500 leading-snug mt-1 mb-0">
              مديرية قعطبة - محافظة الضالع
            </p>
          </div>
        </div>
      )}

    </div>
  );
};
