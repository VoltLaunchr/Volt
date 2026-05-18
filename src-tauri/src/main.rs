// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Best-effort load of `.env` for dev convenience (REPLICATE_TOKEN, HF_TOKEN, etc.).
    // In production builds, the .env file won't be present — tokens must come from
    // the OS keyring or be set in the system environment.
    let _ = dotenvy::dotenv();
    volt_lib::run()
}
