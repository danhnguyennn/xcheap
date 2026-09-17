import React, { useState, useRef } from 'react';
import { Language } from '../types';
import { UserPlus, Mail, Lock, User as UserIcon, ShieldAlert, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { translations } from '../locales/translations';
import { TurnstileWidget, TurnstileWidgetHandle } from '../components/TurnstileWidget';

interface RegisterPageProps {
  language: Language;
  onGoToLogin: () => void;
  onBackToStore: () => void;
  onOpenTerms: () => void;
}

export const RegisterPage: React.FC<RegisterPageProps> = ({ language, onGoToLogin, onBackToStore, onOpenTerms }) => {
  const t = translations[language];
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');
  const turnstileRef = useRef<TurnstileWidgetHandle>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username.trim() || !email.trim() || !password) {
      setError(t.authFillAllFields);
      return;
    }
    if (password.length < 6) {
      setError(t.authPasswordMinLength);
      return;
    }
    if (password !== confirmPassword) {
      setError(t.authPasswordMismatch);
      return;
    }
    if (!agreedToTerms) {
      setError(t.authMustAgreeTerms);
      return;
    }
    if (!turnstileToken) {
      setError(t.authTurnstileRequired);
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), email: email.trim(), password, turnstileToken }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t.authRegisterFailed);
        setIsSubmitting(false);
        // A Turnstile token is single-use — a rejected submit (whatever the
        // reason) leaves it spent, so the widget must be reset before the
        // next attempt can pass verification again.
        turnstileRef.current?.reset();
        setTurnstileToken('');
        return;
      }
      setSuccess(true);
      setTimeout(onGoToLogin, 1400);
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
              <UserPlus className="w-4 h-4" />
            </div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {t.authRegisterTitle}
            </h1>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 mb-5">
            {t.authRegisterSubtitle}
          </p>

          {success && (
            <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-500/50 rounded-lg text-sm text-emerald-800 dark:text-emerald-200 flex items-center gap-2 mb-4">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
              <span>{t.authRegisterSuccess}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className={`space-y-3.5 ${success ? 'hidden' : ''}`}>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                {t.authUsernameLabel}
              </label>
              <div className="relative">
                <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 dark:text-slate-500" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  className="w-full bg-[#f3f5f4] dark:bg-[#181a1e] border border-[#e0e4e2] dark:border-[#33363e] focus:border-emerald-500 rounded-lg pl-9 pr-3 py-2.5 text-sm text-slate-800 dark:text-slate-200 focus:outline-none transition"
                  placeholder={t.authUsernamePlaceholder}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 dark:text-slate-500" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  className="w-full bg-[#f3f5f4] dark:bg-[#181a1e] border border-[#e0e4e2] dark:border-[#33363e] focus:border-emerald-500 rounded-lg pl-9 pr-3 py-2.5 text-sm text-slate-800 dark:text-slate-200 focus:outline-none transition"
                  placeholder="you@example.com"
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
                  autoComplete="new-password"
                  className="w-full bg-[#f3f5f4] dark:bg-[#181a1e] border border-[#e0e4e2] dark:border-[#33363e] focus:border-emerald-500 rounded-lg pl-9 pr-3 py-2.5 text-sm text-slate-800 dark:text-slate-200 focus:outline-none transition"
                  placeholder={t.authPasswordMinPlaceholder}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                {t.authConfirmPasswordLabel}
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 dark:text-slate-500" />
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  className="w-full bg-[#f3f5f4] dark:bg-[#181a1e] border border-[#e0e4e2] dark:border-[#33363e] focus:border-emerald-500 rounded-lg pl-9 pr-3 py-2.5 text-sm text-slate-800 dark:text-slate-200 focus:outline-none transition"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <label className="flex items-start gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={agreedToTerms}
                onChange={(e) => setAgreedToTerms(e.target.checked)}
                className="mt-0.5 w-3.5 h-3.5 flex-shrink-0 accent-emerald-500 cursor-pointer"
              />
              <span className="text-xs text-slate-600 dark:text-slate-400 leading-snug">
                {t.authAgreeTermsPrefix}{' '}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenTerms();
                  }}
                  className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 hover:dark:text-emerald-300 font-semibold underline"
                >
                  {t.termsOfService}
                </button>
              </span>
            </label>

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
              disabled={isSubmitting || !agreedToTerms || !turnstileToken}
              className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-bold text-sm py-2.5 rounded-lg transition shadow-md shadow-emerald-500/20"
            >
              {isSubmitting ? t.authCreatingAccount : t.authRegisterTitle}
            </button>
          </form>

          {!success && (
            <div className="text-center text-xs text-slate-600 dark:text-slate-400 mt-5">
              {t.authHaveAccount}{' '}
              <button onClick={onGoToLogin} className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 hover:dark:text-emerald-300 font-semibold">
                {t.authLoginTitle}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
