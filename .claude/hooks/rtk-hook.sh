#!/usr/bin/env bash
# PreToolUse (Bash) : réécrit les commandes en `rtk …` pour compresser leur sortie.
# Sans rtk installé, ne fait rien (la commande part telle quelle).
R=$(command -v rtk 2>/dev/null || echo "$HOME/.local/bin/rtk")
[ -x "$R" ] || exit 0
exec "$R" hook claude
