# Task: Implement packages/repo

## Context
Read `.context/plans/20260217_oac-service-plan/claude.md` section 5 for architecture.

## Deliverables

Implement in `packages/repo/src/`:

### 1. `types.ts` — Repo Types
- `ResolvedRepo` interface: fullName, owner, name, localPath, worktreePath, meta (defaultBranch, language, languages, size, stars, openIssuesCount, topics, license, isArchived, isFork, permissions), git (headSha, remoteUrl, isShallowClone)

### 2. `resolver.ts` — Repo Resolver
- `resolveRepo(input: string): Promise<ResolvedRepo>` — Parse GitHub URLs or `owner/repo` format
- Validate the repo exists via `@octokit/rest` GET /repos/:owner/:repo
- Handle 404, archived repos, permission checks
- Return ResolvedRepo with full metadata

### 3. `cloner.ts` — Clone Manager
- `cloneRepo(repo: ResolvedRepo, cacheDir: string): Promise<string>` — Shallow clone (--depth=1) or git pull if already cloned
- Use `simple-git` for all git operations
- Clone to `~/.oac/cache/repos/{owner}/{name}/`
- Return local path

### 4. `metadata-cache.ts` — JSON Metadata Cache
- `MetadataCache` class with get/set/invalidate
- Store in `~/.oac/cache/repos.json`
- TTL: 1 hour (configurable)
- JSON file based (v0.1 decision from merged.md)

### 5. `index.ts` — Re-export

## Dependencies
- @oac/core (workspace:*) — for types, errors, config
- @octokit/rest ^21.1.1
- simple-git ^3.27.0
