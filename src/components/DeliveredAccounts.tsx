import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { showCopyToast } from './Toast';

interface DeliveredAccountsProps {
  accounts: string[];
  copyLabel: string;
  copiedLabel: string;
  copiedToastMessage: string;
}

// One account = one row, exactly as delivered (full raw "|"-separated
// string) — no attempt to split it into labeled fields, so the row a user
// copies is always identical to what they see.
export const DeliveredAccounts: React.FC<DeliveredAccountsProps> = ({ accounts, copyLabel, copiedLabel, copiedToastMessage }) => {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const copyOne = (line: string, idx: number) => {
    navigator.clipboard.writeText(line);
    setCopiedIdx(idx);
    showCopyToast(copiedToastMessage);
    setTimeout(() => setCopiedIdx((current) => (current === idx ? null : current)), 2000);
  };

  return (
    <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
      {accounts.map((line, idx) => (
        <div
          key={idx}
          className="flex items-center gap-2 bg-[#f5f6f6] dark:bg-[#16181b] border border-[#e2e6e5] dark:border-[#30333b] rounded-lg px-2.5 py-1.5"
        >
          {accounts.length > 1 && (
            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-500 flex-shrink-0">#{idx + 1}</span>
          )}
          {/* 1 tài khoản = 1 dòng, cắt gọn kèm "..." khi không đủ chỗ thay vì
              xuống dòng hiển thị hết toàn bộ chuỗi thông tin — nút Copy vẫn
              luôn sao chép đúng nguyên văn dòng đầy đủ, chỉ phần hiển thị bị
              rút gọn. Hover vào (desktop) vẫn xem được toàn bộ qua title. */}
          <span
            title={line}
            className="flex-1 min-w-0 font-mono text-[11px] text-emerald-700 dark:text-emerald-300 truncate select-all"
          >
            {line}
          </span>
          <button
            onClick={() => copyOne(line, idx)}
            title={copiedIdx === idx ? copiedLabel : copyLabel}
            className="flex-shrink-0 text-slate-500 dark:text-slate-500 hover:text-emerald-600 hover:dark:text-emerald-400 transition"
          >
            {copiedIdx === idx ? <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      ))}
    </div>
  );
};
