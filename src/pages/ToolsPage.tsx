import React, { useEffect, useState } from 'react';
import { TOTP, Secret } from 'otpauth';
import { Language } from '../types';
import { translations } from '../locales/translations';
import { ArrowLeft, Wrench, Key, Mail, Split, Copy, Check, RefreshCw, ShieldCheck, Cookie, Download, Trash2, Clipboard, Sparkles } from 'lucide-react';
import { EmailReaderTab } from '../components/tools/EmailReaderTab';
import { CheckLiveXTab } from '../components/tools/CheckLiveXTab';
import { GetCookieXTab } from '../components/tools/GetCookieXTab';

// Real RFC 6238 TOTP — the exact same algorithm an authenticator app (Google
// Authenticator, Authy...) runs over a secret you already hold, not a guess
// or a lookup against anything live. Returns null for a secret that isn't
// valid Base32 rather than throwing, so a bad paste shows an error state
// instead of crashing the page.
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

// Accepts a bare secret per line, "Label|SECRET", or a full
// Username|Password|2FA|... account line — every account in this store is
// already uploaded/exported in that exact pipe format, so admin can paste
// straight from inventory without manually stripping the other fields out.
function parseSecretLine(line: string): { label: string; secret: string } {
  const parts = line.split('|').map((p) => p.trim());
  if (parts.length <= 1) return { label: '', secret: parts[0] || '' };
  if (parts.length === 2) return { label: parts[0], secret: parts[1] };
  return { label: parts[0], secret: parts[2] };
}

type ToolKey = '2fa' | 'splitter' | 'email' | 'renew-hotmail' | 'check-live-x' | 'get-cookie-x';

interface ToolsPageProps {
  language: Language;
  onBackToStore: () => void;
}

