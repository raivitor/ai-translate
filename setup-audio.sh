#!/usr/bin/env bash
set -euo pipefail

APP_NAME="ai-translate"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/$APP_NAME"
STATE_FILE="$STATE_DIR/audio-loopbacks.env"
LEGACY_STATE_FILE="$STATE_DIR/audio-modules.env"

TO_MEET_GROUP="ai_translate_to_meet_loopback"
FROM_MEET_GROUP="ai_translate_from_meet_loopback"

TO_MEET_SINK="ai_translate_to_meet_sink"
TO_MEET_MIC="ai_translate_to_meet_mic"
FROM_MEET_SINK="ai_translate_from_meet_sink"
FROM_MEET_CAPTURE="ai_translate_from_meet_capture"

TO_MEET_SINK_LABEL="AI-Translate-To-Meet"
TO_MEET_MIC_LABEL="AI-Translate-Virtual-Mic-for-Meet"
FROM_MEET_SINK_LABEL="AI-Translate-From-Meet"
FROM_MEET_CAPTURE_LABEL="AI-Translate-Meet-Audio-Capture"

LOOPBACK_LATENCY_MS="${AI_TRANSLATE_LOOPBACK_LATENCY_MS:-10}"

usage() {
  cat <<'USAGE'
Usage: ./setup-audio.sh [--check|--remove]

Creates temporary PipeWire virtual audio devices for Ai Translate on Linux.

Default:
  creates the sinks and sources needed by the Electron app and Google Meet.

Options:
  --check   print whether the expected PipeWire nodes are available
  --remove  stop temporary pw-loopback processes and legacy Ai Translate pactl modules
  --help    print this help

Environment:
  AI_TRANSLATE_LOOPBACK_LATENCY_MS  desired pw-loopback latency in ms (default: 20)
USAGE
}

require_command() {
  local command_name="$1"
  local install_hint="$2"

  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "$command_name was not found. $install_hint" >&2
    exit 1
  fi
}

require_pipewire() {
  require_command pipewire "Install PipeWire."
  require_command pipewire-pulse "Install pipewire-pulse so Electron/Chrome can use the PipeWire audio server."
  require_command wireplumber "Install WirePlumber."
  require_command pw-cli "Install PipeWire tools."
  require_command pw-loopback "Install PipeWire tools with pw-loopback."
  require_command wpctl "Install WirePlumber tools."

  if ! pw-cli info 0 >/dev/null 2>&1; then
    echo "pw-cli cannot reach a PipeWire server. Start PipeWire for this user session." >&2
    exit 1
  fi

  if ! wpctl status >/dev/null 2>&1; then
    echo "wpctl cannot reach WirePlumber. Start WirePlumber for this user session." >&2
    exit 1
  fi
}

validate_loopback_latency() {
  if ! [[ "$LOOPBACK_LATENCY_MS" =~ ^[0-9]+$ ]] || (( LOOPBACK_LATENCY_MS <= 0 )); then
    echo "AI_TRANSLATE_LOOPBACK_LATENCY_MS must be a positive integer in milliseconds." >&2
    exit 1
  fi
}

linked_version() {
  "$1" --version 2>/dev/null | sed -n 's/^Linked with //p' | head -n 1
}

print_audio_stack() {
  echo "Audio stack:"
  echo "  PipeWire:       $(linked_version pipewire)"
  echo "  WirePlumber:    $(linked_version wireplumber)"
  echo "  pipewire-pulse: $(linked_version pipewire-pulse)"
}

node_exists() {
  local node_name="$1"

  pw-cli ls Node 2>/dev/null | grep -Fq "node.name = \"$node_name\""
}

legacy_pactl_available() {
  command -v pactl >/dev/null 2>&1 && pactl info >/dev/null 2>&1
}

legacy_module_loaded_for() {
  local marker="$1"

  pactl list short modules | grep -Fq "$marker"
}

legacy_module_id_for() {
  local marker="$1"

  pactl list short modules | awk -v marker="$marker" 'index($0, marker) { print $1; exit }'
}

read_state_value() {
  local key="$1"

  if [[ ! -f "$STATE_FILE" ]]; then
    return
  fi

  awk -F= -v key="$key" '$1 == key { print $2; exit }' "$STATE_FILE"
}

managed_loopback_exists() {
  local existing_pid

  existing_pid="$(find_loopback_pid_for "$TO_MEET_GROUP")"
  if [[ -n "$existing_pid" ]] && is_managed_loopback_pid "$existing_pid" "$TO_MEET_GROUP"; then
    return 0
  fi

  existing_pid="$(find_loopback_pid_for "$FROM_MEET_GROUP")"
  if [[ -n "$existing_pid" ]] && is_managed_loopback_pid "$existing_pid" "$FROM_MEET_GROUP"; then
    return 0
  fi

  return 1
}

pid_cmdline() {
  local pid="$1"
  local cmdline_path="/proc/$pid/cmdline"

  if [[ ! -r "$cmdline_path" ]]; then
    return 1
  fi

  tr '\0' ' ' <"$cmdline_path"
}

