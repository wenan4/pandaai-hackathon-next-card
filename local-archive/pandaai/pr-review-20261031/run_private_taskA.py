"""Local-only task A rebuild with progress; credentials stay in process memory."""
import contextlib
import getpass
import io
import os
from pathlib import Path
import re
import sys
import time

repo = Path(__file__).resolve().parent.parent / "repo"
sys.path.insert(0, str(repo / "scripts"))
user = getpass.getpass("Temporary data username: ")
password = getpass.getpass("Temporary data password: ")
os.environ["PANDA_USER"] = user
os.environ["PANDA_PASS"] = password
started, output = time.monotonic(), sys.stdout

def progress(message):
    print(f"[{time.monotonic() - started:.0f}s] {message}", file=output, flush=True)

try:
    import build_taskA as ta
    original_load = ta.bc.load

    class ProgressDays(list):
        def __iter__(self):
            for i, day in enumerate(super().__iter__()):
                if i % 10 == 0:
                    progress(f"Evaluating decision dates {i}/{len(self)}")
                yield day

    def tracked_load():
        progress("Loading cached market data and checking data cutoff")
        data = list(original_load())
        data[1] = ProgressDays(data[1])
        progress("Market data loaded")
        return tuple(data)

    ta.bc.load = tracked_load
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        ta.build()
    progress("COMPLETE: taskA.json rebuilt against the published game")
except Exception as exc:
    message = str(exc).replace(user, "<account>").replace(password, "<secret>")
    message = re.sub(r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*", "<token>", message)
    progress(f"FAILED {type(exc).__name__}: {message[:400]}")
    sys.exit(1)
finally:
    os.environ.pop("PANDA_USER", None)
    os.environ.pop("PANDA_PASS", None)
