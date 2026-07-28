use std::process::{Child, Command};
use std::sync::Mutex;

use tauri::Manager;

/// Holds the proxy daemon child process so we can kill it when the window
/// closes — otherwise the loopback daemon leaks as an orphan after quit.
struct DaemonChild(Mutex<Option<Child>>);

/// Resolve the daemon entry script.
///
/// In dev (`tauri dev`) this points at the workspace's compiled
/// `daemon-entry.js`, located via the crate source dir captured at compile
/// time. Production resolution differs (the daemon ships as a bundled
/// Node sidecar + better-sqlite3 .node resource — see GUI progress memory);
/// that path is exercised by `tauri build`, not this dev entry. Override with
/// the `AGENTFARE_DAEMON_JS` env var when needed.
fn daemon_entry_path() -> String {
  if let Ok(p) = std::env::var("AGENTFARE_DAEMON_JS") {
    return p;
  }
  format!(
    "{}/../../packages/proxy/dist/daemon-entry.js",
    env!("CARGO_MANIFEST_DIR")
  )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let app = tauri::Builder::default()
    .manage(DaemonChild(Mutex::new(None)))
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      // Spawn the proxy daemon on the loopback interface (127.0.0.1:3456). A
      // spawn failure is logged but does not abort the app: the GUI renders an
      // offline state and the user can start the daemon manually, matching the
      // web/dev behaviour (admin endpoints are read-only either way).
      match Command::new("node")
        .arg(daemon_entry_path())
        .arg("--port")
        .arg("3456")
        .spawn()
      {
        Ok(child) => {
          *app.state::<DaemonChild>().0.lock().unwrap() = Some(child);
        }
        Err(e) => {
          log::error!("failed to spawn proxy daemon: {e}");
        }
      }
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application");

  // Clean shutdown: stop the daemon on app exit so it doesn't outlive the GUI.
  // RunEvent::Exit covers normal termination (window close, ExitRequested,
  // app.exit) more reliably than WindowEvent::Destroyed. A forced kill
  // (taskkill /F / SIGKILL) still bypasses this — OS-level parent-death
  // detection on the daemon side is the remaining gap (tracked for stage 2).
  app.run(|app_handle, event| {
    if let tauri::RunEvent::Exit = event {
      // unwrap_or_else(into_inner): on the shutdown path we want best-effort
      // cleanup even if a prior holder panicked and poisoned the mutex.
      if let Some(mut child) = app_handle
        .state::<DaemonChild>()
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
      {
        let _ = child.kill();
        let _ = child.wait();
      }
    }
  });
}
