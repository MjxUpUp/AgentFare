use std::fs::File;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use tauri::Manager;

/// Loopback port the daemon listens on. Keep in sync with `DEFAULT_PROXY_PORT`
/// in packages/models/src/paths.ts — the daemon reads the same default from
/// there; this constant is only what the GUI spawns it with.
const DAEMON_PORT: u16 = 3456;

/// How long to wait for the daemon to accept connections before letting the
/// window load. The GUI's auto-refresh recovers if the first fetch races the
/// daemon, but a short handshake avoids an initial offline flash.
const DAEMON_READY_TIMEOUT: Duration = Duration::from_secs(3);
const DAEMON_READY_POLL: Duration = Duration::from_millis(50);
/// Grace period for the daemon to run its SIGTERM/SIGINT handler (which closes
/// the SQLite handle cleanly) before we force-kill. `child.kill()` sends
/// SIGKILL (Unix) / TerminateProcess (Windows) and bypasses those handlers.
/// Unix-only: on Windows there's no signal semantics, so we TerminateProcess
/// directly and never reference this constant.
#[cfg(unix)]
const DAEMON_SHUTDOWN_GRACE: Duration = Duration::from_secs(3);

/// Holds the proxy daemon child process so we can kill it when the app exits —
/// otherwise the loopback daemon leaks as an orphan after quit.
struct DaemonChild(Mutex<Option<Child>>);

/// Resolve the Node binary to spawn.
///
/// Dev: assume `node` is on PATH (developer machine).
/// Release: the node binary shipped as a resource in `sidecar/`. Falls back to
/// `node` on PATH if the resource dir isn't resolvable (keeps the app usable
/// even if resources are mis-packaged).
fn node_binary(handle: &tauri::AppHandle) -> String {
  if cfg!(debug_assertions) {
    return "node".to_string();
  }
  let exe = if cfg!(windows) { "node.exe" } else { "node" };
  // A production install has no `node` on PATH, so the fallback to bare "node"
  // is almost certain to fail spawn — but at least log WHY we got here so a
  // "node not found" error isn't the only diagnostic the user sees.
  match handle
    .path()
    .resource_dir()
    .map(|d| d.join("sidecar").join(exe).to_string_lossy().into_owned())
  {
    Ok(p) => p,
    Err(e) => {
      log::error!("resource_dir() unresolved, falling back to PATH node: {e}");
      "node".to_string()
    }
  }
}

/// Resolve the daemon entry script.
///
/// Dev: the workspace's compiled `daemon-entry.js` (located via the crate
/// source dir captured at compile time). Release: the esbuild-bundled
/// `daemon.mjs` shipped as a resource in `sidecar/`. Override either with the
/// `AGENTFARE_DAEMON_JS` env var.
fn daemon_entry(handle: &tauri::AppHandle) -> String {
  if let Ok(p) = std::env::var("AGENTFARE_DAEMON_JS") {
    return p;
  }
  // Compiled daemon-entry under the workspace. Use PathBuf::join so the
  // separator is correct on Windows (env!("CARGO_MANIFEST_DIR") is a native
  // path; concatenating forward slashes mixes separators).
  let dev_entry = || {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
      .join("..")
      .join("..")
      .join("packages")
      .join("proxy")
      .join("dist")
      .join("daemon-entry.js")
      .to_string_lossy()
      .into_owned()
  };
  if cfg!(debug_assertions) {
    return dev_entry();
  }
  match handle
    .path()
    .resource_dir()
    .map(|d| d.join("sidecar").join("daemon.mjs").to_string_lossy().into_owned())
  {
    Ok(p) => p,
    Err(_) => dev_entry(),
  }
}

/// Open the daemon's stdout/stderr sink (release only). In dev we let node
/// inherit the console so its output is visible alongside `tauri dev`. Returns
/// a File whose clone is used for stderr.
fn daemon_log(handle: &tauri::AppHandle) -> Option<File> {
  if cfg!(debug_assertions) {
    return None;
  }
  let dir = handle.path().app_log_dir().ok()?;
  std::fs::create_dir_all(&dir).ok()?;
  File::create(dir.join("agentfare-daemon.log")).ok()
}

