import React from 'react';
import { Shield, CheckCircle2, Clock, Headphones, KeyRound, ArrowUpRight, Sparkles } from 'lucide-react';
import { Language } from '../types';
import { translations } from '../locales/translations';

interface BannerProps {
  language: Language;
  onOpenDeposit?: () => void;
  onOpenCtv?: () => void;
}

export const Banner: React.FC<BannerProps> = ({ language }) => {
  const t = translations[language];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-4 pb-2">
      {/* Mobile: a short one-line strip — the full banner below is a lot of
          scrolling before the storefront (categories/products) even shows
          up on a phone screen. Desktop/tablet keep the full version. */}
      <div className="sm:hidden flex items-center gap-3 bg-[#edf0ef] dark:bg-[#202328] border border-emerald-500/25 rounded-xl px-3.5 py-2.5">
        <div className="w-8 h-8 rounded-lg bg-[#ebeeed] dark:bg-[#24262b] border border-emerald-400/40 flex items-center justify-center flex-shrink-0">
          <svg className="w-4.5 h-4.5" viewBox="0 0 28 28" fill="none">
            <path d="M5 6L12 14L5 22H9L14 16.2L19 22H23L16 14L23 6H19L14 11.8L9 6H5Z" fill="#38bdf8" />
            <path d="M14 11.8L19 6H23L16 14L20 18.8L18 20.8L13 14.8L14 11.8Z" fill="#10b981" />
            <circle cx="14" cy="14" r="2" fill="#ffffff" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-black text-slate-900 dark:text-slate-100 truncate leading-tight">
            {t.trustSlogan}
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-slate-600 dark:text-slate-400 font-mono mt-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_6px_#34d399] flex-shrink-0" />
            {t.bannerOnline}
          </div>
        </div>
      </div>

      {/* Sleek container with solid dark-tech background */}
      <div className="hidden sm:block relative overflow-hidden w-full bg-[#edf0ef] dark:bg-[#202328] border border-emerald-500/25 rounded-2xl p-5 sm:p-6 shadow-xl shadow-black/30">
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          {/* Left Column: Brand Statement */}
          <div className="space-y-3 flex-1">
            <div className="flex items-center gap-3">
              {/* Logo Monogram */}
              <div className="w-10 h-10 rounded-xl bg-[#ebeeed] dark:bg-[#24262b] border border-emerald-400/40 flex items-center justify-center text-slate-900 dark:text-slate-100 font-black tracking-tighter text-lg shadow-md shadow-black/40">
                <svg className="w-6 h-6" viewBox="0 0 28 28" fill="none">
                  <path d="M5 6L12 14L5 22H9L14 16.2L19 22H23L16 14L23 6H19L14 11.8L9 6H5Z" fill="#38bdf8" />
                  <path d="M14 11.8L19 6H23L16 14L20 18.8L18 20.8L13 14.8L14 11.8Z" fill="#10b981" />
                  <circle cx="14" cy="14" r="2" fill="#ffffff" />
                </svg>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-md flex items-center gap-1.5 tracking-wider">
                  <Sparkles className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                  {t.bannerBadge}
                </span>
                <span className="text-xs text-slate-700 dark:text-slate-300 font-mono flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_#34d399]" />
                  {t.bannerOnline}
                </span>
              </div>
            </div>

            <div className="text-slate-900 dark:text-slate-100 font-black text-xl sm:text-2xl tracking-wide font-sans">
              {t.trustSlogan}
            </div>

            <p className="text-xs text-slate-700 dark:text-slate-300 max-w-xl leading-relaxed">
              {t.bannerDesc}
            </p>

            {/* Telegram and Channel Contact Links */}
            <div className="flex flex-wrap items-center gap-y-2 gap-x-5 text-xs text-slate-700 dark:text-slate-300 pt-1">
              <div className="flex items-center gap-1.5 bg-[#f3f5f4]/90 dark:bg-[#181a1e]/90 border border-[#e0e4e3] dark:border-[#33363e] px-3 py-1.5 rounded-lg">
                <span className="text-slate-600 dark:text-slate-400 font-medium">{t.chatAdmin}:</span>
                <a
                  href="https://t.me/XCheap_Support"
                  target="_blank"
                  rel="noreferrer"
                  className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 hover:dark:text-emerald-300 font-bold flex items-center gap-0.5"
                >
                  @XCheap_Support
                  <ArrowUpRight className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                </a>
              </div>

              <div className="flex items-center gap-1.5 bg-[#f3f5f4]/90 dark:bg-[#181a1e]/90 border border-[#e0e4e3] dark:border-[#33363e] px-3 py-1.5 rounded-lg">
                <span className="text-slate-600 dark:text-slate-400 font-medium">{t.channelTelegram}:</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-bold font-mono">@XCheap_Channel</span>
              </div>
            </div>
          </div>

          {/* Right Column: Guarantee Box with Node RPC & Bảo Mật Kho replaced */}
          <div className="lg:w-80 flex-shrink-0 bg-[#f1f3f2]/90 dark:bg-[#1b1d22]/90 border border-[#dee2e1] dark:border-[#363a43] rounded-xl p-3.5 space-y-2.5 shadow-md shadow-black/30">
            <div className="flex items-center justify-between pb-2 border-b border-[#dee2e1] dark:border-[#363a43]">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span className="text-xs font-bold text-slate-900 dark:text-slate-100">{t.guaranteeTitle}</span>
              </div>
              <span className="text-[10px] text-emerald-700 dark:text-emerald-300 font-medium bg-emerald-500/20 px-2 py-0.5 rounded border border-emerald-500/40 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" /> {t.guaranteeVerified}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              {/* 1. Tốc độ bàn giao */}
              <div className="bg-[#f6f8f7] dark:bg-[#141518] p-2.5 rounded-lg border border-[#e5e8e7] dark:border-[#2d3036]">
                <div className="text-[10px] text-slate-600 dark:text-slate-400 flex items-center gap-1">
                  <Clock className="w-3 h-3 text-amber-600 dark:text-amber-400" /> {t.guaranteeSpeed}
                </div>
                <div className="font-bold text-amber-700 dark:text-amber-300 text-xs mt-1">{t.guaranteeSpeedVal}</div>
              </div>

              {/* 2. Bảo hành */}
              <div className="bg-[#f6f8f7] dark:bg-[#141518] p-2.5 rounded-lg border border-[#e5e8e7] dark:border-[#2d3036]">
                <div className="text-[10px] text-slate-600 dark:text-slate-400 flex items-center gap-1">
                  <Shield className="w-3 h-3 text-emerald-600 dark:text-emerald-400" /> {t.guaranteeWarranty}
                </div>
                <div className="font-bold text-emerald-700 dark:text-emerald-300 text-xs mt-1">{t.guaranteeWarrantyVal}</div>
              </div>

              {/* 3. Hỗ Trợ Trực Tuyến */}
              <div className="bg-[#f6f8f7] dark:bg-[#141518] p-2.5 rounded-lg border border-[#e5e8e7] dark:border-[#2d3036]">
                <div className="text-[10px] text-slate-600 dark:text-slate-400 flex items-center gap-1">
                  <Headphones className="w-3 h-3 text-emerald-600 dark:text-emerald-400" /> {t.guaranteeSupport}
                </div>
                <div className="font-bold text-emerald-700 dark:text-emerald-300 text-xs mt-1">{t.guaranteeSupportVal}</div>
              </div>

              {/* 4. Định Dạng Chuẩn */}
              <div className="bg-[#f6f8f7] dark:bg-[#141518] p-2.5 rounded-lg border border-[#e5e8e7] dark:border-[#2d3036]">
                <div className="text-[10px] text-slate-600 dark:text-slate-400 flex items-center gap-1">
                  <KeyRound className="w-3 h-3 text-sky-600" /> {t.guaranteeFormat}
                </div>
                <div className="font-bold text-sky-700 text-xs mt-1">{t.guaranteeFormatVal}</div>
              </div>
            </div>

            <div className="text-[11px] text-slate-700 dark:text-slate-300 text-center pt-1 border-t border-[#dee2e1] dark:border-[#363a43] flex items-center justify-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
              <span>{t.guaranteeAudited}</span>
            </div>
          </div>
        </div>

        {/* Feature summary bottom row with colorful accents */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3.5 mt-3.5 border-t border-[#dee3e1] dark:border-[#363941] text-xs">
          <div className="flex items-center gap-2.5 bg-[#f4f6f5]/80 dark:bg-[#17181c]/80 p-2.5 rounded-lg border border-[#e2e6e5] dark:border-[#30333b]">
            <div className="w-7 h-7 rounded-lg bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold">
              <Clock className="w-3.5 h-3.5" />
            </div>
            <div>
              <div className="font-bold text-slate-800 dark:text-slate-200">{t.instantDelivery}</div>
              <div className="text-[11px] text-slate-600 dark:text-slate-400">{t.instantDeliveryDesc}</div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 bg-[#f4f6f5]/80 dark:bg-[#17181c]/80 p-2.5 rounded-lg border border-[#e2e6e5] dark:border-[#30333b]">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold">
              <Shield className="w-3.5 h-3.5" />
            </div>
            <div>
              <div className="font-bold text-slate-800 dark:text-slate-200">{t.warrantyTrust}</div>
              <div className="text-[11px] text-slate-600 dark:text-slate-400">{t.warrantyTrustDesc}</div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 bg-[#f4f6f5]/80 dark:bg-[#17181c]/80 p-2.5 rounded-lg border border-[#e2e6e5] dark:border-[#30333b]">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold">
              <KeyRound className="w-3.5 h-3.5" />
            </div>
            <div>
              <div className="font-bold text-slate-800 dark:text-slate-200">{t.bestPrice}</div>
              <div className="text-[11px] text-slate-600 dark:text-slate-400">{t.bestPriceDesc}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
