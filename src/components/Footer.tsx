import React from 'react';
import { Language } from '../types';
import { translations } from '../locales/translations';

interface FooterProps {
  language: Language;
  onOpenTerms: () => void;
  onOpenPrivacy: () => void;
}

export const Footer: React.FC<FooterProps> = ({ language, onOpenTerms, onOpenPrivacy }) => {
  const t = translations[language];

  return (
    <footer className="border-t border-[#e8ebea] dark:border-[#282a30] bg-[#f6f7f6] dark:bg-[#151619] py-8 text-xs text-slate-600 dark:text-slate-400">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-6 border-b border-[#e8ebea] dark:border-[#282a30]">
          {/* Left disclaimer */}
          <div className="space-y-1 text-slate-700 dark:text-slate-300">
            <p className="text-slate-800 dark:text-slate-200 font-medium">{t.footerDisclaimer1}</p>
            <p className="text-slate-600 dark:text-slate-400">{t.footerDisclaimer2}</p>
          </div>

          {/* Right legal links — in-app navigation (same tab) rather than a
              plain <a> to a new tab, so it behaves like the rest of the SPA's
              page transitions. */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-6 text-slate-600 dark:text-slate-400">
            <button type="button" onClick={onOpenTerms} className="text-left hover:text-emerald-600 hover:dark:text-emerald-400 transition">
              - {t.termsOfService}
            </button>
            <button type="button" onClick={onOpenPrivacy} className="text-left hover:text-emerald-600 hover:dark:text-emerald-400 transition">
              - {t.privacyPolicy}
            </button>
          </div>
        </div>

        {/* Copyright notice */}
        <div className="text-center pt-5 text-slate-600 dark:text-slate-400 text-[11px]">
          {t.copyright}
        </div>
      </div>
    </footer>
  );
};
