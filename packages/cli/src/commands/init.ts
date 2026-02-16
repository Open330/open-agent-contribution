import { constants as fsConstants } from 'node:fs';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { checkbox, confirm, input } from '@inquirer/prompts';
import chalk, { Chalk } from 'chalk';
import { Command } from 'commander';

import type { GlobalCliOptions } from '../cli.js';

type ProviderId = 'claude-code' | 'codex-cli' | 'opencode';

interface InitSummary {
  configPath: string;
  trackingDirectory: string;
  provider: ProviderId;
  providers: ProviderId[];
  budgetTokens: number;
  repo: string;
}

const OAC_LOGO = [
  '  ___   _   ___',
  ' / _ \\ /_\\ / __|',
  '| (_) / _ \\ (__',
  ' \\___/_/ \\_\\___|',
].join('\n');

const OWNER_REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/;

export function createInitCommand(): Command {
  const command = new Command('init');

  command.description('Initialize OAC in the current directory').action(async (_options, cmd) => {
    const globalOptions = getGlobalOptions(cmd);
    const ui = createUi(globalOptions);

    if (!globalOptions.json) {
      console.log(ui.blue(OAC_LOGO));
      console.log(ui.bold('Welcome to Open Agent Contribution.'));
      console.log('');
    }

    const selectedProviders = await checkbox<ProviderId>({
      message: 'Select AI provider(s):',
      choices: [
        { name: 'Claude Code', value: 'claude-code', checked: true },
        { name: 'Codex CLI', value: 'codex-cli' },
        { name: 'OpenCode', value: 'opencode' },
      ],
      validate: (value) =>
        value.length > 0 ? true : 'Select at least one provider to continue.',
    });

    const budgetInput = await input({
      message: 'Monthly token budget:',
      default: '100000',
      validate: (value) => {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          return 'Enter a positive integer.';
        }

        return true;
      },
    });

    const firstRepoInput = await input({
      message: 'Add your first repo (owner/repo or GitHub URL):',
      validate: (value) => {
        if (isValidRepoInput(value)) {
          return true;
        }

        return 'Enter a valid GitHub repo like owner/repo.';
      },
    });

    const repo = normalizeRepoInput(firstRepoInput);
    const budgetTokens = Number.parseInt(budgetInput, 10);
    const provider = selectedProviders[0] ?? 'claude-code';

    const configPath = resolve(process.cwd(), 'oac.config.ts');
    const trackingDirectory = resolve(process.cwd(), '.oac');

    if (await pathExists(configPath)) {
      const shouldOverwrite = await confirm({
        message: 'oac.config.ts already exists. Overwrite it?',
        default: false,
      });

      if (!shouldOverwrite) {
        if (globalOptions.json) {
          console.log(
            JSON.stringify(
              {
                cancelled: true,
                reason: 'oac.config.ts exists and overwrite was declined',
              },
              null,
              2,
            ),
          );
          return;
        }

        console.log(ui.yellow('Initialization cancelled.'));
        return;
      }
    }

    const configContent = buildConfigFile({
      provider,
      providers: selectedProviders,
      budgetTokens,
      repo,
    });

    await writeFile(configPath, configContent, 'utf8');
    await mkdir(trackingDirectory, { recursive: true });

    const summary: InitSummary = {
      configPath,
      trackingDirectory,
      provider,
      providers: selectedProviders,
      budgetTokens,
      repo,
    };

    if (globalOptions.json) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    console.log(ui.green('Created: oac.config.ts'));
    console.log(ui.green('Created: .oac/'));
    console.log('');
    console.log('Run `oac doctor` to verify or `oac scan` to discover tasks.');
  });

  return command;
}

function getGlobalOptions(command: Command): Required<GlobalCliOptions> {
  const options = command.optsWithGlobals<GlobalCliOptions>();

  return {
    config: options.config ?? 'oac.config.ts',
    verbose: options.verbose === true,
    json: options.json === true,
    color: options.color !== false,
  };
}

function createUi(options: Required<GlobalCliOptions>): Chalk {
  const noColorEnv = Object.prototype.hasOwnProperty.call(process.env, 'NO_COLOR');
  const colorEnabled = options.color && !noColorEnv;

  return new Chalk({ level: colorEnabled ? chalk.level : 0 });
}

function buildConfigFile(input: {
  provider: ProviderId;
  providers: ProviderId[];
  budgetTokens: number;
  repo: string;
}): string {
  const enabledProviders = input.providers.map((provider) => `'${provider}'`).join(', ');

  return `import { defineConfig } from '@oac/core';

export default defineConfig({
  repos: ['${input.repo}'],
  provider: {
    id: '${input.provider}',
    options: {
      enabledProviders: [${enabledProviders}],
    },
  },
  budget: {
    totalTokens: ${input.budgetTokens},
  },
});
`;
}

function normalizeRepoInput(input: string): string {
  const trimmed = input.trim();
  if (OWNER_REPO_PATTERN.test(trimmed)) {
    return stripGitSuffix(trimmed);
  }

  const normalizedUrlInput = trimmed.startsWith('github.com/')
    ? `https://${trimmed}`
    : trimmed;

  try {
    const url = new URL(normalizedUrlInput);
    if (url.hostname !== 'github.com') {
      return trimmed;
    }

    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length < 2) {
      return trimmed;
    }

    const owner = segments[0];
    const repo = stripGitSuffix(segments[1] ?? '');
    if (!owner || !repo) {
      return trimmed;
    }

    return `${owner}/${repo}`;
  } catch {
    return trimmed;
  }
}

function stripGitSuffix(value: string): string {
  return value.endsWith('.git') ? value.slice(0, -4) : value;
}

function isValidRepoInput(input: string): boolean {
  const normalized = normalizeRepoInput(input);
  return OWNER_REPO_PATTERN.test(normalized);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}
