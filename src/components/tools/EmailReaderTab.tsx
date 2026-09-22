import React, { useState, useRef } from 'react';
import {
  Mail,
  Key,
  Copy,
  Check,
  RefreshCw,
  Play,
  Square,
  Trash2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Inbox,
  ChevronDown,
  ChevronUp,
  FileText,
  ShieldAlert,
} from 'lucide-react';
import { EmailDetailModal, EmailDetailData } from './EmailDetailModal';
import { Language } from '../../types';
import { translations } from '../../locales/translations';

export interface EmailMessage {
  id: string;
  from?: string;
  sender?: string;
  to?: string;
  subject?: string;
  date?: string;
  time?: string;
  body?: string;
  text?: string;
  html?: string;
  content?: string;
  otpCode?: string | null;
  raw?: any;
}

export interface AccountGroup {
  id: string;
  email: string;
  password?: string;
  refreshToken: string;
  clientId: string;
  rawLine: string;
  status: 'idle' | 'reading' | 'success' | 'die' | 'error';
  errorMessage?: string;
  messages: EmailMessage[];
  lastChecked?: string;
  isExpanded?: boolean;
}

// Robust OTP extractor
export function detectOtp(subject: string = '', content: string = ''): string | null {
  const combined = `${subject}\n${content}`;

  // 1. Explicit keyword + 4-8 alphanumeric code
  const explicitRegex = /(?:mã\s*(?:xác\s*nhận|xác\s*thực|bảo\s*mật|otp)?|code(?:\s*is)?|otp|verification\s*code|security\s*code|confirmation\s*code|passcode)[\s\:\-\=]+([A-Za-z0-9]{4,8})\b/i;
  const explicitMatch = combined.match(explicitRegex);
  if (explicitMatch && explicitMatch[1]) {
    return explicitMatch[1].trim();
  }

  // 2. Prefixed patterns like G-123456 or FB-12345
  const brandPrefixed = /\b(G-\d{6}|FB-\d{5,6})\b/i;
  const brandMatch = combined.match(brandPrefixed);
  if (brandMatch && brandMatch[1]) {
    return brandMatch[1];
  }

  // 3. Hyphenated 6-digit codes like 849-210
  const hyphenMatch = /\b(\d{3}-\d{3})\b/.exec(combined);
  if (hyphenMatch && hyphenMatch[1]) {
    return hyphenMatch[1].replace('-', '');
  }

  // 4. Standalone 6-digit code in subject (exclude current/adjacent years)
  const subjectSix = /\b(?<!\d)(\d{6})(?!\d)\b/.exec(subject);
  if (subjectSix && subjectSix[1]) {
    const code = subjectSix[1];
    if (!['2023', '2024', '2025', '2026', '2027'].includes(code)) {
      return code;
    }
  }

  // 5. Standalone 6-digit code in content body
  const bodySix = /\b(?<!\d)(\d{6})(?!\d)\b/.exec(content);
  if (bodySix && bodySix[1]) {
    const code = bodySix[1];
    if (!['2023', '2024', '2025', '2026', '2027'].includes(code)) {
      return code;
    }
  }

  // 6. Keywords like "là 123456"
  const isMatch = /(?:là|is)\s+([0-9]{4,8})\b/i.exec(combined);
  if (isMatch && isMatch[1]) {
    return isMatch[1];
  }

  return null;
}

const DEFAULT_CLIENT_ID = '000000004017045b';
// Admin preset concurrency (5 concurrent requests)
const ADMIN_CONCURRENCY = 5;

interface EmailReaderTabProps {
  language: Language;
}

