export interface RepoPermissions {
  push: boolean;
  pull: boolean;
  admin: boolean;
}

export interface ResolvedRepoMeta {
  defaultBranch: string;
  language: string | null;
  languages: Record<string, number>;
  size: number;
  stars: number;
  openIssuesCount: number;
  topics: string[];
  license: string | null;
  isArchived: boolean;
  isFork: boolean;
  permissions: RepoPermissions;
}

export interface ResolvedRepoGitState {
  headSha: string;
  remoteUrl: string;
  sshUrl?: string;
  isShallowClone: boolean;
}

export interface ResolvedRepo {
  fullName: string;
  owner: string;
  name: string;
  localPath: string;
  worktreePath: string;
  meta: ResolvedRepoMeta;
  git: ResolvedRepoGitState;
}
