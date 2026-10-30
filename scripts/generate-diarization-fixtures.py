#!/usr/bin/env python3
"""Generate synthetic multi-voice fixtures for S-D06 (#1908).

Extends the spike's make_audio.py approach (~/workspace/spikes/
who-diarization/): distinct local flite TTS voices synthesized turn
by turn and concatenated with exactly 0.4 s of silence, so speaker
boundaries are exact by construction (sample counts) — that schedule
IS the ground truth.

Long fixtures do not need thousands of TTS calls: a small set of
turn clips per voice (3 interviewer + 3 candidate, ~11-16 s each) is
cycled in a fixed alternating pattern until the target duration.
Alternation guarantees every voice speaks in the first and last
5 minutes, in minute 2 ([120,180] s — canonical definition below;
on the short 2-minute fixture, in the early window [60,120] s), and
in the final minute (no turn is longer than ~16 s). Fixtures END at a natural turn boundary within a few
seconds of the target (never mid-turn): the first S-D06 run of a
hard-truncated fixture produced a 0.06 s phantom speaker turn at
the abrupt cut (119.92-119.98 s of a 120 s fixture) — an artefact
of the fixture, recorded on #1908; ground truth here is computed
from the samples actually written, never assumed.

Synthetic audio ONLY — local TTS, no real recordings.

Usage:
  python3 scripts/generate-diarization-fixtures.py --out-dir <dir>
Outputs per fixture: diarization-{2min,30min,60min}.wav (16 kHz mono
PCM16) + diarization-{...}.ground-truth.json. The WAVs are proof
inputs, NOT committed to the repo; this script is.
"""
import argparse
import json
import subprocess
import sys
import wave
from pathlib import Path

SR = 16000
GAP_S = 0.4
GAP = int(SR * GAP_S)

# (speaker, flite voice) — the spike's maximally distinct pair.
VOICES = [("interviewer", "kal"), ("candidate", "slt")]

TEXTS = {
    "interviewer": [
        "Let us talk about how you approach a difficult problem at work. When a project starts to fall behind schedule, what are the first steps you take, and how do you decide what matters most for the team?",
        "That is helpful. Now I would like to hear about your experience working with people from different backgrounds. How do you make sure that everyone on the team understands the goal in the same way?",
        "Thank you. One more area I want to explore is how you learn new skills. Can you describe a recent time when you had to learn something completely new for your work, and how you went about it?",
    ],
    "candidate": [
        "When a project starts to slip, the first thing I do is look at the plan and find the tasks that everything else depends on. I talk to the people doing those tasks, we agree on what can be simplified, and then I share a clear update with everyone involved.",
        "In my previous role I worked with engineers, designers, and people from the business side every day. We held a short meeting at the start of each week where we wrote down the goal in plain words, and anyone could ask questions until it was completely clear.",
        "Last year I had to learn a new reporting tool that our company was moving to. I spent an hour each morning working through the training material, I practiced with real data from my own projects, and after about three weeks I was confident enough to teach the rest of my team.",
    ],
}


def synth(work_dir: Path, name: str, voice: str, text: str) -> bytes:
    txt = work_dir / f"{name}.txt"
    wav_path = work_dir / f"{name}.wav"
    txt.write_text(text)
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi",
         "-i", f"flite=textfile={txt}:voice={voice}",
         "-ar", str(SR), "-ac", "1", str(wav_path)],
        check=True,
    )
    with wave.open(str(wav_path), "rb") as w:
        assert w.getframerate() == SR and w.getsampwidth() == 2 and w.getnchannels() == 1
        return w.readframes(w.getnframes())


def build_fixture(clips, target_s: int):
    """clips: list[(speaker, voice, pcm_bytes)] in cycle order.
    Returns (pcm_bytes, turns, duration_s): full turns only, ending
    at the natural turn boundary nearest the target (within one
    turn), so no fixture ends mid-speech."""
    pcm = bytearray()
    turns = []
    cursor = 0  # samples
    i = 0
    gap_bytes = b"\x00\x00" * GAP
    while cursor < (target_s - 8) * SR:
        speaker, voice, clip = clips[i % len(clips)]
        i += 1
        clip_samples = len(clip) // 2
        turns.append({
            "speaker": speaker, "voice": voice,
            "start_s": round(cursor / SR, 3),
            "end_s": round((cursor + clip_samples) / SR, 3),
        })
        pcm.extend(clip)
        cursor += clip_samples
        if cursor < (target_s - 8) * SR:
            pcm.extend(gap_bytes)
            cursor += GAP
    return bytes(pcm), turns, round(cursor / SR, 3)


# Canonical window definition (#1929 m9): "Minute N" = the 60-second
# window starting at timestamp N:00 — [N*60, (N+1)*60) seconds.
# Minute 2 = [120,180], minute 28 = [1680,1740], minute 40 = [2400,2460].
# For duration < 180 s, minute 2 does not exist and must not be
# silently substituted: the distinctly named early window [60,120]
# is checked instead, under its own label.
def minute2_window(duration_s):
    return (120, 180) if duration_s >= 180 else None


def check_windows(turns, duration_s):
    """Fail loudly if the AC-1 windows are not covered by both voices."""
    def voices_in(start, end):
        return {t["speaker"] for t in turns if t["end_s"] > start and t["start_s"] < end}
    want = {s for s, _ in VOICES}
    minute2 = minute2_window(duration_s)
    labelled_minute2 = (
        ("minute 2", minute2) if minute2 is not None else ("early window", (60, 120))
    )
    for label, window in [
        ("first 5 min", (0, min(300, duration_s))),
        labelled_minute2,
        ("final minute", (duration_s - 60, duration_s)),
        ("last 5 min", (max(0, duration_s - 300), duration_s)),
    ]:
        got = voices_in(*window)
        assert got == want, f"{label} {window}: voices {got} != {want}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--only", choices=["2min", "30min", "60min"])
    args = ap.parse_args()
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    work_dir = out_dir / "turn-clips"
    work_dir.mkdir(exist_ok=True)

    clips = []
    for speaker, voice in VOICES:
        for j, text in enumerate(TEXTS[speaker]):
            pcm = synth(work_dir, f"{speaker}-{j}", voice, text)
            clips.append((speaker, voice, pcm))
            print(f"clip {speaker}-{j} ({voice}): {len(pcm) // 2 / SR:.1f}s")
    # Alternate voices strictly: I0 C0 I1 C1 I2 C2 I0 ...
    cycle = [clips[0], clips[3], clips[1], clips[4], clips[2], clips[5]]

    targets = {"2min": 120, "30min": 1800, "60min": 3600}
    for name, target_s in targets.items():
        if args.only and name != args.only:
            continue
        pcm, turns, duration_s = build_fixture(cycle, target_s)
        check_windows(turns, duration_s)
        wav_path = out_dir / f"diarization-{name}.wav"
        with wave.open(str(wav_path), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes(pcm)
        gt = {
            "file": str(wav_path),
            "sample_rate": SR,
            "duration_s": duration_s,
            "target_duration_s": target_s,
            "gap_s": GAP_S,
            "speakers": [s for s, _ in VOICES],
            "turns": turns,
        }
        gt_path = out_dir / f"diarization-{name}.ground-truth.json"
        gt_path.write_text(json.dumps(gt, indent=2))
        print(f"wrote {wav_path} duration={duration_s}s (target {target_s}s) turns={len(turns)}")


if __name__ == "__main__":
    sys.exit(main())