/// Poll the daemon until it serves a recognizable `/health` response, or the
/// timeout elapses. Non-fatal: a timeout only means the GUI may briefly show
/// offline until its auto-refresh catches up.
///
/// We verify the RESPONSE BODY, not just an open TCP port: if port 3456 is
/// already held by some other process (a stale orphan daemon, another tool,
/// a system service), the freshly-spawned daemon fails with EADDRINUSE and
/// exits silently, while a bare TCP connect would still succeed against the
/// *other* listener — leaving the GUI talking to the wrong server. Requiring
/// the `"agentfare-proxy"` service identifier in the body rules that out.
fn wait_for_daemon(port: u16) {
  let start = std::time::Instant::now();
  while start.elapsed() < DAEMON_READY_TIMEOUT {
    if daemon_health_ok(port) {
      log::info!("proxy daemon ready on :{port}");
      return;
    }
    std::thread::sleep(DAEMON_READY_POLL);
  }
  log::warn!(
    "proxy daemon not ready after {:?} (GUI may show offline briefly)",
    DAEMON_READY_TIMEOUT
  );
}

/// One `/health` probe. Returns true only if the responder is OUR daemon
/// (body contains the `agentfare-proxy` service marker), not merely something
/// listening on the port.
fn daemon_health_ok(port: u16) -> bool {
  let addr: std::net::SocketAddr = match format!("127.0.0.1:{port}").parse() {
    Ok(a) => a,
    Err(_) => return false,
  };
  let mut stream = match TcpStream::connect_timeout(&addr, DAEMON_READY_POLL) {
    Ok(s) => s,
    Err(_) => return false,
  };
  let _ = stream.set_read_timeout(Some(DAEMON_READY_POLL));
  let _ = stream.set_write_timeout(Some(DAEMON_READY_POLL));
  // HTTP/1.0 + Connection: close so the server closes after the body and
  // read_to_end terminates regardless of chunked/content-length framing.
  let req = b"GET /health HTTP/1.0\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n";
  if stream.write_all(req).is_err() {
    return false;
  }
  let mut buf = Vec::with_capacity(256);
  let _ = stream.read_to_end(&mut buf);
  String::from_utf8_lossy(&buf).contains("agentfare-proxy")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let app = tauri::Builder::default()
    .manage(DaemonChild(Mutex::new(None)))
    .setup(|app| {
      // Logger in both dev (Info) and release (Warn): a release user whose
      // daemon fails to spawn must still be able to find out why from the log
      // dir, not get a silently-offline app with no diagnostics.
      let level = if cfg!(debug_assertions) {
        log::LevelFilter::Info
      } else {
        log::LevelFilter::Warn
      };
      app.handle().plugin(
        tauri_plugin_log::Builder::default()
          .level(level)
          .build(),
      )?;

      let handle = app.handle().clone();
      let mut cmd = Command::new(node_binary(&handle));
      cmd.arg(daemon_entry(&handle))
        .arg("--port")
        .arg(DAEMON_PORT.to_string());
      // Redirect the daemon's stdio to a log file in release (dev keeps the
      // console). better-sqlite3 / config load errors would otherwise be lost.
      if let Some(log_file) = daemon_log(&handle) {
        if let Ok(stderr) = log_file.try_clone() {
          cmd.stdout(Stdio::from(log_file));
          cmd.stderr(Stdio::from(stderr));
        }
      }

      // Spawn the proxy daemon on loopback. A spawn failure is logged but does
      // not abort the app: the GUI renders an offline state and the user can
      // start the daemon manually, matching web/dev behaviour.
      match cmd.spawn() {
        Ok(child) => {
          *app.state::<DaemonChild>().0.lock().unwrap() = Some(child);
          wait_for_daemon(DAEMON_PORT);
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
  // detection on the daemon side is the remaining gap.
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
        // Ask the daemon to shut down gracefully so its SIGTERM handler can
        // close the SQLite handle. `child.kill()` alone sends SIGKILL which
        // bypasses that handler; on Windows TerminateProcess is the only
        // option (no signal semantics), so we kill directly there.
        #[cfg(unix)]
        {
          let pid = child.id() as i32;
          // SAFETY: libc::kill with signal 0/TERM is the standard POSIX way to
          // signal a process by PID; the child was spawned by us and its PID is
          // still valid here (we hold the Child).
          unsafe { libc::kill(pid, libc::SIGTERM) };
          let deadline = std::time::Instant::now() + DAEMON_SHUTDOWN_GRACE;
          let mut exited = false;
          while std::time::Instant::now() < deadline {
            if let Ok(Some(_)) = child.try_wait() {
              exited = true;
              break;
            }
            std::thread::sleep(DAEMON_READY_POLL);
          }
          if !exited {
            log::warn!("daemon didn't exit after SIGTERM in {:?}; force-killing", DAEMON_SHUTDOWN_GRACE);
            let _ = child.kill();
          }
        }
        #[cfg(not(unix))]
        {
          let _ = child.kill();
        }
        let _ = child.wait();
      }
    }
  });
}
