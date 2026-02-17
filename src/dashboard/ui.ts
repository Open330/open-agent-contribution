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
    .badge-completed { background: #0a2a1a; color: var(--green); }
    .badge-failed { background: #2a0a0a; color: var(--red); }
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
    .btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn-primary { background: var(--accent); border-color: var(--accent); color: white; }
    .btn-primary:hover:not(:disabled) { opacity: 0.9; }
    footer { text-align: center; padding: 32px 0 16px; color: var(--muted); font-size: 12px; }

    /* Start Run Form */
    .run-form { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .run-form .form-group { display: flex; flex-direction: column; gap: 4px; }
    .run-form .form-group.full { grid-column: 1 / -1; }
    .run-form label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; }
    .run-form input, .run-form select {
      padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border);
      background: #050505; color: var(--text); font-size: 13px; font-family: inherit;
    }
    .run-form input:focus, .run-form select:focus { outline: none; border-color: var(--accent); }
    .run-form .form-actions { grid-column: 1 / -1; display: flex; gap: 8px; margin-top: 4px; }

    /* Stage Progress */
    .stage-pipeline { display: flex; align-items: center; gap: 0; margin: 16px 0; overflow-x: auto; padding-bottom: 4px; }
    .stage-dot { display: flex; align-items: center; gap: 0; white-space: nowrap; }
    .stage-dot .dot {
      width: 10px; height: 10px; border-radius: 50%; background: var(--border);
      flex-shrink: 0; transition: background 0.3s;
    }
    .stage-dot .dot.active { background: var(--accent); animation: pulse 1.5s infinite; }
    .stage-dot .dot.done { background: var(--green); }
    .stage-dot .dot.error { background: var(--red); }
    .stage-dot .label { font-size: 11px; color: var(--muted); margin-left: 4px; margin-right: 4px; }
    .stage-dot .label.active { color: var(--accent); font-weight: 600; }
    .stage-dot .label.done { color: var(--green); }
    .stage-connector { width: 16px; height: 1px; background: var(--border); flex-shrink: 0; }
    .stage-connector.done { background: var(--green); }

    /* Task Results */
    .task-results { margin-top: 12px; }
    .task-result { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--border); font-size: 13px; }
    .task-result:last-child { border-bottom: none; }
    .task-result .icon { font-size: 14px; }
    .task-result a { color: var(--accent); text-decoration: none; }
    .task-result a:hover { text-decoration: underline; }
    .task-result .meta { color: var(--muted); font-size: 12px; margin-left: auto; }

    .hidden { display: none !important; }
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

    <!-- Start Run Form -->
    <div id="run-form-card" class="card" style="margin-bottom: 20px;">
      <h2>Start Run</h2>
      <div class="run-form">
        <div class="form-group full">
          <label for="run-repo">Repository (owner/repo or GitHub URL)</label>
          <input type="text" id="run-repo" placeholder="e.g. Open330/open-agent-contribution" />
        </div>
        <div class="form-group">
          <label for="run-provider">Agent Provider</label>
          <select id="run-provider">
            <option value="claude-code">Claude Code</option>
            <option value="codex">Codex CLI</option>
          </select>
        </div>
        <div class="form-group">
          <label for="run-tokens-mode">Token Budget</label>
          <select id="run-tokens-mode" onchange="toggleTokenInput()">
            <option value="fixed">Fixed</option>
            <option value="unlimited">Unlimited (until rate-limited)</option>
          </select>
        </div>
        <div class="form-group" id="run-tokens-value-group">
          <label for="run-tokens">Token Amount</label>
          <input type="number" id="run-tokens" value="100000" min="1000" step="1000" />
        </div>
        <div class="form-group">
          <label for="run-max-tasks">Max Tasks</label>
          <input type="number" id="run-max-tasks" value="5" min="1" max="50" />
        </div>
        <div class="form-group">
          <label for="run-concurrency">Concurrency</label>
          <input type="number" id="run-concurrency" value="2" min="1" max="10" />
        </div>
        <div class="form-group">
          <label for="run-source">Source Filter</label>
          <select id="run-source">
            <option value="">All sources</option>
            <option value="github-issue">GitHub Issues</option>
            <option value="lint">Lint warnings</option>
            <option value="todo">To-do comments</option>
            <option value="test-gap">Test gaps</option>
          </select>
        </div>
        <div class="form-actions">
          <button id="run-start-btn" class="btn btn-primary" onclick="startRun()">Start Run</button>
          <span id="run-error" style="color: var(--red); font-size: 13px; align-self: center;"></span>
        </div>
      </div>
    </div>

    <!-- Run Progress (shown during active run) -->
    <div id="run-progress-card" class="card hidden" style="margin-bottom: 20px;">
      <h2>Run Progress</h2>
      <div id="stage-pipeline" class="stage-pipeline"></div>
      <div id="run-progress-stats" style="margin-top: 8px;">
        <div class="stat-row"><span class="stat-label">Tasks discovered</span><span class="stat-value" id="prog-discovered">0</span></div>
        <div class="stat-row"><span class="stat-label">Tasks selected</span><span class="stat-value" id="prog-selected">0</span></div>
        <div class="stat-row"><span class="stat-label">Completed</span><span class="stat-value" id="prog-completed">0</span></div>
        <div class="stat-row"><span class="stat-label">Failed</span><span class="stat-value" id="prog-failed">0</span></div>
        <div class="stat-row"><span class="stat-label">PRs created</span><span class="stat-value" id="prog-prs">0</span></div>
        <div class="stat-row"><span class="stat-label">Tokens used</span><span class="stat-value" id="prog-tokens">0</span></div>
      </div>
      <div id="task-results" class="task-results"></div>
    </div>

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
    const STAGES = ["resolving","cloning","scanning","estimating","planning","executing","creating-pr","tracking","completed"];
    let activeRunId = null;

    function formatDate(iso) {
      if (!iso) return "-";
      try { return new Date(iso).toLocaleString(); } catch { return iso; }
    }

    // ---- Start Run ----

    function toggleTokenInput() {
      const mode = document.getElementById("run-tokens-mode").value;
      const group = document.getElementById("run-tokens-value-group");
      if (mode === "unlimited") {
        group.classList.add("hidden");
      } else {
        group.classList.remove("hidden");
      }
    }

    async function startRun() {
      const repo = document.getElementById("run-repo").value.trim();
      const provider = document.getElementById("run-provider").value;
      const tokensMode = document.getElementById("run-tokens-mode").value;
      const tokens = tokensMode === "unlimited"
        ? 9007199254740991
        : parseInt(document.getElementById("run-tokens").value, 10);
      const maxTasks = parseInt(document.getElementById("run-max-tasks").value, 10);
      const concurrency = parseInt(document.getElementById("run-concurrency").value, 10) || 2;
      const source = document.getElementById("run-source").value || undefined;
      const errEl = document.getElementById("run-error");
      const btn = document.getElementById("run-start-btn");

      errEl.textContent = "";
      if (!repo) { errEl.textContent = "Repository is required"; return; }
      if (tokensMode !== "unlimited" && (!tokens || tokens < 1000)) { errEl.textContent = "Token budget must be >= 1000"; return; }

      btn.disabled = true;
      btn.textContent = "Starting...";

      try {
        const res = await fetch(API + "/api/v1/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repo, provider, tokens, maxTasks, concurrency, source }),
        });
        const data = await res.json();

        if (!res.ok) {
          errEl.textContent = data.error || "Failed to start run";
          btn.disabled = false;
          btn.textContent = "Start Run";
          return;
        }

        activeRunId = data.runId;
        showProgressCard();
      } catch (e) {
        errEl.textContent = "Network error: " + e.message;
        btn.disabled = false;
        btn.textContent = "Start Run";
      }
    }

    function showProgressCard() {
      document.getElementById("run-progress-card").classList.remove("hidden");
      initStageList();
      document.getElementById("task-results").innerHTML = "";
      document.getElementById("prog-discovered").textContent = "0";
      document.getElementById("prog-selected").textContent = "0";
      document.getElementById("prog-completed").textContent = "0";
      document.getElementById("prog-failed").textContent = "0";
      document.getElementById("prog-prs").textContent = "0";
      document.getElementById("prog-tokens").textContent = "0";

      const badge = document.getElementById("status-badge");
      badge.className = "badge badge-running";
      badge.textContent = "running";
    }

    function initStageList() {
      const pipeline = document.getElementById("stage-pipeline");
      pipeline.innerHTML = "";
      STAGES.forEach((stage, i) => {
        const dot = document.createElement("div");
        dot.className = "stage-dot";
        dot.innerHTML = '<div class="dot" id="dot-' + stage + '"></div><span class="label" id="label-' + stage + '">' + stage + '</span>';
        pipeline.appendChild(dot);
        if (i < STAGES.length - 1) {
          const conn = document.createElement("div");
          conn.className = "stage-connector";
          conn.id = "conn-" + stage;
          pipeline.appendChild(conn);
        }
      });
    }

    function updateStage(currentStage) {
      let reached = false;
      STAGES.forEach((stage, i) => {
        const dot = document.getElementById("dot-" + stage);
        const label = document.getElementById("label-" + stage);
        const conn = i < STAGES.length - 1 ? document.getElementById("conn-" + stage) : null;

        if (!dot || !label) return;

        if (stage === currentStage) {
          reached = true;
          dot.className = currentStage === "completed" ? "dot done" : "dot active";
          label.className = currentStage === "completed" ? "label done" : "label active";
          if (conn && currentStage === "completed") conn.className = "stage-connector done";
        } else if (!reached) {
          dot.className = "dot done";
          label.className = "label done";
          if (conn) conn.className = "stage-connector done";
        } else {
          dot.className = "dot";
          label.className = "label";
          if (conn) conn.className = "stage-connector";
        }
      });
    }

    function updateProgress(progress) {
      document.getElementById("prog-discovered").textContent = progress.tasksDiscovered || 0;
      document.getElementById("prog-selected").textContent = progress.tasksSelected || 0;
      document.getElementById("prog-completed").textContent = progress.tasksCompleted || 0;
      document.getElementById("prog-failed").textContent = progress.tasksFailed || 0;
      document.getElementById("prog-prs").textContent = progress.prsCreated || 0;
      document.getElementById("prog-tokens").textContent = (progress.tokensUsed || 0).toLocaleString();
    }

    function addTaskResult(data) {
      const container = document.getElementById("task-results");
      const div = document.createElement("div");
      div.className = "task-result";
      const icon = data.success ? "\\u2705" : "\\u274c";
      let html = '<span class="icon">' + icon + '</span><span>' + escapeHtml(data.title) + '</span>';
      if (data.prUrl) {
        html += ' <a href="' + escapeHtml(data.prUrl) + '" target="_blank">PR \\u2197</a>';
      }
      html += '<span class="meta">' + (data.filesChanged || 0) + ' files</span>';
      div.innerHTML = html;
      container.appendChild(div);
    }

    function onRunCompleted(isError) {
      const btn = document.getElementById("run-start-btn");
      btn.disabled = false;
      btn.textContent = "Start Run";
      activeRunId = null;

      const badge = document.getElementById("status-badge");
      if (isError) {
        badge.className = "badge badge-failed";
        badge.textContent = "failed";
      } else {
        badge.className = "badge badge-completed";
        badge.textContent = "completed";
      }

      // Refresh data
      fetchStatus();
      fetchLogs();
      fetchLeaderboard();
    }

    function onRunError(errorMsg) {
      const container = document.getElementById("task-results");
      const div = document.createElement("div");
      div.className = "task-result";
      div.innerHTML = '<span class="icon">\\u274c</span><span style="color: var(--red);">Error: ' + escapeHtml(errorMsg) + '</span>';
      container.appendChild(div);

      // Mark failed stage
      STAGES.forEach((stage) => {
        const dot = document.getElementById("dot-" + stage);
        if (dot && dot.className === "dot active") {
          dot.className = "dot error";
        }
      });

      onRunCompleted(true);
    }

    function escapeHtml(str) {
      const div = document.createElement("div");
      div.textContent = str || "";
      return div.innerHTML;
    }

    // ---- Fetch functions ----

    async function fetchStatus() {
      try {
        const res = await fetch(API + "/api/v1/status");
        const data = await res.json();
        const badge = document.getElementById("status-badge");

        if (data.status === "running") {
          badge.className = "badge badge-running";
          badge.textContent = "running";
          // Restore progress card if page was refreshed mid-run
          if (!activeRunId) {
            activeRunId = data.runId;
            showProgressCard();
            if (data.stage) updateStage(data.stage);
            if (data.progress) updateProgress(data.progress);
          }
        } else if (data.status === "idle" && !activeRunId) {
          badge.className = "badge badge-idle";
          badge.textContent = "idle";
        }

        let html = "";
        const displayKeys = ["status", "stage", "runId", "startedAt", "completedAt", "error"];
        for (const key of displayKeys) {
          if (data[key] !== undefined) {
            html += '<div class="stat-row"><span class="stat-label">' + key + '</span><span class="stat-value">' + escapeHtml(String(data[key])) + '</span></div>';
          }
        }
        if (!html) {
          for (const [key, value] of Object.entries(data)) {
            html += '<div class="stat-row"><span class="stat-label">' + key + '</span><span class="stat-value">' + escapeHtml(String(value)) + '</span></div>';
          }
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
        const totalTokens = data.logs.reduce((s, l) => s + (l.budget?.totalTokensUsed || 0), 0);
        const totalPRs = data.logs.reduce((s, l) => s + (l.tasks?.filter(t => t.pr).length || 0), 0);

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
          html += '<td>' + escapeHtml(log.repo?.fullName || log.repoFullName || "-") + '</td>';
          html += '<td>' + (log.tasks?.length || 0) + '</td>';
          html += '<td>' + (log.budget?.totalTokensUsed || 0).toLocaleString() + '</td>';
          html += '<td>' + escapeHtml(log.budget?.provider || log.agentProvider || "-") + '</td>';
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
          html += '<td>' + escapeHtml(entry.githubUsername || "anonymous") + '</td>';
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

    // ---- SSE Connection ----

    function connectSSE() {
      const indicator = document.getElementById("sse-indicator");
      const log = document.getElementById("event-log");

      const es = new EventSource(API + "/api/v1/events");

      es.addEventListener("connected", (e) => {
        indicator.innerHTML = '<span class="connected">\\u25cf connected</span>';
        addEventLine(log, "connected", "SSE stream connected");
      });

      es.addEventListener("heartbeat", (e) => {
        // Silent heartbeat — no log spam
      });

      // Run events
      es.addEventListener("run:stage", (e) => {
        try {
          const data = JSON.parse(e.data);
          updateStage(data.stage);
          addEventLine(log, "stage", data.message || data.stage);
        } catch {}
      });

      es.addEventListener("run:progress", (e) => {
        try {
          const data = JSON.parse(e.data);
          updateProgress(data.progress);
        } catch {}
      });

      es.addEventListener("run:task-start", (e) => {
        try {
          const data = JSON.parse(e.data);
          addEventLine(log, "task", "Starting: " + data.title);
        } catch {}
      });

      es.addEventListener("run:task-done", (e) => {
        try {
          const data = JSON.parse(e.data);
          const status = data.success ? "OK" : "FAILED";
          let msg = "[" + status + "] " + data.title;
          if (data.prUrl) msg += " - PR: " + data.prUrl;
          addEventLine(log, "task", msg);
          addTaskResult(data);
        } catch {}
      });

      es.addEventListener("run:completed", (e) => {
        try {
          addEventLine(log, "completed", "Run finished successfully");
          updateStage("completed");
          onRunCompleted(false);
        } catch {}
      });

      es.addEventListener("run:error", (e) => {
        try {
          const data = JSON.parse(e.data);
          addEventLine(log, "error", data.error);
          onRunError(data.error);
        } catch {}
      });

      es.onerror = () => {
        indicator.innerHTML = '<span style="color: var(--red);">\\u25cf disconnected</span>';
        addEventLine(log, "error", "SSE disconnected, reconnecting...");
      };

      es.onmessage = (e) => {
        addEventLine(log, "message", e.data);
      };
    }

    function addEventLine(container, type, data) {
      const now = new Date().toLocaleTimeString();
      const line = document.createElement("div");
      line.className = "event-line";
      line.innerHTML = '<span class="time">' + now + '</span> <strong>' + type + '</strong> ' + escapeHtml(String(data));
      container.appendChild(line);
      container.scrollTop = container.scrollHeight;

      while (container.children.length > 100) {
        container.removeChild(container.firstChild);
      }
    }

    // ---- Init ----
    fetchStatus();
    fetchLogs();
    fetchLeaderboard();
    connectSSE();

    setInterval(() => { fetchStatus(); fetchLogs(); }, 30000);
  </script>
</body>
</html>`;
}
