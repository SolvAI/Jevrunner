#!/usr/bin/env python3
"""H2O Lightning 4B on llama.cpp: Jevrunner's model backend for Windows, macOS and Linux (any GPU, or the CPU).

    python3 scripts/llamacpp.py setup    # a llama.cpp build for this machine, the GGUF, H2O's shim package (verified)
    python3 scripts/llamacpp.py serve    # llama-server + H2O's shim: the System One API on http://127.0.0.1:8741

It runs H2O's own llama.cpp shim (h2o_lightning_llamacpp.py, from h2oai/h2o-lightning-4b-gguf) unchanged, on top of a
prebuilt llama-server started with the flags H2O's launcher uses (the Qwen2 tokenizer override, no unified KV cache).
At start-up the shim checks 24 tokenizer probes, so a backend that tokenizes differently stops with an error instead
of answering wrong. Standard library only; every download is checked against its SHA-256.

Settings (environment, or config.env at the repo's root):
  QUANT        Q8_0 (4.5 GB, default) | Q4_K_M (2.7 GB, for small GPUs) | BF16 (8.4 GB)
  LLAMA_BUILD  auto (default) | cuda | vulkan | cpu | metal       which llama.cpp build to download
  LLAMA_SERVER path to a llama-server you already have (skips the download)
  SLOTS        llama-server slots (default 1: with more, this model runs no faster on llama.cpp and needs more memory)
  SLOT_CTX     tokens per slot (default 8192; 4096 saves a little memory for a 4 GB GPU)
  NGL          layers on the GPU (default: all, or 0 for the CPU build); LLAMA_ARGS extra llama-server flags
  IMAGES=1     also load the vision projector (0.7 GB), for the game's EYES · SCREEN mode
  H2O_PORT (8741), LLAMA_PORT (8600), JEVRUNNER_HOME (~/.jevrunner)
"""
from __future__ import annotations

import hashlib
import json
import os
import platform
import shutil
import signal
import subprocess
import sys
import tarfile
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Pinned versions: the GGUF repo (weights, H2O's shim package, its manifest of hashes) and the llama.cpp release
GGUF_REPO = "h2oai/h2o-lightning-4b-gguf"
GGUF_REVISION = "3e269d70f078ffbf08003cf604416e9f69e47ba2"
DEFAULT_LLAMA_TAG = "b11707"
QUANT_FILES = {
    "Q8_0": "h2o-lightning-4b-stock-Q8_0.gguf",
    "Q4_K_M": "h2o-lightning-4b-stock-experimental-Q4KM.gguf",
    "BF16": "h2o-lightning-4b-stock-BF16.gguf",
}
PROJECTOR = "mmproj-lightning-f16.gguf"
PACKAGE = ["h2o_lightning_llamacpp.py", "h2o_lightning_shim.py", "serve_config.json", "tokenizer_contract.json",
           "reserved_control_escape.py", "assets.py", "box.py", "LICENSE"]
TOKENIZER_OVERRIDE = "tokenizer.ggml.pre=str:qwen2"  # from the package's tokenizer_contract.json
MODEL_ALIAS = "h2oai/h2o-lightning-4b"


def load_config():
    """Environment first, then config.env (KEY=VALUE lines, # comments), then defaults."""
    cfg = {}
    env_file = ROOT / "config.env"
    if env_file.is_file():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                cfg[k.strip().removeprefix("export ").strip()] = v.strip().strip('"').strip("'")
    cfg.update({k: v for k, v in os.environ.items() if v != ""})
    home = Path(os.path.expanduser(cfg.get("JEVRUNNER_HOME", "~/.jevrunner")))
    if "QUANT" not in cfg:  # not chosen: the one setup installed last, else Q8_0
        try:
            cfg["QUANT"] = json.loads((home / "llamacpp.json").read_text())["quant"]
        except (OSError, ValueError, KeyError):
            cfg["QUANT"] = "Q8_0"
    quant = cfg["QUANT"].upper().replace("Q4KM", "Q4_K_M")
    if quant not in QUANT_FILES:
        sys.exit(f"QUANT must be one of {', '.join(QUANT_FILES)} (got {quant})")
    return {
        "home": home,
        "quant": quant,
        "build": cfg.get("LLAMA_BUILD", "auto").lower(),
        "tag": cfg.get("LLAMA_TAG", DEFAULT_LLAMA_TAG),
        "server": cfg.get("LLAMA_SERVER", ""),
        "slots": int(cfg.get("SLOTS", "1")),
        "slot_ctx": int(cfg.get("SLOT_CTX", "8192")),
        "ngl": cfg.get("NGL", ""),
        "images": cfg.get("IMAGES", "0") in ("1", "true", "yes", "on"),
        "port": int(cfg.get("H2O_PORT", "8741")),
        "llama_port": int(cfg.get("LLAMA_PORT", "8600")),
        "llama_args": cfg.get("LLAMA_ARGS", "").split(),
    }


def say(msg):
    print(f"==> {msg}", flush=True)


# ---------------------------------------------------------------------------------------------- downloads, verified
def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(8 << 20), b""):
            h.update(block)
    return h.hexdigest()