is_managed_loopback_pid() {
  local pid="$1"
  local group_name="$2"

  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$pid" >/dev/null 2>&1 || return 1

  local cmdline
  cmdline="$(pid_cmdline "$pid")" || return 1

  [[ "$cmdline" == *"pw-loopback"* && "$cmdline" == *"$group_name"* ]]
}

find_loopback_pid_for() {
  local group_name="$1"
  local cmdline_path pid cmdline

  for cmdline_path in /proc/[0-9]*/cmdline; do
    pid="${cmdline_path#/proc/}"
    pid="${pid%/cmdline}"
    cmdline="$(pid_cmdline "$pid" 2>/dev/null || true)"

    if [[ "$cmdline" == *"pw-loopback"* && "$cmdline" == *"$group_name"* ]]; then
      echo "$pid"
      return
    fi
  done
}

wait_for_nodes() {
  local capture_node="$1"
  local playback_node="$2"

  for _ in {1..30}; do
    if node_exists "$capture_node" && node_exists "$playback_node"; then
      return 0
    fi

    sleep 0.1
  done

  return 1
}

start_loopback_once() {
  local state_name="$1"
  local group_name="$2"
  local capture_node="$3"
  local capture_label="$4"
  local playback_node="$5"
  local playback_label="$6"

  local existing_pid
  existing_pid="$(find_loopback_pid_for "$group_name")"

  if [[ -n "$existing_pid" ]] && is_managed_loopback_pid "$existing_pid" "$group_name"; then
    printf -v "$state_name" '%s' "$existing_pid"
    return
  fi

  if node_exists "$capture_node" || node_exists "$playback_node"; then
    echo "A PipeWire node for $group_name already exists, but no managed pw-loopback process was found." >&2
    echo "Run ./setup-audio.sh --remove, close stale audio tools, or restart the user PipeWire session before setup." >&2
    exit 1
  fi

  local capture_props
  local playback_props
  capture_props="{ media.class = \"Audio/Sink\" node.name = \"$capture_node\" node.description = \"$capture_label\" node.virtual = true audio.position = [ FL FR ] }"
  playback_props="{ media.class = \"Audio/Source\" node.name = \"$playback_node\" node.description = \"$playback_label\" node.virtual = true audio.position = [ FL FR ] }"

  nohup pw-loopback \
    -n "$group_name" \
    -g "$group_name" \
    -c 2 \
    -l "$LOOPBACK_LATENCY_MS" \
    -m '[ FL, FR ]' \
    --capture-props "$capture_props" \
    --playback-props "$playback_props" \
    >/dev/null 2>&1 &

  local launch_pid="$!"

  if ! wait_for_nodes "$capture_node" "$playback_node"; then
    kill "$launch_pid" >/dev/null 2>&1 || true
    echo "Failed to create PipeWire nodes for $group_name." >&2
    exit 1
  fi

  local loopback_pid
  loopback_pid="$(find_loopback_pid_for "$group_name")"

  if [[ -z "$loopback_pid" ]]; then
    loopback_pid="$launch_pid"
  fi

  printf -v "$state_name" '%s' "$loopback_pid"
}

write_state_file() {
  if ! mkdir -p "$STATE_DIR" >/dev/null 2>&1; then
    echo "Warning: could not create $STATE_DIR; continuing without setup state." >&2
    return
  fi

  if ! cat >"$STATE_FILE" <<EOF
TO_MEET_LOOPBACK_PID=${TO_MEET_LOOPBACK_PID:-}
FROM_MEET_LOOPBACK_PID=${FROM_MEET_LOOPBACK_PID:-}
LOOPBACK_LATENCY_MS=$LOOPBACK_LATENCY_MS
EOF
  then
    echo "Warning: could not write $STATE_FILE; continuing without setup state." >&2
  fi
}

recreate_loopbacks_if_latency_changed() {
  local configured_latency
  configured_latency="$(read_state_value LOOPBACK_LATENCY_MS)"

  if [[ "$configured_latency" == "$LOOPBACK_LATENCY_MS" ]]; then
    return
  fi

  if ! managed_loopback_exists; then
    return
  fi

  if [[ -n "$configured_latency" ]]; then
    echo "Loopback latency changed from ${configured_latency}ms to ${LOOPBACK_LATENCY_MS}ms; recreating managed loopbacks."
  else
    echo "Loopback latency is unknown; recreating managed loopbacks with ${LOOPBACK_LATENCY_MS}ms."
  fi

  stop_loopback "$TO_MEET_GROUP" "TO_MEET_LOOPBACK_PID" >/dev/null 2>&1 || true
  stop_loopback "$FROM_MEET_GROUP" "FROM_MEET_LOOPBACK_PID" >/dev/null 2>&1 || true
  rm -f "$STATE_FILE"
}

