import React, { useState, useEffect } from 'react';
import { Language, User } from '../types';
import { showCopyToast } from '../components/Toast';
import {
  ArrowLeft,
  Code2,
  KeyRound,
  Package,
  ShoppingCart,
  Wallet,
  Store,
  Copy,
  RefreshCw,
  Eye,
  EyeOff,
} from 'lucide-react';

interface ApiDocsPageProps {
  user: User;
  language: Language;
  onBackToStore: () => void;
}

type AuthLevel = 'public' | 'user' | 'ctv' | 'admin';

interface ApiParam {
  name: string;
  type: string;
  description: string;
}

interface ApiEndpoint {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  auth: AuthLevel;
  description: string;
  pathParams?: ApiParam[];
  queryParams?: ApiParam[];
  body?: string;
  response: string;
}

const ERROR_CODES: { code: string; colorClass: string; description: string }[] = [
  { code: '200', colorClass: 'text-emerald-600 dark:text-emerald-400', description: 'Thành công — luôn kèm field "success": true trong response.' },
  { code: '400', colorClass: 'text-amber-600 dark:text-amber-400', description: 'Thiếu tham số, dữ liệu không hợp lệ, hết hàng, hoặc không đủ số dư.' },
  { code: '401', colorClass: 'text-red-600 dark:text-red-400', description: 'Chưa đăng nhập hoặc phiên (session cookie) đã hết hạn — đăng nhập lại để lấy cookie mới.' },
  { code: '404', colorClass: 'text-red-600 dark:text-red-400', description: 'Không tìm thấy sản phẩm / đơn hàng / mã giảm giá được yêu cầu.' },
  { code: '429', colorClass: 'text-amber-600 dark:text-amber-400', description: 'Request trước đó (cùng loại) vẫn đang được xử lý — đợi rồi thử lại, tránh gọi trùng lặp liên tục.' },
];

interface ApiSection {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  endpoints: ApiEndpoint[];
}

const AUTH_LABELS: Record<AuthLevel, string> = {
  public: 'Công khai',
  user: 'Cần API Key',
  ctv: 'CTV / Admin',
  admin: 'Admin',
};

const AUTH_CLASSES: Record<AuthLevel, string> = {
  public: 'bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30',
  user: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  ctv: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30',
  admin: 'bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/30',
};

const METHOD_CLASSES: Record<ApiEndpoint['method'], string> = {
  GET: 'bg-emerald-500 text-slate-950',
  POST: 'bg-amber-500 text-slate-950',
  PUT: 'bg-purple-500 text-slate-950',
  DELETE: 'bg-red-500 text-slate-950',
};

