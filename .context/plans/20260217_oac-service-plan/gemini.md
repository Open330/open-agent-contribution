# Open Agent Contribution (OAC) - UX & Developer Experience Plan

**Author:** Gemini (UX/Dashboard Agent)
**Date:** 2026-02-17
**Status:** Draft

## 1. Design System & Identity

### Color Palette ("Neon Operator")
A dark-mode-first aesthetic inspired by cyberpunk terminals and modern developer tools, designed to reduce eye strain during late-night hacking sessions.

*   **Backgrounds:**
    *   `bg-slate-950` (#020617) - Main App Background (Deep Space)
    *   `bg-slate-900` (#0f172a) - Cards/Panels (Orbital Platform)
*   **Primary Accents:**
    *   `text-emerald-400` (#34d399) - **Success/Go** (Signal Green) - Used for active agents and successful PRs.
    *   `text-violet-500` (#8b5cf6) - **AI/Magic** (Neural Purple) - Used for agent thinking states and "magic" actions.
    *   `text-sky-400` (#38bdf8) - **Info/Links** (Data Blue) - Used for repositories and documentation.
*   **Status Indicators:**
    *   `text-amber-400` (#fbbf24) - **Warning/Budget Low** (Caution Amber)
    *   `text-rose-500` (#f43f5e) - **Error/Critical** (System Failure Red)
*   **Typography:**
    *   **Headings:** *Inter* or *Geist Sans* (Clean, modern sans-serif).
    *   **Code/Logs/CLI:** *JetBrains Mono* or *Fira Code* (Monospace with ligatures).

---

## 2. Core Features UX

### 1. Repo Selection UX
**Goal:** Effortless management of target repositories.

*   **Dashboard:**
    *   **View:** Grid of "Repo Cards". Each card displays:
        *   Repo Name & Owner (e.g., `facebook/react`)
        *   Language Icon (e.g., TS logo)
        *   "Open Issues" badge count
        *   Last OAC Activity timestamp
    *   **Search & Filter:** Global search bar (fuzzy match). Filter by "My Repos", "Starred", or "Language".
    *   **Actions:**
        *   "Add Repo" modal accepting GitHub URLs.
        *   **Favorite:** Star icon to pin frequently used repos to the top of the grid.
*   **CLI:**
    *   **Interactive Picker:** Use `prompts` (autocomplete) to select from configured repos.
    *   **Commands:**
        *   `oac repo add <url>`
        *   `oac repo list` (Table view with columns: Name, Issues, Last Run)

### 2. Task Discovery UX
**Goal:** Identifying the *right* work for the AI agents, prioritizing impact and feasibility.

*   **Dashboard:**
    *   **Kanban/List View:** Columns for "Available", "Queued", "In Progress", "Completed".
    *   **Smart Badges:**
        *   *Good First Issue* (Green) - High confidence.
        *   *Complexity: High* (Red) - Estimated by issue length/tags.
        *   *Est. Cost: ~5k tokens* (Yellow badge) - AI-predicted cost.
    *   **Auto-Select:** A "Magic Button" labeled **"Fill My Budget"**.
        *   Action: Automatically selects and queues tasks that fit within the remaining token budget, prioritizing "Good First Issues".
*   **CLI:**
    *   **Discovery:** `oac tasks list --repo <name> --filter "label:bug"`
    *   **Output:** ASCII table with "ID", "Title", "Est. Cost", "Priority".
    *   **Recommendation:** `oac suggest` (Returns top 3 recommended tasks).

### 3. Token Budget UX
**Goal:** Preventing overspending and visualizing "leftover" capacity.

*   **Dashboard:**
    *   **Header Widget:** Always-visible "Fuel Gauge" (Progress bar) showing remaining tokens for the current cycle.
    *   **Budget View:**
        *   **Pie Chart:** "Used by Claude" vs "Used by OpenCode" vs "Remaining".
        *   **Trend Line:** "Daily Token Burn" vs "Budget Limit".
        *   **Warning Thresholds:** Configurable sliders (e.g., "Alert me at 80% usage").
*   **CLI:**
    *   **Command:** `oac budget`
    *   **Output:**
        ```text
        Token Budget: [||||||||||||||||||||.....] 82% Used
        Remaining:    124,000 tokens
        Resets in:    4 days
        Status:       WARNING (Low Budget)
        ```

### 4. Completion Status UX
**Goal:** Transparency into the "Black Box" of AI generation.

*   **Dashboard:**
    *   **Task Detail View:**
        *   **Lifecycle Stepper:** Visual progress: Analysis → Planning → Coding → Verifying → PR Created.
        *   **Artifacts:** Direct links to the generated Branch, PR, and Diff.
        *   **Integration Status:** Icons for Linear/Jira ticket status (e.g., "Moved to In Review").
    *   **Success/Failure:**
        *   Success: Large Green Check + "PR Merged" confetti.
        *   Failure: Red X + Error Log + "Retry with Debug" button.
*   **CLI:**
    *   **Live Updates:** Spinners for active steps (`ora`).
    *   **Completion:**
        *   `✔ PR Created: https://github.com/.../pull/123`
        *   `✘ Failed: Context window exceeded.`

### 5. Parallel Execution UX
**Goal:** Managing multiple agents working simultaneously ("Swarm Mode").

*   **Dashboard ("Mission Control"):**
    *   **Split-Screen Grid:** View multiple active agents side-by-side.
    *   **Mini-Terminals:** Each agent card has a collapsible log window scrolling in real-time.
    *   **Resource Monitor:** Real-time gauges for API Rate Limits (if remote) or CPU/RAM (if local).
    *   **Controls:** Global "Pause All" / "Emergency Stop" buttons. Individual "Stop" buttons per agent.
*   **CLI:**
    *   **Multi-Task Output:** Uses `listr2` or `ink` for a stable, multi-line UI.
        ```text
        Running 3 Agents...

        [Claude] ⠋ Refactoring utils.ts... (Step 3/5)
        [Codex]  ✔ Wrote test_api.py
        [Gpt-4]  ⠼ Generating documentation...
        ```

### 6. Contribution Tracking UX
**Goal:** Gamification and historical record of value provided.

*   **Dashboard:**
    *   **Contribution Graph:** A GitHub-style heatmap showing OAC activity over the year (green squares).
    *   **Stats Cards:**
        *   "Total Tokens Recycled"
        *   "PRs Created / Merged"
        *   "Estimated Hours Saved"
    *   **Gamification:**
        *   **Leaderboard:** (Optional) Compare stats with team members.
        *   **Badges:** "Night Owl" (ran tasks at night), "Bug Hunter" (fixed 10 bugs), "Polyglot" (3+ languages).
    *   **Export:** "Download Report" (PDF/CSV) for expense justification.

---

## 3. Dashboard & CLI Design Specs

### Localhost Dashboard
*   **Framework:** **Next.js** (App Router) for robust routing and server-side rendering where needed.
*   **UI Library:** **shadcn/ui**.
    *   *Why?* It provides accessible, high-quality components (Radix UI) that are copy-pasteable and fully customizable with Tailwind CSS. Perfect for a "developer tool" aesthetic.
*   **Charts:** **Recharts** (React wrapper for D3) - highly customizable and lightweight.
*   **Layout:**
    *   *Sidebar:* Navigation (Dashboard, Repos, Agents, Settings, Profile).
    *   *Top Bar:* Breadcrumbs, User Profile, Global Budget Widget.
    *   *Main Content:* Card-based layout with responsive grid.

### CLI Design
*   **Libraries:**
    *   **Commander/Yargs:** Argument parsing.
    *   **Inquirer/Prompts:** Interactive menus.
    *   **Chalk:** Colored output (essential for readability).
    *   **Ora:** Spinners for async operations.
    *   **Boxen:** Boxing important messages/summaries.
    *   **Consola:** Standardized logging with badges (Info, Success, Warn, Error).
*   **Style:** Minimalist. Information density should be high but readable. Use emojis sparingly as status indicators, not decoration.

---

## 4. Onboarding Flow (Wizard)

**Command:** `oac init`

1.  **Welcome:**
    *   Display OAC Logo (ASCII Art).
    *   "Welcome to Open Agent Contribution. Let's put your spare tokens to work."
2.  **Provider Setup:**
    *   "Select your AI providers:" `[x] OpenAI` `[ ] Anthropic` `[ ] Local`
    *   "Enter API Key for OpenAI: [hidden input]" (or load from env).
3.  **Budget Configuration:**
    *   "What is your monthly token limit for OAC? (Default: 100k)"
4.  **Repo Setup:**
    *   "Add your first repo (URL):"
5.  **Dry Run:**
    *   "Ready! Run 'oac doctor' to verify connections or 'oac start' to begin."

---

## 5. Accessibility (a11y)

*   **Dashboard:**
    *   **Keyboard Nav:** Full support for tab navigation (focus states). All interactive elements must be focusable.
    *   **Screen Readers:** ARIA labels on all icon-only buttons (e.g., `aria-label="Start Agent"`).
    *   **Contrast:** Ensure text meets WCAG AA standards (especially colored badges on dark backgrounds).
    *   **Motion:** Respect `prefers-reduced-motion` for animations (spinners, transitions).
*   **CLI:**
    *   **No Color Mode:** Respect `NO_COLOR` env var to disable chalk colors.
    *   **Plain Output:** Flag `--json` or `--plain` for piping to other tools or reading with text-to-speech.

---

## 6. Comparison: CLI vs Dashboard

| Feature | CLI (Terminal) | Dashboard (Web UI) |
| :--- | :--- | :--- |
| **Primary Use Case** | Quick actions, scripting, automation, CI/CD | Exploration, monitoring, complex configuration, analysis |
| **Repo Selection** | `oac repo select` (List/Fuzzy search) | Visual grid with logos, stats, and pinned favorites |
| **Task Discovery** | Filter flags (`--label bug`) | Kanban board with drag-and-drop, visual badges |
| **Budget View** | Text summary / ASCII bar | Interactive charts, historical trends, breakdown by agent |
| **Parallel Exec** | Multi-line text output (Listr) | Split-screen terminal emulation per agent, resource graphs |
| **Notifications** | System bell / exit codes | Toasts, desktop notifications, sound alerts |
| **Dependency** | Node.js / Python runtime only | Requires running local server port (e.g., `localhost:3000`) |
