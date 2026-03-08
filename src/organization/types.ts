import type { AgentProviderId, TaskSource } from "../core/types.js";

// ── Mission / Goal Hierarchy ─────────────────────────────────

export interface OrganizationMission {
  statement: string;
}

export interface OrganizationGoal {
  id: string;
  title: string;
  description: string;
  priority: number;
}

export interface OrganizationProject {
  id: string;
  name: string;
  repos: string[];
  goals: OrganizationGoal[];
}

export interface OrganizationConfig {
  mission?: OrganizationMission;
  projects: OrganizationProject[];
  roles: AgentRole[];
}

// ── Agent Roles ──────────────────────────────────────────────

export interface AgentRole {
  id: string;
  name: string;
  agent: AgentProviderId;
  repos: string[];
  taskSources?: TaskSource[];
  systemPrompt?: string;
}
