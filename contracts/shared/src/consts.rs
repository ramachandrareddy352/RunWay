use near_sdk::{Gas, NearToken};

pub const USDC_DECIMALS: u8 = 6;
pub const BPS_DENOM: u128 = 10_000;
/// ERC-4626 style virtual offset (1 USDC) used in share math to defeat inflation attacks.
pub const VIRTUAL_OFFSET: u128 = 1_000_000;
pub const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
pub const NO_DEPOSIT: NearToken = NearToken::from_yoctonear(0);

/// Plain `ft_transfer` on the token contract.
pub const GAS_FT_TRANSFER: Gas = Gas::from_tgas(10);
/// `ft_transfer_call` from the credit contract to the INR gateway (receiver logic is small).
pub const GAS_FT_TRANSFER_CALL_FORWARD: Gas = Gas::from_tgas(45);
/// `ft_transfer_call` from a settlement account into the credit contract (router logic + forward).
pub const GAS_FT_TRANSFER_CALL_SETTLE: Gas = Gas::from_tgas(110);
pub const GAS_FT_BALANCE: Gas = Gas::from_tgas(5);
pub const GAS_STORAGE_DEPOSIT: Gas = Gas::from_tgas(10);
pub const GAS_VIEW: Gas = Gas::from_tgas(5);
pub const GAS_CALLBACK: Gas = Gas::from_tgas(15);
pub const GAS_SET_TERMS: Gas = Gas::from_tgas(10);
/// Settlement `on_balance` callback: schedules the settle transfer and its callback.
pub const GAS_ON_BALANCE: Gas = Gas::from_tgas(135);
/// Minimum prepaid gas for `settle()` so every callback in the chain has its gas reserved.
pub const SETTLE_MIN_GAS: Gas = Gas::from_tgas(160);

/// Bound on how many periods `roll()` will close in one call.
pub const MAX_ROLL_PERIODS: u32 = 24;
/// Settlement keeps the last 12 revenue buckets (bounded storage).
pub const BUCKET_SLOTS: usize = 12;

pub const EVENT_STANDARD: &str = "runway";
pub const EVENT_VERSION: &str = "2.0.0";
