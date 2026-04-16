fn main() {
    // Load .env from project root (one level up from src-tauri/).
    // Silently ignored if .env doesn't exist (CI uses real env vars).
    let _ = dotenvy::from_path("../.env");

    // Re-run build.rs whenever .env changes so env!() macros pick up edits.
    println!("cargo:rerun-if-changed=../.env");
    println!("cargo:rerun-if-env-changed=SUPABASE_URL");
    println!("cargo:rerun-if-env-changed=SUPABASE_ANON_KEY");

    // Pass Supabase config as compile-time env vars.
    // Values come from .env (gitignored) or CI secrets.
    // If not set, defaults to empty strings — auth features will be disabled at runtime.
    println!(
        "cargo:rustc-env=SUPABASE_URL={}",
        std::env::var("SUPABASE_URL").unwrap_or_default()
    );
    println!(
        "cargo:rustc-env=SUPABASE_ANON_KEY={}",
        std::env::var("SUPABASE_ANON_KEY").unwrap_or_default()
    );

    tauri_build::build()
}