export const ToolsPage: React.FC<ToolsPageProps> = ({ language, onBackToStore }) => {
  const t = translations[language];
  const [activeTab, setActiveTab] = useState<ToolKey>('2fa');

  // The tool list itself — adding a future tool only means one more entry
  // here plus a matching content block below, instead of touching a fixed
  // 4-column tab grid like the old modal had.
  const TOOLS: { key: ToolKey; icon: React.ReactNode; label: string }[] = [
    { key: '2fa', icon: <Key className="w-3.5 h-3.5" />, label: '2FA (TOTP)' },
    { key: 'splitter', icon: <Split className="w-3.5 h-3.5" />, label: t.toolsSplitterTabLabel },
    { key: 'email', icon: <Mail className="w-3.5 h-3.5" />, label: t.toolsEmailReader || 'Email Reader' },
    { key: 'renew-hotmail', icon: <RefreshCw className="w-3.5 h-3.5" />, label: t.renewHotmail },
    { key: 'check-live-x', icon: <ShieldCheck className="w-3.5 h-3.5" />, label: t.checkLiveX || 'Check Live X' },
    { key: 'get-cookie-x', icon: <Cookie className="w-3.5 h-3.5" />, label: t.getCookieX || 'Get Cookie X' },
  ];

  // 2FA TOTP Generator state — one secret per line, each gets its own live code.
  const [multiSecretInput, setMultiSecretInput] = useState('');
  const [totpResults, setTotpResults] = useState<{ label: string; secret: string; code: string | null }[]>([]);
  const [secondsRemaining, setSecondsRemaining] = useState(30);
  const [copiedTotpIdx, setCopiedTotpIdx] = useState<number | null>(null);
  const [copiedAllTotp, setCopiedAllTotp] = useState(false);

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
  const [rawText, setRawText] = useState('');
  const [splitRows, setSplitRows] = useState<Record<string, string>[] | null>(null);
  const [parsedFields, setParsedFields] = useState<string[]>([]);
  const [outputFields, setOutputFields] = useState<string[]>([]);
  const [copiedSplitOutput, setCopiedSplitOutput] = useState(false);
  const [splitterNotice, setSplitterNotice] = useState<string | null>(null);

  const showSplitterNotice = (msg: string) => {
    setSplitterNotice(msg);
    setTimeout(() => setSplitterNotice(null), 3000);
  };

  const handlePasteRawText = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setRawText(text);
        showSplitterNotice(t.toolsPastedNotice);
      }
    } catch {
      showSplitterNotice(t.toolsPasteManualNotice);
    }
  };

  const handleRemoveDuplicatesRawText = () => {
    const rawLines = rawText.split('\n').map((l) => l.trim()).filter(Boolean);
    if (rawLines.length === 0) return;
    const unique = Array.from(new Set(rawLines));
    setRawText(unique.join('\n'));
    const diff = rawLines.length - unique.length;
    showSplitterNotice(t.toolsDedupeNoticeTemplate.replace('{removed}', String(diff)).replace('{unique}', String(unique.length)));
  };

  const handleCleanRawText = () => {
    const rawLines = rawText.split('\n').map((l) => l.trim()).filter(Boolean);
    setRawText(rawLines.join('\n'));
    showSplitterNotice(t.toolsCleanNoticeTemplate.replace('{n}', String(rawLines.length)));
  };

  const handleClearRawText = () => {
    setRawText('');
    setSplitRows(null);
    setParsedFields([]);
    setOutputFields([]);
  };

  const handleDownloadSplitOutput = () => {
    if (splitOutputLines.length === 0) return;
    const blob = new Blob([splitOutputLines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Formatted_Text_${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showSplitterNotice(t.toolsDownloadedNotice);
  };

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
  const [hotmailTokensInput, setHotmailTokensInput] = useState('');
  const [isRenewingToken, setIsRenewingToken] = useState(false);
  const [renewResult, setRenewResult] = useState<any>(null);
  const [copiedLineIndex, setCopiedLineIndex] = useState<number | null>(null);
  const [copiedAllLines, setCopiedAllLines] = useState(false);

  // Recomputes every secret's TOTP code every second so it's always correct
  // for the live 30-second window — not just refreshed at the boundary, so
  // pasting a new batch shows the right codes immediately instead of stale
  // ones. All secrets share the same countdown: TOTP's 30s window is tied to
  // the wall clock, not to any individual secret.
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setSecondsRemaining(30 - (now.getSeconds() % 30));
      const lines = multiSecretInput.split('\n').map((l) => l.trim()).filter(Boolean);
      setTotpResults(
        lines.map((line) => {
          const { label, secret } = parseSecretLine(line);
          return { label, secret, code: computeTotp(secret) };
        })
      );
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [multiSecretInput]);

  const handleCopyTotpLine = (idx: number) => {
    const r = totpResults[idx];
    if (!r?.code) return;
    navigator.clipboard.writeText(r.code);
    setCopiedTotpIdx(idx);
    setTimeout(() => setCopiedTotpIdx(null), 2000);
  };

  const handleCopyAllTotp = () => {
    const valid = totpResults.filter((r) => r.code);
    if (valid.length === 0) return;
    navigator.clipboard.writeText(valid.map((r) => (r.label ? `${r.label}|${r.code}` : r.code)).join('\n'));
    setCopiedAllTotp(true);
    setTimeout(() => setCopiedAllTotp(false), 2000);
  };

  const handleSplit = () => {
    const fields = activeInputFields;
    if (fields.length === 0) return;
    const lines = rawText.split('\n').map((l) => l.trim()).filter(Boolean);

    const parsed = lines.map((line) => {
      const parts = line.split('|');
      const row: Record<string, string> = {};
      fields.forEach((fieldName, idx) => {
        row[fieldName] = idx === fields.length - 1 ? parts.slice(idx).join('|').trim() : (parts[idx] || '').trim();
      });
      if (fields.includes('Cookies')) {
        row['Auth_token'] = extractAuthTokenFromCookie(row['Cookies'] || '');
      }
      return row;
    });

    setSplitRows(parsed);
    setParsedFields(fields.includes('Cookies') ? [...fields, 'Auth_token'] : fields);
    setOutputFields(fields.includes('Cookies') ? [...fields, 'Auth_token'] : fields);
  };

  const handleRenewHotmailTokens = async () => {
    if (!hotmailTokensInput.trim()) return;
    setIsRenewingToken(true);
    const lines = hotmailTokensInput.split('\n').map((l) => l.trim()).filter(Boolean);
    const results: any[] = [];
    let liveCount = 0;
    let dieCount = 0;

    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];
      const parts = line.split('|').map((p) => p.trim());
      let email = '';
      let password = '';
      let refreshToken = '';
      let clientId = '000000004017045b';
      let tokenIndex = -1;

      if (parts.length >= 4) {
        email = parts[0];
        password = parts[1];
        refreshToken = parts[2];
        clientId = parts[3] || '000000004017045b';
        tokenIndex = 2;
      } else if (parts.length === 3) {
        email = parts[0];
        if (parts[1].length > 30 || parts[1].startsWith('M.') || parts[1].startsWith('0.')) {
          refreshToken = parts[1];
          clientId = parts[2] || '000000004017045b';
          tokenIndex = 1;
        } else {
          password = parts[1];
          refreshToken = parts[2];
          tokenIndex = 2;
        }
      } else if (parts.length === 2) {
        if (parts[0].includes('@')) {
          email = parts[0];
          refreshToken = parts[1];
          tokenIndex = 1;
        } else {
          refreshToken = parts[0];
          clientId = parts[1] || '000000004017045b';
          tokenIndex = 0;
        }
      } else {
        if (line.includes('@')) {
          email = line;
        } else {
          refreshToken = line;
          tokenIndex = 0;
        }
      }

      // If tokenIndex is not set but parts exist, find the token part
      if (tokenIndex === -1 && parts.length > 1) {
        const foundIdx = parts.findIndex(
          (p) => (p.length > 30 || p.startsWith('M.') || p.startsWith('0.')) && !p.includes('@')
        );
        if (foundIdx !== -1) {
          refreshToken = parts[foundIdx];
          tokenIndex = foundIdx;
        }
      }

      try {
        const res = await fetch('/api/renew_token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email,
            password,
            refresh_token: refreshToken,
            client_id: clientId || '000000004017045b',
          }),
        });
        const data = await res.json();
        if (res.ok && data.status) {
          liveCount++;
          let outputLine = line;
          if (data.new_refresh_token) {
            if (tokenIndex >= 0 && tokenIndex < parts.length) {
              const newParts = [...parts];
              newParts[tokenIndex] = data.new_refresh_token;
              outputLine = newParts.join('|');
            } else {
              outputLine = data.new_refresh_token;
            }
          }

          results.push({
            id: idx + 1,
            input: line,
            outputLine,
            email: data.email || email || `user_${idx + 1}@hotmail.com`,
            newRefreshToken: data.new_refresh_token || null,
            expiresIn: data.expires_in || 3600,
            status: 'LIVE',
            renewedAt: new Date().toLocaleTimeString(),
          });
        } else {
          dieCount++;
          results.push({
            id: idx + 1,
            input: line,
            outputLine: line,
            email: email || `user_${idx + 1}@hotmail.com`,
            newRefreshToken: null,
            expiresIn: 0,
            status: 'DIE',
            errorMessage: data?.error || t.toolsInvalidTokenError,
            renewedAt: new Date().toLocaleTimeString(),
          });
        }
      } catch (err: any) {
        dieCount++;
        results.push({
          id: idx + 1,
          input: line,
          outputLine: line,
          email: email || `user_${idx + 1}@hotmail.com`,
          newRefreshToken: null,
          expiresIn: 0,
          status: 'DIE',
          errorMessage: err.message || t.toolsConnectionError,
          renewedAt: new Date().toLocaleTimeString(),
        });
      }
    }

    setRenewResult({
      total: results.length,
      liveCount,
      dieCount,
      results,
    });
    setIsRenewingToken(false);
  };

  const handleCopyLine = (line: string, idx: number) => {
    navigator.clipboard.writeText(line);
    setCopiedLineIndex(idx);
    setTimeout(() => setCopiedLineIndex(null), 2000);
  };

  const handleCopyAllRenewedLines = () => {
    if (!renewResult || !renewResult.results) return;
    const liveResults = renewResult.results.filter(
      (r: any) => r.status === 'LIVE' || r.status === 'HOẠT ĐỘNG'
    );
    const targetResults = liveResults.length > 0 ? liveResults : renewResult.results;
    const allLines = targetResults.map((r: any) => r.outputLine).join('\n');
    navigator.clipboard.writeText(allLines);
    setCopiedAllLines(true);
    setTimeout(() => setCopiedAllLines(false), 2000);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
      <button onClick={onBackToStore} className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:dark:text-slate-100 mb-4 transition">
        <ArrowLeft className="w-3.5 h-3.5" />
        <span>{t.authBackToStore}</span>
      </button>

      <div className="flex items-center gap-2.5 mb-5">
        <div className="w-9 h-9 rounded-lg bg-[#eceeed] dark:bg-[#23252a] border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shadow-sm flex-shrink-0">
          <Wrench className="w-4.5 h-4.5" />
        </div>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100">{t.toolsTitle}</h1>
      </div>

      <div className="flex flex-col md:flex-row gap-4 md:gap-6">
        {/* Tool list — a vertical sidebar from md up, a horizontally
            scrollable pill row below that. Adding a future tool is just one
            more entry in TOOLS plus a matching content block, no layout
            rework needed either way. The wrapper is `relative` purely to
            host the mobile fade hint below — it has no layout effect of
            its own, so it doesn't change how `nav` sizes inside the outer
            flex row. */}
        {/* flex-wrap instead of a horizontal scroll: a scrollable row can
            hide a tool below the fold with nothing but a thin scrollbar as
            a clue it's there. Wrapping to a second row instead means every
            tool is always on screen without any scrolling — and it keeps
            scaling the same way as more tools get added later. */}
        <nav className="grid grid-cols-2 md:flex md:flex-col gap-1.5 md:w-56 flex-shrink-0">
          {TOOLS.map((tool) => (
            <button
              key={tool.key}
              onClick={() => setActiveTab(tool.key)}
              className={`flex items-center gap-2 text-left text-[11px] md:text-xs font-semibold px-2.5 py-2 md:px-3 md:py-2.5 rounded-lg md:rounded-xl border transition ${
                activeTab === tool.key
                  ? 'bg-[#eef0ef] dark:bg-[#202227] border-emerald-400 text-emerald-700 dark:text-emerald-300'
                  : 'bg-[#eceeed] dark:bg-[#23252a] border-[#dfe3e1] dark:border-[#353840] text-slate-700 dark:text-slate-300 hover:border-emerald-500/40'
              }`}
            >
              <span className="flex-shrink-0">{tool.icon}</span>
              <span className="leading-tight">{tool.label}</span>
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="flex-1 min-w-0 bg-[#eef0ef] dark:bg-[#202227] border border-[#e1e4e3] dark:border-[#32363e] rounded-2xl p-5 text-xs">
          {activeTab === '2fa' && (
            <div className="space-y-3">
              <div>
                <label className="font-bold text-slate-800 dark:text-slate-200 block mb-1">{t.twoFaTool}</label>
                <textarea
                  rows={4}
                  value={multiSecretInput}
                  onChange={(e) => setMultiSecretInput(e.target.value)}
                  placeholder={t.twoFaPlaceholder}
                  className="w-full bg-[#f5f6f6] dark:bg-[#16181b] border border-[#e2e6e5] dark:border-[#30333b] rounded-xl p-3 font-mono text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-emerald-500 uppercase"
                />
                {totpResults.length > 0 && (
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono block mt-1">
                    {totpResults.length} {t.toolsLinesCountSuffix}
                  </span>
                )}
              </div>

              {totpResults.length === 0 ? (
                <div className="text-center text-xs text-slate-500 dark:text-slate-500 py-6 border border-[#e2e6e5] dark:border-[#30333b] rounded-xl">
                  {t.twoFaEmptyHint}
                </div>
              ) : (
                <div className="space-y-2.5 pt-2 border-t border-[#e2e6e5] dark:border-[#30333b]">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-600 dark:text-slate-400">{t.toolsRefreshIn}</span>
                      <span className="text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400">{secondsRemaining}s</span>
                    </div>
                    <button
                      onClick={handleCopyAllTotp}
                      className="text-slate-700 dark:text-slate-300 hover:text-slate-900 hover:dark:text-slate-100 text-xs font-semibold flex items-center gap-1.5 bg-[#f2f4f3] dark:bg-[#1a1b1f] px-2.5 py-1.5 rounded-lg border border-[#e2e6e5] dark:border-[#30333b] cursor-pointer"
                    >
                      {copiedAllTotp ? <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedAllTotp ? t.toolsCopiedAll : t.toolsCopyAllBtn}</span>
                    </button>
                  </div>

                  <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
                    {totpResults.map((r, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-[#e2e6e5] dark:border-[#30333b] bg-[#fafcfb] dark:bg-[#181a1e] hover:border-emerald-500/30 transition text-xs"
                      >
                        <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400 bg-[#e7ebe9] dark:bg-[#282a30] px-1.5 py-0.5 rounded font-bold flex-shrink-0">
                          #{idx + 1}
                        </span>
                        {/* The secret itself (not just the optional label) sits
                            right before its code, so admin can match a code
                            back to exactly which pasted secret it came from —
                            truncated with the full value on hover since
                            secrets can run long. */}
                        <span className="font-mono text-slate-600 dark:text-slate-400 truncate flex-1 min-w-0" title={r.label ? `${r.label} | ${r.secret}` : r.secret}>
                          {r.label ? `${r.label} | ${r.secret}` : r.secret}
                        </span>
                        <span
                          className={`font-mono font-black tracking-wider flex-shrink-0 ${
                            r.code ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400 text-[11px]'
                          }`}
                        >
                          {r.code ? `${r.code.slice(0, 3)} ${r.code.slice(3)}` : t.toolsInvalidSecretKey}
                        </span>
                        <button
                          onClick={() => handleCopyTotpLine(idx)}
                          disabled={!r.code}
                          className="text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-[#e7ebe9] dark:hover:bg-[#282a30] p-1.5 rounded transition flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {copiedTotpIdx === idx ? (
                            <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'email' && <EmailReaderTab language={language} />}

          {activeTab === 'splitter' && (
            <div className="space-y-3">
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

              {/* Toast for text format actions */}
              {splitterNotice && (
                <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-800 dark:text-emerald-300 text-xs px-3.5 py-2 rounded-xl flex items-center justify-between transition animate-fadeIn">
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span className="font-medium">{splitterNotice}</span>
                  </div>
                  <button
                    onClick={() => setSplitterNotice(null)}
                    className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer ml-2 text-sm"
                  >
                    ×
                  </button>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <label className="font-bold text-slate-800 dark:text-slate-200 block">
                    {t.toolsPasteDataLabel}
                  </label>
                  {rawText && (
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                      {rawText.split('\n').filter((l) => l.trim()).length} {t.toolsLinesCountSuffix}
                    </span>
                  )}
                </div>

                {/* Quick text action toolbar */}
                <div className="flex flex-wrap items-center gap-1.5 p-1.5 mb-1.5 bg-[#f0f3f2] dark:bg-[#141518] rounded-xl border border-[#e2e6e5] dark:border-[#30333b]">
                  <button
                    type="button"
                    onClick={handlePasteRawText}
                    className="text-[11px] font-semibold bg-white dark:bg-[#22242a] hover:bg-slate-50 hover:dark:bg-[#2c2f37] text-slate-700 dark:text-slate-200 border border-[#e2e6e5] dark:border-[#30333b] px-2.5 py-1 rounded-lg transition flex items-center gap-1 cursor-pointer shadow-xs"
                    title={t.toolsPasteTooltip}
                  >
                    <Clipboard className="w-3 h-3 text-emerald-500" />
                    <span>{t.toolsPasteBtn}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleRemoveDuplicatesRawText}
                    disabled={!rawText.trim()}
                    className="text-[11px] font-semibold bg-white dark:bg-[#22242a] hover:bg-slate-50 hover:dark:bg-[#2c2f37] text-slate-700 dark:text-slate-200 border border-[#e2e6e5] dark:border-[#30333b] px-2.5 py-1 rounded-lg transition flex items-center gap-1 cursor-pointer disabled:opacity-50 shadow-xs"
                    title={t.toolsDedupeTooltip}
                  >
                    <Sparkles className="w-3 h-3 text-blue-500" />
                    <span>{t.toolsDedupeBtn}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleCleanRawText}
                    disabled={!rawText.trim()}
                    className="text-[11px] font-semibold bg-white dark:bg-[#22242a] hover:bg-slate-50 hover:dark:bg-[#2c2f37] text-slate-700 dark:text-slate-200 border border-[#e2e6e5] dark:border-[#30333b] px-2.5 py-1 rounded-lg transition flex items-center gap-1 cursor-pointer disabled:opacity-50 shadow-xs"
                    title={t.toolsCleanTooltip}
                  >
                    <span>{t.toolsCleanBtn}</span>
                  </button>

                  {rawText && (
                    <button
                      type="button"
                      onClick={handleClearRawText}
                      className="text-[11px] font-semibold text-rose-600 dark:text-rose-400 hover:text-rose-700 px-2.5 py-1 rounded-lg transition flex items-center gap-1 cursor-pointer ml-auto"
                      title={t.toolsClearInputTooltip}
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>{t.toolsClearInputBtn}</span>
                    </button>
                  )}
                </div>

                <textarea
                  rows={5}
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  placeholder={activeInputFields.join(' | ')}
                  className="w-full bg-[#f5f6f6] dark:bg-[#16181b] border border-[#e2e6e5] dark:border-[#30333b] rounded-xl p-3 font-mono text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-emerald-500 resize-y"
                />

                <div className="flex items-center gap-2 mt-2">
                  <button
                    onClick={handleSplit}
                    disabled={!rawText.trim()}
                    className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold px-4 py-2 rounded-xl transition cursor-pointer shadow-xs flex items-center gap-1.5"
                  >
                    <Split className="w-3.5 h-3.5" />
                    <span>{t.toolsSplitDataBtn}</span>
                  </button>
                </div>
              </div>

              {splitRows && (
                <div className="space-y-3 pt-2 border-t border-[#e2e6e5] dark:border-[#30333b]">
                  {/* Table Preview (limited to 10 rows for high performance) */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-bold text-slate-800 dark:text-slate-200 text-xs">
                        {t.toolsPreviewTableLabel}
                      </span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                        {t.toolsShowingRowsTemplate.replace('{shown}', String(Math.min(10, splitRows.length))).replace('{total}', String(splitRows.length))}
                      </span>
                    </div>

                    <div className="relative">
                      <div className="overflow-x-auto max-h-56 border border-[#e2e6e5] dark:border-[#30333b] rounded-xl">
                        <table className="w-full text-left font-mono text-[11px]">
                          <thead className="bg-[#f2f4f3] dark:bg-[#1a1b1f] text-slate-600 dark:text-slate-400 border-b border-[#e2e6e5] dark:border-[#30333b] sticky top-0">
                            <tr>
                              <th className="p-2 w-10 text-center">#</th>
                              {parsedFields.map((f) => (
                                <th key={f} className="p-2 whitespace-nowrap">{f}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#e2e6e5] dark:divide-[#30333b]">
                            {splitRows.slice(0, 10).map((row, idx) => (
                              <tr key={idx} className="bg-[#f5f6f6] dark:bg-[#16181b] hover:bg-slate-100 hover:dark:bg-[#202227]">
                                <td className="p-2 text-center text-slate-400 text-[10px]">{idx + 1}</td>
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
                    </div>
                  </div>

                  {/* Output field selector & quick presets */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="font-bold text-slate-800 dark:text-slate-200 block">
                        {t.toolsOutputFormatLabel}
                      </label>

                      {/* Quick Field Selection Presets */}
                      <div className="flex items-center gap-1 text-[10px]">
                        <button
                          type="button"
                          onClick={() => setOutputFields([...availableOutputFields])}
                          className="px-2 py-0.5 rounded bg-[#f0f3f2] dark:bg-[#282a30] text-slate-700 dark:text-slate-300 hover:text-emerald-600 font-semibold cursor-pointer"
                        >
                          {t.toolsSelectAllBtn}
                        </button>
                        <button
                          type="button"
                          onClick={() => setOutputFields(['Username'])}
                          className="px-2 py-0.5 rounded bg-[#f0f3f2] dark:bg-[#282a30] text-slate-700 dark:text-slate-300 hover:text-emerald-600 font-semibold cursor-pointer"
                        >
                          {t.toolsSelectUsernameOnlyBtn}
                        </button>
                        <button
                          type="button"
                          onClick={() => setOutputFields(['Username', 'Password'])}
                          className="px-2 py-0.5 rounded bg-[#f0f3f2] dark:bg-[#282a30] text-slate-700 dark:text-slate-300 hover:text-emerald-600 font-semibold cursor-pointer"
                        >
                          User | Pass
                        </button>
                        <button
                          type="button"
                          onClick={() => setOutputFields([])}
                          className="px-2 py-0.5 rounded text-rose-600 dark:text-rose-400 hover:underline font-semibold cursor-pointer"
                        >
                          {t.toolsDeselectBtn}
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {availableOutputFields.map((f) => {
                        const selectedPos = outputFields.indexOf(f);
                        const isSelected = selectedPos !== -1;
                        return (
                          <button
                            key={f}
                            type="button"
                            onClick={() => toggleOutputField(f)}
                            className={`flex items-center gap-1 text-[11px] font-mono font-semibold px-2.5 py-1.5 rounded-lg border transition cursor-pointer ${
                              isSelected
                                ? 'bg-emerald-600 border-emerald-500 text-white shadow-xs'
                                : 'bg-[#f5f6f6] dark:bg-[#16181b] border-[#e2e6e5] dark:border-[#30333b] text-slate-600 dark:text-slate-400 hover:border-emerald-500/40'
                            }`}
                          >
                            {isSelected && <span className="opacity-80">{selectedPos + 1}.</span>}
                            <span>{f}</span>
                          </button>
                        );
                      })}
                    </div>
                    {availableOutputFields.includes('Auth_token') && (
                      <p className="text-[10px] text-slate-500 dark:text-slate-500 mt-1.5">{t.toolsAuthTokenHint}</p>
                    )}
                  </div>

                  {/* Formatted Output Result Box */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <label className="font-bold text-slate-800 dark:text-slate-200">
                          {t.toolsOutputResultLabel}
                        </label>
                        {splitOutputLines.length > 0 && (
                          <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                            ({splitOutputLines.length} {t.toolsLinesCountSuffix})
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleCopySplitOutput}
                          disabled={splitOutputLines.length === 0}
                          className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3 py-1.5 rounded-lg transition flex items-center gap-1 text-xs disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-xs"
                        >
                          {copiedSplitOutput ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                          <span>{copiedSplitOutput ? t.pdCopiedLabel : t.toolsCopyOutputBtn}</span>
                        </button>

                        <button
                          onClick={handleDownloadSplitOutput}
                          disabled={splitOutputLines.length === 0}
                          className="bg-[#f0f3f2] dark:bg-[#22242a] hover:bg-slate-200 hover:dark:bg-[#2c2f37] border border-[#e2e6e5] dark:border-[#30333b] text-slate-700 dark:text-slate-200 font-semibold px-2.5 py-1.5 rounded-lg transition flex items-center gap-1 text-xs disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                          title={t.toolsDownloadTxtTooltip}
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>{t.toolsDownloadTxtBtn}</span>
                        </button>

                        <button
                          onClick={() => setSplitRows(null)}
                          className="text-rose-600 dark:text-rose-400 hover:text-rose-700 font-semibold px-2.5 py-1.5 rounded-lg transition flex items-center gap-1 text-xs cursor-pointer"
                          title={t.toolsClearResultTooltip}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>{t.toolsClearResultBtn}</span>
                        </button>
                      </div>
                    </div>

                    {outputFields.length === 0 ? (
                      <div className="text-[11px] text-slate-600 dark:text-slate-400 bg-[#f5f6f6] dark:bg-[#16181b] border border-[#e2e6e5] dark:border-[#30333b] rounded-xl p-4 text-center">
                        {t.toolsNoOutputFieldsHint}
                      </div>
                    ) : (
                      <textarea
                        readOnly
                        rows={7}
                        value={splitOutputLines.join('\n')}
                        onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                        className="w-full bg-[#f5f6f6] dark:bg-[#16181b] border border-emerald-500/30 rounded-xl p-3 font-mono text-xs text-slate-800 dark:text-slate-200 focus:outline-none resize-y min-h-[140px] max-h-[350px]"
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'renew-hotmail' && (
            <div className="space-y-4">
              <div>
                <label className="font-bold text-slate-800 dark:text-slate-200 text-xs block mb-1">
                  {t.toolsHotmailTokensLabel}
                </label>
                <textarea
                  rows={4}
                  value={hotmailTokensInput}
                  onChange={(e) => setHotmailTokensInput(e.target.value)}
                  placeholder={`email|pass|refresh_token|client_id\nemail|pass|refresh_token|client_id`}
                  className="w-full bg-[#f5f6f6] dark:bg-[#16181b] border border-[#e2e6e5] dark:border-[#30333b] rounded-xl p-3 font-mono text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-emerald-500"
                />

                <div className="flex items-center justify-between mt-2">
                  <span className="text-[11px] text-slate-600 dark:text-slate-400">
                    {t.toolsLinesLabel} {hotmailTokensInput.split('\n').filter(Boolean).length}
                  </span>

                  <button
                    onClick={handleRenewHotmailTokens}
                    disabled={isRenewingToken || !hotmailTokensInput.trim()}
                    className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-slate-950 font-bold px-5 py-2 rounded-xl transition flex items-center gap-1.5 disabled:opacity-40 shadow-md shadow-emerald-500/20 cursor-pointer text-xs"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isRenewingToken ? 'animate-spin' : ''}`} />
                    <span>{isRenewingToken ? t.toolsSendingMsApi : t.toolsRenewTokenBtn}</span>
                  </button>
                </div>
              </div>

              {renewResult && (
                <div className="space-y-2.5 pt-2 border-t border-[#e2e6e5] dark:border-[#30333b]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-900 dark:text-slate-100">{t.toolsResultsLabel}</span>
                      <span className="text-[11px] bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded font-bold">
                        ✓ LIVE: {renewResult.liveCount}
                      </span>
                      {renewResult.dieCount > 0 && (
                        <span className="text-[11px] bg-rose-500/15 text-rose-700 dark:text-rose-400 border border-rose-500/30 px-2 py-0.5 rounded font-bold">
                          ✕ DIE: {renewResult.dieCount}
                        </span>
                      )}
                    </div>

                    <button
                      onClick={handleCopyAllRenewedLines}
                      className="text-emerald-700 dark:text-emerald-300 hover:text-slate-900 hover:dark:text-slate-100 text-xs font-semibold flex items-center gap-1.5 bg-[#f2f4f3] dark:bg-[#1a1b1f] px-2.5 py-1.5 rounded-lg border border-[#e2e6e5] dark:border-[#30333b] cursor-pointer"
                      title={t.toolsCopyAllBtn || 'Copy Tất Cả'}
                    >
                      {copiedAllLines ? (
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

                  <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
                    {renewResult.results.map((item: any, idx: number) => {
                      const isLive = item.status === 'LIVE' || item.status === 'HOẠT ĐỘNG';
                      return (
                        <div
                          key={idx}
                          className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-[#e2e6e5] dark:border-[#30333b] bg-[#fafcfb] dark:bg-[#181a1e] hover:border-emerald-500/30 transition text-xs group"
                        >
                          <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400 bg-[#e7ebe9] dark:bg-[#282a30] px-1.5 py-0.5 rounded font-bold flex-shrink-0">
                            #{idx + 1}
                          </span>

                          <span
                            className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${
                              isLive
                                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30'
                                : 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border border-rose-500/30'
                            }`}
                          >
                            {isLive ? 'LIVE' : 'DIE'}
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
                            {copiedLineIndex === idx ? (
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
          )}

          {activeTab === 'check-live-x' && <CheckLiveXTab language={language} />}
          {activeTab === 'get-cookie-x' && <GetCookieXTab language={language} />}
        </div>
      </div>
    </div>
  );
};
