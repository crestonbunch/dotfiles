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
export HOMEBREW_PREFIX=/opt/homebrew
export CPATH=$HOMEBREW_PREFIX/include
export LIBRARY_PATH=$HOMEBREW_PREFIX/lib
export PKG_CONFIG_PATH="$HOMEBREW_PREFIX/opt/icu4c/lib/pkgconfig:$PKG_CONFIG_PATH"

# android
export ANDROID_HOME="${HOME}/Library/Android/sdk"

# secrets
source ~/.secrets.env

