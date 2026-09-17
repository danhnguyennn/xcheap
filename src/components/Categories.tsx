import React from 'react';
import { Language, Category } from '../types';
import { translations } from '../locales/translations';
import { Mail, Send, Music2, Wrench } from 'lucide-react';

interface CategoriesProps {
  language: Language;
  selectedCategory: string;
  onSelectCategory: (cat: string) => void;
  categoryCounts: Record<string, number>;
  categories: Category[];
}

// Icon per category `icon` key — a fixed set of hand-drawn glyphs matching
// the platforms this store actually sells, plus a generic fallback for any
// category an admin adds later with an icon key not in this list.
const ICONS: Record<string, React.ReactNode> = {
  twitter: (
    <div className="w-8 h-8 rounded-lg bg-[#e9eceb] dark:bg-[#27292f] text-sky-600 border border-sky-500/30 flex items-center justify-center">
      <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    </div>
  ),
  facebook: (
    <div className="w-8 h-8 rounded-lg bg-[#1a2b44] text-blue-600 dark:text-blue-400 border border-blue-500/30 flex items-center justify-center font-black text-sm">
      f
    </div>
  ),
  gmail: (
    <div className="w-8 h-8 rounded-lg bg-[#241315] text-red-600 dark:text-red-400 border border-red-500/30 flex items-center justify-center">
      <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
        <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" />
      </svg>
    </div>
  ),
  instagram: (
    <div className="w-8 h-8 rounded-lg bg-[#261324] text-pink-600 dark:text-pink-400 border border-pink-500/30 flex items-center justify-center">
      <svg className="w-3.5 h-3.5 fill-none stroke-current stroke-2" viewBox="0 0 24 24">
        <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
        <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
        <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
      </svg>
    </div>
  ),
  discord: (
    <div className="w-8 h-8 rounded-lg bg-[#14152e] text-indigo-600 dark:text-indigo-400 border border-indigo-500/30 flex items-center justify-center">
      <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
        <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.894.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
      </svg>
    </div>
  ),
  hotmail: (
    <div className="w-8 h-8 rounded-lg bg-[#0d1b2a] text-sky-500 dark:text-sky-400 border border-sky-500/30 flex items-center justify-center">
      <Mail className="w-3.5 h-3.5" />
    </div>
  ),
  tiktok: (
    <div className="w-8 h-8 rounded-lg bg-[#12131a] text-slate-100 border border-slate-400/30 flex items-center justify-center">
      <Music2 className="w-3.5 h-3.5" />
    </div>
  ),
  telegram: (
    <div className="w-8 h-8 rounded-lg bg-[#0e2233] text-cyan-500 dark:text-cyan-400 border border-cyan-500/30 flex items-center justify-center">
      <Send className="w-3.5 h-3.5" />
    </div>
  ),
  tool: (
    <div className="w-8 h-8 rounded-lg bg-[#241a10] text-amber-600 dark:text-amber-400 border border-amber-500/30 flex items-center justify-center">
      <Wrench className="w-3.5 h-3.5" />
    </div>
  ),
  other: (
    <div className="w-8 h-8 rounded-lg bg-[#f4f5f4] dark:bg-[#17191d] text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 flex items-center justify-center">
      <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
      </svg>
    </div>
  ),
};

export const Categories: React.FC<CategoriesProps> = ({
  language,
  selectedCategory,
  onSelectCategory,
  categoryCounts,
  categories,
}) => {
  const t = translations[language];

  const items = categories.map((cat) => ({
    id: cat.slug,
    name: cat.name,
    count: categoryCounts[cat.slug] || 0,
    icon: ICONS[cat.icon || 'other'] || ICONS.other,
  }));

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 pt-5 pb-2">
      <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 mb-3">
        {t.categoriesTitle}
      </h2>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2.5 sm:gap-3">
        {items.map((cat) => {
          const isSelected = selectedCategory === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => onSelectCategory(isSelected ? 'all' : cat.id)}
              className={`text-left p-3 rounded-xl border transition flex flex-col justify-between h-24 ${
                isSelected
                  ? 'bg-[#e6eae8] dark:bg-[#2a2d34] border-emerald-500 shadow-md shadow-emerald-500/10 text-slate-900 dark:text-slate-100'
                  : 'bg-[#ecefee] dark:bg-[#222429] border-[#e0e4e2] dark:border-[#33363e] hover:border-emerald-500/40 hover:bg-[#e8ebea] hover:dark:bg-[#282a30] text-slate-700 dark:text-slate-300'
              }`}
            >
              <div>{cat.icon}</div>
              <div>
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">{cat.name}</div>
                <div className="text-[11px] font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                  {cat.count} {t.productsCount}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
};
