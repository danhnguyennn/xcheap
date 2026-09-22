import React, { useState, useEffect } from 'react';
import { Product, User, Language, CtvStats, WithdrawalRequest, Voucher, Review, Order } from '../types';
import { translations } from '../locales/translations';
import { formatMoney } from '../utils/pricing';
import { SimpleBarChart, BarChartDatum } from '../components/charts/SimpleBarChart';
import {
  UserCheck,
  BarChart3,
  Upload,
  TrendingUp,
  DollarSign,
  PackagePlus,
  ArrowLeft,
  Coins,
  CheckCircle2,
  Clock,
  XCircle,
  Percent,
  PlusCircle,
  Database,
  Wallet,
  AlertCircle,
  FileText,
  RefreshCw,
  ShoppingBag,
  ExternalLink,
  ChevronRight,
  Ticket,
  Trash2,
  Star,
  Eye,
  EyeOff,
  Boxes,
  Search,
} from 'lucide-react';

// Must match the server's minimum withdrawal amount (server.ts /api/ctv/withdraw)
const MIN_WITHDRAW_AMOUNT = 5;

interface CtvPageProps {
  user: User;
  products: Product[];
  language: Language;
  onBackToStore: () => void;
  onRefreshProducts: () => void;
  onRefreshUser: () => void;
  onOpenDeposit: () => void;
  onSelectProduct: (product: Product) => void;
}

