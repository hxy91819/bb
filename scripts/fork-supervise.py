import ctypes
import errno
import json
import os
import signal
import subprocess
import sys
import time


PR_SET_CHILD_SUBREAPER = 36
libc = ctypes.CDLL(None, use_errno=True)
if libc.prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) != 0:
    raise OSError(ctypes.get_errno(), "PR_SET_CHILD_SUBREAPER")
if not hasattr(os, "pidfd_open") or not hasattr(signal, "pidfd_send_signal"):
    raise RuntimeError("fork supervision requires Linux pidfd support")

stop_signal = None
deadline = None


def interrupt(number, frame):
    global stop_signal, deadline
    if stop_signal is None:
        stop_signal = number
        deadline = time.monotonic() + 3


for number in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
    signal.signal(number, interrupt)


def identity(pid):
    try:
        with open(f"/proc/{pid}/stat") as source:
            parts = source.read().rsplit(")", 1)[1].split()
        return int(parts[1]), parts[19]
    except (FileNotFoundError, ProcessLookupError):
        return None


def descendants(parent):
    result = []
    pending = [parent]
    seen = {parent}
    while pending:
        current = pending.pop()
        try:
            tasks = os.listdir(f"/proc/{current}/task")
        except (FileNotFoundError, ProcessLookupError):
            continue
        for task in tasks:
            try:
                with open(f"/proc/{current}/task/{task}/children") as source:
                    children = [int(value) for value in source.read().split()]
            except (FileNotFoundError, ProcessLookupError):
                continue
            for child in children:
                if child not in seen:
                    seen.add(child)
                    pending.append(child)
                    result.append(child)
    return result


def owned(pid):
    seen = set()
    while pid not in seen:
        if pid == os.getpid():
            return True
        seen.add(pid)
        current = identity(pid)
        if current is None:
            return False
        pid = current[0]
    return False


def supervisor(pid):
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as source:
            arguments = source.read().split(b"\0")
        return len(arguments) > 1 and os.path.realpath(
            os.fsdecode(arguments[1])
        ) == os.path.realpath(__file__)
    except (FileNotFoundError, ProcessLookupError):
        return False


def terminate(number):
    for pid in reversed(descendants(os.getpid())):
        before = identity(pid)
        if before is None:
            continue
        try:
            descriptor = os.pidfd_open(pid)
        except ProcessLookupError:
            continue
        try:
            if identity(pid) != before or not owned(pid):
                continue
            if number == signal.SIGKILL and supervisor(pid):
                continue
            signal.pidfd_send_signal(descriptor, number)
        except ProcessLookupError:
            pass
        finally:
            os.close(descriptor)


locks = json.loads(os.environ.get("BB_FORK_LOCKS", "[]"))
descriptors = tuple(entry["fd"] for entry in locks)
try:
    child = subprocess.Popen(sys.argv[1:], pass_fds=descriptors, start_new_session=True)
except OSError as error:
    print(f"{errno.errorcode.get(error.errno, 'spawn')}: {error}", file=sys.stderr)
    sys.exit(1)

status = None
adopted_failure = False
while True:
    empty = False
    while True:
        try:
            pid, result = os.waitpid(-1, os.WNOHANG)
        except ChildProcessError:
            empty = True
            break
        if pid == 0:
            break
        code = os.waitstatus_to_exitcode(result)
        if pid == child.pid:
            child.returncode = code
            status = code if code >= 0 else 128 - code
        elif code != 0:
            adopted_failure = True
    if empty:
        break
    if stop_signal is not None:
        terminate(signal.SIGKILL if time.monotonic() >= deadline else stop_signal)
    time.sleep(0.05)

sys.exit(
    128 + stop_signal if stop_signal is not None else (status or int(adopted_failure))
)
