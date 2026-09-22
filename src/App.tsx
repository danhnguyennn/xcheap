/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, Suspense, lazy } from 'react';
import { User, Product, Language, Category, CryptoOption } from './types';
import { Header } from './components/Header';
import { Banner } from './components/Banner';
import { Categories } from './components/Categories';
import { HotDeals } from './components/HotDeals';
import { FeaturedProducts } from './components/FeaturedProducts';
import { ProductDetail } from './components/ProductDetail';
import { DepositModal } from './components/DepositModal';
import { Footer } from './components/Footer';
import { ToastContainer } from './components/Toast';
import { translations } from './locales/translations';

// Everything below is only ever needed once the visitor actually navigates
// there — lazy-loaded so the initial bundle only has to ship the storefront
// (Home/ProductDetail/Deposit, imported above), not the full Admin/CTV
// panels, Tools, docs and legal pages too. Each still lands in its own
// chunk split off the ~840kB single bundle this used to all be.
const AdminPage = lazy(() => import('./pages/AdminPage').then((m) => ({ default: m.AdminPage })));
const CtvPage = lazy(() => import('./pages/CtvPage').then((m) => ({ default: m.CtvPage })));
const LoginPage = lazy(() => import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import('./pages/RegisterPage').then((m) => ({ default: m.RegisterPage })));
const AccountPage = lazy(() => import('./pages/AccountPage').then((m) => ({ default: m.AccountPage })));
const ApiDocsPage = lazy(() => import('./pages/ApiDocsPage').then((m) => ({ default: m.ApiDocsPage })));
const OrdersPage = lazy(() => import('./pages/OrdersPage').then((m) => ({ default: m.OrdersPage })));
const TermsPage = lazy(() => import('./pages/TermsPage').then((m) => ({ default: m.TermsPage })));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage').then((m) => ({ default: m.PrivacyPage })));
const ToolsPage = lazy(() => import('./pages/ToolsPage').then((m) => ({ default: m.ToolsPage })));

// Shown only for the brief moment a lazy page chunk is downloading — every
// one of these pages already renders its own full loading state once
// mounted, so this just needs to fill the screen without a blank flash.
function PageLoading() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

type Page = 'home' | 'product-detail' | 'admin' | 'ctv' | 'login' | 'register' | 'account' | 'api-docs' | 'orders' | 'terms' | 'privacy' | 'tools';

// Builds the URL for a given page so the browser's address bar (and reload)
// always reflects what's on screen.
function buildUrl(page: Page, opts?: { productId?: string; category?: string }): string {
  if (page === 'admin') return '/admin';
  if (page === 'ctv') return '/ctv';
  if (page === 'login') return '/login';
  if (page === 'register') return '/register';
  if (page === 'account') return '/account';
  if (page === 'api-docs') return '/api-docs';
  if (page === 'orders') return '/orders';
  if (page === 'terms') return '/terms';
  if (page === 'privacy') return '/privacy';
  if (page === 'tools') return '/tools';
  if (page === 'product-detail' && opts?.productId) return `/product/${encodeURIComponent(opts.productId)}`;
  if (opts?.category && opts.category !== 'all') return `/category/${encodeURIComponent(opts.category)}`;
  return '/';
}

