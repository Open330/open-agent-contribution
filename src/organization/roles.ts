import type { Task } from "../core/types.js";
import type { AgentProvider } from "../execution/agents/agent.interface.js";

import type { AgentRole } from "./types.js";

/**
 * Routes tasks to agents based on role configuration.
 *
 * Matching priority:
 *  1. Repo match + task-source match
 *  2. Repo match only
 *  3. Fall back to round-robin across all providers
 */
export class RoleRouter {
  private readonly agentMap: Map<string, AgentProvider>;
  private nextRoundRobinIndex = 0;

  public constructor(
    private readonly roles: AgentRole[],
    private readonly agents: AgentProvider[],
  ) {
    this.agentMap = new Map(agents.map((agent) => [agent.id, agent]));
  }

  /**
   * Select the best agent for the given task in the given repo.
   * Falls back to round-robin when no role matches.
   */
  public selectAgent(task: Task, repoFullName: string): AgentProvider {
    const role = this.getRoleForTask(task, repoFullName);

    if (role) {
      const matched = this.agentMap.get(role.agent);
      if (matched) {
        return matched;
      }
    }

    // Round-robin fallback
    const agent = this.agents[this.nextRoundRobinIndex % this.agents.length];
    this.nextRoundRobinIndex = (this.nextRoundRobinIndex + 1) % this.agents.length;
    return agent;
  }

  /**
   * Find the role that best matches the given task and repo.
   *
   * Returns `undefined` when no role matches at all.
   */
  public getRoleForTask(task: Task, repoFullName: string): AgentRole | undefined {
    const shortName = repoFullName.split("/").pop() ?? repoFullName;

    const repoMatches = this.roles.filter((role) =>
      role.repos.some((repo) => repo === repoFullName || repo === shortName),
    );

    if (repoMatches.length === 0) {
      return undefined;
    }

    // Prefer a role that also matches the task source
    const sourceMatch = repoMatches.find(
      (role) => role.taskSources && role.taskSources.includes(task.source),
    );

    return sourceMatch ?? repoMatches[0];
  }
}
