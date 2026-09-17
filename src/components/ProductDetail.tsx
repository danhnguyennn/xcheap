import React, { useState, useEffect, useMemo } from 'react';
import { Product, ProductVariant, Language, User, Review, PreOrder } from '../types';
import { translations } from '../locales/translations';
import { ProductShopArt } from './ProductShopArt';
import { DeliveredAccounts } from './DeliveredAccounts';
import { showCopyToast } from './Toast';
import { formatMoney } from '../utils/pricing';
import {
  ChevronRight,
  ShoppingCart,
  MessageSquare,
  Eye,
  Check,
  Tag,
  ShieldAlert,
  CheckCircle2,
  ExternalLink,
  Copy,
  RefreshCw,
  ShieldCheck,
  Link as LinkIcon,
  XCircle,
  Clock,
  Star,
} from 'lucide-react';

interface ProductDetailProps {
  product: Product;
  user: User | null;
  language: Language;
  onBack: () => void;
  onOpenDeposit: () => void;
  onOpenSampleModal?: (product: Product) => void;
  onOpenTools: () => void;
  onPurchaseSuccess: (orderData: any) => void;
  onRequireLogin: () => void;
}

export const ProductDetail: React.FC<ProductDetailProps> = ({
  product,
  user,
  language,
  onBack,
  onOpenDeposit,
  onOpenSampleModal,
  onOpenTools,
  onPurchaseSuccess,
  onRequireLogin,
}) => {
  const t = translations[language];

  // Live variant/stock data, refreshed from the server after a purchase and
  // on a short interval so displayed stock never goes stale on this page.
  const [liveVariants, setLiveVariants] = useState<ProductVariant[]>(product.variants);
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant>(
    product.variants.find((v) => v.inStock) || product.variants[0]
  );
  const [quantity, setQuantity] = useState(1);
  const [couponCode, setCouponCode] = useState('');
  const [appliedVoucher, setAppliedVoucher] = useState<{ code: string; discountPercent: number } | null>(null);
  const [discountError, setDiscountError] = useState('');
  const [isCheckingCoupon, setIsCheckingCoupon] = useState(false);
  const [activeTab, setActiveTab] = useState<'desc' | 'reviews'>('desc');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successOrder, setSuccessOrder] = useState<any>(null);

  // The user's own pre-orders — used to show "Đã đặt trước" instead of the
  // pre-order button once they've already placed one for this variant.
  const [myPreorders, setMyPreorders] = useState<PreOrder[]>([]);
  const [isPreordering, setIsPreordering] = useState(false);

  // Live Sample Display State (Direct inline, no popup needed) — null until
  // the real /sample fetch resolves, so this never shows a fabricated
  // account while loading or if the request fails.
  const [sampleData, setSampleData] = useState<{
    usernameOnly: string;
    profileUrl: string;
    displayLink: string;
    platform: string;
    status: string;
  } | null>(null);
  const [sampleLoading, setSampleLoading] = useState(false);
  const [sampleError, setSampleError] = useState('');
  const [usernameCopied, setUsernameCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  // Nothing is fetched until the user actually asks to see one — and the
  // server caps how many re-rolls are allowed per product (see
  // remainingViews below), so this can't be used to bulk-scrape real
  // usernames out of the warehouse by spamming "Đổi mẫu khác".
  const [hasRequestedSample, setHasRequestedSample] = useState(false);
  const [remainingViews, setRemainingViews] = useState<number | null>(null);

  const fetchLiveSample = async () => {
    setHasRequestedSample(true);
    setSampleLoading(true);
    setSampleError('');
    try {
      const res = await fetch(`/api/products/${product.id}/sample`);
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.usernameOnly) {
        setSampleData({
          usernameOnly: data.usernameOnly,
          profileUrl: data.profileUrl || `https://x.com/${data.usernameOnly}`,
          displayLink: data.displayLink || `x.com/${data.usernameOnly}`,
          platform: data.platform || product.category,
          status: data.status || t.pdLiveReadyStatus,
        });
        setRemainingViews(typeof data.remainingViews === 'number' ? data.remainingViews : null);
      } else if (res.status === 429) {
        // Hết lượt xem miễn phí: không hiện thông báo lỗi, chỉ khóa nút
        // "Đổi mẫu khác" lại (remainingViews = 0) và giữ nguyên mẫu đang
        // hiển thị thay vì xóa đi.
        setRemainingViews(0);
      } else {
        setSampleData(null);
        setSampleError(data.error || t.pdSampleLoadError);
        if (typeof data.remainingViews === 'number') setRemainingViews(data.remainingViews);
      }
    } catch (e) {
      setSampleData(null);
      setSampleError(t.pdCannotConnect);
    } finally {
      setSampleLoading(false);
    }
  };

  // Switching products resets the sample panel back to its "chưa xem" state
  // rather than carrying over the previous product's account or view count.
  useEffect(() => {
    setHasRequestedSample(false);
    setSampleData(null);
    setSampleError('');
    setRemainingViews(null);
  }, [product.id]);

  // Real reviews from the database — empty until buyers actually leave one.
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(true);

  useEffect(() => {
    setReviewsLoading(true);
    fetch(`/api/products/${product.id}/reviews`)
      .then((res) => (res.ok ? res.json() : { reviews: [] }))
      .then((data) => setReviews(data.reviews || []))
      .catch(() => setReviews([]))
      .finally(() => setReviewsLoading(false));
  }, [product.id]);

  // Review submission — only offered to a logged-in buyer who's actually
  // purchased this product and hasn't reviewed it yet. This is just a UI
  // convenience check; the POST/PUT endpoints re-verify every condition
  // themselves. A "xấu" review (rating <= REVIEW_EDITABLE_MAX_RATING on the
  // server) stays editable so the buyer can revise it later; a "tốt" review
  // is locked forever once submitted.
  const [reviewEligibility, setReviewEligibility] = useState<{
    canReview: boolean;
    alreadyReviewed: boolean;
    existingReview: { rating: number; comment: string } | null;
    canEdit: boolean;
  } | null>(null);
  const [myRating, setMyRating] = useState(5);
  const [myComment, setMyComment] = useState('');
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [reviewSubmitError, setReviewSubmitError] = useState('');
  const [isEditingReview, setIsEditingReview] = useState(false);

  const fetchReviewEligibility = () => {
    if (!user) {
      setReviewEligibility(null);
      return;
    }
    fetch(`/api/products/${product.id}/review-eligibility`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setReviewEligibility(data))
      .catch(() => setReviewEligibility(null));
  };

  useEffect(() => {
    fetchReviewEligibility();
    setIsEditingReview(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id, user?.id]);

  // Đến từ nút "Đánh giá" ở trang Lịch sử mua hàng — tự động mở đúng tab
  // Đánh giá thay vì để user phải tự bấm lại.
  useEffect(() => {
    if (sessionStorage.getItem('xcheap_open_reviews_tab')) {
      setActiveTab('reviews');
      sessionStorage.removeItem('xcheap_open_reviews_tab');
    }
  }, [product.id]);

  const handleSubmitReview = async () => {
    setReviewSubmitError('');
    if (!myComment.trim()) {
      setReviewSubmitError(t.pdReviewCommentRequired);
      return;
    }
    setIsSubmittingReview(true);
    try {
      const editing = isEditingReview;
      const res = await fetch(`/api/products/${product.id}/reviews`, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: myRating, comment: myComment }),
      });
      const data = await res.json();
      if (!res.ok) {
        setReviewSubmitError(data.error || t.pdReviewSubmitError);
      } else {
        setReviews((prev) => (editing ? prev.map((r) => (r.id === data.review.id ? data.review : r)) : [data.review, ...prev]));
        setIsEditingReview(false);
        fetchReviewEligibility();
      }
    } catch (e) {
      setReviewSubmitError(t.pdReviewSubmitError);
    } finally {
      setIsSubmittingReview(false);
    }
  };

  const startEditingReview = () => {
    if (reviewEligibility?.existingReview) {
      setMyRating(reviewEligibility.existingReview.rating);
      setMyComment(reviewEligibility.existingReview.comment);
    }
    setReviewSubmitError('');
    setIsEditingReview(true);
  };

  // Kho câu gợi ý đánh giá — admin quản lý (thêm/sửa/xóa) và lưu trong DB,
  // không còn hardcode trong translations. Chỉ toàn câu khen (không đề xuất
  // câu phàn nàn, kể cả khi user chọn sao thấp — đó là việc họ tự viết,
  // không phải thứ shop chủ động gợi ý).
  const [suggestionPool, setSuggestionPool] = useState<string[]>([]);

  useEffect(() => {
    fetch('/api/review-comment-suggestions')
      .then((res) => (res.ok ? res.json() : { suggestions: [] }))
      .then((data) => setSuggestionPool((data.suggestions || []).map((s: { text: string }) => s.text)))
      .catch(() => setSuggestionPool([]));
  }, []);

  // Chọn ngẫu nhiên 3 câu trong kho mỗi khi xem sản phẩm khác để đỡ nhàm,
  // nhưng giữ nguyên (memo theo product.id + kho gợi ý) trong lúc đang viết
  // để gợi ý không nhảy lung tung mỗi lần gõ phím.
  const reviewSuggestions = useMemo(() => {
    const shuffled = [...suggestionPool];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled.slice(0, 3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id, suggestionPool]);

  // Pull the real stock count from the server: right away when the product
  // changes, again immediately after a purchase, and every 15s in between so
  // the numbers shown here never drift from what's actually in inventory.
  const refreshStock = async () => {
    try {
      const res = await fetch(`/api/products/${product.id}`);
      if (!res.ok) return;
      const data = await res.json();
      const freshVariants: ProductVariant[] | undefined = data.product?.variants;
      if (!freshVariants) return;
      setLiveVariants(freshVariants);
      setSelectedVariant((prev) => freshVariants.find((v) => v.id === prev.id) || prev);
    } catch {
      // Silent: keep showing the last known stock rather than erroring out.
    }
  };

  useEffect(() => {
    setLiveVariants(product.variants);
    setSelectedVariant(product.variants.find((v) => v.inStock) || product.variants[0]);
  }, [product.id]);

  // Kéo danh sách đặt trước của chính user hiện tại về, để biết biến thể
  // đang chọn đã được đặt trước hay chưa (hiện đúng trạng thái thay vì luôn
  // hiện lại nút "Đặt trước").
  const fetchMyPreorders = async () => {
    if (!user) {
      setMyPreorders([]);
      return;
    }
    try {
      const res = await fetch('/api/user/preorders');
      if (!res.ok) return;
      const data = await res.json();
      setMyPreorders(data.preorders || []);
    } catch {
      // Silent — the pre-order button just falls back to its default state.
    }
  };

  useEffect(() => {
    fetchMyPreorders();
  }, [user?.id, product.id]);

  useEffect(() => {
    const STOCK_REFRESH_INTERVAL_MS = 15000;
    const interval = setInterval(refreshStock, STOCK_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [product.id]);

  // Price calculations with CTV discount & coupon
  let unitPrice = selectedVariant.price;
  let userDiscountNote = '';

  // Rounding to 3 decimals here (matching the server's checkout math) keeps
  // this preview in sync with what the customer is actually charged — 2
  // decimals would silently destroy sub-cent variant prices like $0.055.
  if (user?.role === 'ctv') {
    unitPrice = Number((unitPrice * (1 - (user.discountPercent || 12) / 100)).toFixed(3));
    userDiscountNote = `(CTV -${user.discountPercent || 12}%)`;
  } else if (user?.role === 'admin') {
    unitPrice = Number((unitPrice * (1 - (user.discountPercent || 20) / 100)).toFixed(3));
    userDiscountNote = `(Admin -${user.discountPercent || 20}%)`;
  } else if (user?.role === 'user' && (user.vipDiscountPercent || 0) > 0) {
    unitPrice = Number((unitPrice * (1 - user.vipDiscountPercent! / 100)).toFixed(3));
    userDiscountNote = `(VIP -${user.vipDiscountPercent}%)`;
  }

  const priceBeforeVoucher = unitPrice;
  if (appliedVoucher) {
    unitPrice = Number((unitPrice * (1 - appliedVoucher.discountPercent / 100)).toFixed(3));
  }

  const totalPrice = Number((unitPrice * quantity).toFixed(3));

  const handleApplyCoupon = async () => {
    setDiscountError('');
    const code = couponCode.trim().toUpperCase();
    if (!code) {
      setDiscountError(t.pdEnterCouponCode);
      return;
    }

    setIsCheckingCoupon(true);
    try {
      const res = await fetch(
        `/api/vouchers/check/${encodeURIComponent(code)}?productId=${encodeURIComponent(product.id)}&variantId=${encodeURIComponent(selectedVariant.id)}`
      );
      const data = await res.json();
      if (res.ok && data.valid) {
        setAppliedVoucher({ code: data.code, discountPercent: data.discountPercent });
      } else {
        setAppliedVoucher(null);
        setDiscountError(data.error || t.pdInvalidCoupon);
      }
    } catch (e) {
      setDiscountError(t.pdCannotConnect);
    } finally {
      setIsCheckingCoupon(false);
    }
  };

  const handleCheckout = async () => {
    setErrorMessage('');

    if (!user) {
      onRequireLogin();
      return;
    }

    if (!selectedVariant.inStock || selectedVariant.stockCount === 0) {
      setErrorMessage(t.pdVariantOutOfStock);
      return;
    }

    if (user.balance < totalPrice) {
      setErrorMessage(t.insufficientBalance);
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/orders/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: product.id,
          variantId: selectedVariant.id,
          quantity,
          couponCode: appliedVoucher ? appliedVoucher.code : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error || t.pdOrderError);
      } else {
        setSuccessOrder({ ...data.order, newBalance: data.newBalance });
        setQuantity(1);
        refreshStock();
        onPurchaseSuccess(data);
      }
    } catch (err) {
      setErrorMessage(t.pdCannotConnect);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Đặt trước: không trừ tiền, không giao hàng ngay — chỉ ghi nhận nhu cầu.
  // Server sẽ tự động trừ tiền + giao tài khoản (xem fulfillPendingPreorders
  // trong server.ts) ngay khi admin nhập kho đủ hàng cho đúng biến thể này.
  const handlePreorder = async () => {
    setErrorMessage('');
    if (!user) {
      onRequireLogin();
      return;
    }
    setIsPreordering(true);
    try {
      const res = await fetch(`/api/products/${product.id}/preorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variantId: selectedVariant.id, quantity }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error || t.pdPreorderError);
      } else {
        await fetchMyPreorders();
      }
    } catch (err) {
      setErrorMessage(t.pdCannotConnect);
    } finally {
      setIsPreordering(false);
    }
  };

  const handleCancelPreorder = async (preorderId: string) => {
    setIsPreordering(true);
    try {
      const res = await fetch(`/api/user/preorders/${preorderId}`, { method: 'DELETE' });
      if (res.ok) await fetchMyPreorders();
    } catch {
      // Silent — user can just retry the cancel.
    } finally {
      setIsPreordering(false);
    }
  };

  // Đơn đặt trước còn hiệu lực (đang chờ hàng, hoặc đã có hàng nhưng số dư
  // chưa đủ để tự giao) cho đúng biến thể đang được chọn.
  const myPreorderForVariant = myPreorders.find(
    (p) => p.variantId === selectedVariant.id && (p.status === 'pending' || p.status === 'insufficient_balance')
  );

  // CTV/admin always write the description in Vietnamese — for any other
  // site language, show the real machine-translated version cached on the
  // product (see server.ts translateDescriptionToAllLanguages). If that
  // language's translation isn't available (service was unreachable when
  // saved), fall back to the original Vietnamese text rather than showing
  // nothing or a fabricated translation.
  const isTranslatedLanguage = language === 'en' || language === 'zh' || language === 'th';
  const translatedDescription = isTranslatedLanguage ? product.descriptionTranslations?.[language] : undefined;
  const displayDescription = translatedDescription || product.descriptionHtml;
  const descriptionIsMachineTranslated = isTranslatedLanguage && !!translatedDescription;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 mb-4 overflow-x-auto whitespace-nowrap">
        <button onClick={onBack} className="hover:text-slate-800 hover:dark:text-slate-200 transition">
          {t.home}
        </button>
        <ChevronRight className="w-3.5 h-3.5 text-slate-400 dark:text-slate-600" />
        <span className="text-slate-600 dark:text-slate-400">{product.category}</span>
        <ChevronRight className="w-3.5 h-3.5 text-slate-400 dark:text-slate-600" />
        <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{product.name}</span>
      </nav>

      {/* Main product showcase */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pb-6">
        {/* Left Column: Image & Random Sample Preview Box (5 cols) */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          <div className="relative w-full rounded-2xl overflow-hidden bg-[#f2f4f3] dark:bg-[#1a1b1f] border border-[#e2e6e5] dark:border-[#30333b] shadow-sm p-2">
            {/* Badges on product image */}
            <div className="absolute top-4 left-4 flex items-center gap-1.5 z-20">
              {product.inStock ? (
                <span className="bg-emerald-600 text-slate-900 dark:text-slate-100 font-bold text-[10px] px-2.5 py-0.5 rounded-md shadow flex items-center gap-1">
                  <Check className="w-3 h-3" /> {t.available}
                </span>
              ) : (
                <span className="bg-[#3b151a] border border-[#ef4444]/70 text-[#fca5a5] font-medium text-[10px] px-2.5 py-0.5 rounded-full shadow flex items-center gap-1">
                  <XCircle className="w-3 h-3 text-[#f87171]" /> {t.outOfStock}
                </span>
              )}
              <span className="bg-emerald-600 text-slate-900 dark:text-slate-100 font-bold text-[10px] px-2.5 py-0.5 rounded-md shadow">
                {t.instant}
              </span>
            </div>

            <ProductShopArt type={product.image} className="w-full h-80 sm:h-96" />
          </div>

          {/* "Xem ngẫu nhiên sản phẩm" Direct Display (No Popup) */}
          <div className="bg-[#eef0ef] dark:bg-[#202227] border border-[#e1e4e3] dark:border-[#32363e] rounded-xl p-4 flex flex-col gap-3 shadow-md">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="font-bold text-slate-900 dark:text-slate-100 text-xs flex items-center gap-1.5">
                  <Eye className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span>{t.pdSampleTitle}</span>
                </span>
              </div>
              {hasRequestedSample && (
                <div className="flex items-center gap-2">
                  {remainingViews !== null && (
                    <span className="text-[10px] font-mono text-slate-500 dark:text-slate-500">
                      {t.pdRemainingViewsTemplate.replace('{n}', String(remainingViews))}
                    </span>
                  )}
                  <button
                    onClick={fetchLiveSample}
                    disabled={sampleLoading || remainingViews === 0}
                    className="flex items-center gap-1 text-[11px] font-mono text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 hover:dark:text-emerald-300 bg-[#e7ebe9] dark:bg-[#292b31] hover:bg-[#dee3e1] hover:dark:bg-[#363941] border border-emerald-500/30 px-2.5 py-1 rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed"
                    title={t.pdShuffleSample}
                  >
                    <RefreshCw className={`w-3 h-3 ${sampleLoading ? 'animate-spin' : ''}`} />
                    <span>{t.pdShuffleSample}</span>
                  </button>
                </div>
              )}
            </div>

            {/* Direct Sample Display Box — nothing is requested from the
                server until the user actually asks to see one */}
            <div className="bg-[#f2f4f3] dark:bg-[#1a1b1f] border border-[#e2e6e5] dark:border-[#30333b] rounded-xl p-3 space-y-2.5 min-h-[110px] flex flex-col justify-center">
              {!hasRequestedSample ? (
                <div className="flex flex-col items-center justify-center gap-2 py-2">
                  <button
                    onClick={fetchLiveSample}
                    className="flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-slate-100 bg-emerald-500 hover:bg-emerald-400 px-4 py-2 rounded-lg transition shadow-md shadow-emerald-500/20"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>{t.pdViewSampleBtn}</span>
                  </button>
                </div>
              ) : sampleData ? (
                <>
                  {/* Username row */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-[10px] text-slate-600 dark:text-slate-400 block">
                        {t.pdSampleUsernameLabel}
                      </span>
                      <div className="text-slate-900 dark:text-slate-100 font-mono font-bold text-sm tracking-wide flex items-center gap-1.5">
                        <span className="text-emerald-600 dark:text-emerald-400">@</span>
                        <span className="truncate">{sampleData.usernameOnly}</span>
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(sampleData.usernameOnly);
                        setUsernameCopied(true);
                        setTimeout(() => setUsernameCopied(false), 2000);
                      }}
                      className="p-1.5 bg-[#eceeed] dark:bg-[#23252a] hover:bg-[#e2e6e5] hover:dark:bg-[#30333b] border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 rounded-lg text-[10px] flex items-center gap-1 font-mono transition flex-shrink-0"
                      title={t.pdCopyUserTitle}
                    >
                      {usernameCopied ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                          <span className="text-emerald-600 dark:text-emerald-400">{t.pdCopiedLabel}</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>{t.pdCopyUserBtn}</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Direct Link row (e.g. x.com/username) */}
                  <div className="pt-2 border-t border-[#e6e9e8] dark:border-[#2b2e34] flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <span className="text-[10px] text-slate-600 dark:text-slate-400 block mb-0.5">
                        {t.pdDirectLinkLabel}
                      </span>
                      <a
                        href={sampleData.profileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 hover:dark:text-emerald-300 font-mono text-xs font-semibold hover:underline truncate max-w-full"
                        title={sampleData.profileUrl}
                      >
                        <LinkIcon className="w-3 h-3 text-emerald-600 dark:text-emerald-400 flex-shrink-0 group-hover:translate-x-0.5 transition-transform" />
                        <span className="truncate">{sampleData.displayLink}</span>
                        <ExternalLink className="w-3 h-3 text-emerald-700 dark:text-emerald-300 flex-shrink-0 opacity-70 group-hover:opacity-100" />
                      </a>
                    </div>

                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(sampleData.profileUrl);
                        setLinkCopied(true);
                        setTimeout(() => setLinkCopied(false), 2000);
                      }}
                      className="p-1.5 bg-[#eceeed] dark:bg-[#23252a] hover:bg-[#e2e6e5] hover:dark:bg-[#30333b] border border-emerald-500/20 text-slate-700 dark:text-slate-300 hover:text-emerald-700 hover:dark:text-emerald-300 rounded-lg text-[10px] flex items-center gap-1 font-mono transition flex-shrink-0"
                      title={t.pdCopyLinkTitle}
                    >
                      {linkCopied ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                          <span className="text-emerald-600 dark:text-emerald-400">{t.pdCopiedLabel}</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>{t.pdCopyLinkBtn}</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Live Info Badges */}
                  <div className="pt-1.5 flex flex-wrap items-center justify-between gap-1 text-[10px] text-slate-600 dark:text-slate-400 font-mono">
                    <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3" />
                      <span>{sampleData.status}</span>
                    </span>
                    <span className="text-slate-600 dark:text-slate-400">
                      {sampleData.platform}
                    </span>
                  </div>
                </>
              ) : remainingViews === 0 ? (
                // Hết lượt xem miễn phí ngay từ lần bấm đầu tiên (ví dụ:
                // khách đã dùng hết lượt ở phiên trước rồi quay lại) — chỉ
                // hiện lại nút "Xem tài khoản" ở trạng thái khóa, không hiện
                // thông báo lỗi nào cả.
                <div className="flex flex-col items-center justify-center gap-2 py-2">
                  <button
                    disabled
                    className="flex items-center gap-1.5 text-xs font-bold text-slate-500 dark:text-slate-500 bg-[#e2e6e5] dark:bg-[#292b31] px-4 py-2 rounded-lg cursor-not-allowed"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>{t.pdViewSampleBtn}</span>
                  </button>
                </div>
              ) : sampleLoading ? (
                <div className="text-center text-[11px] text-slate-600 dark:text-slate-400 font-mono flex items-center justify-center gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>{t.rsmFetching}</span>
                </div>
              ) : (
                <div className="text-center text-[11px] text-rose-600 dark:text-rose-400 font-mono">
                  {sampleError || t.pdSampleLoadError}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1 border-t border-[#e2e6e5] dark:border-[#30333b] text-[10px] text-slate-600 dark:text-slate-400">
              <span className="flex items-center gap-1 text-slate-700 dark:text-slate-300">
                <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                {t.pdWarranty24h}
              </span>
              <span className="flex items-center gap-1 text-slate-700 dark:text-slate-300">
                <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                {t.pdAutoDeliver}
              </span>
            </div>
          </div>
        </div>

        {/* Right Column: Title, Username, Variants, Quantity, Purchase (7 cols) */}
        <div className="lg:col-span-7 bg-[#eef0ef]/90 dark:bg-[#202227]/90 border border-[#e1e4e3] dark:border-[#32363e] rounded-2xl p-4 sm:p-6 flex flex-col justify-between shadow-sm">
          <div>
            {/* Title */}
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">
              {product.name}
            </h1>

            {/* Price display */}
            <div className="mb-4">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl sm:text-3xl font-black text-emerald-600 dark:text-emerald-400 font-mono">
                  ${formatMoney(unitPrice)}
                </span>
                {selectedVariant.originalPrice && (
                  <span className="text-sm text-slate-600 dark:text-slate-400 line-through font-mono">
                    ${formatMoney(selectedVariant.originalPrice)}
                  </span>
                )}
                {userDiscountNote && (
                  <span className="text-xs text-emerald-600 dark:text-emerald-400 font-bold">
                    {userDiscountNote}
                  </span>
                )}
              </div>
            </div>

            {/* Variants list (Phân loại với dấu tích bên trái, tách biệt hoàn toàn Giảm giá và Hết hàng) */}
            <div className="mb-4">
              <label className="text-xs font-bold text-slate-800 dark:text-slate-200 block mb-2">
                {t.chooseType}
              </label>

              <div className="flex flex-col gap-2">
                {liveVariants.map((variant) => {
                  const isSelected = selectedVariant.id === variant.id;
                  const isVariantOutOfStock = !variant.inStock || variant.stockCount === 0;

                  // discountBadge is computed and saved server-side whenever the
                  // variant's price/originalPrice is edited — read it as-is.
                  const pureDiscount = variant.discountBadge || '';

                  return (
                    <button
                      key={variant.id}
                      onClick={() => {
                        setSelectedVariant(variant);
                        setQuantity(1);
                        // A voucher scoped to a specific variant may no longer apply
                        // once the shopper picks a different one — re-check on demand.
                        if (appliedVoucher) setAppliedVoucher(null);
                      }}
                      className={`text-left p-2.5 rounded-xl border transition flex items-center justify-between gap-2.5 ${
                        isSelected
                          ? 'bg-[#e7ebea] dark:bg-[#292b31] border-emerald-500 text-slate-900 dark:text-slate-100 shadow-md shadow-emerald-500/10'
                          : isVariantOutOfStock
                            ? 'bg-[#eff1f0] dark:bg-[#1e2025] border-[#dee1e0] dark:border-[#373b43] hover:border-slate-400 hover:dark:border-slate-600 text-slate-700 dark:text-slate-300'
                            : 'bg-[#eff1f0] dark:bg-[#1e2025] border-[#e2e6e5] dark:border-[#30333b] hover:border-emerald-500/40 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {/* Cột trái: Dấu tích trực quan + Tên biến thể + Số lượng gọn trên cùng 1 dòng */}
                      <div className="flex items-center gap-2.5 flex-1 min-w-0">
                        <div
                          className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 transition ${
                            isSelected
                              ? 'bg-emerald-500 text-slate-950 font-black'
                              : isVariantOutOfStock
                                ? 'border border-slate-300 dark:border-slate-700 bg-[#eef0ef] dark:bg-[#202227]'
                                : 'border border-slate-400 dark:border-slate-600 bg-[#eef0ef] dark:bg-[#202227]'
                          }`}
                        >
                          {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className={`text-xs font-semibold truncate ${isSelected ? 'text-slate-900 dark:text-slate-100 font-bold' : 'text-slate-800 dark:text-slate-200'}`}>
                            {variant.name}
                          </div>
                          <div className="text-[10px] mt-0.5 font-mono">
                            {isVariantOutOfStock ? (
                              <span className="text-red-600 dark:text-red-400 font-medium">
                                {t.outOfStock}
                              </span>
                            ) : (
                              <span className="text-emerald-700 dark:text-emerald-300/90 font-medium">
                                {variant.stockCount.toLocaleString()} {t.productsAvailable}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Cột phải: Badge Giảm giá chỉ hiện khi còn hàng có thể mua ở mức giá đó */}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {pureDiscount && !isVariantOutOfStock && (
                          <span className="text-[11px] font-black px-2 py-0.5 rounded-md shadow-sm bg-emerald-500 text-slate-900 dark:text-slate-100 shadow-emerald-950/40">
                            {pureDiscount}
                          </span>
                        )}

                        {isVariantOutOfStock && (
                          <span className="bg-[#3b151a] border border-[#ef4444]/70 text-[#fca5a5] text-[11px] font-medium px-2.5 py-0.5 rounded-full shadow-sm">
                            {t.outOfStock}
                          </span>
                        )}

                        <span className={`text-sm font-bold font-mono ml-1 ${isVariantOutOfStock ? 'text-slate-600 dark:text-slate-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                          ${formatMoney(variant.price)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Quantity: Chỉ cho nhập số lượng, số lượng nổi bật dễ nhìn */}
            <div className="mb-4 bg-[#f2f4f3] dark:bg-[#1a1b1f] border border-[#e2e6e5] dark:border-[#30333b] rounded-xl p-3.5">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-bold text-slate-800 dark:text-slate-200">{t.quantity}:</label>
                <span className="text-xs font-bold text-emerald-700 dark:text-emerald-300 font-mono bg-[#e7ebea] dark:bg-[#292b31] px-2.5 py-0.5 rounded-md border border-emerald-500/30 flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${selectedVariant.inStock && selectedVariant.stockCount > 0 ? 'bg-emerald-400 animate-pulse' : 'bg-red-500'}`} />
                  {t.pdStockLabel} {selectedVariant.stockCount.toLocaleString()}
                </span>
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  className="w-9 h-9 flex items-center justify-center bg-[#e7ebe9] dark:bg-[#292b31] hover:bg-[#dee3e1] hover:dark:bg-[#363941] border border-[#dde2e0] dark:border-[#373b43] rounded-lg text-slate-800 dark:text-slate-200 text-lg font-bold disabled:opacity-30 transition"
                  disabled={quantity <= 1}
                >
                  –
                </button>

                <input
                  type="number"
                  min="1"
                  max={selectedVariant.stockCount || 9999}
                  value={quantity}
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    if (isNaN(val) || val <= 0) {
                      setQuantity(1);
                    } else {
                      setQuantity(Math.min(selectedVariant.stockCount || 9999, val));
                    }
                  }}
                  className="w-24 text-center text-sm font-mono font-bold text-slate-900 dark:text-slate-100 bg-[#edf0ef] dark:bg-[#202328] border border-[#dde2e0] dark:border-[#373b43] focus:border-emerald-400 rounded-lg py-1.5 focus:outline-none transition"
                />

                <button
                  type="button"
                  onClick={() => setQuantity(Math.min(selectedVariant.stockCount || 9999, quantity + 1))}
                  className="w-9 h-9 flex items-center justify-center bg-[#e7ebe9] dark:bg-[#292b31] hover:bg-[#dee3e1] hover:dark:bg-[#363941] border border-[#dde2e0] dark:border-[#373b43] rounded-lg text-slate-800 dark:text-slate-200 text-lg font-bold disabled:opacity-30 transition"
                  disabled={quantity >= selectedVariant.stockCount}
                >
                  +
                </button>
              </div>
            </div>

            {/* Coupon Code Input */}
            <div className="mb-4">
              <div className="relative flex items-center">
                <Tag className="absolute left-3 w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <input
                  type="text"
                  value={couponCode}
                  onChange={(e) => {
                    setCouponCode(e.target.value);
                    if (appliedVoucher) setAppliedVoucher(null);
                  }}
                  placeholder={t.couponPlaceholder}
                  className="w-full bg-[#f3f5f4] dark:bg-[#181a1e] border border-[#e0e4e2] dark:border-[#33363e] focus:border-emerald-500 rounded-lg pl-9 pr-24 py-2 text-xs text-slate-800 dark:text-slate-200 placeholder-slate-500 dark:placeholder-slate-500 focus:outline-none transition"
                />
                <button
                  onClick={handleApplyCoupon}
                  disabled={isCheckingCoupon}
                  className="absolute right-1.5 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-900 dark:text-slate-100 text-xs font-bold px-3 py-1 rounded transition shadow-sm shadow-emerald-950/40"
                >
                  {isCheckingCoupon ? t.pdProcessing : t.applyCoupon}
                </button>
              </div>

              {appliedVoucher && (
                <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold mt-1.5 flex items-center gap-1">
                  ✓ {t.pdCouponAppliedTemplate.replace('{code}', appliedVoucher.code)}
                </p>
              )}
              {discountError && (
                <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-1">{discountError}</p>
              )}
            </div>

            {/* Order Line-Item Breakdown */}
            <div className="bg-[#f3f5f4] dark:bg-[#181a1e] border border-[#e2e6e5] dark:border-[#30333b] rounded-xl p-3.5 mb-4 text-xs space-y-2">
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>{t.pdListedUnitPrice}</span>
                <span className="font-mono text-slate-800 dark:text-slate-200">${formatMoney(selectedVariant.price)} × {quantity}</span>
              </div>
              {user && user.discountPercent > 0 && (
                <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                  <span>{t.pdTierDiscount} ({user.role.toUpperCase()} -{user.discountPercent}%):</span>
                  <span className="font-mono">
                    -${formatMoney((selectedVariant.price * (user.discountPercent / 100)) * quantity)}
                  </span>
                </div>
              )}
              {user?.role === 'user' && (user.vipDiscountPercent || 0) > 0 && (
                <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                  <span>{t.pdVipDiscount} (VIP -{user.vipDiscountPercent}%):</span>
                  <span className="font-mono">
                    -${formatMoney((selectedVariant.price * (user.vipDiscountPercent! / 100)) * quantity)}
                  </span>
                </div>
              )}
              {appliedVoucher && (
                <div className="flex justify-between text-emerald-600 dark:text-emerald-400 font-semibold">
                  <span>{t.pdPromoCodeColonTemplate.replace('{code}', `${appliedVoucher.code} (-${appliedVoucher.discountPercent}%)`)}</span>
                  <span className="font-mono font-bold">
                    -${formatMoney((priceBeforeVoucher - unitPrice) * quantity)}
                  </span>
                </div>
              )}
              <div className="flex justify-between text-slate-600 dark:text-slate-400 border-t border-[#e2e6e5] dark:border-[#30333b] pt-2">
                <span>
                  {user ? t.pdCurrentBalance : t.pdLoginToSeeBalance}
                </span>
                <span className="font-mono font-bold text-slate-900 dark:text-slate-100">${formatMoney(user?.balance ?? 0)}</span>
              </div>
              <div className="flex items-center justify-between border-t border-[#e2e6e5] dark:border-[#30333b] pt-2">
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200">{t.totalPrice}</span>
                <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400 font-mono">
                  ${formatMoney(totalPrice)}
                </span>
              </div>
            </div>

            {/* Error or Insufficient Balance Banner */}
            {errorMessage && (
              <div className="mb-3 p-3 bg-red-50 dark:bg-red-950/70 border border-red-500/50 rounded-lg text-xs text-red-800 dark:text-red-200 flex flex-col gap-1.5">
                <div className="flex items-center gap-1.5 font-bold">
                  <ShieldAlert className="w-4 h-4 text-red-600 dark:text-red-400" />
                  <span>{errorMessage}</span>
                </div>
                {user && user.balance < totalPrice && (
                  <button
                    onClick={onOpenDeposit}
                    className="self-start mt-1 bg-emerald-600 hover:bg-emerald-500 text-slate-900 dark:text-slate-100 font-bold px-3 py-1 rounded text-xs transition"
                  >
                    + {t.deposit} (${formatMoney(user.balance)} {t.pdAvailableSuffix})
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row items-center gap-3">
            {!selectedVariant.inStock || selectedVariant.stockCount === 0 ? (
              myPreorderForVariant ? (
                // Đã đặt trước rồi — hiện trạng thái thay vì cho bấm lại,
                // kèm nút hủy nếu muốn đặt trước lại từ đầu.
                <div className="w-full sm:flex-1 flex items-center justify-between gap-2 bg-amber-50 dark:bg-amber-950/40 border-2 border-amber-500/60 text-amber-800 dark:text-amber-300 text-xs font-semibold py-2.5 px-3.5 rounded-xl shadow-md">
                  <div className="flex items-center gap-2 min-w-0">
                    <Clock className="w-4 h-4 flex-shrink-0" />
                    <span className="truncate">
                      {myPreorderForVariant.status === 'insufficient_balance'
                        ? t.pdPreorderInsufficientBalance
                        : t.pdPreorderPendingTemplate.replace('{n}', String(myPreorderForVariant.quantity))}
                    </span>
                  </div>
                  <button
                    onClick={() => handleCancelPreorder(myPreorderForVariant.id)}
                    disabled={isPreordering}
                    className="flex-shrink-0 text-[11px] font-bold underline underline-offset-2 hover:text-amber-950 hover:dark:text-amber-100 disabled:opacity-50"
                  >
                    {t.pdPreorderCancelBtn}
                  </button>
                </div>
              ) : (
                <button
                  onClick={handlePreorder}
                  disabled={isPreordering}
                  className="w-full sm:flex-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-sm py-3 rounded-xl flex items-center justify-center gap-2 transition disabled:opacity-50 shadow-md shadow-amber-500/20"
                >
                  <Clock className="w-4 h-4" />
                  <span>{isPreordering ? t.pdProcessing : t.pdPreorderButton}</span>
                </button>
              )
            ) : (
              <button
                onClick={handleCheckout}
                disabled={isSubmitting}
                className="w-full sm:flex-1 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-sm py-3 rounded-xl flex items-center justify-center gap-2 transition disabled:opacity-50 shadow-md shadow-emerald-500/20"
              >
                <ShoppingCart className="w-4 h-4" />
                <span>{isSubmitting ? t.pdProcessing : t.buyNow}</span>
              </button>
            )}

            <button
              onClick={() => window.open('https://t.me/Will_XCheap', '_blank')}
              className="w-full sm:w-auto bg-[#eceeed] dark:bg-[#23252a] hover:bg-[#e3e7e6] hover:dark:bg-[#2f3239] border border-emerald-500/40 text-emerald-600 dark:text-emerald-400 hover:text-slate-900 hover:dark:text-slate-100 font-semibold text-xs py-3 px-5 rounded-xl flex items-center justify-center gap-1.5 transition"
            >
              <MessageSquare className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>{t.messageSeller}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-4 bg-[#eef0ef]/90 dark:bg-[#202227]/90 border border-[#e1e4e3] dark:border-[#32363e] rounded-2xl overflow-hidden shadow-sm">
        {/* Tab Headers */}
        <div className="flex border-b border-[#e1e4e3] dark:border-[#32363e] bg-[#f2f4f3] dark:bg-[#1a1b1f]">
          <button
            onClick={() => setActiveTab('desc')}
            className={`px-6 py-3.5 text-xs font-bold transition flex items-center gap-1.5 border-b-2 ${
              activeTab === 'desc'
                ? 'border-emerald-400 text-emerald-600 dark:text-emerald-400 bg-[#eef0ef] dark:bg-[#202227]'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-800 hover:dark:text-slate-200'
            }`}
          >
            <span>ℹ</span>
            <span>{t.tabDescription}</span>
          </button>

          <button
            onClick={() => setActiveTab('reviews')}
            className={`px-6 py-3.5 text-xs font-bold transition flex items-center gap-1.5 border-b-2 ${
              activeTab === 'reviews'
                ? 'border-emerald-400 text-emerald-600 dark:text-emerald-400 bg-[#eef0ef] dark:bg-[#202227]'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-800 hover:dark:text-slate-200'
            }`}
          >
            <span>★</span>
            <span>{t.tabReviews} ({reviews.length})</span>
          </button>
        </div>

        {/* Tab Content */}
        <div className="p-4 sm:p-6 text-xs text-slate-700 dark:text-slate-300 leading-relaxed space-y-4">
          {activeTab === 'desc' ? (
            <>
              <div className="text-slate-900 dark:text-slate-100 font-bold text-sm sm:text-base">
                {product.name}
              </div>

              <div className="p-3 bg-[#f2f4f3] dark:bg-[#1a1b1f] border border-[#e2e6e5] dark:border-[#30333b] rounded-lg text-slate-700 dark:text-slate-300 font-medium">
                {t.pdOneCouponPerOrder}
              </div>

              {/* Mô tả & định dạng tài khoản — do CTV/admin tự viết khi đăng
                  bán, gắn liền với đúng sản phẩm này (không còn là nội dung
                  cố định giống hệt nhau cho mọi sản phẩm). Chỉ hiện khi
                  người bán thực sự đã điền — không bịa nội dung mặc định. */}
              {displayDescription && displayDescription.trim() && (
                <div className="p-3 bg-[#f2f4f3] dark:bg-[#1a1b1f] border border-[#e2e6e5] dark:border-[#30333b] rounded-lg">
                  <div className="text-slate-900 dark:text-slate-100 font-bold mb-1 flex items-center gap-1.5">
                    <span>📝</span>
                    <span>{t.pdAccountSpecsTitle}</span>
                  </div>
                  <p className="whitespace-pre-line text-slate-700 dark:text-slate-300">
                    {displayDescription}
                  </p>
                  {descriptionIsMachineTranslated && (
                    <p className="text-[10px] text-slate-500 dark:text-slate-500 italic mt-1.5">{t.pdAutoTranslatedNote}</p>
                  )}
                </div>
              )}

              {product.accountFormat && product.accountFormat.trim() && (
                <div className="p-3 bg-[#f2f4f3] dark:bg-[#1a1b1f] border border-[#e2e6e5] dark:border-[#30333b] rounded-lg">
                  <div className="text-slate-900 dark:text-slate-100 font-bold mb-1 flex items-center gap-1.5">
                    <span>📂</span>
                    <span>{t.pdAccountFormatLabel}</span>
                  </div>
                  <code className="block font-mono text-emerald-700 dark:text-emerald-300 bg-[#f5f6f6] dark:bg-[#16181b] p-2 rounded text-[11px] break-all border border-[#e6e9e8] dark:border-[#2b2e34]">
                    {product.accountFormat}
                  </code>
                </div>
              )}

              {/* Email Reader panel notice */}
              <div className="p-3 bg-[#f2f4f3] dark:bg-[#1a1b1f] border border-[#e2e6e5] dark:border-[#30333b] rounded-lg">
                <div className="text-slate-900 dark:text-slate-100 font-bold mb-1 flex items-center gap-1.5">
                  <span>✉️</span>
                  <span>{t.pdEmailReaderLabel}</span>
                </div>
                <button
                  onClick={onOpenTools}
                  className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 hover:dark:text-emerald-300 underline flex items-center gap-1 text-[11px] font-mono"
                >
                  {t.pdOpenEmailReaderLink}
                </button>
              </div>

              {/* Warranty policy */}
              <div className="p-3 bg-[#f2f4f3] dark:bg-[#1a1b1f] border border-[#e2e6e5] dark:border-[#30333b] rounded-lg">
                <div className="text-slate-900 dark:text-slate-100 font-bold mb-1.5 flex items-center gap-1.5">
                  <span>🛡️</span>
                  <span>{t.pdWarranty24hTitle}</span>
                </div>
                <p className="text-slate-700 dark:text-slate-300 mb-2">
                  {t.pdWarrantyIntro}
                </p>
                <ul className="space-y-1 text-slate-600 dark:text-slate-400 text-[11px]">
                  <li>- {t.pdWarrantyReason1}</li>
                  <li>- {t.pdWarrantyReason2}</li>
                  <li>- {t.pdWarrantyReason3}</li>
                </ul>
              </div>
            </>
          ) : (
            <div className="space-y-3">
              {(reviewEligibility?.canReview || isEditingReview) && (
                <div className="p-3.5 bg-[#f2f4f3] dark:bg-[#1a1b1f] border border-emerald-500/30 rounded-lg space-y-2.5">
                  <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                    {isEditingReview ? t.pdReviewEditFormTitle : t.pdReviewFormTitle}
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-600 dark:text-slate-400">{t.pdYourRatingLabel}</span>
                    <div className="flex items-center gap-0.5">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button key={n} type="button" onClick={() => setMyRating(n)} className="p-0.5">
                          <Star
                            className={`w-4.5 h-4.5 ${n <= myRating ? 'text-amber-500 fill-amber-500' : 'text-slate-400 dark:text-slate-600'}`}
                          />
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <span className="text-[10px] text-slate-500 dark:text-slate-500">{t.pdReviewSuggestLabel}</span>
                    <div className="flex flex-wrap gap-1.5">
                      {reviewSuggestions.map((suggestion, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setMyComment(suggestion)}
                          className="text-left text-[10px] leading-snug bg-[#eceeed] dark:bg-[#23252a] hover:bg-emerald-50 hover:dark:bg-emerald-950/40 hover:border-emerald-500/40 border border-[#dfe3e1] dark:border-[#353840] text-slate-700 dark:text-slate-300 px-2.5 py-1.5 rounded-lg transition max-w-full sm:max-w-[48%]"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  </div>

                  <textarea
                    value={myComment}
                    onChange={(e) => setMyComment(e.target.value)}
                    placeholder={t.pdReviewCommentPlaceholder}
                    rows={3}
                    maxLength={1000}
                    className="w-full bg-[#f3f5f4] dark:bg-[#181a1e] border border-[#e0e4e2] dark:border-[#33363e] focus:border-emerald-500 rounded-lg px-3 py-2 text-xs text-slate-800 dark:text-slate-200 placeholder-slate-500 dark:placeholder-slate-500 focus:outline-none transition resize-none"
                  />

                  {reviewSubmitError && (
                    <p className="text-[11px] text-rose-600 dark:text-rose-400">{reviewSubmitError}</p>
                  )}

                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleSubmitReview}
                      disabled={isSubmittingReview || !myComment.trim()}
                      className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs px-4 py-2 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isSubmittingReview ? t.pdSubmittingReview : isEditingReview ? t.pdUpdateReviewBtn : t.pdSubmitReviewBtn}
                    </button>
                    {isEditingReview && (
                      <button
                        onClick={() => {
                          setIsEditingReview(false);
                          setReviewSubmitError('');
                        }}
                        disabled={isSubmittingReview}
                        className="text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:dark:text-slate-100 text-xs font-semibold px-2"
                      >
                        {t.pdCancelEditReview}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {reviewEligibility?.alreadyReviewed && !isEditingReview && (
                reviewEligibility.canEdit ? (
                  <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-500/30 rounded-lg text-[11px] text-amber-800 dark:text-amber-300 flex items-center justify-between gap-2 flex-wrap">
                    <span>{t.pdReviewCanRevise}</span>
                    <button
                      onClick={startEditingReview}
                      className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-[11px] px-3 py-1.5 rounded-lg transition flex-shrink-0"
                    >
                      {t.pdEditReviewBtn}
                    </button>
                  </div>
                ) : (
                  <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-500/30 rounded-lg text-[11px] text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>{t.pdReviewSubmitted}</span>
                  </div>
                )
              )}

              {reviewsLoading ? (
                <div className="text-center text-slate-600 dark:text-slate-400 py-6">{t.rsmFetching}</div>
              ) : reviews.length === 0 ? (
                <div className="text-center text-slate-600 dark:text-slate-400 py-6">{t.noReviewsYet}</div>
              ) : (
                reviews.map((rev) => (
                  <div key={rev.id} className="p-3 bg-[#f2f4f3] dark:bg-[#1a1b1f] border border-[#e2e6e5] dark:border-[#30333b] rounded-lg">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-slate-900 dark:text-slate-100">{rev.author}</span>
                      <span className="text-[10px] text-slate-600 dark:text-slate-400">{new Date(rev.date).toLocaleDateString()}</span>
                    </div>
                    <div className="text-amber-600 dark:text-amber-400 text-xs mb-1">{'★'.repeat(rev.rating)}{'☆'.repeat(5 - rev.rating)}</div>
                    <p className="text-slate-700 dark:text-slate-300 text-xs">{rev.comment}</p>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Payment Success Modal */}
      {successOrder && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#eef0ef] dark:bg-[#202227] border border-emerald-500/30 rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            {/* Celebratory success header */}
            <div className="relative flex-shrink-0 bg-gradient-to-b from-emerald-500/15 via-emerald-500/5 to-transparent px-6 pt-8 pb-6 text-center border-b border-[#e2e6e5] dark:border-[#30333b]">
              <div className="relative inline-flex items-center justify-center mb-3">
                <span className="absolute inset-0 rounded-full bg-emerald-400/30 animate-ping" />
                <span className="relative w-16 h-16 rounded-full bg-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/30">
                  <CheckCircle2 className="w-9 h-9 text-slate-900 dark:text-slate-100" strokeWidth={2.5} />
                </span>
              </div>
              <h2 className="text-lg sm:text-xl font-black text-slate-900 dark:text-slate-100 mb-1">
                {t.pdPaymentSuccessTitle}
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                {t.pdPaymentSuccessDesc}
              </p>
            </div>

            <div className="p-5 sm:p-6 space-y-4 overflow-y-auto">
              {/* Receipt summary */}
              <div className="bg-[#f2f4f3] dark:bg-[#1a1b1f] border border-[#e2e6e5] dark:border-[#30333b] rounded-xl divide-y divide-[#e2e6e5] text-xs overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-slate-600 dark:text-slate-400">{t.orderId}</span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-mono font-bold">{successOrder.orderCode}</span>
                </div>
                <div className="flex items-center justify-between px-4 py-2.5 gap-3">
                  <span className="text-slate-600 dark:text-slate-400 flex-shrink-0">{t.product}</span>
                  <span className="text-slate-800 dark:text-slate-200 font-semibold text-right truncate">{successOrder.productName}</span>
                </div>
                <div className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-slate-600 dark:text-slate-400">{t.pdQuantityLabel}</span>
                  <span className="text-slate-800 dark:text-slate-200 font-mono">{successOrder.quantity} × ${formatMoney(successOrder.unitPrice)}</span>
                </div>
                <div className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-slate-600 dark:text-slate-400 font-semibold">{t.pdTotalPaid}</span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-mono font-black text-sm">${formatMoney(successOrder.totalPrice)}</span>
                </div>
                {typeof successOrder.newBalance === 'number' && (
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-slate-600 dark:text-slate-400">{t.pdRemainingBalance}</span>
                    <span className="text-slate-800 dark:text-slate-200 font-mono font-bold">${formatMoney(successOrder.newBalance)}</span>
                  </div>
                )}
              </div>

              {/* Delivered accounts */}
              <div className="bg-[#f2f4f3] dark:bg-[#1a1b1f] border border-[#e2e6e5] dark:border-[#30333b] rounded-xl p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">{t.deliveredAccounts}:</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(successOrder.accounts.join('\n'));
                      showCopyToast(t.copiedAllAccountsToast.replace('{n}', String(successOrder.accounts.length)));
                    }}
                    className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 hover:dark:text-emerald-300 text-xs font-semibold"
                  >
                    {t.copyAll}
                  </button>
                </div>
                <DeliveredAccounts
                  accounts={successOrder.accounts}
                  copyLabel={t.copyOne}
                  copiedLabel={t.copied}
                  copiedToastMessage={t.copiedAccountToast}
                />
              </div>
            </div>

            <div className="flex-shrink-0 flex items-center justify-end gap-3 px-5 sm:px-6 py-4 border-t border-[#e2e6e5] dark:border-[#30333b] bg-[#f2f4f3]/60 dark:bg-[#1a1b1f]/60">
              <button
                onClick={() => {
                  const blob = new Blob([successOrder.accounts.join('\n')], { type: 'text/plain;charset=utf-8' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${successOrder.orderCode}.txt`;
                  a.click();
                }}
                className="bg-[#e7ebe9] dark:bg-[#292b31] hover:bg-[#dee3e1] hover:dark:bg-[#363941] border border-emerald-500/30 text-slate-800 dark:text-slate-200 text-xs font-semibold px-4 py-2 rounded-lg transition"
              >
                {t.downloadTxt}
              </button>
              <button
                onClick={() => setSuccessOrder(null)}
                className="bg-gradient-to-r from-emerald-500 to-emerald-500 hover:from-emerald-400 hover:to-emerald-400 text-slate-950 text-xs font-bold px-5 py-2 rounded-lg transition shadow-md shadow-emerald-500/20"
              >
                {t.pdDone}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
