import React, { useState, useEffect } from 'react';
import { Product, Language } from '../types';
import { translations } from '../locales/translations';
import { Eye, ShieldAlert, RefreshCw, Copy, Check } from 'lucide-react';

interface RandomSampleModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: Product | null;
  language: Language;
}

export const RandomSampleModal: React.FC<RandomSampleModalProps> = ({
  isOpen,
  onClose,
  product,
  language,
}) => {
  const t = translations[language];
  const [sample, setSample] = useState<string>('');
  const [remainingViews, setRemainingViews] = useState<number>(5);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);

  const fetchSample = async () => {
    if (!product) return;
    setLoading(true);
    setError('');

    try {
      const res = await fetch(`/api/products/${product.id}/sample`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t.rsmViewLimitReached);
      } else {
        setSample(data.sample);
        setRemainingViews(data.remainingViews);
      }
    } catch (err) {
      setError(t.rsmLoadError);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && product) {
      fetchSample();
    }
  }, [isOpen, product]);

  const handleCopy = () => {
    navigator.clipboard.writeText(sample);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isOpen || !product) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[#eef0ef] dark:bg-[#202227] border border-[#e1e4e3] dark:border-[#32363e] rounded-2xl max-w-lg w-full shadow-2xl p-5 sm:p-6">
        <div className="flex items-center justify-between pb-3 border-b border-[#e1e4e3] dark:border-[#32363e] mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[#eceeed] dark:bg-[#23252a] border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <Eye className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">{t.viewRandomSample}</h3>
              <p className="text-[11px] text-slate-600 dark:text-slate-400">{product.name}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:dark:text-slate-100">
            ✕
          </button>
        </div>

        {error ? (
          <div className="p-3 bg-red-50 dark:bg-red-950/70 border border-red-500/40 rounded-xl text-xs text-red-800 dark:text-red-200 flex items-center gap-2 mb-4">
            <ShieldAlert className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0" />
            <span>{error}</span>
          </div>
        ) : (
          <div className="space-y-3 mb-4">
            <div className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-400">
              <span>{t.rsmSampleLabel}</span>
              <span className="text-emerald-600 dark:text-emerald-400 font-mono font-semibold">
                {t.rsmRemainingTemplate.replace('{n}', String(remainingViews))}
              </span>
            </div>

            <div className="p-3 bg-[#f2f4f3] dark:bg-[#1a1b1f] border border-[#e2e6e5] dark:border-[#30333b] rounded-xl relative">
              {loading ? (
                <div className="py-4 text-center text-slate-600 dark:text-slate-400 flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-emerald-600 dark:text-emerald-400" />
                  <span>{t.rsmFetching}</span>
                </div>
              ) : (
                <>
                  <p className="font-mono text-sm font-bold text-emerald-700 dark:text-emerald-300 break-all select-all leading-relaxed">
                    {sample}
                  </p>
                  <button
                    onClick={handleCopy}
                    className="mt-2 text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 hover:dark:text-emerald-300 text-[11px] font-semibold flex items-center gap-1"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? t.copied : t.pdCopyUserTitle}</span>
                  </button>
                </>
              )}
            </div>

            <div className="p-2.5 bg-[#f2f4f3] dark:bg-[#1a1b1f] border border-[#e2e6e5] dark:border-[#30333b] rounded-lg text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
              {t.rsmDisclaimer}
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#e1e4e3] dark:border-[#32363e]">
          <button
            onClick={fetchSample}
            disabled={loading || remainingViews <= 0}
            className="bg-[#e7ebe9] dark:bg-[#292b31] hover:bg-[#dee3e1] hover:dark:bg-[#363941] border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition disabled:opacity-40"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>{t.rsmGetAnother}</span>
          </button>
          <button
            onClick={onClose}
            className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-slate-950 text-xs font-bold px-4 py-1.5 rounded-lg transition shadow-md shadow-emerald-500/20"
          >
            {t.closeBtn}
          </button>
        </div>
      </div>
    </div>
  );
};
