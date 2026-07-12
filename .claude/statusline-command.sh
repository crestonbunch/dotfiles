#!/usr/bin/env bash
# Claude Code status line — two lines with Nerd Font glyphs + a context bar.
# Requires a Nerd Font in the terminal. Glyphs are emitted as raw UTF-8 bytes
# (\xHH) so this file stays plain ASCII; the trailing comment names each icon.

input=$(cat)

j() { echo "$input" | jq -r "$1"; }

model=$(j '.model.display_name // "unknown"')
used_pct=$(j '.context_window.used_percentage // empty')
ctx_size=$(j '.context_window.context_window_size // empty')
rl_5h_pct=$(j '.rate_limits.five_hour.used_percentage // empty')
rl_7d_pct=$(j '.rate_limits.seven_day.used_percentage // empty')
rl_5h_reset=$(j '.rate_limits.five_hour.resets_at // empty')
rl_7d_reset=$(j '.rate_limits.seven_day.resets_at // empty')
total_in=$(j '.context_window.total_input_tokens // 0')
total_out=$(j '.context_window.total_output_tokens // 0')
cost=$(j '.cost.total_cost_usd // empty')
effort=$(j '.effort.level // empty')
vim=$(j '.vim.mode // empty')
cwd=$(j '.cwd // empty')

# Nerd Font glyphs (raw UTF-8 bytes)
GL_MODEL=$(printf '\xef\x8b\x9b')   # microchip  U+F2DB
GL_ADVISOR=$(printf '\xef\x83\xab') # lightbulb  U+F0EB
GL_EFFORT=$(printf '\xef\x80\x92')  # signal     U+F012
GL_VIM=$(printf '\xef\x84\x9c')     # keyboard   U+F11C
GL_CTX=$(printf '\xef\x83\xa4')     # tachometer U+F0E4
GL_SESSION=$(printf '\xef\x80\x97') # clock      U+F017 (5-hour session limit)
GL_WEEK=$(printf '\xef\x81\xb3')    # calendar   U+F073 (7-day weekly limit)
GL_RESET=$(printf '\xef\x80\x9e')   # rotate-right U+F01E (limit reset time)
GL_DIR=$(printf '\xef\x81\xbb')     # folder     U+F07B
GL_BRANCH=$(printf '\xee\x82\xa0')  # branch     U+E0A0
GL_REV=$(printf '\xe2\xac\xa1')     # hexagon    U+2B21 (matches starship jj symbol)
GL_PR=$(printf '\xef\x82\x9b')      # github     U+F09B
GL_IN=$(printf '\xef\x82\xab')      # arrow-down U+F0AB
GL_OUT=$(printf '\xef\x82\xaa')     # arrow-up   U+F0AA
GL_COST=$(printf '\xef\x85\x95')    # dollar     U+F155
BLK=$(printf '\xe2\x96\xb0')        # black parallelogram U+25B0 (bar filled)
LT=$(printf '\xe2\x96\xb1')         # white parallelogram U+25B1 (bar empty)
DOT=$(printf '\xc2\xb7')            # middle dot U+00B7

# ANSI colors — kept sparse so glyphs read as quiet markers. Only the context
# bar carries meaningful color; other glyphs are dimmed.
c() { printf '\033[%sm' "$1"; }
ESC=$(printf '\033')
RESET=$(c 0); BOLD=$(c 1); DIM=$(c 2)
RED=$(c 31); GREEN=$(c 32); YELLOW=$(c 33); ORANGE=$(c '38;5;208'); GRAY=$(c '38;5;244')
SEP=" ${DIM}${DOT}${RESET} "

# Colored parallelogram bar: $1 = integer percentage, $2 = segment count. Stays
# gray at normal usage; only takes on color as it nears the limit.
mkbar() {
  p="$1"; n="$2"
  filled=$(awk -v p="$p" -v n="$n" 'BEGIN{f=int(p/(100/n)+0.5); if(f>n)f=n; if(f<0)f=0; print f}')
  bar=""; i=0
  while [ "$i" -lt "$n" ]; do
    if [ "$i" -lt "$filled" ]; then bar="${bar}${BLK}"; else bar="${bar}${LT}"; fi
    i=$((i + 1))
  done
  if [ "$p" -ge 90 ]; then bc=$RED; elif [ "$p" -ge 70 ]; then bc=$ORANGE; else bc=$GRAY; fi
  printf '%s%s%s' "$bc" "$bar" "$RESET"
}

