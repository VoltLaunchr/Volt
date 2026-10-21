//! Shell execution and persisted command history.

mod execution;
pub mod history;

pub use execution::*;
pub use history as shell_history;
pub use history::*;
