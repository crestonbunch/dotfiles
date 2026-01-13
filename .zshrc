ZINIT_HOME="${XDG_DATA_HOME:-${HOME}/.local/share}/zinit/zinit.git"
[ ! -d $ZINIT_HOME ] && mkdir -p "$(dirname $ZINIT_HOME)"
[ ! -d $ZINIT_HOME/.git ] && git clone https://github.com/zdharma-continuum/zinit.git "$ZINIT_HOME"
source "${ZINIT_HOME}/zinit.zsh"

# zsh-fzf-history-search
zinit ice lucid wait'0'
zinit light joshskidmore/zsh-fzf-history-search

# git aliases
alias gg='git status'
alias gc='git commit'
alias gw='git add -i'

# --- Bind Ctrl+G to "edit current command in $EDITOR" ---
autoload -z edit-command-line
zle -N edit-command-line
bindkey '^G' edit-command-line

bindkey ^R history-incremental-search-backward
bindkey ^S history-incremental-search-forward

# Zellij: attach to or create session based on current directory name
zj() {
  local session_name=$(basename "$PWD" | tr . _)
  zellij attach "$session_name" -c
}

eval "$(starship init zsh)"
