/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { User, Product, Language, Category } from './types';
import { cryptoOptions } from './data/storeData';
import { Header } from './components/Header';
import { Banner } from './components/Banner';
import { Categories } from './components/Categories';
import { HotDeals } from './components/HotDeals';
import { FeaturedProducts } from './components/FeaturedProducts';
import { ProductDetail } from './components/ProductDetail';
import { DepositModal } from './components/DepositModal';
import { ToolsModal } from './components/ToolsModal';
import { Footer } from './components/Footer';
import { ToastContainer } from './components/Toast';
import { AdminPage } from './pages/AdminPage';
import { CtvPage } from './pages/CtvPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { AccountPage } from './pages/AccountPage';
import { ApiDocsPage } from './pages/ApiDocsPage';
import { OrdersPage } from './pages/OrdersPage';
import { TermsPage } from './pages/TermsPage';
import { PrivacyPage } from './pages/PrivacyPage';
import { ShieldAlert } from 'lucide-react';
import { translations } from './locales/translations';

type Page = 'home' | 'product-detail' | 'admin' | 'ctv' | 'login' | 'register' | 'account' | 'api-docs' | 'orders' | 'terms' | 'privacy';

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
  if (page === 'product-detail' && opts?.productId) return `/product/${encodeURIComponent(opts.productId)}`;
  if (opts?.category && opts.category !== 'all') return `/category/${encodeURIComponent(opts.category)}`;
  return '/';
}

// Shown in place of a protected page when the logged-in account's role
// isn't allowed to see it — access is decided by who you're actually
// logged in as, not a button anyone could click.
function AccessDenied({ language, onBackToStore }: { language: Language; onBackToStore: () => void }) {
  const t = translations[language];
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-3 px-4 text-center">
      <div className="w-14 h-14 rounded-full bg-red-500/15 border border-red-500/40 flex items-center justify-center">
        <ShieldAlert className="w-7 h-7 text-red-600 dark:text-red-400" />
      </div>
      <h2 className="text-slate-900 dark:text-slate-100 font-bold text-base">
        {t.accessDeniedMessage}
      </h2>
      <button
        onClick={onBackToStore}
        className="mt-1 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs px-4 py-2 rounded-lg transition"
      >
        {t.authBackToStore}
      </button>
    </div>
  );
}

export default function App() {
  const [language, setLanguage] = useState<Language>('vn');
  const [currentPage, setCurrentPage] = useState<Page>('home');
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
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
  const [isToolsOpen, setIsToolsOpen] = useState(false);

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
    applyLocationFromUrl();

    const onPopState = () => applyLocationFromUrl();
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Already logged in but sitting on /login or /register — send home instead.
  useEffect(() => {
    if (authChecked && user && (currentPage === 'login' || currentPage === 'register')) {
      navigate('home');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authChecked, user, currentPage]);

  // Category counts
  const categoryCounts: Record<string, number> = {};
  products.forEach((p) => {
    categoryCounts[p.categorySlug] = (categoryCounts[p.categorySlug] || 0) + 1;
  });

  // Filter products by category and search
  const filteredProducts = products.filter((p) => {
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
        onOpenTools={() => setIsToolsOpen(true)}
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
            <AccessDenied language={language} onBackToStore={() => navigate('home')} />
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
            <AccessDenied language={language} onBackToStore={() => navigate('home')} />
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
        ) : currentPage === 'orders' ? (
          !authChecked ? null : !user ? (
            <LoginPage language={language} onLoginSuccess={fetchUser} onGoToRegister={() => navigate('register')} onBackToStore={() => navigate('home')} />
          ) : (
            <OrdersPage
              language={language}
              onBackToStore={() => navigate('home')}
              isAdmin={user.role === 'admin'}
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
            onOpenTools={() => setIsToolsOpen(true)}
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
                products={products}
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

      {/* Digital Accounts Utility Tools Modal */}
      <ToolsModal
        isOpen={isToolsOpen}
        onClose={() => setIsToolsOpen(false)}
        language={language}
      />

      <ToastContainer />
    </div>
  );
}
