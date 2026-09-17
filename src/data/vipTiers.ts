export interface VipTier {
  key: string;
  label: string;
  sub?: string;
  threshold: number; // cumulative confirmed deposits (USD) required to reach this tier
  discountPercent: number; // automatic order discount granted at this tier, capped at 15%
}

// Regular-customer loyalty tiers based on lifetime confirmed deposits. Capped
// at 15% (V5) so it never undercuts the CTV/Admin wholesale discount tiers,
// which start higher. Only applies to role === 'user' accounts.
//
// Thresholds are sized against real buying volume (accounts cost ~$0.4 each,
// and active buyers purchase ~100-1000/day), and the gap between tiers grows
// each step (~3.3x, 4x, 5x, 6x) rather than staying constant: V1 is cheap and
// fast to reach so the ladder pays off early and feels rewarding right away,
// while each tier above it demands a proportionally bigger jump, so V5's 15%
// stays reserved for sustained high-volume resellers, not a quick spree.
export const VIP_TIERS: VipTier[] = [
  { key: 'member', label: 'Thành viên', threshold: 0, discountPercent: 0 },
  { key: 'v1', label: 'V1', sub: 'Bronze', threshold: 300, discountPercent: 3 },
  { key: 'v2', label: 'V2', sub: 'Silver', threshold: 1000, discountPercent: 5 },
  { key: 'v3', label: 'V3', sub: 'Gold', threshold: 4000, discountPercent: 8 },
  { key: 'v4', label: 'V4', sub: 'Platinum', threshold: 20000, discountPercent: 11 },
  { key: 'v5', label: 'V5', sub: 'Diamond', threshold: 120000, discountPercent: 15 },
];

export const VIP_MAX_DISCOUNT_PERCENT = 15;

export function getVipTier(totalDeposited: number): VipTier {
  let current = VIP_TIERS[0];
  for (const tier of VIP_TIERS) {
    if (totalDeposited >= tier.threshold) current = tier;
  }
  return current;
}