def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "jevrunner", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def download(url, dest, expected_sha=None, expected_bytes=None):
    """Download to dest (resuming a partial .part file), then check its size and SHA-256 when known."""
    dest = Path(dest)
    if dest.is_file() and (expected_sha is None or sha256(dest) == expected_sha):
        print(f"    {dest.name}: already there")
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    have = part.stat().st_size if part.exists() else 0
    headers = {"User-Agent": "jevrunner"}
    if have:
        headers["Range"] = f"bytes={have}-"
    req = urllib.request.Request(url, headers=headers)
    try:
        r = urllib.request.urlopen(req, timeout=60)
    except urllib.error.HTTPError as e:
        if e.code == 416:  # the partial file is already complete
            r = None
        else:
            raise
    if r is not None:
        if have and r.status != 206:
            have = 0  # the server ignored the range: start over
        total = int(r.headers.get("Content-Length") or 0) + have
        mode = "ab" if have else "wb"
        done, last, shown = have, 0.0, False
        with r, open(part, mode) as f:
            while True:
                block = r.read(1 << 20)
                if not block:
                    break
                f.write(block)
                done += len(block)
                if time.time() - last > 0.5 and total:
                    last = time.time()
                    print(f"\r    {dest.name}: {done / 1e9:.2f} / {total / 1e9:.2f} GB ({100 * done / total:.0f}%)  ", end="", flush=True)
                    shown = True
        print("" if shown else f"    {dest.name}")
    if expected_bytes is not None and part.stat().st_size != expected_bytes:
        raise SystemExit(f"{dest.name}: got {part.stat().st_size} bytes, expected {expected_bytes}; run setup again")
    if expected_sha is not None and sha256(part) != expected_sha:
        part.unlink()
        raise SystemExit(f"{dest.name}: SHA-256 differs from the published one; deleted, run setup again")
    part.replace(dest)
    return dest


def hf_url(name):
    return f"https://huggingface.co/{GGUF_REPO}/resolve/{GGUF_REVISION}/{name}"


# ----------------------------------------------------------------------------------------------- llama.cpp builds
def has_nvidia():
    return shutil.which("nvidia-smi") is not None and subprocess.run(
        ["nvidia-smi", "-L"], capture_output=True, text=True).returncode == 0


def has_vulkan():
    system = platform.system()
    if system == "Windows":
        return (Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "vulkan-1.dll").exists()
    if system == "Linux":
        out = subprocess.run(["sh", "-c", "ldconfig -p 2>/dev/null | grep -q 'libvulkan.so.1'"])
        return out.returncode == 0
    return False


def pick_build(want):
    system = platform.system()
    if system == "Darwin":
        return "metal"
    if want != "auto":
        return want
    if has_nvidia():
        return "cuda"
    if has_vulkan():
        return "vulkan"
    return "cpu"