const SECTIONS: ApiSection[] = [
  {
    title: 'Tài khoản',
    icon: KeyRound,
    endpoints: [
      {
        method: 'GET',
        path: '/api/user/me',
        auth: 'user',
        description: 'Lấy thông tin tài khoản đang đăng nhập, kèm tổng đã nạp/đã chi và hạng VIP.',
        response: `{ "id": "...", "username": "myuser", "role": "user", "balance": 12.5, "vipDiscountPercent": 3, "totalDeposited": 50, "totalSpent": 37.5 }`,
      },
    ],
  },
  {
    title: 'Sản phẩm',
    icon: Package,
    endpoints: [
      {
        method: 'GET',
        path: '/api/products',
        auth: 'public',
        description:
          'Danh sách toàn bộ sản phẩm. Tồn kho từng biến thể, đánh giá và badge giảm giá luôn được tính trực tiếp từ dữ liệu thật (kho hàng / đánh giá / giá), không phải số tĩnh lưu sẵn.',
        response: `{ "products": [ { "id": "prod-...", "name": "...", "price": 0.45, "variants": [ { "id": "var-...", "price": 0.48, "stockCount": 12, "inStock": true } ] } ] }`,
      },
      {
        method: 'GET',
        path: '/api/products/:id',
        auth: 'public',
        description: 'Chi tiết 1 sản phẩm kèm toàn bộ biến thể và tồn kho thật.',
        pathParams: [{ name: 'id', type: 'string', description: 'ID sản phẩm (vd: prod-twitter-search-top)' }],
        response: `{ "product": { "id": "prod-...", "name": "...", "variants": [ ... ] } }`,
      },
      {
        method: 'GET',
        path: '/api/categories',
        auth: 'public',
        description: 'Danh sách danh mục sản phẩm.',
        response: `{ "categories": [ { "id": "...", "name": "Twitter / X", "slug": "twitter" } ] }`,
      },
    ],
  },
  {
    title: 'Đơn hàng & Thanh toán',
    icon: ShoppingCart,
    endpoints: [
      {
        method: 'POST',
        path: '/api/orders/checkout',
        auth: 'user',
        description:
          'Mua hàng. Kho được giữ chỗ nguyên tử trước khi trừ tiền — nếu không đủ hàng hoặc không đủ số dư, không có gì bị trừ. Số dư được trừ nguyên tử (guard >= giá tiền) nên gọi đồng thời nhiều lần không thể mua vượt số dư thật.',
        body: `{ "productId": "prod-...", "variantId": "var-...", "quantity": 1, "couponCode": "MÃ_GIẢM_GIÁ (tùy chọn)" }`,
        response: `{ "success": true, "order": { "orderCode": "XSCR-...", "accounts": [ "uid|pass|2fa|mail|mailpass|cookie" ] }, "newBalance": 11.9 }`,
      },
      {
        method: 'GET',
        path: '/api/orders',
        auth: 'user',
        description:
          'Lịch sử đơn hàng của tài khoản hiện tại (Admin thấy toàn bộ đơn hàng hệ thống), mới nhất trước. Bỏ trống page/limit để lấy toàn bộ danh sách một lần; truyền vào để phân trang.',
        queryParams: [
          { name: 'page', type: 'number', description: 'Trang cần lấy, bắt đầu từ 1 (tùy chọn)' },
          { name: 'limit', type: 'number', description: 'Số đơn mỗi trang, tối đa 100 (tùy chọn)' },
        ],
        response: `{ "orders": [ { "orderCode": "XSCR-...", "productName": "...", "totalPrice": 0.45, "accounts": [ "..." ] } ], "total": 32, "page": 1, "limit": 20 }`,
      },
      {
        method: 'GET',
        path: '/api/orders/:orderCode',
        auth: 'user',
        description: 'Chi tiết đầy đủ 1 đơn hàng theo mã đơn. Chỉ chủ đơn hàng hoặc Admin mới xem được — trả 404 với mọi trường hợp khác.',
        pathParams: [{ name: 'orderCode', type: 'string', description: 'Mã đơn hàng (vd: XSCR-ABC123)' }],
        response: `{ "order": { "orderCode": "XSCR-...", "productName": "...", "variantName": "...", "quantity": 1, "unitPrice": 0.45, "totalPrice": 0.45, "accounts": [ "..." ], "status": "completed", "createdAt": "..." } }`,
      },
    ],
  },
  {
    title: 'Ví & Nạp tiền',
    icon: Wallet,
    endpoints: [
      {
        method: 'GET',
        path: '/api/deposit/wallets',
        auth: 'user',
        description: 'Địa chỉ ví nạp riêng của tài khoản (1 địa chỉ/mạng, cố định) và lịch sử nạp tiền (mới nhất trước).',
        response: `{ "wallets": [ { "id": "bsc", "userDepositAddress": "0x..." } ], "userBalance": 12.5, "transactions": [ { "amount": 5, "network": "bsc", "txHash": "0x...", "status": "confirmed" } ] }`,
      },
    ],
  },
  {
    title: 'CTV — Bán hàng & Kho',
    icon: Store,
    endpoints: [
      {
        method: 'GET',
        path: '/api/ctv/stats',
        auth: 'ctv',
        description: 'Doanh thu, phí sàn, lợi nhuận thực nhận, số dư khả dụng rút, tồn kho của CTV.',
        response: `{ "stats": { "grossRevenue": 100, "feeAmount": 5, "netProfit": 95, "withdrawableBalance": 40 } }`,
      },
      {
        method: 'GET',
        path: '/api/ctv/stats/charts',
        auth: 'ctv',
        description: 'Doanh thu 14 ngày gần nhất theo từng ngày + top 5 sản phẩm bán chạy, phục vụ vẽ biểu đồ.',
        response: `{ "daily": [ { "date": "2026-09-01", "revenue": 3.2, "orders": 4 } ], "topProducts": [ { "name": "...", "revenue": 12.5 } ] }`,
      },
      {
        method: 'POST',
        path: '/api/ctv/products',
        auth: 'ctv',
        description: 'Đăng bán sản phẩm mới, có thể dán kèm danh sách tài khoản để nhập kho ngay.',
        body: `{ "name": "...", "category": "Twitter / X", "price": 0.5, "variantName": "Tiêu chuẩn", "rawAccounts": "uid1|pass1|2fa1\\nuid2|pass2|2fa2" }`,
        response: `{ "success": true, "product": { ... }, "importedCount": 2, "duplicateCount": 0 }`,
      },
      {
        method: 'POST',
        path: '/api/admin/stock/bulk-import',
        auth: 'ctv',
        description:
          'Nhập thêm tài khoản vào kho cho 1 sản phẩm/biến thể đã có sẵn. Tự động bỏ qua tài khoản trùng username đã tồn tại ở bất kỳ đâu trong kho (không chỉ riêng biến thể này).',
        body: `{ "productId": "prod-...", "variantId": "var-...", "rawAccounts": "uid1|pass1|2fa1\\nuid2|pass2|2fa2" }`,
        response: `{ "success": true, "importedCount": 2, "duplicateCount": 0, "totalVariantStock": 14 }`,
      },
      {
        method: 'POST',
        path: '/api/ctv/withdraw',
        auth: 'ctv',
        description: 'Gửi yêu cầu rút lợi nhuận (tối thiểu $5, chờ Admin duyệt).',
        body: `{ "amount": 20, "method": "crypto", "network": "bsc", "walletAddress": "0x..." }`,
        response: `{ "success": true, "withdrawal": { "status": "pending", "amount": 20 } }`,
      },
    ],
  },
];