# Context: dimmed gauge glyph + 5-segment bar + used% + window size
ctx_seg=""
if [ -n "$used_pct" ] && [ -n "$ctx_size" ]; then
  pct_int=$(printf '%.0f' "$used_pct")
  ctx_k=$(echo "$ctx_size" | awk '{printf "%dk", $1/1000}')
  ctx_seg="${DIM}${GL_CTX}${RESET} $(mkbar "$pct_int" 5) ${pct_int}% ${DIM}${ctx_k}${RESET}"
fi

# Time until a Unix epoch reset, as a short relative label (45m, 2h, 3d).
rel_reset() {
  [ -n "$1" ] || return 0
  d=$(( $1 - $(date +%s) ))
  [ "$d" -lt 0 ] && d=0
  if [ "$d" -ge 86400 ]; then echo "$((d / 86400))d"
  elif [ "$d" -ge 3600 ]; then echo "$((d / 3600))h"
  else echo "$(( (d + 59) / 60 ))m"; fi
}

# Rate-limit gauges: 5-hour session + 7-day weekly usage. Pro/Max only, and each
# window is independently absent until the first API response, so render per-gauge.
sess_seg=""
if [ -n "$rl_5h_pct" ]; then
  p5=$(printf '%.0f' "$rl_5h_pct")
  r5=$(rel_reset "$rl_5h_reset")
  sess_seg="${DIM}${GL_SESSION}${RESET} $(mkbar "$p5" 10) ${p5}%${r5:+ ${DIM}${GL_RESET} ${r5}${RESET}}"
fi
week_seg=""
if [ -n "$rl_7d_pct" ]; then
  p7=$(printf '%.0f' "$rl_7d_pct")
  r7=$(rel_reset "$rl_7d_reset")
  week_seg="${DIM}${GL_WEEK}${RESET} $(mkbar "$p7" 10) ${p7}%${r7:+ ${DIM}${GL_RESET} ${r7}${RESET}}"
fi

# Token spend
tok_seg=""
if [ "$total_in" -gt 0 ] || [ "$total_out" -gt 0 ]; then
  in_k=$(echo "$total_in" | awk '{printf "%.1fk", $1/1000}')
  out_k=$(echo "$total_out" | awk '{printf "%.1fk", $1/1000}')
  tok_seg="${DIM}${GL_IN}${RESET} ${in_k} ${DIM}${GL_OUT}${RESET} ${out_k}"
fi

cost_seg=""
if [ -n "$cost" ]; then
  cost_v=$(echo "$cost" | awk '{printf "%.2f", $1}')
  cost_seg="${DIM}${GL_COST}${RESET} ${cost_v}"
fi

effort_seg=""
[ -n "$effort" ] && effort_seg="${DIM}${GL_EFFORT}${RESET} ${effort}"

vim_seg=""
[ -n "$vim" ] && vim_seg="${DIM}${GL_VIM}${RESET} ${vim}"

# Advisor model (used by /advisor): not in the payload, so read the effective
# advisorModel from settings, most specific first. It's static per session, so
# a settings read is accurate here. Shown only when configured.
advisor=""
for f in "$cwd/.claude/settings.local.json" "$cwd/.claude/settings.json" "$HOME/.claude/settings.json"; do
  [ -f "$f" ] || continue
  advisor=$(jq -r '.advisorModel // empty' "$f" 2>/dev/null)
  [ -n "$advisor" ] && break
done
advisor_seg=""
[ -n "$advisor" ] && advisor_seg="${DIM}${GL_ADVISOR}${RESET} ${advisor}"

dir=""
[ -n "$cwd" ] && dir=$(basename "$cwd")

