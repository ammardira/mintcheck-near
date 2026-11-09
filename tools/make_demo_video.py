#!/usr/bin/env python3
"""Render a terminal-replay demo video from REAL MintCheck runs.

Runs the two bundled demos (they anchor fresh verdicts on NEAR testnet),
then renders the session as 1280x720 frames and encodes H.264 MP4.
Also exports the final frame of each segment as a screenshot PNG.
"""
import glob
import subprocess
import sys
import textwrap
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "demo"
FRAMES = OUT / "frames"
W, H = 1280, 720
BG = (13, 17, 23)
FG = (230, 237, 243)
GREEN = (63, 185, 80)
DIM = (139, 148, 158)
ACCENT = (88, 166, 255)
WRAP = 92
LINE_H = 24
TOP = 64
LEFT = 28
MAX_LINES = (H - TOP - 20) // LINE_H


def font(size):
    for pat in ("/usr/share/fonts/**/DejaVuSansMono.ttf",
                "/usr/share/fonts/**/LiberationMono-Regular.ttf"):
        hits = glob.glob(pat, recursive=True)
        if hits:
            return ImageFont.truetype(hits[0], size)
    return ImageFont.load_default()


FONT = font(19)
FONT_B = font(19)


def run_demo(args):
    p = subprocess.run(["node", "agent/mintcheck.js", *args],
                       cwd=ROOT, capture_output=True, text=True)
    return (p.stdout or "").strip()


def color_for(line):
    if line.startswith("$"):
        return GREEN
    if "verdict:" in line or line.startswith("risk score"):
        return ACCENT
    if line.startswith("anchored") or line.startswith("registry read-back"):
        return GREEN
    if line.startswith("  ["):
        return DIM
    return FG


def wrapped(lines):
    out = []
    for ln in lines:
        if len(ln) <= WRAP:
            out.append(ln)
        else:
            out.extend(textwrap.wrap(ln, WRAP, subsequent_indent="    "))
    return out


def render(lines, path):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 44], fill=(22, 27, 34))
    d.text((LEFT, 13), "mintcheck — NEAR testnet demo", font=FONT, fill=FG)
    y = TOP
    for ln in lines[-MAX_LINES:]:
        d.text((LEFT, y), ln, font=FONT, fill=color_for(ln))
        y += LINE_H
    img.save(path)


def segment_frames(seg_idx, lines, hold_last=2.6):
    """One frame per added line, plus a longer hold on the final frame."""
    frames = []
    shown = []
    all_lines = wrapped(lines)
    for ln in all_lines:
        shown.append(ln)
        fp = FRAMES / f"s{seg_idx}-{len(frames):03d}.png"
        render(shown, fp)
        frames.append((fp, 0.55))
    if frames:
        fp, _ = frames[-1]
        frames[-1] = (fp, hold_last)
        shot = OUT / f"screenshot-{seg_idx}.png"
        render(shown, shot)
    return frames


def main():
    OUT.mkdir(exist_ok=True)
    FRAMES.mkdir(exist_ok=True)
    for old in FRAMES.glob("*.png"):
        old.unlink()

    print("running demo 1 (pokechain sample)...", flush=True)
    out1 = run_demo(["--sample", "samples/pokechain.json"])
    print("running demo 2 (suspicious sample)...", flush=True)
    out2 = run_demo(["--sample", "samples/suspicious.json"])

    seg1 = [
        "MintCheck — a scam-detection agent for the agent economy",
        "It vets a mint project from verifiable evidence, scores the risk",
        "with a transparent rubric, and anchors the verdict on NEAR.",
        "",
        "$ node agent/mintcheck.js --sample samples/pokechain.json",
        *out1.splitlines(),
    ]
    seg2 = [
        "Same rubric, other end of the scale: a project with no official X,",
        "a 'free' mint that is not free, hidden paid tiers, no readable supply.",
        "",
        "$ node agent/mintcheck.js --sample samples/suspicious.json",
        *out2.splitlines(),
    ]
    # pull the explorer lines out of the outputs for the outro card
    links = [ln.split("explorer: ")[1] for ln in (out1 + "\n" + out2).splitlines()
             if "explorer: " in ln]
    seg3 = [
        "Both verdicts are now public record on NEAR testnet.",
        "",
        "Registry contract: registry.mintcheck-agent.testnet",
        "Agent account:     mintcheck-agent.testnet",
        "",
        "Any agent can read a verdict before it transacts:",
        "$ near view registry.mintcheck-agent.testnet verdict_count '{}'",
        "",
        "Transactions from this recording:",
        *[f"  {u}" for u in links],
        "",
        "Built at NEAR HACKATHON — AI Security & Defense / Agent Economy",
    ]

    frames = []
    frames += segment_frames(1, seg1)
    frames += segment_frames(2, seg2)
    frames += segment_frames(3, seg3, hold_last=4.0)

    concat = OUT / "concat.txt"
    with open(concat, "w") as f:
        for fp, dur in frames:
            f.write(f"file '{fp}'\nduration {dur}\n")
        f.write(f"file '{frames[-1][0]}'\n")
    video = OUT / "mintcheck-demo.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat),
         "-vsync", "vfr", "-pix_fmt", "yuv420p", "-c:v", "libx264",
         "-preset", "medium", "-crf", "20", str(video)],
        check=True, capture_output=True)
    total = sum(d for _, d in frames)
    print(f"video: {video} (~{total:.0f}s, {video.stat().st_size // 1024} KB)")
    print(f"screenshots: {sorted(p.name for p in OUT.glob('screenshot-*.png'))}")


if __name__ == "__main__":
    sys.exit(main())