function buildCurl(origin: string, ep: ApiEndpoint, apiKey: string | null): string {
  let path = ep.path;
  (ep.pathParams || []).forEach((p) => {
    path = path.replace(`:${p.name}`, `<${p.name}>`);
  });
  if (ep.queryParams && ep.queryParams.length > 0) {
    path += '?' + ep.queryParams.map((p) => `${p.name}=<${p.name}>`).join('&');
  }

  const lines = [`curl -X ${ep.method} ${origin}${path}`];
  if (ep.auth !== 'public') {
    lines.push(`  -H "Authorization: Bearer ${apiKey || '<api_key_của_bạn>'}"`);
  }
  if (ep.body) {
    lines.push(`  -H "Content-Type: application/json"`, `  -d '${ep.body.replace(/\n\s*/g, ' ')}'`);
  }
  return lines.join(' \\\n');
}

export const ApiDocsPage: React.FC<ApiDocsPageProps> = ({ user, onBackToStore }) => {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://xcheap.top';
  const isPowerUser = user.role === 'ctv' || user.role === 'admin';

  const [apiKey, setApiKey] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => {
    fetch('/api/user/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setApiKey(data?.user?.apiKey || null))
      .catch(() => setApiKey(null));
  }, []);

  const handleRegenerate = async () => {
    if (!confirm('Tạo API key mới sẽ làm key cũ ngừng hoạt động ngay lập tức. Tiếp tục?')) return;
    setRegenerating(true);
    try {
      const res = await fetch('/api/user/api-key/regenerate', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setApiKey(data.apiKey);
        setShowKey(true);
        showCopyToast('Đã tạo API key mới');
      }
    } finally {
      setRegenerating(false);
    }
  };

  // Regular users only see the endpoints they can actually call — the
  // everyday "mua hàng, check số dư" surface. CTV/Admin-only endpoints
  // (CTV inventory & payouts) stay hidden for them rather than showing API
  // calls that would just 403.
  const visibleSections = SECTIONS.map((section) => ({
    ...section,
    endpoints: section.endpoints.filter((ep) => ep.auth === 'public' || ep.auth === 'user' || isPowerUser),
  })).filter((section) => section.endpoints.length > 0);

  const handleCopyCurl = (ep: ApiEndpoint) => {
    navigator.clipboard.writeText(buildCurl(origin, ep, apiKey));
    showCopyToast('Đã sao chép lệnh curl');
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
      <button
        onClick={onBackToStore}
        className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:dark:text-slate-100 mb-4 transition"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        <span>Quay lại cửa hàng</span>
      </button>

      {/* Header */}
      <div className="bg-[#eef0ef] dark:bg-[#202227] border border-[#e1e4e3] dark:border-[#32363e] rounded-2xl p-5 mb-4 flex items-start gap-4">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-500/30 to-amber-600/30 border border-amber-500/40 flex items-center justify-center flex-shrink-0">
          <Code2 className="w-5 h-5 text-amber-700 dark:text-amber-300" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Tài liệu API</h1>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
            Gửi API key ở header <code className="font-mono bg-[#f2f4f3] dark:bg-[#1a1b1f] px-1 rounded">Authorization: Bearer &lt;api_key&gt;</code> cho mọi request cần đăng nhập.
          </p>
        </div>
      </div>

      {/* Your API Key */}
      <div className="bg-[#eef0ef] dark:bg-[#202227] border border-emerald-500/30 rounded-2xl p-4 sm:p-5 mb-4">
        <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2 mb-2">
          <KeyRound className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <span>API Key của bạn</span>
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          <code className="flex-1 min-w-[200px] font-mono text-xs bg-[#181a1e] text-emerald-300 px-3 py-2 rounded-lg break-all">
            {apiKey ? (showKey ? apiKey : '•'.repeat(28)) : 'Đang tải...'}
          </code>
          <button
            onClick={() => setShowKey((s) => !s)}
            disabled={!apiKey}
            className="p-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:dark:text-slate-100 disabled:opacity-40 transition"
            title={showKey ? 'Ẩn' : 'Hiện'}
          >
            {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
          <button
            onClick={() => {
              if (apiKey) {
                navigator.clipboard.writeText(apiKey);
                showCopyToast('Đã sao chép API key');
              }
            }}
            disabled={!apiKey}
            className="p-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:dark:text-slate-100 disabled:opacity-40 transition"
            title="Sao chép"
          >
            <Copy className="w-4 h-4" />
          </button>
          <button
            onClick={handleRegenerate}
            disabled={regenerating}
            className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400 hover:text-amber-800 hover:dark:text-amber-300 disabled:opacity-40 px-2.5 py-2 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${regenerating ? 'animate-spin' : ''}`} />
            <span>Tạo lại</span>
          </button>
        </div>
        <p className="text-[11px] text-slate-500 dark:text-slate-500 mt-2">
          Giữ bí mật key này — bất kỳ ai có key đều thao tác được như chính bạn. Bấm "Tạo lại" nếu nghi ngờ bị lộ.
        </p>
      </div>

      {/* Sections */}
      <div className="space-y-4">
        {visibleSections.map((section) => (
          <div
            key={section.title}
            className="bg-[#eef0ef] dark:bg-[#202227] border border-[#e1e4e3] dark:border-[#32363e] rounded-2xl p-4 sm:p-5"
          >
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2 mb-3">
              <section.icon className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>{section.title}</span>
            </h2>

            <div className="space-y-2">
              {section.endpoints.map((ep) => (
                <details
                  key={ep.method + ep.path}
                  className="group bg-[#f2f4f3] dark:bg-[#1a1b1f] border border-[#e2e6e5] dark:border-[#30333b] rounded-xl overflow-hidden"
                >
                  <summary className="cursor-pointer list-none px-3 py-2.5 flex items-center gap-2.5 flex-wrap select-none">
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded flex-shrink-0 ${METHOD_CLASSES[ep.method]}`}>
                      {ep.method}
                    </span>
                    <span className="font-mono text-xs text-slate-800 dark:text-slate-200 break-all">{ep.path}</span>
                    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ml-auto flex-shrink-0 ${AUTH_CLASSES[ep.auth]}`}>
                      {AUTH_LABELS[ep.auth]}
                    </span>
                  </summary>

                  <div className="px-3 pb-3 pt-1 border-t border-[#e2e6e5] dark:border-[#30333b] space-y-2.5 text-xs">
                    <p className="text-slate-700 dark:text-slate-300 leading-relaxed">{ep.description}</p>

                    {([
                      { label: 'Path Parameters', params: ep.pathParams },
                      { label: 'Query Parameters', params: ep.queryParams },
                    ] as const).map(
                      ({ label, params }) =>
                        params &&
                        params.length > 0 && (
                          <div key={label}>
                            <div className="text-[10px] font-bold text-slate-500 dark:text-slate-500 uppercase mb-1">{label}</div>
                            <div className="border border-[#e2e6e5] dark:border-[#30333b] rounded-lg overflow-hidden">
                              <table className="w-full text-left">
                                <thead className="bg-[#eceeed] dark:bg-[#23252a] text-[10px] text-slate-500 dark:text-slate-500 uppercase">
                                  <tr>
                                    <th className="px-2.5 py-1.5 font-semibold">Name</th>
                                    <th className="px-2.5 py-1.5 font-semibold">Type</th>
                                    <th className="px-2.5 py-1.5 font-semibold">Description</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-[#e2e6e5] dark:divide-[#30333b]">
                                  {params.map((p) => (
                                    <tr key={p.name}>
                                      <td className="px-2.5 py-1.5 font-mono text-emerald-700 dark:text-emerald-400 font-semibold whitespace-nowrap">{p.name}</td>
                                      <td className="px-2.5 py-1.5 font-mono text-slate-600 dark:text-slate-400 whitespace-nowrap">{p.type}</td>
                                      <td className="px-2.5 py-1.5 text-slate-700 dark:text-slate-300">{p.description}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )
                    )}

                    {ep.body && (
                      <div>
                        <div className="text-[10px] font-bold text-slate-500 dark:text-slate-500 uppercase mb-1">Request body</div>
                        <pre className="bg-[#181a1e] text-emerald-300 rounded-lg p-2.5 overflow-x-auto text-[11px] font-mono whitespace-pre-wrap break-all">
                          {ep.body}
                        </pre>
                      </div>
                    )}

                    <div>
                      <div className="text-[10px] font-bold text-slate-500 dark:text-slate-500 uppercase mb-1">Response mẫu</div>
                      <pre className="bg-[#181a1e] text-slate-300 rounded-lg p-2.5 overflow-x-auto text-[11px] font-mono whitespace-pre-wrap break-all">
                        {ep.response}
                      </pre>
                    </div>

                    <button
                      onClick={() => handleCopyCurl(ep)}
                      className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 hover:dark:text-emerald-300 font-semibold text-[11px]"
                    >
                      <Copy className="w-3 h-3" />
                      <span>Sao chép lệnh curl</span>
                    </button>
                  </div>
                </details>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Shared error code reference */}
      <div className="bg-[#eef0ef] dark:bg-[#202227] border border-[#e1e4e3] dark:border-[#32363e] rounded-2xl p-4 sm:p-5 mt-4">
        <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-3">Mã lỗi</h2>
        <div className="border border-[#e2e6e5] dark:border-[#30333b] rounded-xl overflow-hidden">
          <div className="divide-y divide-[#e2e6e5] dark:divide-[#30333b]">
            {ERROR_CODES.map((e) => (
              <div key={e.code} className="flex items-start gap-3 px-3.5 py-2.5 bg-[#f2f4f3] dark:bg-[#1a1b1f] text-xs">
                <span className={`font-mono font-black flex-shrink-0 w-8 ${e.colorClass}`}>{e.code}</span>
                <span className="text-slate-700 dark:text-slate-300 leading-relaxed">{e.description}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
