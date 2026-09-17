import React, { useState, useRef } from 'react';
import { Language } from '../types';
import { LogIn, Mail, Lock, ShieldAlert, ArrowLeft } from 'lucide-react';
import { translations } from '../locales/translations';
import { TurnstileWidget, TurnstileWidgetHandle } from '../components/TurnstileWidget';
import { showCopyToast } from '../components/Toast';

interface LoginPageProps {
  language: Language;
  onLoginSuccess: () => void;
  onGoToRegister: () => void;
  onBackToStore: () => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ language, onLoginSuccess, onGoToRegister, onBackToStore }) => {
  const t = translations[language];
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const turnstileRef = useRef<TurnstileWidgetHandle>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!identifier.trim() || !password) {
      setError(t.authFillAllFields);
      return;
    }
    if (!turnstileToken) {
      setError(t.authTurnstileRequired);
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: identifier.trim(), password, turnstileToken }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t.authLoginFailed);
        setIsSubmitting(false);
        // A Turnstile token is single-use — reset the widget so the next
        // attempt can generate a fresh one.
        turnstileRef.current?.reset();
        setTurnstileToken('');
        return;
      }
      // The confirmation is now a global popup toast (mounted at the app
      // root, so it keeps showing across the redirect) instead of an inline
      // banner that briefly replaced the form — it doesn't need to block
      // navigation, so the redirect happens immediately.
      showCopyToast(t.authLoginSuccess);
      onLoginSuccess();
    } catch (err) {
      setError(t.authCannotConnect);
      setIsSubmitting(false);
      turnstileRef.current?.reset();
      setTurnstileToken('');
    }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <button
          onClick={onBackToStore}
          className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:dark:text-slate-100 mb-4 transition"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>{t.authBackToStore}</span>
        </button>

        <div className="bg-[#eef0ef] dark:bg-[#202227] border border-[#e1e4e3] dark:border-[#32363e] rounded-2xl p-6 sm:p-7 shadow-2xl">
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-9 h-9 rounded-lg bg-[#eceeed] dark:bg-[#23252a] border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <LogIn className="w-4 h-4" />
            </div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {t.authLoginTitle}
            </h1>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 mb-5">
            {t.authLoginSubtitle}
          </p>

          <form onSubmit={handleSubmit} className="space-y-3.5">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                {t.authUsernameOrEmail}
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 dark:text-slate-500" />
                <input
                  type="text"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  autoComplete="username"
                  className="w-full bg-[#f3f5f4] dark:bg-[#181a1e] border border-[#e0e4e2] dark:border-[#33363e] focus:border-emerald-500 rounded-lg pl-9 pr-3 py-2.5 text-sm text-slate-800 dark:text-slate-200 focus:outline-none transition"
                  placeholder={t.authUsernamePlaceholder}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                {t.authPasswordLabel}
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 dark:text-slate-500" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  className="w-full bg-[#f3f5f4] dark:bg-[#181a1e] border border-[#e0e4e2] dark:border-[#33363e] focus:border-emerald-500 rounded-lg pl-9 pr-3 py-2.5 text-sm text-slate-800 dark:text-slate-200 focus:outline-none transition"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                {t.authSecurityVerifyLabel}
              </label>
              <TurnstileWidget
                ref={turnstileRef}
                onVerify={setTurnstileToken}
                onExpire={() => setTurnstileToken('')}
              />
            </div>

            {error && (
              <div className="p-2.5 bg-red-50 dark:bg-red-950/70 border border-red-500/50 rounded-lg text-xs text-red-800 dark:text-red-200 flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 text-red-600 dark:text-red-400 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting || !turnstileToken}
              className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-bold text-sm py-2.5 rounded-lg transition shadow-md shadow-emerald-500/20"
            >
              {isSubmitting ? t.authLoggingIn : t.authLoginTitle}
            </button>
          </form>

          <div className="text-center text-xs text-slate-600 dark:text-slate-400 mt-5">
            {t.authNoAccount}{' '}
            <button onClick={onGoToRegister} className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 hover:dark:text-emerald-300 font-semibold">
              {t.authRegisterNow}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
