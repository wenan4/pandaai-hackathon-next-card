"""Local-only authenticated rebuild. Credentials are prompted and never written here."""
import contextlib
import getpass
import io
import json
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
started = time.monotonic()
output = sys.stdout
count = 0

def progress(message):
    print(f"[{time.monotonic() - started:.0f}s] {message}", file=output, flush=True)

try:
    import build_cases as bc
    original_call = bc.data.call

    def tracked_call(fn, **kwargs):
        global count
        count += 1
        if count == 1 or count % 10 == 0:
            progress(f"Data request {count}: {fn}")
        return original_call(fn, **kwargs)

    bc.data.call = tracked_call
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        progress("Starting authenticated case generation")
        candidates, stats, groups, benchmark, t_days, pools = bc.scan()
        as_of = bc.data.last_trade_date()
    progress("Data scan complete; validating and exporting cases")
    chosen = bc.pick(candidates)
    bc.write_report(candidates, stats, chosen, t_days)
    bc.export(chosen, groups, benchmark, stats, t_days, as_of)
    summary = {"as_of": as_of, "script_version": bc.SCRIPT_VERSION, "stats": stats,
               "chosen": {rid: {"symbol": c.symbol, "date": c.t} for rid, c in chosen.items()}}
    (Path(__file__).parent / "rebuild-result.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    progress("COMPLETE " + json.dumps(summary, ensure_ascii=False))
except Exception as exc:
    message = str(exc).replace(user, "<account>").replace(password, "<secret>")
    message = re.sub(r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*", "<token>", message)
    progress(f"FAILED {type(exc).__name__}: {message[:400]}")
    sys.exit(1)
finally:
    os.environ.pop("PANDA_USER", None)
    os.environ.pop("PANDA_PASS", None)
