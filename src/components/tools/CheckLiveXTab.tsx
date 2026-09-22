import React, { useState, useRef } from 'react';
import { ShieldCheck, Copy, Check, Play, Square } from 'lucide-react';
import { Language } from '../../types';
import { translations } from '../../locales/translations';
import { parseXTokens } from './GetCookieXTab';

interface CheckLiveXTabProps {
  language: Language;
}

export type AccountCheckStatus = 'LIVE' | 'TEMPORARILY' | 'WRONG' | 'SUPPEND' | 'DIE' | 'CHECKING';

export interface CheckLiveResult {
  id: number;
  input: string;
  username: string;
  isLive: boolean;
  status: AccountCheckStatus;
  rawStatus?: 'LIVE' | 'WRONG' | 'SUPPEND' | 'TEMPORARILY' | 'ERROR';
  reason?: string;
  following?: number;
  followers?: number;
  post?: number;
  created_at?: string;
  outputLine: string;
}

export const CheckLiveXTab: React.FC<CheckLiveXTabProps> = ({ language }) => {
  const t = translations[language];
  const [inputRaw, setInputRaw] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<CheckLiveResult[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [filter, setFilter] = useState<'ALL' | 'LIVE' | 'TEMPORARILY' | 'WRONG' | 'DIE'>('ALL');
  
  const [copiedLineIdx, setCopiedLineIdx] = useState<number | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedLive, setCopiedLive] = useState(false);
  const [copiedTemporarily, setCopiedTemporarily] = useState(false);
  const [copiedWrong, setCopiedWrong] = useState(false);
  const [copiedDie, setCopiedDie] = useState(false);
  
  const stopSignalRef = useRef(false);

  const lines = inputRaw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  // Default fixed 10 threads without UI selector
  const CONCURRENCY = 10;

  const handleStart = async () => {
    if (lines.length === 0) return;
    setIsRunning(true);
    stopSignalRef.current = false;

    const initialResults: CheckLiveResult[] = lines.map((line, idx) => {
      const parsed = parseXTokens(line);
      return {
        id: idx + 1,
        input: line,
        username: parsed.username,
        isLive: false,
        status: 'CHECKING',
        outputLine: line,
        reason: 'Đang kiểm tra...',
      };
    });
    setResults(initialResults);
    setCurrentIndex(0);

    let nextQueueIndex = 0;

    const processItem = async (index: number) => {
      if (stopSignalRef.current) return;
      const line = lines[index];
      const parsed = parseXTokens(line);

      try {
        const res = await fetch('/api/tools/x-check-live', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: parsed.username,
            raw_line: line,
          }),
        });
        const data = await res.json();

        setResults((prev) => {
          const next = [...prev];
          const isLive = data.isLive === true || data.status === 'LIVE';
          
          let status: AccountCheckStatus = 'DIE';
          if (isLive) {
            status = 'LIVE';
          } else if (data.status === 'TEMPORARILY' || data.rawStatus === 'TEMPORARILY') {
            status = 'TEMPORARILY';
          } else if (data.status === 'WRONG' || data.rawStatus === 'WRONG') {
            status = 'WRONG';
          } else if (data.status === 'SUPPEND' || data.rawStatus === 'SUPPEND') {
            status = 'SUPPEND';
          } else {
            status = 'DIE';
          }

          next[index] = {
            id: index + 1,
            input: line,
            username: data.username || parsed.username,
            isLive,
            status,
            rawStatus: data.rawStatus,
            following: data.following,
            followers: data.followers,
            post: data.post,
            created_at: data.created_at,
            reason: data.reason || (isLive ? 'Hoạt động' : 'Tài khoản không khả dụng'),
            outputLine: line,
          };
          return next;
        });
      } catch (err: any) {
        setResults((prev) => {
          const next = [...prev];
          next[index] = {
            id: index + 1,
            input: line,
            username: parsed.username,
            isLive: false,
            status: 'DIE',
            rawStatus: 'ERROR',
            reason: err.message || 'Lỗi kết nối',
            outputLine: line,
          };
          return next;
        });
      } finally {
        setCurrentIndex((prev) => prev + 1);
      }
    };

    const worker = async () => {
      while (nextQueueIndex < lines.length) {
        if (stopSignalRef.current) break;
        const currentQueue = nextQueueIndex++;
        await processItem(currentQueue);
      }
    };

    const workerCount = Math.min(CONCURRENCY, lines.length);
    const workers = Array.from({ length: workerCount }, () => worker());
    await Promise.all(workers);

    setIsRunning(false);
  };

  const handleStop = () => {
    stopSignalRef.current = true;
    setIsRunning(false);
  };

  const handleCopyLine = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedLineIdx(idx);
    setTimeout(() => setCopiedLineIdx(null), 2000);
  };

  const handleCopyAll = () => {
    if (results.length === 0) return;
    const all = results.map((r) => r.outputLine).join('\n');
    navigator.clipboard.writeText(all);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const handleCopyLive = () => {
    const liveItems = results.filter((r) => r.status === 'LIVE');
    if (liveItems.length === 0) return;
    navigator.clipboard.writeText(liveItems.map((r) => r.outputLine).join('\n'));
    setCopiedLive(true);
    setTimeout(() => setCopiedLive(false), 2000);
  };

  const handleCopyTemporarily = () => {
    const tempItems = results.filter((r) => r.status === 'TEMPORARILY');
    if (tempItems.length === 0) return;
    navigator.clipboard.writeText(tempItems.map((r) => r.outputLine).join('\n'));
    setCopiedTemporarily(true);
    setTimeout(() => setCopiedTemporarily(false), 2000);
  };

  const handleCopyWrong = () => {
    const wrongItems = results.filter((r) => r.status === 'WRONG' || r.rawStatus === 'WRONG');
    if (wrongItems.length === 0) return;
    navigator.clipboard.writeText(wrongItems.map((r) => r.outputLine).join('\n'));
    setCopiedWrong(true);
    setTimeout(() => setCopiedWrong(false), 2000);
  };

  const handleCopyDie = () => {
    const dieItems = results.filter(
      (r) =>
        r.status === 'DIE' ||
        r.status === 'SUPPEND' ||
        r.rawStatus === 'ERROR'
    );
    if (dieItems.length === 0) return;
    navigator.clipboard.writeText(dieItems.map((r) => r.outputLine).join('\n'));
    setCopiedDie(true);
    setTimeout(() => setCopiedDie(false), 2000);
  };

  const liveCount = results.filter((r) => r.status === 'LIVE').length;
  const temporarilyCount = results.filter((r) => r.status === 'TEMPORARILY').length;
  const wrongCount = results.filter((r) => r.status === 'WRONG' || r.rawStatus === 'WRONG').length;
  const dieCount = results.filter(
    (r) =>
      r.status === 'DIE' ||
      r.status === 'SUPPEND' ||
      r.rawStatus === 'ERROR'
  ).length;

  const filteredResults = results.filter((r) => {
    if (filter === 'LIVE') return r.status === 'LIVE';
    if (filter === 'TEMPORARILY') return r.status === 'TEMPORARILY';
    if (filter === 'WRONG') return r.status === 'WRONG' || r.rawStatus === 'WRONG';
    if (filter === 'DIE') {
      return (
        r.status === 'DIE' ||
        r.status === 'SUPPEND' ||
        r.rawStatus === 'ERROR'
      );
    }
    return true;
  });

  return (
    <div className="space-y-3.5">
      {/* Input area */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-1">
          <label className="font-bold text-slate-800 dark:text-slate-200 text-xs flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
            <span>Danh sách tài khoản X (Twitter) cần kiểm tra:</span>
          </label>
          <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
            {lines.length} dòng
          </span>
        </div>

        <textarea
          rows={5}
          value={inputRaw}
          onChange={(e) => setInputRaw(e.target.value)}
          placeholder={`username|password|2fa|oauth_token|oauth_token_secret\noauth_token|oauth_token_secret\nusername`}
          disabled={isRunning}
          className="w-full bg-[#f5f6f6] dark:bg-[#16181b] border border-[#e2e6e5] dark:border-[#30333b] rounded-xl p-3 font-mono text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-emerald-500 disabled:opacity-60"
        />
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
          Hỗ trợ: <code className="text-emerald-700 dark:text-emerald-300 font-mono">username|password|2fa|oauth_token|oauth_secret</code>, <code className="text-emerald-700 dark:text-emerald-300 font-mono">oauth_token|oauth_secret</code>, hoặc <code className="text-emerald-700 dark:text-emerald-300 font-mono">username</code>.
        </p>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap items-center gap-2">
        {!isRunning ? (
          <button
            onClick={handleStart}
            disabled={lines.length === 0}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-2 transition cursor-pointer shadow-sm"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Kiểm Tra Live X</span>
          </button>
        ) : (
          <button
            onClick={handleStop}
            className="bg-rose-600 hover:bg-rose-500 text-white font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-2 transition cursor-pointer shadow-sm"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            <span>Dừng Lại ({currentIndex}/{lines.length})</span>
          </button>
        )}

        {inputRaw && !isRunning && (
          <button
            onClick={() => {
              setInputRaw('');
              setResults([]);
            }}
            className="px-3 py-2 rounded-xl text-xs font-semibold bg-[#e7ebe9] dark:bg-[#282a30] text-slate-700 dark:text-slate-300 hover:bg-[#dee2e0] hover:dark:bg-[#32353d] transition cursor-pointer"
          >
            Xóa Dữ Liệu
          </button>
        )}
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-2.5 pt-2 border-t border-[#e2e6e5] dark:border-[#30333b]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* Filter buttons */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => setFilter('ALL')}
                className={`text-xs px-2.5 py-1 rounded-lg font-bold transition cursor-pointer ${
                  filter === 'ALL'
                    ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900'
                    : 'bg-[#e7ebe9] dark:bg-[#282a30] text-slate-600 dark:text-slate-400'
                }`}
              >
                Tất cả ({results.length})
              </button>

              <button
                onClick={() => setFilter('LIVE')}
                className={`text-xs px-2.5 py-1 rounded-lg font-bold transition cursor-pointer ${
                  filter === 'LIVE'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30'
                }`}
              >
                LIVE ({liveCount})
              </button>

              {/* Status TEMPORARILY */}
              <button
                onClick={() => setFilter('TEMPORARILY')}
                className={`text-xs px-2.5 py-1 rounded-lg font-bold transition cursor-pointer ${
                  filter === 'TEMPORARILY'
                    ? 'bg-amber-600 text-white'
                    : 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30'
                }`}
              >
                TEMPORARILY ({temporarilyCount})
              </button>

              {/* Status WRONG */}
              <button
                onClick={() => setFilter('WRONG')}
                className={`text-xs px-2.5 py-1 rounded-lg font-bold transition cursor-pointer ${
                  filter === 'WRONG'
                    ? 'bg-purple-600 text-white'
                    : 'bg-purple-500/15 text-purple-700 dark:text-purple-400 border border-purple-500/30'
                }`}
              >
                WRONG ({wrongCount})
              </button>

              {/* Status DIE */}
              <button
                onClick={() => setFilter('DIE')}
                className={`text-xs px-2.5 py-1 rounded-lg font-bold transition cursor-pointer ${
                  filter === 'DIE'
                    ? 'bg-rose-600 text-white'
                    : 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border border-rose-500/30'
                }`}
              >
                DIE ({dieCount})
              </button>
            </div>

            {/* Copy buttons */}
            <div className="flex flex-wrap items-center gap-1.5">
              {liveCount > 0 && (
                <button
                  onClick={handleCopyLive}
                  className="text-emerald-700 dark:text-emerald-300 hover:text-slate-900 hover:dark:text-slate-100 text-xs font-semibold flex items-center gap-1.5 bg-[#f2f4f3] dark:bg-[#1a1b1f] px-2.5 py-1.5 rounded-lg border border-[#e2e6e5] dark:border-[#30333b] cursor-pointer"
                  title="Copy tài khoản LIVE"
                >
                  {copiedLive ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                      <span>Đã chép LIVE</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy LIVE ({liveCount})</span>
                    </>
                  )}
                </button>
              )}

              {temporarilyCount > 0 && (
                <button
                  onClick={handleCopyTemporarily}
                  className="text-amber-700 dark:text-amber-400 hover:text-slate-900 hover:dark:text-slate-100 text-xs font-semibold flex items-center gap-1.5 bg-[#f2f4f3] dark:bg-[#1a1b1f] px-2.5 py-1.5 rounded-lg border border-[#e2e6e5] dark:border-[#30333b] cursor-pointer"
                  title="Copy tài khoản TEMPORARILY"
                >
                  {copiedTemporarily ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                      <span>Đã chép TEMPORARILY</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy TEMPORARILY ({temporarilyCount})</span>
                    </>
                  )}
                </button>
              )}

              {wrongCount > 0 && (
                <button
                  onClick={handleCopyWrong}
                  className="text-purple-700 dark:text-purple-400 hover:text-slate-900 hover:dark:text-slate-100 text-xs font-semibold flex items-center gap-1.5 bg-[#f2f4f3] dark:bg-[#1a1b1f] px-2.5 py-1.5 rounded-lg border border-[#e2e6e5] dark:border-[#30333b] cursor-pointer"
                  title="Copy tài khoản WRONG (không tồn tại)"
                >
                  {copiedWrong ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                      <span>Đã chép WRONG</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy WRONG ({wrongCount})</span>
                    </>
                  )}
                </button>
              )}

              {dieCount > 0 && (
                <button
                  onClick={handleCopyDie}
                  className="text-rose-700 dark:text-rose-400 hover:text-slate-900 hover:dark:text-slate-100 text-xs font-semibold flex items-center gap-1.5 bg-[#f2f4f3] dark:bg-[#1a1b1f] px-2.5 py-1.5 rounded-lg border border-[#e2e6e5] dark:border-[#30333b] cursor-pointer"
                  title="Copy tài khoản DIE"
                >
                  {copiedDie ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
                      <span>Đã chép DIE</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy DIE ({dieCount})</span>
                    </>
                  )}
                </button>
              )}

              <button
                onClick={handleCopyAll}
                className="text-slate-700 dark:text-slate-300 hover:text-slate-900 hover:dark:text-slate-100 text-xs font-semibold flex items-center gap-1.5 bg-[#f2f4f3] dark:bg-[#1a1b1f] px-2.5 py-1.5 rounded-lg border border-[#e2e6e5] dark:border-[#30333b] cursor-pointer"
                title="Copy tất cả"
              >
                {copiedAll ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    <span>{t.toolsCopiedAll || 'Đã chép tất cả'}</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>{t.toolsCopyAllBtn || 'Copy Tất Cả'}</span>
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
            {filteredResults.map((item, idx) => {
              const isLive = item.status === 'LIVE';
              const isTemporarily = item.status === 'TEMPORARILY' || item.rawStatus === 'TEMPORARILY';
              const isWrong = item.status === 'WRONG' || item.rawStatus === 'WRONG';
              const isSuspend = item.status === 'SUPPEND' || item.rawStatus === 'SUPPEND';
              const isChecking = item.status === 'CHECKING';

              return (
                <div
                  key={idx}
                  className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-[#e2e6e5] dark:border-[#30333b] bg-[#fafcfb] dark:bg-[#181a1e] hover:border-emerald-500/30 transition text-xs group"
                >
                  <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400 bg-[#e7ebe9] dark:bg-[#282a30] px-1.5 py-0.5 rounded font-bold flex-shrink-0">
                    #{item.id}
                  </span>

                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 font-mono uppercase ${
                      isLive
                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30'
                        : isTemporarily
                        ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30'
                        : isWrong
                        ? 'bg-purple-500/15 text-purple-700 dark:text-purple-400 border border-purple-500/30'
                        : isSuspend
                        ? 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border border-rose-500/30'
                        : isChecking
                        ? 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border border-blue-500/30'
                        : 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border border-rose-500/30'
                    }`}
                  >
                    {isLive
                      ? 'LIVE'
                      : isTemporarily
                      ? 'TEMPORARILY'
                      : isWrong
                      ? 'WRONG'
                      : isSuspend
                      ? 'SUSPEND'
                      : isChecking
                      ? 'CHECK'
                      : 'DIE'}
                  </span>

                  <span
                    className="font-mono text-xs text-slate-800 dark:text-slate-200 truncate flex-1 min-w-0 select-all cursor-text"
                    title={`${item.outputLine} - ${item.reason || ''}`}
                  >
                    {item.outputLine}
                  </span>

                  {item.reason && (
                    <span className="hidden sm:inline text-[10px] text-slate-500 dark:text-slate-400 flex-shrink-0 font-mono">
                      {item.reason}
                    </span>
                  )}

                  <button
                    onClick={() => handleCopyLine(item.outputLine, idx)}
                    className="text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-[#e7ebe9] dark:hover:bg-[#282a30] p-1.5 rounded transition flex-shrink-0 cursor-pointer"
                    title={t.toolsCopyShort || 'Copy'}
                  >
                    {copiedLineIdx === idx ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
