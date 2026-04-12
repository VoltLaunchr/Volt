//! Application launcher module
//!
//! This module provides functionality for launching applications across different platforms
//! with support for tracking usage history and handling various file types.

pub mod history;
pub mod process;
pub mod types;

// Re-export main types and functions
pub use history::{LaunchHistory, LaunchRecord};
pub use process::{launch, launch_with_options};
pub use types::{LaunchError, LaunchOptions, LaunchResult};
