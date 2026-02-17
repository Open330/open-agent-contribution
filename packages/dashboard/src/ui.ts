export function renderDashboardHtml(port: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OAC Dashboard</title>
  <style>
    :root {
      --bg: #0a0a0a; --card: #111; --border: #222; --text: #e5e5e5;
      --muted: #888; --accent: #3b82f6; --green: #22c55e; --red: #ef4444;
      --yellow: #eab308; --purple: #a855f7;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", monospace; background: var(--bg); color: var(--text); }
    .container { max-width: 1200px; margin: 0 auto; padding: 24px; }
    header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 32px; border-bottom: 1px solid var(--border); padding-bottom: 16px; }
    header h1 { font-size: 24px; font-weight: 700; }
    header h1 span { color: var(--accent); }
    .badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; }
    .badge-idle { background: #1a1a2e; color: var(--muted); }
    .badge-running { background: #0a2a1a; color: var(--green); animation: pulse 2s infinite; }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.6; } }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
    @media (max-width: 768px) { .grid { grid-template-columns: 1fr; } }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 20px; }
    .card h2 { font-size: 14px; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 16px; }
    .stat-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--border); }
    .stat-row:last-child { border-bottom: none; }
    .stat-label { color: var(--muted); font-size: 13px; }
    .stat-value { font-weight: 600; font-size: 14px; }
    .full-width { grid-column: 1 / -1; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; color: var(--muted); font-weight: 500; padding: 8px 12px; border-bottom: 1px solid var(--border); }
    td { padding: 8px 12px; border-bottom: 1px solid var(--border); }
    tr:hover td { background: #1a1a1a; }
    .rank { color: var(--yellow); font-weight: 700; }
    .empty { color: var(--muted); text-align: center; padding: 40px 0; font-size: 14px; }
    .event-log { font-family: "SF Mono", "Fira Code", monospace; font-size: 12px; max-height: 200px; overflow-y: auto; padding: 12px; background: #050505; border-radius: 8px; }
    .event-line { padding: 2px 0; color: var(--muted); }
    .event-line .time { color: var(--accent); margin-right: 8px; }
    .connected { color: var(--green); }
    .toolbar { display: flex; gap: 8px; margin-bottom: 20px; }
    .btn { padding: 8px 16px; border-radius: 8px; border: 1px solid var(--border); background: var(--card); color: var(--text); cursor: pointer; font-size: 13px; transition: all 0.15s; }
    .btn:hover { background: #1a1a1a; border-color: var(--accent); }
    .btn-primary { background: var(--accent); border-color: var(--accent); color: white; }
    .btn-primary:hover { opacity: 0.9; }
    footer { text-align: center; padding: 32px 0 16px; color: var(--muted); font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1><span>OAC</span> Dashboard</h1>
      <div>
        <span id="status-badge" class="badge badge-idle">idle</span>
        <span id="sse-indicator" style="margin-left: 8px; font-size: 11px; color: var(--muted);">connecting...</span>
      </div>
    </header>

    <div class="toolbar">
      <button class="btn" onclick="fetchStatus()">Refresh Status</button>
      <button class="btn" onclick="fetchLogs()">Refresh Logs</button>
      <button class="btn" onclick="fetchLeaderboard()">Refresh Leaderboard</button>
    </div>

    <div class="grid">
      <div class="card">
        <h2>Run Status</h2>
        <div id="status-content">
          <div class="empty">Loading...</div>
        </div>
      </div>

      <div class="card">
        <h2>Quick Stats</h2>
        <div id="stats-content">
          <div class="empty">Loading...</div>
        </div>
      </div>

      <div class="card full-width">
        <h2>Contribution Log</h2>
        <div id="logs-content">
          <div class="empty">Loading...</div>
        </div>
      </div>

      <div class="card full-width">
        <h2>Leaderboard</h2>
        <div id="leaderboard-content">
          <div class="empty">Loading...</div>
        </div>
      </div>

      <div class="card full-width">
        <h2>Event Stream</h2>
        <div id="event-log" class="event-log">
          <div class="event-line" style="color: var(--muted);">Connecting to SSE...</div>
        </div>
      </div>
    </div>

    <footer>OAC v0.1.0 &mdash; Open Agent Contribution</footer>
  </div>

  <script>
    const API = "";

    function formatDate(iso) {
      if (!iso) return "-";
      try { return new Date(iso).toLocaleString(); } catch { return iso; }
    }

    async function fetchStatus() {
      try {
        const res = await fetch(API + "/api/v1/status");
        const data = await res.json();
        const badge = document.getElementById("status-badge");

        if (data.status === "idle") {
          badge.className = "badge badge-idle";
          badge.textContent = "idle";
        } else {
          badge.className = "badge badge-running";
          badge.textContent = data.status || "running";
        }

        let html = "";
        for (const [key, value] of Object.entries(data)) {
          html += '<div class="stat-row"><span class="stat-label">' + key + '</span><span class="stat-value">' + value + '</span></div>';
        }
        document.getElementById("status-content").innerHTML = html || '<div class="empty">No status data</div>';
      } catch (e) {
        document.getElementById("status-content").innerHTML = '<div class="empty">Failed to load status</div>';
      }
    }

    async function fetchLogs() {
      try {
        const res = await fetch(API + "/api/v1/logs");
        const data = await res.json();

        if (!data.logs || data.logs.length === 0) {
          document.getElementById("logs-content").innerHTML = '<div class="empty">No contributions yet. Run <code>oac run</code> to start contributing!</div>';
          document.getElementById("stats-content").innerHTML = [
            '<div class="stat-row"><span class="stat-label">Total Runs</span><span class="stat-value">0</span></div>',
            '<div class="stat-row"><span class="stat-label">Total Tasks</span><span class="stat-value">0</span></div>',
            '<div class="stat-row"><span class="stat-label">Total Tokens</span><span class="stat-value">0</span></div>',
            '<div class="stat-row"><span class="stat-label">PRs Created</span><span class="stat-value">0</span></div>',
          ].join("");
          return;
        }

        const totalRuns = data.logs.length;
        const totalTasks = data.logs.reduce((s, l) => s + (l.tasks?.length || 0), 0);
        const totalTokens = data.logs.reduce((s, l) => s + (l.totalTokensUsed || 0), 0);
        const totalPRs = data.logs.reduce((s, l) => s + (l.prsCreated?.length || 0), 0);

        document.getElementById("stats-content").innerHTML = [
          '<div class="stat-row"><span class="stat-label">Total Runs</span><span class="stat-value">' + totalRuns + '</span></div>',
          '<div class="stat-row"><span class="stat-label">Total Tasks</span><span class="stat-value">' + totalTasks + '</span></div>',
          '<div class="stat-row"><span class="stat-label">Total Tokens</span><span class="stat-value">' + totalTokens.toLocaleString() + '</span></div>',
          '<div class="stat-row"><span class="stat-label">PRs Created</span><span class="stat-value">' + totalPRs + '</span></div>',
        ].join("");

        let html = '<table><thead><tr><th>Date</th><th>Repo</th><th>Tasks</th><th>Tokens</th><th>Agent</th></tr></thead><tbody>';
        for (const log of data.logs.slice(0, 20)) {
          html += '<tr>';
          html += '<td>' + formatDate(log.timestamp) + '</td>';
          html += '<td>' + (log.repoFullName || log.repo || "-") + '</td>';
          html += '<td>' + (log.tasks?.length || 0) + '</td>';
          html += '<td>' + (log.totalTokensUsed || 0).toLocaleString() + '</td>';
          html += '<td>' + (log.agentProvider || "-") + '</td>';
          html += '</tr>';
        }
        html += '</tbody></table>';
        document.getElementById("logs-content").innerHTML = html;
      } catch (e) {
        document.getElementById("logs-content").innerHTML = '<div class="empty">Failed to load logs</div>';
      }
    }

    async function fetchLeaderboard() {
      try {
        const res = await fetch(API + "/api/v1/leaderboard");
        const data = await res.json();

        if (!data.entries || data.entries.length === 0) {
          document.getElementById("leaderboard-content").innerHTML = '<div class="empty">No contributors yet</div>';
          return;
        }

        let html = '<table><thead><tr><th>#</th><th>User</th><th>Tasks</th><th>Tokens</th><th>PRs</th><th>Last Active</th></tr></thead><tbody>';
        data.entries.forEach((entry, i) => {
          html += '<tr>';
          html += '<td class="rank">' + (i + 1) + '</td>';
          html += '<td>' + (entry.githubUsername || "anonymous") + '</td>';
          html += '<td>' + (entry.totalTasksCompleted || 0) + '</td>';
          html += '<td>' + (entry.totalTokensDonated || 0).toLocaleString() + '</td>';
          html += '<td>' + (entry.totalPRsCreated || 0) + '</td>';
          html += '<td>' + formatDate(entry.lastContribution) + '</td>';
          html += '</tr>';
        });
        html += '</tbody></table>';
        document.getElementById("leaderboard-content").innerHTML = html;
      } catch (e) {
        document.getElementById("leaderboard-content").innerHTML = '<div class="empty">Failed to load leaderboard</div>';
      }
    }

    // SSE connection
    function connectSSE() {
      const indicator = document.getElementById("sse-indicator");
      const log = document.getElementById("event-log");

      const es = new EventSource(API + "/api/v1/events");

      es.addEventListener("connected", (e) => {
        indicator.innerHTML = '<span class="connected">\\u25cf connected</span>';
        addEventLine(log, "connected", "SSE stream connected");
      });

      es.addEventListener("heartbeat", (e) => {
        addEventLine(log, "heartbeat", "ping");
      });

      es.onerror = () => {
        indicator.innerHTML = '<span style="color: var(--red);">\\u25cf disconnected</span>';
        addEventLine(log, "error", "SSE disconnected, reconnecting...");
      };

      // Catch all other events
      es.onmessage = (e) => {
        addEventLine(log, "message", e.data);
      };
    }

    function addEventLine(container, type, data) {
      const now = new Date().toLocaleTimeString();
      const line = document.createElement("div");
      line.className = "event-line";
      line.innerHTML = '<span class="time">' + now + '</span> <strong>' + type + '</strong> ' + data;
      container.appendChild(line);
      container.scrollTop = container.scrollHeight;

      // Keep max 100 lines
      while (container.children.length > 100) {
        container.removeChild(container.firstChild);
      }
    }

    // Init
    fetchStatus();
    fetchLogs();
    fetchLeaderboard();
    connectSSE();

    // Auto-refresh every 30s
    setInterval(() => { fetchStatus(); fetchLogs(); }, 30000);
  </script>
</body>
</html>`;
}
