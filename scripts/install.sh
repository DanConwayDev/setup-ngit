#!/usr/bin/env bash

# Installs ngit and git-remote-nostr from the pinned manifest that ships with
# this action. Downloads are accepted only when their SHA-256 matches the
# manifest, so any listed mirror is safe to serve the bytes.
#
# Environment:
#   NGIT_SETUP_VERSION   requested version or "latest" (default: latest)
#   NGIT_SETUP_TARGET    optional target override (e.g. linux-x86_64-musl)
#   GITHUB_ACTION_PATH   set by the runner; used to locate manifest.txt
#   GITHUB_PATH          set by the runner; install dir is appended
#   GITHUB_OUTPUT        set by the runner; receives version=<installed>

set -eu

MANIFEST_PATH="${GITHUB_ACTION_PATH:-$(dirname "$0")/..}/manifest.txt"
BINARIES='ngit git-remote-nostr'

info() {
    printf '[setup-ngit] %s\n' "$1"
}

fail() {
    printf '[setup-ngit] ERROR: %s\n' "$1" >&2
    exit 1
}

command_exists() {
    command -v "$1" >/dev/null 2>&1
}

detect_target() {
    if [ -n "${NGIT_SETUP_TARGET:-}" ]; then
        printf '%s\n' "$NGIT_SETUP_TARGET"
        return 0
    fi
    case "$(uname -s):$(uname -m)" in
        Linux:x86_64|Linux:amd64)
            if ldd --version 2>&1 | grep -qi musl; then
                printf 'linux-x86_64-musl\n'
            else
                printf 'linux-x86_64-gnu\n'
            fi
            ;;
        Linux:aarch64|Linux:arm64) printf 'linux-aarch64-gnu\n' ;;
        Darwin:*) printf 'darwin-universal\n' ;;
        CYGWIN*:*|MINGW*:*|MSYS*:*|Windows*:*) printf 'windows-x86_64\n' ;;
        *) return 1 ;;
    esac
}

resolve_version() {
    requested=$1
    if [ "$requested" = latest ]; then
        awk -F '|' '$1 == "latest" && NF == 2 { print $2; found += 1 }
            END { if (found != 1) exit 1 }' "$MANIFEST_PATH"
    else
        printf '%s\n' "$requested"
    fi
}

select_asset() {
    version=$1
    target=$2
    awk -F '|' -v version="$version" -v target="$target" '
        $1 == "asset" && $2 == version && $3 == target && NF >= 6 { print; found += 1 }
        END { if (found != 1) exit 1 }' "$MANIFEST_PATH"
}

download() {
    url=$1
    destination=$2
    if command_exists curl; then
        curl --fail --silent --show-error --location --proto '=https' \
            --tlsv1.2 --output "$destination" "$url"
    elif command_exists wget; then
        wget --quiet --https-only --output-document "$destination" "$url"
    else
        fail 'curl or wget is required'
    fi
}

sha256() {
    if command_exists sha256sum; then
        sha256sum "$1" | awk '{ print $1 }'
    elif command_exists shasum; then
        shasum -a 256 "$1" | awk '{ print $1 }'
    else
        fail 'sha256sum or shasum is required to verify the release asset'
    fi
}

extract() {
    archive=$1
    destination=$2
    case "$archive" in
        *.tar.gz|*.tgz) tar -xzf "$archive" -C "$destination" ;;
        *.zip)
            if command_exists unzip; then
                unzip -q "$archive" -d "$destination"
            elif command_exists powershell; then
                powershell -NoProfile -Command \
                    "Expand-Archive -LiteralPath '$archive' -DestinationPath '$destination'"
            else
                fail 'unzip or powershell is required to extract a zip asset'
            fi
            ;;
        *) fail "unsupported release archive $archive" ;;
    esac
}

main() {
    [ -f "$MANIFEST_PATH" ] || fail "manifest not found at $MANIFEST_PATH"

    requested="${NGIT_SETUP_VERSION:-latest}"
    version=$(resolve_version "$requested") \
        || fail 'the manifest has no unique latest entry'
    target=$(detect_target) \
        || fail 'this operating system and architecture are not supported'
    asset=$(select_asset "$version" "$target") \
        || fail "the manifest has no unique asset for ngit v$version on $target"

    filename=$(printf '%s' "$asset" | cut -d '|' -f 4)
    expected_sha=$(printf '%s' "$asset" | cut -d '|' -f 5)
    urls=$(printf '%s' "$asset" | cut -d '|' -f 6- | tr '|' '\n')
    case "$expected_sha" in
        *[!0-9a-f]*|'') fail 'the manifest asset SHA-256 is invalid' ;;
    esac
    [ "${#expected_sha}" -eq 64 ] || fail 'the manifest asset SHA-256 is invalid'

    workdir=$(mktemp -d)
    trap 'rm -rf "$workdir"' EXIT HUP INT TERM
    archive="$workdir/$filename"

    downloaded=''
    for url in $urls; do
        info "Downloading ngit v$version for $target from $url"
        if download "$url" "$archive"; then
            downloaded=1
            break
        fi
        info "Download failed from $url; trying the next mirror"
    done
    [ -n "$downloaded" ] || fail 'every mirror failed'

    actual_sha=$(sha256 "$archive")
    [ "$actual_sha" = "$expected_sha" ] \
        || fail "SHA-256 mismatch: expected $expected_sha, observed $actual_sha"

    extract_dir="$workdir/extracted"
    mkdir "$extract_dir"
    extract "$archive" "$extract_dir"

    if [ -n "${RUNNER_TOOL_CACHE:-}" ]; then
        install_dir="$RUNNER_TOOL_CACHE/ngit/$version/$target"
    else
        install_dir="$HOME/.ngit/bin"
    fi
    mkdir -p "$install_dir"

    suffix=''
    case "$target" in
        windows-*) suffix='.exe' ;;
    esac
    for binary in $BINARIES; do
        source=$(find "$extract_dir" -type f -name "$binary$suffix" -print | head -n 1)
        [ -n "$source" ] || fail "release archive is missing $binary$suffix"
        staged="$install_dir/.$binary$suffix.new.$$"
        cp "$source" "$staged"
        chmod 0755 "$staged"
        mv "$staged" "$install_dir/$binary$suffix"
    done

    reported=$("$install_dir/ngit$suffix" --version)
    [ "$reported" = "ngit $version" ] \
        || fail "installed ngit reported an unexpected version: $reported"

    if [ -n "${GITHUB_PATH:-}" ]; then
        printf '%s\n' "$install_dir" >>"$GITHUB_PATH"
    fi
    if [ -n "${GITHUB_OUTPUT:-}" ]; then
        printf 'version=%s\n' "$version" >>"$GITHUB_OUTPUT"
    fi
    info "Installed ngit v$version to $install_dir"
}

main "$@"
