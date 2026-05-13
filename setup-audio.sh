#!/usr/bin/env bash
set -euo pipefail

APP_NAME="ai-translate"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/$APP_NAME"
STATE_FILE="$STATE_DIR/audio-modules.env"

TO_MEET_SINK="ai_translate_to_meet_sink"
TO_MEET_MIC="ai_translate_to_meet_mic"
FROM_MEET_SINK="ai_translate_from_meet_sink"
FROM_MEET_CAPTURE="ai_translate_from_meet_capture"

TO_MEET_SINK_LABEL="AI-Translate-To-Meet"
TO_MEET_MIC_LABEL="AI-Translate-Virtual-Mic-for-Meet"
FROM_MEET_SINK_LABEL="AI-Translate-From-Meet"
FROM_MEET_CAPTURE_LABEL="AI-Translate-Meet-Audio-Capture"

usage() {
  cat <<'USAGE'
Usage: ./setup-audio.sh [--check|--remove]

Creates temporary virtual audio devices for Ai Translate on Linux.

Default:
  creates the sinks and sources needed by the Electron app and Google Meet.

Options:
  --check   print whether the expected devices are available
  --remove  unload modules created by the last setup run
  --help    print this help
USAGE
}

require_pactl() {
  if ! command -v pactl >/dev/null 2>&1; then
    echo "pactl was not found. Install PulseAudio tools or pipewire-pulse." >&2
    exit 1
  fi

  if ! pactl info >/dev/null 2>&1; then
    echo "pactl cannot reach an audio server. Start PipeWire/PulseAudio for this user session." >&2
    exit 1
  fi
}

source_exists() {
  pactl list short sources | awk '{print $2}' | grep -Fxq "$1"
}

sink_exists() {
  pactl list short sinks | awk '{print $2}' | grep -Fxq "$1"
}

module_loaded_for() {
  local marker="$1"
  pactl list short modules | grep -Fq "$marker"
}

module_id_for() {
  local marker="$1"
  pactl list short modules | awk -v marker="$marker" 'index($0, marker) { print $1; exit }'
}

load_module_once() {
  local state_name="$1"
  local marker="$2"
  shift 2

  if module_loaded_for "$marker"; then
    printf -v "$state_name" '%s' "$(module_id_for "$marker")"
    return
  fi

  local module_id
  module_id="$(pactl load-module "$@")"
  printf -v "$state_name" '%s' "$module_id"
}

write_state_file() {
  if ! mkdir -p "$STATE_DIR" >/dev/null 2>&1; then
    echo "Warning: could not create $STATE_DIR; continuing without setup state." >&2
    return
  fi

  if ! cat >"$STATE_FILE" <<EOF
TO_MEET_SINK_MODULE=${TO_MEET_SINK_MODULE:-}
TO_MEET_MIC_MODULE=${TO_MEET_MIC_MODULE:-}
FROM_MEET_SINK_MODULE=${FROM_MEET_SINK_MODULE:-}
FROM_MEET_CAPTURE_MODULE=${FROM_MEET_CAPTURE_MODULE:-}
EOF
  then
    echo "Warning: could not write $STATE_FILE; continuing without setup state." >&2
  fi
}

remove_modules() {
  local removed_count=0

  for marker in \
    "source_name=$FROM_MEET_CAPTURE" \
    "sink_name=$FROM_MEET_SINK" \
    "source_name=$TO_MEET_MIC" \
    "sink_name=$TO_MEET_SINK"; do
    while module_loaded_for "$marker"; do
      local module_id
      module_id="$(module_id_for "$marker")"

      if [[ -z "$module_id" ]]; then
        break
      fi

      pactl unload-module "$module_id" >/dev/null 2>&1 || break
      removed_count=$((removed_count + 1))
    done
  done

  rm -f "$STATE_FILE"

  if [[ "$removed_count" -eq 0 ]]; then
    echo "No active Ai Translate audio modules found."
  else
    echo "Removed $removed_count active Ai Translate audio module(s)."
  fi
}

print_status() {
  echo "Audio server:"
  pactl info | sed -n -e 's/^Server Name: /  /p' -e 's/^Nome do servidor: /  /p'
  echo
  echo "Expected devices:"

  if sink_exists "$TO_MEET_SINK"; then
    echo "  ok   sink   $TO_MEET_SINK_LABEL"
  else
    echo "  miss sink   $TO_MEET_SINK_LABEL"
  fi

  if source_exists "$TO_MEET_MIC"; then
    echo "  ok   source $TO_MEET_MIC_LABEL"
  else
    echo "  miss source $TO_MEET_MIC_LABEL"
  fi

  if sink_exists "$FROM_MEET_SINK"; then
    echo "  ok   sink   $FROM_MEET_SINK_LABEL"
  else
    echo "  miss sink   $FROM_MEET_SINK_LABEL"
  fi

  if source_exists "$FROM_MEET_CAPTURE"; then
    echo "  ok   source $FROM_MEET_CAPTURE_LABEL"
  else
    echo "  miss source $FROM_MEET_CAPTURE_LABEL"
  fi
}

setup_audio() {
  load_module_once \
    TO_MEET_SINK_MODULE \
    "sink_name=$TO_MEET_SINK" \
    module-null-sink \
    "sink_name=$TO_MEET_SINK" \
    "sink_properties=device.description=$TO_MEET_SINK_LABEL"

  load_module_once \
    TO_MEET_MIC_MODULE \
    "source_name=$TO_MEET_MIC" \
    module-remap-source \
    "master=$TO_MEET_SINK.monitor" \
    "source_name=$TO_MEET_MIC" \
    "source_properties=device.description=$TO_MEET_MIC_LABEL"

  load_module_once \
    FROM_MEET_SINK_MODULE \
    "sink_name=$FROM_MEET_SINK" \
    module-null-sink \
    "sink_name=$FROM_MEET_SINK" \
    "sink_properties=device.description=$FROM_MEET_SINK_LABEL"

  load_module_once \
    FROM_MEET_CAPTURE_MODULE \
    "source_name=$FROM_MEET_CAPTURE" \
    module-remap-source \
    "master=$FROM_MEET_SINK.monitor" \
    "source_name=$FROM_MEET_CAPTURE" \
    "source_properties=device.description=$FROM_MEET_CAPTURE_LABEL"

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
      require_pactl
      setup_audio
      ;;
    --check)
      require_pactl
      print_status
      ;;
    --remove)
      require_pactl
      remove_modules
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
