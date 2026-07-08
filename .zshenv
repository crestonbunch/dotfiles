. "$HOME/.cargo/env"

# uv
export PATH="$HOME/.local/bin:$PATH"

# volta
export PATH="$HOME/.volta/bin:$PATH"

# editors
export EDITOR="nvim"
export VISUAL="nvim"

# go
export PATH="$HOME/go/bin:$PATH"

# mise shims (for non-interactive shells; interactive activation is in .zshrc)
[ -d "$HOME/.local/share/mise/shims" ] && export PATH="$HOME/.local/share/mise/shims:$PATH"

# generic Clang/GCC env vars to link dynamic Homebrew libraries
export CPATH=/opt/homebrew/include
export LIBRARY_PATH=/opt/homebrew/lib
export PKG_CONFIG_PATH="/opt/homebrew/opt/icu4c/lib/pkgconfig:$PKG_CONFIG_PATH"

# android
export ANDROID_HOME="${HOME}/Library/Android/sdk"

# secrets
source ~/.secrets.env

# don't commit anything in this file
source ~/.local.env

alias assume=". assume"
