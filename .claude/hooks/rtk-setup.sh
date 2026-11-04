#!/usr/bin/env bash
# SessionStart : installe rtk (rtk-ai/rtk) depuis chr2l/rtk-bin s'il manque.
# Ne bloque jamais la session : toute erreur = on continue sans rtk.
set -u
BIN="$HOME/.local/bin"

if ! command -v rtk >/dev/null 2>&1 && [ ! -x "$BIN/rtk" ]; then
  [ "$(uname -s)-$(uname -m)" = "Linux-x86_64" ] || exit 0
  TMP=$(mktemp -d) || exit 0
  if GIT_TERMINAL_PROMPT=0 GIT_LFS_SKIP_SMUDGE=1 timeout 60 git clone -q --depth 1 https://github.com/chr2l/rtk-bin "$TMP/r" 2>/dev/null \
     && (cd "$TMP/r" && sha256sum -c --status SHA256SUMS); then
    mkdir -p "$BIN" && gunzip -c "$TMP/r/rtk-x86_64-linux.gz" > "$BIN/rtk" && chmod +x "$BIN/rtk"
  fi
  rm -rf "$TMP"
fi

# Le hook est déclaré dans le dépôt, pas en global : coupe l'avertissement "No hook installed"
CFG="${XDG_CONFIG_HOME:-$HOME/.config}/rtk/config.toml"
if [ -x "$BIN/rtk" ] && ! grep -q suppress_hook_warning "$CFG" 2>/dev/null; then
  mkdir -p "$(dirname "$CFG")" && printf '\n[hooks]\nsuppress_hook_warning = true\n' >> "$CFG"
fi

# Rend rtk visible dans le shell Bash de Claude si ~/.local/bin n'est pas dans le PATH
if [ -x "$BIN/rtk" ] && [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  case ":$PATH:" in *":$BIN:"*) ;; *) echo "export PATH=\"$BIN:\$PATH\"" >> "$CLAUDE_ENV_FILE" ;; esac
fi
exit 0
