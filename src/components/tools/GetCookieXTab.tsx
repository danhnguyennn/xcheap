import React, { useState, useRef } from 'react';
import { Cookie, Copy, Check, Play, Square, AlertCircle, RefreshCw } from 'lucide-react';
import { Language } from '../../types';
import { translations } from '../../locales/translations';

interface GetCookieXTabProps {
  language: Language;
}

interface CookieResult {
  id: number;
  input: string;
  username: string;
  outputLine: string;
  cookie: string | null;
  status: 'SUCCESS' | 'ERROR' | 'PROCESSING';
  error?: string;
}

export function parseXTokens(line: string): {
  username: string;
  oauthToken: string;
  oauthTokenSecret: string;
} {
  const cleanLine = line.trim();
  if (!cleanLine) {
    return { username: '', oauthToken: '', oauthTokenSecret: '' };
  }

  // Filter out any trailing cookie blob or empty strings
  const rawParts = cleanLine.split('|').map((p) => p.trim()).filter(Boolean);
  if (rawParts.length === 0) {
    return { username: '', oauthToken: '', oauthTokenSecret: '' };
  }

  const parts = rawParts.filter(
    (p) => !p.includes(';') && !p.toLowerCase().includes('auth_token=') && !p.toLowerCase().includes('ct0=')
  );

  let username = '';
  let oauthToken = '';
  let oauthTokenSecret = '';

  if (parts.length === 1) {
    username = parts[0].replace(/^@/, '');
  } else if (parts.length === 2) {
    oauthToken = parts[0];
    oauthTokenSecret = parts[1];
    username = parts[0];
  } else if (parts.length === 3) {
    username = parts[0].replace(/^@/, '');
    oauthToken = parts[1];
    oauthTokenSecret = parts[2];
  } else if (parts.length === 4) {
    username = parts[0].replace(/^@/, '');
    oauthToken = parts[2];
    oauthTokenSecret = parts[3];
  } else if (parts.length >= 5) {
    username = parts[0].replace(/^@/, '');
    oauthToken = parts[parts.length - 2];
    oauthTokenSecret = parts[parts.length - 1];
  }

  // Fallback: search backwards for token candidates if not found
  if (!oauthToken || !oauthTokenSecret) {
    const candidates = parts.filter(
      (p, idx) => idx > 0 && !p.includes('@') && p.length >= 15 && !p.includes(' ')
    );
    if (candidates.length >= 2) {
      oauthToken = candidates[candidates.length - 2];
      oauthTokenSecret = candidates[candidates.length - 1];
    }
  }

  return {
    username: username.replace(/^@/, ''),
    oauthToken,
    oauthTokenSecret,
  };
}

const DEFAULT_CONCURRENCY = 10;

