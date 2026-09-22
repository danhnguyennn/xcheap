import React, { useState, useEffect } from 'react';
import { Product, ProductVariant, User, Language, UserRole, CryptoNetwork, CryptoOption, Voucher, Review, ReviewSuggestion, Order } from '../types';
import { translations } from '../locales/translations';
import { formatMoney } from '../utils/pricing';
import { SimpleBarChart, BarChartDatum } from '../components/charts/SimpleBarChart';
import {
  ShieldCheck,
  Users,
  PackagePlus,
  Activity,
  Database,
  DollarSign,
  PlusCircle,
  Check,
  ArrowLeft,
  Search,
  Trash2,
  Edit3,
  Layers,
  TrendingUp,
  RefreshCw,
  Server,
  Key,
  FolderPlus,
  Coins,
  FileText,
  AlertCircle,
  ExternalLink,
  ChevronRight,
  Percent,
  Ticket,
  Boxes,
  BarChart3,
  Upload,
  Star,
  Eye,
  EyeOff,
  Flame
} from 'lucide-react';

interface AdminPageProps {
  user: User;
  products: Product[];
  language: Language;
  onBackToStore: () => void;
  onRefreshProducts: () => void;
  onRefreshUser: () => void;
  onOpenDeposit: () => void;
}

const EMPTY_SUGGESTION_TEXT: Record<Language, string> = { vn: '', en: '', zh: '', th: '' };
const SUGGESTION_LANGUAGE_LABELS: Record<Language, string> = { vn: 'VN', en: 'EN', zh: 'ZH', th: 'TH' };

