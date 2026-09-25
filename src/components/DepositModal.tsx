import React, { useState, useEffect } from 'react';
import { CryptoOption, CryptoNetwork, User, DepositTransaction, Language } from '../types';
import { translations } from '../locales/translations';
import { formatMoney } from '../utils/pricing';
import QRCode from 'qrcode';
import { Wallet, Copy, Check, RefreshCw, ShieldCheck, AlertCircle, Coins, CheckCircle2 } from 'lucide-react';

interface DepositModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User;
  cryptoOptions: CryptoOption[];
  language: Language;
  onBalanceUpdated: (newBalance: number) => void;
}

export const DepositModal: React.FC<DepositModalProps> = ({
  isOpen,
  onClose,
  user,
  cryptoOptions,
  language,
  onBalanceUpdated,
}) => {
  const t = translations[language];
  const [selectedNetwork, setSelectedNetwork] = useState<CryptoNetwork>('bsc');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [isCopied, setIsCopied] = useState(false);
  const [isCheckingRpc, setIsCheckingRpc] = useState(false);
  const [rpcCheckResult, setRpcCheckResult] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(15);
  const [depositHistory, setDepositHistory] = useState<DepositTransaction[]>([]);

  const selectedCrypto = cryptoOptions.find((c) => c.id === selectedNetwork) || cryptoOptions[0];
  // Addresses come from /api/deposit/wallets (always the vault's current
  // record) — the copy cached on the user object can be missing or outdated,
  // and a made-up placeholder must never be shown as somewhere to send money.
  const [walletAddresses, setWalletAddresses] = useState<Record<string, string>>({});
  const userAddress = walletAddresses[selectedNetwork] || user.depositWallets?.[selectedNetwork] || '';

  // Crisp, easily recognizable Crypto Network Logos
  const renderNetworkLogo = (netId: string, size: 'sm' | 'md' | 'lg' = 'md') => {
    const dim = size === 'lg' ? 'w-12 h-12' : size === 'sm' ? 'w-7 h-7' : 'w-9 h-9';
    const subDim = size === 'lg' ? 'w-5 h-5 text-[10px]' : size === 'sm' ? 'w-3 h-3 text-[8px]' : 'w-4 h-4 text-[9px]';

    switch (netId) {
      case 'bsc':
        return (
          <div className="relative flex-shrink-0">
            {/* BNB Chain Golden Logo */}
            <div className={`${dim} rounded-xl bg-gradient-to-br from-[#f8d33a] via-[#f3ba2f] to-[#b3820a] p-0.5 shadow-md shadow-[#f3ba2f]/20 flex items-center justify-center`}>
              <div className="w-full h-full bg-[#121008] rounded-[10px] flex items-center justify-center">
                {/* Clean BNB geometry */}
                <div className="relative w-5 h-5 flex items-center justify-center">
                  <div className="w-2.5 h-2.5 bg-[#f3ba2f] rotate-45" />
                  <div className="absolute -top-0.5 w-1.5 h-1.5 bg-[#f3ba2f] rotate-45" />
                  <div className="absolute -bottom-0.5 w-1.5 h-1.5 bg-[#f3ba2f] rotate-45" />
                  <div className="absolute -left-0.5 w-1.5 h-1.5 bg-[#f3ba2f] rotate-45" />
                  <div className="absolute -right-0.5 w-1.5 h-1.5 bg-[#f3ba2f] rotate-45" />
                </div>
              </div>
            </div>
            {/* Tether Badge */}
            <div className={`absolute -bottom-1 -right-1 ${subDim} rounded-full bg-[#26a17b] border border-[#eef0ef] dark:border-[#202227] text-slate-900 dark:text-slate-100 font-bold flex items-center justify-center shadow`}>
              ₮
            </div>
          </div>
        );

      case 'trc':
        return (
          <div className="relative flex-shrink-0">
            {/* TRON Red Diamond Logo */}
            <div className={`${dim} rounded-xl bg-gradient-to-br from-[#ff5252] via-[#ef0027] to-[#8a0014] p-0.5 shadow-md shadow-[#ef0027]/20 flex items-center justify-center`}>
              <div className="w-full h-full bg-[#160608] rounded-[10px] flex items-center justify-center">
                {/* Clean TRON Prism geometry */}
                <div className="relative w-5 h-5 flex items-center justify-center">
                  <div className="w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-b-[10px] border-b-[#ef0027]" />
                  <div className="absolute top-1.5 w-3 h-2 border-b-2 border-r-2 border-[#ff7b7b] rotate-45" />
                </div>
              </div>
            </div>
            {/* Tether Badge */}
            <div className={`absolute -bottom-1 -right-1 ${subDim} rounded-full bg-[#26a17b] border border-[#eef0ef] dark:border-[#202227] text-slate-900 dark:text-slate-100 font-bold flex items-center justify-center shadow`}>
              ₮
            </div>
          </div>
        );

      case 'polygon':
        return (
          <div className="relative flex-shrink-0">
            {/* Polygon Purple Logo */}
            <div className={`${dim} rounded-xl bg-gradient-to-br from-[#a855f7] via-[#8247e5] to-[#4c1d95] p-0.5 shadow-md shadow-[#8247e5]/20 flex items-center justify-center`}>
              <div className="w-full h-full bg-[#f3f5f4] dark:bg-[#181a1e] rounded-[10px] flex items-center justify-center">
                {/* Polygon infinity link */}
                <div className="w-4 h-4 rounded-full border-2 border-[#a855f7] flex items-center justify-center">
                  <div className="w-1.5 h-1.5 bg-[#a855f7] rounded-full" />
                </div>
              </div>
            </div>
            {/* Tether Badge */}
            <div className={`absolute -bottom-1 -right-1 ${subDim} rounded-full bg-[#26a17b] border border-[#eef0ef] dark:border-[#202227] text-slate-900 dark:text-slate-100 font-bold flex items-center justify-center shadow`}>
              ₮
            </div>
          </div>
        );

      case 'base':
      default:
        return (
          <div className="relative flex-shrink-0">
            {/* Base Electric Blue Logo */}
            <div className={`${dim} rounded-xl bg-gradient-to-br from-[#38bdf8] via-[#0052ff] to-[#dce2e0] p-0.5 shadow-md shadow-[#0052ff]/20 flex items-center justify-center`}>
              <div className="w-full h-full bg-[#f3f5f4] dark:bg-[#181a1e] rounded-[10px] flex items-center justify-center">
                {/* Base solid disc circle */}
                <div className="w-4 h-4 rounded-full bg-[#0052ff] border-2 border-white/80" />
              </div>
            </div>
            {/* USDC Badge */}
            <div className={`absolute -bottom-1 -right-1 ${subDim} rounded-full bg-[#2775ca] border border-[#eef0ef] dark:border-[#202227] text-slate-900 dark:text-slate-100 font-bold flex items-center justify-center shadow`}>
              $
            </div>
          </div>
        );
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    if (!userAddress) {
      setQrDataUrl('');
      return;
    }

    QRCode.toDataURL(userAddress, {
      width: 200,
      margin: 1.5,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
    })
      .then((url) => setQrDataUrl(url))
      .catch((err) => console.error('QR generation error:', err));
  }, [userAddress, isOpen, selectedNetwork]);

  const fetchDeposits = async () => {
    try {
      const res = await fetch('/api/deposit/wallets');
      if (res.ok) {
        const data = await res.json();
        setDepositHistory(data.transactions || []);
        const addresses: Record<string, string> = {};
        for (const w of data.wallets || []) {
          if (w?.id && w.userDepositAddress) addresses[w.id] = w.userDepositAddress;
        }
        setWalletAddresses(addresses);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchDeposits();
    }
  }, [isOpen]);

  const handleCheckRpc = async (isAuto = false) => {
    setIsCheckingRpc(true);
    if (!isAuto) setRpcCheckResult(null);

    try {
      const res = await fetch('/api/deposit/check-rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ network: selectedNetwork }),
      });

      const data = await res.json();
      if (data.creditedNow > 0) {
        setRpcCheckResult(
          t.depositReceivedTemplate
            .replace('{amount}', formatMoney(data.creditedNow))
            .replace('{network}', selectedNetwork.toUpperCase())
            .replace('{balance}', formatMoney(data.currentBalance))
        );
        onBalanceUpdated(data.currentBalance);
        fetchDeposits();
      } else {
        if (!isAuto) {
          setRpcCheckResult(t.depositWatchingTemplate.replace('{addr}', userAddress.slice(0, 8)));
        }
      }
    } catch (err) {
      if (!isAuto) {
        setRpcCheckResult(t.depositScanDoneMsg);
      }
    } finally {
      setIsCheckingRpc(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          handleCheckRpc(true);
          return 15;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isOpen, selectedNetwork]);

  const copyToClipboard = () => {
    if (!userAddress) return;
    navigator.clipboard.writeText(userAddress);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2500);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-[#eef0ef] dark:bg-[#202227] border border-[#e1e4e3] dark:border-[#32363e] rounded-2xl max-w-2xl w-full my-auto shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-[#e2e6e5] dark:border-[#30333b] flex items-center justify-between bg-[#f2f4f3] dark:bg-[#1a1b1f]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#eceeed] dark:bg-[#23252a] border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shadow-sm">
              <Wallet className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">{t.depositTitle}</h2>
              <p className="text-[11px] text-slate-600 dark:text-slate-400">
                {t.depositCurrentBalance} <strong className="text-emerald-600 dark:text-emerald-400 font-mono">${formatMoney(user.balance)}</strong>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:dark:text-slate-100 p-1 rounded-lg hover:bg-slate-200 hover:dark:bg-slate-800 transition"
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          {/* Network Selection */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="font-bold text-slate-800 dark:text-slate-200">{t.selectNetwork}</label>
              <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-mono flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                <span>{t.depositSeparateWalletBadge}</span>
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {cryptoOptions.map((opt) => {
                const isSelected = selectedNetwork === opt.id;
                return (
                  <button
                    key={opt.id}
                    onClick={() => {
                      setSelectedNetwork(opt.id);
                      setRpcCheckResult(null);
                    }}
                    className={`p-3 rounded-xl border text-left transition flex items-center gap-3 relative overflow-hidden group ${
                      isSelected
                        ? 'bg-gradient-to-b from-[#e2e6e5] dark:from-[#30333b] to-[#ebefed] dark:to-[#23252a] border-emerald-400 ring-2 ring-emerald-500/30 text-slate-900 dark:text-slate-100 shadow-lg shadow-emerald-500/15'
                        : 'bg-[#f2f4f3] dark:bg-[#1a1b1f] border-[#e2e6e5] dark:border-[#30333b] hover:border-emerald-500/40 hover:bg-[#edf0ef] hover:dark:bg-[#202328] text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {/* Visual Crypto Logo */}
                    {renderNetworkLogo(opt.id, 'md')}

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <span className={`text-xs font-black font-mono tracking-wide ${isSelected ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-900 dark:text-slate-100'}`}>
                          {opt.token}
                        </span>
                        {isSelected && (
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                        )}
                      </div>
                      <div className="text-[10px] font-bold text-slate-700 dark:text-slate-300 truncate">
                        {opt.id === 'bsc' ? 'BNB Chain' : opt.id === 'trc' ? 'TRON' : opt.id === 'polygon' ? 'Polygon' : 'Base L2'}
                      </div>
                      <div className="text-[9px] font-mono text-slate-600 dark:text-slate-400 truncate">
                        {opt.networkLabel}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Eye-catching Active Network Banner */}
          <div className="p-3.5 bg-gradient-to-r from-[#e9eceb] dark:from-[#27292f] via-[#eef1f0] dark:via-[#1f2126] to-[#f1f4f3] dark:to-[#1b1c20] border border-emerald-500/40 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-md">
            <div className="flex items-center gap-3">
              {renderNetworkLogo(selectedNetwork, 'lg')}
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-black text-slate-900 dark:text-slate-100 font-mono">
                    {selectedCrypto.name}
                  </h4>
                  <span className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-400/30 text-[9px] font-mono font-bold px-2 py-0.5 rounded-full">
                    {selectedCrypto.networkLabel}
                  </span>
                </div>
                <p className="text-[11px] text-slate-700 dark:text-slate-300 mt-0.5">
                  {t.depositSendOnlyBefore} <strong className="text-emerald-600 dark:text-emerald-400 font-bold">{selectedCrypto.token}</strong> {t.depositSendOnlyBetween} <strong className="text-slate-900 dark:text-slate-100 font-bold">{selectedCrypto.networkLabel}</strong>{t.depositSendOnlyAfter}
                </p>
              </div>
            </div>
          </div>

          {/* User Dedicated Address & QR Code */}
          <div className="bg-[#f2f4f3] dark:bg-[#1a1b1f] border border-[#e2e6e5] dark:border-[#30333b] rounded-xl p-4 flex flex-col sm:flex-row items-center gap-4">
            <div className="bg-white p-2 rounded-xl shadow flex-shrink-0 flex flex-col items-center">
              {qrDataUrl ? (
                <img src={qrDataUrl} alt="Wallet QR" className="w-28 h-28" />
              ) : (
                <div className="w-28 h-28 bg-slate-800 dark:bg-slate-200 animate-pulse rounded" />
              )}
            </div>

            <div className="flex-1 w-full flex flex-col justify-between gap-2.5">
              <div>
                <div className="flex items-center justify-between text-slate-600 dark:text-slate-400 text-[11px] mb-1">
                  <span>{t.userWalletAddress}</span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-mono text-[10px]">{t.depositYourUniqueId}</span>
                </div>
                <div className="bg-[#f5f6f6] dark:bg-[#16181b] border border-[#e2e6e5] dark:border-[#30333b] p-2.5 rounded-lg flex items-center justify-between gap-2">
                  <span className="font-mono text-emerald-700 dark:text-emerald-300 text-xs break-all select-all font-semibold">
                    {userAddress || '...'}
                  </span>
                  <button
                    onClick={copyToClipboard}
                    className="p-2 bg-[#e7ebe9] dark:bg-[#292b31] hover:bg-[#dee3e1] hover:dark:bg-[#363941] border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 rounded-lg transition flex-shrink-0 flex items-center gap-1 font-bold text-xs shadow-sm"
                    title={t.copyAddress}
                  >
                    {isCopied ? (
                      <>
                        <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                        <span className="text-emerald-600 dark:text-emerald-400 font-bold">{t.pdCopiedLabel}</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        <span>{t.toolsCopyShort}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-600 dark:text-slate-400 bg-[#f5f6f6] dark:bg-[#16181b] p-2.5 rounded-lg border border-[#e2e6e5] dark:border-[#30333b]">
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span>{t.depositConfirmationsLabel}</span>
                  <span className="font-mono font-bold text-slate-800 dark:text-slate-200">1 Block (~15s)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span>{t.depositFeeLabel}</span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-bold font-mono">{t.depositFeeFreeText}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Balance Check Controls & Auto-polling */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 p-3 bg-[#f2f4f3] dark:bg-[#1a1b1f] border border-[#e2e6e5] dark:border-[#30333b] rounded-xl">
            <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 text-[11px]">
              <RefreshCw className={`w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 ${isCheckingRpc ? 'animate-spin' : ''}`} />
              <span>
                {t.autoScanning}: <strong className="text-emerald-600 dark:text-emerald-400">{countdown}</strong> {t.seconds}
              </span>
            </div>

            <button
              onClick={() => handleCheckRpc(false)}
              disabled={isCheckingRpc}
              className="w-full sm:w-auto bg-[#e7ebe9] dark:bg-[#292b31] hover:bg-[#dee3e1] hover:dark:bg-[#363941] border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 hover:text-slate-900 hover:dark:text-slate-100 font-bold px-4 py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isCheckingRpc ? 'animate-spin' : ''}`} />
              <span>{isCheckingRpc ? t.checkingRpc : t.checkRpcBalance}</span>
            </button>
          </div>

          {rpcCheckResult && (
            <div className="p-3 bg-[#f2f4f3] dark:bg-[#1a1b1f] border border-emerald-500/30 rounded-lg text-emerald-700 dark:text-emerald-300 text-xs">
              {rpcCheckResult}
            </div>
          )}

          {/* Deposit History */}
          <div>
            <h3 className="font-bold text-slate-800 dark:text-slate-200 mb-2">{t.depositHistory}</h3>
            {depositHistory.length === 0 ? (
              <p className="text-slate-600 dark:text-slate-400 text-[11px] italic text-center py-3 bg-[#f2f4f3] dark:bg-[#1a1b1f] rounded-lg border border-[#e2e6e5] dark:border-[#30333b]">
                {t.noDepositHistory}
              </p>
            ) : (
              <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
                {depositHistory.map((tx) => (
                  <div
                    key={tx.id}
                    className="p-2 bg-[#f2f4f3] dark:bg-[#1a1b1f] border border-[#e2e6e5] dark:border-[#30333b] rounded-lg flex items-start justify-between gap-2 text-[11px]"
                  >
                    <div className="min-w-0">
                      <span className="font-bold text-emerald-600 dark:text-emerald-400 font-mono">+${formatMoney(tx.amount)}</span>
                      <span className="text-slate-600 dark:text-slate-400 ml-1.5 uppercase font-semibold">({tx.network})</span>
                      {tx.network === ('admin' as string) && (
                        <div className="text-[10px] text-slate-600 dark:text-slate-400">
                          {language === 'vn' ? 'Admin điều chỉnh số dư' : 'Admin balance adjustment'}
                        </div>
                      )}
                      {tx.txHash && (() => {
                        // Real on-chain hash — opens that transaction on the network's
                        // block explorer so the user can verify it themselves.
                        const explorerBase = cryptoOptions.find((c) => c.id === tx.network)?.explorerTxUrl;
                        return explorerBase ? (
                          <a
                            href={`${explorerBase}${tx.txHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={tx.txHash}
                            className="block text-[10px] text-emerald-700 dark:text-emerald-300 hover:underline font-mono break-all"
                          >
                            {tx.txHash}
                          </a>
                        ) : (
                          <div className="text-[10px] text-slate-600 dark:text-slate-400 font-mono break-all">{tx.txHash}</div>
                        );
                      })()}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                        {tx.status}
                      </span>
                      <div className="text-[10px] text-slate-600 dark:text-slate-400 mt-0.5">
                        {new Date(tx.timestamp).toLocaleTimeString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#e2e6e5] dark:border-[#30333b] bg-[#f2f4f3] dark:bg-[#1a1b1f] flex justify-end">
          <button
            onClick={onClose}
            className="bg-[#e7ebe9] dark:bg-[#292b31] hover:bg-[#dee3e1] hover:dark:bg-[#363941] border border-emerald-500/30 text-slate-800 dark:text-slate-200 text-xs font-semibold px-5 py-2 rounded-lg transition"
          >
            {t.closeBtn}
          </button>
        </div>
      </div>
    </div>
  );
};