export const GetCookieXTab: React.FC<GetCookieXTabProps> = ({ language }) => {
  const t = translations[language];
  const [inputRaw, setInputRaw] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<CookieResult[]>([]);
  const [processedCount, setProcessedCount] = useState(0);
  const [copiedLineIdx, setCopiedLineIdx] = useState<number | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedOnlyCookies, setCopiedOnlyCookies] = useState(false);
  const [copiedFailed, setCopiedFailed] = useState(false);
  const stopSignalRef = useRef(false);

  const lines = inputRaw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const handleStart = async () => {
    if (lines.length === 0) return;
    setIsRunning(true);
    stopSignalRef.current = false;
    setProcessedCount(0);

    const initialResults: CookieResult[] = lines.map((line, idx) => {
      const parsed = parseXTokens(line);
      const label = parsed.username || line.split('|')[0] || t.toolsLineNumberTemplate.replace('{n}', String(idx + 1));
      return {
        id: idx + 1,
        input: line,
        username: parsed.username,
        outputLine: `${label} | ${t.toolsProcessingSuffix}`,
        cookie: null,
        status: 'PROCESSING',
      };
    });
    setResults(initialResults);

    let nextQueueIndex = 0;

    const processItem = async (index: number) => {
      if (stopSignalRef.current) return;
      const line = lines[index];
      const parsed = parseXTokens(line);
      const itemLabel = parsed.username || line.split('|')[0] || line;

      try {
        const res = await fetch('/api/tools/x-get-cookie', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: parsed.username,
            oauth_token: parsed.oauthToken,
            oauth_token_secret: parsed.oauthTokenSecret,
            raw_line: line,
          }),
        });
        const data = await res.json();

        setResults((prev) => {
          const next = [...prev];
          if (data.success && data.cookie) {
            next[index] = {
              id: index + 1,
              input: line,
              username: parsed.username,
              outputLine: `${itemLabel} | ${data.cookie}`,
              cookie: data.cookie,
              status: 'SUCCESS',
            };
          } else {
            next[index] = {
              id: index + 1,
              input: line,
              username: parsed.username,
              outputLine: `${itemLabel} | ${t.toolsFailedSuffix}`,
              cookie: null,
              status: 'ERROR',
              error: t.toolsFailedSuffix,
            };
          }
          return next;
        });
      } catch (err: any) {
        setResults((prev) => {
          const next = [...prev];
          next[index] = {
            id: index + 1,
            input: line,
            username: parsed.username,
            outputLine: `${itemLabel} | ${t.toolsFailedSuffix}`,
            cookie: null,
            status: 'ERROR',
            error: t.toolsFailedSuffix,
          };
          return next;
        });
      } finally {
        setProcessedCount((prev) => prev + 1);
      }
    };

    const worker = async () => {
      while (nextQueueIndex < lines.length) {
        if (stopSignalRef.current) break;
        const currentIndex = nextQueueIndex++;
        await processItem(currentIndex);
      }
    };

    const workerCount = Math.min(DEFAULT_CONCURRENCY, lines.length);
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

  const handleCopyOnlyCookies = () => {
    const valid = results.filter((r) => r.status === 'SUCCESS' && r.cookie).map((r) => r.outputLine).join('\n');
    if (!valid) return;
    navigator.clipboard.writeText(valid);
    setCopiedOnlyCookies(true);
    setTimeout(() => setCopiedOnlyCookies(false), 2000);
  };

  const handleCopyFailed = () => {
    const failed = results.filter((r) => r.status === 'ERROR').map((r) => r.outputLine).join('\n');
    if (!failed) return;
    navigator.clipboard.writeText(failed);
    setCopiedFailed(true);
    setTimeout(() => setCopiedFailed(false), 2000);
  };

  const successCount = results.filter((r) => r.status === 'SUCCESS').length;
  const errorCount = results.filter((r) => r.status === 'ERROR').length;

  return (
    <div className="space-y-3.5">
      {/* Input area */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
          <label className="font-bold text-slate-800 dark:text-slate-200 text-xs flex items-center gap-1.5">
            <Cookie className="w-3.5 h-3.5 text-amber-500" />
            <span>{t.toolsGetCookieInputLabel}</span>
          </label>
          <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
            {lines.length} {t.toolsLinesCountSuffix}
          </span>
        </div>

        <textarea
          rows={4}
          value={inputRaw}
          onChange={(e) => setInputRaw(e.target.value)}
          placeholder={`username|oauth_token|oauth_token_secret\nusername|oauth_token|oauth_token_secret\nusername|oauth_token|oauth_token_secret`}
          disabled={isRunning}
          className="w-full bg-[#f5f6f6] dark:bg-[#16181b] border border-[#e2e6e5] dark:border-[#30333b] rounded-xl p-3 font-mono text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-emerald-500 disabled:opacity-60"
        />
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
          {t.toolsFormatLabel} <code className="text-emerald-700 dark:text-emerald-300 font-mono">username|oauth_token|oauth_token_secret</code>, {t.toolsOneAccountPerLineSuffix}
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
            <span>{t.toolsGetCookieStartBtn}</span>
          </button>
        ) : (
          <button
            onClick={handleStop}
            className="bg-rose-600 hover:bg-rose-500 text-white font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-2 transition cursor-pointer shadow-sm"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            <span>{t.toolsStopBtnTemplate.replace('{current}', String(processedCount)).replace('{total}', String(lines.length))}</span>
          </button>
        )}

        {inputRaw && !isRunning && (
          <button
            onClick={() => {
              setInputRaw('');
              setResults([]);
              setProcessedCount(0);
            }}
            className="px-3 py-2 rounded-xl text-xs font-semibold bg-[#e7ebe9] dark:bg-[#282a30] text-slate-700 dark:text-slate-300 hover:bg-[#dee2e0] hover:dark:bg-[#32353d] transition cursor-pointer"
          >
            {t.toolsClearDataBtn}
          </button>
        )}
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-2.5 pt-2 border-t border-[#e2e6e5] dark:border-[#30333b]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                {t.toolsGetCookieResultsLabel}
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30">
                {t.toolsSuccessCountTemplate.replace('{n}', String(successCount))}
              </span>
              {errorCount > 0 && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-700 dark:text-rose-400 border border-rose-500/30">
                  {t.toolsFailCountTemplate.replace('{n}', String(errorCount))}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              {successCount > 0 && (
                <button
                  onClick={handleCopyOnlyCookies}
                  className="text-emerald-700 dark:text-emerald-300 hover:text-slate-900 hover:dark:text-slate-100 text-xs font-semibold flex items-center gap-1.5 bg-[#f2f4f3] dark:bg-[#1a1b1f] px-2.5 py-1.5 rounded-lg border border-[#e2e6e5] dark:border-[#30333b] cursor-pointer"
                  title={t.toolsCopyValidCookiesTooltip}
                >
                  {copiedOnlyCookies ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                      <span>{t.toolsCopiedCookieLabel}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>{t.toolsCopyValidCookiesBtn}</span>
                    </>
                  )}
                </button>
              )}

              {errorCount > 0 && (
                <button
                  onClick={handleCopyFailed}
                  className="text-rose-700 dark:text-rose-300 hover:text-slate-900 hover:dark:text-slate-100 text-xs font-semibold flex items-center gap-1.5 bg-[#f2f4f3] dark:bg-[#1a1b1f] px-2.5 py-1.5 rounded-lg border border-[#e2e6e5] dark:border-[#30333b] cursor-pointer"
                  title={t.toolsCopyFailedTooltip}
                >
                  {copiedFailed ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
                      <span>{t.toolsCopiedFailedLabel}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>{t.toolsCopyFailedBtn}</span>
                    </>
                  )}
                </button>
              )}

              <button
                onClick={handleCopyAll}
                className="text-slate-700 dark:text-slate-300 hover:text-slate-900 hover:dark:text-slate-100 text-xs font-semibold flex items-center gap-1.5 bg-[#f2f4f3] dark:bg-[#1a1b1f] px-2.5 py-1.5 rounded-lg border border-[#e2e6e5] dark:border-[#30333b] cursor-pointer"
                title={t.toolsCopyAllBtn || 'Copy Tất Cả'}
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
            {results.map((item, idx) => {
              const isSuccess = item.status === 'SUCCESS';
              const isProcessing = item.status === 'PROCESSING';

              return (
                <div
                  key={idx}
                  className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-[#e2e6e5] dark:border-[#30333b] bg-[#fafcfb] dark:bg-[#181a1e] hover:border-emerald-500/30 transition text-xs group"
                >
                  <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400 bg-[#e7ebe9] dark:bg-[#282a30] px-1.5 py-0.5 rounded font-bold flex-shrink-0">
                    #{item.id}
                  </span>

                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 whitespace-nowrap ${
                      isSuccess
                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30'
                        : isProcessing
                        ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30'
                        : 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border border-rose-500/30'
                    }`}
                  >
                    {isSuccess ? t.toolsSuccessStatusBadge : isProcessing ? t.toolsProcessingStatusBadge : t.toolsFailedStatusBadge}
                  </span>

                  <span
                    className="font-mono text-xs text-slate-800 dark:text-slate-200 truncate flex-1 min-w-0 select-all cursor-text"
                    title={item.outputLine}
                  >
                    {item.outputLine}
                  </span>

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
