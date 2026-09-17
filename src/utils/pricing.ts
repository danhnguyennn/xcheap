// Shared pricing helpers so every card/list view surfaces the same
// "best deal" number instead of drifting between product-level and
// variant-level price ratios.

export interface DiscountSource {
  price: number;
  originalPrice?: number;
}

export interface BestDiscount {
  percent: number;
  price: number;
  originalPrice: number;
}

/**
 * Scans the product's own price plus every variant's price and returns
 * the single biggest real discount found (by percentage). Returns null
 * when nothing is actually discounted.
 */
export function getBestDiscount(product: {
  price: number;
  originalPrice?: number;
  variants?: DiscountSource[];
}): BestDiscount | null {
  let best: BestDiscount | null = null;

  const consider = (price: number, originalPrice?: number) => {
    if (originalPrice && originalPrice > price) {
      const percent = Math.round((1 - price / originalPrice) * 100);
      if (percent > 0 && (!best || percent > best.percent)) {
        best = { percent, price, originalPrice };
      }
    }
  };

  consider(product.price, product.originalPrice);
  (product.variants || []).forEach((v) => consider(v.price, v.originalPrice));

  return best;
}

export function getBestDiscountBadge(product: {
  price: number;
  originalPrice?: number;
  variants?: DiscountSource[];
}): string | null {
  const best = getBestDiscount(product);
  return best ? `-${best.percent}%` : null;
}

/**
 * Formats a money amount with as many decimals as it actually needs, up to 3
 * — "$0.40" stays 2 decimals, but a sub-cent price like 0.055 keeps its 3rd
 * decimal instead of being rounded away by a hardcoded toFixed(2).
 */
export function formatMoney(amount: number): string {
  const thousandths = Math.round(amount * 1000);
  const needsThreeDecimals = thousandths % 10 !== 0;
  return (thousandths / 1000).toFixed(needsThreeDecimals ? 3 : 2);
}
