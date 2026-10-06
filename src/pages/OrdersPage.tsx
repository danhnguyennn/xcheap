import React, { useState, useEffect } from 'react';
import { Order, Product, Language } from '../types';
import { translations } from '../locales/translations';
import { formatMoney } from '../utils/pricing';
import { DeliveredAccounts } from '../components/DeliveredAccounts';
import { showCopyToast } from '../components/Toast';
import { ArrowLeft, ShoppingBag, Copy, Download, Check, Calendar, ChevronDown, ChevronUp, Search, ChevronLeft, ChevronRight, Star } from 'lucide-react';

interface OrdersPageProps {
  language: Language;
  onBackToStore: () => void;
  onSelectProduct: (product: Product) => void;
}

const RECENT_WINDOW_DAYS = 7;
const PAGE_SIZE = 10;

// Được tách từ popup sang hẳn 1 trang riêng — popup vốn bị giới hạn chiều
// cao (max-h-[90vh]) nên với danh sách đơn hàng dài, user vừa phải cuộn bên
// trong khung nhỏ vừa dễ bấm nhầm ra ngoài làm đóng popup. Ở dạng trang, có
// đủ không gian để thêm ô tìm kiếm, phân trang và thao tác thoải mái hơn.
export const OrdersPage: React.FC<OrdersPageProps> = ({ language, onBackToStore, onSelectProduct }) => {
  const t = translations[language];
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  // Thu gọn mặc định — danh sách đơn hàng dài mà bung hết tài khoản ra cùng
  // lúc sẽ thành một bức tường thông tin nhạy cảm, khó dò theo ngày/sản phẩm.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  // Gợi ý tự động: sản phẩm đã mua (đơn hoàn tất) nhưng chưa được user này
  // đánh giá — giúp user không phải tự nhớ đã mua gì để đánh giá.
  const [reviewSuggestions, setReviewSuggestions] = useState<{ productId: string; productName: string }[]>([]);

  useEffect(() => {
    fetch('/api/user/review-suggestions')
      .then((res) => (res.ok ? res.json() : { suggestions: [] }))
      .then((data) => setReviewSuggestions(data.suggestions || []))
      .catch(() => setReviewSuggestions([]));
  }, []);

  const suggestedProductIds = new Set(reviewSuggestions.map((s) => s.productId));

  const handleReviewProduct = async (productId: string) => {
    try {
      const res = await fetch(`/api/products/${productId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.product) {
          // navigate() below does a pushState that would silently clobber a
          // URL hash set beforehand, so a sessionStorage flag is used
          // instead — ProductDetail reads (and clears) it on mount to land
          // straight on the Reviews tab.
          sessionStorage.setItem('xcheap_open_reviews_tab', '1');
          onSelectProduct(data.product);
        }
      }
    } catch {
      // Silent — user can just try again.
    }
  };

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  useEffect(() => {
    setLoading(true);
    fetch(`/api/orders?withinDays=${RECENT_WINDOW_DAYS}`)
      .then((res) => res.json())
      .then((data) => setOrders(data.orders || []))
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  // Tìm kiếm mới thì quay lại trang 1, tránh việc đang ở trang 3 rồi lọc còn
  // 1 trang khiến danh sách trông như trống rỗng.
  useEffect(() => {
    setPage(1);
  }, [searchQuery]);

  const handleCopy = (order: Order) => {
    navigator.clipboard.writeText(order.accounts.join('\n'));
    setCopiedId(order.id);
    showCopyToast(t.copiedAllAccountsToast.replace('{n}', String(order.accounts.length)));
    setTimeout(() => setCopiedId(null), 2500);
  };

  const handleDownload = (order: Order) => {
    const blob = new Blob([order.accounts.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${order.orderCode}.txt`;
    a.click();
  };

  const query = searchQuery.trim().toLowerCase();
  const filteredOrders = query
    ? orders.filter(
        (o) =>
          o.orderCode.toLowerCase().includes(query) ||
          o.productName.toLowerCase().includes(query) ||
          o.variantName.toLowerCase().includes(query)
      )
    : orders;

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / PAGE_SIZE));
  const pagedOrders = filteredOrders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
      <button onClick={onBackToStore} className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:dark:text-slate-100 mb-4 transition">
        <ArrowLeft className="w-3.5 h-3.5" />
        <span>{t.authBackToStore}</span>
      </button>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-[#eceeed] dark:bg-[#23252a] border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shadow-sm flex-shrink-0">
            <ShoppingBag className="w-4.5 h-4.5" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100">{t.ordersTitle}</h1>
            <p className="text-[11px] text-slate-600 dark:text-slate-400">
              {t.ordersTotalTemplate.replace('{n}', String(orders.length))}
            </p>
          </div>
        </div>

        {orders.length > 0 && (
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 dark:text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t.ordersSearchPlaceholder}
              className="w-full bg-[#f3f5f4] dark:bg-[#181a1e] border border-[#e0e4e2] dark:border-[#33363e] focus:border-emerald-500 rounded-lg pl-8 pr-3 py-2 text-xs text-slate-800 dark:text-slate-200 placeholder-slate-500 dark:placeholder-slate-500 focus:outline-none transition"
            />
          </div>
        )}
      </div>

      {/* Gợi ý đánh giá tự động — chỉ những sản phẩm đã mua thật (đơn hoàn
          tất) và chưa được đánh giá mới xuất hiện ở đây. */}
      {reviewSuggestions.length > 0 && (
        <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-500/30 rounded-xl">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-800 dark:text-amber-300 mb-2">
            <Star className="w-3.5 h-3.5 fill-amber-500 text-amber-500" />
            <span>{t.ordersReviewSuggestionsTitle.replace('{n}', String(reviewSuggestions.length))}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {reviewSuggestions.map((s) => (
              <button
                key={s.productId}
                onClick={() => handleReviewProduct(s.productId)}
                className="bg-[#eceeed] dark:bg-[#23252a] hover:bg-[#e5e8e7] hover:dark:bg-[#2d3036] border border-amber-500/40 text-amber-800 dark:text-amber-300 text-[11px] font-semibold px-2.5 py-1 rounded-lg transition truncate max-w-[220px]"
              >
                {s.productName}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Luôn cố định 7 ngày gần nhất, không riêng gì role nào — quản lý
          toàn bộ đơn hàng hệ thống giờ có trang riêng cho Admin/CTV. */}
      <div className="flex items-center justify-between gap-2 mb-4 text-[11px] text-slate-600 dark:text-slate-400">
        <span>{t.ordersShowingRecentTemplate.replace('{n}', String(RECENT_WINDOW_DAYS))}</span>
      </div>

      <div className="space-y-3.5 text-xs">
        {loading ? (
          <div className="text-center py-10 text-slate-600 dark:text-slate-400">{t.ordersLoading}</div>
        ) : orders.length === 0 ? (
          <div className="text-center py-14 bg-[#f2f4f3] dark:bg-[#1a1b1f] rounded-xl border border-[#e2e6e5] dark:border-[#30333b] text-slate-600 dark:text-slate-400">
            <ShoppingBag className="w-9 h-9 mx-auto mb-2 text-emerald-500/40" />
            <p>{t.ordersNoneInWindowTemplate.replace('{n}', String(RECENT_WINDOW_DAYS))}</p>
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="text-center py-14 bg-[#f2f4f3] dark:bg-[#1a1b1f] rounded-xl border border-[#e2e6e5] dark:border-[#30333b] text-slate-600 dark:text-slate-400">
            <Search className="w-9 h-9 mx-auto mb-2 text-slate-400/40" />
            <p>{t.ordersNoResults}</p>
          </div>
        ) : (
          pagedOrders.map((order) => {
            const isExpanded = expandedIds.has(order.id);
            return (
              <div
                key={order.id}
                className="bg-[#eef0ef] dark:bg-[#202227] border border-[#e1e4e3] dark:border-[#32363e] rounded-xl p-4 space-y-2.5 shadow-sm"
              >
                {/* Compact summary row — always visible, scannable at a glance.
                    A plain div (not <button>) because the inline "Đánh giá"
                    action below needs its own clickable button nested inside
                    this row, which isn't valid inside a <button>. */}
                <div
                  onClick={() => toggleExpanded(order.id)}
                  className="w-full flex flex-wrap items-center justify-between gap-2 text-left cursor-pointer"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-emerald-600 dark:text-emerald-400 font-bold font-mono text-sm">{order.orderCode}</span>
                      {order.status === 'refunded' ? (
                        <span className="bg-red-50 dark:bg-red-950/70 text-red-700 dark:text-red-300 text-[10px] font-bold px-2 py-0.5 rounded border border-red-500/30">
                          {t.ordersRefunded}
                        </span>
                      ) : (
                        <span className="bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold px-2 py-0.5 rounded border border-emerald-500/30">
                          {t.ordersCompleted}
                        </span>
                      )}
                      {!!order.warrantyReplacedCount && (
                        <span className="bg-purple-50 dark:bg-purple-950/70 text-purple-700 dark:text-purple-300 text-[10px] font-bold px-2 py-0.5 rounded border border-purple-500/30">
                          {t.warrantyReplacedNote
                            .replace('{n}', String(order.warrantyReplacedCount))
                            .replace('{total}', String(order.quantity))}
                        </span>
                      )}
                    </div>
                    <div className="text-slate-600 dark:text-slate-400 text-[11px] font-medium mt-0.5 truncate">
                      {order.productName} - {order.variantName}
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-500 flex items-center gap-1 mt-0.5">
                      <Calendar className="w-3 h-3" />
                      <span>{new Date(order.createdAt).toLocaleString()}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {suggestedProductIds.has(order.productId) && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleReviewProduct(order.productId);
                        }}
                        className="flex items-center gap-1 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 hover:dark:bg-amber-950/60 border border-amber-500/40 text-amber-700 dark:text-amber-300 text-[10px] font-bold px-2 py-1 rounded-lg transition"
                      >
                        <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
                        <span>{t.ordersReviewBtn}</span>
                      </button>
                    )}
                    <span className="text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400">
                      ${formatMoney(order.totalPrice)}
                    </span>
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 text-slate-500 dark:text-slate-500" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-slate-500 dark:text-slate-500" />
                    )}
                  </div>
                </div>

                {/* Delivered account items — hidden until expanded, so browsing
                    history doesn't mean scrolling past every past order's credentials */}
                {isExpanded && (
                  <div className="pt-2.5 border-t border-[#e2e6e5] dark:border-[#30333b]">
                    <div className="flex items-center justify-between mb-1 text-[11px] text-slate-600 dark:text-slate-400">
                      <span>
                        {t.deliveredAccounts} ({order.quantity} {t.ordersAccountsWord}):
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleCopy(order)}
                          className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 hover:dark:text-emerald-300 font-semibold flex items-center gap-1"
                        >
                          {copiedId === order.id ? <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                          <span>{copiedId === order.id ? t.copied : t.copyAll}</span>
                        </button>
                        <button
                          onClick={() => handleDownload(order)}
                          className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 hover:dark:text-emerald-300 font-semibold flex items-center gap-1 ml-2"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>{t.downloadTxt}</span>
                        </button>
                      </div>
                    </div>

                    <DeliveredAccounts
                      accounts={order.accounts}
                      copyLabel={t.copyOne}
                      copiedLabel={t.copied}
                      copiedToastMessage={t.copiedAccountToast}
                      replacedAccounts={order.warrantyReplacedAccounts}
                      warrantyBadgeLabel={t.warrantyReplacedBadge}
                    />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Phân trang — chỉ hiện khi danh sách (sau khi lọc) dài hơn 1 trang */}
      {!loading && filteredOrders.length > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-3 mt-5 text-xs">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="flex items-center gap-1 bg-[#e7ebe9] dark:bg-[#292b31] hover:bg-[#dee3e1] hover:dark:bg-[#363941] border border-[#dde2e0] dark:border-[#373b43] text-slate-800 dark:text-slate-200 font-semibold px-3 py-1.5 rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            <span>{t.ordersPrevPage}</span>
          </button>
          <span className="text-slate-600 dark:text-slate-400 font-mono">
            {t.ordersPageIndicatorTemplate.replace('{page}', String(page)).replace('{total}', String(totalPages))}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="flex items-center gap-1 bg-[#e7ebe9] dark:bg-[#292b31] hover:bg-[#dee3e1] hover:dark:bg-[#363941] border border-[#dde2e0] dark:border-[#373b43] text-slate-800 dark:text-slate-200 font-semibold px-3 py-1.5 rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span>{t.ordersNextPage}</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};
