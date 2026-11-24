#!/bin/sh
# Hook launcher (project-setup v6.1). Claude Code starts hooks with its own PATH, which can miss Node when it comes from
# nvm, fnm or Volta, or when the app was opened from the Dock. This finds Node anyway and, when there is none, FAILS CLOSED:
# the guard blocks every tool with a clear message instead of letting everything run unchecked.
# Used by .claude/settings.json:  sh "$CLAUDE_PROJECT_DIR/.claude/hooks/run.sh" <hook.js> [args...]
# KIT_HOOK_NODE=<path> forces which Node to use (the hook tests use it to prove the fail-closed path).
hook="$1"
shift
dir=$(cd "$(dirname "$0")" && pwd)

if [ -n "$KIT_HOOK_NODE" ]; then
  node_bin=""
  [ -x "$KIT_HOOK_NODE" ] && node_bin="$KIT_HOOK_NODE"
else
  # Kim's own PATH first; the usual install places after it.
  PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:/usr/bin:$HOME/.volta/bin:$HOME/.local/bin"
  export PATH
  node_bin=$(command -v node 2>/dev/null)
  if [ -z "$node_bin" ]; then
    for c in "$HOME"/.nvm/versions/node/*/bin/node "$HOME/.fnm/aliases/default/bin/node" \
             "$HOME/Library/Application Support/fnm/aliases/default/bin/node" "$HOME"/.local/share/fnm/aliases/default/bin/node; do
      [ -x "$c" ] && node_bin="$c"
    done
  fi
fi

if [ -z "$node_bin" ]; then
  msg="Kit hooks cannot run: Node.js was not found (PATH, /opt/homebrew/bin, /usr/local/bin, nvm, fnm, Volta). The guard is failing closed, so every tool is blocked. Fix: install Node (brew install node, or the LTS installer from nodejs.org), then restart claude. Check: which node."
  case "$hook" in
    statusline.js) echo "kit: Node missing - brew install node"; exit 0 ;;
    session.js)
      case " $* " in *" --end "*) exit 0 ;; esac
      echo "$msg Tell Kim this first, in one line."; exit 0 ;;
    prompt.js) echo "$msg Tell Kim this, in one line, before anything else."; exit 0 ;;
    *) echo "$msg" >&2; exit 2 ;;
  esac
fi

exec "$node_bin" "$dir/$hook" "$@"