# jj: nearest bookmark down to (and including) trunk via `jj bbt`, plus the
# current head change id. `bbt` guarantees trunk shows when there's no working
# bookmark; both calls are read-only.
jj_branch=""; jj_rev=""
if [ -n "$cwd" ] && command -v jj >/dev/null 2>&1; then
  jj_branch=$(jj --ignore-working-copy --no-pager bbt 2>/dev/null | head -1)
  jj_rev=$(jj --ignore-working-copy --no-pager log --no-graph -r @ -T 'change_id.shortest(8)' 2>/dev/null)
fi

# GitHub PR: same bookmark `jj pr status` uses (nearest bookmark, i.e. the top
# of $jj_branch). `gh pr view` is a network call, so results are cached to a
# per-repo/bookmark file and refreshed in a detached background job — the
# statusline always renders from the last cached value instead of blocking.
pr_seg=""
if [ -n "$cwd" ] && [ -n "$jj_branch" ] && command -v gh >/dev/null 2>&1; then
  cache_key=$(printf '%s' "${cwd}:${jj_branch}" | shasum | awk '{print $1}')
  cache_file="/tmp/claude-statusline-pr-${cache_key}.json"
  now=$(date +%s)
  mtime=0
  if [ -f "$cache_file" ]; then
    mtime=$(stat -f %m "$cache_file" 2>/dev/null || stat -c %Y "$cache_file" 2>/dev/null || echo 0)
  fi
  refreshing_age=9999
  if [ -f "$cache_file.refreshing" ]; then
    refreshing_mtime=$(stat -f %m "$cache_file.refreshing" 2>/dev/null || stat -c %Y "$cache_file.refreshing" 2>/dev/null || echo 0)
    refreshing_age=$((now - refreshing_mtime))
  fi
  # Skip the refresh if one is already in flight (marker younger than 30s —
  # older markers are treated as an abandoned/crashed job and retried).
  if [ $((now - mtime)) -ge 30 ] && [ "$refreshing_age" -ge 30 ]; then
    touch "$cache_file.refreshing" 2>/dev/null
    (
      cd "$cwd" 2>/dev/null || exit 0
      # On failure, leave any existing cache alone rather than clobbering
      # known-good data with an empty result from a transient error.
      if gh pr view "$jj_branch" --json number,url 2>/dev/null > "${cache_file}.tmp"; then
        mv "${cache_file}.tmp" "$cache_file"
      else
        rm -f "${cache_file}.tmp"
        [ -f "$cache_file" ] || echo '{}' > "$cache_file"
      fi
      rm -f "$cache_file.refreshing"
    ) </dev/null >/dev/null 2>&1 &
    disown 2>/dev/null || true
  fi
  if [ -f "$cache_file" ]; then
    pr_number=$(jq -r '.number // empty' "$cache_file" 2>/dev/null)
    pr_url=$(jq -r '.url // empty' "$cache_file" 2>/dev/null)
    if [ -n "$pr_number" ] && [ -n "$pr_url" ]; then
      LINK_OPEN=$(printf '\033]8;;%s\033\\' "$pr_url")
      LINK_CLOSE=$(printf '\033]8;;\033\\')
      pr_seg="${DIM}${GL_PR}${RESET} ${LINK_OPEN}#${pr_number}${LINK_CLOSE}"
    fi
  fi
fi

# Join non-empty segments with the separator
join() {
  result=""
  for part in "$@"; do
    [ -z "$part" ] && continue
    if [ -z "$result" ]; then result="$part"; else result="${result}${SEP}${part}"; fi
  done
  printf '%s' "$result"
}