def release_assets(tag, build):
    """The llama.cpp release files for this OS, CPU architecture and build."""
    system = platform.system()
    machine = platform.machine().lower()
    arm = machine in ("arm64", "aarch64")
    if system == "Darwin":
        return [f"llama-{tag}-bin-macos-{'arm64' if arm else 'x64'}.tar.gz"]
    if system == "Linux":
        if build == "cuda":
            cuda = "cuda-13.4-arm64" if arm else "cuda-12.8-x64"
            return [f"llama-{tag}-bin-ubuntu-{cuda}.tar.gz", f"cudart-llama-{tag}-bin-ubuntu-{cuda}.tar.gz"]
        if build == "vulkan":
            return [f"llama-{tag}-bin-ubuntu-vulkan-{'arm64' if arm else 'x64'}.tar.gz"]
        return [f"llama-{tag}-bin-ubuntu-{'arm64' if arm else 'x64'}.tar.gz"]
    if system == "Windows":
        if build == "cuda":
            cuda = "cuda-13.4-arm64" if arm else "cuda-12.4-x64"
            return [f"llama-{tag}-bin-win-{cuda}.zip", f"cudart-llama-bin-win-{cuda}.zip"]
        if build == "vulkan":
            return [f"llama-{tag}-bin-win-vulkan-{'arm64' if arm else 'x64'}.zip"]
        return [f"llama-{tag}-bin-win-cpu-{'arm64' if arm else 'x64'}.zip"]
    raise SystemExit(f"no llama.cpp build for {system}; set LLAMA_SERVER to a llama-server you built")


def extract(archive, into):
    into.mkdir(parents=True, exist_ok=True)
    if archive.name.endswith(".zip"):
        with zipfile.ZipFile(archive) as z:
            for m in z.namelist():  # no paths outside the target folder
                if Path(m).is_absolute() or ".." in Path(m).parts:
                    raise SystemExit(f"unsafe path in {archive.name}: {m}")
            z.extractall(into)
    else:
        with tarfile.open(archive) as t:
            if hasattr(tarfile, "data_filter"):
                t.extractall(into, filter="data")
            else:
                for m in t.getmembers():
                    if Path(m.name).is_absolute() or ".." in Path(m.name).parts:
                        raise SystemExit(f"unsafe path in {archive.name}: {m.name}")
                t.extractall(into)


def install_llama(cfg):
    if cfg["server"]:
        server = Path(cfg["server"]).expanduser()
        if not server.is_file():
            raise SystemExit(f"LLAMA_SERVER={server} does not exist")
        return server, "custom"
    build = pick_build(cfg["build"])
    tag = cfg["tag"]
    target = cfg["home"] / "llama.cpp" / f"{tag}-{build}"
    exe = "llama-server.exe" if platform.system() == "Windows" else "llama-server"
    found = next(iter(sorted(target.rglob(exe))), None) if target.exists() else None
    if found:
        print(f"    llama.cpp {tag} ({build}): already there")
        return found, build
    say(f"llama.cpp {tag}, {build} build for {platform.system()} {platform.machine()}")
    digests = {}
    try:  # GitHub publishes each release file's SHA-256
        for a in fetch_json(f"https://api.github.com/repos/ggml-org/llama.cpp/releases/tags/{tag}").get("assets", []):
            if (a.get("digest") or "").startswith("sha256:"):
                digests[a["name"]] = a["digest"].split(":", 1)[1]
    except (urllib.error.URLError, OSError, ValueError) as e:
        print(f"    (could not read the release's checksums: {e}; downloading without them)")
    downloads = cfg["home"] / "downloads"
    for asset in release_assets(tag, build):
        path = download(f"https://github.com/ggml-org/llama.cpp/releases/download/{tag}/{asset}", downloads / asset,
                        expected_sha=digests.get(asset))
        extract(path, target)
    servers = sorted(target.rglob(exe))
    if not servers:
        raise SystemExit(f"no {exe} in the llama.cpp download at {target}")
    server = servers[0]
    # the CUDA runtime comes in its own archive: put its libraries next to llama-server, where the CUDA backend looks
    # first (without them it would quietly run on the CPU on a machine that has no CUDA toolkit installed)
    for lib in [*target.rglob("*.dll"), *target.rglob("*.so*")]:
        if lib.is_file() and lib.parent != server.parent and not (server.parent / lib.name).exists():
            shutil.copy2(lib, server.parent / lib.name)
    if platform.system() != "Windows":
        server.chmod(server.stat().st_mode | 0o111)
    return server, build


