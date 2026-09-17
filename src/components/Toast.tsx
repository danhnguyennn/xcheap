import React, { useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';

interface ToastItem {
  id: number;
  message: string;
}

// Module-level pub/sub so any component — however deep, without prop
// drilling or a context provider — can trigger a toast just by importing
// `showCopyToast`. <ToastContainer /> is mounted once at the app root and
// is the only thing that actually renders anything.
let listeners: ((item: ToastItem) => void)[] = [];
let idCounter = 0;

export function showCopyToast(message: string) {
  const item: ToastItem = { id: ++idCounter, message };
  listeners.forEach((listener) => listener(item));
}

export const ToastContainer: React.FC = () => {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const handler = (item: ToastItem) => {
      setItems((prev) => [...prev, item]);
      setTimeout(() => {
        setItems((prev) => prev.filter((i) => i.id !== item.id));
      }, 2500);
    };
    listeners.push(handler);
    return () => {
      listeners = listeners.filter((l) => l !== handler);
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 items-end pointer-events-none">
      {items.map((item) => (
        <div
          key={item.id}
          className="pointer-events-auto flex items-center gap-2 bg-[#1a1b1f] dark:bg-[#eceeed] text-slate-100 dark:text-slate-900 text-xs font-semibold pl-2.5 pr-3.5 py-2.5 rounded-xl shadow-2xl border border-emerald-500/40"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
          <span>{item.message}</span>
        </div>
      ))}
    </div>
  );
};
