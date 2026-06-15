//! Application discovery, launch history, games, and unified search.

pub mod apps;
pub mod games;
mod history;
pub mod search;
pub mod steam;

pub use apps::*;
pub use games::*;
pub use history::*;
pub use search::*;
pub use steam::*;