def check_server(server):
    try:
        out = subprocess.run([str(server), "--version"], capture_output=True, text=True, timeout=60)
    except OSError as e:
        raise SystemExit(f"llama-server does not start: {e}")
    text = (out.stdout + out.stderr).strip().splitlines()
    if out.returncode != 0:
        raise SystemExit("llama-server does not start:\n    " + "\n    ".join(text[-6:]))
    return next((line for line in text if line.startswith("version")), text[-1] if text else "?")


# ---------------------------------------------------------------------------------------------------------- setup
def setup(cfg):
    home = cfg["home"]
    home.mkdir(parents=True, exist_ok=True)
    server, build = install_llama(cfg)
    print(f"    llama-server: {server} ({check_server(server)})")

    say(f"H2O Lightning 4B, GGUF {cfg['quant']} ({GGUF_REPO} @ {GGUF_REVISION[:10]})")
    manifest = fetch_json(hf_url("artifact_manifest.json"))
    gguf_dir = home / "gguf"
    names = [QUANT_FILES[cfg["quant"]]] + ([PROJECTOR] if cfg["images"] else [])
    for name in names:
        spec = manifest["models"][name]
        download(hf_url(name), gguf_dir / name, expected_sha=spec["sha256"], expected_bytes=spec["bytes"])
    say("H2O's llama.cpp shim package")
    for name in PACKAGE:
        download(hf_url(f"package/{name}"), gguf_dir / "package" / name, expected_sha=manifest["source_files"][f"package/{name}"])

    state = {"server": str(server), "build": build, "tag": cfg["tag"], "quant": cfg["quant"], "gguf_revision": GGUF_REVISION}
    (home / "llamacpp.json").write_text(json.dumps(state, indent=2) + "\n")
    say("llama.cpp backend ready")