# Visible column width: strip ANSI SGR sequences and OSC-8 hyperlink wrappers,
# then count characters. The hexagon (U+2B21) is East-Asian-ambiguous and
# renders two cells wide in many terminals, so count its extra cell to keep
# right-alignment from overflowing. Relies on a UTF-8 locale for the character
# count.
vlen() {
  stripped=$(printf '%s' "$1" | sed "s/${ESC}\[[0-9;]*m//g" | sed "s/${ESC}\]8;;[^${ESC}]*${ESC}\\\\//g")
  without=${stripped//"$GL_REV"/}
  printf '%s' "$(( ${#stripped} + ${#stripped} - ${#without} ))"
}

# $COLUMNS is the raw terminal width, but Claude Code renders the statusline
# inside its own bordered box, and terminal multiplexers (e.g. zellij) add
# pane borders on top of that — both eat into the columns actually available
# for text before it gets clipped/ellipsized. Reserve a few columns so
# right-aligned content doesn't ride the true edge.
WIDTH_MARGIN=4

# Per-line nudges (character widths) to visually align the line-1 jj rev with
# the line-2 PR link, since their segments differ in width.
LINE1_RIGHT_SHIFT=-3
LINE2_RIGHT_SHIFT=-2
LINE3_RIGHT_SHIFT=-2

# Line 1: session state on the left, location (dir, branch, rev) pushed to the
# right edge using COLUMNS (exported by Claude Code v2.1.153+). Falls back to a
# plain left-aligned join when COLUMNS is unavailable.
left=$(join \
  "${DIM}${GL_MODEL}${RESET} ${BOLD}${model}${RESET}" \
  "$advisor_seg" \
  "$effort_seg" \
  "$vim_seg")
right=$(join \
  "${dir:+${DIM}${GL_DIR}${RESET} ${dir}}" \
  "${jj_rev:+${DIM}${GL_REV} ${jj_rev}${RESET}}")

if [ -z "$right" ]; then
  line1="$left"
elif [ -n "${COLUMNS:-}" ] && [ "${COLUMNS:-0}" -gt 0 ] 2>/dev/null; then
  pad=$(( COLUMNS - WIDTH_MARGIN - LINE1_RIGHT_SHIFT - $(vlen "$left") - $(vlen "$right") - 1 ))
  [ "$pad" -lt 1 ] && pad=1
  line1=$(printf '%s%*s%s' "$left" "$pad" "" "$right")
else
  line1=$(join "$left" "$right")
fi

# Line 2: context usage + session/spend on the left; the jj branch + PR link
# pushed to the right edge (same COLUMNS technique as line 1) so they sit
# right-aligned underneath the dir/rev block above.
line2left=$(join "$ctx_seg" "$tok_seg" "$cost_seg")
line2right=$(join \
  "${jj_branch:+${DIM}${GL_BRANCH}${RESET} ${jj_branch}}" \
  "$pr_seg")

if [ -z "$line2right" ]; then
  line2="$line2left"
elif [ -n "${COLUMNS:-}" ] && [ "${COLUMNS:-0}" -gt 0 ] 2>/dev/null; then
  pad=$(( COLUMNS - WIDTH_MARGIN - LINE2_RIGHT_SHIFT - $(vlen "$line2left") - $(vlen "$line2right") - 1 ))
  [ "$pad" -lt 1 ] && pad=1
  line2=$(printf '%s%*s%s' "$line2left" "$pad" "" "$line2right")
else
  line2=$(join "$line2left" "$line2right")
fi

# Line 3: session gauge on the left, weekly gauge pushed to the right edge (same
# COLUMNS technique as lines 1-2). Omitted entirely when neither window is
# available (e.g. non-subscriber or before the first API response).
if [ -z "$sess_seg" ] && [ -z "$week_seg" ]; then
  line3=""
elif [ -z "$week_seg" ]; then
  line3="$sess_seg"
elif [ -z "$sess_seg" ]; then
  line3="$week_seg"
elif [ -n "${COLUMNS:-}" ] && [ "${COLUMNS:-0}" -gt 0 ] 2>/dev/null; then
  pad=$(( COLUMNS - WIDTH_MARGIN - LINE3_RIGHT_SHIFT - $(vlen "$sess_seg") - $(vlen "$week_seg") - 1 ))
  [ "$pad" -lt 1 ] && pad=1
  line3=$(printf '%s%*s%s' "$sess_seg" "$pad" "" "$week_seg")
else
  line3=$(join "$sess_seg" "$week_seg")
fi

if [ -n "$line3" ]; then
  printf '%s\n%s\n%s' "$line1" "$line2" "$line3"
else
  printf '%s\n%s' "$line1" "$line2"
fi
