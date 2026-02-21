import { Command } from "commander";

const SUBCOMMANDS = [
  "init",
  "analyze",
  "doctor",
  "scan",
  "plan",
  "run",
  "log",
  "leaderboard",
  "status",
  "completion",
];

const GLOBAL_OPTIONS = [
  "--config",
  "--verbose",
  "--quiet",
  "--json",
  "--no-color",
  "--help",
  "--version",
];

const COMMAND_OPTIONS: Record<string, string[]> = {
  run: [
    "--repo",
    "--tokens",
    "--provider",
    "--concurrency",
    "--dry-run",
    "--mode",
    "--max-tasks",
    "--timeout",
    "--source",
    "--retry-failed",
  ],
  scan: ["--repo", "--scanners", "--max-findings"],
  analyze: ["--repo"],
  plan: ["--repo", "--tokens", "--provider", "--max-tasks"],
  log: ["--limit", "--repo", "--source", "--since"],
  leaderboard: ["--limit", "--repo", "--format"],
  status: ["--watch"],
  init: [],
  doctor: [],
};

function generateBash(): string {
  const cmds = SUBCOMMANDS.join(" ");
  const global = GLOBAL_OPTIONS.join(" ");
  const cases = Object.entries(COMMAND_OPTIONS)
    .map(([cmd, opts]) => {
      const all = [...opts, ...GLOBAL_OPTIONS].join(" ");
      return `      ${cmd}) COMPREPLY=( $(compgen -W "${all}" -- "$cur") ) ;;`;
    })
    .join("\n");

  return `# bash completion for oac
_oac_completions() {
  local cur prev cmds
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  cmds="${cmds}"

  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "$cmds ${global}" -- "$cur") )
    return
  fi

  case "\${COMP_WORDS[1]}" in
${cases}
      *) COMPREPLY=( $(compgen -W "${global}" -- "$cur") ) ;;
  esac
}
complete -F _oac_completions oac`;
}

function generateZsh(): string {
  const cmds = SUBCOMMANDS.map((c) => `'${c}:${c} command'`).join(" ");
  const cases = Object.entries(COMMAND_OPTIONS)
    .map(([cmd, opts]) => {
      const flags = [...opts, ...GLOBAL_OPTIONS].map((o) => `'${o}'`).join(" ");
      return `    ${cmd}) _arguments ${flags} ;;`;
    })
    .join("\n");

  return `#compdef oac
_oac() {
  local -a commands
  commands=(${cmds})

  _arguments '1:command:->cmds' '*::arg:->args'

  case "$state" in
  cmds) _describe 'command' commands ;;
  args)
    case "\${words[1]}" in
${cases}
    esac
    ;;
  esac
}
_oac "$@"`;
}

function generateFish(): string {
  const lines: string[] = ["# fish completion for oac"];
  for (const cmd of SUBCOMMANDS) {
    lines.push(`complete -c oac -n '__fish_use_subcommand' -a '${cmd}' -d '${cmd} command'`);
  }
  for (const opt of GLOBAL_OPTIONS) {
    const long = opt.replace(/^--/, "");
    lines.push(`complete -c oac -l '${long}'`);
  }
  for (const [cmd, opts] of Object.entries(COMMAND_OPTIONS)) {
    for (const opt of opts) {
      const long = opt.replace(/^--/, "");
      lines.push(`complete -c oac -n '__fish_seen_subcommand_from ${cmd}' -l '${long}'`);
    }
  }
  return lines.join("\n");
}

type Shell = "bash" | "zsh" | "fish";

export function createCompletionCommand(): Command {
  const command = new Command("completion");

  command
    .description("Generate shell completion scripts")
    .argument("<shell>", "Shell type: bash, zsh, or fish")
    .action((shell: string) => {
      const generators: Record<Shell, () => string> = {
        bash: generateBash,
        zsh: generateZsh,
        fish: generateFish,
      };
      const gen = generators[shell as Shell];
      if (!gen) {
        throw new Error(`Unsupported shell "${shell}". Supported: bash, zsh, fish`);
      }
      console.log(gen());
    });

  command.addHelpText(
    "after",
    `\nExamples:
  $ oac completion bash >> ~/.bashrc
  $ oac completion zsh >> ~/.zshrc
  $ oac completion fish > ~/.config/fish/completions/oac.fish`,
  );

  return command;
}
