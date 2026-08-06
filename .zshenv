# .zshenv runs for every zsh, so nested shells re-prepend these entries and PATH
# grows without bound. -U dedupes, keeping the first (highest-precedence) copy --
# but only on array assignment, so the prepends below must use path=(...) form.
typeset -U path
path=($path)

. "$HOME/.cargo/env"

# uv
path=("$HOME/.local/bin" $path)

# volta
[ -d "$HOME/.volta/bin" ] && path=("$HOME/.volta/bin" $path)

# editors
export EDITOR="nvim"
export VISUAL="nvim"

# go
[ -d "$HOME/go/bin" ] && path=("$HOME/go/bin" $path)

# mise shims (for non-interactive shells; interactive activation is in .zshrc)
[ -d "$HOME/.local/share/mise/shims" ] && path=("$HOME/.local/share/mise/shims" $path)

# generic Clang/GCC env vars to link dynamic Homebrew libraries
export CPATH=/opt/homebrew/include
export LIBRARY_PATH=/opt/homebrew/lib
export PKG_CONFIG_PATH="/opt/homebrew/opt/icu4c/lib/pkgconfig:$PKG_CONFIG_PATH"

# android
[ -d "$HOME/Library/Android/sdk" ] && export ANDROID_HOME="$HOME/Library/Android/sdk"

# secrets
source ~/.secrets.env

# don't commit anything in this file
source ~/.local.env

alias assume=". assume"

export ZELLIJ_SOCKET_DIR=/tmp/zellij
