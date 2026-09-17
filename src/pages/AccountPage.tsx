import React, { useEffect, useState } from 'react';
import { User, Language } from '../types';
import { translations } from '../locales/translations';
import { VIP_TIERS } from '../data/vipTiers';
import { formatMoney } from '../utils/pricing';
import {
  ArrowLeft,
  Mail,
  User as UserIcon,
  Wallet,
  TrendingUp,
  TrendingDown,
  Calendar,
  Crown,
  Phone,
  MessageCircle,
  Edit3,
  Lock,
  Send,
  ShieldAlert,
  CheckCircle2,
  Check,
} from 'lucide-react';

interface AccountPageProps {
  user: User;
  language: Language;
  onBackToStore: () => void;
  onRefreshUser: () => void;
}

const LOCALE_MAP: Record<Language, string> = {
  vn: 'vi-VN',
  en: 'en-US',
  zh: 'zh-CN',
  th: 'th-TH',
};

export const AccountPage: React.FC<AccountPageProps> = ({ user, language, onBackToStore, onRefreshUser }) => {
  const t = translations[language];
  const [totalDeposited, setTotalDeposited] = useState(0);
  const [totalSpent, setTotalSpent] = useState(0);
  const [loading, setLoading] = useState(true);

  const [isEditingContact, setIsEditingContact] = useState(false);
  const [phone, setPhone] = useState(user.phone || '');
  const [telegram, setTelegram] = useState(user.telegram || '');
  const [savingContact, setSavingContact] = useState(false);

  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const showNotice = (type: 'success' | 'error', message: string) => {
    setNotice({ type, message });
    setTimeout(() => setNotice(null), 3500);
  };

  const loadSummary = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/user/me');
      if (res.ok) {
        const data = await res.json();
        setTotalDeposited(data.totalDeposited || 0);
        setTotalSpent(data.totalSpent || 0);
      }
    } catch (err) {
      // keep whatever we last had
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSummary();
    setPhone(user.phone || '');
    setTelegram(user.telegram || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

  const currentTierIndex = [...VIP_TIERS].reverse().find((t) => totalDeposited >= t.threshold)
    ? VIP_TIERS.map((t) => totalDeposited >= t.threshold).lastIndexOf(true)
    : 0;
  const currentTier = VIP_TIERS[currentTierIndex];
  const nextTier = VIP_TIERS[currentTierIndex + 1];
  const progressPct = nextTier
    ? Math.min(100, (totalDeposited / nextTier.threshold) * 100)
    : 100;

  const handleSaveContact = async () => {
    setSavingContact(true);
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, telegram }),
      });
      const data = await res.json();
      if (res.ok) {
        showNotice('success', t.acctUpdateContactSuccess);
        setIsEditingContact(false);
        onRefreshUser();
      } else {
        showNotice('error', data.error || t.acctUpdateFailed);
      }
    } catch (err) {
      showNotice('error', t.acctServerError);
    } finally {
      setSavingContact(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      showNotice('error', t.acctNewPasswordMinLength);
      return;
    }
    if (newPassword !== confirmPassword) {
      showNotice('error', t.authPasswordMismatch);
      return;
    }

    setSavingPassword(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        showNotice('success', t.acctPasswordChangedSuccess);
        setIsChangingPassword(false);
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        showNotice('error', data.error || t.acctChangePasswordFailed);
      }
    } catch (err) {
      showNotice('error', t.acctServerError);
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
      <button onClick={onBackToStore} className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:dark:text-slate-100 mb-4 transition">
        <ArrowLeft className="w-3.5 h-3.5" />
        <span>{t.authBackToStore}</span>
      </button>

      <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100 mb-4">
        {t.acctMyAccountTitle}
      </h1>

      {notice && (
        <div
          className={`mb-4 p-3 rounded-lg text-xs flex items-center gap-2 border ${
            notice.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/70 border-emerald-500/50 text-emerald-800 dark:text-emerald-200'
              : 'bg-red-50 dark:bg-red-950/70 border-red-500/50 text-red-800 dark:text-red-200'
          }`}
        >
          {notice.type === 'success' ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <ShieldAlert className="w-4 h-4 flex-shrink-0" />}
          <span>{notice.message}</span>
        </div>
      )}

      {/* Profile card */}
      <div className="bg-[#eef0ef] dark:bg-[#202227] border border-[#e1e4e3] dark:border-[#32363e] rounded-2xl p-5 mb-4 flex items-center gap-4">
        <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-emerald-500/30 to-emerald-600/30 border border-emerald-500/40 flex items-center justify-center flex-shrink-0">
          <UserIcon className="w-8 h-8 text-emerald-700 dark:text-emerald-300" />
        </div>
        <div>
          <div className="text-lg font-bold text-slate-900 dark:text-slate-100">{user.username}</div>
          <div className="text-xs text-slate-600 dark:text-slate-400 mb-1.5">{user.email}</div>
          <div className="flex items-center gap-1.5">
            {user.role !== 'user' && (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/40">
                {user.role}
              </span>
            )}
            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/40">
              {t.acctActive}
            </span>
          </div>
        </div>
      </div>

      {/* Info grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <div className="bg-[#eef0ef] dark:bg-[#202227] border border-[#e1e4e3] dark:border-[#32363e] rounded-xl p-3.5 flex items-center gap-3">
          <Mail className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
          <div className="min-w-0">
            <div className="text-[10px] text-slate-600 dark:text-slate-400">Email</div>
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{user.email}</div>
          </div>
        </div>
        <div className="bg-[#eef0ef] dark:bg-[#202227] border border-[#e1e4e3] dark:border-[#32363e] rounded-xl p-3.5 flex items-center gap-3">
          <UserIcon className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
          <div className="min-w-0">
            <div className="text-[10px] text-slate-600 dark:text-slate-400">Username</div>
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{user.username}</div>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div className="bg-[#eef0ef] dark:bg-[#202227] border border-[#e1e4e3] dark:border-[#32363e] rounded-xl p-3.5">
          <div className="flex items-center gap-1.5 text-[10px] text-slate-600 dark:text-slate-400 mb-1">
            <Wallet className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>{t.acctWalletBalance}</span>
          </div>
          <div className="text-lg font-black text-emerald-600 dark:text-emerald-400 font-mono">${formatMoney(user.balance)}</div>
        </div>
        <div className="bg-[#eef0ef] dark:bg-[#202227] border border-[#e1e4e3] dark:border-[#32363e] rounded-xl p-3.5">
          <div className="flex items-center gap-1.5 text-[10px] text-slate-600 dark:text-slate-400 mb-1">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>{t.acctTotalDeposited}</span>
          </div>
          <div className="text-lg font-black text-emerald-600 dark:text-emerald-400 font-mono">
            {loading ? '…' : `$${formatMoney(totalDeposited)}`}
          </div>
        </div>
        <div className="bg-[#eef0ef] dark:bg-[#202227] border border-[#e1e4e3] dark:border-[#32363e] rounded-xl p-3.5">
          <div className="flex items-center gap-1.5 text-[10px] text-slate-600 dark:text-slate-400 mb-1">
            <TrendingDown className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
            <span>{t.acctTotalSpent}</span>
          </div>
          <div className="text-lg font-black text-amber-600 dark:text-amber-400 font-mono">
            {loading ? '…' : `$${formatMoney(totalSpent)}`}
          </div>
        </div>
      </div>

      {/* Join date */}
      <div className="bg-[#eef0ef] dark:bg-[#202227] border border-[#e1e4e3] dark:border-[#32363e] rounded-xl p-3.5 mb-4 flex items-center gap-3">
        <Calendar className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
        <div>
          <div className="text-[10px] text-slate-600 dark:text-slate-400">{t.acctJoined}</div>
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {new Date(user.createdAt).toLocaleString(LOCALE_MAP[language])}
          </div>
        </div>
      </div>

      {/* VIP tier — discount is real and applied automatically at checkout */}
      <div className="bg-[#eef0ef] dark:bg-[#202227] border border-[#e1e4e3] dark:border-[#32363e] rounded-2xl p-4 mb-4">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <Crown className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          <span className="font-bold text-slate-900 dark:text-slate-100 text-sm">{t.acctVipLevelTitle}</span>
          <span className="text-[10px] text-slate-600 dark:text-slate-400 bg-[#f2f4f3] dark:bg-[#1a1b1f] border border-[#e1e4e3] dark:border-[#32363e] px-2 py-0.5 rounded-full">
            {currentTier.key === 'member' ? t.acctMemberLabel : currentTier.label}{currentTier.sub ? ` ${currentTier.sub}` : ''}
          </span>
          {currentTier.discountPercent > 0 && (
            <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-500/15 border border-emerald-500/40 px-2 py-0.5 rounded-full">
              {t.acctVipActiveDiscountTemplate.replace('{percent}', String(currentTier.discountPercent))}
            </span>
          )}
        </div>
        <div className="text-[11px] text-slate-600 dark:text-slate-400 mb-3">
          {t.acctTotalDeposited}: ${formatMoney(totalDeposited)}
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-3">
          {VIP_TIERS.map((tier, idx) => (
            <div
              key={tier.key}
              className={`text-center py-2 rounded-lg border text-[10px] ${
                idx === currentTierIndex
                  ? 'bg-[#e7ebea] dark:bg-[#292b31] border-emerald-500 text-slate-900 dark:text-slate-100'
                  : 'bg-[#f2f4f3] dark:bg-[#1a1b1f] border-[#e1e4e3] dark:border-[#32363e] text-slate-600 dark:text-slate-400'
              }`}
            >
              <div className="font-bold">{tier.key === 'member' ? t.acctMemberLabel : tier.label}</div>
              <div className="text-[9px] opacity-70">{tier.sub || t.acctMemberLabel}</div>
              <div className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                {tier.discountPercent > 0 ? `-${tier.discountPercent}%` : '—'}
              </div>
            </div>
          ))}
        </div>

        {nextTier && (
          <>
            <div className="w-full h-1.5 bg-[#f2f4f3] dark:bg-[#1a1b1f] rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-emerald-500 to-emerald-500" style={{ width: `${progressPct}%` }} />
            </div>
            <div className="text-[10px] text-slate-600 dark:text-slate-400 mt-1.5 text-center">
              ${formatMoney(totalDeposited)} / ${formatMoney(nextTier.threshold)}
            </div>
            <p className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-1.5 text-center font-semibold">
              {t.acctVipNextTierTemplate
                .replace('{amount}', `$${formatMoney(nextTier.threshold - totalDeposited)}`)
                .replace('{percent}', String(nextTier.discountPercent))}
            </p>
          </>
        )}

        <p className="text-[10px] text-slate-500 dark:text-slate-500 mt-2">
          {t.acctVipInfoReal}
        </p>
      </div>

      {/* Contact info */}
      <div className="bg-[#eef0ef] dark:bg-[#202227] border border-[#e1e4e3] dark:border-[#32363e] rounded-2xl p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Phone className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <div>
              <div className="font-bold text-slate-900 dark:text-slate-100 text-sm">{t.acctContactInfoTitle}</div>
              <div className="text-[10px] text-slate-600 dark:text-slate-400">{t.acctContactInfoDesc}</div>
            </div>
          </div>
          {!isEditingContact && (
            <button
              onClick={() => setIsEditingContact(true)}
              className="flex items-center gap-1.5 bg-[#e7ebe9] dark:bg-[#292b31] hover:bg-[#dee3e1] hover:dark:bg-[#363941] border border-[#dfe3e1] dark:border-[#353840] text-slate-800 dark:text-slate-200 text-xs font-semibold px-3 py-1.5 rounded-lg transition"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>{t.acctEdit}</span>
            </button>
          )}
        </div>

        {isEditingContact ? (
          <div className="space-y-2.5">
            <div>
              <label className="block text-[10px] text-slate-600 dark:text-slate-400 mb-1">{t.acctPhoneLabel}</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+84..."
                className="w-full bg-[#f2f4f3] dark:bg-[#1a1b1f] border border-[#e1e4e3] dark:border-[#32363e] focus:border-emerald-500 rounded-lg px-3 py-2 text-sm text-slate-800 dark:text-slate-200 focus:outline-none transition"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-600 dark:text-slate-400 mb-1">Telegram</label>
              <input
                type="text"
                value={telegram}
                onChange={(e) => setTelegram(e.target.value)}
                placeholder="@username"
                className="w-full bg-[#f2f4f3] dark:bg-[#1a1b1f] border border-[#e1e4e3] dark:border-[#32363e] focus:border-emerald-500 rounded-lg px-3 py-2 text-sm text-slate-800 dark:text-slate-200 focus:outline-none transition"
              />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={handleSaveContact}
                disabled={savingContact}
                className="flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold text-xs px-3.5 py-2 rounded-lg transition"
              >
                <Check className="w-3.5 h-3.5" />
                <span>{savingContact ? t.acctSaving : t.acctSave}</span>
              </button>
              <button
                onClick={() => {
                  setIsEditingContact(false);
                  setPhone(user.phone || '');
                  setTelegram(user.telegram || '');
                }}
                className="text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:dark:text-slate-100 px-3 py-2"
              >
                {t.acctCancel}
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div className="bg-[#f2f4f3] dark:bg-[#1a1b1f] border border-[#e1e4e3] dark:border-[#32363e] rounded-lg p-3">
              <div className="text-[10px] text-slate-600 dark:text-slate-400 mb-0.5">{t.acctPhoneLabel}</div>
              <div className={`text-sm font-semibold ${user.phone ? 'text-slate-900 dark:text-slate-100' : 'text-slate-500 dark:text-slate-500 italic'}`}>
                {user.phone || t.acctNotSet}
              </div>
            </div>
            <div className="bg-[#f2f4f3] dark:bg-[#1a1b1f] border border-[#e1e4e3] dark:border-[#32363e] rounded-lg p-3">
              <div className="text-[10px] text-slate-600 dark:text-slate-400 mb-0.5">Telegram</div>
              <div className={`text-sm font-semibold ${user.telegram ? 'text-slate-900 dark:text-slate-100' : 'text-slate-500 dark:text-slate-500 italic'}`}>
                {user.telegram || t.acctNotSet}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Change password */}
      <div className="bg-[#eef0ef] dark:bg-[#202227] border border-[#e1e4e3] dark:border-[#32363e] rounded-2xl p-4 mb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            <div>
              <div className="font-bold text-slate-900 dark:text-slate-100 text-sm">{t.acctChangePasswordTitle}</div>
              <div className="text-[10px] text-slate-600 dark:text-slate-400">{t.acctChangePasswordDesc}</div>
            </div>
          </div>
          {!isChangingPassword && (
            <button
              onClick={() => setIsChangingPassword(true)}
              className="bg-[#e7ebe9] dark:bg-[#292b31] hover:bg-[#dee3e1] hover:dark:bg-[#363941] border border-[#dfe3e1] dark:border-[#353840] text-slate-800 dark:text-slate-200 text-xs font-semibold px-3 py-1.5 rounded-lg transition"
            >
              {t.acctChangeBtn}
            </button>
          )}
        </div>

        {isChangingPassword && (
          <form onSubmit={handleChangePassword} className="mt-3 space-y-2.5">
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder={t.acctCurrentPasswordPlaceholder}
              className="w-full bg-[#f2f4f3] dark:bg-[#1a1b1f] border border-[#e1e4e3] dark:border-[#32363e] focus:border-emerald-500 rounded-lg px-3 py-2 text-sm text-slate-800 dark:text-slate-200 focus:outline-none transition"
            />
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={t.acctNewPasswordPlaceholder}
              className="w-full bg-[#f2f4f3] dark:bg-[#1a1b1f] border border-[#e1e4e3] dark:border-[#32363e] focus:border-emerald-500 rounded-lg px-3 py-2 text-sm text-slate-800 dark:text-slate-200 focus:outline-none transition"
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder={t.acctConfirmNewPasswordPlaceholder}
              className="w-full bg-[#f2f4f3] dark:bg-[#1a1b1f] border border-[#e1e4e3] dark:border-[#32363e] focus:border-emerald-500 rounded-lg px-3 py-2 text-sm text-slate-800 dark:text-slate-200 focus:outline-none transition"
            />
            <div className="flex items-center gap-2 pt-1">
              <button
                type="submit"
                disabled={savingPassword}
                className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold text-xs px-3.5 py-2 rounded-lg transition"
              >
                {savingPassword ? t.acctSaving : t.acctConfirmBtn}
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsChangingPassword(false);
                  setCurrentPassword('');
                  setNewPassword('');
                  setConfirmPassword('');
                }}
                className="text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:dark:text-slate-100 px-3 py-2"
              >
                {t.acctCancel}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Telegram notifications — not yet wired to a live bot */}
      <div className="bg-[#eef0ef] dark:bg-[#202227] border border-[#e1e4e3] dark:border-[#32363e] rounded-2xl p-4 mb-4">
        <div className="flex items-center gap-2 mb-1.5">
          <Send className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <span className="font-bold text-slate-900 dark:text-slate-100 text-sm">{t.acctTelegramNotifTitle}</span>
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-400 mb-3">
          {t.acctTelegramNotifDesc}
        </p>
        <button
          disabled
          title={t.acctTelegramBotRequired}
          className="flex items-center gap-1.5 bg-[#e7ebe9] dark:bg-[#292b31] text-slate-500 dark:text-slate-500 text-xs font-bold px-3.5 py-2 rounded-lg cursor-not-allowed border border-[#dfe3e1] dark:border-[#353840]"
        >
          <MessageCircle className="w-3.5 h-3.5" />
          <span>{t.acctCreateLinkCode}</span>
        </button>
      </div>
    </div>
  );
};
