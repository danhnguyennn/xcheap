import React, { useState, useEffect } from 'react';
import { Search, Wrench, ShoppingBag, Plus, Bell, ChevronDown, ShieldCheck, User as UserIcon, Wallet, Clock, Receipt, HelpCircle, Mail, KeyRound, Code2, LogOut, LogIn, Sun, Moon } from 'lucide-react';
import { User, Language, AdminNotification } from '../types';
import { translations } from '../locales/translations';
import { formatMoney } from '../utils/pricing';

interface HeaderProps {
  user: User | null;
  language: Language;
  onLanguageChange: (lang: Language) => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onOpenDeposit: () => void;
  onOpenOrders: () => void;
  onOpenTools: () => void;
  onOpenAdmin: () => void;
  onOpenCtv: () => void;
  onOpenAccount: () => void;
  onOpenApiDocs: () => void;
  onLogin: () => void;
  onRegister: () => void;
  onLogout: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onLogoClick: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  user,
  language,
  onLanguageChange,
  theme,
  onToggleTheme,
  onOpenDeposit,
  onOpenOrders,
  onOpenTools,
  onOpenAdmin,
  onOpenCtv,
  onOpenAccount,
  onOpenApiDocs,
  onLogin,
  onRegister,
  onLogout,
  searchQuery,
  onSearchChange,
  onLogoClick,
}) => {
  const t = translations[language];
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showMobileSearch, setShowMobileSearch] = useState(false);

  // Thông báo thật cho admin (vd: user vừa đặt trước sản phẩm hết hàng) —
  // chỉ admin mới thấy, kéo về mỗi 20s để chuông luôn phản ánh đúng dữ liệu
  // thật trong bảng admin_notifications thay vì hiện số "1" cố định như cũ.
  const [adminNotifs, setAdminNotifs] = useState<AdminNotification[]>([]);
  const [adminUnreadCount, setAdminUnreadCount] = useState(0);

  useEffect(() => {
    if (user?.role !== 'admin') return;
    const fetchNotifs = async () => {
      try {
        const res = await fetch('/api/admin/notifications');
        if (!res.ok) return;
        const data = await res.json();
        setAdminNotifs(data.notifications || []);
        setAdminUnreadCount(data.unreadCount || 0);
      } catch {
        // Silent — chuông chỉ giữ nguyên trạng thái đã biết gần nhất.
      }
    };
    fetchNotifs();
    const NOTIF_POLL_INTERVAL_MS = 20000;
    const interval = setInterval(fetchNotifs, NOTIF_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [user?.role]);

  // Mở dropdown thì đánh dấu đã đọc hết luôn — đơn giản hơn theo dõi từng
  // thông báo đã xem hay chưa, và khớp với cách chuông thông báo hoạt động ở
  // hầu hết ứng dụng khác.
  const handleToggleNotifications = () => {
    const opening = !showNotifications;
    setShowNotifications(opening);
    if (opening && user?.role === 'admin' && adminUnreadCount > 0) {
      fetch('/api/admin/notifications/read-all', { method: 'POST' })
        .then(() => {
          setAdminUnreadCount(0);
          setAdminNotifs((prev) => prev.map((n) => ({ ...n, read: true })));
        })
        .catch(() => {});
    }
  };

  const langLabels: Record<Language, { label: string; name: string; flag: string }> = {
    vn: { label: 'Tiếng Việt', name: 'Tiếng Việt', flag: '🇻🇳' },
    en: { label: 'English', name: 'English', flag: '🇺🇸' },
    zh: { label: '中文', name: '中文', flag: '🇨🇳' },
    th: { label: 'ภาษาไทย', name: 'ภาษาไทย', flag: '🇹🇭' },
    ja: { label: '日本語', name: '日本語', flag: '🇯🇵' },
  };

  return (
    <header className="sticky top-0 z-40 bg-[#f1f3f2]/95 dark:bg-[#1b1d22]/95 backdrop-blur border-b border-[#e4e8e7] dark:border-[#2d3037] px-2 min-[380px]:px-3 xl:px-6 py-2.5">
      {/* One single flat flex row — logo, search bar and every action icon
          are direct children (no nested sub-groups). That matters: a
          fixed-size item (the logo, flex-shrink-0) and a shrinkable one
          (the search bar, min-w-0) used to share a wrapper div with its
          own flex-1 — that wrapper's own box shrinks toward 0 whenever
          free space runs low (flex-basis:0% + min-w-0), even though the
          logo inside it can't shrink, so the logo overflowed its box and
          visually overlapped whatever came next (seen on iPhone Pro Max
          and iPad mini widths). With everything flat, "gap" + "justify-
          between" apply directly to every item: the search bar's flex-1
          still eats free space and pushes icons to the right edge on
          xl+ (1280px — the labeled desktop layout only turns on there;
          iPad mini/iPad landscape (~768-1024px) don't have room for the
          full search bar + every button's text label, so they keep the
          compact icon-only row below that — confirmed by testing real
          iPad mini/iPad landscape/iPhone Pro Max widths), and below xl
          (no flex-grow item) any leftover width is spread evenly across
          every gap — logo, icons and avatar stay anchored to their
          edges and evenly spaced instead of bunching to the left. */}
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-0.5 min-[380px]:gap-1 min-[900px]:gap-2 xl:gap-3 flex-wrap">
        {/* Brand Logo with Custom XCheap.top Identity */}
        <button
          onClick={onLogoClick}
          className="flex items-center gap-2.5 focus:outline-none group flex-shrink-0"
          title={t.siteTagline}
        >
            <div className="relative w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-[#ecefee] dark:bg-[#222429] border border-emerald-500/40 flex items-center justify-center shadow-lg shadow-black/40 group-hover:border-emerald-500/60 transition-all duration-200">
              {/* Dynamic Cybernetic 'X' with deal-arrow geometry */}
              <svg className="w-5 h-5 sm:w-5.5 sm:h-5.5" viewBox="0 0 28 28" fill="none">
                <path d="M5 6L12 14L5 22H9L14 16.2L19 22H23L16 14L23 6H19L14 11.8L9 6H5Z" fill="#38bdf8" />
                <path d="M14 11.8L19 6H23L16 14L20 18.8L18 20.8L13 14.8L14 11.8Z" fill="#10b981" />
                <circle cx="14" cy="14" r="2" fill="#ffffff" />
              </svg>
              {/* Glowing notification badge */}
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-400 rounded-full ring-2 ring-[#f1f3f2]" />
            </div>
            {/* Wordmark collapses to just the icon square on phone widths —
                there isn't room for it alongside the action icons on one row */}
            <div className="hidden sm:flex flex-col text-left">
              <div className="flex items-baseline tracking-tight font-black font-sans text-lg sm:text-xl leading-none">
                <span className="text-slate-900 dark:text-slate-100 group-hover:text-emerald-900 group-hover:dark:text-emerald-100 transition-colors">XCheap</span>
                <span className="text-emerald-600 dark:text-emerald-400 text-sm ml-0.5 font-black">.top</span>
              </div>
              <span className="text-[9px] font-mono text-slate-600 dark:text-slate-400 tracking-wider uppercase leading-tight mt-0.5 flex items-center gap-1">
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold">DIGITAL</span>
                <span className="text-slate-400 dark:text-slate-600">•</span>
                <span>STORE</span>
              </span>
            </div>
          </button>

        {/* Search bar — shown from sm (640px) up, well before the text
            labels start appearing (those stay gated at md/900/lg/xl since
            they're the truly width-hungry items). flex-1 + min-w-0 means
            it's the one item that absorbs free space AND is allowed to
            shrink below its content size (the input can compress), so on
            tablet widths — where the icon-only right cluster alone
            wouldn't fill the row — it eats the leftover space that would
            otherwise become one big gap next to the logo or icons, and
            caps how far apart the icons can spread as the window grows */}
        <div className="relative flex-1 min-w-0 max-w-2xl hidden sm:block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600 dark:text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t.searchPlaceholder}
            className="w-full bg-[#f4f6f5] dark:bg-[#17181c] border border-[#e1e5e4] dark:border-[#32353d] focus:border-emerald-500 rounded-lg pl-9 pr-4 py-1.5 text-xs text-slate-800 dark:text-slate-200 placeholder-slate-600 dark:placeholder-slate-400 focus:outline-none transition"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:dark:text-slate-100"
            >
              ✕
            </button>
          )}
        </div>

        {/* Mobile search toggle — the inline search bar is hidden below
            sm, so below that this is the only way to search */}
          <button
            onClick={() => setShowMobileSearch((s) => !s)}
            className="sm:hidden p-1 bg-[#eceeed] dark:bg-[#23252a] hover:bg-[#e5e8e7] hover:dark:bg-[#2d3036] border border-[#dfe3e1] dark:border-[#353840] text-slate-800 dark:text-slate-200 rounded-lg transition"
            title={t.searchPlaceholder}
          >
            <Search className="w-4 h-4" />
          </button>

          {/* Dark mode toggle */}
          <button
            onClick={onToggleTheme}
            className="p-1 xl:p-2 bg-[#eceeed] dark:bg-[#23252a] hover:bg-[#e5e8e7] hover:dark:bg-[#2d3036] border border-[#dfe3e1] dark:border-[#353840] text-slate-800 dark:text-slate-200 rounded-lg transition"
            title={theme === 'dark' ? t.themeToLight : t.themeToDark}
          >
            {theme === 'dark' ? (
              <Sun className="w-4 h-4 text-amber-400" />
            ) : (
              <Moon className="w-4 h-4 text-slate-600" />
            )}
          </button>

          {/* Language selector */}
          <div className="relative">
            <button
              onClick={() => setShowLangMenu(!showLangMenu)}
              className="flex items-center gap-1 min-[900px]:gap-1.5 bg-[#eceeed] dark:bg-[#23252a] hover:bg-[#e5e8e7] hover:dark:bg-[#2d3036] border border-[#dfe3e1] dark:border-[#353840] text-slate-800 dark:text-slate-200 text-xs font-medium px-2 min-[900px]:px-2.5 py-1.5 rounded-lg transition"
            >
              <span>{langLabels[language].flag}</span>
              <span className="hidden min-[900px]:inline">{langLabels[language].label}</span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400" />
            </button>

            {showLangMenu && (
              <div className="absolute right-0 mt-1.5 w-36 bg-[#eceeed] dark:bg-[#23252a] border border-[#dfe3e1] dark:border-[#353840] rounded-lg shadow-2xl py-1 z-50">
                {(Object.keys(langLabels) as Language[]).map((lang) => (
                  <button
                    key={lang}
                    onClick={() => {
                      onLanguageChange(lang);
                      setShowLangMenu(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between hover:bg-[#e5e8e7] hover:dark:bg-[#2d3036] transition ${
                      language === lang ? 'text-emerald-600 dark:text-emerald-400 font-bold bg-[#e7ebe9] dark:bg-[#292b31]' : 'text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span>{langLabels[lang].flag}</span>
                      <span>{langLabels[lang].label}</span>
                    </span>
                    {language === lang && <span className="text-emerald-600 dark:text-emerald-400 text-xs">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Tools button — kept visible at every width. Guests and plain
              "user" accounts have no dropdown entry for it (that shortcut is
              ctv/admin only), so hiding this on mobile used to leave them
              with no way at all to reach it on a phone. */}
          <button
            onClick={onOpenTools}
            className="flex items-center gap-1.5 bg-[#eceeed] dark:bg-[#23252a] hover:bg-[#e5e8e7] hover:dark:bg-[#2d3036] border border-[#dfe3e1] dark:border-[#353840] text-slate-800 dark:text-slate-200 text-xs font-medium px-2 md:px-3 py-1.5 rounded-lg transition"
            title={t.toolsTitle}
          >
            <Wrench className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span className="hidden md:inline">{t.tools}</span>
          </button>

          {/* Orders / Deposit — only meaningful once logged in */}
          {user && (
            <>
              {/* Also reachable from the user dropdown menu on mobile */}
              <button
                onClick={onOpenOrders}
                className="hidden min-[900px]:flex items-center gap-1.5 bg-[#eceeed] dark:bg-[#23252a] hover:bg-[#e5e8e7] hover:dark:bg-[#2d3036] border border-[#dfe3e1] dark:border-[#353840] text-slate-800 dark:text-slate-200 text-xs font-medium px-2.5 xl:px-3 py-1.5 rounded-lg transition"
                title={t.ordersTitle}
              >
                <ShoppingBag className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span className="hidden min-[900px]:inline">{t.orders}</span>
              </button>

              {/* Same action as the balance pill below — redundant on a
                  cramped mobile row, so only shown once there's room */}
              <button
                onClick={onOpenDeposit}
                className="hidden min-[1152px]:flex items-center gap-1 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold px-2.5 xl:px-3 py-1.5 rounded-lg transition shadow-md shadow-emerald-500/20"
              >
                <Plus className="w-3.5 h-3.5 stroke-[3]" />
                <span>{t.deposit}</span>
              </button>

              <button
                onClick={onOpenDeposit}
                className="flex items-center gap-0.5 min-[380px]:gap-1 xl:gap-1.5 bg-[#eceeed] dark:bg-[#23252a] hover:bg-[#e3e7e6] hover:dark:bg-[#2f3239] border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs font-mono font-bold px-1 min-[380px]:px-1.5 xl:px-2.5 py-1.5 rounded-lg transition"
                title={t.clickToDeposit}
              >
                <Wallet className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                <span>${formatMoney(user.balance)}</span>
              </button>
            </>
          )}

          {/* Notifications button — not very meaningful without an account,
              so it's dropped on mobile for guests to make room */}
          <div className={`relative ${!user ? 'hidden xl:block' : ''}`}>
            <button
              onClick={handleToggleNotifications}
              className="relative p-1 xl:p-1.5 text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:dark:text-slate-100 transition rounded-lg hover:bg-[#e5e8e7] hover:dark:bg-[#2d3036]"
            >
              <Bell className="w-4 h-4" />
              {user?.role === 'admin' ? (
                adminUnreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-slate-900 dark:text-slate-100 text-[9px] font-bold w-3.5 h-3.5 rounded-full flex items-center justify-center">
                    {adminUnreadCount > 9 ? '9+' : adminUnreadCount}
                  </span>
                )
              ) : (
                <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-slate-900 dark:text-slate-100 text-[9px] font-bold w-3.5 h-3.5 rounded-full flex items-center justify-center">
                  1
                </span>
              )}
            </button>

            {showNotifications && (
              <div className="absolute right-0 mt-2 w-80 bg-[#eceeed] dark:bg-[#23252a] border border-[#dfe3e1] dark:border-[#353840] rounded-xl shadow-2xl p-3 z-50 text-xs max-h-96 overflow-y-auto">
                <div className="font-semibold text-slate-800 dark:text-slate-200 pb-2 border-b border-[#dfe3e1] dark:border-[#353840] flex items-center justify-between">
                  <span>{t.notifications}</span>
                  <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-mono">{t.notifSystemLabel}</span>
                </div>
                {user?.role === 'admin' ? (
                  adminNotifs.length > 0 ? (
                    adminNotifs.map((n) => (
                      <div key={n.id} className="py-2.5 border-b border-[#dfe3e1] dark:border-[#353840] last:border-0">
                        <p className="font-medium text-slate-900 dark:text-slate-100">{n.title}</p>
                        <p className="text-slate-600 dark:text-slate-400 text-[11px] mt-0.5">{n.message}</p>
                        <p className="text-slate-500 dark:text-slate-500 text-[10px] font-mono mt-1">
                          {new Date(n.createdAt).toLocaleString('vi-VN')}
                        </p>
                      </div>
                    ))
                  ) : (
                    <div className="py-4 text-center text-slate-500 dark:text-slate-500">{t.notifEmpty}</div>
                  )
                ) : (
                  <div className="py-2.5 text-slate-700 dark:text-slate-300">
                    <p className="font-medium text-slate-900 dark:text-slate-100">{t.notifAutoDepositTitle}</p>
                    <p className="text-slate-600 dark:text-slate-400 text-[11px] mt-0.5">
                      {t.notifAutoDepositDesc}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Logged out: login/register. Logged in: avatar + dropdown. */}
          {!user ? (
            <div className="flex items-center gap-1.5 xl:gap-2">
              <button
                onClick={onLogin}
                className="flex items-center gap-1.5 bg-[#eceeed] dark:bg-[#23252a] hover:bg-[#e5e8e7] hover:dark:bg-[#2d3036] border border-[#dfe3e1] dark:border-[#353840] text-slate-800 dark:text-slate-200 text-xs font-semibold px-2.5 xl:px-3 py-1.5 rounded-lg transition"
              >
                <LogIn className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 hidden xl:block" />
                <span>{t.authLoginTitle}</span>
              </button>
              <button
                onClick={onRegister}
                className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold px-2.5 xl:px-3 py-1.5 rounded-lg transition shadow-md shadow-emerald-500/20"
              >
                {t.headerRegister}
              </button>
            </div>
          ) : (
          <div className="relative">
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center gap-2 bg-[#eceeed] dark:bg-[#23252a] hover:bg-[#e5e8e7] hover:dark:bg-[#2d3036] border border-[#dfe3e1] dark:border-[#353840] px-1.5 xl:px-2 py-1 rounded-lg transition"
            >
              <div className="w-6 h-6 rounded-md bg-emerald-600 text-slate-900 dark:text-slate-100 flex items-center justify-center text-xs font-bold shadow-sm">
                {user.username.charAt(0).toUpperCase()}
              </div>
              <div className="hidden lg:flex flex-col text-left">
                <span className="text-xs font-medium text-slate-800 dark:text-slate-200 leading-none">{user.username}</span>
                {user.role !== 'user' && (
                  <span className="text-[9px] uppercase tracking-wider text-emerald-600 dark:text-emerald-400 font-bold mt-0.5">
                    {user.role}
                  </span>
                )}
              </div>
              <ChevronDown className="w-3 h-3 text-slate-600 dark:text-slate-400 hidden xl:block" />
            </button>

            {showUserMenu && (
              <div className="absolute right-0 mt-2 w-64 bg-[#eceeed] dark:bg-[#23252a] border border-[#dfe3e1] dark:border-[#353840] rounded-xl shadow-2xl p-2 z-50 text-xs">
                <div className="px-3 py-2 border-b border-[#dfe3e1] dark:border-[#353840] mb-1">
                  <div className="font-bold text-slate-900 dark:text-slate-100">{user.username}</div>
                  <div className="text-slate-600 dark:text-slate-400 text-[11px]">{user.email}</div>
                  <div className="text-emerald-600 dark:text-emerald-400 font-mono font-bold text-sm mt-1">
                    ${formatMoney(user.balance)}
                  </div>
                  {(user.role !== 'user' || (user.vipDiscountPercent || 0) > 0) && (
                    <div className="mt-1 flex items-center gap-1.5">
                      {user.role !== 'user' && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/40">
                          {user.role}
                        </span>
                      )}
                      {user.role === 'user' && (user.vipDiscountPercent || 0) > 0 && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold text-amber-700 dark:text-amber-300 bg-amber-500/15 border border-amber-500/40">
                          VIP -{user.vipDiscountPercent}%
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Admin or CTV shortcut options */}
                {user.role === 'admin' && (
                  <button
                    onClick={() => {
                      onOpenAdmin();
                      setShowUserMenu(false);
                    }}
                    className="w-full text-left px-3 py-2 text-purple-700 dark:text-purple-300 hover:bg-purple-500/10 rounded-lg flex items-center gap-2 transition"
                  >
                    <ShieldCheck className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                    <span>{t.adminPanel}</span>
                  </button>
                )}

                {(user.role === 'ctv' || user.role === 'admin') && (
                  <button
                    onClick={() => {
                      onOpenCtv();
                      setShowUserMenu(false);
                    }}
                    className="w-full text-left px-3 py-2 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10 rounded-lg flex items-center gap-2 transition"
                  >
                    <UserIcon className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                    <span>{t.ctvPanel}</span>
                  </button>
                )}

                <div className="my-1 border-t border-[#dfe3e1] dark:border-[#353840]" />

                {/* Account items — available to every role */}
                <button
                  onClick={() => {
                    onOpenAccount();
                    setShowUserMenu(false);
                  }}
                  className="w-full text-left px-3 py-2 text-slate-800 dark:text-slate-200 hover:bg-[#e5e8e7] hover:dark:bg-[#2d3036] rounded-lg flex items-center gap-2 transition"
                >
                  <UserIcon className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span>{t.navAccount}</span>
                </button>

                <button
                  onClick={() => {
                    onOpenDeposit();
                    setShowUserMenu(false);
                  }}
                  className="w-full text-left px-3 py-2 text-slate-800 dark:text-slate-200 hover:bg-[#e5e8e7] hover:dark:bg-[#2d3036] rounded-lg flex items-center gap-2 transition"
                >
                  <Wallet className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span>{t.navMyWallet}</span>
                </button>

                <button
                  onClick={() => {
                    onOpenOrders();
                    setShowUserMenu(false);
                  }}
                  className="w-full text-left px-3 py-2 text-slate-800 dark:text-slate-200 hover:bg-[#e5e8e7] hover:dark:bg-[#2d3036] rounded-lg flex items-center gap-2 transition"
                >
                  <Clock className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span>{t.navPurchaseHistory}</span>
                </button>

                <button
                  onClick={() => {
                    onOpenDeposit();
                    setShowUserMenu(false);
                  }}
                  className="w-full text-left px-3 py-2 text-slate-800 dark:text-slate-200 hover:bg-[#e5e8e7] hover:dark:bg-[#2d3036] rounded-lg flex items-center gap-2 transition"
                >
                  <Receipt className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span>{t.navTransactionHistory}</span>
                </button>

                <button
                  onClick={() => {
                    window.open('https://t.me/XCheap_Support', '_blank');
                    setShowUserMenu(false);
                  }}
                  className="w-full text-left px-3 py-2 text-slate-800 dark:text-slate-200 hover:bg-[#e5e8e7] hover:dark:bg-[#2d3036] rounded-lg flex items-center gap-2 transition"
                >
                  <HelpCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span>{t.navSupport}</span>
                </button>

                <button
                  onClick={() => {
                    onOpenApiDocs();
                    setShowUserMenu(false);
                  }}
                  className="w-full text-left px-3 py-2 text-slate-800 dark:text-slate-200 hover:bg-[#e5e8e7] hover:dark:bg-[#2d3036] rounded-lg flex items-center gap-2 transition"
                >
                  <Code2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span>API Docs</span>
                </button>

                {/* Power-user tools — CTV and Admin only */}
                {(user.role === 'ctv' || user.role === 'admin') && (
                  <>
                    <div className="my-1 border-t border-[#dfe3e1] dark:border-[#353840]" />
                    <button
                      onClick={() => {
                        onOpenTools();
                        setShowUserMenu(false);
                      }}
                      className="w-full text-left px-3 py-2 text-slate-800 dark:text-slate-200 hover:bg-[#e5e8e7] hover:dark:bg-[#2d3036] rounded-lg flex items-center gap-2 transition"
                    >
                      <Mail className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                      <span>{t.navEmailReader}</span>
                    </button>

                    <button
                      onClick={() => {
                        onOpenTools();
                        setShowUserMenu(false);
                      }}
                      className="w-full text-left px-3 py-2 text-slate-800 dark:text-slate-200 hover:bg-[#e5e8e7] hover:dark:bg-[#2d3036] rounded-lg flex items-center gap-2 transition"
                    >
                      <KeyRound className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                      <span>2FA Secret</span>
                    </button>
                  </>
                )}

                <div className="my-1 border-t border-[#dfe3e1] dark:border-[#353840]" />

                <button
                  onClick={() => {
                    onLogout();
                    setShowUserMenu(false);
                  }}
                  className="w-full text-left px-3 py-2 text-red-600 dark:text-red-400 hover:bg-red-500/10 rounded-lg flex items-center gap-2 transition"
                >
                  <LogOut className="w-4 h-4 text-red-600 dark:text-red-400" />
                  <span>{t.logout}</span>
                </button>
              </div>
            )}
          </div>
          )}
      </div>

      {/* Mobile search row — the inline search bar only shows at sm+, so
          this is the only way to search on a phone-width screen */}
      {showMobileSearch && (
        <div className="max-w-7xl mx-auto sm:hidden pt-2.5">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600 dark:text-slate-400" />
            <input
              autoFocus
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={t.searchPlaceholder}
              className="w-full bg-[#f4f6f5] dark:bg-[#17181c] border border-[#e1e5e4] dark:border-[#32353d] focus:border-emerald-500 rounded-lg pl-9 pr-4 py-2 text-xs text-slate-800 dark:text-slate-200 placeholder-slate-600 dark:placeholder-slate-400 focus:outline-none transition"
            />
            {searchQuery && (
              <button
                onClick={() => onSearchChange('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:dark:text-slate-100"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  );
};
