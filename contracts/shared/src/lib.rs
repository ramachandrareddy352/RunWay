//! Shared building blocks for the Runway contracts (credit, settlement, factory, inr-gateway).
//!
//! Units: token amounts are `u128` micro-USDC (6 decimals); JSON uses `U128` strings.
//! Ratios are basis points (`u16`, denominator 10_000). Time is seconds unless a name says `_ms`.

pub mod consts;
pub mod errors;
pub mod events;
pub mod ext;
pub mod fx;
pub mod msgs;
pub mod promise;

#[cfg(feature = "agents")]
pub mod agents;

pub use consts::*;
pub use msgs::*;