export const EmailReaderTab: React.FC<EmailReaderTabProps> = ({ language }) => {
  const t = translations[language] || translations.vn;
  const [inputText, setInputText] = useState('');
  const [listMailType, setListMailType] = useState<'all' | 'inbox' | 'junk'>('all');
  const [accounts, setAccounts] = useState<AccountGroup[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [copiedOtpKey, setCopiedOtpKey] = useState<string | null>(null);

  // Email detail modal state
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [activeEmailDetail, setActiveEmailDetail] = useState<EmailDetailData | null>(null);

  const abortRef = useRef<boolean>(false);

  // Parse raw text into structured accounts
  const parseLinesToAccounts = (text: string): AccountGroup[] => {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    return lines.map((line, idx) => {
      const parts = line.split('|').map((p) => p.trim());
      let email = '';
      let password = '';
      let refreshToken = '';
      let clientId = DEFAULT_CLIENT_ID;

      if (parts.length >= 4) {
        email = parts[0];
        password = parts[1];
        refreshToken = parts[2];
        clientId = parts[3] || DEFAULT_CLIENT_ID;
      } else if (parts.length === 3) {
        email = parts[0];
        if (parts[1].length > 30 || parts[1].startsWith('M.') || parts[1].startsWith('0.')) {
          refreshToken = parts[1];
          clientId = parts[2];
        } else {
          password = parts[1];
          refreshToken = parts[2];
        }
      } else if (parts.length === 2) {
        email = parts[0];
        refreshToken = parts[1];
      } else {
        email = line;
      }

      return {
        id: `acc_${idx}_${Date.now()}`,
        email,
        password,
        refreshToken,
        clientId: clientId || DEFAULT_CLIENT_ID,
        rawLine: line,
        status: 'idle',
        messages: [],
        isExpanded: true,
      };
    });
  };

  const handleCopyOtp = (otp: string, key: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    navigator.clipboard.writeText(otp);
    setCopiedOtpKey(key);
    setTimeout(() => setCopiedOtpKey(null), 2000);
  };

  const toggleAccountExpand = (accId: string) => {
    setAccounts((prev) =>
      prev.map((acc) => (acc.id === accId ? { ...acc, isExpanded: !acc.isExpanded } : acc))
    );
  };

  const openEmailDetail = (acc: AccountGroup, msg: EmailMessage, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setActiveEmailDetail({
      accountEmail: acc.email,
      sender: msg.sender || msg.from || 'Unknown',
      subject: msg.subject || '(No subject)',
      date: msg.date || msg.time || new Date().toLocaleString(),
      body: msg.body || msg.text || msg.content || '',
      html: msg.html,
      otpCode: msg.otpCode,
      raw: msg.raw,
    });
    setDetailModalOpen(true);
  };

  // Helper to read single account via real backend API
  const fetchMessagesForAccount = async (
    acc: AccountGroup
  ): Promise<{ success: boolean; isDie: boolean; messages: EmailMessage[]; error?: string }> => {
    try {
      const res = await fetch('/api/get_messages_oauth2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: acc.email,
          refresh_token: acc.refreshToken,
          client_id: acc.clientId,
          list_mail: listMailType,
        }),
      });

      const data = await res.json();

      if (!res.ok || data.status === false) {
        const errMsg = data?.error || `HTTP ${res.status}`;
        const isDie = errMsg.toLowerCase().includes('die') || errMsg.includes('IMAP connection failed');
        return {
          success: false,
          isDie,
          messages: [],
          error: errMsg,
        };
      }

      // Check if data is array or object with messages
      let rawList: any[] = [];
      if (Array.isArray(data)) {
        rawList = data;
      } else if (data && Array.isArray(data.messages)) {
        rawList = data.messages;
      } else if (data && Array.isArray(data.data)) {
        rawList = data.data;
      }

      const formatted: EmailMessage[] = rawList.map((m: any, mIdx: number) => {
        const subj = m.subject || m.title || '';
        const bodyContent = m.body || m.text || m.content || m.message || '';
        const htmlContent = m.html || (typeof bodyContent === 'string' && bodyContent.includes('<') ? bodyContent : undefined);
        const otp = detectOtp(subj, bodyContent);

        return {
          id: m.id || `msg_${mIdx}_${Date.now()}`,
          from: m.from || m.sender || '',
          sender: m.sender || m.from || '',
          to: m.to || acc.email,
          subject: subj,
          date: m.date || m.time || m.created_at || 'Recent',
          body: bodyContent,
          text: bodyContent,
          html: htmlContent,
          otpCode: otp,
          raw: m,
        };
      });

      return {
        success: true,
        isDie: false,
        messages: formatted,
      };
    } catch (err: any) {
      return {
        success: false,
        isDie: false,
        messages: [],
        error: err.message || 'Server connection error',
      };
    }
  };

  // Process a single account strictly via real API
  const processOneAccount = async (targetAccount: AccountGroup) => {
    if (abortRef.current) return;

    // Update state to reading
    setAccounts((prev) =>
      prev.map((item) => (item.id === targetAccount.id ? { ...item, status: 'reading', errorMessage: undefined } : item))
    );

    const result = await fetchMessagesForAccount(targetAccount);

    setAccounts((prev) =>
      prev.map((item) => {
        if (item.id === targetAccount.id) {
          return {
            ...item,
            status: result.success ? 'success' : result.isDie ? 'die' : 'error',
            messages: result.messages || [],
            errorMessage: result.error,
            lastChecked: new Date().toLocaleTimeString(),
          };
        }
        return item;
      })
    );
  };

  // Start reading inbox
  const handleStartReadInbox = async () => {
    const parsed = parseLinesToAccounts(inputText);
    if (parsed.length === 0) return;

    setAccounts(parsed);
    setIsProcessing(true);
    abortRef.current = false;

    const poolLimit = ADMIN_CONCURRENCY;
    let nextIdx = 0;

    const runWorker = async () => {
      while (nextIdx < parsed.length && !abortRef.current) {
        const currentIndex = nextIdx++;
        const target = parsed[currentIndex];

        try {
          await processOneAccount(target);
        } catch (err) {
          console.error(`Error reading ${target.email}`, err);
        }
      }
    };

    const workers = [];
    const actualWorkersCount = Math.min(poolLimit, parsed.length);
    for (let w = 0; w < actualWorkersCount; w++) {
      workers.push(runWorker());
    }

    await Promise.all(workers);

    setIsProcessing(false);
  };

  // Re-read a single account
  const handleRetrySingle = async (accId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const acc = accounts.find((a) => a.id === accId);
    if (!acc) return;

    await processOneAccount(acc);
  };

  const handleStopProcessing = () => {
    abortRef.current = true;
    setIsProcessing(false);
  };

  // Compute stats
  const totalCount = accounts.length;
  const completedCount = accounts.filter((a) => a.status !== 'idle' && a.status !== 'reading').length;
  const liveCount = accounts.filter((a) => a.status === 'success').length;
  const dieCount = accounts.filter((a) => a.status === 'die' || a.status === 'error').length;
  const totalEmailsCount = accounts.reduce((sum, a) => sum + (a.messages?.length || 0), 0);
  const totalOtpsCount = accounts.reduce(
    (sum, a) => sum + (a.messages?.filter((m) => Boolean(m.otpCode))?.length || 0),
    0
  );

  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const accountsCountLabel = t.emailReaderAccountsCount.replace(
    '{n}',
    String(inputText.split('\n').filter(Boolean).length)
  );

  return (
    <div className="space-y-4">
      {/* Input Box Area */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="font-bold text-slate-800 dark:text-slate-200 text-xs flex items-center gap-2">
            <span>{t.emailReaderAccountList}</span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 font-normal">
              ({accountsCountLabel})
            </span>
          </label>

          <div className="flex items-center gap-2">
            {/* Mail folder filter */}
            <div className="flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-400">
              <select
                value={listMailType}
                onChange={(e) => setListMailType(e.target.value as any)}
                className="bg-[#f5f6f6] dark:bg-[#16181b] border border-[#e2e6e5] dark:border-[#30333b] text-slate-800 dark:text-slate-200 rounded-lg px-2 py-1 text-[11px] focus:outline-none focus:border-emerald-500 cursor-pointer"
              >
                <option value="all">{t.emailReaderFilterAll}</option>
                <option value="inbox">{t.emailReaderFilterInbox}</option>
                <option value="junk">{t.emailReaderFilterJunk}</option>
              </select>
            </div>

            <button
              onClick={() => setInputText('')}
              className="text-[11px] text-slate-500 hover:text-red-500 dark:hover:text-red-400 flex items-center gap-1 hover:bg-red-500/10 px-2 py-1 rounded-lg transition cursor-pointer"
            >
              <Trash2 className="w-3 h-3" />
              <span>{t.emailReaderClear}</span>
            </button>
          </div>
        </div>

        <textarea
          rows={5}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={`user1@hotmail.com|PassWord#123|M.C543_BAY.0.U.-token1...|000000004017045b\nuser2@outlook.com|Secr3t#456|M.C543_BAY.0.U.-token2...|000000004017045b`}
          className="w-full bg-[#f8faf9] dark:bg-[#16181b] border border-[#dce0df] dark:border-[#30333b] rounded-xl p-3 font-mono text-[11px] text-slate-800 dark:text-slate-200 focus:outline-none focus:border-emerald-500 leading-relaxed shadow-inner"
        />

        {/* Action Controls */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
            <span>{t.emailReaderOtpCopyHint}</span>
          </div>

          <div className="flex items-center gap-2">
            {isProcessing ? (
              <button
                onClick={handleStopProcessing}
                className="bg-red-500 hover:bg-red-600 text-white font-bold px-4 py-2 rounded-xl transition flex items-center gap-1.5 shadow-md shadow-red-500/20 text-xs cursor-pointer"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>{t.emailReaderStopBtn}</span>
              </button>
            ) : (
              <button
                onClick={handleStartReadInbox}
                disabled={!inputText.trim()}
                className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-slate-950 font-bold px-5 py-2 rounded-xl transition flex items-center gap-1.5 disabled:opacity-40 shadow-md shadow-emerald-500/20 text-xs cursor-pointer"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>{t.emailReaderStartBtn}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Progress Bar & Stats Section */}
      {accounts.length > 0 && (
        <div className="space-y-3 pt-3 border-t border-[#e2e6e5] dark:border-[#30333b]">
          {/* Thanh process tiến trình */}
          <div className="bg-[#f5f7f6] dark:bg-[#1a1b1f] border border-[#e2e6e5] dark:border-[#30333b] rounded-xl p-3.5 space-y-2.5 shadow-sm">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-200">
                {isProcessing ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 text-emerald-500 animate-spin" />
                    <span>
                      {t.emailReaderReadingProgress}... — {completedCount}/{totalCount} {t.emailReaderCompletedProgress.toLowerCase()}
                    </span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    <span>
                      {t.emailReaderCompletedProgress} ({completedCount}/{totalCount} {t.emailReaderStatAccounts})
                    </span>
                  </>
                )}
              </div>
              <span className="font-mono font-bold text-xs text-emerald-600 dark:text-emerald-400">
                {progressPercent}%
              </span>
            </div>

            {/* Visual Bar */}
            <div className="w-full h-2.5 bg-[#e2e6e5] dark:bg-[#282a30] rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-all duration-300 shadow-sm"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            {/* Metrics Chips */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-1">
              <div className="bg-white dark:bg-[#151619] p-2 rounded-lg border border-[#e2e6e5] dark:border-[#2a2d34] text-center">
                <span className="text-[10px] text-slate-500 block">{t.emailReaderStatAccounts}</span>
                <span className="font-bold text-xs text-slate-800 dark:text-slate-200">{totalCount}</span>
              </div>
              <div className="bg-white dark:bg-[#151619] p-2 rounded-lg border border-emerald-500/30 text-center">
                <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium block">{t.emailReaderStatLive}</span>
                <span className="font-bold text-xs text-emerald-600 dark:text-emerald-400">{liveCount}</span>
              </div>
              <div className="bg-white dark:bg-[#151619] p-2 rounded-lg border border-rose-500/30 text-center">
                <span className="text-[10px] text-rose-600 dark:text-rose-400 font-medium block">{t.emailReaderStatDie}</span>
                <span className="font-bold text-xs text-rose-600 dark:text-rose-400">{dieCount}</span>
              </div>
              <div className="bg-white dark:bg-[#151619] p-2 rounded-lg border border-[#e2e6e5] dark:border-[#2a2d34] text-center">
                <span className="text-[10px] text-slate-500 block">{t.emailReaderStatTotalEmails}</span>
                <span className="font-bold text-xs text-slate-800 dark:text-slate-200">{totalEmailsCount}</span>
              </div>
              <div className="bg-white dark:bg-[#151619] p-2 rounded-lg border border-teal-500/30 text-center col-span-2 sm:col-span-1">
                <span className="text-[10px] text-teal-600 dark:text-teal-400 font-medium block">{t.emailReaderStatOtps}</span>
                <span className="font-bold text-xs text-teal-600 dark:text-teal-400">{totalOtpsCount}</span>
              </div>
            </div>
          </div>

          {/* Grouped by Account List */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between text-xs font-bold text-slate-900 dark:text-slate-100">
              <span>{t.emailReaderAccountListHeading.replace('{n}', String(accounts.length))}</span>
              <span className="text-[11px] text-slate-500 font-normal">
                {t.emailReaderToggleHint}
              </span>
            </div>

            <div className="space-y-2">
              {accounts.map((acc, accIdx) => (
                <div
                  key={acc.id}
                  className="bg-[#f5f7f6] dark:bg-[#1a1b1f] border border-[#e2e6e5] dark:border-[#30333b] rounded-xl overflow-hidden shadow-sm transition"
                >
                  {/* Account Header / Nav bar - clicking this toggles collapse/expand */}
                  <div
                    onClick={() => toggleAccountExpand(acc.id)}
                    className="p-3 sm:p-3.5 flex items-center justify-between gap-2.5 bg-[#fafcfb] dark:bg-[#202227] hover:bg-[#f0f4f2] dark:hover:bg-[#252830] cursor-pointer transition select-none"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="text-[11px] font-mono font-bold bg-[#e8ebea] dark:bg-[#282a30] text-slate-600 dark:text-slate-300 px-1.5 py-0.5 rounded flex-shrink-0">
                        #{accIdx + 1}
                      </span>
                      <span className="font-bold text-slate-900 dark:text-slate-100 text-xs font-mono truncate">
                        {acc.email}
                      </span>

                      {/* Status Badge */}
                      {acc.status === 'reading' && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 flex items-center gap-1 animate-pulse flex-shrink-0">
                          <RefreshCw className="w-3 h-3 animate-spin" />
                          <span>{t.emailReaderStatusReading}</span>
                        </span>
                      )}
                      {acc.status === 'idle' && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-500/10 text-slate-600 dark:text-slate-400 border border-slate-500/20 flex-shrink-0">
                          {t.emailReaderStatusWaiting}
                        </span>
                      )}
                      {acc.status === 'success' && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 flex items-center gap-1 flex-shrink-0">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>{t.emailReaderStatusLiveWithCount.replace('{n}', String(acc.messages.length))}</span>
                        </span>
                      )}
                      {acc.status === 'die' && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-700 dark:text-rose-400 border border-rose-500/30 flex items-center gap-1 flex-shrink-0">
                          <XCircle className="w-3 h-3" />
                          <span>{t.emailReaderStatusDie}</span>
                        </span>
                      )}
                      {acc.status === 'error' && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30 flex items-center gap-1 flex-shrink-0">
                          <AlertCircle className="w-3 h-3" />
                          <span>{t.emailReaderStatusError}</span>
                        </span>
                      )}
                    </div>

                    {/* Right side controls on nav bar */}
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {acc.lastChecked && (
                        <span className="hidden sm:inline text-[10px] text-slate-400 mr-1">
                          {acc.lastChecked}
                        </span>
                      )}

                      <button
                        onClick={(e) => handleRetrySingle(acc.id, e)}
                        disabled={acc.status === 'reading' || isProcessing}
                        className="bg-white dark:bg-[#282a30] hover:bg-[#eaeaea] hover:dark:bg-[#34373e] text-slate-700 dark:text-slate-200 border border-[#dce0df] dark:border-[#383c44] text-[11px] font-semibold px-2 py-1 rounded-lg flex items-center gap-1 transition disabled:opacity-40 cursor-pointer"
                        title={t.emailReaderReread}
                      >
                        <RefreshCw className={`w-3 h-3 ${acc.status === 'reading' ? 'animate-spin' : ''}`} />
                        <span className="hidden sm:inline">{t.emailReaderReread}</span>
                      </button>

                      <div className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1 rounded transition">
                        {acc.isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </div>
                    </div>
                  </div>

                  {/* Account Content Section */}
                  {acc.isExpanded && (
                    <div className="p-3 sm:p-3.5 space-y-2.5 border-t border-[#e2e6e5] dark:border-[#2a2d34]">
                      {/* DIE / Error State Notice */}
                      {(acc.status === 'die' || acc.status === 'error') && (
                        <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-500/40 text-rose-800 dark:text-rose-200 text-xs space-y-1">
                          <div className="flex items-center gap-1.5 font-bold">
                            <ShieldAlert className="w-4 h-4 text-rose-500 flex-shrink-0" />
                            <span>
                              {acc.status === 'die' ? t.emailReaderDieTitle : t.emailReaderApiErrorTitle}
                            </span>
                          </div>
                          <p className="text-[11px] text-rose-700 dark:text-rose-300 pl-5">
                            {acc.errorMessage || 'IMAP connection failed.'}
                          </p>
                        </div>
                      )}

                      {/* Success & Messages List */}
                      {acc.status === 'success' && (
                        <>
                          {acc.messages.length === 0 ? (
                            <div className="p-4 rounded-xl bg-[#fafafa] dark:bg-[#151619] border border-[#e2e6e5] dark:border-[#2a2d34] text-center text-slate-500 dark:text-slate-400 space-y-1">
                              <Inbox className="w-5 h-5 mx-auto opacity-50" />
                              <p className="text-xs font-semibold">{t.emailReaderEmptyTitle}</p>
                              <p className="text-[11px]">{t.emailReaderEmptyDesc}</p>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {acc.messages.map((msg, msgIdx) => {
                                const otpKey = `${acc.id}_${msg.id}_${msgIdx}`;
                                const isCopied = copiedOtpKey === otpKey;

                                return (
                                  <div
                                    key={msg.id || msgIdx}
                                    className="p-3 bg-white dark:bg-[#151619] border border-[#e2e6e5] dark:border-[#2a2d34] rounded-xl hover:border-emerald-500/40 transition space-y-2 shadow-sm"
                                  >
                                    {/* Row 1: Sender & Date */}
                                    <div className="flex items-center justify-between gap-2 text-[11px]">
                                      <div className="flex items-center gap-1.5 text-slate-800 dark:text-slate-200 font-bold truncate">
                                        <Mail className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                                        <span className="truncate">{msg.sender || msg.from || 'Unknown'}</span>
                                      </div>
                                      <span className="text-slate-500 dark:text-slate-400 text-[10px] flex-shrink-0">
                                        {msg.date || 'Recent'}
                                      </span>
                                    </div>

                                    {/* Row 2: Subject & Super-Compact OTP Pill */}
                                    <div className="flex flex-wrap sm:flex-nowrap items-start justify-between gap-2">
                                      <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 break-words flex-1">
                                        {msg.subject || '(No subject)'}
                                      </div>

                                      {/* Sleek, Compact OTP pill right in line */}
                                      {msg.otpCode && (
                                        <button
                                          onClick={(e) => handleCopyOtp(msg.otpCode!, otpKey, e)}
                                          title={t.emailReaderOtpCopyHint}
                                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md font-mono font-bold text-xs tracking-wider transition cursor-pointer border flex-shrink-0 shadow-sm ${
                                            isCopied
                                              ? 'bg-emerald-600 text-white border-emerald-600'
                                              : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 hover:border-emerald-500'
                                          }`}
                                        >
                                          <Key className="w-3 h-3 text-emerald-500 flex-shrink-0" />
                                          <span>{msg.otpCode}</span>
                                          {isCopied ? (
                                            <span className="text-[10px] font-sans font-medium flex items-center gap-0.5 ml-0.5">
                                              <Check className="w-2.5 h-2.5" /> {t.emailReaderCopied}
                                            </span>
                                          ) : (
                                            <Copy className="w-2.5 h-2.5 opacity-60 ml-0.5" />
                                          )}
                                        </button>
                                      )}
                                    </div>

                                    {/* Row 3: Action footer / Snippet */}
                                    <div className="flex items-center justify-between pt-0.5 text-[11px]">
                                      <div className="text-slate-500 dark:text-slate-400 text-[10px] truncate max-w-[260px] sm:max-w-md">
                                        {msg.body && !msg.html ? msg.body.replace(/\s+/g, ' ').slice(0, 80) + '...' : ''}
                                      </div>

                                      <button
                                        onClick={(e) => openEmailDetail(acc, msg, e)}
                                        className="text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400 font-medium flex items-center gap-1 transition cursor-pointer ml-auto"
                                      >
                                        <FileText className="w-3 h-3" />
                                        <span>{t.emailReaderViewMail}</span>
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Email Detail Modal */}
      <EmailDetailModal
        isOpen={detailModalOpen}
        onClose={() => setDetailModalOpen(false)}
        emailData={activeEmailDetail}
        language={language}
      />
    </div>
  );
};
