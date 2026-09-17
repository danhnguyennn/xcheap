import React from 'react';
import { Product, Language } from '../types';
import { translations } from '../locales/translations';
import { ProductShopArt } from './ProductShopArt';
import { getBestDiscount, formatMoney } from '../utils/pricing';

interface HotDealsProps {
  products: Product[];
  language: Language;
  onSelectProduct: (product: Product) => void;
}

export const HotDeals: React.FC<HotDealsProps> = ({ products, language, onSelectProduct }) => {
  const t = translations[language];
  // Select hot deals, prioritize Twitter and Kling AI if available, else first 2
  const hotProducts = products.filter((p) => p.isHot).slice(0, 2);

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 pt-5 pb-3">
      {/* Section Header */}
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-9 h-9 rounded-xl bg-red-50 dark:bg-red-950/70 border border-red-500/50 flex items-center justify-center text-xl shadow-inner">
          🔥
        </div>
        <div>
          <h2 className="text-lg sm:text-xl font-black text-[#ff7866] tracking-tight">
            Hot Deals
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            {t.hotDealsSubtitle}
          </p>
        </div>
      </div>

      {/* 2-Column Responsive Card Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {hotProducts.map((p) => {
          // Show the single best deal across the product and its variants — badge,
          // savings amount and displayed price all come from that same line item
          // so they never show mismatched numbers.
          const bestDeal = getBestDiscount(p);
          const savings = bestDeal ? formatMoney(bestDeal.originalPrice - bestDeal.price) : null;
          const discountPercent = bestDeal ? `-${bestDeal.percent}%` : null;
          const displayPrice = bestDeal ? bestDeal.price : p.price;
          const displayOriginalPrice = bestDeal ? bestDeal.originalPrice : p.originalPrice;
          const totalStock = p.variants.reduce((sum, v) => sum + (v.stockCount || 0), 0);
          const isOutOfStock = !p.inStock || (totalStock === 0 && p.variants.every((v) => !v.inStock));
          const primaryVariant = p.variants[0];

          return (
            <div
              key={p.id}
              onClick={() => onSelectProduct(p)}
              className={`group cursor-pointer bg-[#ecefee] dark:bg-[#222429] hover:bg-[#e8ebea] hover:dark:bg-[#282a30] border transition-all duration-200 rounded-2xl p-3 sm:p-3.5 flex flex-row gap-3.5 sm:gap-4 shadow-lg relative overflow-hidden ${
                isOutOfStock
                  ? 'border-[#2c151a] hover:border-red-500/40'
                  : 'border-[#e0e4e2] dark:border-[#33363e] hover:border-emerald-500/40'
              }`}
            >
              {/* Left: Square 3D Storefront Thumbnail */}
              <div className="relative w-36 h-36 sm:w-44 sm:h-44 rounded-xl overflow-hidden flex-shrink-0 bg-[#f3f5f4] dark:bg-[#181a1e] border border-[#e5e8e7] dark:border-[#2d3036]">
                <ProductShopArt
                  type={p.image}
                  className="w-full h-full object-cover"
                />

                {/* Discount badge only makes sense while the product can actually be bought at that price */}
                {!isOutOfStock && discountPercent && (
                  <span className="absolute top-2 left-2 font-black text-[10px] sm:text-[11px] px-2 py-0.5 rounded-md shadow-md bg-emerald-500 text-slate-900 dark:text-slate-100 shadow-emerald-950/40">
                    {discountPercent}
                  </span>
                )}

                {/* Bottom-Left Save Amount Badge — only shown when there's a real saving */}
                {savings && (
                  <span className="absolute bottom-2 left-2 bg-[#f3f5f4]/95 dark:bg-[#181a1e]/95 text-amber-700 dark:text-amber-300 text-[10px] font-bold px-2 py-0.5 rounded border border-amber-500/25 shadow">
                    {t.savingsTemplate.replace('{amount}', `$${savings}`)}
                  </span>
                )}
              </div>

              {/* Right: Information Column */}
              <div className="flex-1 flex flex-col justify-between min-w-0 py-0.5">
                <div>
                  {/* Category & Stock Status Row */}
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-xs text-slate-600 dark:text-slate-400 font-medium truncate">
                      {p.category}
                    </span>
                    {isOutOfStock ? (
                      <span className="bg-[#3b151a] border border-[#ef4444]/70 text-[#fca5a5] font-medium text-[10px] px-2.5 py-0.5 rounded-full flex-shrink-0 shadow-sm">
                        {t.outOfStock}
                      </span>
                    ) : (
                      <span className="bg-[#f2f4f4] dark:bg-[#1a1b1f] border border-[#22c55e]/40 text-[#4ade80] font-medium text-[10px] px-2.5 py-0.5 rounded-full flex-shrink-0">
                        {t.available}
                      </span>
                    )}
                  </div>

                  {/* Product Title */}
                  <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 group-hover:text-emerald-700 group-hover:dark:text-emerald-300 transition-colors line-clamp-2 leading-snug">
                    {p.name}
                  </h3>

                  {/* Subtitle / Spec Variant + Số lượng đổi màu nổi bật dễ nhìn */}
                  <div className="text-xs font-mono mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="text-slate-700 dark:text-slate-300 font-medium truncate max-w-[140px]">
                      {primaryVariant ? primaryVariant.name : p.category}
                    </span>
                    <span className="text-slate-400 dark:text-slate-600">•</span>
                    {isOutOfStock ? (
                      <span className="text-red-600 dark:text-red-400 font-semibold flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />
                        0 {t.stockZeroWord}
                      </span>
                    ) : (
                      <span className="text-emerald-700 dark:text-emerald-300 font-semibold flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                        {totalStock.toLocaleString()} {t.stockAvailableWord}
                      </span>
                    )}
                  </div>
                </div>

                {/* Bottom Pricing & Rating */}
                <div className="pt-2 border-t border-[#e2e6e5]/70 dark:border-[#30333b]/70">
                  {/* Price Row */}
                  <div className="flex items-baseline gap-2">
                    <span className={`text-xl sm:text-2xl font-black font-mono ${
                      isOutOfStock ? 'text-slate-600 dark:text-slate-400' : 'text-[#ff8f3d]'
                    }`}>
                      ${formatMoney(displayPrice)}
                    </span>
                    {displayOriginalPrice && (
                      <span className="text-xs text-slate-600 dark:text-slate-400 line-through font-mono">
                        ${formatMoney(displayOriginalPrice)}
                      </span>
                    )}
                  </div>

                  {/* Rating Stars Row — reflects the real average from the reviews collection */}
                  <div className="flex items-center gap-1 text-xs mt-1">
                    {p.rating && p.reviewCount > 0 ? (
                      <>
                        <span className="text-amber-600 dark:text-amber-400 tracking-wider">
                          {'★'.repeat(Math.round(p.rating))}{'☆'.repeat(5 - Math.round(p.rating))}
                        </span>
                        <span className="text-slate-600 dark:text-slate-400 text-[11px] font-mono">
                          ({p.reviewCount})
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="text-slate-400 dark:text-slate-600 tracking-wider">☆☆☆☆☆</span>
                        <span className="text-slate-600 dark:text-slate-400 text-[10px]">
                          {t.noReviewsYet}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
