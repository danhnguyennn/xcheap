import React, { useState, useEffect } from 'react';
import { TOTP, Secret } from 'otpauth';
import { Language } from '../types';
import { translations } from '../locales/translations';
import { Wrench, Key, Mail, Split, Copy, Check, RefreshCw } from 'lucide-react';

// Real RFC 6238 TOTP — the exact same algorithm an authenticator app (Google
// Authenticator, Authy...) runs over a secret you already hold, not a guess
// or a lookup against anything live. Returns null for a secret that isn't
// valid Base32 rather than throwing, so a bad paste shows an error state
// instead of crashing the modal.
function computeTotp(secretKeyRaw: string): string | null {
  const cleaned = secretKeyRaw.replace(/\s+/g, '').toUpperCase();
  if (!cleaned) return null;
  try {
    const totp = new TOTP({
      secret: Secret.fromBase32(cleaned),
      digits: 6,
      period: 30,
      algorithm: 'SHA1',
    });
    return totp.generate();
  } catch {
    return null;
  }
}

interface ToolsModalProps {
  isOpen: boolean;
  onClose: () => void;
  language: Language;
}

export const ToolsModal: React.FC<ToolsModalProps> = ({ isOpen, onClose, language }) => {
  const t = translations[language];
  const [activeTab, setActiveTab] = useState<'2fa' | 'email' | 'splitter' | 'renew-hotmail'>('2fa');

  // 2FA TOTP Generator state
  const [secretKey, setSecretKey] = useState('JBSWY3DPEHPK3PXP');
  const [totpCode, setTotpCode] = useState<string | null>(computeTotp('JBSWY3DPEHPK3PXP'));
  const [secondsRemaining, setSecondsRemaining] = useState(30);
  const [copiedTotp, setCopiedTotp] = useState(false);

  // Email reader state
  const [emailInput, setEmailInput] = useState('ronan_user1@hotmail.com|MailPass#2026');
  const [emails, setEmails] = useState<any[]>([
    {
      sender: 'X (Twitter) Support <verify@x.com>',
      subject: 'Your X confirmation code is 849-210',
      time: t.toolsMin1Ago,
      code: '849210',
    },
    {
      sender: 'Microsoft Security <account-security@accountprotection.microsoft.com>',
      subject: 'Security alert: New sign-in from Android app',
      time: t.toolsMin10Ago,
      code: '918402',
    },
  ]);
  const [isReadingMail, setIsReadingMail] = useState(false);

  // Splitter state — the two real formats accounts in this store actually
  // come in, plus a custom option for anything else. Field order here is
  // exactly the order fields appear in each format string.
  const SPLITTER_PRESETS: { label: string; fields: string[] }[] = [
    {
      label: 'Username | Password | 2FA | Oauth_token | Oauth_secret | Known_device | Email | Password_email | Refresh_token | Client_id | Cookies',
      fields: ['Username', 'Password', '2FA', 'Oauth_token', 'Oauth_secret', 'Known_device', 'Email', 'Password_email', 'Refresh_token', 'Client_id', 'Cookies'],
    },
    {
      label: 'Username | Password | 2FA | Email | Password_email | Refresh_token | Client_id | Cookies',
      fields: ['Username', 'Password', '2FA', 'Email', 'Password_email', 'Refresh_token', 'Client_id', 'Cookies'],
    },
  ];
  const [inputPresetIdx, setInputPresetIdx] = useState<number | 'custom'>(0);
  const [customInputFormat, setCustomInputFormat] = useState('Username | Password | 2FA | Email | Password_email | Cookies');
  const [rawText, setRawText] = useState('1829471928491|P@sswordX2026!|JBSWY3DPEHPK3PXP|ronan_user1@hotmail.com|MailPass#2026|ct0=f819a1c...; auth_token=9f8e7d6c5b4a3210...');
  const [splitRows, setSplitRows] = useState<Record<string, string>[] | null>(null);
  const [parsedFields, setParsedFields] = useState<string[]>([]);
  const [outputFields, setOutputFields] = useState<string[]>([]);
  const [copiedSplitOutput, setCopiedSplitOutput] = useState(false);

  const activeInputFields =
    inputPresetIdx === 'custom'
      ? customInputFormat.split('|').map((f) => f.trim()).filter(Boolean)
      : SPLITTER_PRESETS[inputPresetIdx].fields;

  // A raw Cookies blob is only ever useful as a whole to a few tools —
  // usually only the auth_token value inside it is actually needed, so it's
  // offered as its own pickable output field, extracted (never fabricated:
  // stays blank if the cookie string has no auth_token= pair) rather than
  // forcing the user to keep pasting the full cookie string everywhere.
  const availableOutputFields = activeInputFields.includes('Cookies')
    ? [...activeInputFields, 'Auth_token']
    : activeInputFields;

  const extractAuthTokenFromCookie = (cookieStr: string): string => {
    if (!cookieStr) return '';
    const parts = cookieStr.split(';');
    for (const part of parts) {
      const eqIdx = part.indexOf('=');
      if (eqIdx === -1) continue;
      const key = part.slice(0, eqIdx).trim().toLowerCase();
      if (key === 'auth_token') return part.slice(eqIdx + 1).trim();
    }
    return '';
  };

  // Switching the input format after already parsing would otherwise leave
  // the previous split's output-field selection referencing fields that no
  // longer exist in the new format — clear everything so the next parse
  // starts clean instead of showing a stale/mismatched output builder.
  useEffect(() => {
    setSplitRows(null);
    setParsedFields([]);
    setOutputFields([]);
  }, [inputPresetIdx, customInputFormat]);

  const toggleOutputField = (field: string) => {
    setOutputFields((prev) => (prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field]));
  };

  const splitOutputLines =
    splitRows && outputFields.length > 0 ? splitRows.map((row) => outputFields.map((f) => row[f] ?? '').join('|')) : [];

  const handleCopySplitOutput = () => {
    if (splitOutputLines.length === 0) return;
    navigator.clipboard.writeText(splitOutputLines.join('\n'));
    setCopiedSplitOutput(true);
    setTimeout(() => setCopiedSplitOutput(false), 2000);
  };

  // Renew Token Hotmail state
  const [hotmailTokensInput, setHotmailTokensInput] = useState(
    'ronan_user1@hotmail.com|M.C543_BAY.0.U.-CtwJ!1829481928a9b1c2d3e4f5g\nalex_trade99@outlook.com|M.C543_BAY.0.U.-AzwK!9182391028a1b2c3d4e5f6g'
  );
  const [isRenewingToken, setIsRenewingToken] = useState(false);
  const [renewResult, setRenewResult] = useState<any>(null);
  const [copiedTokenIndex, setCopiedTokenIndex] = useState<number | null>(null);
  const [copiedAllTokens, setCopiedAllTokens] = useState(false);

  // Recomputes the real TOTP code every second so it's always correct for
  // the live 30-second window — not just refreshed at the boundary, so
  // pasting a new secret (or opening the modal mid-window) shows the right
  // code immediately instead of a stale one.
  useEffect(() => {
    if (!isOpen) return;
    const tick = () => {
      const now = new Date();
      setSecondsRemaining(30 - (now.getSeconds() % 30));
      setTotpCode(computeTotp(secretKey));
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [isOpen, secretKey]);

  const handleGenerateTotp = () => {
    setTotpCode(computeTotp(secretKey));
  };

  const handleCopyTotp = () => {
    if (!totpCode) return;
    navigator.clipboard.writeText(totpCode);
    setCopiedTotp(true);
    setTimeout(() => setCopiedTotp(false), 2000);
  };

  const handleReadEmail = () => {
    setIsReadingMail(true);
    setTimeout(() => {
      setIsReadingMail(false);
      const newCode = Math.floor(100000 + Math.random() * 900000);
      setEmails([
        {
          sender: 'X / Twitter Verification <info@x.com>',
          subject: `X Verification code: ${newCode}`,
          time: t.toolsJustNow,
          code: String(newCode),
        },
        ...emails,
      ]);
    }, 1200);
  };

  const handleSplit = () => {
    const fields = activeInputFields;
    if (fields.length === 0) return;
    const lines = rawText.split('\n').map((l) => l.trim()).filter(Boolean);

    const parsed = lines.map((line) => {
      const parts = line.split('|');
      const row: Record<string, string> = {};
      fields.forEach((fieldName, idx) => {
        // The last declared field absorbs any remaining '|'-joined text —
        // a Cookies value can itself legitimately contain '|' characters,
        // so it must not be cut off at the first one.
        row[fieldName] = idx === fields.length - 1 ? parts.slice(idx).join('|').trim() : (parts[idx] || '').trim();
      });
      if (fields.includes('Cookies')) {
        row['Auth_token'] = extractAuthTokenFromCookie(row['Cookies'] || '');
      }
      return row;
    });

    setSplitRows(parsed);
    setParsedFields(fields.includes('Cookies') ? [...fields, 'Auth_token'] : fields);
    // Default the output format to exactly the fields just parsed — user can
    // then toggle fields off/on (and reorder by re-toggling) to build any
    // new format from here.
    setOutputFields(fields.includes('Cookies') ? [...fields, 'Auth_token'] : fields);
  };

  const handleRenewHotmailTokens = async () => {
    if (!hotmailTokensInput.trim()) return;
    setIsRenewingToken(true);
    try {
      const res = await fetch('/api/tools/renew-hotmail-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokensInput: hotmailTokensInput }),
      });
      const data = await res.json();
      if (res.ok) {
        setRenewResult(data);
      }
    } catch (err) {
      console.error('Error renewing token', err);
    } finally {
      setIsRenewingToken(false);
    }
  };

  const handleCopySingleToken = (token: string, idx: number) => {
    navigator.clipboard.writeText(token);
    setCopiedTokenIndex(idx);
    setTimeout(() => setCopiedTokenIndex(null), 2000);
  };

  const handleCopyAllAccessTokens = () => {
    if (!renewResult || !renewResult.results) return;
    const allTokens = renewResult.results
      .filter((r: any) => r.accessToken)
      .map((r: any) => `${r.email}|${r.accessToken}`)
      .join('\n');
    navigator.clipboard.writeText(allTokens);
    setCopiedAllTokens(true);
    setTimeout(() => setCopiedAllTokens(false), 2000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-[#eef0ef] dark:bg-[#202227] border border-[#e1e4e3] dark:border-[#32363e] rounded-2xl max-w-3xl w-full my-auto shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#e2e6e5] dark:border-[#30333b] flex items-center justify-between bg-[#f2f4f3] dark:bg-[#1a1b1f]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#eceeed] dark:bg-[#23252a] border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shadow-sm">
              <Wrench className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100">{t.toolsTitle}</h2>
              {/* Redundant with the tab bar's icons/labels right below it, and
                  on a phone-width header it just forces an ugly two-line wrap
                  that crowds the close button — so it's desktop-only. */}
              <p className="hidden sm:block text-[11px] text-slate-600 dark:text-slate-400">2FA TOTP • Email Inbox Reader • Data Splitter • Renew Token Hotmail</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:dark:text-slate-100 text-sm">
            ✕
          </button>
        </div>

        {/* Tab Navigation — a 4-column grid on mobile so every tab stays
            reachable with a single tap and no hidden horizontal scroll (the
            old overflow-x-auto row cut the 3rd/4th tabs off-screen with no
            scroll affordance, so they were effectively undiscoverable on a
            phone). Labels only show at sm+; icons alone identify the tab on
            mobile, with the full name still available via title tooltip. */}
        <div className="grid grid-cols-4 sm:flex border-b border-[#e2e6e5] dark:border-[#30333b] bg-[#f2f4f3] dark:bg-[#1a1b1f] text-xs font-semibold">
          <button
            onClick={() => setActiveTab('2fa')}
            title="2FA (TOTP)"
            className={`py-2.5 sm:py-3 px-1 sm:px-4 flex items-center justify-center gap-1.5 sm:gap-2 border-b-2 whitespace-nowrap transition ${
              activeTab === '2fa'
                ? 'border-emerald-400 text-emerald-600 dark:text-emerald-400 bg-[#eef0ef] dark:bg-[#202227]'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-800 hover:dark:text-slate-200'
            }`}
          >
            <Key className="w-4 h-4 sm:w-3.5 sm:h-3.5 flex-shrink-0" />
            <span className="hidden sm:inline">2FA (TOTP)</span>
          </button>

          <button
            onClick={() => setActiveTab('email')}
            title="Email Reader"
            className={`py-2.5 sm:py-3 px-1 sm:px-4 flex items-center justify-center gap-1.5 sm:gap-2 border-b-2 whitespace-nowrap transition ${
              activeTab === 'email'
                ? 'border-emerald-400 text-emerald-600 dark:text-emerald-400 bg-[#eef0ef] dark:bg-[#202227]'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-800 hover:dark:text-slate-200'
            }`}
          >
            <Mail className="w-4 h-4 sm:w-3.5 sm:h-3.5 flex-shrink-0" />
            <span className="hidden sm:inline">Email Reader</span>
          </button>

          <button
            onClick={() => setActiveTab('splitter')}
            title={t.toolsSplitterTabLabel}
            className={`py-2.5 sm:py-3 px-1 sm:px-4 flex items-center justify-center gap-1.5 sm:gap-2 border-b-2 whitespace-nowrap transition ${
              activeTab === 'splitter'
                ? 'border-emerald-400 text-emerald-600 dark:text-emerald-400 bg-[#eef0ef] dark:bg-[#202227]'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-800 hover:dark:text-slate-200'
            }`}
          >
            <Split className="w-4 h-4 sm:w-3.5 sm:h-3.5 flex-shrink-0" />
            <span className="hidden sm:inline">{t.toolsSplitterTabLabel}</span>
          </button>

          <button
            onClick={() => setActiveTab('renew-hotmail')}
            title={t.renewHotmail}
            className={`py-2.5 sm:py-3 px-1 sm:px-4 flex items-center justify-center gap-1.5 sm:gap-2 border-b-2 whitespace-nowrap transition ${
              activeTab === 'renew-hotmail'
                ? 'border-emerald-400 text-emerald-600 dark:text-emerald-400 bg-[#eef0ef] dark:bg-[#202227]'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-800 hover:dark:text-slate-200'
            }`}
          >
            <RefreshCw className="w-4 h-4 sm:w-3.5 sm:h-3.5 flex-shrink-0" />
            <span className="hidden sm:inline">{t.renewHotmail}</span>
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs flex-1">
          {activeTab === '2fa' && (
            <div className="space-y-3">
              <div>
                <label className="font-bold text-slate-800 dark:text-slate-200 block mb-1">{t.twoFaTool}</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={secretKey}
                    onChange={(e) => setSecretKey(e.target.value.replace(/\s+/g, ''))}
                    placeholder={t.twoFaPlaceholder}
                    className="flex-1 bg-[#f5f6f6] dark:bg-[#16181b] border border-[#e2e6e5] dark:border-[#30333b] rounded-lg px-3 py-2 text-xs font-mono text-slate-800 dark:text-slate-200 focus:outline-none focus:border-emerald-500 uppercase"
                  />
                  <button
                    onClick={handleGenerateTotp}
                    className="bg-[#e7ebe9] dark:bg-[#292b31] hover:bg-[#dee3e1] hover:dark:bg-[#363941] border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 font-bold px-4 py-2 rounded-lg transition"
                  >
                    {t.getTwoFaCode}
                  </button>
                </div>
              </div>

              {/* Code Display — stacked on mobile instead of cramming the
                  big code, countdown, and copy button onto one row, which
                  used to force the code itself to wrap across two lines on
                  a phone-width screen. */}
              <div className="p-4 bg-[#f2f4f3] dark:bg-[#1a1b1f] border border-[#e2e6e5] dark:border-[#30333b] rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <span className="text-[11px] text-slate-600 dark:text-slate-400 block mb-1">
                    {t.toolsCurrent2FACode}
                  </span>
                  <div className={`text-3xl font-mono font-black tracking-wider ${totpCode ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400 text-base'}`}>
                    {totpCode ? `${totpCode.slice(0, 3)} ${totpCode.slice(3)}` : t.toolsInvalidSecretKey}
                  </div>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-3">
                  <div className="sm:text-right">
                    <span className="text-[11px] text-slate-600 dark:text-slate-400 block">{t.toolsRefreshIn}</span>
                    <span className="text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400">{secondsRemaining}s</span>
                  </div>

                  <button
                    onClick={handleCopyTotp}
                    disabled={!totpCode}
                    className="bg-[#e7ebe9] dark:bg-[#292b31] hover:bg-[#dee3e1] hover:dark:bg-[#363941] border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 px-3.5 py-2 rounded-lg font-bold flex items-center gap-1.5 transition flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {copiedTotp ? <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-4 h-4" />}
                    <span>{copiedTotp ? t.pdCopiedLabel : t.toolsCopyShort}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'email' && (
            <div className="space-y-3">
              <div className="p-2.5 bg-amber-50 dark:bg-amber-950/70 border border-amber-500/40 rounded-lg text-[11px] text-amber-800 dark:text-amber-200">
                {t.demoDataNotice}
              </div>
              <div>
                <label className="font-bold text-slate-800 dark:text-slate-200 block mb-1">{t.emailReaderTool}</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder="email@hotmail.com|password"
                    className="flex-1 bg-[#f5f6f6] dark:bg-[#16181b] border border-[#e2e6e5] dark:border-[#30333b] rounded-lg px-3 py-2 text-xs font-mono text-slate-800 dark:text-slate-200 focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    onClick={handleReadEmail}
                    disabled={isReadingMail}
                    className="bg-[#e7ebe9] dark:bg-[#292b31] hover:bg-[#dee3e1] hover:dark:bg-[#363941] border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 font-bold px-4 py-2 rounded-lg transition flex items-center gap-1"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isReadingMail ? 'animate-spin' : ''}`} />
                    <span>{isReadingMail ? t.toolsReadingInbox : t.toolsReadInbox}</span>
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                {emails.map((m, idx) => (
                  <div key={idx} className="p-3 bg-[#f2f4f3] dark:bg-[#1a1b1f] border border-[#e2e6e5] dark:border-[#30333b] rounded-xl space-y-1">
                    <div className="flex items-center justify-between text-slate-600 dark:text-slate-400 text-[11px]">
                      <span className="text-slate-800 dark:text-slate-200 font-medium">{m.sender}</span>
                      <span>{m.time}</span>
                    </div>
                    <div className="text-slate-700 dark:text-slate-300 font-medium">{m.subject}</div>
                    {m.code && (
                      <div className="inline-block bg-[#eceeed] dark:bg-[#23252a] border border-emerald-500/30 px-2 py-0.5 rounded text-emerald-700 dark:text-emerald-300 font-mono font-bold text-xs">
                        OTP: {m.code}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'splitter' && (
            <div className="space-y-3">
              {/* Input format — pick one of the two real formats accounts
                  come in, or type any custom pipe-separated field list. */}
              <div>
                <label className="font-bold text-slate-800 dark:text-slate-200 block mb-1">
                  {t.toolsInputFormatLabel}
                </label>
                <div className="space-y-1.5">
                  {SPLITTER_PRESETS.map((preset, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setInputPresetIdx(idx)}
                      className={`w-full text-left font-mono text-[10px] leading-snug px-2.5 py-1.5 rounded-lg border transition ${
                        inputPresetIdx === idx
                          ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-500 text-emerald-700 dark:text-emerald-300'
                          : 'bg-[#f5f6f6] dark:bg-[#16181b] border-[#e2e6e5] dark:border-[#30333b] text-slate-600 dark:text-slate-400 hover:border-emerald-500/40'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setInputPresetIdx('custom')}
                    className={`w-full text-left text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border transition ${
                      inputPresetIdx === 'custom'
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-500 text-emerald-700 dark:text-emerald-300'
                        : 'bg-[#f5f6f6] dark:bg-[#16181b] border-[#e2e6e5] dark:border-[#30333b] text-slate-600 dark:text-slate-400 hover:border-emerald-500/40'
                    }`}
                  >
                    {t.toolsCustomFormatLabel}
                  </button>
                  {inputPresetIdx === 'custom' && (
                    <input
                      type="text"
                      value={customInputFormat}
                      onChange={(e) => setCustomInputFormat(e.target.value)}
                      placeholder="Username | Password | 2FA | Email | Cookies"
                      className="w-full bg-[#f5f6f6] dark:bg-[#16181b] border border-emerald-500/40 rounded-lg px-3 py-2 font-mono text-[11px] text-slate-800 dark:text-slate-200 focus:outline-none focus:border-emerald-500"
                    />
                  )}
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-800 dark:text-slate-200 block mb-1">
                  {t.toolsPasteDataLabel}
                </label>
                <textarea
                  rows={4}
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  className="w-full bg-[#f5f6f6] dark:bg-[#16181b] border border-[#e2e6e5] dark:border-[#30333b] rounded-lg p-3 font-mono text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-emerald-500"
                />
                <button
                  onClick={handleSplit}
                  className="mt-2 bg-[#e7ebe9] dark:bg-[#292b31] hover:bg-[#dee3e1] hover:dark:bg-[#363941] border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 font-bold px-4 py-2 rounded-lg transition"
                >
                  {t.toolsSplitDataBtn}
                </button>
              </div>

              {splitRows && (
                <div className="space-y-3">
                  {/* Parsed result, dynamic columns matching the chosen input format */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-left font-mono text-[11px] border border-[#e2e6e5] dark:border-[#30333b] rounded-lg overflow-hidden">
                      <thead className="bg-[#f2f4f3] dark:bg-[#1a1b1f] text-slate-600 dark:text-slate-400 border-b border-[#e2e6e5] dark:border-[#30333b]">
                        <tr>
                          {parsedFields.map((f) => (
                            <th key={f} className="p-2 whitespace-nowrap">{f}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#e2e6e5]">
                        {splitRows.map((row, idx) => (
                          <tr key={idx} className="bg-[#f5f6f6] dark:bg-[#16181b]">
                            {parsedFields.map((f) => (
                              <td key={f} className="p-2 text-slate-700 dark:text-slate-300 max-w-[160px] truncate" title={row[f]}>
                                {row[f] || '—'}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Build a new output format by toggling which parsed
                      fields to include — order clicked = order in output. */}
                  <div>
                    <label className="font-bold text-slate-800 dark:text-slate-200 block mb-1.5">
                      {t.toolsOutputFormatLabel}
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {availableOutputFields.map((f) => {
                        const selectedPos = outputFields.indexOf(f);
                        const isSelected = selectedPos !== -1;
                        return (
                          <button
                            key={f}
                            type="button"
                            onClick={() => toggleOutputField(f)}
                            className={`flex items-center gap-1 text-[11px] font-mono font-semibold px-2.5 py-1.5 rounded-lg border transition ${
                              isSelected
                                ? 'bg-emerald-500 border-emerald-400 text-slate-950'
                                : 'bg-[#f5f6f6] dark:bg-[#16181b] border-[#e2e6e5] dark:border-[#30333b] text-slate-600 dark:text-slate-400 hover:border-emerald-500/40'
                            }`}
                          >
                            {isSelected && <span className="opacity-70">{selectedPos + 1}.</span>}
                            <span>{f}</span>
                          </button>
                        );
                      })}
                    </div>
                    {availableOutputFields.includes('Auth_token') && (
                      <p className="text-[10px] text-slate-500 dark:text-slate-500 mt-1.5">{t.toolsAuthTokenHint}</p>
                    )}
                  </div>

                  {/* Reassembled result in the new format */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="font-bold text-slate-800 dark:text-slate-200">
                        {t.toolsOutputResultLabel}
                      </label>
                      <button
                        onClick={handleCopySplitOutput}
                        disabled={splitOutputLines.length === 0}
                        className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 hover:dark:text-emerald-300 font-semibold flex items-center gap-1 text-[11px] disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {copiedSplitOutput ? <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedSplitOutput ? t.pdCopiedLabel : t.toolsCopyOutputBtn}</span>
                      </button>
                    </div>
                    {outputFields.length === 0 ? (
                      <div className="text-[11px] text-slate-600 dark:text-slate-400 bg-[#f5f6f6] dark:bg-[#16181b] border border-[#e2e6e5] dark:border-[#30333b] rounded-lg p-3 text-center">
                        {t.toolsNoOutputFieldsHint}
                      </div>
                    ) : (
                      <textarea
                        readOnly
                        rows={Math.max(6, splitOutputLines.length)}
                        value={splitOutputLines.join('\n')}
                        className="w-full bg-[#f5f6f6] dark:bg-[#16181b] border border-emerald-500/30 rounded-lg p-3 font-mono text-[11px] text-emerald-700 dark:text-emerald-300 focus:outline-none resize-none"
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: RENEW TOKEN HOTMAIL */}
          {activeTab === 'renew-hotmail' && (
            <div className="space-y-4">
              <div className="bg-[#f2f4f3] dark:bg-[#1a1b1f] border border-[#e2e6e5] dark:border-[#30333b] rounded-xl p-3.5 space-y-1.5">
                <div className="flex items-center gap-2 text-slate-900 dark:text-slate-100 font-bold text-xs">
                  <RefreshCw className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span>{t.renewHotmail}</span>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                  {t.renewHotmailDesc}
                </p>
                <div className="text-[10px] text-slate-600 dark:text-slate-400 font-mono pt-1">
                  {t.toolsFormatLabel} <code className="text-emerald-700 dark:text-emerald-300">refresh_token</code> {t.toolsOrWord} <code className="text-emerald-700 dark:text-emerald-300">email|refresh_token</code> {t.toolsOrWord} <code className="text-emerald-700 dark:text-emerald-300">email|refresh_token|client_id</code>
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-800 dark:text-slate-200 block mb-1">
                  {t.toolsHotmailTokensLabel}
                </label>
                <textarea
                  rows={4}
                  value={hotmailTokensInput}
                  onChange={(e) => setHotmailTokensInput(e.target.value)}
                  placeholder="ronan_user1@hotmail.com|M.C543_BAY.0.U.-CtwJ!1829481928a9b1c2d3e4f5g"
                  className="w-full bg-[#f5f6f6] dark:bg-[#16181b] border border-[#e2e6e5] dark:border-[#30333b] rounded-xl p-3 font-mono text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-emerald-500"
                />

                <div className="flex items-center justify-between mt-2">
                  <span className="text-[11px] text-slate-600 dark:text-slate-400">
                    {t.toolsLinesLabel} {hotmailTokensInput.split('\n').filter(Boolean).length}
                  </span>

                  <button
                    onClick={handleRenewHotmailTokens}
                    disabled={isRenewingToken || !hotmailTokensInput.trim()}
                    className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-slate-950 font-bold px-5 py-2 rounded-xl transition flex items-center gap-1.5 disabled:opacity-40 shadow-md shadow-emerald-500/20"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isRenewingToken ? 'animate-spin' : ''}`} />
                    <span>{isRenewingToken ? t.toolsSendingMsApi : t.toolsRenewTokenBtn}</span>
                  </button>
                </div>
              </div>

              {/* Results */}
              {renewResult && (
                <div className="space-y-3 pt-2 border-t border-[#e2e6e5] dark:border-[#30333b]">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-bold text-slate-900 dark:text-slate-100">{t.toolsResultsLabel}</span>
                      <span className="text-[11px] bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded font-bold">
                        ✓ LIVE: {renewResult.liveCount}
                      </span>
                      {renewResult.dieCount > 0 && (
                        <span className="text-[11px] bg-red-50 dark:bg-red-950/70 text-red-700 dark:text-red-300 border border-red-500/30 px-2 py-0.5 rounded font-bold">
                          ✕ DIE: {renewResult.dieCount}
                        </span>
                      )}
                    </div>

                    <button
                      onClick={handleCopyAllAccessTokens}
                      className="text-emerald-700 dark:text-emerald-300 hover:text-slate-900 hover:dark:text-slate-100 text-xs font-semibold flex items-center gap-1 bg-[#f2f4f3] dark:bg-[#1a1b1f] px-2.5 py-1 rounded-lg border border-[#e2e6e5] dark:border-[#30333b]"
                    >
                      {copiedAllTokens ? <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedAllTokens ? t.toolsCopiedAll : t.toolsCopyAllBtn}</span>
                    </button>
                  </div>

                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {renewResult.results.map((item: any, idx: number) => (
                      <div
                        key={idx}
                        className="p-3 rounded-xl border border-[#e2e6e5] dark:border-[#30333b] bg-[#f2f4f3] dark:bg-[#1a1b1f] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                      >
                        <div className="space-y-1 flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-800 dark:text-slate-200 text-xs truncate">{item.email}</span>
                            <span
                              className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                item.status === 'LIVE'
                                  ? 'bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30'
                                  : 'bg-red-50 dark:bg-red-950/70 text-red-700 dark:text-red-300 border border-red-500/30'
                              }`}
                            >
                              {item.status}
                            </span>
                            {item.expiresIn > 0 && (
                              <span className="text-[10px] text-slate-600 dark:text-slate-400">
                                {t.toolsExpiresInTemplate.replace('{s}', String(item.expiresIn))}
                              </span>
                            )}
                          </div>

                          {item.accessToken ? (
                            <div className="font-mono text-[11px] text-emerald-700 dark:text-emerald-300 truncate bg-[#f5f6f6] dark:bg-[#16181b] px-2 py-1 rounded border border-[#e2e6e5] dark:border-[#30333b]">
                              {item.accessToken}
                            </div>
                          ) : (
                            <div className="text-[11px] text-slate-600 dark:text-slate-400">
                              {t.toolsTokenExpiredMsg}
                            </div>
                          )}
                        </div>

                        {item.accessToken && (
                          <button
                            onClick={() => handleCopySingleToken(item.accessToken, idx)}
                            className="flex-shrink-0 bg-[#e7ebe9] dark:bg-[#292b31] hover:bg-[#dee3e1] hover:dark:bg-[#363941] border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 font-semibold px-3 py-1.5 rounded-lg text-xs flex items-center gap-1 transition"
                          >
                            {copiedTokenIndex === idx ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                <span className="text-emerald-600 dark:text-emerald-400 font-bold">{t.pdCopiedLabel}</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5" />
                                <span>Copy Token</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#e2e6e5] dark:border-[#30333b] bg-[#f2f4f3] dark:bg-[#1a1b1f] flex justify-end">
          <button
            onClick={onClose}
            className="bg-[#e7ebe9] dark:bg-[#292b31] hover:bg-[#dee3e1] hover:dark:bg-[#363941] border border-emerald-500/30 text-slate-800 dark:text-slate-200 text-xs font-semibold px-5 py-2 rounded-lg transition"
          >
            {t.closeBtn}
          </button>
        </div>
      </div>
    </div>
  );
};
