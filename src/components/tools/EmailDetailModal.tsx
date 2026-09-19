import React, { useState } from 'react';
import { Mail, Key, Copy, Check, X, Calendar, User, ShieldCheck, Eye, FileText } from 'lucide-react';
import { Language } from '../../types';
import { translations } from '../../locales/translations';

export interface EmailDetailData {
  accountEmail: string;
  sender: string;
  subject: string;
  date: string;
  body: string;
  html?: string;
  otpCode?: string | null;
  raw?: any;
}

interface EmailDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  emailData: EmailDetailData | null;
  language: Language;
}

// Cleanly extracts readable plain text from rich HTML
function extractCleanText(htmlOrText: string): string {
  if (!htmlOrText) return '';
  if (!/<[a-z][\s\S]*>/i.test(htmlOrText)) return htmlOrText;

  let text = htmlOrText
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, '\n')
    .replace(/<br\s*[\/]?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

  // Collapse consecutive blank lines and trim
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line, idx, arr) => line.length > 0 || (idx > 0 && arr[idx - 1].length > 0))
    .join('\n')
    .trim() || '';
}

export const EmailDetailModal: React.FC<EmailDetailModalProps> = ({ isOpen, onClose, emailData, language }) => {
  const t = translations[language] || translations.vn;
  const [copiedOtp, setCopiedOtp] = useState(false);
  const [copiedBody, setCopiedBody] = useState(false);
  const [viewMode, setViewMode] = useState<'html' | 'text'>('html');

  if (!isOpen || !emailData) return null;

  const handleCopyOtp = () => {
    if (!emailData.otpCode) return;
    navigator.clipboard.writeText(emailData.otpCode);
    setCopiedOtp(true);
    setTimeout(() => setCopiedOtp(false), 2000);
  };

  // Determine whether HTML content exists
  const rawHtml =
    emailData.html ||
    (typeof emailData.body === 'string' && /<[a-z][\s\S]*>/i.test(emailData.body)
      ? emailData.body
      : '');

  const hasHtml = Boolean(rawHtml);
  const cleanText = extractCleanText(rawHtml || emailData.body || '');

  const handleCopyBody = () => {
    navigator.clipboard.writeText(cleanText);
    setCopiedBody(true);
    setTimeout(() => setCopiedBody(false), 2000);
  };

  // Prepare iframe safe responsive HTML document with no-referrer for external CDN images
  const prepareIframeSrc = (content: string) => {
    const headInjection = `
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta name="referrer" content="no-referrer">
      <style>
        * { box-sizing: border-box; }
        html, body {
          margin: 0;
          padding: 14px;
          background-color: #ffffff !important;
          color: #1e293b;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          -webkit-font-smoothing: antialiased;
          line-height: 1.5;
        }
        table { max-width: 100% !important; border-collapse: collapse; }
        img { max-width: 100% !important; height: auto !important; }
        a { color: #1da1f2; text-decoration: underline; }
      </style>
    `;

    if (content.includes('<head>')) {
      return content.replace(/<head>/i, `<head>${headInjection}`);
    } else if (content.includes('<html>')) {
      return content.replace(/<html>/i, `<html><head>${headInjection}</head>`);
    } else if (content.includes('<body')) {
      return `<!DOCTYPE html><html><head>${headInjection}</head>${content}</html>`;
    }

    return `<!DOCTYPE html>
<html>
<head>${headInjection}</head>
<body>${content}</body>
</html>`;
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-[#f0f2f1] dark:bg-[#1a1b1f] border border-[#dce0df] dark:border-[#30333b] rounded-2xl max-w-3xl w-full my-auto shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-4 py-3 border-b border-[#e2e6e5] dark:border-[#2a2d34] flex items-center justify-between bg-[#f8faf9] dark:bg-[#202227]">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center flex-shrink-0">
              <Mail className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                {t.emailReaderModalTitle}
              </h3>
              <p className="text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {t.emailReaderAccountInbox} <span className="font-mono text-emerald-600 dark:text-emerald-400 font-semibold">{emailData.accountEmail}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-800/50 flex items-center justify-center transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-3.5 sm:p-4 overflow-y-auto space-y-2.5 text-xs flex-1">
          {/* Super Compact OTP Copy Badge */}
          {emailData.otpCode && (
            <div className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                  <Key className="w-3 h-3 text-emerald-500" />
                  {t.emailReaderOtpLabel}
                </span>
                <button
                  onClick={handleCopyOtp}
                  title={t.emailReaderOtpCopyHint}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded font-mono font-bold text-xs tracking-wider transition cursor-pointer ${
                    copiedOtp
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'bg-white dark:bg-[#151619] border border-emerald-500/40 text-emerald-600 dark:text-emerald-300 hover:border-emerald-500'
                  }`}
                >
                  <span>{emailData.otpCode}</span>
                  {copiedOtp ? (
                    <span className="text-[10px] font-sans font-medium flex items-center gap-0.5">
                      <Check className="w-2.5 h-2.5" /> {t.emailReaderCopied}
                    </span>
                  ) : (
                    <Copy className="w-2.5 h-2.5 opacity-60" />
                  )}
                </button>
              </div>
              <span className="text-[10px] text-slate-400 hidden sm:inline">{t.emailReaderOtpCopyHint}</span>
            </div>
          )}

          {/* Email Metadata Details */}
          <div className="bg-[#f5f7f6] dark:bg-[#151619] rounded-xl p-3 border border-[#e2e6e5] dark:border-[#2a2d34] space-y-1.5">
            <div className="flex items-start gap-2">
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 w-16 flex-shrink-0">
                {t.emailReaderSubjectLabel}
              </span>
              <span className="text-slate-900 dark:text-slate-100 font-bold flex-1 break-words">
                {emailData.subject || '(No subject)'}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <User className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 w-14 flex-shrink-0">
                {t.emailReaderSenderLabel}
              </span>
              <span className="text-slate-800 dark:text-slate-200 font-mono text-[11px] break-all">
                {emailData.sender || 'Unknown'}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Calendar className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 w-14 flex-shrink-0">
                {t.emailReaderDateLabel}
              </span>
              <span className="text-slate-700 dark:text-slate-300 text-[11px]">
                {emailData.date || 'Recent'}
              </span>
            </div>
          </div>

          {/* Action Header: View Switcher & Copy Text Button */}
          <div className="flex items-center justify-between pt-0.5">
            {hasHtml ? (
              <div className="flex items-center gap-1 bg-[#e8ebea] dark:bg-[#202227] p-0.5 rounded-lg border border-[#dce0df] dark:border-[#2f323a]">
                <button
                  onClick={() => setViewMode('html')}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium flex items-center gap-1 transition cursor-pointer ${
                    viewMode === 'html'
                      ? 'bg-white dark:bg-[#151619] text-emerald-600 dark:text-emerald-400 font-bold shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  <Eye className="w-3 h-3" />
                  <span>{t.emailReaderHtmlTab}</span>
                </button>
                <button
                  onClick={() => setViewMode('text')}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium flex items-center gap-1 transition cursor-pointer ${
                    viewMode === 'text'
                      ? 'bg-white dark:bg-[#151619] text-emerald-600 dark:text-emerald-400 font-bold shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  <FileText className="w-3 h-3" />
                  <span>{t.emailReaderTextTab}</span>
                </button>
              </div>
            ) : (
              <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                {t.emailReaderTextTab}:
              </span>
            )}

            <button
              onClick={handleCopyBody}
              className="text-[11px] text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 font-semibold flex items-center gap-1 bg-emerald-500/10 hover:bg-emerald-500/20 px-2.5 py-1 rounded-lg border border-emerald-500/20 transition cursor-pointer"
            >
              {copiedBody ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedBody ? t.emailReaderCopiedTextBtn : t.emailReaderCopyTextBtn}</span>
            </button>
          </div>

          {/* Message Content View: HTML in clean iframe or Text */}
          {hasHtml && viewMode === 'html' ? (
            <div className="border border-[#dce0df] dark:border-[#30333b] rounded-xl overflow-hidden shadow-inner bg-white">
              <iframe
                title="Message content"
                srcDoc={prepareIframeSrc(rawHtml)}
                className="w-full h-[380px] sm:h-[430px] border-0 bg-white"
                sandbox="allow-same-origin allow-popups"
              />
            </div>
          ) : (
            <div className="border border-[#e2e6e5] dark:border-[#2a2d34] rounded-xl bg-[#fafafa] dark:bg-[#151619] p-3.5 overflow-y-auto max-h-[380px]">
              <div className="font-mono text-slate-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed break-words text-[11px] selection:bg-emerald-500/30">
                {cleanText || '(No text content)'}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-[#e2e6e5] dark:border-[#2a2d34] bg-[#f8faf9] dark:bg-[#202227] flex items-center justify-between">
          <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
            <span>Microsoft OAuth2 IMAP</span>
          </div>
          <button
            onClick={onClose}
            className="bg-[#e2e6e5] dark:bg-[#2d3037] hover:bg-[#d6dbda] hover:dark:bg-[#383c45] text-slate-800 dark:text-slate-200 text-xs font-semibold px-4 py-1.5 rounded-lg transition cursor-pointer"
          >
            {t.emailReaderCloseBtn}
          </button>
        </div>
      </div>
    </div>
  );
};