export const AdminPage: React.FC<AdminPageProps> = ({
  user,
  products,
  language,
  onBackToStore,
  onRefreshProducts,
  onRefreshUser,
  onOpenDeposit,
}) => {
  const t = translations[language];
  const [activeTab, setActiveTab] = useState<'overview' | 'categories' | 'products' | 'users' | 'inventory' | 'orders' | 'rpc' | 'ctv-fee' | 'vouchers' | 'reviews'>('overview');
  
  // Data states
  const [stats, setStats] = useState<any>(null);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  // Deposit networks (crypto_options) — full list including hidden ones, for
  // the "Cổng RPC" management tab. The public storefront/deposit modal uses
  // a separately-filtered fetch (App.tsx's fetchCryptoOptions) that already
  // excludes hidden entries.
  const [cryptoDepositOptions, setCryptoDepositOptions] = useState<CryptoOption[]>([]);
  const [editingCryptoOptId, setEditingCryptoOptId] = useState<string | null>(null);
  const [cryptoOptForm, setCryptoOptForm] = useState<Partial<CryptoOption>>({});
  const [showAddCryptoOptModal, setShowAddCryptoOptModal] = useState(false);
  const [inventoryItems, setInventoryItems] = useState<any[]>([]);
  // Which product groups in the inventory list are expanded — starts empty
  // (everything collapsed) so the tab doesn't render dozens of full account
  // tables at once; admin clicks a product's header bar to open just that
  // one.
  const [expandedInventoryProducts, setExpandedInventoryProducts] = useState<Set<string>>(new Set());
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [productReviews, setProductReviews] = useState<(Review & { productName: string })[]>([]);
  const [reviewEditableMaxRating, setReviewEditableMaxRating] = useState(3);
  const [reviewSuggestions, setReviewSuggestions] = useState<ReviewSuggestion[]>([]);
  const [newSuggestionText, setNewSuggestionText] = useState<Record<Language, string>>(EMPTY_SUGGESTION_TEXT);
  const [isAddingSuggestion, setIsAddingSuggestion] = useState(false);
  const [editingSuggestionId, setEditingSuggestionId] = useState<string | null>(null);
  const [editingSuggestionText, setEditingSuggestionText] = useState<Record<Language, string>>(EMPTY_SUGGESTION_TEXT);
  const [chartDaily, setChartDaily] = useState<{ date: string; revenue: number; orders: number }[]>([]);
  const [chartTopProducts, setChartTopProducts] = useState<{ name: string; revenue: number; orders: number }[]>([]);
  const [chartPeriod, setChartPeriod] = useState<'week' | 'month' | 'all'>('week');
  const [newVoucherCode, setNewVoucherCode] = useState('');
  const [newVoucherDiscount, setNewVoucherDiscount] = useState<number>(10);
  const [newVoucherMaxUses, setNewVoucherMaxUses] = useState<number>(50);
  const [newVoucherExpiry, setNewVoucherExpiry] = useState('');
  const [newVoucherProductId, setNewVoucherProductId] = useState('');
  const [newVoucherVariantId, setNewVoucherVariantId] = useState('');
  const [isCreatingVoucher, setIsCreatingVoucher] = useState(false);
  const [platformFee, setPlatformFee] = useState<number>(5);
  const [adminWithdrawals, setAdminWithdrawals] = useState<any[]>([]);
  const [customFeeInput, setCustomFeeInput] = useState<number>(5);
  const [loading, setLoading] = useState(false);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Per-row custom top-up amount for the users table — accounts cost $0.4
  // each and buyers purchase in the hundreds/thousands, so a fixed +$10
  // isn't a workable increment for crediting a real top-up.
  const [balanceInputs, setBalanceInputs] = useState<Record<string, string>>({});

  // Bulk Import state
  const [importProductId, setImportProductId] = useState<string>(products[0]?.id || '');
  const [importVariantId, setImportVariantId] = useState<string>(products[0]?.variants[0]?.id || '');
  const [rawAccountsInput, setRawAccountsInput] = useState('');
  const [isImporting, setIsImporting] = useState(false);

  // User edit / create state
  const [adjustUserId, setAdjustUserId] = useState('');
  const [adjustAmount, setAdjustAmount] = useState<number>(10);
  const [selectedUserRole, setSelectedUserRole] = useState<UserRole>('ctv');
  const [newUsername, setNewUsername] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserRole, setNewUserRole] = useState<UserRole>('user');
  const [newUserBalance, setNewUserBalance] = useState<number>(0);
  const [showAddUserModal, setShowAddUserModal] = useState(false);

  // Category create / edit state — editingCatId is null while adding, set to
  // the category's id while editing an existing one (same form, same modal).
  const [newCatName, setNewCatName] = useState('');
  const [newCatSlug, setNewCatSlug] = useState('');
  const [newCatDesc, setNewCatDesc] = useState('');
  const [newCatIcon, setNewCatIcon] = useState('other');
  const [showAddCatModal, setShowAddCatModal] = useState(false);
  const [editingCatId, setEditingCatId] = useState<string | null>(null);

  // Product create / edit state — editingProdId is null while adding, set to
  // the product's id while editing an existing one (same form, same modal).
  const [showAddProdModal, setShowAddProdModal] = useState(false);
  const [editingProdId, setEditingProdId] = useState<string | null>(null);
  const [newProdName, setNewProdName] = useState('');
  const [newProdCategory, setNewProdCategory] = useState('Twitter / X');
  const [newProdCatSlug, setNewProdCatSlug] = useState('twitter');
  const [newProdPrice, setNewProdPrice] = useState<number>(0.5);
  const [newProdImage, setNewProdImage] = useState('twitter');
  const [newProdDescription, setNewProdDescription] = useState('');
  const [newProdAccountFormat, setNewProdAccountFormat] = useState('');

  // Variant CRUD state — a separate modal, linked to whichever product it
  // was opened from. editingVariantId is null while adding, set to the
  // variant's id while editing an existing one (same form, same modal).
  const [showVariantsModal, setShowVariantsModal] = useState(false);
  const [variantsProduct, setVariantsProduct] = useState<Product | null>(null);
  const [editingVariantId, setEditingVariantId] = useState<string | null>(null);
  const [variantName, setVariantName] = useState('');
  const [variantPrice, setVariantPrice] = useState<number>(0.5);
  const [variantOriginalPrice, setVariantOriginalPrice] = useState<number>(0);
  const [isSavingVariant, setIsSavingVariant] = useState(false);

  // Search queries
  const [userSearch, setUserSearch] = useState('');
  const [productSearch, setProductSearch] = useState('');

  // Pagination — Users and Inventory tabs used to just dump everything into
  // a tall scroll box, which got unwieldy once there were more than a
  // screenful of rows. Paginated instead, page resets to 1 whenever the
  // underlying filtered list changes shape (new search term, new data).
  const USERS_PER_PAGE = 15;
  const [usersPage, setUsersPage] = useState(1);
  const INVENTORY_PRODUCTS_PER_PAGE = 8;
  const [inventoryPage, setInventoryPage] = useState(1);
  const ORDERS_PER_PAGE = 15;
  const [ordersPage, setOrdersPage] = useState(1);

  // Order management
  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const [orderSearch, setOrderSearch] = useState('');
  const [orderStatusFilter, setOrderStatusFilter] = useState<'all' | 'completed' | 'refunded'>('all');
  const [refundingOrderCode, setRefundingOrderCode] = useState<string | null>(null);

  // "Đang online" stat — polled independently of fetchAdminData (which only
  // runs on mount/after an action) so the number actually stays live while
  // the admin has the dashboard open.
  const [onlineCount, setOnlineCount] = useState<number | null>(null);
  useEffect(() => {
    const fetchOnlineCount = () => {
      fetch('/api/admin/online-count')
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data) setOnlineCount(data.count);
        })
        .catch(() => {});
    };
    fetchOnlineCount();
    const interval = setInterval(fetchOnlineCount, 20000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setUsersPage(1);
  }, [userSearch]);

  useEffect(() => {
    setOrdersPage(1);
  }, [orderSearch, orderStatusFilter]);

  const showNotification = (successMsg: string | null, errorMsg: string | null = null) => {
    setActionSuccess(successMsg);
    setActionError(errorMsg);
    setTimeout(() => {
      setActionSuccess(null);
      setActionError(null);
    }, 4000);
  };

  // Tách riêng fetch biểu đồ khỏi fetchAdminData chính — để đổi khoảng thời
  // gian (Tuần/Tháng/Toàn thời gian) chỉ cần gọi lại đúng API này, không phải
  // tải lại toàn bộ dữ liệu trang admin.
  const fetchChartData = async (period: 'week' | 'month' | 'all') => {
    try {
      const chartsRes = await fetch(`/api/admin/stats/charts?period=${period}`);
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

  const fetchAdminData = async () => {
    setLoading(true);
    try {
      const [statsRes, usersRes, catsRes, invRes, feeRes, withRes, voucherRes, reviewsRes, suggestionsRes, cryptoOptsRes, ordersRes] = await Promise.all([
        fetch('/api/admin/stats'),
        fetch('/api/admin/users'),
        fetch('/api/categories'),
        fetch('/api/admin/inventory'),
        fetch('/api/platform/config'),
        fetch('/api/admin/withdrawals'),
        fetch('/api/vouchers'),
        fetch('/api/admin/reviews'),
        fetch('/api/review-comment-suggestions'),
        fetch('/api/admin/crypto-options'),
        fetch('/api/admin/orders'),
      ]);
      fetchChartData(chartPeriod);

      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData);
      }
      if (usersRes.ok) {
        const usersData = await usersRes.json();
        setAllUsers(usersData.users || []);
      }
      if (catsRes.ok) {
        const catsData = await catsRes.json();
        setCategories(catsData.categories || []);
      }
      if (invRes.ok) {
        const invData = await invRes.json();
        setInventoryItems(invData.items || []);
      }
      if (feeRes.ok) {
        const feeData = await feeRes.json();
        // "|| 5" từng khiến fee = 0% (một giá trị hợp lệ) bị coi là falsy và
        // luôn bị thay bằng 5% mặc định mỗi khi tải lại dữ liệu admin — đây
        // là lý do "chỉnh fee về 0% không được": lưu 0% thành công thật, chỉ
        // là hiển thị bị ghi đè ngay sau đó. Dùng kiểm tra kiểu number rõ
        // ràng để 0 vẫn được giữ đúng.
        const fee = typeof feeData.platformFeePercent === 'number' ? feeData.platformFeePercent : 5;
        setPlatformFee(fee);
        setCustomFeeInput(fee);
      }
      if (withRes.ok) {
        const withData = await withRes.json();
        setAdminWithdrawals(withData.withdrawals || []);
      }
      if (voucherRes.ok) {
        const voucherData = await voucherRes.json();
        setVouchers(voucherData.vouchers || []);
      }
      if (reviewsRes.ok) {
        const reviewsData = await reviewsRes.json();
        setProductReviews(reviewsData.reviews || []);
        setReviewEditableMaxRating(reviewsData.editableMaxRating ?? 3);
      }
      if (suggestionsRes.ok) {
        const suggestionsData = await suggestionsRes.json();
        setReviewSuggestions(suggestionsData.suggestions || []);
      }
      if (cryptoOptsRes.ok) {
        const cryptoOptsData = await cryptoOptsRes.json();
        setCryptoDepositOptions(cryptoOptsData.options || []);
      }
      if (ordersRes.ok) {
        const ordersData = await ordersRes.json();
        setAllOrders(ordersData.orders || []);
      }
    } catch (err) {
      console.error('Failed to load admin data', err);
    } finally {
      setLoading(false);
    }
  };

  // Deposit network (crypto_options) management — show/hide, edit its
  // display/RPC config, delete, or restore one of the 4 supported networks.
  const handleToggleCryptoOptVisibility = async (opt: CryptoOption) => {
    const nextHidden = !opt.isHidden;
    try {
      const res = await fetch(`/api/admin/crypto-options/${opt.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isHidden: nextHidden }),
      });
      if (res.ok) {
        showNotification(nextHidden ? `✅ Đã ẩn cổng nạp "${opt.networkLabel}"` : `✅ Đã hiện lại cổng nạp "${opt.networkLabel}"`);
        fetchAdminData();
      } else {
        showNotification(null, 'Lỗi cập nhật trạng thái hiển thị');
      }
    } catch (e) {
      showNotification(null, 'Lỗi cập nhật trạng thái hiển thị');
    }
  };

  const handleDeleteCryptoOpt = async (opt: CryptoOption) => {
    if (!confirm(`Xóa hẳn cổng nạp "${opt.networkLabel}"? Ví đã tạo cho người dùng trên mạng này sẽ không còn hiển thị/kiểm tra được nữa cho tới khi thêm lại.`)) return;
    try {
      const res = await fetch(`/api/admin/crypto-options/${opt.id}`, { method: 'DELETE' });
      if (res.ok) {
        showNotification(`✅ Đã xóa cổng nạp "${opt.networkLabel}"`);
        fetchAdminData();
      } else {
        showNotification(null, 'Lỗi xóa cổng nạp');
      }
    } catch (e) {
      showNotification(null, 'Lỗi xóa cổng nạp');
    }
  };

  const openEditCryptoOpt = (opt: CryptoOption) => {
    setEditingCryptoOptId(opt.id);
    setCryptoOptForm(opt);
  };

  const handleSaveCryptoOpt = async () => {
    if (!editingCryptoOptId) return;
    try {
      const res = await fetch(`/api/admin/crypto-options/${editingCryptoOptId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cryptoOptForm),
      });
      if (res.ok) {
        showNotification('✅ Đã lưu cấu hình cổng nạp');
        setEditingCryptoOptId(null);
        fetchAdminData();
      } else {
        const data = await res.json().catch(() => ({}));
        showNotification(null, data.error || 'Lỗi lưu cấu hình');
      }
    } catch (e) {
      showNotification(null, 'Lỗi kết nối máy chủ');
    }
  };

  // Networks the wallet system already knows how to generate an address
  // for, that currently have no row in cryptoDepositOptions — offered as
  // "add back" options rather than a free-form id field, since a genuinely
  // new blockchain id would need real wallet/RPC code, not just a DB row.
  const KNOWN_CRYPTO_NETWORK_IDS: CryptoNetwork[] = ['bsc', 'polygon', 'trc', 'base'];
  const missingCryptoNetworkIds = KNOWN_CRYPTO_NETWORK_IDS.filter(
    (id) => !cryptoDepositOptions.some((o) => o.id === id)
  );

  const openAddCryptoOpt = (id: CryptoNetwork) => {
    setCryptoOptForm({ id, name: '', token: '', networkLabel: '', decimals: 18, contractAddress: '', rpcUrl: '', explorerTxUrl: '', icon: '💰', minDeposit: 1.0 });
    setShowAddCryptoOptModal(true);
  };

  const handleCreateCryptoOpt = async () => {
    try {
      const res = await fetch('/api/admin/crypto-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cryptoOptForm),
      });
      if (res.ok) {
        showNotification('✅ Đã thêm lại cổng nạp');
        setShowAddCryptoOptModal(false);
        fetchAdminData();
      } else {
        const data = await res.json().catch(() => ({}));
        showNotification(null, data.error || 'Lỗi thêm cổng nạp');
      }
    } catch (e) {
      showNotification(null, 'Lỗi kết nối máy chủ');
    }
  };

  const handleCreateVoucher = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVoucherCode.trim()) {
      showNotification(null, 'Vui lòng nhập mã voucher');
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
        showNotification(`✅ Đã tạo mã "${data.voucher.code}" thành công!`);
        setNewVoucherCode('');
        setNewVoucherDiscount(10);
        setNewVoucherMaxUses(50);
        setNewVoucherExpiry('');
        setNewVoucherProductId('');
        setNewVoucherVariantId('');
        fetchAdminData();
      } else {
        showNotification(null, data.error || 'Lỗi tạo voucher');
      }
    } catch (err) {
      showNotification(null, 'Lỗi kết nối máy chủ');
    } finally {
      setIsCreatingVoucher(false);
    }
  };

  const handleDeleteVoucher = async (id: string, code: string) => {
    if (!confirm(`Bạn có chắc muốn xóa mã "${code}"?`)) return;
    try {
      const res = await fetch(`/api/vouchers/${id}`, { method: 'DELETE' });
      if (res.ok) {
        showNotification(`✅ Đã xóa mã "${code}"`);
        fetchAdminData();
      } else {
        const data = await res.json().catch(() => ({}));
        showNotification(null, data.error || 'Lỗi xóa voucher');
      }
    } catch (err) {
      showNotification(null, 'Lỗi kết nối máy chủ');
    }
  };

  const handleAddSuggestion = async () => {
    if (Object.values(newSuggestionText).some((v) => !v.trim())) {
      showNotification(null, 'Vui lòng nhập nội dung câu gợi ý cho đủ cả 4 ngôn ngữ');
      return;
    }
    setIsAddingSuggestion(true);
    try {
      const res = await fetch('/api/admin/review-comment-suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: newSuggestionText }),
      });
      const data = await res.json();
      if (res.ok) {
        setReviewSuggestions((prev) => [...prev, data.suggestion]);
        setNewSuggestionText(EMPTY_SUGGESTION_TEXT);
        showNotification('✅ Đã thêm câu gợi ý đánh giá');
      } else {
        showNotification(null, data.error || 'Lỗi thêm câu gợi ý');
      }
    } catch (err) {
      showNotification(null, 'Lỗi kết nối máy chủ');
    } finally {
      setIsAddingSuggestion(false);
    }
  };

  const handleSaveEditedSuggestion = async (id: string) => {
    if (Object.values(editingSuggestionText).some((v) => !v.trim())) {
      showNotification(null, 'Nội dung câu gợi ý không được để trống ở bất kỳ ngôn ngữ nào');
      return;
    }
    try {
      const res = await fetch(`/api/admin/review-comment-suggestions/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: editingSuggestionText }),
      });
      const data = await res.json();
      if (res.ok) {
        setReviewSuggestions((prev) => prev.map((s) => (s.id === id ? data.suggestion : s)));
        setEditingSuggestionId(null);
        showNotification('✅ Đã cập nhật câu gợi ý');
      } else {
        showNotification(null, data.error || 'Lỗi cập nhật câu gợi ý');
      }
    } catch (err) {
      showNotification(null, 'Lỗi kết nối máy chủ');
    }
  };

  const handleDeleteSuggestion = async (id: string) => {
    if (!confirm('Bạn có chắc muốn xóa câu gợi ý này?')) return;
    try {
      const res = await fetch(`/api/admin/review-comment-suggestions/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setReviewSuggestions((prev) => prev.filter((s) => s.id !== id));
        showNotification('✅ Đã xóa câu gợi ý');
      } else {
        showNotification(null, 'Lỗi xóa câu gợi ý');
      }
    } catch (err) {
      showNotification(null, 'Lỗi kết nối máy chủ');
    }
  };

  const handleUpdateFee = async (newFee: number) => {
    try {
      const res = await fetch('/api/admin/config/fee', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platformFeePercent: newFee }),
      });
      const data = await res.json();
      if (res.ok) {
        setPlatformFee(data.platformFeePercent);
        setCustomFeeInput(data.platformFeePercent);
        showNotification(`✅ Đã cập nhật phí sàn thành công: ${data.platformFeePercent}%`);
      } else {
        showNotification(null, data.error || 'Lỗi cập nhật fee sàn');
      }
    } catch (e) {
      showNotification(null, 'Lỗi kết nối');
    }
  };

  const handleApproveWithdrawal = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/withdrawals/${id}/complete`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        showNotification(`✅ Đã duyệt và hoàn tất chuyển tiền cho yêu cầu #${id.toUpperCase()}!`);
        fetchAdminData();
      } else {
        showNotification(null, data.error || 'Lỗi duyệt');
      }
    } catch (e) {
      showNotification(null, 'Lỗi kết nối');
    }
  };

  const handleRejectWithdrawal = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/withdrawals/${id}/reject`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        showNotification(`Đã từ chối và hoàn lại số dư cho CTV.`);
        fetchAdminData();
      } else {
        showNotification(null, data.error || 'Lỗi từ chối');
      }
    } catch (e) {
      showNotification(null, 'Lỗi kết nối');
    }
  };

  useEffect(() => {
    fetchAdminData();
  }, []);

  // Bulk import accounts
  const handleBulkImport = async () => {
    if (!rawAccountsInput.trim()) {
      showNotification(null, 'Vui lòng dán danh sách tài khoản cần nhập kho');
      return;
    }

    setIsImporting(true);
    try {
      const res = await fetch('/api/admin/stock/bulk-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: importProductId,
          variantId: importVariantId,
          rawAccounts: rawAccountsInput,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        const dupText = data.duplicateCount > 0 ? `, bỏ qua ${data.duplicateCount} tài khoản trùng username đã có trong kho` : '';
        showNotification(`✅ Đã nhập thành công ${data.importedCount} tài khoản vào kho${dupText}!`);
        setRawAccountsInput('');
        onRefreshProducts();
        fetchAdminData();
      } else {
        showNotification(null, data.error || 'Lỗi nhập kho');
      }
    } catch (e) {
      showNotification(null, 'Lỗi kết nối tới máy chủ');
    } finally {
      setIsImporting(false);
    }
  };

  // Reads a .txt file the admin selects and merges its lines into the
  // textarea (rather than replacing it) so a file can be combined with
  // accounts already pasted in by hand.
  const handleImportFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const fileText = String(reader.result || '').trim();
      setRawAccountsInput((prev) => (prev.trim() ? prev.trim() + '\n' + fileText : fileText));
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Update user role or balance
  const handleUpdateUser = async (targetUserId: string, newRole?: UserRole, balanceDelta?: number) => {
    try {
      const res = await fetch('/api/admin/users/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId,
          newRole,
          balanceAdjust: balanceDelta,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showNotification(`✅ Cập nhật tài khoản người dùng thành công!`);
        fetchAdminData();
        onRefreshUser();
      } else {
        showNotification(null, data.error || 'Lỗi cập nhật người dùng');
      }
    } catch (e) {
      showNotification(null, 'Lỗi kết nối');
    }
  };

  // Create new user
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim() || !newUserEmail.trim()) {
      showNotification(null, 'Vui lòng điền đầy đủ tên và email');
      return;
    }

    try {
      const res = await fetch('/api/admin/users/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: newUsername.trim(),
          email: newUserEmail.trim(),
          role: newUserRole,
          initialBalance: newUserBalance,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showNotification(`✅ Đã thêm người dùng ${newUsername} thành công!`);
        setShowAddUserModal(false);
        setNewUsername('');
        setNewUserEmail('');
        setNewUserBalance(0);
        fetchAdminData();
      } else {
        showNotification(null, data.error || 'Lỗi thêm người dùng');
      }
    } catch (e) {
      showNotification(null, 'Lỗi máy chủ');
    }
  };

  // Create Category
  const resetCategoryForm = () => {
    setEditingCatId(null);
    setNewCatName('');
    setNewCatSlug('');
    setNewCatDesc('');
    setNewCatIcon('other');
  };

  const handleOpenAddCategory = () => {
    resetCategoryForm();
    setShowAddCatModal(true);
  };

  const handleOpenEditCategory = (cat: any) => {
    setEditingCatId(cat.id);
    setNewCatName(cat.name || '');
    setNewCatSlug(cat.slug || '');
    setNewCatDesc(cat.description || '');
    setNewCatIcon(cat.icon || 'other');
    setShowAddCatModal(true);
  };

  // Create or update a Category — same form, branches on editingCatId
  const handleSubmitCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatName.trim() || !newCatSlug.trim()) {
      showNotification(null, 'Vui lòng nhập tên và slug danh mục');
      return;
    }

    try {
      const isEditing = !!editingCatId;
      const res = await fetch(isEditing ? `/api/admin/categories/${editingCatId}` : '/api/admin/categories', {
        method: isEditing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newCatName.trim(),
          slug: newCatSlug.trim(),
          description: newCatDesc.trim(),
          icon: newCatIcon,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showNotification(isEditing ? `✅ Đã cập nhật danh mục "${newCatName}"!` : `✅ Thêm danh mục "${newCatName}" thành công!`);
        setShowAddCatModal(false);
        resetCategoryForm();
        fetchAdminData();
      } else {
        showNotification(null, data.error || (isEditing ? 'Lỗi cập nhật danh mục' : 'Lỗi thêm danh mục'));
      }
    } catch (e) {
      showNotification(null, 'Lỗi kết nối');
    }
  };

  // Delete Category
  const handleDeleteCategory = async (id: string, name: string) => {
    if (!confirm(`Bạn có chắc muốn xóa danh mục "${name}"?`)) return;
    try {
      const res = await fetch(`/api/admin/categories/${id}`, { method: 'DELETE' });
      if (res.ok) {
        showNotification(`✅ Đã xóa danh mục "${name}"`);
        fetchAdminData();
      }
    } catch (e) {
      showNotification(null, 'Lỗi xóa danh mục');
    }
  };

  const resetProductForm = () => {
    setEditingProdId(null);
    setNewProdName('');
    setNewProdCategory('Twitter / X');
    setNewProdCatSlug('twitter');
    setNewProdPrice(0.5);
    setNewProdImage('twitter');
    setNewProdDescription('');
    setNewProdAccountFormat('');
  };

  const handleOpenAddProduct = () => {
    resetProductForm();
    setShowAddProdModal(true);
  };

  const handleOpenEditProduct = (prod: Product) => {
    setEditingProdId(prod.id);
    setNewProdName(prod.name || '');
    setNewProdCategory(prod.category || 'Twitter / X');
    setNewProdCatSlug(prod.categorySlug || 'twitter');
    setNewProdPrice(prod.price ?? 0.5);
    setNewProdImage(prod.image || 'twitter');
    setNewProdDescription(prod.descriptionHtml || '');
    setNewProdAccountFormat(prod.accountFormat || '');
    setShowAddProdModal(true);
  };

  // Create or update a Product — same form, branches on editingProdId. Editing
  // only touches these summary fields; variants/stock stay managed via the
  // separate stock bulk-import flow.
  const handleSubmitProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProdName.trim()) {
      showNotification(null, 'Vui lòng nhập tên sản phẩm');
      return;
    }

    try {
      const isEditing = !!editingProdId;
      const res = await fetch(isEditing ? `/api/admin/products/${editingProdId}` : '/api/admin/products', {
        method: isEditing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newProdName.trim(),
          category: newProdCategory,
          categorySlug: newProdCatSlug,
          price: newProdPrice,
          image: newProdImage,
          // PUT (edit) is a generic field merge, so it expects the real
          // Product field name; POST (create) destructures "description"
          // specifically — same value, different key per endpoint.
          ...(isEditing
            ? { descriptionHtml: newProdDescription.trim(), accountFormat: newProdAccountFormat.trim() }
            : { description: newProdDescription.trim(), accountFormat: newProdAccountFormat.trim() }),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showNotification(isEditing ? `✅ Đã cập nhật sản phẩm "${newProdName}"!` : `✅ Đã thêm sản phẩm "${newProdName}" thành công!`);
        setShowAddProdModal(false);
        resetProductForm();
        onRefreshProducts();
        fetchAdminData();
      } else {
        showNotification(null, data.error || (isEditing ? 'Lỗi cập nhật sản phẩm' : 'Lỗi thêm sản phẩm'));
      }
    } catch (e) {
      showNotification(null, 'Lỗi máy chủ');
    }
  };

  // Delete Product
  const handleDeleteProduct = async (id: string, name: string) => {
    if (!confirm(`Bạn có chắc muốn xóa sản phẩm "${name}"?`)) return;
    try {
      const res = await fetch(`/api/admin/products/${id}`, { method: 'DELETE' });
      if (res.ok) {
        showNotification(`✅ Đã xóa sản phẩm "${name}"`);
        onRefreshProducts();
        fetchAdminData();
      }
    } catch (e) {
      showNotification(null, 'Lỗi xóa sản phẩm');
    }
  };

  // Toggle a product on/off the storefront without deleting it — reuses the
  // generic field-merge PUT endpoint, same as any other admin product edit.
  const handleToggleProductVisibility = async (prod: Product) => {
    const nextHidden = !prod.isHidden;
    try {
      const res = await fetch(`/api/admin/products/${prod.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isHidden: nextHidden }),
      });
      if (res.ok) {
        showNotification(nextHidden ? `✅ Đã ẩn sản phẩm "${prod.name}"` : `✅ Đã hiện lại sản phẩm "${prod.name}"`);
        onRefreshProducts();
      } else {
        showNotification(null, 'Lỗi cập nhật trạng thái hiển thị');
      }
    } catch (e) {
      showNotification(null, 'Lỗi cập nhật trạng thái hiển thị');
    }
  };

  // Hot Deals shows at most the first 2 products with isHot === true (see
  // HotDeals.tsx) — this is the only place that flag can be set, since the
  // product create/edit form never exposed it.
  const handleToggleProductHot = async (prod: Product) => {
    const nextHot = !prod.isHot;
    try {
      const res = await fetch(`/api/admin/products/${prod.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isHot: nextHot }),
      });
      if (res.ok) {
        showNotification(nextHot ? `✅ Đã thêm "${prod.name}" vào Hot Deals` : `✅ Đã bỏ "${prod.name}" khỏi Hot Deals`);
        onRefreshProducts();
      } else {
        showNotification(null, 'Lỗi cập nhật Hot Deal');
      }
    } catch (e) {
      showNotification(null, 'Lỗi cập nhật Hot Deal');
    }
  };

  // Refunds an order's totalPrice straight back into the buyer's wallet and
  // marks it refunded — money-affecting and not reversible from this UI, so
  // it's gated behind a plain confirm() rather than firing on one click.
  const handleRefundOrder = async (order: Order) => {
    if (!window.confirm(`Hoàn ${formatMoney(order.totalPrice)}$ vào ví "${order.username}" cho đơn #${order.orderCode}?\n\nHành động này không thể hoàn tác.`)) {
      return;
    }
    setRefundingOrderCode(order.orderCode);
    try {
      const res = await fetch(`/api/orders/${order.orderCode}/refund`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        showNotification(`✅ Đã hoàn $${formatMoney(order.totalPrice)} cho đơn #${order.orderCode}`);
        fetchAdminData();
      } else {
        showNotification(null, data.error || 'Lỗi hoàn tiền đơn hàng');
      }
    } catch (e) {
      showNotification(null, 'Lỗi hoàn tiền đơn hàng');
    } finally {
      setRefundingOrderCode(null);
    }
  };

  // Toggle a single variant on/off the storefront (same idea, scoped to one
  // variant of the product rather than the whole listing). Calls
  // refreshAfterVariantChange (defined further down) — safe to reference
  // here since this closure only actually runs on a later click, by which
  // point the whole component body (including that const) has executed.
  const handleToggleVariantVisibility = async (productId: string, variant: ProductVariant) => {
    const nextHidden = !variant.isHidden;
    try {
      const res = await fetch(`/api/admin/products/${productId}/variants/${variant.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isHidden: nextHidden }),
      });
      if (res.ok) {
        showNotification(nextHidden ? `✅ Đã ẩn biến thể "${variant.name}"` : `✅ Đã hiện lại biến thể "${variant.name}"`);
        refreshAfterVariantChange(productId);
      } else {
        showNotification(null, 'Lỗi cập nhật trạng thái hiển thị biến thể');
      }
    } catch (e) {
      showNotification(null, 'Lỗi cập nhật trạng thái hiển thị biến thể');
    }
  };

  const resetVariantForm = () => {
    setEditingVariantId(null);
    setVariantName('');
    setVariantPrice(0.5);
    setVariantOriginalPrice(0);
  };

  const handleOpenVariants = (prod: Product) => {
    setVariantsProduct(prod);
    resetVariantForm();
    setShowVariantsModal(true);
  };

  const handleOpenAddVariant = () => {
    resetVariantForm();
  };

  const handleOpenEditVariant = (v: ProductVariant) => {
    setEditingVariantId(v.id);
    setVariantName(v.name);
    setVariantPrice(v.price);
    setVariantOriginalPrice(v.originalPrice || 0);
  };

  // Re-fetch the product list and, if the variants modal is open, refresh
  // its local copy too so the list reflects the change without reopening.
  const refreshAfterVariantChange = async (productId: string) => {
    onRefreshProducts();
    fetchAdminData();
    try {
      const res = await fetch(`/api/products/${productId}`);
      if (res.ok) {
        const data = await res.json();
        setVariantsProduct(data.product);
      }
    } catch (e) {
      // keep showing the last known variants rather than erroring out
    }
  };

  const handleSubmitVariant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!variantsProduct) return;
    if (!variantName.trim() || variantPrice <= 0) {
      showNotification(null, 'Vui lòng nhập tên và giá biến thể');
      return;
    }

    setIsSavingVariant(true);
    try {
      const isEditing = !!editingVariantId;
      const url = isEditing
        ? `/api/admin/products/${variantsProduct.id}/variants/${editingVariantId}`
        : `/api/admin/products/${variantsProduct.id}/variants`;
      const res = await fetch(url, {
        method: isEditing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: variantName.trim(),
          price: variantPrice,
          originalPrice: variantOriginalPrice > 0 ? variantOriginalPrice : undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showNotification(isEditing ? `✅ Đã cập nhật biến thể "${variantName}"!` : `✅ Đã thêm biến thể "${variantName}"!`);
        resetVariantForm();
        refreshAfterVariantChange(variantsProduct.id);
      } else {
        showNotification(null, data.error || 'Lỗi lưu biến thể');
      }
    } catch (e) {
      showNotification(null, 'Lỗi kết nối máy chủ');
    } finally {
      setIsSavingVariant(false);
    }
  };

  const handleDeleteVariant = async (variantId: string, name: string) => {
    if (!variantsProduct) return;
    if (!confirm(`Bạn có chắc muốn xóa biến thể "${name}"? Tồn kho chưa bán của biến thể này sẽ bị xóa theo.`)) return;
    try {
      const res = await fetch(`/api/admin/products/${variantsProduct.id}/variants/${variantId}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok) {
        showNotification(`✅ Đã xóa biến thể "${name}"`);
        refreshAfterVariantChange(variantsProduct.id);
      } else {
        showNotification(null, data.error || 'Lỗi xóa biến thể');
      }
    } catch (e) {
      showNotification(null, 'Lỗi kết nối máy chủ');
    }
  };

  // Selected product for stock import
  const currentImportProd = products.find((p) => p.id === importProductId) || products[0];

  return (
    <div className="min-h-screen bg-[#f4f6f5] dark:bg-[#17181c] text-slate-900 dark:text-slate-100 pb-16">
      {/* Top Navigation Bar */}
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
              <div className="w-7 h-7 rounded-lg bg-purple-500/20 text-purple-600 dark:text-purple-400 flex items-center justify-center font-bold">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div>
                <h1 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                  <span>Trang Quản Trị Hệ Thống (Admin)</span>
                  <span className="bg-purple-500/30 text-purple-700 dark:text-purple-300 text-[10px] font-bold px-2 py-0.5 rounded border border-purple-500/40 uppercase">
                    Root Access
                  </span>
                </h1>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={fetchAdminData}
              disabled={loading}
              className="flex items-center gap-1 text-xs text-slate-700 dark:text-slate-300 hover:text-slate-900 hover:dark:text-slate-100 bg-[#e7eae9] dark:bg-[#292c33] px-2.5 py-1.5 rounded-lg border border-[#dee1e0] dark:border-[#373b43]"
              title="Làm mới dữ liệu"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-emerald-600 dark:text-emerald-400' : ''}`} />
              <span className="hidden sm:inline">Làm mới</span>
            </button>
          </div>
        </div>
      </div>

      {/* Thông báo dạng "toast" — cố định (fixed) ở góc dưới bên phải màn hình,
          thay vì banner nằm trong luồng nội dung như trước (vốn đẩy cả trang
          xuống mỗi khi có thông báo). "fixed" + "bottom-4 right-4" ghim khối
          này vào góc màn hình bất kể cuộn trang tới đâu; "z-50" đảm bảo nó
          luôn nổi lên trên các phần tử khác. Cả 2 toast (thành công/lỗi) nằm
          chung 1 container "flex flex-col gap-2" để xếp chồng lên nhau gọn
          gàng nếu cả hai cùng xuất hiện một lúc. */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-[90vw] max-w-sm">
        {actionSuccess && (
          <div className="bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-500 text-emerald-700 dark:text-emerald-300 px-4 py-2.5 rounded-xl text-xs flex items-center justify-between shadow-2xl">
            <span>{actionSuccess}</span>
            <button onClick={() => setActionSuccess(null)} className="text-emerald-600 dark:text-emerald-400 hover:text-slate-900 hover:dark:text-slate-100 ml-3">✕</button>
          </div>
        )}
        {actionError && (
          <div className="bg-red-50 dark:bg-red-950/70 border border-red-500 text-red-700 dark:text-red-300 px-4 py-2.5 rounded-xl text-xs flex items-center justify-between shadow-2xl">
            <span>{actionError}</span>
            <button onClick={() => setActionError(null)} className="text-red-600 dark:text-red-400 hover:text-slate-900 hover:dark:text-slate-100 ml-3">✕</button>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <div className="max-w-7xl mx-auto px-4 sm:px-8 mt-6">
        {/* Navigation Tabs — wraps into a compact grid instead of a long
            horizontally-scrolling row, so every section stays one click away. */}
        <div className="grid grid-cols-4 sm:grid-cols-5 lg:grid-cols-10 gap-1.5 border-b border-[#e0e4e2] dark:border-[#33363e] pb-3 mb-6">
          <button
            onClick={() => setActiveTab('overview')}
            title="Tổng Quan & Thống Kê"
            className={`px-2 py-2 text-[11px] font-bold rounded-lg transition flex flex-col items-center gap-1 text-center ${
              activeTab === 'overview'
                ? 'bg-[#e8ebea] dark:bg-[#282a30] text-purple-700 dark:text-purple-300 ring-1 ring-purple-500'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 hover:dark:text-slate-200 hover:bg-[#ecefee] hover:dark:bg-[#222429]'
            }`}
          >
            <Activity className="w-4 h-4" />
            <span className="truncate w-full">Tổng Quan</span>
          </button>

          <button
            onClick={() => setActiveTab('categories')}
            title="Quản Lý Danh Mục"
            className={`px-2 py-2 text-[11px] font-bold rounded-lg transition flex flex-col items-center gap-1 text-center ${
              activeTab === 'categories'
                ? 'bg-[#e8ebea] dark:bg-[#282a30] text-purple-700 dark:text-purple-300 ring-1 ring-purple-500'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 hover:dark:text-slate-200 hover:bg-[#ecefee] hover:dark:bg-[#222429]'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span className="truncate w-full">Danh Mục ({categories.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('products')}
            title="Quản Lý Sản Phẩm"
            className={`px-2 py-2 text-[11px] font-bold rounded-lg transition flex flex-col items-center gap-1 text-center ${
              activeTab === 'products'
                ? 'bg-[#e8ebea] dark:bg-[#282a30] text-purple-700 dark:text-purple-300 ring-1 ring-purple-500'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 hover:dark:text-slate-200 hover:bg-[#ecefee] hover:dark:bg-[#222429]'
            }`}
          >
            <PackagePlus className="w-4 h-4" />
            <span className="truncate w-full">Sản Phẩm ({products.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('users')}
            title="Quản Lý Người Dùng & Quyền"
            className={`px-2 py-2 text-[11px] font-bold rounded-lg transition flex flex-col items-center gap-1 text-center ${
              activeTab === 'users'
                ? 'bg-[#e8ebea] dark:bg-[#282a30] text-purple-700 dark:text-purple-300 ring-1 ring-purple-500'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 hover:dark:text-slate-200 hover:bg-[#ecefee] hover:dark:bg-[#222429]'
            }`}
          >
            <Users className="w-4 h-4" />
            <span className="truncate w-full">Người Dùng ({allUsers.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('inventory')}
            title="Kho Hàng & Nhập Loạt"
            className={`px-2 py-2 text-[11px] font-bold rounded-lg transition flex flex-col items-center gap-1 text-center ${
              activeTab === 'inventory'
                ? 'bg-[#e8ebea] dark:bg-[#282a30] text-purple-700 dark:text-purple-300 ring-1 ring-purple-500'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 hover:dark:text-slate-200 hover:bg-[#ecefee] hover:dark:bg-[#222429]'
            }`}
          >
            <Database className="w-4 h-4" />
            <span className="truncate w-full">Kho Hàng</span>
          </button>

          <button
            onClick={() => setActiveTab('orders')}
            title="Quản Lý Đơn Hàng"
            className={`px-2 py-2 text-[11px] font-bold rounded-lg transition flex flex-col items-center gap-1 text-center ${
              activeTab === 'orders'
                ? 'bg-[#e8ebea] dark:bg-[#282a30] text-purple-700 dark:text-purple-300 ring-1 ring-purple-500'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 hover:dark:text-slate-200 hover:bg-[#ecefee] hover:dark:bg-[#222429]'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span className="truncate w-full">Đơn Hàng ({allOrders.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('rpc')}
            title="Cổng Nạp RPC Đa Chuỗi"
            className={`px-2 py-2 text-[11px] font-bold rounded-lg transition flex flex-col items-center gap-1 text-center ${
              activeTab === 'rpc'
                ? 'bg-[#e8ebea] dark:bg-[#282a30] text-purple-700 dark:text-purple-300 ring-1 ring-purple-500'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 hover:dark:text-slate-200 hover:bg-[#ecefee] hover:dark:bg-[#222429]'
            }`}
          >
            <Server className="w-4 h-4" />
            <span className="truncate w-full">Cổng RPC</span>
          </button>

          <button
            onClick={() => setActiveTab('ctv-fee')}
            title="Cấu Hình Fee Sàn & Rút Tiền CTV"
            className={`px-2 py-2 text-[11px] font-bold rounded-lg transition flex flex-col items-center gap-1 text-center ${
              activeTab === 'ctv-fee'
                ? 'bg-[#e8ebea] dark:bg-[#282a30] text-amber-700 dark:text-amber-300 ring-1 ring-amber-500'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 hover:dark:text-slate-200 hover:bg-[#ecefee] hover:dark:bg-[#222429]'
            }`}
          >
            <Percent className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            <span className="truncate w-full">Fee & Rút Tiền ({adminWithdrawals.filter((w) => w.status === 'pending').length})</span>
          </button>

          <button
            onClick={() => setActiveTab('vouchers')}
            title="Mã Giảm Giá"
            className={`px-2 py-2 text-[11px] font-bold rounded-lg transition flex flex-col items-center gap-1 text-center ${
              activeTab === 'vouchers'
                ? 'bg-[#e8ebea] dark:bg-[#282a30] text-purple-700 dark:text-purple-300 ring-1 ring-purple-500'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 hover:dark:text-slate-200 hover:bg-[#ecefee] hover:dark:bg-[#222429]'
            }`}
          >
            <Ticket className="w-4 h-4" />
            <span className="truncate w-full">Mã Giảm Giá ({vouchers.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('reviews')}
            title="Đánh Giá Sản Phẩm"
            className={`px-2 py-2 text-[11px] font-bold rounded-lg transition flex flex-col items-center gap-1 text-center ${
              activeTab === 'reviews'
                ? 'bg-[#e8ebea] dark:bg-[#282a30] text-amber-700 dark:text-amber-300 ring-1 ring-amber-500'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 hover:dark:text-slate-200 hover:bg-[#ecefee] hover:dark:bg-[#222429]'
            }`}
          >
            <Star className="w-4 h-4" />
            <span className="truncate w-full">Đánh Giá ({productReviews.length})</span>
          </button>
        </div>

        {/* TAB 1: OVERVIEW & FULL STATS */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Stat Cards Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
              <div className="bg-[#eceeed] dark:bg-[#23252a] border border-[#dde2e0] dark:border-[#373b43] rounded-xl p-4 shadow-sm">
                <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400 mb-1">
                  <span>Tổng Doanh Thu</span>
                  <DollarSign className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="text-xl sm:text-2xl font-black text-emerald-600 dark:text-emerald-400 font-mono">
                  ${stats?.totalRevenue !== undefined ? formatMoney(stats.totalRevenue) : '0.00'}
                </div>
                <div className="text-[11px] text-emerald-500 mt-1 flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" /> Tự động cộng qua RPC
                </div>
              </div>

              <div className="bg-[#eceeed] dark:bg-[#23252a] border border-[#dde2e0] dark:border-[#373b43] rounded-xl p-4 shadow-sm">
                <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400 mb-1">
                  <span>Tổng Đơn Hàng</span>
                  <FileText className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="text-xl sm:text-2xl font-black text-slate-900 dark:text-slate-100 font-mono">
                  {stats?.totalOrders || 0}
                </div>
                <div className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1">Giao dịch thành công</div>
              </div>

              <div className="bg-[#eceeed] dark:bg-[#23252a] border border-[#dde2e0] dark:border-[#373b43] rounded-xl p-4 shadow-sm">
                <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400 mb-1">
                  <span>Tài Khoản Trong Kho</span>
                  <Database className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="text-xl sm:text-2xl font-black text-amber-600 dark:text-amber-400 font-mono">
                  {stats?.totalStock || 0}
                </div>
                <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">Sẵn sàng xuất kho</div>
              </div>

              <div className="bg-[#eceeed] dark:bg-[#23252a] border border-[#dde2e0] dark:border-[#373b43] rounded-xl p-4 shadow-sm">
                <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400 mb-1">
                  <span>Đã Xuất Bán</span>
                  <Check className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                </div>
                <div className="text-xl sm:text-2xl font-black text-purple-600 dark:text-purple-400 font-mono">
                  {stats?.totalSold || 0}
                </div>
                <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">Đã bàn giao khách</div>
              </div>

              <div className="bg-[#eceeed] dark:bg-[#23252a] border border-[#dde2e0] dark:border-[#373b43] rounded-xl p-4 shadow-sm">
                <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400 mb-1">
                  <span>Tổng Thành Viên</span>
                  <Users className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="text-xl sm:text-2xl font-black text-emerald-600 dark:text-emerald-400 font-mono">
                  {allUsers.length}
                </div>
                <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">
                  {allUsers.filter((u) => u.role === 'ctv').length} CTV | {allUsers.filter((u) => u.role === 'admin').length} Admin
                </div>
              </div>

              <div className="bg-[#eceeed] dark:bg-[#23252a] border border-[#dde2e0] dark:border-[#373b43] rounded-xl p-4 shadow-sm">
                <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400 mb-1">
                  <span>Đang Online</span>
                  <Activity className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="text-xl sm:text-2xl font-black text-emerald-600 dark:text-emerald-400 font-mono flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                  </span>
                  {onlineCount ?? '—'}
                </div>
                <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">Trong 60 giây gần nhất</div>
              </div>
            </div>

            {/* Chart Stats */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-[#eceeed] dark:bg-[#23252a] border border-[#dde2e0] dark:border-[#373b43] rounded-xl p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    <span>Doanh Thu</span>
                  </h3>
                  {/* Chuyển giữa 3 khoảng thời gian thống kê — chỉ gọi lại
                      API biểu đồ, không tải lại toàn bộ dữ liệu trang admin */}
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

              <div className="bg-[#eceeed] dark:bg-[#23252a] border border-[#dde2e0] dark:border-[#373b43] rounded-xl p-4 shadow-sm">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2 mb-3">
                  <BarChart3 className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                  <span>Top 5 Sản Phẩm Bán Chạy (Doanh Thu)</span>
                </h3>
                <SimpleBarChart
                  data={chartTopProducts.map((p): BarChartDatum => ({
                    label: p.name.length > 14 ? p.name.slice(0, 14) + '…' : p.name,
                    value: p.revenue,
                  }))}
                  colorClass="bg-purple-500"
                  formatValue={(v) => `$${formatMoney(v)}`}
                />
              </div>
            </div>

            {/* Blockchain RPC Gateway Monitor Banner */}
            <div className="bg-[#eceeed] dark:bg-[#23252a] border border-emerald-500/30 rounded-xl p-4 shadow-md">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Server className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span>Trạng Thái Cổng Quét RPC Chuỗi Khối (Tự Động 24/7)</span>
                </h3>
                <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-semibold">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  ONLINE
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {cryptoDepositOptions.filter((o) => !o.isHidden).map((opt) => (
                  <div key={opt.id} className="bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#e1e5e4] dark:border-[#32353d] p-3 rounded-lg text-xs space-y-1">
                    <div className="flex items-center justify-between font-bold">
                      <span className="text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                        <span>{opt.icon}</span> {opt.networkLabel}
                      </span>
                      <span className="text-emerald-600 dark:text-emerald-400 font-mono text-[10px] bg-emerald-950 px-1.5 py-0.5 rounded border border-emerald-500/30">
                        Active
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-600 dark:text-slate-400 truncate">Token: {opt.token}</div>
                    <div className="text-[10px] text-slate-600 dark:text-slate-400 font-mono truncate" title={opt.contractAddress}>
                      Contract: {opt.contractAddress}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Quick Actions Shortcuts */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <button
                onClick={() => setActiveTab('inventory')}
                className="p-4 bg-[#ecefee] dark:bg-[#222429] hover:bg-[#e6e9e8] hover:dark:bg-[#2b2e34] border border-[#dfe3e2] dark:border-[#353840] hover:border-emerald-500/40 rounded-xl text-left transition flex items-center gap-3"
              >
                <div className="w-10 h-10 rounded-lg bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold">
                  <PackagePlus className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-900 dark:text-slate-100">Bổ Sung Kho Tài Khoản</div>
                  <div className="text-[11px] text-slate-600 dark:text-slate-400">Dán danh sách UID|Pass nhập kho ngay</div>
                </div>
              </button>

              <button
                onClick={() => setActiveTab('categories')}
                className="p-4 bg-[#ecefee] dark:bg-[#222429] hover:bg-[#e6e9e8] hover:dark:bg-[#2b2e34] border border-[#dfe3e2] dark:border-[#353840] hover:border-purple-500/40 rounded-xl text-left transition flex items-center gap-3"
              >
                <div className="w-10 h-10 rounded-lg bg-purple-500/20 text-purple-600 dark:text-purple-400 flex items-center justify-center font-bold">
                  <Layers className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-900 dark:text-slate-100">Quản Lý Danh Mục Hàng</div>
                  <div className="text-[11px] text-slate-600 dark:text-slate-400">Thêm, sửa, sắp xếp các danh mục sản phẩm</div>
                </div>
              </button>

              <button
                onClick={() => setActiveTab('users')}
                className="p-4 bg-[#ecefee] dark:bg-[#222429] hover:bg-[#e6e9e8] hover:dark:bg-[#2b2e34] border border-[#dfe3e2] dark:border-[#353840] hover:border-amber-500/40 rounded-xl text-left transition flex items-center gap-3"
              >
                <div className="w-10 h-10 rounded-lg bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-900 dark:text-slate-100">Phân Quyền CTV & Admin</div>
                  <div className="text-[11px] text-slate-600 dark:text-slate-400">Gán chiết khấu sỉ, chỉnh sửa số dư</div>
                </div>
              </button>
            </div>
          </div>
        )}

        {/* TAB 2: CATEGORIES MANAGEMENT */}
        {activeTab === 'categories' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Danh Mục Sản Phẩm</h2>
                <p className="text-xs text-slate-600 dark:text-slate-400">Quản lý các nhóm danh mục hiển thị ngoài trang chủ</p>
              </div>
              <button
                onClick={handleOpenAddCategory}
                className="bg-purple-600 hover:bg-purple-500 text-slate-900 dark:text-slate-100 font-bold text-xs px-3.5 py-2 rounded-lg flex items-center gap-1.5 transition shadow"
              >
                <PlusCircle className="w-4 h-4" />
                <span>Thêm danh mục mới</span>
              </button>
            </div>

            {/* Categories Table */}
            <div className="bg-[#eceeed] dark:bg-[#23252a] border border-[#dde2e0] dark:border-[#373b43] rounded-xl overflow-hidden shadow">
              <div className="overflow-x-auto">
              <table className="w-full text-left text-xs min-w-[640px]">
                <thead className="bg-[#eff2f1] dark:bg-[#1d1f24] text-slate-600 dark:text-slate-400 border-b border-[#dde2e0] dark:border-[#373b43]">
                  <tr>
                    <th className="p-3">Biểu tượng</th>
                    <th className="p-3">Tên danh mục</th>
                    <th className="p-3">Slug (Đường dẫn)</th>
                    <th className="p-3">Mô tả</th>
                    <th className="p-3">Số sản phẩm</th>
                    <th className="p-3 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e4e8e7]">
                  {categories.map((cat) => {
                    const count = products.filter((p) => p.categorySlug === cat.slug).length;
                    return (
                      <tr key={cat.id} className="hover:bg-[#e6eae9] hover:dark:bg-[#2a2d34] transition">
                        <td className="p-3">
                          <span className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold">
                            {cat.name.slice(0, 1).toUpperCase()}
                          </span>
                        </td>
                        <td className="p-3 font-semibold text-slate-800 dark:text-slate-200">{cat.name}</td>
                        <td className="p-3 font-mono text-emerald-600 dark:text-emerald-400">{cat.slug}</td>
                        <td className="p-3 text-slate-600 dark:text-slate-400 text-[11px] max-w-xs truncate">
                          {cat.description || 'Chưa có mô tả'}
                        </td>
                        <td className="p-3">
                          <span className="bg-[#e5e9e8] dark:bg-[#2c2f35] text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded text-[11px] font-mono">
                            {count} sản phẩm
                          </span>
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => handleOpenEditCategory(cat)}
                              className="p-1 text-slate-600 dark:text-slate-400 hover:text-purple-600 hover:dark:text-purple-400 hover:bg-purple-50 hover:dark:bg-purple-950/70 rounded transition"
                              title="Sửa danh mục"
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDeleteCategory(cat.id, cat.name)}
                              className="p-1 text-red-600 dark:text-red-400 hover:text-red-700 hover:dark:text-red-300 hover:bg-red-50 hover:dark:bg-red-950/70 rounded transition"
                              title="Xóa danh mục"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </div>

            {/* Modal Add Category */}
            {showAddCatModal && (
              <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                <div className="bg-[#eceeed] dark:bg-[#23252a] border border-purple-500/50 rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
                  <div className="flex items-center justify-between pb-2 border-b border-[#e0e4e2] dark:border-[#33363e]">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                      {editingCatId ? <Edit3 className="w-4 h-4 text-purple-600 dark:text-purple-400" /> : <FolderPlus className="w-4 h-4 text-purple-600 dark:text-purple-400" />}
                      <span>{editingCatId ? 'Sửa Danh Mục' : 'Tạo Danh Mục Mới'}</span>
                    </h3>
                    <button onClick={() => { setShowAddCatModal(false); resetCategoryForm(); }} className="text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:dark:text-slate-100">✕</button>
                  </div>

                  <form onSubmit={handleSubmitCategory} className="space-y-3 text-xs">
                    <div>
                      <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Tên danh mục:</label>
                      <input
                        type="text"
                        value={newCatName}
                        onChange={(e) => {
                          setNewCatName(e.target.value);
                          if (!editingCatId) {
                            setNewCatSlug(e.target.value.toLowerCase().trim().replace(/[^a-z0-9]/g, '-'));
                          }
                        }}
                        placeholder="Ví dụ: TikTok Clone, Telegram..."
                        className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 focus:border-purple-500 focus:outline-none"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Slug (Định danh URL):</label>
                      <input
                        type="text"
                        value={newCatSlug}
                        onChange={(e) => setNewCatSlug(e.target.value)}
                        placeholder="tiktok-clone"
                        className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 font-mono focus:border-purple-500 focus:outline-none"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Mô tả ngắn:</label>
                      <input
                        type="text"
                        value={newCatDesc}
                        onChange={(e) => setNewCatDesc(e.target.value)}
                        placeholder="Mô tả chất lượng, bảo hành..."
                        className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 focus:border-purple-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Logo danh mục:</label>
                      <select
                        value={newCatIcon}
                        onChange={(e) => setNewCatIcon(e.target.value)}
                        className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-2 py-2 text-slate-800 dark:text-slate-200"
                      >
                        <option value="twitter">Twitter / X</option>
                        <option value="facebook">Facebook</option>
                        <option value="gmail">Gmail</option>
                        <option value="hotmail">Hotmail / Outlook</option>
                        <option value="instagram">Instagram</option>
                        <option value="discord">Discord</option>
                        <option value="tiktok">TikTok</option>
                        <option value="telegram">Telegram</option>
                        <option value="tool">Tool / Proxy</option>
                        <option value="other">Khác (mặc định)</option>
                      </select>
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => { setShowAddCatModal(false); resetCategoryForm(); }}
                        className="px-4 py-2 bg-[#e5e8e7] dark:bg-[#2d3036] hover:bg-[#dde1e0] hover:dark:bg-[#373b44] text-slate-700 dark:text-slate-300 rounded-lg"
                      >
                        Hủy
                      </button>
                      <button
                        type="submit"
                        className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-slate-900 dark:text-slate-100 font-bold rounded-lg"
                      >
                        {editingCatId ? 'Cập Nhật Danh Mục' : 'Lưu Danh Mục'}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: PRODUCTS MANAGEMENT */}
        {activeTab === 'products' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Quản Lý Sản Phẩm & Biến Thể</h2>
                <p className="text-xs text-slate-600 dark:text-slate-400">Danh sách sản phẩm tài khoản số đang bày bán</p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative flex-1 min-w-[140px]">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-600 dark:text-slate-400" />
                  <input
                    type="text"
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    placeholder="Tìm sản phẩm..."
                    className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-purple-500"
                  />
                </div>
                <button
                  onClick={handleOpenAddProduct}
                  className="bg-purple-600 hover:bg-purple-500 text-slate-900 dark:text-slate-100 font-bold text-xs px-3.5 py-2 rounded-lg flex items-center gap-1.5 transition shadow"
                >
                  <PlusCircle className="w-4 h-4" />
                  <span>Thêm sản phẩm</span>
                </button>
              </div>
            </div>

            {/* Products Table */}
            <div className="bg-[#eceeed] dark:bg-[#23252a] border border-[#dde2e0] dark:border-[#373b43] rounded-xl overflow-hidden shadow">
              <div className="overflow-x-auto">
              <table className="w-full text-left text-xs min-w-[640px]">
                <thead className="bg-[#eff2f1] dark:bg-[#1d1f24] text-slate-600 dark:text-slate-400 border-b border-[#dde2e0] dark:border-[#373b43]">
                  <tr>
                    <th className="p-3">Sản phẩm</th>
                    <th className="p-3">Danh mục</th>
                    <th className="p-3">Giá bán</th>
                    <th className="p-3">Biến thể (Loại)</th>
                    <th className="p-3">Tổng tồn kho</th>
                    <th className="p-3">Người bán</th>
                    <th className="p-3 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e4e8e7]">
                  {products
                    .filter((p) => !productSearch || p.name.toLowerCase().includes(productSearch.toLowerCase()))
                    .map((prod) => {
                      const totalStock = prod.variants.reduce((sum, v) => sum + v.stockCount, 0);
                      return (
                        <tr key={prod.id} className="hover:bg-[#e6eae9] hover:dark:bg-[#2a2d34] transition">
                          <td className="p-3">
                            <div className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                              {prod.name}
                              {prod.isHidden && (
                                <span className="text-[10px] bg-slate-500/20 text-slate-600 dark:text-slate-400 border border-slate-500/30 px-1.5 py-0.5 rounded font-normal">
                                  Đã ẩn
                                </span>
                              )}
                            </div>
                            {/* badge is computed and saved server-side on every price edit — read it as-is */}
                            {prod.badge && (
                              <span className="text-[10px] bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/30 px-1 rounded">
                                {prod.badge}
                              </span>
                            )}
                          </td>
                          <td className="p-3">
                            <span className="bg-[#e5e8e7] dark:bg-[#2d3036] text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded text-[11px]">
                              {prod.category}
                            </span>
                          </td>
                          <td className="p-3 font-mono font-bold text-amber-600 dark:text-amber-400">
                            ${formatMoney(prod.price)}
                          </td>
                          <td className="p-3 text-slate-700 dark:text-slate-300">
                            {prod.variants.length} loại
                          </td>
                          <td className="p-3 font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
                            {totalStock.toLocaleString()}
                          </td>
                          <td className="p-3 text-slate-600 dark:text-slate-400">
                            {prod.seller.name}
                          </td>
                          <td className="p-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => handleToggleProductVisibility(prod)}
                                className={`p-1 rounded transition ${
                                  prod.isHidden
                                    ? 'text-slate-500 dark:text-slate-500 hover:text-emerald-600 hover:dark:text-emerald-400 hover:bg-emerald-50 hover:dark:bg-emerald-950/70'
                                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 hover:dark:text-slate-200 hover:bg-slate-100 hover:dark:bg-slate-800/70'
                                }`}
                                title={prod.isHidden ? 'Hiện lại sản phẩm' : 'Ẩn sản phẩm khỏi cửa hàng'}
                              >
                                {prod.isHidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                              </button>
                              <button
                                onClick={() => handleToggleProductHot(prod)}
                                className={`p-1 rounded transition ${
                                  prod.isHot
                                    ? 'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/70'
                                    : 'text-slate-600 dark:text-slate-400 hover:text-orange-600 hover:dark:text-orange-400 hover:bg-orange-50 hover:dark:bg-orange-950/70'
                                }`}
                                title={prod.isHot ? 'Bỏ khỏi Hot Deals' : 'Thêm vào Hot Deals (tối đa 2 sản phẩm hiện cùng lúc)'}
                              >
                                <Flame className="w-4 h-4" fill={prod.isHot ? 'currentColor' : 'none'} />
                              </button>
                              <button
                                onClick={() => handleOpenVariants(prod)}
                                className="p-1 text-slate-600 dark:text-slate-400 hover:text-amber-600 hover:dark:text-amber-400 hover:bg-amber-50 hover:dark:bg-amber-950/70 rounded transition"
                                title="Quản lý biến thể"
                              >
                                <Boxes className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleOpenEditProduct(prod)}
                                className="p-1 text-slate-600 dark:text-slate-400 hover:text-purple-600 hover:dark:text-purple-400 hover:bg-purple-50 hover:dark:bg-purple-950/70 rounded transition"
                                title="Sửa sản phẩm"
                              >
                                <Edit3 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDeleteProduct(prod.id, prod.name)}
                                className="p-1 text-red-600 dark:text-red-400 hover:text-red-700 hover:dark:text-red-300 hover:bg-red-50 hover:dark:bg-red-950/70 rounded transition"
                                title="Xóa sản phẩm"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
              </div>
            </div>

            {/* Modal Add Product */}
            {showAddProdModal && (
              <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                <div className="bg-[#eceeed] dark:bg-[#23252a] border border-purple-500/50 rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
                  <div className="flex items-center justify-between pb-2 border-b border-[#e0e4e2] dark:border-[#33363e]">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                      {editingProdId ? <Edit3 className="w-4 h-4 text-purple-600 dark:text-purple-400" /> : <PlusCircle className="w-4 h-4 text-purple-600 dark:text-purple-400" />}
                      <span>{editingProdId ? 'Sửa Sản Phẩm' : 'Thêm Sản Phẩm Mới'}</span>
                    </h3>
                    <button onClick={() => { setShowAddProdModal(false); resetProductForm(); }} className="text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:dark:text-slate-100">✕</button>
                  </div>

                  <form onSubmit={handleSubmitProduct} className="space-y-3 text-xs">
                    <div>
                      <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Tên sản phẩm:</label>
                      <input
                        type="text"
                        value={newProdName}
                        onChange={(e) => setNewProdName(e.target.value)}
                        placeholder="Ví dụ: Tài khoản Telegram Premium..."
                        className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 focus:border-purple-500 focus:outline-none"
                        required
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Danh mục:</label>
                        <select
                          value={newProdCatSlug}
                          onChange={(e) => {
                            setNewProdCatSlug(e.target.value);
                            const matched = categories.find((c) => c.slug === e.target.value);
                            if (matched) setNewProdCategory(matched.name);
                          }}
                          className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-2 py-2 text-slate-800 dark:text-slate-200 focus:border-purple-500"
                        >
                          {categories.map((c) => (
                            <option key={c.slug} value={c.slug}>{c.name}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Giá cơ bản ($):</label>
                        <input
                          type="number"
                          step="0.001"
                          value={newProdPrice}
                          onChange={(e) => setNewProdPrice(Number(e.target.value))}
                          className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 font-mono focus:border-purple-500 focus:outline-none"
                          required
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Loại biểu tượng:</label>
                      <select
                        value={newProdImage}
                        onChange={(e) => setNewProdImage(e.target.value)}
                        className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-2 py-2 text-slate-800 dark:text-slate-200"
                      >
                        <option value="twitter">Twitter / X</option>
                        <option value="facebook">Facebook</option>
                        <option value="gmail">Gmail</option>
                        <option value="instagram">Instagram</option>
                        <option value="discord">Discord</option>
                        <option value="kling">AI Tool (Kling)</option>
                        <option value="other">Khác</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Mô tả sản phẩm & chính sách bảo hành:</label>
                      <textarea
                        rows={2}
                        placeholder="Ví dụ: Acc ngâm kỹ, IP sạch, bảo hành sai pass 1 đổi 1 trong 24h đầu."
                        value={newProdDescription}
                        onChange={(e) => setNewProdDescription(e.target.value)}
                        className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg p-2.5 text-slate-800 dark:text-slate-200 focus:border-purple-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Định dạng tài khoản (hiện cho khách xem):</label>
                      <input
                        type="text"
                        placeholder="Ví dụ: UID | Password | 2FA | Email | Email Pass | Cookie"
                        value={newProdAccountFormat}
                        onChange={(e) => setNewProdAccountFormat(e.target.value)}
                        className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 font-mono text-[11px] focus:border-purple-500 focus:outline-none"
                      />
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => { setShowAddProdModal(false); resetProductForm(); }}
                        className="px-4 py-2 bg-[#e5e8e7] dark:bg-[#2d3036] hover:bg-[#dde1e0] hover:dark:bg-[#373b44] text-slate-700 dark:text-slate-300 rounded-lg"
                      >
                        Hủy
                      </button>
                      <button
                        type="submit"
                        className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-slate-900 dark:text-slate-100 font-bold rounded-lg"
                      >
                        {editingProdId ? 'Cập Nhật Sản Phẩm' : 'Tạo Sản Phẩm'}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* Modal: Manage Variants — linked to variantsProduct, full add/edit/delete */}
            {showVariantsModal && variantsProduct && (
              <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                <div className="bg-[#eceeed] dark:bg-[#23252a] border border-amber-500/50 rounded-2xl max-w-2xl w-full p-5 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
                  <div className="flex items-center justify-between pb-2 border-b border-[#e0e4e2] dark:border-[#33363e]">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                      <Boxes className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                      <span>Biến Thể Của "{variantsProduct.name}"</span>
                    </h3>
                    <button
                      onClick={() => { setShowVariantsModal(false); setVariantsProduct(null); resetVariantForm(); }}
                      className="text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:dark:text-slate-100"
                    >
                      ✕
                    </button>
                  </div>

                  {/* Existing variants list */}
                  <div className="bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee2e0] dark:border-[#363a43] rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
              <table className="w-full text-left text-xs min-w-[640px]">
                      <thead className="bg-[#e9ece9] dark:bg-[#17191d] text-slate-600 dark:text-slate-400 border-b border-[#dee2e0] dark:border-[#363a43]">
                        <tr>
                          <th className="p-2.5">Tên biến thể</th>
                          <th className="p-2.5">Giá</th>
                          <th className="p-2.5">Giá gốc</th>
                          <th className="p-2.5">Badge</th>
                          <th className="p-2.5">Tồn kho</th>
                          <th className="p-2.5 text-right">Thao tác</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#dee2e0] dark:divide-[#363a43]">
                        {variantsProduct.variants.map((v) => {
                          return (
                          <tr key={v.id} className={`hover:bg-[#e6eae9] hover:dark:bg-[#2a2d34] transition ${editingVariantId === v.id ? 'bg-amber-500/10' : ''}`}>
                            <td className="p-2.5 font-semibold text-slate-800 dark:text-slate-200">
                              <span className="flex items-center gap-1.5">
                                {v.name}
                                {v.isHidden && (
                                  <span className="text-[10px] bg-slate-500/20 text-slate-600 dark:text-slate-400 border border-slate-500/30 px-1.5 py-0.5 rounded font-normal">
                                    Đã ẩn
                                  </span>
                                )}
                              </span>
                            </td>
                            <td className="p-2.5 font-mono text-amber-600 dark:text-amber-400 font-bold">${formatMoney(v.price)}</td>
                            <td className="p-2.5 font-mono text-slate-600 dark:text-slate-400">{v.originalPrice ? `$${formatMoney(v.originalPrice)}` : '—'}</td>
                            {/* discountBadge is computed and saved server-side on every price edit — read it as-is */}
                            <td className="p-2.5 text-slate-600 dark:text-slate-400">{v.discountBadge || '—'}</td>
                            <td className="p-2.5 font-mono text-emerald-600 dark:text-emerald-400 font-semibold">{v.stockCount.toLocaleString()}</td>
                            <td className="p-2.5 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  onClick={() => handleToggleVariantVisibility(variantsProduct.id, v)}
                                  className={`p-1 rounded transition ${
                                    v.isHidden
                                      ? 'text-slate-500 dark:text-slate-500 hover:text-emerald-600 hover:dark:text-emerald-400 hover:bg-emerald-50 hover:dark:bg-emerald-950/70'
                                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 hover:dark:text-slate-200 hover:bg-slate-100 hover:dark:bg-slate-800/70'
                                  }`}
                                  title={v.isHidden ? 'Hiện lại biến thể' : 'Ẩn biến thể khỏi cửa hàng'}
                                >
                                  {v.isHidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                </button>
                                <button
                                  onClick={() => handleOpenEditVariant(v)}
                                  className="p-1 text-slate-600 dark:text-slate-400 hover:text-purple-600 hover:dark:text-purple-400 hover:bg-purple-50 hover:dark:bg-purple-950/70 rounded transition"
                                  title="Sửa biến thể"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => handleDeleteVariant(v.id, v.name)}
                                  disabled={variantsProduct.variants.length <= 1}
                                  className="p-1 text-red-600 dark:text-red-400 hover:text-red-700 hover:dark:text-red-300 hover:bg-red-50 hover:dark:bg-red-950/70 rounded transition disabled:opacity-30 disabled:cursor-not-allowed"
                                  title={variantsProduct.variants.length <= 1 ? 'Sản phẩm phải còn ít nhất 1 biến thể' : 'Xóa biến thể'}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
              </div>
                  </div>

                  {/* Add / Edit variant form */}
                  <form onSubmit={handleSubmitVariant} className="space-y-3 text-xs border-t border-[#e0e4e2] dark:border-[#33363e] pt-3">
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold text-slate-800 dark:text-slate-200">
                        {editingVariantId ? 'Sửa Biến Thể' : 'Thêm Biến Thể Mới'}
                      </h4>
                      {editingVariantId && (
                        <button type="button" onClick={handleOpenAddVariant} className="text-[11px] text-amber-600 dark:text-amber-400 hover:underline">
                          + Thêm mới thay vì sửa
                        </button>
                      )}
                    </div>

                    <div>
                      <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Tên biến thể:</label>
                      <input
                        type="text"
                        value={variantName}
                        onChange={(e) => setVariantName(e.target.value)}
                        placeholder="Ví dụ: Tài khoản kèm Hotmail, 50+ Follow..."
                        className="w-full bg-[#f5f6f6] dark:bg-[#16181b] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 focus:border-amber-500 focus:outline-none"
                        required
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Giá bán ($):</label>
                        <input
                          type="number"
                          step="0.001"
                          min="0.001"
                          value={variantPrice}
                          onChange={(e) => setVariantPrice(Number(e.target.value))}
                          className="w-full bg-[#f5f6f6] dark:bg-[#16181b] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 font-mono focus:border-amber-500 focus:outline-none"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Giá gốc ($, tùy chọn):</label>
                        <input
                          type="number"
                          step="0.001"
                          min="0"
                          value={variantOriginalPrice}
                          onChange={(e) => setVariantOriginalPrice(Number(e.target.value))}
                          className="w-full bg-[#f5f6f6] dark:bg-[#16181b] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 font-mono focus:border-amber-500 focus:outline-none"
                        />
                      </div>
                    </div>

                    <p className="text-[10px] text-slate-500 dark:text-slate-500">
                      Badge giảm giá được tự tính từ giá bán/giá gốc và lưu vào database — không cần nhập tay. Tồn kho được nạp riêng ở tab "Kho Hàng & Nhập Loạt" sau khi tạo biến thể.
                    </p>

                    <div className="flex justify-end gap-2 pt-1">
                      {editingVariantId && (
                        <button
                          type="button"
                          onClick={resetVariantForm}
                          className="px-4 py-2 bg-[#e5e8e7] dark:bg-[#2d3036] hover:bg-[#dde1e0] hover:dark:bg-[#373b44] text-slate-700 dark:text-slate-300 rounded-lg"
                        >
                          Hủy
                        </button>
                      )}
                      <button
                        type="submit"
                        disabled={isSavingVariant}
                        className="px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold rounded-lg transition"
                      >
                        {isSavingVariant ? 'Đang lưu...' : editingVariantId ? 'Cập Nhật Biến Thể' : 'Thêm Biến Thể'}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: USERS & ROLE MANAGEMENT */}
        {activeTab === 'users' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Quản Lý Người Dùng & Phân Quyền</h2>
                <p className="text-xs text-slate-600 dark:text-slate-400">Phân quyền CTV (chiết khấu sỉ), Admin, hoặc nạp/trừ số dư</p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative flex-1 min-w-[140px]">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-600 dark:text-slate-400" />
                  <input
                    type="text"
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder="Tìm tên/email..."
                    className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-purple-500"
                  />
                </div>
                <button
                  onClick={() => setShowAddUserModal(true)}
                  className="bg-purple-600 hover:bg-purple-500 text-slate-900 dark:text-slate-100 font-bold text-xs px-3.5 py-2 rounded-lg flex items-center gap-1.5 transition shadow"
                >
                  <PlusCircle className="w-4 h-4" />
                  <span>Thêm người dùng</span>
                </button>
              </div>
            </div>

            {(() => {
              const filteredUsers = allUsers.filter(
                (u) => !userSearch || u.username.toLowerCase().includes(userSearch.toLowerCase()) || u.email.toLowerCase().includes(userSearch.toLowerCase())
              );
              const usersTotalPages = Math.max(1, Math.ceil(filteredUsers.length / USERS_PER_PAGE));
              const pagedUsers = filteredUsers.slice((usersPage - 1) * USERS_PER_PAGE, usersPage * USERS_PER_PAGE);
              return (
                <>
            <div className="bg-[#eceeed] dark:bg-[#23252a] border border-[#dde2e0] dark:border-[#373b43] rounded-xl overflow-hidden shadow">
              <div className="overflow-x-auto">
              <table className="w-full text-left text-xs min-w-[640px]">
                <thead className="bg-[#eff2f1] dark:bg-[#1d1f24] text-slate-600 dark:text-slate-400 border-b border-[#dde2e0] dark:border-[#373b43]">
                  <tr>
                    <th className="p-3">Tài khoản</th>
                    <th className="p-3">Email</th>
                    <th className="p-3">Quyền hạn</th>
                    <th className="p-3">Số dư ví</th>
                    <th className="p-3">Chiết khấu</th>
                    <th className="p-3">Địa chỉ ví BSC (Riêng biệt)</th>
                    <th className="p-3 text-right">Hành động</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e4e8e7]">
                  {pagedUsers.map((usr) => (
                      <tr key={usr.id} className="hover:bg-[#e6eae9] hover:dark:bg-[#2a2d34] transition">
                        <td className="p-3">
                          <div className="font-bold text-slate-900 dark:text-slate-100">{usr.username}</div>
                          <div className="text-[10px] text-slate-600 dark:text-slate-400 font-mono">{usr.id}</div>
                        </td>
                        <td className="p-3 text-slate-700 dark:text-slate-300 font-mono text-[11px]">{usr.email}</td>
                        <td className="p-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              usr.role === 'admin'
                                ? 'bg-purple-500/20 text-purple-600 dark:text-purple-400 border border-purple-500/30'
                                : usr.role === 'ctv'
                                ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                                : 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                            }`}
                          >
                            {usr.role}
                          </span>
                        </td>
                        <td className="p-3 font-mono font-bold text-emerald-600 dark:text-emerald-400">
                          ${formatMoney(usr.balance)}
                        </td>
                        <td className="p-3 text-slate-700 dark:text-slate-300">
                          {usr.role === 'user' ? (
                            (usr.vipDiscountPercent ?? 0) > 0 ? (
                              <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                                -{usr.vipDiscountPercent}% <span className="text-[10px] text-slate-500 dark:text-slate-500 uppercase">({usr.vipTierKey})</span>
                              </span>
                            ) : (
                              '0%'
                            )
                          ) : (
                            // CTV/admin no longer get an automatic purchase
                            // discount — they always pay the listed price.
                            <span className="text-slate-500 dark:text-slate-500">—</span>
                          )}
                        </td>
                        <td className="p-3 font-mono text-[10px] text-slate-600 dark:text-slate-400 max-w-[140px] truncate" title={usr.depositWallets?.bsc}>
                          {usr.depositWallets?.bsc || 'Đang tạo...'}
                        </td>
                        <td className="p-3 text-right space-x-1.5 whitespace-nowrap">
                          {/* Change Role */}
                          <select
                            value={usr.role}
                            onChange={(e) => handleUpdateUser(usr.id, e.target.value as UserRole)}
                            className="bg-[#eef0ef] dark:bg-[#202227] border border-[#dee1e0] dark:border-[#373b43] rounded px-1.5 py-1 text-[11px] text-slate-800 dark:text-slate-200"
                          >
                            <option value="user">USER</option>
                            <option value="ctv">CTV</option>
                            <option value="admin">ADMIN</option>
                          </select>

                          {/* Custom balance top-up/deduct amount */}
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="Số tiền"
                            value={balanceInputs[usr.id] ?? ''}
                            onChange={(e) => setBalanceInputs((prev) => ({ ...prev, [usr.id]: e.target.value }))}
                            className="w-20 bg-[#eef0ef] dark:bg-[#202227] border border-[#dee1e0] dark:border-[#373b43] rounded px-1.5 py-1 text-[11px] text-slate-800 dark:text-slate-200"
                          />

                          {/* Adjust Balance +amount */}
                          <button
                            onClick={() => {
                              const amt = Number(balanceInputs[usr.id]);
                              if (!amt || amt <= 0) return;
                              handleUpdateUser(usr.id, undefined, amt);
                              setBalanceInputs((prev) => ({ ...prev, [usr.id]: '' }));
                            }}
                            className="bg-emerald-50 dark:bg-emerald-950/70 hover:bg-emerald-800 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 px-2 py-1 rounded text-[10px] font-bold"
                            title="Cộng tiền vào ví"
                          >
                            +$
                          </button>

                          {/* Adjust Balance -amount */}
                          <button
                            onClick={() => {
                              const amt = Number(balanceInputs[usr.id]);
                              if (!amt || amt <= 0) return;
                              handleUpdateUser(usr.id, undefined, -amt);
                              setBalanceInputs((prev) => ({ ...prev, [usr.id]: '' }));
                            }}
                            className="bg-red-50 dark:bg-red-950/70 hover:bg-red-800 text-red-700 dark:text-red-300 border border-red-500/30 px-2 py-1 rounded text-[10px] font-bold"
                            title="Trừ tiền khỏi ví"
                          >
                            -$
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              </div>
            </div>

            {/* Pagination */}
            {usersTotalPages > 1 && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-600 dark:text-slate-400">
                  Trang {usersPage}/{usersTotalPages} ({filteredUsers.length} người dùng)
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setUsersPage((p) => Math.max(1, p - 1))}
                    disabled={usersPage === 1}
                    className="px-3 py-1.5 bg-[#eceeed] dark:bg-[#23252a] hover:bg-[#e0e4e2] hover:dark:bg-[#2a2d34] border border-[#dde2e0] dark:border-[#373b43] rounded-lg font-semibold text-slate-700 dark:text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed transition"
                  >
                    ← Trước
                  </button>
                  <button
                    onClick={() => setUsersPage((p) => Math.min(usersTotalPages, p + 1))}
                    disabled={usersPage === usersTotalPages}
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

            {/* Modal Add User */}
            {showAddUserModal && (
              <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                <div className="bg-[#eceeed] dark:bg-[#23252a] border border-purple-500/50 rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
                  <div className="flex items-center justify-between pb-2 border-b border-[#e0e4e2] dark:border-[#33363e]">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                      <Users className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                      <span>Thêm Người Dùng Mới</span>
                    </h3>
                    <button onClick={() => setShowAddUserModal(false)} className="text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:dark:text-slate-100">✕</button>
                  </div>

                  <form onSubmit={handleCreateUser} className="space-y-3 text-xs">
                    <div>
                      <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Tên đăng nhập (Username):</label>
                      <input
                        type="text"
                        value={newUsername}
                        onChange={(e) => setNewUsername(e.target.value)}
                        placeholder="user_test123"
                        className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 focus:border-purple-500 focus:outline-none"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Email:</label>
                      <input
                        type="email"
                        value={newUserEmail}
                        onChange={(e) => setNewUserEmail(e.target.value)}
                        placeholder="user@gmail.com"
                        className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 focus:border-purple-500 focus:outline-none"
                        required
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Quyền hạn:</label>
                        <select
                          value={newUserRole}
                          onChange={(e) => setNewUserRole(e.target.value as UserRole)}
                          className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-2 py-2 text-slate-800 dark:text-slate-200"
                        >
                          <option value="user">Thành viên (User)</option>
                          <option value="ctv">Cộng tác viên (CTV)</option>
                          <option value="admin">Quản trị viên (Admin)</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Số dư khởi tạo ($):</label>
                        <input
                          type="number"
                          step="0.01"
                          value={newUserBalance}
                          onChange={(e) => setNewUserBalance(Number(e.target.value))}
                          className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 font-mono"
                        />
                      </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setShowAddUserModal(false)}
                        className="px-4 py-2 bg-[#e5e8e7] dark:bg-[#2d3036] hover:bg-[#dde1e0] hover:dark:bg-[#373b44] text-slate-700 dark:text-slate-300 rounded-lg"
                      >
                        Hủy
                      </button>
                      <button
                        type="submit"
                        className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-slate-900 dark:text-slate-100 font-bold rounded-lg"
                      >
                        Thêm Tài Khoản
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 5: INVENTORY & BULK IMPORT */}
        {activeTab === 'inventory' && (
          <div className="space-y-6">
            {/* Bulk Import Form */}
            <div className="bg-[#eceeed] dark:bg-[#23252a] border border-[#dde2e0] dark:border-[#373b43] rounded-xl p-5 shadow space-y-4">
              <div className="flex items-center justify-between border-b border-[#e0e4e2] dark:border-[#33363e] pb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <PackagePlus className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    <span>Nhập Hàng Loạt Vào Kho (Bulk Import Stock)</span>
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400">Dán danh sách tài khoản theo từng dòng, hệ thống sẽ tự động cập nhật số lượng tồn</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Chọn sản phẩm:</label>
                  <select
                    value={importProductId}
                    onChange={(e) => {
                      setImportProductId(e.target.value);
                      const p = products.find((prod) => prod.id === e.target.value);
                      if (p && p.variants[0]) setImportVariantId(p.variants[0].id);
                    }}
                    className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200"
                  >
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Chọn phân loại (Biến thể):</label>
                  <select
                    value={importVariantId}
                    onChange={(e) => setImportVariantId(e.target.value)}
                    className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200"
                  >
                    {currentImportProd?.variants.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} (${formatMoney(v.price)} - Hiện có: {v.stockCount})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold text-xs">
                    Dán danh sách tài khoản (Mỗi dòng một tài khoản):
                  </label>
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 px-2.5 py-1 rounded-lg cursor-pointer transition">
                    <Upload className="w-3.5 h-3.5" />
                    <span>Tải file .txt</span>
                    <input type="file" accept=".txt" onChange={handleImportFileSelect} className="hidden" />
                  </label>
                </div>
                <textarea
                  value={rawAccountsInput}
                  onChange={(e) => setRawAccountsInput(e.target.value)}
                  rows={6}
                  placeholder={`1829471928491|P@ssword123|JBSWY3DPEHPK3PXP|mail@hotmail.com|PassMail|2FA_Secret|Cookie\n1829471928492|P@ssword456|KZXW654TOJXXE3DF|mail2@hotmail.com|PassMail2|2FA_Secret|Cookie`}
                  className="w-full bg-[#f2f4f3] dark:bg-[#1a1b1f] border border-[#dee1e0] dark:border-[#373b43] focus:border-emerald-500 rounded-lg p-3 text-xs font-mono text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none"
                />
                <div className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-400 mt-1">
                  <span>Số dòng đã nhập: {rawAccountsInput.trim() ? rawAccountsInput.trim().split('\n').length : 0}</span>
                  <span>Định dạng khuyên dùng: UID|Pass|2FA|Mail|MailPass|Cookie — tự động bỏ qua tài khoản trùng username đã có trong kho</span>
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={handleBulkImport}
                  disabled={isImporting || !rawAccountsInput.trim()}
                  className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold text-xs px-5 py-2.5 rounded-lg flex items-center gap-2 transition shadow-[0_0_12px_rgba(6,182,212,0.3)]"
                >
                  <Database className="w-4 h-4" />
                  <span>{isImporting ? 'Đang nhập vào kho...' : 'Bắt Đầu Nhập Kho'}</span>
                </button>
              </div>
            </div>

            {/* Inventory Inspection — grouped by product then variant instead of
                one long mixed list, so it's actually browsable */}
            <div className="bg-[#eceeed] dark:bg-[#23252a] border border-[#dde2e0] dark:border-[#373b43] rounded-xl p-5 shadow space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Database className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                  <span>Danh Sách Tài Khoản Trong Kho (Xem Mẫu Bảo Mật)</span>
                </h3>
                <span className="text-xs text-slate-600 dark:text-slate-400">Bấm vào tên sản phẩm để mở/đóng</span>
              </div>

              {inventoryItems.length === 0 ? (
                <div className="text-center text-xs text-slate-500 dark:text-slate-500 py-6">
                  Kho hàng đang trống. Nhập tài khoản ở form phía trên.
                </div>
              ) : (
                <>
                <div className="space-y-3">
                {(() => {
                  const byProduct = new Map<string, typeof inventoryItems>();
                  inventoryItems.forEach((item) => {
                    const list = byProduct.get(item.productId) || [];
                    list.push(item);
                    byProduct.set(item.productId, list);
                  });
                  const productEntries = Array.from(byProduct.entries());
                  const inventoryTotalPages = Math.max(1, Math.ceil(productEntries.length / INVENTORY_PRODUCTS_PER_PAGE));
                  // Clamped rather than reset via effect — if a bulk import
                  // or filter change shrinks the product count while the
                  // admin is sitting on a now out-of-range page, this just
                  // quietly shows the last valid page instead of a blank one.
                  const safeInventoryPage = Math.min(inventoryPage, inventoryTotalPages);
                  const pagedEntries = productEntries.slice(
                    (safeInventoryPage - 1) * INVENTORY_PRODUCTS_PER_PAGE,
                    safeInventoryPage * INVENTORY_PRODUCTS_PER_PAGE
                  );

                  return (
                    <>
                    {pagedEntries.map(([productId, items]) => {
                    const product = products.find((p) => p.id === productId);
                    const isExpanded = expandedInventoryProducts.has(productId);
                    const byVariant = new Map<string, typeof items>();
                    items.forEach((item) => {
                      const list = byVariant.get(item.variantId) || [];
                      list.push(item);
                      byVariant.set(item.variantId, list);
                    });

                    return (
                      <div key={productId} className="border border-[#e1e5e4] dark:border-[#32353d] rounded-lg overflow-hidden">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedInventoryProducts((prev) => {
                              const next = new Set(prev);
                              if (next.has(productId)) next.delete(productId);
                              else next.add(productId);
                              return next;
                            })
                          }
                          className="w-full bg-[#e5e8e7] dark:bg-[#2d3036] hover:bg-[#dde1e0] hover:dark:bg-[#363941] px-3 py-2 text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center justify-between transition"
                        >
                          <span className="flex items-center gap-1.5">
                            <ChevronRight className={`w-3.5 h-3.5 text-slate-500 dark:text-slate-500 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                            {product?.name || productId}
                          </span>
                          <span className="text-slate-600 dark:text-slate-400 font-normal">{items.length} tài khoản</span>
                        </button>
                        {isExpanded && Array.from(byVariant.entries()).map(([variantId, variantItems]) => {
                          const variant = product?.variants.find((v) => v.id === variantId);
                          // Chưa bán trước, đã bán sau; trong mỗi nhóm thì mới
                          // nhập kho nhất lên đầu — so admin sees what's
                          // actually sellable right now without hunting
                          // through already-sold rows first.
                          const sortedItems = [...variantItems].sort((a, b) => {
                            if (a.isSold !== b.isSold) return a.isSold ? 1 : -1;
                            return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
                          });
                          return (
                            <div key={variantId}>
                              <div className="bg-[#eff2f1] dark:bg-[#1d1f24] px-3 py-1.5 text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                                {variant?.name || variantId}
                              </div>
                              <div className="max-h-64 overflow-y-auto">
                                <div className="overflow-x-auto">
              <table className="w-full text-left text-xs min-w-[640px]">
                                  <tbody className="divide-y divide-[#e4e8e7] dark:divide-[#2d3036] font-mono text-[11px]">
                                    {sortedItems.map((item) => (
                                      <tr key={item.id} className="hover:bg-[#e6eae9] hover:dark:bg-[#2a2d34]">
                                        <td className="p-2.5 text-slate-700 dark:text-slate-300">{item.accountMasked}</td>
                                        <td className="p-2.5 text-right w-24">
                                          {item.isSold ? (
                                            <span className="bg-red-50 dark:bg-red-950/70 text-red-600 dark:text-red-400 px-1.5 py-0.5 rounded text-[10px]">Đã bán</span>
                                          ) : (
                                            <span className="bg-emerald-50 dark:bg-emerald-950/70 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 rounded text-[10px]">Sẵn sàng</span>
                                          )}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
              </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                    {inventoryTotalPages > 1 && (
                      <div className="flex items-center justify-between text-xs pt-1">
                        <span className="text-slate-600 dark:text-slate-400">
                          Trang {safeInventoryPage}/{inventoryTotalPages} ({productEntries.length} sản phẩm)
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setInventoryPage((p) => Math.max(1, p - 1))}
                            disabled={safeInventoryPage === 1}
                            className="px-3 py-1.5 bg-[#eceeed] dark:bg-[#23252a] hover:bg-[#e0e4e2] hover:dark:bg-[#2a2d34] border border-[#dde2e0] dark:border-[#373b43] rounded-lg font-semibold text-slate-700 dark:text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed transition"
                          >
                            ← Trước
                          </button>
                          <button
                            onClick={() => setInventoryPage((p) => Math.min(inventoryTotalPages, p + 1))}
                            disabled={safeInventoryPage === inventoryTotalPages}
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
                </>
              )}
            </div>
          </div>
        )}

        {/* TAB: ORDER MANAGEMENT */}
        {activeTab === 'orders' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Quản Lý Đơn Hàng</h2>
                <p className="text-xs text-slate-600 dark:text-slate-400">Toàn bộ đơn hàng trên sàn — tìm theo mã đơn/khách/sản phẩm, hoàn tiền khi cần</p>
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
                    className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-purple-500"
                  />
                </div>
              </div>
            </div>

            {(() => {
              const q = orderSearch.trim().toLowerCase();
              const filteredOrders = allOrders.filter((o) => {
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
                  {allOrders.length === 0 ? (
                    <div className="text-center text-xs text-slate-500 dark:text-slate-500 py-6 bg-[#eceeed] dark:bg-[#23252a] border border-[#dde2e0] dark:border-[#373b43] rounded-xl">
                      Chưa có đơn hàng nào trên sàn.
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

        {/* TAB 6: RPC GATEWAY MONITOR */}
        {activeTab === 'rpc' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Cổng Quét Tự Động RPC Đa Chuỗi</h2>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Mỗi người dùng được cấp một địa chỉ ví riêng biệt. Hệ thống quét RPC node và cộng tiền tự động.
                </p>
              </div>
              <button
                onClick={onOpenDeposit}
                className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs px-3.5 py-2 rounded-lg flex items-center gap-1.5 shadow"
              >
                <Coins className="w-4 h-4" />
                <span>Mở Cửa Sổ Nạp Thử Nghiệm</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {cryptoDepositOptions.map((opt) => (
                <div key={opt.id} className={`bg-[#eceeed] dark:bg-[#23252a] border rounded-xl p-4 shadow space-y-3 text-xs ${opt.isHidden ? 'border-slate-400/40 opacity-60' : 'border-[#dde2e0] dark:border-[#373b43]'}`}>
                  <div className="flex items-center justify-between pb-2 border-b border-[#e0e4e2] dark:border-[#33363e]">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{opt.icon}</span>
                      <div>
                        <div className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                          {opt.name}
                          {opt.isHidden && (
                            <span className="text-[10px] bg-slate-500/20 text-slate-600 dark:text-slate-400 border border-slate-500/30 px-1.5 py-0.5 rounded font-normal">
                              Đã ẩn
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-mono">{opt.networkLabel} ({opt.token})</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleToggleCryptoOptVisibility(opt)}
                        title={opt.isHidden ? 'Hiện lại trên trang nạp tiền' : 'Ẩn khỏi trang nạp tiền'}
                        className={`p-1 rounded transition ${
                          opt.isHidden
                            ? 'text-slate-500 dark:text-slate-500 hover:text-emerald-600 hover:dark:text-emerald-400 hover:bg-emerald-50 hover:dark:bg-emerald-950/70'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 hover:dark:text-slate-200 hover:bg-slate-100 hover:dark:bg-slate-800/70'
                        }`}
                      >
                        {opt.isHidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        onClick={() => openEditCryptoOpt(opt)}
                        title="Sửa cấu hình"
                        className="p-1 text-slate-600 dark:text-slate-400 hover:text-purple-600 hover:dark:text-purple-400 hover:bg-purple-50 hover:dark:bg-purple-950/70 rounded transition"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDeleteCryptoOpt(opt)}
                        title="Xóa cổng nạp"
                        className="p-1 text-red-600 dark:text-red-400 hover:text-red-700 hover:dark:text-red-300 hover:bg-red-50 hover:dark:bg-red-950/70 rounded transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-slate-600 dark:text-slate-400 text-[11px]">
                      <span>RPC Endpoint:</span>
                      <span className="font-mono text-slate-800 dark:text-slate-200 truncate max-w-[200px]" title={opt.rpcUrl}>
                        {opt.rpcUrl}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-slate-600 dark:text-slate-400 text-[11px]">
                      <span>Hợp đồng (Contract):</span>
                      <span className="font-mono text-emerald-600 dark:text-emerald-400 truncate max-w-[200px]" title={opt.contractAddress}>
                        {opt.contractAddress}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-slate-600 dark:text-slate-400 text-[11px]">
                      <span>Decimals / Tối thiểu:</span>
                      <span className="text-slate-800 dark:text-slate-200 font-mono">{opt.decimals} decimals | Min: ${opt.minDeposit.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center justify-between text-slate-600 dark:text-slate-400 text-[11px]">
                      <span>Cơ chế kiểm tra:</span>
                      <span className="text-emerald-600 dark:text-emerald-400 font-semibold">ethers.js ERC20 balanceOf & TronGrid</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {missingCryptoNetworkIds.length > 0 && (
              <div className="bg-[#eceeed] dark:bg-[#23252a] border border-dashed border-[#dde2e0] dark:border-[#373b43] rounded-xl p-4 text-xs">
                <div className="font-bold text-slate-800 dark:text-slate-200 mb-2">Thêm lại cổng nạp đã xóa:</div>
                <div className="flex flex-wrap gap-2">
                  {missingCryptoNetworkIds.map((id) => (
                    <button
                      key={id}
                      onClick={() => openAddCryptoOpt(id)}
                      className="flex items-center gap-1.5 bg-[#e5e8e7] dark:bg-[#2d3036] hover:bg-emerald-500 hover:text-slate-950 text-slate-700 dark:text-slate-300 font-semibold px-3 py-1.5 rounded-lg transition"
                    >
                      <PlusCircle className="w-3.5 h-3.5" />
                      <span>{id.toUpperCase()}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 7: FEE SÀN & QUẢN LÝ RÚT TIỀN CTV */}
        {activeTab === 'ctv-fee' && (
          <div className="space-y-6">
            {/* Tùy chỉnh fee sàn */}
            <div className="bg-[#eceeed] dark:bg-[#23252a] border border-amber-500/40 rounded-2xl p-5 shadow space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#e0e4e2] dark:border-[#33363e] pb-4">
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <Percent className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                    <span>Cấu Hình Tùy Chỉnh Phí Sàn (Platform Fee)</span>
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                    Admin có thể tự điều chỉnh tỷ lệ % phí sàn khấu trừ khi CTV bán được đơn hàng.
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-xs text-slate-600 dark:text-slate-400">Phí sàn hiện tại:</div>
                  <span className="bg-amber-500 text-slate-950 font-black text-sm px-3 py-1 rounded-lg">
                    {platformFee}%
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span className="text-slate-700 dark:text-slate-300 font-semibold">Mức nhanh:</span>
                {[0, 3, 5, 8, 10, 15].map((fee) => (
                  <button
                    key={fee}
                    onClick={() => handleUpdateFee(fee)}
                    className={`px-3 py-1.5 rounded-lg border font-mono font-bold transition ${
                      platformFee === fee
                        ? 'bg-amber-500 border-amber-400 text-slate-950'
                        : 'bg-[#eff2f1] dark:bg-[#1d1f24] border-[#dee2e0] dark:border-[#363a43] text-slate-700 dark:text-slate-300 hover:border-amber-400/50'
                    }`}
                  >
                    {fee}%
                  </button>
                ))}

                <div className="flex items-center gap-2 ml-auto">
                  <input
                    type="number"
                    min="0"
                    max="50"
                    step="0.5"
                    value={customFeeInput}
                    onChange={(e) => setCustomFeeInput(parseFloat(e.target.value) || 0)}
                    className="w-20 bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee2e0] dark:border-[#363a43] rounded-lg px-2.5 py-1.5 text-center font-mono font-bold text-amber-600 dark:text-amber-400 text-xs focus:outline-none focus:border-amber-400"
                  />
                  <span className="text-slate-600 dark:text-slate-400 font-mono">%</span>
                  <button
                    onClick={() => handleUpdateFee(customFeeInput)}
                    className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-3 py-1.5 rounded-lg transition"
                  >
                    Lưu Fee Sàn
                  </button>
                </div>
              </div>
            </div>

            {/* Quản lý các yêu cầu rút tiền từ CTV */}
            <div className="bg-[#eceeed] dark:bg-[#23252a] border border-[#dde2e0] dark:border-[#373b43] rounded-2xl p-5 shadow space-y-4">
              <div className="flex items-center justify-between border-b border-[#e0e4e2] dark:border-[#33363e] pb-3">
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <DollarSign className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                    <span>Danh Sách Yêu Cầu Rút Tiền Từ CTV ({adminWithdrawals.length})</span>
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Admin xét duyệt thông tin tài khoản và xác nhận chuyển tiền cho đối tác CTV
                  </p>
                </div>

                <button
                  onClick={fetchAdminData}
                  className="bg-[#e5e8e7] dark:bg-[#2d3036] hover:bg-[#dde1e0] hover:dark:bg-[#373b44] text-emerald-600 dark:text-emerald-400 text-xs px-3 py-1.5 rounded-lg border border-emerald-500/30 flex items-center gap-1.5 transition"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                  <span>Làm mới</span>
                </button>
              </div>

              {adminWithdrawals.length === 0 ? (
                <div className="text-center py-10 text-slate-600 dark:text-slate-400 text-xs">
                  Hiện tại không có yêu cầu rút tiền nào từ CTV.
                </div>
              ) : (
                  <div className="overflow-x-auto">
              <table className="w-full text-left text-xs min-w-[640px]">
                    <thead className="bg-[#eff2f1] dark:bg-[#1d1f24] text-slate-600 dark:text-slate-400 border-b border-[#dde2e0] dark:border-[#373b43]">
                      <tr>
                        <th className="p-3">Mã đơn</th>
                        <th className="p-3">CTV</th>
                        <th className="p-3">Số tiền rút</th>
                        <th className="p-3">Phương thức & Chi tiết thụ hưởng</th>
                        <th className="p-3">Thời gian</th>
                        <th className="p-3">Trạng thái</th>
                        <th className="p-3 text-right">Thao tác duyệt</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#e4e8e7]">
                      {adminWithdrawals.map((w) => (
                        <tr key={w.id} className="hover:bg-[#e6eae9] hover:dark:bg-[#2a2d34] transition">
                          <td className="p-3 font-mono font-bold text-slate-800 dark:text-slate-200">
                            #{w.id.toUpperCase()}
                          </td>
                          <td className="p-3">
                            <span className="bg-amber-500/20 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded text-[11px] font-bold">
                              {w.username || 'CTV'}
                            </span>
                          </td>
                          <td className="p-3">
                            <div className="text-emerald-600 dark:text-emerald-400 font-bold font-mono text-sm">
                              ${formatMoney(w.amount)}
                            </div>
                            <div className="text-[10px] text-slate-600 dark:text-slate-400 font-mono">
                              ~ {(w.amount * 25400).toLocaleString('vi-VN')} VND
                            </div>
                          </td>
                          <td className="p-3">
                            <div className="text-slate-800 dark:text-slate-200 font-semibold">
                              {w.bankName ? `${w.bankName} - ` : ''} {w.accountNumber}
                            </div>
                            <div className="text-slate-600 dark:text-slate-400 text-[11px] uppercase font-mono">
                              Chủ TK: {w.accountName}
                            </div>
                            {w.note && (
                              <div className="text-[10px] text-emerald-600 dark:text-emerald-400 italic">
                                Ghi chú: {w.note}
                              </div>
                            )}
                          </td>
                          <td className="p-3 font-mono text-slate-600 dark:text-slate-400 text-[11px]">
                            {w.createdAt}
                          </td>
                          <td className="p-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold inline-flex items-center gap-1 ${
                                w.status === 'completed'
                                  ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/40'
                                  : w.status === 'rejected'
                                  ? 'bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/40'
                                  : 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/40'
                              }`}
                            >
                              {w.status === 'completed'
                                ? '✓ Đã chuyển'
                                : w.status === 'rejected'
                                ? '✕ Từ chối'
                                : '⏳ Chờ duyệt'}
                            </span>
                          </td>
                          <td className="p-3 text-right">
                            {w.status === 'pending' ? (
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  onClick={() => handleApproveWithdrawal(w.id)}
                                  className="bg-emerald-600 hover:bg-emerald-500 text-slate-900 dark:text-slate-100 font-bold px-2.5 py-1 rounded text-[11px] transition shadow"
                                >
                                  Duyệt & Đã Chuyển
                                </button>
                                <button
                                  onClick={() => handleRejectWithdrawal(w.id)}
                                  className="bg-red-50 dark:bg-red-950/70 hover:bg-red-800 text-red-800 dark:text-red-200 px-2 py-1 rounded text-[11px] transition border border-red-500/30"
                                >
                                  Từ Chối
                                </button>
                              </div>
                            ) : (
                              <span className="text-slate-600 dark:text-slate-400 text-[11px] italic">
                                Đã xử lý
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
              </div>
              )}
            </div>
          </div>
        )}

        {/* TAB: VOUCHERS — admin sees and manages every code, CTV-created included */}
        {activeTab === 'vouchers' && (
          <div className="space-y-4">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Quản Lý Mã Giảm Giá</h3>
              <p className="text-xs text-slate-600 dark:text-slate-400">Tạo mã của riêng Admin hoặc theo dõi/xóa mã do CTV tạo — giới hạn số lượt sử dụng cho từng mã.</p>
            </div>

            {/* Create voucher form */}
            <form onSubmit={handleCreateVoucher} className="bg-[#eceeed] dark:bg-[#23252a] border border-[#dde2e0] dark:border-[#373b43] rounded-xl p-4 grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Mã voucher:</label>
                <input
                  type="text"
                  value={newVoucherCode}
                  onChange={(e) => setNewVoucherCode(e.target.value.toUpperCase())}
                  placeholder="VD: ADMIN20"
                  className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 font-mono focus:border-purple-500 focus:outline-none"
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
                  className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 font-mono focus:border-purple-500 focus:outline-none"
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
                  className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 font-mono focus:border-purple-500 focus:outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Hết hạn (tùy chọn):</label>
                <input
                  type="date"
                  value={newVoucherExpiry}
                  onChange={(e) => setNewVoucherExpiry(e.target.value)}
                  className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 font-mono focus:border-purple-500 focus:outline-none"
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
                  className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 focus:border-purple-500 focus:outline-none"
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
                  className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 focus:border-purple-500 focus:outline-none disabled:opacity-40"
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
                  className="bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-slate-900 dark:text-slate-100 font-bold text-xs px-4 py-2 rounded-lg transition flex items-center gap-1.5 shadow"
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
                    <th className="p-3">Người tạo</th>
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
                      <td colSpan={8} className="p-6 text-center text-slate-500 dark:text-slate-500">
                        Chưa có mã giảm giá nào trên toàn hệ thống.
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
                          <td className="p-3 text-slate-600 dark:text-slate-400">{v.createdByUsername}</td>
                          <td className="p-3 text-slate-600 dark:text-slate-400">
                            {v.applicableVariantId ? (
                              <span className="text-purple-600 dark:text-purple-400" title={v.applicableProductName}>{v.applicableVariantName}</span>
                            ) : v.applicableProductId ? (
                              <span className="text-purple-600 dark:text-purple-400">{v.applicableProductName}</span>
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

        {/* TAB: REVIEW MANAGEMENT — admin-managed suggestion phrase pool
            (add/edit/delete, stored in DB) + moderation visibility into
            every real review, with low-rated ("xấu") ones highlighted so
            admin knows who to reach out to. */}
        {activeTab === 'reviews' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Câu Gợi Ý Đánh Giá</h3>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Danh sách câu gợi ý (chỉ câu khen) hiện cho user chọn nhanh khi viết đánh giá.
              </p>
            </div>

            <div className="bg-[#eceeed] dark:bg-[#23252a] border border-[#dde2e0] dark:border-[#373b43] rounded-xl p-4 space-y-2.5">
              <div className="space-y-1.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {(Object.keys(SUGGESTION_LANGUAGE_LABELS) as Language[]).map((lang) => (
                    <div key={lang} className="flex items-center gap-1.5">
                      <span className="w-7 flex-shrink-0 text-[10px] font-bold text-slate-500 dark:text-slate-500">
                        {SUGGESTION_LANGUAGE_LABELS[lang]}
                      </span>
                      <input
                        type="text"
                        value={newSuggestionText[lang]}
                        onChange={(e) => setNewSuggestionText((prev) => ({ ...prev, [lang]: e.target.value }))}
                        placeholder={`Câu gợi ý (${SUGGESTION_LANGUAGE_LABELS[lang]})...`}
                        maxLength={300}
                        className="flex-1 bg-[#f3f5f4] dark:bg-[#181a1e] border border-[#e0e4e2] dark:border-[#33363e] focus:border-emerald-500 rounded-lg px-3 py-2 text-xs text-slate-800 dark:text-slate-200 placeholder-slate-500 dark:placeholder-slate-500 focus:outline-none transition"
                      />
                    </div>
                  ))}
                </div>
                <button
                  onClick={handleAddSuggestion}
                  disabled={isAddingSuggestion}
                  className="w-full sm:w-auto bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs px-4 py-2 rounded-lg transition disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  <span>Thêm</span>
                </button>
              </div>

              <div className="space-y-1.5">
                {reviewSuggestions.length === 0 ? (
                  <div className="text-center py-4 text-xs text-slate-600 dark:text-slate-400">Chưa có câu gợi ý nào.</div>
                ) : (
                  reviewSuggestions.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-start gap-2 bg-[#f3f5f4] dark:bg-[#181a1e] border border-[#e0e4e2] dark:border-[#33363e] rounded-lg px-3 py-2"
                    >
                      {editingSuggestionId === s.id ? (
                        <>
                          <div className="flex-1 space-y-1">
                            {(Object.keys(SUGGESTION_LANGUAGE_LABELS) as Language[]).map((lang) => (
                              <div key={lang} className="flex items-center gap-1.5">
                                <span className="w-7 flex-shrink-0 text-[10px] font-bold text-slate-500 dark:text-slate-500">
                                  {SUGGESTION_LANGUAGE_LABELS[lang]}
                                </span>
                                <input
                                  type="text"
                                  value={editingSuggestionText[lang]}
                                  onChange={(e) => setEditingSuggestionText((prev) => ({ ...prev, [lang]: e.target.value }))}
                                  maxLength={300}
                                  className="flex-1 bg-[#eceeed] dark:bg-[#23252a] border border-emerald-500/40 rounded px-2 py-1 text-xs text-slate-800 dark:text-slate-200 focus:outline-none"
                                />
                              </div>
                            ))}
                          </div>
                          <button
                            onClick={() => handleSaveEditedSuggestion(s.id)}
                            className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 hover:dark:text-emerald-300 flex-shrink-0 mt-1.5"
                            title="Lưu"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setEditingSuggestionId(null)}
                            className="text-slate-500 dark:text-slate-500 hover:text-slate-800 hover:dark:text-slate-200 flex-shrink-0 text-[11px] font-semibold mt-1.5"
                          >
                            Hủy
                          </button>
                        </>
                      ) : (
                        <>
                          <div className="flex-1 space-y-0.5">
                            {(Object.keys(SUGGESTION_LANGUAGE_LABELS) as Language[]).map((lang) => (
                              <div key={lang} className="flex items-baseline gap-1.5">
                                <span className="w-7 flex-shrink-0 text-[10px] font-bold text-slate-500 dark:text-slate-500">
                                  {SUGGESTION_LANGUAGE_LABELS[lang]}
                                </span>
                                <span className="text-xs text-slate-800 dark:text-slate-200">{s.text[lang]}</span>
                              </div>
                            ))}
                          </div>
                          <button
                            onClick={() => {
                              setEditingSuggestionId(s.id);
                              setEditingSuggestionText(s.text);
                            }}
                            className="text-slate-500 dark:text-slate-500 hover:text-emerald-600 hover:dark:text-emerald-400 flex-shrink-0"
                            title="Sửa"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteSuggestion(s.id)}
                            className="text-red-600 dark:text-red-400 hover:text-red-700 hover:dark:text-red-300 flex-shrink-0"
                            title="Xóa"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Danh Sách Đánh Giá Từ Người Mua</h3>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Đánh giá từ {reviewEditableMaxRating} sao trở xuống (viền đỏ) là đánh giá xấu, user vẫn có thể tự sửa lại —
                admin/CTV liên hệ trực tiếp với user để xử lý và đề nghị họ cập nhật đánh giá tốt hơn nếu vấn đề đã được giải quyết.
                Đánh giá {reviewEditableMaxRating + 1} sao trở lên không thể chỉnh sửa nữa.
              </p>
            </div>

            <div className="space-y-2">
              {productReviews.length === 0 ? (
                <div className="text-center py-8 bg-[#eceeed] dark:bg-[#23252a] border border-[#dde2e0] dark:border-[#373b43] rounded-xl text-xs text-slate-600 dark:text-slate-400">
                  Chưa có đánh giá nào.
                </div>
              ) : (
                productReviews.map((r) => {
                  const isBad = r.rating <= reviewEditableMaxRating;
                  return (
                    <div
                      key={r.id}
                      className={`bg-[#eceeed] dark:bg-[#23252a] border rounded-xl p-3.5 ${
                        isBad ? 'border-red-500/50' : 'border-[#dde2e0] dark:border-[#373b43]'
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

        {/* Modal: edit a deposit network's display/RPC config */}
        {editingCryptoOptId && (
          <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-[#eceeed] dark:bg-[#23252a] border border-purple-500/50 rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between pb-2 border-b border-[#e0e4e2] dark:border-[#33363e]">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Sửa Cổng Nạp "{cryptoOptForm.networkLabel}"</h3>
                <button onClick={() => setEditingCryptoOptId(null)} className="text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:dark:text-slate-100">✕</button>
              </div>
              <div className="space-y-3 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Icon:</label>
                    <input type="text" value={cryptoOptForm.icon || ''} onChange={(e) => setCryptoOptForm({ ...cryptoOptForm, icon: e.target.value })} className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 focus:border-purple-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Token:</label>
                    <input type="text" value={cryptoOptForm.token || ''} onChange={(e) => setCryptoOptForm({ ...cryptoOptForm, token: e.target.value })} className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 focus:border-purple-500 focus:outline-none" />
                  </div>
                </div>
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Tên hiển thị:</label>
                  <input type="text" value={cryptoOptForm.name || ''} onChange={(e) => setCryptoOptForm({ ...cryptoOptForm, name: e.target.value })} className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 focus:border-purple-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Nhãn mạng (networkLabel):</label>
                  <input type="text" value={cryptoOptForm.networkLabel || ''} onChange={(e) => setCryptoOptForm({ ...cryptoOptForm, networkLabel: e.target.value })} className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 focus:border-purple-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">RPC Endpoint:</label>
                  <input type="text" value={cryptoOptForm.rpcUrl || ''} onChange={(e) => setCryptoOptForm({ ...cryptoOptForm, rpcUrl: e.target.value })} className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 font-mono focus:border-purple-500 focus:outline-none" />
                  <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">⚠️ Sai RPC/contract sẽ làm quét nạp tiền thật trên mạng này ngừng hoạt động.</p>
                </div>
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Contract Address:</label>
                  <input type="text" value={cryptoOptForm.contractAddress || ''} onChange={(e) => setCryptoOptForm({ ...cryptoOptForm, contractAddress: e.target.value })} className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 font-mono focus:border-purple-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Explorer TX URL:</label>
                  <input type="text" value={cryptoOptForm.explorerTxUrl || ''} onChange={(e) => setCryptoOptForm({ ...cryptoOptForm, explorerTxUrl: e.target.value })} className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 font-mono focus:border-purple-500 focus:outline-none" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div>
                    <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Decimals:</label>
                    <input type="number" value={cryptoOptForm.decimals ?? 18} onChange={(e) => setCryptoOptForm({ ...cryptoOptForm, decimals: Number(e.target.value) })} className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 font-mono focus:border-purple-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Min nạp ($):</label>
                    <input type="number" step="0.1" value={cryptoOptForm.minDeposit ?? 1} onChange={(e) => setCryptoOptForm({ ...cryptoOptForm, minDeposit: Number(e.target.value) })} className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 font-mono focus:border-purple-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Chain ID:</label>
                    <input type="number" value={cryptoOptForm.chainId ?? ''} onChange={(e) => setCryptoOptForm({ ...cryptoOptForm, chainId: e.target.value ? Number(e.target.value) : undefined })} placeholder="TRC: để trống" className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 font-mono focus:border-purple-500 focus:outline-none" />
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => setEditingCryptoOptId(null)} className="px-4 py-2 bg-[#e5e8e7] dark:bg-[#2d3036] hover:bg-[#dde1e0] hover:dark:bg-[#373b44] text-slate-700 dark:text-slate-300 rounded-lg text-xs font-semibold">Hủy</button>
                <button onClick={handleSaveCryptoOpt} className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-slate-900 dark:text-slate-100 font-bold rounded-lg text-xs transition">Lưu Thay Đổi</button>
              </div>
            </div>
          </div>
        )}

        {/* Modal: re-add a previously-deleted deposit network */}
        {showAddCryptoOptModal && (
          <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-[#eceeed] dark:bg-[#23252a] border border-emerald-500/50 rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between pb-2 border-b border-[#e0e4e2] dark:border-[#33363e]">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Thêm Lại Cổng Nạp "{String(cryptoOptForm.id).toUpperCase()}"</h3>
                <button onClick={() => setShowAddCryptoOptModal(false)} className="text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:dark:text-slate-100">✕</button>
              </div>
              <div className="space-y-3 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Icon:</label>
                    <input type="text" value={cryptoOptForm.icon || ''} onChange={(e) => setCryptoOptForm({ ...cryptoOptForm, icon: e.target.value })} className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 focus:border-emerald-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Token:</label>
                    <input type="text" value={cryptoOptForm.token || ''} onChange={(e) => setCryptoOptForm({ ...cryptoOptForm, token: e.target.value })} placeholder="USDT" className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 focus:border-emerald-500 focus:outline-none" />
                  </div>
                </div>
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Tên hiển thị:</label>
                  <input type="text" value={cryptoOptForm.name || ''} onChange={(e) => setCryptoOptForm({ ...cryptoOptForm, name: e.target.value })} placeholder='VD: USDT (BNB Smart Chain)' className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 focus:border-emerald-500 focus:outline-none" required />
                </div>
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Nhãn mạng (networkLabel):</label>
                  <input type="text" value={cryptoOptForm.networkLabel || ''} onChange={(e) => setCryptoOptForm({ ...cryptoOptForm, networkLabel: e.target.value })} placeholder="BEP20 (BSC)" className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 focus:border-emerald-500 focus:outline-none" required />
                </div>
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">RPC Endpoint:</label>
                  <input type="text" value={cryptoOptForm.rpcUrl || ''} onChange={(e) => setCryptoOptForm({ ...cryptoOptForm, rpcUrl: e.target.value })} className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 font-mono focus:border-emerald-500 focus:outline-none" required />
                </div>
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Contract Address:</label>
                  <input type="text" value={cryptoOptForm.contractAddress || ''} onChange={(e) => setCryptoOptForm({ ...cryptoOptForm, contractAddress: e.target.value })} className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 font-mono focus:border-emerald-500 focus:outline-none" required />
                </div>
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Explorer TX URL:</label>
                  <input type="text" value={cryptoOptForm.explorerTxUrl || ''} onChange={(e) => setCryptoOptForm({ ...cryptoOptForm, explorerTxUrl: e.target.value })} className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 font-mono focus:border-emerald-500 focus:outline-none" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div>
                    <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Decimals:</label>
                    <input type="number" value={cryptoOptForm.decimals ?? 18} onChange={(e) => setCryptoOptForm({ ...cryptoOptForm, decimals: Number(e.target.value) })} className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 font-mono focus:border-emerald-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Min nạp ($):</label>
                    <input type="number" step="0.1" value={cryptoOptForm.minDeposit ?? 1} onChange={(e) => setCryptoOptForm({ ...cryptoOptForm, minDeposit: Number(e.target.value) })} className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 font-mono focus:border-emerald-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Chain ID:</label>
                    <input type="number" value={cryptoOptForm.chainId ?? ''} onChange={(e) => setCryptoOptForm({ ...cryptoOptForm, chainId: e.target.value ? Number(e.target.value) : undefined })} placeholder="TRC: để trống" className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee1e0] dark:border-[#373b43] rounded-lg px-3 py-2 text-slate-800 dark:text-slate-200 font-mono focus:border-emerald-500 focus:outline-none" />
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => setShowAddCryptoOptModal(false)} className="px-4 py-2 bg-[#e5e8e7] dark:bg-[#2d3036] hover:bg-[#dde1e0] hover:dark:bg-[#373b44] text-slate-700 dark:text-slate-300 rounded-lg text-xs font-semibold">Hủy</button>
                <button onClick={handleCreateCryptoOpt} className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-lg text-xs transition">Thêm Cổng Nạp</button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
