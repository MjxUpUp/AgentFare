//! Integration test for the Rust↔setup-cli seam.
//!
//! Drives a REAL `node packages/setup/dist/cli.js` through `spawn_setup_cli`
//! (no mock) and asserts the parsed JSON — verifying the spawn + stdout-JSON
//! contract the Tauri IPC commands depend on. This is the automatable half of
//! the IPC chain (Rust → node child); the invoke half (frontend → Rust command)
//! is exercised by ipc.test.ts and needs a Tauri runtime for a full E2E.
//!
//! Requires `packages/setup/dist/cli.js` to be built (turbo build / tsc).

use app_lib::spawn_setup_cli;
use std::path::PathBuf;

/// Resolve the workspace's compiled setup CLI. CARGO_MANIFEST_DIR is
/// packages/gui/src-tauri, so the setup dist is two `..` up (to packages/) then
/// into setup/dist — matching daemon_entry()'s relative resolution.
fn setup_cli_path() -> String {
  PathBuf::from(env!("CARGO_MANIFEST_DIR"))
    .join("..")
    .join("..")
    .join("setup")
    .join("dist")
    .join("cli.js")
    .to_string_lossy()
    .into_owned()
}

/// Node binary: `node` on PATH in dev/CI. Override via AGENTFARE_TEST_NODE.
fn node_bin() -> String {
  std::env::var("AGENTFARE_TEST_NODE").unwrap_or_else(|_| "node".to_string())
}

#[test]
fn capture_returns_valid_json_envelope() {
  // capture is read-only (detect + captureUserBaseUrls, writes nothing), so it
  // is safe to run against the real environment without isolating $HOME.
  let result = spawn_setup_cli(&node_bin(), &setup_cli_path(), &["capture"])
    .expect("capture should spawn + parse; if this fails, see stderr above");
  assert_eq!(result["ok"], true, "capture ok must be true, got: {result}");
  assert_eq!(
    result["subcommand"], "capture",
    "subcommand must be capture"
  );
  assert!(
    result["tools"].is_array(),
    "tools must be a JSON array, got: {result}"
  );
  assert!(
    result["capturedUrls"].is_object(),
    "capturedUrls must be a JSON object"
  );
}

#[test]
fn error_path_returns_ok_false_envelope_not_an_err() {
  // The CLI reports unknown subcommands as {ok:false,error} on stdout (exit 1).
  // spawn_setup_cli must parse it as a Value, NOT return Err — the frontend
  // shows the error message, so masking it as a Rust Err loses diagnostics.
  let result = spawn_setup_cli(&node_bin(), &setup_cli_path(), &["totally-bogus"])
    .expect("error envelope must still parse as JSON, not a Rust Err");
  assert_eq!(result["ok"], false);
  let err = result["error"]
    .as_str()
    .expect("error must be a string")
    .to_owned();
  assert!(
    err.contains("unknown subcommand"),
    "error should mention unknown subcommand, got: {err}"
  );
}

#[test]
fn takeover_missing_port_returns_ok_false_with_port_message() {
  let result = spawn_setup_cli(&node_bin(), &setup_cli_path(), &["takeover"])
    .expect("error envelope must parse");
  assert_eq!(result["ok"], false);
  let err = result["error"].as_str().expect("error string").to_owned();
  assert!(
    err.contains("--port") || err.contains("port"),
    "error should mention --port, got: {err}"
  );
}

#[test]
fn missing_setup_cli_script_is_a_rust_err_not_ok_false() {
  // A genuinely unspawnable/unparseable situation (wrong path) must surface as
  // a Rust Err — distinguishing "the CLI ran and reported an error" (Value with
  // ok:false) from "we couldn't run the CLI at all" (Err).
  let result = spawn_setup_cli(&node_bin(), "/definitely/does/not/exist/cli.js", &["capture"]);
  assert!(result.is_err(), "missing script must be Err, not a Value");
}