export const CtvPage: React.FC<CtvPageProps> = ({
  user,
  products,
  language,
  onBackToStore,
  onRefreshProducts,
  onRefreshUser,
  onOpenDeposit,
  onSelectProduct,
}) => {
  const t = translations[language];
  const [activeTab, setActiveTab] = useState<'overview' | 'upload' | 'withdraw' | 'my-products' | 'orders' | 'vouchers' | 'reviews'>('overview');

  // Stats & Fee config
  const [stats, setStats] = useState<CtvStats | null>(null);
  const [platformFeePercent, setPlatformFeePercent] = useState<number>(5);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [chartDaily, setChartDaily] = useState<{ date: string; revenue: number; orders: number }[]>([]);
  const [chartTopProducts, setChartTopProducts] = useState<{ name: string; revenue: number; orders: number }[]>([]);
  const [chartPeriod, setChartPeriod] = useState<'week' | 'month' | 'all'>('week');

  // Voucher state
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [myProductReviews, setMyProductReviews] = useState<(Review & { productName: string })[]>([]);
  const [reviewEditableMaxRating, setReviewEditableMaxRating] = useState(3);

  // Order management — scoped to this CTV's own products (see loadMyOrders)
  const ORDERS_PER_PAGE = 15;
  const [myOrders, setMyOrders] = useState<Order[]>([]);
  const [orderSearch, setOrderSearch] = useState('');
  const [orderStatusFilter, setOrderStatusFilter] = useState<'all' | 'completed' | 'refunded'>('all');
  const [ordersPage, setOrdersPage] = useState(1);
  const [refundingOrderCode, setRefundingOrderCode] = useState<string | null>(null);

  useEffect(() => {
    setOrdersPage(1);
  }, [orderSearch, orderStatusFilter]);

  // Edit description/account-format on an existing product — previously
  // these were only ever set once at creation with no way to fix or add
  // them afterward.
  const [editingDescProductId, setEditingDescProductId] = useState<string | null>(null);
  const [editDescText, setEditDescText] = useState('');
  const [editAccountFormatText, setEditAccountFormatText] = useState('');
  const [isSavingDescription, setIsSavingDescription] = useState(false);
  // Read-only variant list + per-variant visibility toggle — CTV has no
  // add/edit/delete for variants (only Admin does), just show/hide.
  const [variantsModalProduct, setVariantsModalProduct] = useState<Product | null>(null);
  const [newVoucherCode, setNewVoucherCode] = useState('');
  const [newVoucherDiscount, setNewVoucherDiscount] = useState<number>(10);
  const [newVoucherMaxUses, setNewVoucherMaxUses] = useState<number>(50);
  const [newVoucherExpiry, setNewVoucherExpiry] = useState('');
  const [newVoucherProductId, setNewVoucherProductId] = useState('');
  const [newVoucherVariantId, setNewVoucherVariantId] = useState('');
  const [isCreatingVoucher, setIsCreatingVoucher] = useState(false);

  // Upload Product form state
  const [newProdName, setNewProdName] = useState('');
  const [newProdCategory, setNewProdCategory] = useState('Twitter / X');
  const [newProdDescription, setNewProdDescription] = useState('');
  const [newProdAccountFormat, setNewProdAccountFormat] = useState('');
  const [newVariantName, setNewVariantName] = useState('Tài khoản chuẩn 2FA + Mail gốc');
  const [newProdPrice, setNewProdPrice] = useState<number>(1.2);
  const [rawAccountsUpload, setRawAccountsUpload] = useState('');
  const [isSubmittingProduct, setIsSubmittingProduct] = useState(false);

  // Existing product stock refill
  const [refillProductId, setRefillProductId] = useState(products[0]?.id || '');
  const [refillVariantId, setRefillVariantId] = useState(products[0]?.variants[0]?.id || '');
  const [rawRefillAccounts, setRawRefillAccounts] = useState('');
  const [isSubmittingRefill, setIsSubmittingRefill] = useState(false);

  // Withdrawal form state — crypto (USDT) only, bank/e-wallet options removed
  const [withdrawAmount, setWithdrawAmount] = useState<number>(MIN_WITHDRAW_AMOUNT);
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [withdrawNote, setWithdrawNote] = useState('');
  const [isSubmittingWithdraw, setIsSubmittingWithdraw] = useState(false);

  const showToast = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 4000);
  };

  // Refunds an order's totalPrice straight back into the buyer's wallet.
  // Server re-checks ownership itself (a CTV can only refund an order for
  // one of their own products) — this isn't just a client-side gate.
  const handleRefundOrder = async (order: Order) => {
    if (!window.confirm(`Hoàn ${formatMoney(order.totalPrice)}$ vào ví "${order.username}" cho đơn #${order.orderCode}?\n\nHành động này không thể hoàn tác.`)) {
      return;
    }
    setRefundingOrderCode(order.orderCode);
    try {
      const res = await fetch(`/api/orders/${order.orderCode}/refund`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        showToast('success', `Đã hoàn $${formatMoney(order.totalPrice)} cho đơn #${order.orderCode}`);
        loadMyOrders();
      } else {
        showToast('error', data.error || 'Lỗi hoàn tiền đơn hàng');
      }
    } catch (e) {
      showToast('error', 'Lỗi hoàn tiền đơn hàng');
    } finally {
      setRefundingOrderCode(null);
    }
  };

  // Tách riêng khỏi loadCtvData để đổi khoảng thời gian (Tuần/Tháng/Toàn
  // thời gian) chỉ cần gọi lại đúng API biểu đồ này.
  const fetchChartData = async (period: 'week' | 'month' | 'all') => {
    try {
      const chartsRes = await fetch(`/api/ctv/stats/charts?period=${period}`);
      if (chartsRes.ok) {
        const chartsData = await chartsRes.json();
        setChartDaily(chartsData.daily || []);
        setChartTopProducts(chartsData.topProducts || []);
      }
    } catch (err) {
      console.error('Failed to load chart data', err);
    }
  };

  useEffect(() => {
    fetchChartData(chartPeriod);
  }, [chartPeriod]);

  const loadCtvData = async () => {
    setLoading(true);
    try {
      const [statsRes, feeRes] = await Promise.all([
        fetch('/api/ctv/stats'),
        fetch('/api/platform/config'),
      ]);
      fetchChartData(chartPeriod);

      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData.stats);
        setWithdrawals(statsData.withdrawals || []);
      }

      if (feeRes.ok) {
        const feeData = await feeRes.json();
        // Cùng lỗi "|| 5" đã sửa ở trang Admin: fee 0% (giá trị hợp lệ) bị
        // coi là falsy và luôn bị thay bằng 5% mặc định — khiến trang CTV
        // không bao giờ đồng bộ đúng khi admin đặt fee sàn về 0%.
        setPlatformFeePercent(typeof feeData.platformFeePercent === 'number' ? feeData.platformFeePercent : 5);
      }
    } catch (err) {
      console.error('Failed to load CTV data', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCtvData();
    loadVouchers();
    loadMyReviews();
    loadMyOrders();
  }, []);

  const loadVouchers = async () => {
    try {
      const res = await fetch('/api/vouchers');
      if (res.ok) {
        const data = await res.json();
        setVouchers(data.vouchers || []);
      }
    } catch (err) {
      console.error('Failed to load vouchers', err);
    }
  };

  // Reviews on this CTV's own products — server scopes /api/admin/reviews
  // to only the caller's products when the role is 'ctv', same ownership
  // rule already used for CTV stats.
  const loadMyReviews = async () => {
    try {
      const res = await fetch('/api/admin/reviews');
      if (res.ok) {
        const data = await res.json();
        setMyProductReviews(data.reviews || []);
        setReviewEditableMaxRating(data.editableMaxRating ?? 3);
      }
    } catch (err) {
      console.error('Failed to load reviews', err);
    }
  };

  // Orders for this CTV's own products only — server scopes
  // GET /api/ctv/orders the same way as /api/ctv/stats/charts (real
  // ownership, no "show something anyway" fallback for a CTV with nothing).
  const loadMyOrders = async () => {
    try {
      const res = await fetch('/api/ctv/orders');
      if (res.ok) {
        const data = await res.json();
        setMyOrders(data.orders || []);
      }
    } catch (err) {
      console.error('Failed to load orders', err);
    }
  };

  // "Gian Hàng Của Tôi" should only ever list this CTV's own products —
  // `products` (the full prop) is every product in the store. Admin
  // previewing the CTV portal keeps seeing everything, matching how the
  // rest of this page already treats admin as an unrestricted view. Checked
  // in both substring directions — a product created as "CTV ronan_ctv"
  // contains the full username, but a friendlier display name set later
  // (e.g. just "Ronan") is instead a substring OF the username, so only
  // checking sellerName.includes(username) would miss it (same fix as the
  // server's ctvOwnsProduct helper).
  const ownsProduct = (p: Product): boolean => {
    // createdByUserId is the real source of truth (see ctvOwnsProduct in
    // server.ts) — an exact id match, not a guess from the display name.
    if (p.createdByUserId) return p.createdByUserId === user.id;
    // Legacy fallback for products created before createdByUserId existed.
    // Must stay narrow: matching on any seller name that merely *contains*
    // "ctv" used to make every CTV's dashboard show every other CTV's
    // products as "mine" too, since every CTV listing's seller name starts
    // with "CTV ".
    const sellerName = p.seller?.name?.toLowerCase() || '';
    const username = user.username.toLowerCase();
    if (!sellerName) return false;
    if (sellerName === `ctv ${username}`) return true;
    return sellerName.length >= 3 && username.includes(sellerName);
  };
  const myProducts = user.role === 'admin' ? products : products.filter(ownsProduct);

  const openEditDescription = (p: Product) => {
    setEditingDescProductId(p.id);
    setEditDescText(p.descriptionHtml || '');
    setEditAccountFormatText(p.accountFormat || '');
  };

  const handleSaveDescription = async () => {
    if (!editingDescProductId) return;
    setIsSavingDescription(true);
    try {
      const res = await fetch(`/api/ctv/products/${editingDescProductId}/description`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: editDescText, accountFormat: editAccountFormatText }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast('success', '✅ Đã cập nhật mô tả sản phẩm');
        setEditingDescProductId(null);
        onRefreshProducts();
      } else {
        showToast('error', data.error || 'Lỗi cập nhật mô tả');
      }
    } catch (err) {
      showToast('error', 'Lỗi kết nối máy chủ');
    } finally {
      setIsSavingDescription(false);
    }
  };

  // Pull a product off the storefront (or bring it back) without deleting
  // it and its inventory.
  const handleToggleProductVisibility = async (p: Product) => {
    const nextHidden = !p.isHidden;
    try {
      const res = await fetch(`/api/ctv/products/${p.id}/visibility`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isHidden: nextHidden }),
      });
      if (res.ok) {
        showToast('success', nextHidden ? `Đã ẩn sản phẩm "${p.name}"` : `Đã hiện lại sản phẩm "${p.name}"`);
        onRefreshProducts();
      } else {
        const data = await res.json().catch(() => ({}));
        showToast('error', data.error || 'Lỗi cập nhật trạng thái hiển thị');
      }
    } catch (err) {
      showToast('error', 'Lỗi kết nối máy chủ');
    }
  };

  // Same idea for a single variant — e.g. pausing one out-of-stock package
  // while keeping the rest of the listing live. variantsModalProduct is
  // refreshed from the server response so the open modal reflects the new
  // state immediately rather than waiting for the next full product refresh.
  const handleToggleVariantVisibility = async (productId: string, variantId: string, currentlyHidden: boolean | undefined) => {
    const nextHidden = !currentlyHidden;
    try {
      const res = await fetch(`/api/ctv/products/${productId}/variants/${variantId}/visibility`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isHidden: nextHidden }),
      });
      if (res.ok) {
        onRefreshProducts();
        setVariantsModalProduct((prev) =>
          prev && prev.id === productId
            ? { ...prev, variants: prev.variants.map((v) => (v.id === variantId ? { ...v, isHidden: nextHidden } : v)) }
            : prev
        );
      } else {
        const data = await res.json().catch(() => ({}));
        showToast('error', data.error || 'Lỗi cập nhật trạng thái hiển thị biến thể');
      }
    } catch (err) {
      showToast('error', 'Lỗi kết nối máy chủ');
    }
  };

  const handleCreateVoucher = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVoucherCode.trim()) {
      showToast('error', 'Vui lòng nhập mã voucher');
      return;
    }
    setIsCreatingVoucher(true);
    try {
      const res = await fetch('/api/vouchers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: newVoucherCode.trim(),
          discountPercent: newVoucherDiscount,
          maxUses: newVoucherMaxUses,
          expiresAt: newVoucherExpiry || undefined,
          applicableProductId: newVoucherProductId || undefined,
          applicableVariantId: newVoucherProductId ? newVoucherVariantId || undefined : undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast('success', `Đã tạo mã "${data.voucher.code}" thành công!`);
        setNewVoucherCode('');
        setNewVoucherDiscount(10);
        setNewVoucherMaxUses(50);
        setNewVoucherExpiry('');
        setNewVoucherProductId('');
        setNewVoucherVariantId('');
        loadVouchers();
      } else {
        showToast('error', data.error || 'Lỗi tạo voucher');
      }
    } catch (err) {
      showToast('error', 'Lỗi kết nối máy chủ');
    } finally {
      setIsCreatingVoucher(false);
    }
  };

  const handleDeleteVoucher = async (id: string, code: string) => {
    if (!confirm(`Bạn có chắc muốn xóa mã "${code}"?`)) return;
    try {
      const res = await fetch(`/api/vouchers/${id}`, { method: 'DELETE' });
      if (res.ok) {
        showToast('success', `Đã xóa mã "${code}"`);
        loadVouchers();
      } else {
        const data = await res.json().catch(() => ({}));
        showToast('error', data.error || 'Lỗi xóa voucher');
      }
    } catch (err) {
      showToast('error', 'Lỗi kết nối máy chủ');
    }
  };

  // Handle Upload Product
  const handleUploadProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProdName.trim() || newProdPrice <= 0 || !rawAccountsUpload.trim()) {
      showToast('error', 'Vui lòng nhập đầy đủ tên sản phẩm, giá bán và danh sách tài khoản kho.');
      return;
    }

    setIsSubmittingProduct(true);
    try {
      const res = await fetch('/api/ctv/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newProdName.trim(),
          category: newProdCategory,
          description: newProdDescription.trim(),
          accountFormat: newProdAccountFormat.trim(),
          variantName: newVariantName.trim(),
          price: newProdPrice,
          rawAccounts: rawAccountsUpload.trim(),
        }),
      });

      const data = await res.json();
      if (res.ok) {
        const dupText = data.duplicateCount > 0 ? `, bỏ qua ${data.duplicateCount} tài khoản trùng username đã có trong kho` : '';
        showToast('success', `Đã đăng bán sản phẩm mới thành công với ${data.importedCount} tài khoản${dupText}!`);
        setNewProdName('');
        setNewProdDescription('');
        setNewProdAccountFormat('');
        setRawAccountsUpload('');
        onRefreshProducts();
        loadCtvData();
      } else {
        showToast('error', data.error || 'Lỗi khi đăng sản phẩm');
      }
    } catch (err) {
      showToast('error', 'Lỗi kết nối máy chủ');
    } finally {
      setIsSubmittingProduct(false);
    }
  };

  // Reads a .txt file the CTV selects and merges its lines into the given
  // textarea state, rather than replacing whatever was already pasted in.
  const handleAccountsFileSelect = (setter: (updater: (prev: string) => string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const fileText = String(reader.result || '').trim();
      setter((prev) => (prev.trim() ? prev.trim() + '\n' + fileText : fileText));
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Handle Refill stock
  const handleRefillStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rawRefillAccounts.trim()) {
      showToast('error', 'Vui lòng dán danh sách tài khoản nạp kho');
      return;
    }

    setIsSubmittingRefill(true);
    try {
      const res = await fetch('/api/admin/stock/bulk-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: refillProductId,
          variantId: refillVariantId,
          rawAccounts: rawRefillAccounts.trim(),
        }),
      });

      const data = await res.json();
      if (res.ok) {
        const dupText = data.duplicateCount > 0 ? `, bỏ qua ${data.duplicateCount} tài khoản trùng username đã có trong kho` : '';
        showToast('success', `Đã bổ sung ${data.importedCount} tài khoản vào kho hàng thành công${dupText}!`);
        setRawRefillAccounts('');
        onRefreshProducts();
        loadCtvData();
      } else {
        showToast('error', data.error || 'Lỗi nạp kho');
      }
    } catch (err) {
      showToast('error', 'Lỗi kết nối');
    } finally {
      setIsSubmittingRefill(false);
    }
  };

  // Handle Withdrawal
  const handleWithdrawal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (withdrawAmount < MIN_WITHDRAW_AMOUNT) {
      showToast('error', `Số tiền rút tối thiểu là $${MIN_WITHDRAW_AMOUNT.toFixed(2)}`);
      return;
    }

    const availableBal = stats?.withdrawableBalance ?? user.balance;
    if (withdrawAmount > availableBal) {
      showToast('error', `Số dư khả dụng không đủ. Bạn chỉ có thể rút tối đa $${formatMoney(availableBal)}`);
      return;
    }

    if (!accountNumber.trim() || !accountName.trim()) {
      showToast('error', 'Vui lòng điền thông tin số tài khoản và tên chủ tài khoản thụ hưởng');
      return;
    }

    setIsSubmittingWithdraw(true);
    try {
      const res = await fetch('/api/ctv/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: withdrawAmount,
          method: 'crypto',
          accountNumber: accountNumber.trim(),
          accountName: accountName.trim(),
          note: withdrawNote.trim(),
        }),
      });

      const data = await res.json();
      if (res.ok) {
        showToast('success', 'Yêu cầu rút tiền đã được gửi tới Admin thành công! Tiền sẽ về tài khoản sau khi xét duyệt.');
        setAccountNumber('');
        setAccountName('');
        setWithdrawNote('');
        loadCtvData();
        onRefreshUser();
      } else {
        showToast('error', data.error || 'Lỗi gửi yêu cầu rút tiền');
      }
    } catch (err) {
      showToast('error', 'Lỗi kết nối');
    } finally {
      setIsSubmittingWithdraw(false);
    }
  };

  const currentRefillProduct = products.find((p) => p.id === refillProductId) || products[0];

  return (
    <div className="min-h-screen bg-[#f4f6f5] dark:bg-[#17181c] text-slate-900 dark:text-slate-100 pb-16 font-sans">
      {/* Top Header */}
      <div className="bg-[#eef0ef] dark:bg-[#202227] border-b border-[#e0e4e2] dark:border-[#33363e] sticky top-0 z-30 px-4 sm:px-8 py-3 shadow-lg">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={onBackToStore}
              className="flex items-center gap-1.5 bg-[#e5e8e7] dark:bg-[#2d3036] hover:bg-[#dde1e0] hover:dark:bg-[#373b44] text-emerald-600 dark:text-emerald-400 text-xs font-semibold px-3 py-1.5 rounded-lg border border-emerald-500/30 transition"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>{t.backToStore}</span>
            </button>

            <div className="h-4 w-px bg-slate-300 dark:bg-slate-700 hidden sm:block" />

            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold">
                <UserCheck className="w-4 h-4" />
              </div>
              <div>
                <h1 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                  <span>Trang Cộng Tác Viên (CTV Portal)</span>
                  <span className="bg-amber-500/30 text-amber-700 dark:text-amber-300 text-[10px] font-bold px-2 py-0.5 rounded border border-amber-500/40">
                    Phân bổ bởi Admin
                  </span>
                </h1>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="bg-[#e7ebe9] dark:bg-[#292b31] border border-[#dde1e0] dark:border-[#373b44] rounded-lg px-3 py-1.5 text-xs flex items-center gap-2">
              <span className="text-slate-600 dark:text-slate-400">Phí sàn hiện tại:</span>
              <span className="text-amber-600 dark:text-amber-400 font-bold font-mono">{platformFeePercent}%</span>
            </div>

            <div className="bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-500/40 rounded-lg px-3 py-1.5 text-xs text-emerald-700 dark:text-emerald-300 font-bold flex items-center gap-1.5">
              <Coins className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>Khả dụng: ${formatMoney(stats?.withdrawableBalance ?? user.balance)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Notifications Toast */}
      {notification && (
        <div className="max-w-7xl mx-auto px-4 sm:px-8 mt-4">
          <div
            className={`p-3 rounded-xl border flex items-center gap-2 text-xs font-semibold shadow-lg ${
              notification.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-950/70 border-emerald-500/50 text-emerald-700 dark:text-emerald-300'
                : 'bg-red-50 dark:bg-red-950/70 border-red-500/50 text-red-700 dark:text-red-300'
            }`}
          >
            {notification.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0" />
            )}
            <span>{notification.message}</span>
          </div>
        </div>
      )}

      {/* Main Container */}
      <div className="max-w-7xl mx-auto px-4 sm:px-8 mt-6 space-y-6">
        {/* CTV Role Banner & Fee information */}
        <div className="bg-gradient-to-r from-amber-950/40 via-[#ebeeed] dark:via-[#24262b] to-[#eff2f1] dark:to-[#1d1f24] border border-amber-500/40 rounded-2xl p-5 shadow-xl">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="bg-amber-500 text-slate-950 font-black text-xs px-2.5 py-0.5 rounded-md flex items-center gap-1">
                  <Percent className="w-3 h-3" /> Fee Sàn: {platformFeePercent}%
                </span>
                <span className="text-xs text-slate-700 dark:text-slate-300">
                  Phí sàn tự động khấu trừ trên mỗi đơn hàng hoàn tất
                </span>
              </div>
              <h2 className="text-lg font-black text-slate-900 dark:text-slate-100">
                Chào mừng Cộng Tác Viên <span className="text-amber-600 dark:text-amber-400">{user.username}</span>
              </h2>
              <p className="text-xs text-slate-700 dark:text-slate-300 max-w-3xl leading-relaxed">
                Tài khoản của bạn đã được Admin phân bổ quyền CTV chính thức. Nhiệm vụ chính của CTV là <strong>đăng hàng lên bán</strong>, quản lý kho tài khoản và <strong>yêu cầu rút tiền</strong> về tài khoản ngân hàng hoặc ví điện tử bất kỳ lúc nào.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setActiveTab('upload')}
                className="flex items-center gap-1.5 bg-[#e5e8e7] dark:bg-[#2d3036] hover:bg-[#dde1e0] hover:dark:bg-[#373b44] text-amber-600 dark:text-amber-400 text-xs font-semibold px-3 py-1.5 rounded-lg border border-amber-500/30 transition"
              >
                <PackagePlus className="w-4 h-4" />
                <span>Đăng Hàng Lên Bán</span>
              </button>
              <button
                onClick={() => setActiveTab('withdraw')}
                className="flex items-center gap-1.5 bg-[#e5e8e7] dark:bg-[#2d3036] hover:bg-[#dde1e0] hover:dark:bg-[#373b44] text-emerald-600 dark:text-emerald-400 text-xs font-semibold px-3 py-1.5 rounded-lg border border-emerald-500/30 transition"
              >
                <DollarSign className="w-4 h-4" />
                <span>Rút Tiền</span>
              </button>
            </div>
          </div>
        </div>

        {/* Tab Navigation — compact grid, icon on top, matching AdminPage's
            tab bar exactly (same layout mechanics, amber instead of purple
            for the active state to keep the CTV portal's accent color). */}
        <div className="grid grid-cols-4 sm:grid-cols-4 lg:grid-cols-7 gap-1.5 border-b border-[#e0e4e2] dark:border-[#33363e] pb-3 mb-6">
          <button
            onClick={() => setActiveTab('overview')}
            title="Thống Kê Doanh Thu & Lợi Nhuận"
            className={`px-2 py-2 text-[11px] font-bold rounded-lg transition flex flex-col items-center gap-1 text-center ${
              activeTab === 'overview'
                ? 'bg-[#e8ebea] dark:bg-[#282a30] text-amber-600 dark:text-amber-400 ring-1 ring-amber-500'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 hover:dark:text-slate-200 hover:bg-[#ecefee] hover:dark:bg-[#222429]'
            }`}
          >
            <TrendingUp className="w-4 h-4" />
            <span className="truncate w-full">Thống Kê</span>
          </button>

          <button
            onClick={() => setActiveTab('upload')}
            title="Đăng Sản Phẩm & Nạp Kho Hàng"
            className={`px-2 py-2 text-[11px] font-bold rounded-lg transition flex flex-col items-center gap-1 text-center ${
              activeTab === 'upload'
                ? 'bg-[#e8ebea] dark:bg-[#282a30] text-amber-600 dark:text-amber-400 ring-1 ring-amber-500'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 hover:dark:text-slate-200 hover:bg-[#ecefee] hover:dark:bg-[#222429]'
            }`}
          >
            <PackagePlus className="w-4 h-4" />
            <span className="truncate w-full">Đăng Bán</span>
          </button>

          <button
            onClick={() => setActiveTab('withdraw')}
            title="Rút Tiền & Lịch Sử Rút"
            className={`px-2 py-2 text-[11px] font-bold rounded-lg transition flex flex-col items-center gap-1 text-center ${
              activeTab === 'withdraw'
                ? 'bg-[#e8ebea] dark:bg-[#282a30] text-amber-600 dark:text-amber-400 ring-1 ring-amber-500'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 hover:dark:text-slate-200 hover:bg-[#ecefee] hover:dark:bg-[#222429]'
            }`}
          >
            <DollarSign className="w-4 h-4" />
            <span className="truncate w-full">Rút Tiền</span>
          </button>

          <button
            onClick={() => setActiveTab('my-products')}
            title="Gian Hàng Của Tôi"
            className={`px-2 py-2 text-[11px] font-bold rounded-lg transition flex flex-col items-center gap-1 text-center ${
              activeTab === 'my-products'
                ? 'bg-[#e8ebea] dark:bg-[#282a30] text-amber-600 dark:text-amber-400 ring-1 ring-amber-500'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 hover:dark:text-slate-200 hover:bg-[#ecefee] hover:dark:bg-[#222429]'
            }`}
          >
            <ShoppingBag className="w-4 h-4" />
            <span className="truncate w-full">Gian Hàng ({myProducts.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('orders')}
            title="Đơn Hàng"
            className={`px-2 py-2 text-[11px] font-bold rounded-lg transition flex flex-col items-center gap-1 text-center ${
              activeTab === 'orders'
                ? 'bg-[#e8ebea] dark:bg-[#282a30] text-amber-600 dark:text-amber-400 ring-1 ring-amber-500'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 hover:dark:text-slate-200 hover:bg-[#ecefee] hover:dark:bg-[#222429]'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span className="truncate w-full">Đơn Hàng ({myOrders.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('vouchers')}
            title="Mã Giảm Giá"
            className={`px-2 py-2 text-[11px] font-bold rounded-lg transition flex flex-col items-center gap-1 text-center ${
              activeTab === 'vouchers'
                ? 'bg-[#e8ebea] dark:bg-[#282a30] text-amber-600 dark:text-amber-400 ring-1 ring-amber-500'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 hover:dark:text-slate-200 hover:bg-[#ecefee] hover:dark:bg-[#222429]'
            }`}
          >
            <Ticket className="w-4 h-4" />
            <span className="truncate w-full">Mã Giảm Giá ({vouchers.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('reviews')}
            title="Đánh Giá"
            className={`px-2 py-2 text-[11px] font-bold rounded-lg transition flex flex-col items-center gap-1 text-center ${
              activeTab === 'reviews'
                ? 'bg-[#e8ebea] dark:bg-[#282a30] text-amber-600 dark:text-amber-400 ring-1 ring-amber-500'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 hover:dark:text-slate-200 hover:bg-[#ecefee] hover:dark:bg-[#222429]'
            }`}
          >
            <Star className="w-4 h-4" />
            <span className="truncate w-full">Đánh Giá ({myProductReviews.length})</span>
          </button>
        </div>

        {/* TAB 1: OVERVIEW & STATS */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Revenue & Profit Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Gross Revenue */}
              <div className="bg-[#eceeed] dark:bg-[#23252a] border border-[#dfe3e1] dark:border-[#353840] rounded-2xl p-4 shadow">
                <div className="flex items-center justify-between text-slate-600 dark:text-slate-400 text-xs mb-2">
                  <span>Tổng Doanh Thu</span>
                  <DollarSign className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 font-mono">
                  ${formatMoney(stats?.grossRevenue ?? 0)}
                </div>
                <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">
                  Giá trị đơn hàng khách đã thanh toán
                </div>
              </div>

              {/* Platform Fee Deducted */}
              <div className="bg-[#eceeed] dark:bg-[#23252a] border border-[#dfe3e1] dark:border-[#353840] rounded-2xl p-4 shadow">
                <div className="flex items-center justify-between text-slate-600 dark:text-slate-400 text-xs mb-2">
                  <span>Fee Sàn Đã Khấu Trừ ({platformFeePercent}%)</span>
                  <Percent className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="text-2xl font-black text-amber-600 dark:text-amber-400 font-mono">
                  -${formatMoney(stats?.feeAmount ?? 0)}
                </div>
                <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">
                  Khấu trừ tự động duy trì nền tảng
                </div>
              </div>

              {/* Net Profit after fee */}
              <div className="bg-[#eceeed] dark:bg-[#23252a] border border-emerald-500/40 rounded-2xl p-4 shadow bg-gradient-to-b from-[#eceeed] dark:from-[#23252a] to-emerald-950/20">
                <div className="flex items-center justify-between text-slate-700 dark:text-slate-300 text-xs mb-2">
                  <span>Lợi Nhuận Thực Nhận (Sau Fee Sàn)</span>
                  <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 font-mono">
                  +${formatMoney(stats?.netProfit ?? 0)}
                </div>
                <div className="text-[11px] text-emerald-600 dark:text-emerald-400/80 mt-1 font-semibold">
                  ✓ Sẵn sàng để rút tiền
                </div>
              </div>

              {/* Available Balance */}
              <div className="bg-[#eceeed] dark:bg-[#23252a] border border-[#dfe3e1] dark:border-[#353840] rounded-2xl p-4 shadow">
                <div className="flex items-center justify-between text-slate-600 dark:text-slate-400 text-xs mb-2">
                  <span>Số Dư Khả Dụng Rút</span>
                  <Coins className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="text-2xl font-black text-slate-900 dark:text-slate-100 font-mono">
                  ${formatMoney(stats?.withdrawableBalance ?? user.balance)}
                </div>
                <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">
                  Đã rút trước đó: $
                  {formatMoney(
                    stats?.withdrawals
                      ?.filter((w) => w.status === 'completed')
                      .reduce((sum, w) => sum + w.amount, 0) ?? 0
                  )}
                </div>
              </div>
            </div>

            {/* Chart Stats */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-[#eceeed] dark:bg-[#23252a] border border-[#dfe3e1] dark:border-[#353840] rounded-2xl p-4 shadow">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    <span>Doanh Thu</span>
                  </h3>
                  <div className="flex items-center gap-1 bg-[#e2e6e5] dark:bg-[#1a1c20] rounded-lg p-0.5 text-[11px]">
                    {([
                      ['week', '7 ngày'],
                      ['month', '30 ngày'],
                      ['all', 'Toàn thời gian'],
                    ] as const).map(([key, label]) => (
                      <button
                        key={key}
                        onClick={() => setChartPeriod(key)}
                        className={`px-2.5 py-1 rounded-md font-semibold transition ${
                          chartPeriod === key
                            ? 'bg-emerald-500 text-slate-950'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:dark:text-slate-100'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <SimpleBarChart
                  data={chartDaily.map((d): BarChartDatum => ({
                    label: chartPeriod === 'all' ? `${d.date.slice(5, 7)}/${d.date.slice(0, 4)}` : d.date.slice(5).replace('-', '/'),
                    value: d.revenue,
                  }))}
                  colorClass="bg-emerald-500"
                  formatValue={(v) => `$${formatMoney(v)}`}
                />
              </div>

              <div className="bg-[#eceeed] dark:bg-[#23252a] border border-[#dfe3e1] dark:border-[#353840] rounded-2xl p-4 shadow">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2 mb-3">
                  <BarChart3 className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  <span>Top 5 Sản Phẩm Bán Chạy (Doanh Thu)</span>
                </h3>
                <SimpleBarChart
                  data={chartTopProducts.map((p): BarChartDatum => ({
                    label: p.name.length > 14 ? p.name.slice(0, 14) + '…' : p.name,
                    value: p.revenue,
                  }))}
                  colorClass="bg-amber-500"
                  formatValue={(v) => `$${formatMoney(v)}`}
                />
              </div>
            </div>

            {/* Account Inventory Stats (Thống kê tài khoản) */}
            <div className="bg-[#eceeed] dark:bg-[#23252a] border border-[#dfe3e1] dark:border-[#353840] rounded-2xl p-5 shadow space-y-4">
              <div className="flex items-center justify-between border-b border-[#e0e4e2] dark:border-[#33363e] pb-3">
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Thống Kê Tài Khoản & Kho Hàng Của CTV</h3>
                </div>
                <span className="text-xs text-slate-600 dark:text-slate-400">Đồng bộ kho thời gian thực</span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#e3e6e5] dark:border-[#2f323a] rounded-xl p-3">
                  <div className="text-slate-600 dark:text-slate-400 text-xs">Tổng tài khoản đã nạp</div>
                  <div className="text-xl font-bold text-slate-800 dark:text-slate-200 mt-1 font-mono">
                    {(stats?.totalUploaded ?? 0).toLocaleString()}
                  </div>
                  <div className="text-[10px] text-slate-600 dark:text-slate-400 mt-0.5">Tất cả sản phẩm đã đăng</div>
                </div>

                <div className="bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#e3e6e5] dark:border-[#2f323a] rounded-xl p-3">
                  <div className="text-slate-600 dark:text-slate-400 text-xs">Tài khoản đã bán thành công</div>
                  <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1 font-mono">
                    {(stats?.totalSold ?? 0).toLocaleString()}
                  </div>
                  <div className="text-[10px] text-emerald-600 dark:text-emerald-400/80 mt-0.5">Đã hoàn thành bàn giao</div>
                </div>

                <div className="bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#e3e6e5] dark:border-[#2f323a] rounded-xl p-3">
                  <div className="text-slate-600 dark:text-slate-400 text-xs">Tài khoản hiện còn trong kho</div>
                  <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1 font-mono">
                    {(stats?.totalInStock ?? 0).toLocaleString()}
                  </div>
                  <div className="text-[10px] text-emerald-600 dark:text-emerald-400/80 mt-0.5">Sẵn sàng xuất đơn ngay</div>
                </div>

                <div className="bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#e3e6e5] dark:border-[#2f323a] rounded-xl p-3">
                  <div className="text-slate-600 dark:text-slate-400 text-xs">Tỷ lệ bán ra (Sell-through)</div>
                  <div className="text-xl font-bold text-amber-600 dark:text-amber-400 mt-1 font-mono">
                    {stats?.totalUploaded
                      ? ((stats.totalSold / stats.totalUploaded) * 100).toFixed(1)
                      : '0.0'}%
                  </div>
                  <div className="text-[10px] text-amber-600 dark:text-amber-400/80 mt-0.5">Tốc độ thanh khoản cao</div>
                </div>
              </div>
            </div>

            {/* Quick Actions Panel */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-[#eceeed] dark:bg-[#23252a] border border-[#dfe3e1] dark:border-[#353840] rounded-2xl p-5 space-y-3">
                <div className="flex items-center gap-2 text-sm font-bold text-amber-600 dark:text-amber-400">
                  <PackagePlus className="w-4 h-4" />
                  <span>Quy trình Đăng Bán Dành Cho CTV</span>
                </div>
                <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                  CTV chỉ cần chuẩn bị định dạng tài khoản chuẩn (UID|Pass|2FA|Mail) rồi đăng lên hệ thống. Đơn hàng khi có khách mua sẽ được robot tự động kiểm tra token, trừ kho và cộng doanh thu sau khi trừ fee sàn ({platformFeePercent}%) vào ví của bạn.
                </p>
                <button
                  onClick={() => setActiveTab('upload')}
                  className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs px-4 py-2 rounded-lg transition"
                >
                  Đăng Sản Phẩm Mới Ngay
                </button>
              </div>

              <div className="bg-[#eceeed] dark:bg-[#23252a] border border-[#dfe3e1] dark:border-[#353840] rounded-2xl p-5 space-y-3">
                <div className="flex items-center gap-2 text-sm font-bold text-emerald-600 dark:text-emerald-400">
                  <Wallet className="w-4 h-4" />
                  <span>Quy trình Rút Tiền Về Ngân Hàng</span>
                </div>
                <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                  Bạn có thể tạo lệnh rút tiền bất kỳ lúc nào với số tiền từ $10 trở lên. Hỗ trợ tất cả ngân hàng nội địa Việt Nam (Vietcombank, MB Bank, Techcombank, ACB...), ví Momo và Crypto USDT. Tiền sẽ được xử lý trong vòng 15 - 30 phút.
                </p>
                <button
                  onClick={() => setActiveTab('withdraw')}
                  className="bg-emerald-600 hover:bg-emerald-500 text-slate-900 dark:text-slate-100 font-bold text-xs px-4 py-2 rounded-lg transition"
                >
                  Gửi Yêu Cầu Rút Tiền
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: UPLOAD PRODUCT & REFILL STOCK */}
        {activeTab === 'upload' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Form 1: Tạo sản phẩm mới đăng lên sàn (7 cols) */}
            <div className="lg:col-span-7 bg-[#eceeed] dark:bg-[#23252a] border border-[#dfe3e1] dark:border-[#353840] rounded-2xl p-5 shadow space-y-4">
              <div className="border-b border-[#e0e4e2] dark:border-[#33363e] pb-3">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <PackagePlus className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  <span>Đăng Sản Phẩm Mới Lên Gian Hàng</span>
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Sản phẩm của CTV sẽ xuất hiện ngay lập tức trên trang chủ và mục tương ứng.
                </p>
              </div>

              <form onSubmit={handleUploadProduct} className="space-y-4 text-xs">
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                    Tên sản phẩm đăng bán:
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ví dụ: Acc X (Twitter) 2021 - 2023 Full Cookie + 2FA"
                    value={newProdName}
                    onChange={(e) => setNewProdName(e.target.value)}
                    className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee2e0] dark:border-[#363a43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-amber-400"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                      Danh mục:
                    </label>
                    <select
                      value={newProdCategory}
                      onChange={(e) => setNewProdCategory(e.target.value)}
                      className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee2e0] dark:border-[#363a43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-amber-400"
                    >
                      <option value="Twitter / X">Twitter / X</option>
                      <option value="Facebook">Facebook</option>
                      <option value="Hotmail / Outlook">Hotmail / Outlook</option>
                      <option value="Gmail">Gmail</option>
                      <option value="TikTok">TikTok</option>
                      <option value="Telegram">Telegram</option>
                      <option value="Discord">Discord</option>
                      <option value="Tool / Proxy">Tool / Proxy</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                      Giá niêm yết bán lẻ ($):
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        step="0.001"
                        min="0.001"
                        required
                        value={newProdPrice}
                        onChange={(e) => setNewProdPrice(parseFloat(e.target.value) || 0)}
                        className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee2e0] dark:border-[#363a43] rounded-lg px-3 py-2 text-emerald-700 dark:text-emerald-300 font-mono font-bold focus:outline-none focus:border-amber-400"
                      />
                      <span className="absolute right-3 top-2 text-slate-600 dark:text-slate-400 font-mono text-xs">
                        (Thực nhận: ${formatMoney(newProdPrice * (1 - platformFeePercent / 100))})
                      </span>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                    Tên phân loại / Biến thể:
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ví dụ: Loại cổ 2022 - 2FA Live 100%"
                    value={newVariantName}
                    onChange={(e) => setNewVariantName(e.target.value)}
                    className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee2e0] dark:border-[#363a43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-amber-400"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                    Mô tả sản phẩm & chính sách bảo hành:
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Ví dụ: Acc ngâm kỹ, IP sạch, bảo hành sai pass 1 đổi 1 trong 24h đầu."
                    value={newProdDescription}
                    onChange={(e) => setNewProdDescription(e.target.value)}
                    className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee2e0] dark:border-[#363a43] rounded-lg p-2.5 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-amber-400"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                    Định dạng tài khoản (hiện cho khách xem trước khi mua):
                  </label>
                  <input
                    type="text"
                    placeholder="Ví dụ: UID | Password | 2FA | Email | Email Pass | Cookie"
                    value={newProdAccountFormat}
                    onChange={(e) => setNewProdAccountFormat(e.target.value)}
                    className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee2e0] dark:border-[#363a43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 font-mono text-[11px] focus:outline-none focus:border-amber-400"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
                    <label className="block text-slate-700 dark:text-slate-300 font-semibold">
                      Dán danh sách tài khoản nhập kho (Mỗi dòng 1 acc):
                    </label>
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 px-2.5 py-1 rounded-lg cursor-pointer transition">
                        <Upload className="w-3.5 h-3.5" />
                        <span>Tải file .txt</span>
                        <input type="file" accept=".txt" onChange={handleAccountsFileSelect(setRawAccountsUpload)} className="hidden" />
                      </label>
                      <span className="text-emerald-600 dark:text-emerald-400 text-[11px] font-mono">
                        Số lượng: {rawAccountsUpload.trim() ? rawAccountsUpload.trim().split('\n').filter(Boolean).length : 0}
                      </span>
                    </div>
                  </div>
                  <textarea
                    rows={5}
                    required
                    placeholder={`1000849182391|Password#123|JBSWY3DPEHPK3PXP|user1@hotmail.com|MailPass1|ct0=xxx\n1000849182392|Password#456|JBSWY3DPEHPK3PXP|user2@hotmail.com|MailPass2|ct0=yyy`}
                    value={rawAccountsUpload}
                    onChange={(e) => setRawAccountsUpload(e.target.value)}
                    className="w-full bg-[#f5f6f6] dark:bg-[#16181b] border border-[#dee2e0] dark:border-[#363a43] rounded-lg p-2.5 font-mono text-[11px] text-slate-800 dark:text-slate-200 focus:outline-none focus:border-amber-400"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmittingProduct}
                  className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-2.5 rounded-xl transition shadow-[0_0_12px_rgba(245,158,11,0.3)] disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <PlusCircle className="w-4 h-4" />
                  <span>{isSubmittingProduct ? 'Đang tải lên hệ thống...' : 'Đăng Bán Sản Phẩm Lên Sàn'}</span>
                </button>
              </form>
            </div>

            {/* Form 2: Nạp thêm tài khoản vào sản phẩm đã có (5 cols) */}
            <div className="lg:col-span-5 bg-[#eceeed] dark:bg-[#23252a] border border-[#dfe3e1] dark:border-[#353840] rounded-2xl p-5 shadow space-y-4">
              <div className="border-b border-[#e0e4e2] dark:border-[#33363e] pb-3">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Database className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span>Nạp Thêm Tài Khoản Vào Kho Hiện Có</span>
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Bổ sung số lượng tồn kho cho các mã sản phẩm đang bán chạy.
                </p>
              </div>

              <form onSubmit={handleRefillStock} className="space-y-4 text-xs">
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                    Chọn sản phẩm:
                  </label>
                  <select
                    value={refillProductId}
                    onChange={(e) => {
                      setRefillProductId(e.target.value);
                      const prod = products.find((p) => p.id === e.target.value);
                      if (prod && prod.variants[0]) setRefillVariantId(prod.variants[0].id);
                    }}
                    className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee2e0] dark:border-[#363a43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200"
                  >
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                    Chọn biến thể / phân loại:
                  </label>
                  <select
                    value={refillVariantId}
                    onChange={(e) => setRefillVariantId(e.target.value)}
                    className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee2e0] dark:border-[#363a43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200"
                  >
                    {currentRefillProduct?.variants.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} (Tồn: {v.stockCount})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
                    <label className="block text-slate-700 dark:text-slate-300 font-semibold">
                      Dán danh sách tài khoản bổ sung:
                    </label>
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 px-2.5 py-1 rounded-lg cursor-pointer transition">
                        <Upload className="w-3.5 h-3.5" />
                        <span>Tải file .txt</span>
                        <input type="file" accept=".txt" onChange={handleAccountsFileSelect(setRawRefillAccounts)} className="hidden" />
                      </label>
                      <span className="text-amber-600 dark:text-amber-400 text-[11px] font-mono">
                        Số lượng: {rawRefillAccounts.trim() ? rawRefillAccounts.trim().split('\n').filter(Boolean).length : 0}
                      </span>
                    </div>
                  </div>
                  <textarea
                    rows={7}
                    required
                    placeholder={`UID|Pass|2FA|Mail|MailPass\nUID2|Pass2|2FA2|Mail2|MailPass2`}
                    value={rawRefillAccounts}
                    onChange={(e) => setRawRefillAccounts(e.target.value)}
                    className="w-full bg-[#f5f6f6] dark:bg-[#16181b] border border-[#dee2e0] dark:border-[#363a43] rounded-lg p-2.5 font-mono text-[11px] text-slate-800 dark:text-slate-200 focus:outline-none focus:border-emerald-400"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmittingRefill}
                  className="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold py-2.5 rounded-xl transition shadow-[0_0_12px_rgba(6,182,212,0.3)] disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <Database className="w-4 h-4" />
                  <span>{isSubmittingRefill ? 'Đang nạp...' : 'Bổ Sung Ngay Vào Kho'}</span>
                </button>
              </form>
            </div>
          </div>
        )}

        {/* TAB 3: WITHDRAWAL & HISTORY */}
        {activeTab === 'withdraw' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Form Rút tiền (5 cols) */}
            <div className="lg:col-span-5 bg-[#eceeed] dark:bg-[#23252a] border border-emerald-500/40 rounded-2xl p-5 shadow space-y-4">
              <div className="border-b border-[#e0e4e2] dark:border-[#33363e] pb-3">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span>Tạo Lệnh Rút Tiền Về Tài Khoản</span>
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Số dư khả dụng hiện tại: <strong className="text-emerald-600 dark:text-emerald-400 font-mono">${formatMoney(stats?.withdrawableBalance ?? user.balance)}</strong>
                </p>
              </div>

              <form onSubmit={handleWithdrawal} className="space-y-4 text-xs">
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                    Phương thức nhận tiền:
                  </label>
                  <div className="p-2.5 rounded-xl border bg-[#e4e8e7] dark:bg-[#2d3037] border-emerald-400 text-emerald-700 dark:text-emerald-300 font-bold flex items-center justify-center gap-1.5">
                    <Coins className="w-4 h-4" />
                    <span className="text-[11px]">Crypto USDT (TRC20 / BEP20)</span>
                  </div>
                </div>

                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                    Địa chỉ ví USDT (TRC20 / BEP20):
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="T..."
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value)}
                    className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee2e0] dark:border-[#363a43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 font-mono focus:outline-none focus:border-emerald-400"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                    Tên/Ghi chú định danh (Viết hoa không dấu):
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ví dụ: NGUYEN VAN A"
                    value={accountName}
                    onChange={(e) => setAccountName(e.target.value.toUpperCase())}
                    className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee2e0] dark:border-[#363a43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 uppercase font-semibold focus:outline-none focus:border-emerald-400"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-slate-700 dark:text-slate-300 font-semibold">
                      Số tiền muốn rút ($):
                    </label>
                    <button
                      type="button"
                      onClick={() => setWithdrawAmount(stats?.withdrawableBalance ?? user.balance)}
                      className="text-[11px] text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 hover:dark:text-emerald-300 font-semibold"
                    >
                      Rút tối đa
                    </button>
                  </div>
                  <input
                    type="number"
                    step="0.001"
                    min={MIN_WITHDRAW_AMOUNT}
                    max={stats?.withdrawableBalance ?? user.balance}
                    required
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(parseFloat(e.target.value) || 0)}
                    className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee2e0] dark:border-[#363a43] rounded-lg px-3 py-2 text-emerald-600 dark:text-emerald-400 font-mono font-bold text-base focus:outline-none focus:border-emerald-400"
                  />
                  <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">
                    Tỷ giá quy đổi ước tính: 1 USD = 25,400 VND (~ {(withdrawAmount * 25400).toLocaleString('vi-VN')} VND)
                  </div>
                  {(stats?.withdrawableBalance ?? user.balance) < MIN_WITHDRAW_AMOUNT && (
                    <div className="text-[11px] text-amber-600 dark:text-amber-400 mt-1.5 font-semibold">
                      Số dư khả dụng chưa đạt mức tối thiểu ${MIN_WITHDRAW_AMOUNT.toFixed(2)} để tạo lệnh rút tiền.
                    </div>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={isSubmittingWithdraw || (stats?.withdrawableBalance ?? user.balance) < MIN_WITHDRAW_AMOUNT}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-slate-900 dark:text-slate-100 font-bold py-2.5 rounded-xl transition shadow-[0_0_15px_rgba(16,185,129,0.3)] flex items-center justify-center gap-2"
                >
                  <DollarSign className="w-4 h-4" />
                  <span>{isSubmittingWithdraw ? 'Đang xử lý...' : 'Gửi Yêu Cầu Rút Tiền'}</span>
                </button>
              </form>
            </div>

            {/* Lịch sử rút tiền (7 cols) */}
            <div className="lg:col-span-7 bg-[#eceeed] dark:bg-[#23252a] border border-[#dfe3e1] dark:border-[#353840] rounded-2xl p-5 shadow space-y-4">
              <div className="flex items-center justify-between border-b border-[#e0e4e2] dark:border-[#33363e] pb-3">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span>Lịch Sử Yêu Cầu Rút Tiền Của CTV</span>
                </h3>
                <button
                  onClick={loadCtvData}
                  className="text-xs text-slate-600 dark:text-slate-400 hover:text-emerald-600 hover:dark:text-emerald-400 flex items-center gap-1"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                  <span>Làm mới</span>
                </button>
              </div>

              {withdrawals.length === 0 ? (
                <div className="text-center py-12 text-slate-600 dark:text-slate-400 text-xs">
                  Chưa có yêu cầu rút tiền nào. Doanh thu sau khi bán hàng sẽ được lưu vào số dư để rút bất cứ lúc nào.
                </div>
              ) : (
                <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
                  {withdrawals.map((w) => (
                    <div
                      key={w.id}
                      className="p-3.5 bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#e3e6e5] dark:border-[#2f323a] rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                            #{w.id.toUpperCase()}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 ${
                              w.status === 'completed'
                                ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/40'
                                : w.status === 'rejected'
                                ? 'bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/40'
                                : 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/40'
                            }`}
                          >
                            {w.status === 'completed' ? (
                              <>
                                <CheckCircle2 className="w-3 h-3" /> Đã chuyển tiền
                              </>
                            ) : w.status === 'rejected' ? (
                              <>
                                <XCircle className="w-3 h-3" /> Từ chối
                              </>
                            ) : (
                              <>
                                <Clock className="w-3 h-3" /> Chờ Admin duyệt
                              </>
                            )}
                          </span>
                        </div>

                        <div className="text-slate-700 dark:text-slate-300 font-semibold">
                          {w.bankName ? `${w.bankName} - ` : ''} {w.accountNumber} ({w.accountName})
                        </div>

                        <div className="text-[11px] text-slate-600 dark:text-slate-400 font-mono">
                          {w.createdAt}
                        </div>
                      </div>

                      <div className="text-right flex-shrink-0">
                        <div className="text-base font-mono font-bold text-emerald-600 dark:text-emerald-400">
                          +${formatMoney(w.amount)}
                        </div>
                        <div className="text-[10px] text-slate-600 dark:text-slate-400">
                          {(w.amount * 25400).toLocaleString('vi-VN')} VND
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: MY PRODUCTS */}
        {activeTab === 'my-products' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Danh Sách Sản Phẩm CTV Đang Bán</h3>
                <p className="text-xs text-slate-600 dark:text-slate-400">Kiểm tra số lượng tồn kho, giá bán và bấm để xem nhanh giao diện sản phẩm</p>
              </div>

              <button
                onClick={() => setActiveTab('upload')}
                className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs px-3.5 py-2 rounded-lg transition flex items-center gap-1.5 shadow"
              >
                <PlusCircle className="w-4 h-4" />
                <span>Thêm Sản Phẩm Mới</span>
              </button>
            </div>

            <div className="bg-[#eceeed] dark:bg-[#23252a] border border-[#dde2e0] dark:border-[#373b43] rounded-xl overflow-hidden shadow">
              <div className="overflow-x-auto">
              <table className="w-full text-left text-xs min-w-[640px]">
                <thead className="bg-[#eff2f1] dark:bg-[#1d1f24] text-slate-600 dark:text-slate-400 border-b border-[#dde2e0] dark:border-[#373b43]">
                  <tr>
                    <th className="p-3">Sản phẩm</th>
                    <th className="p-3">Danh mục</th>
                    <th className="p-3">Giá niêm yết</th>
                    <th className="p-3">Fee sàn ({platformFeePercent}%)</th>
                    <th className="p-3 text-emerald-600 dark:text-emerald-400 font-bold">Thực nhận / đơn</th>
                    <th className="p-3">Tồn kho</th>
                    <th className="p-3 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e4e8e7]">
                  {myProducts.map((p) => {
                    const totalStock = p.variants.reduce((sum, v) => sum + v.stockCount, 0);
                    const netEarn = p.price * (1 - platformFeePercent / 100);

                    return (
                      <tr key={p.id} className="hover:bg-[#e6eae9] hover:dark:bg-[#2a2d34] transition">
                        <td className="p-3">
                          <div className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                            {p.name}
                            {p.isHidden && (
                              <span className="text-[10px] bg-slate-500/20 text-slate-600 dark:text-slate-400 border border-slate-500/30 px-1.5 py-0.5 rounded font-normal">
                                Đã ẩn
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-600 dark:text-slate-400">{p.variants.length} biến thể</div>
                        </td>
                        <td className="p-3">
                          <span className="bg-[#e5e8e7] dark:bg-[#2d3036] text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded text-[11px]">
                            {p.category}
                          </span>
                        </td>
                        <td className="p-3 font-mono text-slate-700 dark:text-slate-300 font-semibold">
                          ${formatMoney(p.price)}
                        </td>
                        <td className="p-3 font-mono text-amber-600 dark:text-amber-400">
                          ${formatMoney(p.price * platformFeePercent / 100)}
                        </td>
                        <td className="p-3 font-mono font-bold text-emerald-600 dark:text-emerald-400">
                          +${formatMoney(netEarn)}
                        </td>
                        <td className="p-3 font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
                          {totalStock.toLocaleString()}
                        </td>
                        <td className="p-3 text-right space-x-1.5 whitespace-nowrap">
                          <button
                            onClick={() => handleToggleProductVisibility(p)}
                            title={p.isHidden ? 'Hiện lại sản phẩm' : 'Ẩn sản phẩm khỏi cửa hàng'}
                            className={`p-1.5 rounded-lg transition inline-flex ${
                              p.isHidden
                                ? 'bg-[#e5e8e7] dark:bg-[#2d3036] text-slate-500 dark:text-slate-500 hover:bg-emerald-500 hover:text-slate-950'
                                : 'bg-[#e5e8e7] dark:bg-[#2d3036] text-slate-600 dark:text-slate-400 hover:bg-slate-500 hover:text-slate-950'
                            }`}
                          >
                            {p.isHidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            onClick={() => setVariantsModalProduct(p)}
                            title="Ẩn/hiện biến thể"
                            className="bg-[#e5e8e7] dark:bg-[#2d3036] hover:bg-amber-500 hover:text-slate-950 text-slate-600 dark:text-slate-400 font-bold p-1.5 rounded-lg text-xs transition inline-flex"
                          >
                            <Boxes className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => openEditDescription(p)}
                            title="Sửa mô tả & định dạng tài khoản"
                            className="bg-[#e5e8e7] dark:bg-[#2d3036] hover:bg-amber-500 hover:text-slate-950 text-amber-600 dark:text-amber-400 font-bold px-2.5 py-1.5 rounded-lg text-xs transition"
                          >
                            Sửa mô tả
                          </button>
                          <button
                            onClick={() => onSelectProduct(p)}
                            className="bg-[#e5e8e7] dark:bg-[#2d3036] hover:bg-emerald-500 hover:text-slate-950 text-emerald-600 dark:text-emerald-400 font-bold px-3 py-1.5 rounded-lg text-xs transition inline-flex items-center gap-1"
                          >
                            <span>Xem trang bán</span>
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB: ORDER MANAGEMENT — scoped to this CTV's own products */}
        {activeTab === 'orders' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Đơn Hàng Của Tôi</h3>
                <p className="text-xs text-slate-600 dark:text-slate-400">Đơn hàng thuộc các sản phẩm bạn đăng bán — tìm theo mã đơn/khách/sản phẩm, hoàn tiền khi cần</p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={orderStatusFilter}
                  onChange={(e) => setOrderStatusFilter(e.target.value as 'all' | 'completed' | 'refunded')}
                  className="bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-200"
                >
                  <option value="all">Tất cả trạng thái</option>
                  <option value="completed">Hoàn thành</option>
                  <option value="refunded">Đã hoàn tiền</option>
                </select>
                <div className="relative flex-1 min-w-[140px]">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-600 dark:text-slate-400" />
                  <input
                    type="text"
                    value={orderSearch}
                    onChange={(e) => setOrderSearch(e.target.value)}
                    placeholder="Tìm mã đơn/khách/sản phẩm..."
                    className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>
            </div>

            {(() => {
              const q = orderSearch.trim().toLowerCase();
              const filteredOrders = myOrders.filter((o) => {
                if (orderStatusFilter !== 'all' && o.status !== orderStatusFilter) return false;
                if (!q) return true;
                return (
                  o.orderCode.toLowerCase().includes(q) ||
                  o.username.toLowerCase().includes(q) ||
                  o.productName.toLowerCase().includes(q)
                );
              });
              const ordersTotalPages = Math.max(1, Math.ceil(filteredOrders.length / ORDERS_PER_PAGE));
              const safeOrdersPage = Math.min(ordersPage, ordersTotalPages);
              const pagedOrders = filteredOrders.slice((safeOrdersPage - 1) * ORDERS_PER_PAGE, safeOrdersPage * ORDERS_PER_PAGE);

              return (
                <>
                  {myOrders.length === 0 ? (
                    <div className="text-center text-xs text-slate-500 dark:text-slate-500 py-6 bg-[#eceeed] dark:bg-[#23252a] border border-[#dde2e0] dark:border-[#373b43] rounded-xl">
                      Chưa có đơn hàng nào cho sản phẩm của bạn.
                    </div>
                  ) : (
                    <div className="bg-[#eceeed] dark:bg-[#23252a] border border-[#dde2e0] dark:border-[#373b43] rounded-xl overflow-hidden shadow">
                      <div className="overflow-x-auto">
              <table className="w-full text-left text-xs min-w-[640px]">
                        <thead className="bg-[#eff2f1] dark:bg-[#1d1f24] text-slate-600 dark:text-slate-400 border-b border-[#dde2e0] dark:border-[#373b43]">
                          <tr>
                            <th className="p-3">Mã đơn</th>
                            <th className="p-3">Khách hàng</th>
                            <th className="p-3">Sản phẩm</th>
                            <th className="p-3">SL</th>
                            <th className="p-3">Tổng tiền</th>
                            <th className="p-3">Trạng thái</th>
                            <th className="p-3">Thời gian</th>
                            <th className="p-3 text-right">Hành động</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#e4e8e7]">
                          {pagedOrders.map((o) => (
                            <tr key={o.id} className="hover:bg-[#e6eae9] hover:dark:bg-[#2a2d34] transition">
                              <td className="p-3 font-mono font-bold text-slate-900 dark:text-slate-100">#{o.orderCode.toUpperCase()}</td>
                              <td className="p-3 text-slate-700 dark:text-slate-300">{o.username}</td>
                              <td className="p-3 text-slate-700 dark:text-slate-300">
                                <div>{o.productName}</div>
                                <div className="text-[10px] text-slate-500 dark:text-slate-500">{o.variantName}</div>
                              </td>
                              <td className="p-3 text-slate-700 dark:text-slate-300">{o.quantity}</td>
                              <td className="p-3 font-mono font-bold text-emerald-600 dark:text-emerald-400">${formatMoney(o.totalPrice)}</td>
                              <td className="p-3">
                                {o.status === 'refunded' ? (
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/30">
                                    Đã hoàn tiền
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                                    Hoàn thành
                                  </span>
                                )}
                              </td>
                              <td className="p-3 font-mono text-[10px] text-slate-600 dark:text-slate-400">
                                {new Date(o.createdAt).toLocaleString('vi-VN')}
                              </td>
                              <td className="p-3 text-right">
                                {o.status === 'refunded' ? (
                                  <span className="text-[10px] text-slate-500 dark:text-slate-500">
                                    {o.refundedAt ? new Date(o.refundedAt).toLocaleDateString('vi-VN') : ''}
                                  </span>
                                ) : (
                                  <button
                                    onClick={() => handleRefundOrder(o)}
                                    disabled={refundingOrderCode === o.orderCode}
                                    className="bg-red-50 dark:bg-red-950/70 hover:bg-red-100 hover:dark:bg-red-900/70 text-red-700 dark:text-red-300 border border-red-500/30 px-2.5 py-1 rounded text-[10px] font-bold disabled:opacity-40 disabled:cursor-not-allowed transition"
                                  >
                                    {refundingOrderCode === o.orderCode ? 'Đang hoàn...' : 'Hoàn tiền'}
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
              </div>
                    </div>
                  )}

                  {ordersTotalPages > 1 && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-600 dark:text-slate-400">
                        Trang {safeOrdersPage}/{ordersTotalPages} ({filteredOrders.length} đơn hàng)
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setOrdersPage((p) => Math.max(1, p - 1))}
                          disabled={safeOrdersPage === 1}
                          className="px-3 py-1.5 bg-[#eceeed] dark:bg-[#23252a] hover:bg-[#e0e4e2] hover:dark:bg-[#2a2d34] border border-[#dde2e0] dark:border-[#373b43] rounded-lg font-semibold text-slate-700 dark:text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed transition"
                        >
                          ← Trước
                        </button>
                        <button
                          onClick={() => setOrdersPage((p) => Math.min(ordersTotalPages, p + 1))}
                          disabled={safeOrdersPage === ordersTotalPages}
                          className="px-3 py-1.5 bg-[#eceeed] dark:bg-[#23252a] hover:bg-[#e0e4e2] hover:dark:bg-[#2a2d34] border border-[#dde2e0] dark:border-[#373b43] rounded-lg font-semibold text-slate-700 dark:text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed transition"
                        >
                          Sau →
                        </button>
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}

        {/* TAB 5: VOUCHERS */}
        {activeTab === 'vouchers' && (
          <div className="space-y-4">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Mã Giảm Giá Của Tôi</h3>
              <p className="text-xs text-slate-600 dark:text-slate-400">Tạo mã voucher riêng, giới hạn số lượt sử dụng — khách nhập mã ở trang sản phẩm để được giảm giá tự động.</p>
            </div>

            {/* Create voucher form */}
            <form onSubmit={handleCreateVoucher} className="bg-[#eceeed] dark:bg-[#23252a] border border-[#dde2e0] dark:border-[#373b43] rounded-xl p-4 grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Mã voucher:</label>
                <input
                  type="text"
                  value={newVoucherCode}
                  onChange={(e) => setNewVoucherCode(e.target.value.toUpperCase())}
                  placeholder="VD: RONAN10"
                  className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 font-mono focus:border-amber-500 focus:outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Giảm giá (%):</label>
                <input
                  type="number"
                  min={1}
                  max={90}
                  value={newVoucherDiscount}
                  onChange={(e) => setNewVoucherDiscount(Number(e.target.value))}
                  className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 font-mono focus:border-amber-500 focus:outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Số lượt sử dụng tối đa:</label>
                <input
                  type="number"
                  min={1}
                  value={newVoucherMaxUses}
                  onChange={(e) => setNewVoucherMaxUses(Number(e.target.value))}
                  className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 font-mono focus:border-amber-500 focus:outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Hết hạn (tùy chọn):</label>
                <input
                  type="date"
                  value={newVoucherExpiry}
                  onChange={(e) => setNewVoucherExpiry(e.target.value)}
                  className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 font-mono focus:border-amber-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Áp dụng cho sản phẩm:</label>
                <select
                  value={newVoucherProductId}
                  onChange={(e) => {
                    setNewVoucherProductId(e.target.value);
                    setNewVoucherVariantId('');
                  }}
                  className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 focus:border-amber-500 focus:outline-none"
                >
                  <option value="">Tất cả sản phẩm</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Áp dụng cho biến thể:</label>
                <select
                  value={newVoucherVariantId}
                  onChange={(e) => setNewVoucherVariantId(e.target.value)}
                  disabled={!newVoucherProductId}
                  className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 focus:border-amber-500 focus:outline-none disabled:opacity-40"
                >
                  <option value="">Tất cả biến thể</option>
                  {newVoucherProductId &&
                    products
                      .find((p) => p.id === newVoucherProductId)
                      ?.variants.map((v) => (
                        <option key={v.id} value={v.id}>{v.name}</option>
                      ))}
                </select>
              </div>
              <div className="sm:col-span-4 flex justify-end">
                <button
                  type="submit"
                  disabled={isCreatingVoucher}
                  className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold text-xs px-4 py-2 rounded-lg transition flex items-center gap-1.5 shadow"
                >
                  <PlusCircle className="w-4 h-4" />
                  <span>{isCreatingVoucher ? 'Đang tạo...' : 'Tạo Mã Giảm Giá'}</span>
                </button>
              </div>
            </form>

            {/* Vouchers table */}
            <div className="bg-[#eceeed] dark:bg-[#23252a] border border-[#dde2e0] dark:border-[#373b43] rounded-xl overflow-hidden shadow">
              <div className="overflow-x-auto">
              <table className="w-full text-left text-xs min-w-[640px]">
                <thead className="bg-[#eff2f1] dark:bg-[#1d1f24] text-slate-600 dark:text-slate-400 border-b border-[#dde2e0] dark:border-[#373b43]">
                  <tr>
                    <th className="p-3">Mã</th>
                    <th className="p-3">Áp dụng</th>
                    <th className="p-3">Giảm giá</th>
                    <th className="p-3">Số lượng sử dụng</th>
                    <th className="p-3">Hết hạn</th>
                    <th className="p-3">Trạng thái</th>
                    <th className="p-3 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e4e8e7]">
                  {vouchers.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-6 text-center text-slate-500 dark:text-slate-500">
                        Chưa có mã giảm giá nào. Tạo mã đầu tiên ở form bên trên.
                      </td>
                    </tr>
                  ) : (
                    vouchers.map((v) => {
                      const isExpired = v.expiresAt ? new Date(v.expiresAt).getTime() < Date.now() : false;
                      const isExhausted = v.usedCount >= v.maxUses;
                      const isLive = !isExpired && !isExhausted;
                      return (
                        <tr key={v.id} className="hover:bg-[#e6eae9] hover:dark:bg-[#2a2d34] transition">
                          <td className="p-3 font-mono font-bold text-slate-900 dark:text-slate-100">{v.code}</td>
                          <td className="p-3 text-slate-600 dark:text-slate-400">
                            {v.applicableVariantId ? (
                              <span className="text-amber-700 dark:text-amber-400" title={v.applicableProductName}>{v.applicableVariantName}</span>
                            ) : v.applicableProductId ? (
                              <span className="text-amber-700 dark:text-amber-400">{v.applicableProductName}</span>
                            ) : (
                              <span className="text-slate-500 dark:text-slate-500">Tất cả sản phẩm</span>
                            )}
                          </td>
                          <td className="p-3 font-mono text-emerald-600 dark:text-emerald-400 font-bold">-{v.discountPercent}%</td>
                          <td className="p-3 font-mono text-slate-700 dark:text-slate-300">
                            {v.usedCount} / {v.maxUses}
                          </td>
                          <td className="p-3 text-slate-600 dark:text-slate-400">
                            {v.expiresAt ? new Date(v.expiresAt).toLocaleDateString('vi-VN') : 'Không giới hạn'}
                          </td>
                          <td className="p-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                isLive
                                  ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/40'
                                  : 'bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/40'
                              }`}
                            >
                              {isLive ? 'Đang hoạt động' : isExpired ? 'Hết hạn' : 'Hết lượt'}
                            </span>
                          </td>
                          <td className="p-3 text-right">
                            <button
                              onClick={() => handleDeleteVoucher(v.id, v.code)}
                              className="p-1 text-red-600 dark:text-red-400 hover:text-red-700 hover:dark:text-red-300 hover:bg-red-50 hover:dark:bg-red-950/70 rounded transition"
                              title="Xóa mã"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB: REVIEWS — read-only visibility into reviews on this CTV's
            own products, so they know which buyers to reach out to about a
            low-rated ("xấu") review; the buyer can revise it themselves
            afterward, the CTV/admin can't edit it directly here. */}
        {activeTab === 'reviews' && (
          <div className="space-y-4">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Đánh Giá Trên Sản Phẩm Của Tôi</h3>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Đánh giá từ {reviewEditableMaxRating} sao trở xuống (viền đỏ) là đánh giá xấu — user vẫn tự sửa lại được.
                Liên hệ trực tiếp với user để xử lý và đề nghị họ cập nhật đánh giá tốt hơn nếu vấn đề đã được giải quyết.
              </p>
            </div>

            <div className="space-y-2">
              {myProductReviews.length === 0 ? (
                <div className="text-center py-8 bg-[#eceeed] dark:bg-[#23252a] border border-[#dfe3e1] dark:border-[#353840] rounded-xl text-xs text-slate-600 dark:text-slate-400">
                  Chưa có đánh giá nào trên sản phẩm của bạn.
                </div>
              ) : (
                myProductReviews.map((r) => {
                  const isBad = r.rating <= reviewEditableMaxRating;
                  return (
                    <div
                      key={r.id}
                      className={`bg-[#eceeed] dark:bg-[#23252a] border rounded-xl p-3.5 ${
                        isBad ? 'border-red-500/50' : 'border-[#dfe3e1] dark:border-[#353840]'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900 dark:text-slate-100 text-xs">{r.author}</span>
                          <span className="text-amber-600 dark:text-amber-400 text-xs">
                            {'★'.repeat(r.rating)}
                            {'☆'.repeat(5 - r.rating)}
                          </span>
                          {isBad && (
                            <span className="bg-red-500/15 text-red-700 dark:text-red-300 border border-red-500/40 text-[10px] font-bold px-1.5 py-0.5 rounded">
                              CẦN XỬ LÝ
                            </span>
                          )}
                          {r.editedAt && (
                            <span className="text-[10px] text-slate-500 dark:text-slate-500 italic">(đã sửa)</span>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-500 dark:text-slate-500">{new Date(r.date).toLocaleString()}</span>
                      </div>
                      <div className="text-[11px] text-slate-600 dark:text-slate-400 font-semibold mb-1">{r.productName}</div>
                      <p className="text-xs text-slate-700 dark:text-slate-300">{r.comment}</p>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modal: edit a product's description & account-format — the only
          fields a CTV can touch on an existing listing after creation. */}
      {editingDescProductId && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#eceeed] dark:bg-[#23252a] border border-amber-500/50 rounded-2xl max-w-lg w-full p-5 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-2 border-b border-[#e0e4e2] dark:border-[#33363e]">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Sửa Mô Tả Sản Phẩm</h3>
              <button
                onClick={() => setEditingDescProductId(null)}
                className="text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:dark:text-slate-100"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                  Mô tả sản phẩm & chính sách bảo hành:
                </label>
                <textarea
                  rows={4}
                  placeholder="Ví dụ: Acc ngâm kỹ, IP sạch, bảo hành sai pass 1 đổi 1 trong 24h đầu."
                  value={editDescText}
                  onChange={(e) => setEditDescText(e.target.value)}
                  className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee2e0] dark:border-[#363a43] rounded-lg p-2.5 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-amber-400"
                />
                <p className="text-[10px] text-slate-500 dark:text-slate-500 mt-1">Để trống rồi lưu = xóa mô tả hiện tại.</p>
              </div>

              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                  Định dạng tài khoản (hiện cho khách xem trước khi mua):
                </label>
                <input
                  type="text"
                  placeholder="Ví dụ: UID | Password | 2FA | Email | Email Pass | Cookie"
                  value={editAccountFormatText}
                  onChange={(e) => setEditAccountFormatText(e.target.value)}
                  className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee2e0] dark:border-[#363a43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 font-mono text-[11px] focus:outline-none focus:border-amber-400"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setEditingDescProductId(null)}
                className="px-4 py-2 bg-[#e5e8e7] dark:bg-[#2d3036] hover:bg-[#dde1e0] hover:dark:bg-[#373b44] text-slate-700 dark:text-slate-300 rounded-lg text-xs font-semibold"
              >
                Hủy
              </button>
              <button
                onClick={handleSaveDescription}
                disabled={isSavingDescription}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg text-xs transition disabled:opacity-50"
              >
                {isSavingDescription ? 'Đang lưu...' : 'Lưu Thay Đổi'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: show/hide each variant of a product — CTV can't add, edit,
          or delete a variant's price/name (Admin-only), just pull one off
          the storefront without touching its inventory. */}
      {variantsModalProduct && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#eceeed] dark:bg-[#23252a] border border-amber-500/50 rounded-2xl max-w-lg w-full p-5 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-2 border-b border-[#e0e4e2] dark:border-[#33363e]">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Biến Thể Của "{variantsModalProduct.name}"
              </h3>
              <button
                onClick={() => setVariantsModalProduct(null)}
                className="text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:dark:text-slate-100"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2 text-xs">
              {variantsModalProduct.variants.map((v) => (
                <div
                  key={v.id}
                  className="flex items-center justify-between gap-3 p-3 bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee2e0] dark:border-[#363a43] rounded-xl"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5 truncate">
                      {v.name}
                      {v.isHidden && (
                        <span className="text-[10px] bg-slate-500/20 text-slate-600 dark:text-slate-400 border border-slate-500/30 px-1.5 py-0.5 rounded font-normal flex-shrink-0">
                          Đã ẩn
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] font-mono text-amber-600 dark:text-amber-400">${formatMoney(v.price)}</div>
                  </div>
                  <button
                    onClick={() => handleToggleVariantVisibility(variantsModalProduct.id, v.id, v.isHidden)}
                    title={v.isHidden ? 'Hiện lại biến thể' : 'Ẩn biến thể khỏi cửa hàng'}
                    className={`flex-shrink-0 p-1.5 rounded-lg transition ${
                      v.isHidden
                        ? 'bg-[#e5e8e7] dark:bg-[#2d3036] text-slate-500 dark:text-slate-500 hover:bg-emerald-500 hover:text-slate-950'
                        : 'bg-[#e5e8e7] dark:bg-[#2d3036] text-slate-600 dark:text-slate-400 hover:bg-slate-500 hover:text-slate-950'
                    }`}
                  >
                    {v.isHidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
