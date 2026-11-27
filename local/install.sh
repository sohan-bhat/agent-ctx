#!/bin/sh
set -eu

from="${AGENT_CTX_RELEASES:-}"
root="${AGENT_CTX_HOME:-$HOME/.agent-ctx}"
app="$root/app"
tmp=''
new=''
made=''

stop() {
  echo "$1" >&2
  exit 1
}

clean() {
  [ -z "$new" ] || rm -f "$new"
  [ -z "$tmp" ] || rm -rf "$tmp"
  [ -z "$made" ] || rmdir "$app" "$root" 2>/dev/null || true
}

trap clean EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

command -v curl >/dev/null 2>&1 || stop 'The program curl is missing on this computer, so nothing was installed.'

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) stop "No agent-ctx program exists for $(uname -s), so nothing was installed." ;;
esac

case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) stop "No agent-ctx program exists for the processor $(uname -m), so nothing was installed." ;;
esac

if [ "$os" = darwin ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then arch=arm64; fi
if [ "$os" = linux ] && ldd --version 2>&1 | grep -qi musl; then stop 'No agent-ctx program exists for musl systems such as Alpine, so nothing was installed.'; fi

if [ -n "$from" ]; then
  set --
else
  from='https://github.com/sohan-bhat/agent-ctx/releases/latest/download'
  set -- --proto '=https' --tlsv1.2
fi

file="agent-ctx-$os-$arch"
tmp="$(mktemp -d)"
for name in "$file" SHA256SUMS; do
  curl "$@" -fsL "$from/$name" -o "$tmp/$name" || stop "The download of $from/$name failed, so nothing was installed."
done

want="$(awk -v f="$file" '$2 == f || $2 == "*" f { print $1 }' "$tmp/SHA256SUMS")"
if command -v sha256sum >/dev/null 2>&1; then
  got="$(sha256sum "$tmp/$file" | awk '{ print $1 }')"
else
  got="$(shasum -a 256 "$tmp/$file" | awk '{ print $1 }')"
fi
if [ -z "$want" ] || [ "$want" != "$got" ]; then stop 'The SHA-256 of the download is not the published SHA-256, so nothing was installed.'; fi

if ! cmp -s "$tmp/$file" "$app/agent-ctx" 2>/dev/null; then
  if [ ! -d "$app" ]; then
    made=1
    mkdir -p "$app"
    chmod 700 "$root" "$app"
  fi
  new="$app/agent-ctx.tmp"
  cp "$tmp/$file" "$new"
  chmod 755 "$new"
  mv -f "$new" "$app/agent-ctx"
  new=''
  made=''
fi

"$app/agent-ctx" install --yes </dev/null
