pub(crate) mod app_icons;
pub mod extension_state_sig;
pub mod game_icon;
pub mod hash;
pub mod icon;
pub mod launch_validation;
pub mod matching;
pub mod path;
pub mod process;
pub mod serialized_file_writer;
#[cfg(target_os = "windows")]
pub mod shell_apps;
#[cfg(target_os = "windows")]
pub(crate) mod store_icons;
pub mod timing;
#[cfg(any(target_os = "linux", test))]
pub(crate) mod wayland;
pub mod win32;
#[cfg(target_os = "linux")]
pub(crate) mod x11;

pub use hash::hash_id;
pub use icon::*;
