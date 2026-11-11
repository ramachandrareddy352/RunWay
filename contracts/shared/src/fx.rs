//! INR <-> USDC conversion (design §9A.4). INR in paise, rate in paise per 1 USDC, USDC in micro-units.
//! Floor rounding everywhere; the TypeScript `@runway/fx` package must produce identical integers.

use crate::consts::BPS_DENOM;

/// `usdc = floor(inr_paise × 1_000_000 × (10_000 − spread_bps) / (rate_ppu × 10_000))`
pub fn inr_to_usdc(inr_paise: u128, rate_ppu: u32, spread_bps: u16) -> u128 {
    assert!(rate_ppu > 0, "rate must be positive");
    inr_paise * 1_000_000 * (BPS_DENOM - spread_bps as u128) / (rate_ppu as u128 * BPS_DENOM)
}

/// `inr_paise = floor(usdc × rate_ppu × (10_000 − spread_bps) / (1_000_000 × 10_000))`
pub fn usdc_to_inr(usdc: u128, rate_ppu: u32, spread_bps: u16) -> u128 {
    usdc * rate_ppu as u128 * (BPS_DENOM - spread_bps as u128) / (1_000_000 * BPS_DENOM)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sc5_vectors() {
        // ₹1,000 at ₹96.00/USDC, 50 bps spread -> 10.364583 USDC
        assert_eq!(inr_to_usdc(100_000, 9_600, 50), 10_364_583);
        // 105.60 USDC at ₹96.00/USDC, 50 bps -> ₹10,086.91
        assert_eq!(usdc_to_inr(105_600_000, 9_600, 50), 1_008_691);
        // ₹8,500 at ₹85.00/USDC, no spread -> 100 USDC
        assert_eq!(inr_to_usdc(850_000, 8_500, 0), 100_000_000);
    }
}