# ---------------------------------------------------------------------------------------------------------- serve
def http_json(url, body=None, timeout=10):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data, {"Content-Type": "application/json"} if data else {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, json.load(r)


def wait_health(url, proc, name, deadline):
    while time.time() < deadline:
        if proc.poll() is not None:
            raise SystemExit(f"{name} exited while starting; see its log")
        try:
            status, _ = http_json(url, timeout=3)
            if status == 200:
                return
        except (urllib.error.URLError, OSError, ValueError):
            pass
        time.sleep(1)
    raise SystemExit(f"{name} did not get ready in time; see its log")


def serve(cfg):
    home = cfg["home"]
    state_file = home / "llamacpp.json"
    if not state_file.is_file():
        raise SystemExit("run setup first (scripts/setup.sh, or scripts\\setup.ps1 on Windows)")
    state = json.loads(state_file.read_text())
    server = cfg["server"] or state["server"]
    gguf = home / "gguf" / QUANT_FILES[cfg["quant"]]
    package = home / "gguf" / "package"
    if not gguf.is_file():
        raise SystemExit(f"{gguf.name} is missing: run setup with QUANT={cfg['quant']}")
    projector = home / "gguf" / PROJECTOR
    images = cfg["images"] and projector.is_file()
    ngl = cfg["ngl"] or ("0" if state["build"] == "cpu" else "99")
    logs = home / "logs"
    logs.mkdir(parents=True, exist_ok=True)

    backend_cmd = [server, "-m", str(gguf), "--alias", MODEL_ALIAS,
                   "-c", str(cfg["slots"] * cfg["slot_ctx"]), "-np", str(cfg["slots"]), "--no-kv-unified",
                   "-ngl", ngl, "--override-kv", TOKENIZER_OVERRIDE,
                   "--host", "127.0.0.1", "--port", str(cfg["llama_port"])]
    # llama-server's host-RAM prompt cache saves ~100 MB of state before every new prompt, and a game's states are all
    # new: it only adds time. Older builds don't have the flag.
    if "--cache-ram" in subprocess.run([server, "--help"], capture_output=True, text=True, timeout=60).stdout:
        backend_cmd += ["--cache-ram", "0"]
    backend_cmd += cfg["llama_args"]
    if images:
        backend_cmd += ["--mmproj", str(projector), "--image-max-tokens", "1024"]
        if ngl == "0":
            backend_cmd.append("--no-mmproj-offload")
    shim_cmd = [sys.executable, str(package / "h2o_lightning_llamacpp.py"), "--config", str(package / "serve_config.json"),
                "--server", f"http://127.0.0.1:{cfg['llama_port']}", "--port", str(cfg["port"])]
    env = dict(os.environ, PYTHONUNBUFFERED="1", SHIM_LLAMA_IMAGES="1" if images else "0")
    if platform.system() == "Linux":  # llama.cpp's own libraries (and its CUDA runtime) before any system ones
        env["LD_LIBRARY_PATH"] = os.pathsep.join(filter(None, [str(Path(server).parent), env.get("LD_LIBRARY_PATH")]))

    children = []
    stopping = False

    def stop(*_):
        nonlocal stopping
        stopping = True
        for p in reversed(children):
            if p.poll() is None:
                p.terminate()
        for p in children:
            try:
                p.wait(timeout=10)
            except subprocess.TimeoutExpired:
                p.kill()

    signal.signal(signal.SIGTERM, lambda *_: (stop(), sys.exit(0)))
    try:
        say(f"llama-server ({state['build']}, {cfg['quant']}, {cfg['slots']} slots x {cfg['slot_ctx']} tokens), log: {logs / 'llama-server.log'}")
        children.append(subprocess.Popen(backend_cmd, stdout=open(logs / "llama-server.log", "ab"), stderr=subprocess.STDOUT, env=env))
        deadline = time.time() + 600
        wait_health(f"http://127.0.0.1:{cfg['llama_port']}/health", children[0], "llama-server", deadline)
        say(f"H2O's shim on :{cfg['port']}, log: {logs / 'shim.log'}")
        children.append(subprocess.Popen(shim_cmd, stdout=open(logs / "shim.log", "ab"), stderr=subprocess.STDOUT, env=env))
        wait_health(f"http://127.0.0.1:{cfg['port']}/health", children[1], "the shim", deadline)
        # one real decision: the shim checks its tokenizer probes and the label probabilities on the first one
        _, probe = http_json(f"http://127.0.0.1:{cfg['port']}/v1/systemone", {
            "state": "warm-up", "questions": {"ok": {"type": "choice", "instructions": "Pick one.",
                                                     "criteria": {"a": "first", "b": "second"}}}}, timeout=300)
        if set(probe["answers"]["ok"]["probabilities"]) != {"a", "b"}:
            raise SystemExit("the first decision came back without its probabilities")
        print(f"H2O-Lightning-4B ready on http://127.0.0.1:{cfg['port']}/v1/systemone "
              f"(llama.cpp {state['tag']} {'cpu' if ngl == '0' else state['build']}, {cfg['quant']}{', images' if images else ''})", flush=True)
        while all(p.poll() is None for p in children):
            time.sleep(1)
        if not stopping:
            raise SystemExit("llama-server or the shim stopped; see their logs")
    except KeyboardInterrupt:
        pass
    finally:
        stop()


if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in ("setup", "serve"):
        sys.exit(__doc__)
    config = load_config()
    setup(config) if sys.argv[1] == "setup" else serve(config)
