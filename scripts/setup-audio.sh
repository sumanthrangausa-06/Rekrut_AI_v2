#!/bin/bash
# Self-hosted Audio Setup — Downloads whisper.cpp + Piper TTS for CPU inference
# Runs during npm postinstall. All downloads are idempotent and failure-tolerant.
# If setup fails, the app still works — self-hosted layer is simply skipped in the fallback chain.

AUDIO_DIR="$(pwd)/bin/audio"
MODELS_DIR="$AUDIO_DIR/models"
mkdir -p "$AUDIO_DIR" "$MODELS_DIR"

# Skip if already set up
if [ -f "$AUDIO_DIR/.setup-done" ]; then
  echo "[audio-setup] Already configured, skipping"
  exit 0
fi

echo "[audio-setup] Setting up self-hosted audio (whisper.cpp + Piper TTS)..."

# ─── 1. Whisper.cpp Binary (STT) ──────────────────────────────
if [ ! -f "$AUDIO_DIR/whisper-cli" ]; then
  echo "[audio-setup] Building whisper.cpp from source..."
  BUILD_DIR="/tmp/whisper-build-$$"

  # Clone whisper.cpp (shallow, specific tag for reproducibility)
  git clone --depth 1 --branch v1.7.3 https://github.com/ggerganov/whisper.cpp.git "$BUILD_DIR" 2>/dev/null || \
    git clone --depth 1 https://github.com/ggerganov/whisper.cpp.git "$BUILD_DIR" 2>/dev/null

  if [ -d "$BUILD_DIR" ]; then
    cd "$BUILD_DIR"

    # Try cmake first (produces whisper-cli), fallback to make (produces main)
    if command -v cmake &>/dev/null; then
      cmake -B build -DCMAKE_BUILD_TYPE=Release -DGGML_OPENMP=OFF 2>/dev/null && \
        cmake --build build --config Release -j"$(nproc 2>/dev/null || echo 2)" 2>/dev/null

      # Find the binary (different names across versions)
      for BIN_NAME in build/bin/whisper-cli build/bin/main build/whisper-cli; do
        if [ -f "$BIN_NAME" ]; then
          cp "$BIN_NAME" "$AUDIO_DIR/whisper-cli"
          break
        fi
      done
    fi

    # Fallback: plain make
    if [ ! -f "$AUDIO_DIR/whisper-cli" ]; then
      make -j"$(nproc 2>/dev/null || echo 2)" main 2>/dev/null
      [ -f main ] && cp main "$AUDIO_DIR/whisper-cli"
    fi

    cd - >/dev/null
    rm -rf "$BUILD_DIR"

    if [ -f "$AUDIO_DIR/whisper-cli" ]; then
      chmod +x "$AUDIO_DIR/whisper-cli"
      echo "[audio-setup] whisper.cpp built successfully"
    else
      echo "[audio-setup] WARN: whisper.cpp build failed — self-hosted STT unavailable"
    fi
  else
    echo "[audio-setup] WARN: Could not clone whisper.cpp"
  fi
fi

# ─── 2. Whisper Model (tiny.en — ~75MB, fastest, English-only) ─
if [ ! -f "$MODELS_DIR/ggml-tiny.en.bin" ]; then
  echo "[audio-setup] Downloading Whisper tiny.en model (~75MB)..."
  curl -sL --max-time 180 --retry 2 \
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin" \
    -o "$MODELS_DIR/ggml-tiny.en.bin" 2>/dev/null

  # Verify download (should be >30MB)
  FILE_SIZE=$(stat -c%s "$MODELS_DIR/ggml-tiny.en.bin" 2>/dev/null || stat -f%z "$MODELS_DIR/ggml-tiny.en.bin" 2>/dev/null || echo 0)
  if [ "$FILE_SIZE" -gt 30000000 ]; then
    echo "[audio-setup] Whisper model OK ($FILE_SIZE bytes)"
  else
    rm -f "$MODELS_DIR/ggml-tiny.en.bin"
    echo "[audio-setup] WARN: Whisper model download failed or truncated"
  fi
fi

# ─── 3. Piper TTS Binary ──────────────────────────────────────
if [ ! -d "$AUDIO_DIR/piper" ] || [ ! -f "$AUDIO_DIR/piper/piper" ]; then
  echo "[audio-setup] Downloading Piper TTS..."
  curl -sL --max-time 120 --retry 2 \
    "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz" \
    -o "/tmp/piper-$$.tar.gz" 2>/dev/null

  FILE_SIZE=$(stat -c%s "/tmp/piper-$$.tar.gz" 2>/dev/null || stat -f%z "/tmp/piper-$$.tar.gz" 2>/dev/null || echo 0)
  if [ "$FILE_SIZE" -gt 1000000 ]; then
    tar -xzf "/tmp/piper-$$.tar.gz" -C "$AUDIO_DIR" 2>/dev/null
    if [ -f "$AUDIO_DIR/piper/piper" ]; then
      chmod +x "$AUDIO_DIR/piper/piper"
      echo "[audio-setup] Piper TTS OK"
    else
      echo "[audio-setup] WARN: Piper extraction failed"
    fi
  else
    echo "[audio-setup] WARN: Piper download failed"
  fi
  rm -f "/tmp/piper-$$.tar.gz"
fi

# ─── 4. Piper Voice Model (en_US-lessac-medium — ~35MB) ───────
if [ ! -f "$MODELS_DIR/en_US-lessac-medium.onnx" ]; then
  echo "[audio-setup] Downloading Piper voice model (~35MB)..."
  curl -sL --max-time 120 --retry 2 \
    "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx" \
    -o "$MODELS_DIR/en_US-lessac-medium.onnx" 2>/dev/null
  curl -sL --max-time 30 \
    "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json" \
    -o "$MODELS_DIR/en_US-lessac-medium.onnx.json" 2>/dev/null

  FILE_SIZE=$(stat -c%s "$MODELS_DIR/en_US-lessac-medium.onnx" 2>/dev/null || stat -f%z "$MODELS_DIR/en_US-lessac-medium.onnx" 2>/dev/null || echo 0)
  if [ "$FILE_SIZE" -gt 10000000 ]; then
    echo "[audio-setup] Piper voice model OK ($FILE_SIZE bytes)"
  else
    rm -f "$MODELS_DIR/en_US-lessac-medium.onnx" "$MODELS_DIR/en_US-lessac-medium.onnx.json"
    echo "[audio-setup] WARN: Voice model download failed"
  fi
fi

# ─── Summary ──────────────────────────────────────────────────
touch "$AUDIO_DIR/.setup-done"
STT_OK="NO"; [ -f "$AUDIO_DIR/whisper-cli" ] && [ -f "$MODELS_DIR/ggml-tiny.en.bin" ] && STT_OK="YES"
TTS_OK="NO"; [ -f "$AUDIO_DIR/piper/piper" ] && [ -f "$MODELS_DIR/en_US-lessac-medium.onnx" ] && TTS_OK="YES"
echo "[audio-setup] Complete! STT: $STT_OK | TTS: $TTS_OK"