stop_loopback() {
  local group_name="$1"
  local state_key="$2"
  local pid

  pid="$(read_state_value "$state_key")"

  if [[ -z "$pid" ]]; then
    pid="$(find_loopback_pid_for "$group_name")"
  fi

  if [[ -z "$pid" ]]; then
    return 1
  fi

  if ! is_managed_loopback_pid "$pid" "$group_name"; then
    echo "Skipping PID $pid because it is not a managed $group_name pw-loopback process." >&2
    return 1
  fi

  kill "$pid" >/dev/null 2>&1 || return 1

  for _ in {1..20}; do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      return 0
    fi

    sleep 0.1
  done

  echo "Warning: $group_name process $pid did not stop after SIGTERM." >&2
  return 1
}

remove_loopbacks() {
  local removed_count=0
  local legacy_removed_count=0

  if stop_loopback "$TO_MEET_GROUP" "TO_MEET_LOOPBACK_PID"; then
    removed_count=$((removed_count + 1))
  fi

  if stop_loopback "$FROM_MEET_GROUP" "FROM_MEET_LOOPBACK_PID"; then
    removed_count=$((removed_count + 1))
  fi

  rm -f "$STATE_FILE"

  if legacy_pactl_available; then
    for marker in \
      "source_name=$FROM_MEET_CAPTURE" \
      "sink_name=$FROM_MEET_SINK" \
      "source_name=$TO_MEET_MIC" \
      "sink_name=$TO_MEET_SINK"; do
      while legacy_module_loaded_for "$marker"; do
        local module_id
        module_id="$(legacy_module_id_for "$marker")"

        if [[ -z "$module_id" ]]; then
          break
        fi

        pactl unload-module "$module_id" >/dev/null 2>&1 || break
        legacy_removed_count=$((legacy_removed_count + 1))
      done
    done
  fi

  rm -f "$LEGACY_STATE_FILE" >/dev/null 2>&1 || true

  if [[ "$removed_count" -eq 0 ]]; then
    echo "No active Ai Translate pw-loopback processes found."
  else
    echo "Stopped $removed_count Ai Translate pw-loopback process(es)."
  fi

  if [[ "$legacy_removed_count" -gt 0 ]]; then
    echo "Removed $legacy_removed_count legacy Ai Translate pactl module(s)."
  fi
}

print_node_status() {
  local media_class="$1"
  local node_name="$2"
  local label="$3"

  if node_exists "$node_name"; then
    printf '  ok   %-6s %s\n' "$media_class" "$label"
  else
    printf '  miss %-6s %s\n' "$media_class" "$label"
  fi
}

print_status() {
  local configured_latency
  configured_latency="$(read_state_value LOOPBACK_LATENCY_MS)"

  print_audio_stack
  echo
  echo "Expected PipeWire nodes:"

  print_node_status sink "$TO_MEET_SINK" "$TO_MEET_SINK_LABEL"
  print_node_status source "$TO_MEET_MIC" "$TO_MEET_MIC_LABEL"
  print_node_status sink "$FROM_MEET_SINK" "$FROM_MEET_SINK_LABEL"
  print_node_status source "$FROM_MEET_CAPTURE" "$FROM_MEET_CAPTURE_LABEL"
  echo

  if [[ -n "$configured_latency" ]]; then
    echo "Loopback latency: ${configured_latency}ms"

    if [[ "$configured_latency" != "$LOOPBACK_LATENCY_MS" ]]; then
      echo "Requested latency for next setup: ${LOOPBACK_LATENCY_MS}ms"
    fi
  else
    echo "Loopback latency: unknown"
    echo "Requested latency for next setup: ${LOOPBACK_LATENCY_MS}ms"
  fi
}

setup_audio() {
  recreate_loopbacks_if_latency_changed

  start_loopback_once \
    TO_MEET_LOOPBACK_PID \
    "$TO_MEET_GROUP" \
    "$TO_MEET_SINK" \
    "$TO_MEET_SINK_LABEL" \
    "$TO_MEET_MIC" \
    "$TO_MEET_MIC_LABEL"

  start_loopback_once \
    FROM_MEET_LOOPBACK_PID \
    "$FROM_MEET_GROUP" \
    "$FROM_MEET_SINK" \
    "$FROM_MEET_SINK_LABEL" \
    "$FROM_MEET_CAPTURE" \
    "$FROM_MEET_CAPTURE_LABEL"

  write_state_file
  print_status

  echo
  echo "Google Meet devices:"
  echo "  Microphone: $TO_MEET_MIC_LABEL"
  echo "  Speaker:    $FROM_MEET_SINK_LABEL"
}

main() {
  local command="${1:-setup}"

  case "$command" in
    setup)
      require_pipewire
      validate_loopback_latency
      setup_audio
      ;;
    --check)
      require_pipewire
      validate_loopback_latency
      print_status
      ;;
    --remove)
      require_pipewire
      remove_loopbacks
      ;;
    --help|-h)
      usage
      ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
}

main "$@"
