import React, { useState } from 'react';
import { User, Product, Language } from '../types';
import { translations } from '../locales/translations';
import { UserCheck, Sparkles, PackagePlus, DollarSign, TrendingUp, Check } from 'lucide-react';

interface CtvPanelProps {
  isOpen: boolean;
  onClose: () => void;
  user: User;
  products: Product[];
  language: Language;
  onRefreshProducts: () => void;
}

export const CtvPanel: React.FC<CtvPanelProps> = ({
  isOpen,
  onClose,
  user,
  products,
  language,
  onRefreshProducts,
}) => {
  const t = translations[language];
  const [selectedProduct, setSelectedProduct] = useState(products[0]?.id || '');
  const [selectedVariant, setSelectedVariant] = useState(products[0]?.variants[0]?.id || '');
  const [rawText, setRawText] = useState('');
  const [importStatus, setImportStatus] = useState<string | null>(null);

  const handleImportStock = async () => {
    if (!rawText.trim()) return;
    try {
      const res = await fetch('/api/admin/stock/bulk-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: selectedProduct,
          variantId: selectedVariant,
          rawAccounts: rawText,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setImportStatus(`🎉 CTV đã bổ sung thành công ${data.importedCount} tài khoản vào kho!`);
        setRawText('');
        onRefreshProducts();
      } else {
        setImportStatus(`❌ Lỗi: ${data.error}`);
      }
    } catch (e) {
      setImportStatus('❌ Lỗi kết nối');
    }
  };

  if (!isOpen) return null;
  const currentProd = products.find((p) => p.id === selectedProduct) || products[0];

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-[#eceeed] dark:bg-[#23252a] border border-amber-500/40 rounded-2xl max-w-2xl w-full my-auto shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#e0e4e2] dark:border-[#33363e] flex items-center justify-between bg-[#eef1f0] dark:bg-[#1f2126]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <UserCheck className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">{t.ctvPanel}</h2>
              <p className="text-[11px] text-slate-600 dark:text-slate-400">Đặc quyền đối tác & Quản lý nguồn hàng CTV</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:dark:text-slate-100">
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          {/* CTV Privilege Banner — no automatic purchase discount anymore
              (removed); this now only describes what CTV actually gets:
              the ability to supply/manage their own stock below. */}
          <div className="p-3.5 bg-gradient-to-r from-amber-950/40 to-[#eceeed] dark:to-[#23252a] border border-amber-500/30 rounded-xl space-y-2">
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-amber-700 dark:text-amber-300 text-xs flex items-center gap-1.5">
                <Sparkles className="w-4 h-4" /> Đặc quyền đại lý CTV
              </span>
            </div>
            <p className="text-[11px] text-slate-700 dark:text-slate-300">
              Tài khoản của bạn ({user.username}) có thể tự nhập kho và bán tài khoản trực tiếp trên hệ thống — quản lý nguồn hàng ngay bên dưới.
            </p>
          </div>

          {/* CTV Stock Supplier Tool */}
          <div className="space-y-3 pt-2">
            <h3 className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
              <PackagePlus className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>Nạp thêm tài khoản vào gian hàng:</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-slate-600 dark:text-slate-400 block mb-1">Chọn sản phẩm:</label>
                <select
                  value={selectedProduct}
                  onChange={(e) => {
                    setSelectedProduct(e.target.value);
                    const p = products.find((prod) => prod.id === e.target.value);
                    if (p && p.variants[0]) setSelectedVariant(p.variants[0].id);
                  }}
                  className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee2e0] dark:border-[#363a43] rounded-lg p-2 text-xs text-slate-800 dark:text-slate-200 focus:outline-none"
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-slate-600 dark:text-slate-400 block mb-1">Chọn loại / biến thể:</label>
                <select
                  value={selectedVariant}
                  onChange={(e) => setSelectedVariant(e.target.value)}
                  className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee2e0] dark:border-[#363a43] rounded-lg p-2 text-xs text-slate-800 dark:text-slate-200 focus:outline-none"
                >
                  {currentProd?.variants.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} (${v.price.toFixed(2)})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="text-slate-600 dark:text-slate-400 block mb-1">Danh sách tài khoản (Mỗi dòng 1 acc):</label>
              <textarea
                rows={4}
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder="UID|Pass|2FA|Email|EmailPass|Cookie"
                className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee2e0] dark:border-[#363a43] rounded-lg p-2.5 font-mono text-xs text-emerald-700 dark:text-emerald-300 focus:outline-none focus:border-emerald-500"
              />
            </div>

            {importStatus && (
              <div className="p-3 bg-[#eef1f0] dark:bg-[#1f2126] border border-amber-500/40 rounded-lg text-amber-700 dark:text-amber-300 font-medium">
                {importStatus}
              </div>
            )}

            <button
              onClick={handleImportStock}
              className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-5 py-2.5 rounded-xl transition shadow flex items-center gap-1.5"
            >
              <span>Nạp vào kho</span>
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#e0e4e2] dark:border-[#33363e] bg-[#eef1f0] dark:bg-[#1f2126] flex justify-end">
          <button
            onClick={onClose}
            className="bg-[#e2e6e5] dark:bg-[#30333b] hover:bg-[#dde2e0] hover:dark:bg-[#373b43] text-slate-800 dark:text-slate-200 text-xs font-semibold px-5 py-2 rounded-lg transition"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