// Rendered in place of a protected page when the logged-in account's role
// isn't allowed to see it — access is decided by who you're actually
// logged in as, not a button anyone could click. Immediately bounces back
// to the storefront rather than showing an "access denied" page, same
// treatment as an unrecognized URL (see applyLocationFromUrl's fallback).
function RedirectHome({ onRedirect }: { onRedirect: () => void }) {
  useEffect(() => {
    onRedirect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

export default function App() {
  const [language, setLanguage] = useState<Language>('vn');
  const [currentPage, setCurrentPage] = useState<Page>('home');
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [cryptoOptions, setCryptoOptions] = useState<CryptoOption[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Theme: user's own choice, not tied to OS preference — defaults to light,
  // remembered per browser via localStorage.
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      return localStorage.getItem('theme') === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem('theme', theme);
    } catch {
      // ignore — private browsing / storage blocked
    }
  }, [theme]);

  const toggleTheme = () => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));

  // Modals state
  const [isDepositOpen, setIsDepositOpen] = useState(false);

  // Sync user and products with backend
  const fetchUser = async () => {
    try {
      const res = await fetch('/api/user/me');
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      } else {
        setUser(null);
      }
    } catch (err) {
      setUser(null);
    } finally {
      setAuthChecked(true);
    }
  };

  const fetchProducts = async () => {
    try {
      const res = await fetch('/api/products');
      if (res.ok) {
        const data = await res.json();
        setProducts(data.products);
      }
    } catch (err) {
      console.log('Using default product catalog');
    }
  };

  const fetchCategories = async () => {
    try {
      const res = await fetch('/api/categories');
      if (res.ok) {
        const data = await res.json();
        setCategories(data.categories || []);
      }
    } catch (err) {
      // keep whatever was last fetched rather than erroring out
    }
  };

  const fetchCryptoOptions = async () => {
    try {
      const res = await fetch('/api/crypto-options');
      if (res.ok) {
        const data = await res.json();
        setCryptoOptions(data.options || []);
      }
    } catch (err) {
      // keep whatever was last fetched rather than erroring out
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (err) {
      // ignore — we clear local state regardless
    }
    setUser(null);
    navigate('home');
  };

  // Switches page + pushes the matching URL, so the browser back/forward
  // buttons and a page reload both land on the same screen the user was on.
  const navigate = (page: Page, opts?: { product?: Product; category?: string }) => {
    setCurrentPage(page);
    if (opts?.product) setSelectedProduct(opts.product);
    if (page === 'home' && opts?.category !== undefined) setSelectedCategory(opts.category);
    const category = page === 'home' ? (opts?.category ?? selectedCategory) : undefined;
    const url = buildUrl(page, { productId: opts?.product?.id, category });
    window.history.pushState({}, '', url);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Reads the current URL and restores the matching page/product — used on
  // first load and whenever the user hits browser back/forward.
  const applyLocationFromUrl = async () => {
    const path = window.location.pathname;

    if (path === '/admin') {
      setCurrentPage('admin');
      return;
    }
    if (path === '/ctv') {
      setCurrentPage('ctv');
      return;
    }
    if (path === '/login') {
      setCurrentPage('login');
      return;
    }
    if (path === '/register') {
      setCurrentPage('register');
      return;
    }
    if (path === '/account') {
      setCurrentPage('account');
      return;
    }
    if (path === '/api-docs') {
      setCurrentPage('api-docs');
      return;
    }
    if (path === '/orders') {
      setCurrentPage('orders');
      return;
    }
    if (path === '/terms') {
      setCurrentPage('terms');
      return;
    }
    if (path === '/privacy') {
      setCurrentPage('privacy');
      return;
    }
    if (path === '/tools') {
      setCurrentPage('tools');
      return;
    }
    const productMatch = path.match(/^\/product\/([^/]+)$/);
    if (productMatch) {
      const productId = decodeURIComponent(productMatch[1]);
      setCurrentPage('product-detail');
      try {
        const res = await fetch(`/api/products/${productId}`);
        if (res.ok) {
          const data = await res.json();
          setSelectedProduct(data.product);
        } else {
          setCurrentPage('home');
          window.history.replaceState({}, '', '/');
        }
      } catch {
        setCurrentPage('home');
      }
      return;
    }

    const categoryMatch = path.match(/^\/category\/([^/]+)$/);
    setCurrentPage('home');
    setSelectedCategory(categoryMatch ? decodeURIComponent(categoryMatch[1]) : 'all');
  };

  useEffect(() => {
    fetchUser();
    fetchProducts();
    fetchCategories();
    fetchCryptoOptions();
    applyLocationFromUrl();

    const onPopState = () => applyLocationFromUrl();
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Presence heartbeat for the admin "online now" stat — every tab pings
  // every 20s; the server identifies the account from the session cookie
  // itself (see POST /api/presence/ping), so there's no client-side id to
  // generate or store here anymore. A guest tab still pings on the same
  // schedule, it just doesn't count toward anything server-side.
  useEffect(() => {
    const ping = () => {
      fetch('/api/presence/ping', { method: 'POST' }).catch(() => {});
    };
    ping();
    const interval = setInterval(ping, 20000);
    return () => clearInterval(interval);
  }, []);

  // Already logged in but sitting on /login or /register — send home instead.
  useEffect(() => {
    if (authChecked && user && (currentPage === 'login' || currentPage === 'register')) {
      navigate('home');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authChecked, user, currentPage]);

  // The raw `products` state is also handed to AdminPage/CtvPage so they can
  // manage hidden listings — the storefront itself (counts, grids, hot
  // deals) must never include a hidden product, even when the viewer is the
  // CTV/Admin who hid it and so still receives it from the API.
  const storefrontProducts = products.filter((p) => !p.isHidden);

  // Category counts
  const categoryCounts: Record<string, number> = {};
  storefrontProducts.forEach((p) => {
    categoryCounts[p.categorySlug] = (categoryCounts[p.categorySlug] || 0) + 1;
  });

  // Filter products by category and search
  const filteredProducts = storefrontProducts.filter((p) => {
    const matchCategory = selectedCategory === 'all' || p.categorySlug === selectedCategory;
    const matchSearch =
      !searchQuery.trim() ||
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.category.toLowerCase().includes(searchQuery.toLowerCase());
    return matchCategory && matchSearch;
  });

  return (
    <div className="min-h-screen bg-[#f4f6f5] dark:bg-[#17181c] text-slate-900 dark:text-slate-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-slate-900 selection:dark:text-slate-100">
      {/* Header matching screenshot */}
      <Header
        user={user}
        language={language}
        onLanguageChange={(lang) => setLanguage(lang)}
        theme={theme}
        onToggleTheme={toggleTheme}
        onOpenDeposit={() => setIsDepositOpen(true)}
        onOpenOrders={() => navigate('orders')}
        onOpenTools={() => navigate('tools')}
        onOpenAdmin={() => navigate('admin')}
        onOpenCtv={() => navigate('ctv')}
        onOpenAccount={() => navigate('account')}
        onOpenApiDocs={() => navigate('api-docs')}
        onLogin={() => navigate('login')}
        onRegister={() => navigate('register')}
        onLogout={handleLogout}
        searchQuery={searchQuery}
        onSearchChange={(q) => {
          setSearchQuery(q);
          if (currentPage !== 'home') navigate('home');
        }}
        onLogoClick={() => {
          setSelectedProduct(null);
          setSearchQuery('');
          navigate('home', { category: 'all' });
        }}
      />

      {/* Main View Router */}
      <main className="flex-1">
        <Suspense fallback={<PageLoading />}>
        {currentPage === 'login' ? (
          <LoginPage
            language={language}
            onLoginSuccess={fetchUser}
            onGoToRegister={() => navigate('register')}
            onBackToStore={() => navigate('home')}
          />
        ) : currentPage === 'register' ? (
          <RegisterPage
            language={language}
            onGoToLogin={() => navigate('login')}
            onBackToStore={() => navigate('home')}
            onOpenTerms={() => navigate('terms')}
          />
        ) : currentPage === 'admin' ? (
          !authChecked ? null : !user ? (
            <LoginPage language={language} onLoginSuccess={fetchUser} onGoToRegister={() => navigate('register')} onBackToStore={() => navigate('home')} />
          ) : user.role !== 'admin' ? (
            <RedirectHome onRedirect={() => navigate('home')} />
          ) : (
            <AdminPage
              user={user}
              products={products}
              language={language}
              onBackToStore={() => navigate('home')}
              onRefreshProducts={fetchProducts}
              onRefreshUser={fetchUser}
              onOpenDeposit={() => setIsDepositOpen(true)}
            />
          )
        ) : currentPage === 'account' ? (
          !authChecked ? null : !user ? (
            <LoginPage language={language} onLoginSuccess={fetchUser} onGoToRegister={() => navigate('register')} onBackToStore={() => navigate('home')} />
          ) : (
            <AccountPage
              user={user}
              language={language}
              onBackToStore={() => navigate('home')}
              onRefreshUser={fetchUser}
            />
          )
        ) : currentPage === 'ctv' ? (
          !authChecked ? null : !user ? (
            <LoginPage language={language} onLoginSuccess={fetchUser} onGoToRegister={() => navigate('register')} onBackToStore={() => navigate('home')} />
          ) : user.role !== 'ctv' && user.role !== 'admin' ? (
            <RedirectHome onRedirect={() => navigate('home')} />
          ) : (
            <CtvPage
              user={user}
              products={products}
              language={language}
              onBackToStore={() => navigate('home')}
              onRefreshProducts={fetchProducts}
              onRefreshUser={fetchUser}
              onOpenDeposit={() => setIsDepositOpen(true)}
              onSelectProduct={(p) => navigate('product-detail', { product: p })}
            />
          )
        ) : currentPage === 'api-docs' ? (
          !authChecked ? null : !user ? (
            <LoginPage language={language} onLoginSuccess={fetchUser} onGoToRegister={() => navigate('register')} onBackToStore={() => navigate('home')} />
          ) : (
            <ApiDocsPage user={user} language={language} onBackToStore={() => navigate('home')} />
          )
        ) : currentPage === 'terms' ? (
          <TermsPage language={language} onBackToStore={() => navigate('home')} />
        ) : currentPage === 'privacy' ? (
          <PrivacyPage language={language} onBackToStore={() => navigate('home')} />
        ) : currentPage === 'tools' ? (
          <ToolsPage language={language} onBackToStore={() => navigate('home')} />
        ) : currentPage === 'orders' ? (
          !authChecked ? null : !user ? (
            <LoginPage language={language} onLoginSuccess={fetchUser} onGoToRegister={() => navigate('register')} onBackToStore={() => navigate('home')} />
          ) : (
            <OrdersPage
              language={language}
              onBackToStore={() => navigate('home')}
              onSelectProduct={(p) => navigate('product-detail', { product: p })}
            />
          )
        ) : currentPage === 'product-detail' && selectedProduct ? (
          <ProductDetail
            product={selectedProduct}
            user={user}
            language={language}
            onBack={() => {
              setSelectedProduct(null);
              navigate('home');
            }}
            onOpenDeposit={() => setIsDepositOpen(true)}
            onOpenTools={() => navigate('tools')}
            onPurchaseSuccess={(orderData) => {
              fetchUser();
              fetchProducts();
            }}
            onRequireLogin={() => navigate('login')}
          />
        ) : (
          <>
            {/* Banner matching screenshot */}
            <Banner
              language={language}
              onOpenDeposit={() => setIsDepositOpen(true)}
              onOpenCtv={() => navigate('ctv')}
            />

            {/* Categories section matching Image 1 */}
            <Categories
              language={language}
              selectedCategory={selectedCategory}
              onSelectCategory={(cat) => navigate('home', { category: cat })}
              categoryCounts={categoryCounts}
              categories={categories}
            />

            {/* Hot Deals section matching Image 1 & 2 */}
            {selectedCategory === 'all' && !searchQuery && (
              <HotDeals
                products={storefrontProducts}
                language={language}
                onSelectProduct={(p) => navigate('product-detail', { product: p })}
              />
            )}

            {/* Featured Products grid matching Image 1 & 2 */}
            <FeaturedProducts
              products={filteredProducts}
              language={language}
              onSelectProduct={(p) => navigate('product-detail', { product: p })}
              onViewAllClick={() => navigate('home', { category: 'all' })}
            />
          </>
        )}
        </Suspense>
      </main>

      {/* Footer matching Image 2 */}
      <Footer
        language={language}
        onOpenTerms={() => navigate('terms')}
        onOpenPrivacy={() => navigate('privacy')}
      />

      {/* Automated Blockchain RPC Deposit Modal */}
      {user && (
        <DepositModal
          isOpen={isDepositOpen}
          onClose={() => setIsDepositOpen(false)}
          user={user}
          cryptoOptions={cryptoOptions}
          language={language}
          onBalanceUpdated={(newBal) => {
            setUser((prev) => (prev ? { ...prev, balance: newBal } : prev));
            fetchUser();
          }}
        />
      )}

      <ToastContainer />
    </div>
  );
}
