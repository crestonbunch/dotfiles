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

# generic Clang/GCC env vars to link dynamic Homebrew libraries
export CPATH=$(brew --prefix)/include
export LIBRARY_PATH=$(brew --prefix)/lib
export PKG_CONFIG_PATH="$(brew --prefix icu4c)/lib/pkgconfig:$PKG_CONFIG_PATH"

# android
export ANDROID_HOME="${HOME}/Library/Android/sdk"

# secrets
source ~/.secrets.env

