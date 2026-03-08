import type { Task } from "../core/types.js";

import type { OrganizationConfig, OrganizationGoal, OrganizationProject } from "./types.js";

/**
 * Builds context strings from the Mission -> Project -> Goal -> Task hierarchy
 * so agents receive organizational alignment information in their prompts.
 */
export class GoalContextInjector {
  public constructor(private readonly config: OrganizationConfig) {}

  /**
   * Resolve the organizational context for a given task in a specific repo.
   *
   * Returns a multi-line context string like:
   *   "Mission: Build the best AI note app...
   *    Project: burstpick-web
   *    Goal: MVP launch (priority: 90)
   *    Task: implement i18n"
   *
   * Returns `undefined` when no relevant project/goal is found.
   */
  public resolveContext(repoFullName: string, task: Task): string | undefined {
    const project = this.findProjectForRepo(repoFullName);

    const lines: string[] = [];

    if (this.config.mission) {
      lines.push(`Mission: ${this.config.mission.statement}`);
    }

    if (project) {
      lines.push(`Project: ${project.name}`);

      const goal = this.findBestGoal(project);
      if (goal) {
        lines.push(`Goal: ${goal.title} (priority: ${goal.priority})`);
      }
    }

    lines.push(`Task: ${task.title}`);

    return lines.length > 1 ? lines.join("\n") : undefined;
  }

  /**
   * Find the project whose `repos` list contains the given repo full-name.
   * Supports both exact match ("Open330/burstpick-web") and short name match ("burstpick-web").
   */
  private findProjectForRepo(repoFullName: string): OrganizationProject | undefined {
    const shortName = repoFullName.split("/").pop() ?? repoFullName;

    return this.config.projects.find((project) =>
      project.repos.some((repo) => repo === repoFullName || repo === shortName),
    );
  }

  /**
   * Return the highest-priority goal within a project.
   */
  private findBestGoal(project: OrganizationProject): OrganizationGoal | undefined {
    if (project.goals.length === 0) {
      return undefined;
    }

    return [...project.goals].sort((a, b) => b.priority - a.priority)[0];
  }
}
