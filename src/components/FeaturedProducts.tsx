import React from 'react';
import { Product, Language } from '../types';
import { translations } from '../locales/translations';
import { ProductShopArt } from './ProductShopArt';
import { ChevronRight } from 'lucide-react';
import { getBestDiscount, formatMoney } from '../utils/pricing';

interface FeaturedProductsProps {
  products: Product[];
  language: Language;
  onSelectProduct: (product: Product) => void;
  onViewAll?: () => void;
  onViewAllClick?: () => void;
}

export const FeaturedProducts: React.FC<FeaturedProductsProps> = ({
  products,
  language,
  onSelectProduct,
  onViewAll,
  onViewAllClick,
}) => {
  const t = translations[language];
  const handleViewAll = onViewAll || onViewAllClick;

  // Pick 4-8 featured items (prioritizing the main 4 platforms shown in screenshot: Twitter, Facebook, Gmail, Kling)
  const featured = [...products]
    .sort((a, b) => {
      // Prioritize twitter, facebook, gmail, kling if available
      const order = ['prod-twitter-search-top', 'prod-facebook-clone', 'prod-gmail-pva', 'prod-kling-ai'];
      const aIdx = order.indexOf(a.id);
      const bIdx = order.indexOf(b.id);
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return 0;
    })
    .slice(0, 4);

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 pt-3 pb-8">
      {/* Header with Title and "Xem tất cả >" */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
          {t.featuredProductsTitle}
        </h2>

        <button
          onClick={handleViewAll}
          className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 hover:dark:text-emerald-300 font-semibold text-xs sm:text-sm flex items-center gap-0.5 group transition-colors"
        >
          <span>{t.viewAll}</span>
          <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
        </button>
      </div>

      {/* 2 columns on mobile (fits the screen without huge oversized cards),
          growing to 4 on desktop */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
        {featured.map((p) => {
          const totalStock = p.variants.reduce((sum, v) => sum + (v.stockCount || 0), 0);
          const isOutOfStock = !p.inStock || (totalStock === 0 && p.variants.every((v) => !v.inStock));
          // Show the single best deal across the product and its variants — badge,
          // price and strikethrough price all come from that same line item so
          // they never show mismatched numbers (e.g. an 11% badge next to a
          // price pair that's only actually 4% off).
          const bestDeal = getBestDiscount(p);
          const displayPrice = bestDeal ? bestDeal.price : p.price;
          const displayOriginalPrice = bestDeal ? bestDeal.originalPrice : p.originalPrice;
          const discountBadge = bestDeal ? `-${bestDeal.percent}%` : null;

          return (
            <div
              key={p.id}
              onClick={() => onSelectProduct(p)}
              className={`group cursor-pointer bg-[#ecefee] dark:bg-[#222429] hover:bg-[#e8ebea] hover:dark:bg-[#282a30] border transition-all duration-200 rounded-2xl overflow-hidden shadow-md flex flex-col justify-between ${
                isOutOfStock
                  ? 'border-[#2c151a] hover:border-red-500/40'
                  : 'border-[#e0e4e2] dark:border-[#33363e] hover:border-emerald-500/30'
              }`}
            >
              {/* Top 3D Storefront Image Area */}
              <div className="relative w-full aspect-square overflow-hidden bg-[#f3f5f4] dark:bg-[#181a1e] border-b border-[#e5e8e7] dark:border-[#2d3036]">
                <ProductShopArt
                  type={p.image}
                  className="w-full h-full"
                />

                {/* Discount badge only makes sense while the product can actually be bought at that price */}
                <div className="absolute top-1.5 left-1.5 sm:top-2 sm:left-2 flex flex-wrap items-center gap-1 sm:gap-1.5 z-10">
                  {discountBadge && !isOutOfStock && (
                    <span className="font-black text-[9px] sm:text-[10px] px-1.5 sm:px-2 py-0.5 rounded-md shadow bg-emerald-500 text-slate-900 dark:text-slate-100 shadow-emerald-950/40">
                      {discountBadge}
                    </span>
                  )}

                  {isOutOfStock ? (
                    <span className="bg-[#3b151a] border border-[#ef4444]/70 text-[#fca5a5] font-medium text-[9px] sm:text-[10px] px-2 sm:px-2.5 py-0.5 rounded-full shadow">
                      {t.outOfStock}
                    </span>
                  ) : (
                    <span className="bg-[#f2f4f4] dark:bg-[#1a1b1f] border border-[#22c55e]/40 text-[#4ade80] font-medium text-[9px] sm:text-[10px] px-2 sm:px-2.5 py-0.5 rounded-full shadow">
                      {t.available}
                    </span>
                  )}
                </div>
              </div>

              {/* Bottom Information Card Body */}
              <div className="p-2 sm:p-3.5 flex-1 flex flex-col justify-between">
                <div>
                  {/* Category Name & Số lượng nổi bật dễ nhìn */}
                  <div className="flex items-center justify-between gap-1 text-[10px] sm:text-xs">
                    <span className="text-slate-600 dark:text-slate-400 font-medium truncate">
                      {p.category}
                    </span>
                    <span className="font-mono text-[9px] sm:text-[11px] font-semibold flex items-center gap-1 flex-shrink-0">
                      <span className={`w-1.5 h-1.5 rounded-full ${isOutOfStock ? 'bg-red-500' : 'bg-emerald-400'}`} />
                      <span className={isOutOfStock ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-300'}>
                        {isOutOfStock ? '0' : totalStock.toLocaleString()} {t.stockWordShort}
                      </span>
                    </span>
                  </div>

                  {/* Product Title */}
                  <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 group-hover:text-emerald-700 group-hover:dark:text-emerald-300 transition-colors line-clamp-2 mt-1 leading-snug">
                    {p.name}
                  </h3>
                </div>

                {/* Bottom Price & Star Rating */}
                <div className="mt-2 sm:mt-3 pt-2 sm:pt-2.5 border-t border-[#e2e6e5]/70 dark:border-[#30333b]/70">
                  {/* Price */}
                  <div className="flex items-baseline gap-1.5 sm:gap-2 flex-wrap">
                    <span className={`text-sm sm:text-lg font-black font-mono ${
                      isOutOfStock ? 'text-slate-600 dark:text-slate-400' : 'text-emerald-600 dark:text-emerald-400'
                    }`}>
                      ${formatMoney(displayPrice)}
                    </span>
                    {displayOriginalPrice && (
                      <span className="text-[10px] sm:text-xs text-slate-600 dark:text-slate-400 line-through font-mono">
                        ${formatMoney(displayOriginalPrice)}
                      </span>
                    )}
                  </div>

                  {/* Rating — reflects the real average from the reviews collection */}
                  <div className="flex items-center gap-1 text-[10px] sm:text-xs mt-1">
                    {p.rating && p.reviewCount > 0 ? (
                      <>
                        <span className="text-amber-600 dark:text-amber-400 tracking-wider">
                          {'★'.repeat(Math.round(p.rating))}{'☆'.repeat(5 - Math.round(p.rating))}
                        </span>
                        <span className="text-slate-600 dark:text-slate-400 text-[9px] sm:text-[11px] font-mono">
                          ({p.reviewCount})
                        </span>
                      </>
                    ) : (
                      <span className="text-slate-400 dark:text-slate-600 tracking-wider">☆☆☆☆☆</span>
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
