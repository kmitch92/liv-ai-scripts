#!/usr/bin/env bash
set -euo pipefail

# System dependency installer for liv-ai-scripts
# Idempotent: safe to run multiple times.

readonly SCRIPT_NAME="$(basename "$0")"
readonly INSTALLED=()
readonly SKIPPED=()

info()  { echo "INFO:  $*"; }
warn()  { echo "WARN:  $*" >&2; }
error() { echo "ERROR: $*" >&2; exit 1; }

# Track results for summary
declare -a installed=()
declare -a skipped=()

# ---------------------------------------------------------------------------
# Detect package manager
# ---------------------------------------------------------------------------
detect_pkg_manager() {
  if command -v apt >/dev/null 2>&1; then
    echo "apt"
  elif command -v brew >/dev/null 2>&1; then
    echo "brew"
  elif command -v dnf >/dev/null 2>&1; then
    echo "dnf"
  else
    error "No supported package manager found (apt, brew, dnf)."
  fi
}

# ---------------------------------------------------------------------------
# Install helpers per package manager
# ---------------------------------------------------------------------------
install_apt() {
  sudo apt update -qq
  sudo apt install -y "$@"
}

install_brew() {
  brew install "$@"
}

install_dnf() {
  sudo dnf install -y "$@"
}

# ---------------------------------------------------------------------------
# Check and install a dependency
#   $1 = command to check (e.g. ffmpeg)
#   $2 = package name for the detected manager
# ---------------------------------------------------------------------------
ensure_dep() {
  local cmd="$1"
  local pkg="$2"
  local pkg_mgr="$3"

  if command -v "$cmd" >/dev/null 2>&1; then
    info "$cmd already installed -- skipping."
    skipped+=("$cmd")
  else
    info "Installing $pkg via $pkg_mgr ..."
    "install_${pkg_mgr}" "$pkg"
    installed+=("$cmd")
  fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
  info "Detecting package manager ..."
  local pkg_mgr
  pkg_mgr="$(detect_pkg_manager)"
  info "Using package manager: $pkg_mgr"

  # Map dependency -> package name per manager
  local ffmpeg_pkg="ffmpeg"
  local libreoffice_pkg

  case "$pkg_mgr" in
    apt) libreoffice_pkg="libreoffice-impress" ;;
    brew) libreoffice_pkg="libreoffice" ;;
    dnf) libreoffice_pkg="libreoffice-impress" ;;
  esac

  ensure_dep "ffmpeg" "$ffmpeg_pkg" "$pkg_mgr"
  ensure_dep "libreoffice" "$libreoffice_pkg" "$pkg_mgr"

  # Summary
  echo ""
  echo "=============================="
  echo "  Setup Summary"
  echo "=============================="
  if [[ ${#installed[@]} -gt 0 ]]; then
    echo "  Installed: ${installed[*]}"
  else
    echo "  Installed: (none)"
  fi
  if [[ ${#skipped[@]} -gt 0 ]]; then
    echo "  Already present: ${skipped[*]}"
  else
    echo "  Already present: (none)"
  fi
  echo "=============================="
  echo ""
  info "Setup complete."
}

main "$@"
