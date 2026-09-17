import React, { useState, useEffect } from 'react';
import { Product, User, Language, UserRole } from '../types';
import { translations } from '../locales/translations';
import { ShieldCheck, Users, PackagePlus, Activity, Database, DollarSign, PlusCircle, Check } from 'lucide-react';

interface AdminPanelProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
  language: Language;
  onRefreshProducts: () => void;
  onRefreshUser: () => void;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({
  isOpen,
  onClose,
  products,
  language,
  onRefreshProducts,
  onRefreshUser,
}) => {
  const t = translations[language];
  const [activeTab, setActiveTab] = useState<'overview' | 'stock' | 'users' | 'rpc'>('overview');
  const [stats, setStats] = useState<any>(null);
  const [userList, setUserList] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Stock import state
  const [selectedProduct, setSelectedProduct] = useState<string>(products[0]?.id || '');
  const [selectedVariant, setSelectedVariant] = useState<string>(products[0]?.variants[0]?.id || '');
  const [rawAccountsInput, setRawAccountsInput] = useState('');
  const [importResult, setImportResult] = useState<string | null>(null);

  // Balance adjustment state
  const [adjustUserId, setAdjustUserId] = useState('');
  const [adjustAmount, setAdjustAmount] = useState<number>(10);
  const [newRoleSelect, setNewRoleSelect] = useState<UserRole>('user');

  const fetchAdminData = async () => {
    setLoading(true);
    try {
      const [statsRes, userRes] = await Promise.all([
        fetch('/api/admin/stats'),
        fetch('/api/user/me'),
      ]);
      const statsData = await statsRes.json();
      const userData = await userRes.json();
      setStats(statsData);
      setUserList(userData.allUsers || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchAdminData();
    }
  }, [isOpen]);

  const handleBulkImport = async () => {
    if (!rawAccountsInput.trim()) return;
    try {
      const res = await fetch('/api/admin/stock/bulk-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: selectedProduct,
          variantId: selectedVariant,
          rawAccounts: rawAccountsInput,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setImportResult(`✅ Nhập thành công ${data.importedCount} tài khoản vào kho!`);
        setRawAccountsInput('');
        onRefreshProducts();
        fetchAdminData();
      } else {
        setImportResult(`❌ Lỗi: ${data.error}`);
      }
    } catch (e) {
      setImportResult('❌ Không thể kết nối tới máy chủ.');
    }
  };

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
      if (res.ok) {
        fetchAdminData();
        onRefreshUser();
      }
    } catch (e) {
      console.error(e);
    }
  };

  if (!isOpen) return null;

  const currentProd = products.find((p) => p.id === selectedProduct) || products[0];

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-[#eceeed] dark:bg-[#23252a] border border-purple-500/40 rounded-2xl max-w-4xl w-full my-auto shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#e0e4e2] dark:border-[#33363e] flex items-center justify-between bg-[#eef1f0] dark:bg-[#1f2126]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-purple-500/20 text-purple-600 dark:text-purple-400 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">{t.adminPanel}</h2>
              <p className="text-[11px] text-slate-600 dark:text-slate-400">Phân quyền User/CTV/Admin & Quản trị kho hàng</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:dark:text-slate-100">
            ✕
          </button>
        </div>

        {/* Tab Headers */}
        <div className="flex border-b border-[#e0e4e2] dark:border-[#33363e] bg-[#eff2f1] dark:bg-[#1d1f24] text-xs font-bold">
          <button
            onClick={() => setActiveTab('overview')}
            className={`flex-1 py-3 px-3 flex items-center justify-center gap-1.5 border-b-2 transition ${
              activeTab === 'overview'
                ? 'border-purple-400 text-purple-600 dark:text-purple-400 bg-[#eceeed] dark:bg-[#23252a]'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-800 hover:dark:text-slate-200'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Tổng quan</span>
          </button>

          <button
            onClick={() => setActiveTab('stock')}
            className={`flex-1 py-3 px-3 flex items-center justify-center gap-1.5 border-b-2 transition ${
              activeTab === 'stock'
                ? 'border-purple-400 text-purple-600 dark:text-purple-400 bg-[#eceeed] dark:bg-[#23252a]'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-800 hover:dark:text-slate-200'
            }`}
          >
            <PackagePlus className="w-3.5 h-3.5" />
            <span>Nhập Kho (Bulk Import)</span>
          </button>

          <button
            onClick={() => setActiveTab('users')}
            className={`flex-1 py-3 px-3 flex items-center justify-center gap-1.5 border-b-2 transition ${
              activeTab === 'users'
                ? 'border-purple-400 text-purple-600 dark:text-purple-400 bg-[#eceeed] dark:bg-[#23252a]'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-800 hover:dark:text-slate-200'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Thành viên & Phân quyền</span>
          </button>

          <button
            onClick={() => setActiveTab('rpc')}
            className={`flex-1 py-3 px-3 flex items-center justify-center gap-1.5 border-b-2 transition ${
              activeTab === 'rpc'
                ? 'border-purple-400 text-purple-600 dark:text-purple-400 bg-[#eceeed] dark:bg-[#23252a]'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-800 hover:dark:text-slate-200'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            <span>RPC Nodes</span>
          </button>
        </div>

        {/* Tab Content */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          {activeTab === 'overview' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3.5 bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dfe3e2] dark:border-[#353840] rounded-xl">
                  <div className="text-slate-600 dark:text-slate-400 text-[11px]">Tổng thành viên</div>
                  <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 font-mono mt-1">
                    {stats?.totalUsers || 3}
                  </div>
                </div>

                <div className="p-3.5 bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dfe3e2] dark:border-[#353840] rounded-xl">
                  <div className="text-slate-600 dark:text-slate-400 text-[11px]">Tổng đơn hàng</div>
                  <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 font-mono mt-1">
                    {stats?.totalOrders || 0}
                  </div>
                </div>

                <div className="p-3.5 bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dfe3e2] dark:border-[#353840] rounded-xl">
                  <div className="text-slate-600 dark:text-slate-400 text-[11px]">Doanh thu đã bán</div>
                  <div className="text-2xl font-black text-amber-600 dark:text-amber-400 font-mono mt-1">
                    ${stats?.totalRevenue ? stats.totalRevenue.toFixed(2) : '0.00'}
                  </div>
                </div>

                <div className="p-3.5 bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dfe3e2] dark:border-[#353840] rounded-xl">
                  <div className="text-slate-600 dark:text-slate-400 text-[11px]">Tài khoản trong kho</div>
                  <div className="text-2xl font-black text-purple-600 dark:text-purple-400 font-mono mt-1">
                    {stats?.totalStock || 11}
                  </div>
                </div>
              </div>

              <div className="p-4 bg-purple-50 dark:bg-purple-950/70 border border-purple-500/30 rounded-xl space-y-2">
                <h4 className="font-bold text-purple-700 dark:text-purple-300">Cơ chế phân quyền hệ thống:</h4>
                <ul className="space-y-1.5 text-slate-700 dark:text-slate-300">
                  <li>• <strong>User:</strong> Mua tài khoản, nạp tiền tự động qua địa chỉ ví riêng, xem đơn hàng, test mẫu ngẫu nhiên.</li>
                  <li>• <strong>CTV (Cộng tác viên):</strong> Hưởng chiết khấu đại lý 12% trên mọi đơn hàng, có quyền truy cập kênh CTV và nhập kho hàng của mình.</li>
                  <li>• <strong>Admin:</strong> Toàn quyền quản trị, chỉnh sửa vai trò thành viên, cộng/trừ số dư, giám sát node RPC và nhập kho bulk hàng loạt.</li>
                </ul>
              </div>
            </div>
          )}

          {activeTab === 'stock' && (
            <div className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-800 dark:text-slate-200 block mb-1">Chọn sản phẩm:</label>
                  <select
                    value={selectedProduct}
                    onChange={(e) => {
                      setSelectedProduct(e.target.value);
                      const p = products.find((prod) => prod.id === e.target.value);
                      if (p && p.variants[0]) setSelectedVariant(p.variants[0].id);
                    }}
                    className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee2e0] dark:border-[#363a43] rounded-lg p-2 text-xs text-slate-800 dark:text-slate-200 focus:outline-none"
                  >
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="font-bold text-slate-800 dark:text-slate-200 block mb-1">Chọn loại / biến thể:</label>
                  <select
                    value={selectedVariant}
                    onChange={(e) => setSelectedVariant(e.target.value)}
                    className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee2e0] dark:border-[#363a43] rounded-lg p-2 text-xs text-slate-800 dark:text-slate-200 focus:outline-none"
                  >
                    {currentProd?.variants.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} (${v.price.toFixed(2)})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-800 dark:text-slate-200 block mb-1">
                  Nhập danh sách tài khoản (Mỗi dòng 1 tài khoản):
                </label>
                <textarea
                  rows={5}
                  value={rawAccountsInput}
                  onChange={(e) => setRawAccountsInput(e.target.value)}
                  placeholder="UID|Password|2FA|Email|EmailPass|BackupCodes|Cookie"
                  className="w-full bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#dee2e0] dark:border-[#363a43] rounded-lg p-2.5 font-mono text-xs text-emerald-700 dark:text-emerald-300 focus:outline-none focus:border-emerald-500"
                />
              </div>

              {importResult && (
                <div className="p-3 bg-[#eef1f0] dark:bg-[#1f2126] border border-emerald-500/40 rounded-lg text-emerald-700 dark:text-emerald-300 font-medium">
                  {importResult}
                </div>
              )}

              <button
                onClick={handleBulkImport}
                className="bg-purple-600 hover:bg-purple-500 text-slate-900 dark:text-slate-100 font-bold px-5 py-2.5 rounded-xl transition shadow flex items-center gap-2"
              >
                <PlusCircle className="w-4 h-4" />
                <span>Nạp hàng vào kho</span>
              </button>
            </div>
          )}

          {activeTab === 'users' && (
            <div className="space-y-3">
              <span className="font-bold text-slate-800 dark:text-slate-200 block">Danh sách thành viên hệ thống:</span>
              <div className="overflow-x-auto bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#e0e4e2] dark:border-[#33363e] rounded-xl">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[#e1e5e4] dark:border-[#32353d] text-slate-600 dark:text-slate-400 text-left">
                      <th className="p-2.5">Tên đăng nhập</th>
                      <th className="p-2.5">Vai trò hiện tại</th>
                      <th className="p-2.5">Số dư ví</th>
                      <th className="p-2.5 text-right">Hành động quản trị</th>
                    </tr>
                  </thead>
                  <tbody>
                    {userList.map((u) => (
                      <tr key={u.id} className="border-b border-[#e6e9e8] dark:border-[#2b2e34] text-slate-800 dark:text-slate-200">
                        <td className="p-2.5 font-bold text-emerald-700 dark:text-emerald-300">{u.username}</td>
                        <td className="p-2.5">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              u.role === 'admin'
                                ? 'bg-purple-500/20 text-purple-600 dark:text-purple-400 border border-purple-500/30'
                                : u.role === 'ctv'
                                ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                                : 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                            }`}
                          >
                            {u.role}
                          </span>
                        </td>
                        <td className="p-2.5 font-mono font-bold text-emerald-600 dark:text-emerald-400">
                          ${u.balance.toFixed(2)}
                        </td>
                        <td className="p-2.5 text-right space-x-1.5">
                          <button
                            onClick={() => handleUpdateUser(u.id, u.role === 'user' ? 'ctv' : u.role === 'ctv' ? 'admin' : 'user')}
                            className="bg-[#e2e6e5] dark:bg-[#30333b] hover:bg-[#dde2e0] hover:dark:bg-[#373b43] text-slate-700 dark:text-slate-300 text-[10px] px-2 py-1 rounded transition"
                          >
                            Đổi Quyền
                          </button>
                          <button
                            onClick={() => handleUpdateUser(u.id, undefined, 20)}
                            className="bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold px-2 py-1 rounded transition"
                          >
                            +$20
                          </button>
                          <button
                            onClick={() => handleUpdateUser(u.id, undefined, -10)}
                            className="bg-rose-600/30 hover:bg-rose-600/50 text-rose-700 dark:text-rose-300 text-[10px] font-bold px-2 py-1 rounded transition"
                          >
                            -$10
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'rpc' && (
            <div className="space-y-3">
              <span className="font-bold text-slate-800 dark:text-slate-200 block">Trạng thái cấu hình Blockchain RPC:</span>
              <div className="space-y-2">
                {stats?.rpcEndpoints?.map((node: any, idx: number) => (
                  <div
                    key={idx}
                    className="p-3 bg-[#eff2f1] dark:bg-[#1d1f24] border border-[#e1e5e4] dark:border-[#32353d] rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                  >
                    <div>
                      <div className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                        <span>{node.network}</span>
                        <span className="bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[10px] px-2 py-0.5 rounded border border-emerald-500/30">
                          ● Online
                        </span>
                      </div>
                      <div className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 mt-0.5">
                        RPC: {node.rpc}
                      </div>
                      <div className="text-[10px] font-mono text-slate-600 dark:text-slate-400">
                        Token Contract: {node.contract} (Decimals: {node.decimals})
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#e0e4e2] dark:border-[#33363e] bg-[#eef1f0] dark:bg-[#1f2126] flex justify-end">
          <button
            onClick={onClose}
            className="bg-[#e2e6e5] dark:bg-[#30333b] hover:bg-[#dde2e0] hover:dark:bg-[#373b43] text-slate-800 dark:text-slate-200 text-xs font-semibold px-5 py-2 rounded-lg transition"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
