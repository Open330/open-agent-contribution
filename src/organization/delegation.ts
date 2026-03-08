import { randomUUID } from "node:crypto";

import type { OacEventBus } from "../core/event-bus.js";
import type { ExecutionResult, Task } from "../core/types.js";
import type { AgentRole, OrganizationConfig } from "./types.js";

// ── Types ───────────────────────────────────────────────────

export interface DelegationRequest {
  id: string;
  sourceRepo: string;
  targetRepo: string;
  task: Task;
  reason: string;
  priority: number;
  requestedAt: string;
}

export type DelegationStatus = "pending" | "accepted" | "rejected" | "completed";

export interface DelegationRecord extends DelegationRequest {
  status: DelegationStatus;
  resolvedAt?: string;
  resolvedBy?: string;
}

// ── DelegationManager ───────────────────────────────────────

export class DelegationManager {
  private readonly records = new Map<string, DelegationRecord>();
  private readonly eventBus: OacEventBus;
  private readonly config: OrganizationConfig;

  constructor(eventBus: OacEventBus, config: OrganizationConfig) {
    this.eventBus = eventBus;
    this.config = config;
  }

  /**
   * Create a new delegation request. Auto-routes to the appropriate role
   * based on the target repo and emits a `delegation:requested` event.
   */
  requestDelegation(
    request: Omit<DelegationRequest, "id" | "requestedAt">,
  ): DelegationRequest {
    const id = randomUUID();
    const requestedAt = new Date().toISOString();

    const delegationRequest: DelegationRequest = {
      ...request,
      id,
      requestedAt,
    };

    const record: DelegationRecord = {
      ...delegationRequest,
      status: "pending",
    };

    // Auto-route: find the role that owns the target repo.
    const matchedRole = this.findRoleForRepo(request.targetRepo);
    if (matchedRole) {
      record.resolvedBy = matchedRole.agent;
    }

    this.records.set(id, record);

    this.eventBus.emit("delegation:requested", {
      delegation: delegationRequest,
    });

    return delegationRequest;
  }

  /** Return all delegation records with status "pending". */
  getPendingDelegations(): DelegationRecord[] {
    const pending: DelegationRecord[] = [];
    for (const record of this.records.values()) {
      if (record.status === "pending") {
        pending.push(record);
      }
    }
    // Return sorted by priority (highest first).
    return pending.sort((a, b) => b.priority - a.priority);
  }

  /** Accept a pending delegation and emit `delegation:accepted`. */
  acceptDelegation(id: string): void {
    const record = this.getRecordOrThrow(id);
    this.assertPending(record);

    record.status = "accepted";
    record.resolvedAt = new Date().toISOString();

    this.eventBus.emit("delegation:accepted", {
      delegationId: id,
      assignedAgent: record.resolvedBy ?? "unknown",
    });
  }

  /** Reject a pending delegation and emit `delegation:rejected`. */
  rejectDelegation(id: string, reason: string): void {
    const record = this.getRecordOrThrow(id);
    this.assertPending(record);

    record.status = "rejected";
    record.resolvedAt = new Date().toISOString();

    this.eventBus.emit("delegation:rejected", {
      delegationId: id,
      reason,
    });
  }

  /** Mark a delegation as completed and emit `delegation:completed`. */
  completeDelegation(id: string, result: ExecutionResult): void {
    const record = this.getRecordOrThrow(id);
    if (record.status !== "accepted") {
      throw new Error(`Cannot complete delegation "${id}" with status "${record.status}".`);
    }

    record.status = "completed";
    record.resolvedAt = new Date().toISOString();

    this.eventBus.emit("delegation:completed", {
      delegationId: id,
      result,
    });
  }

  // ── Internal helpers ────────────────────────────────────────

  private findRoleForRepo(repo: string): AgentRole | undefined {
    return this.config.roles.find((role) => role.repos.includes(repo));
  }

  private getRecordOrThrow(id: string): DelegationRecord {
    const record = this.records.get(id);
    if (!record) {
      throw new Error(`Delegation "${id}" not found.`);
    }
    return record;
  }

  private assertPending(record: DelegationRecord): void {
    if (record.status !== "pending") {
      throw new Error(
        `Delegation "${record.id}" is not pending (current status: "${record.status}").`,
      );
    }
  }
}
