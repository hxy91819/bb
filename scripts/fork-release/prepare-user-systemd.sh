#!/usr/bin/env bash
set -euo pipefail

[[ "${GITHUB_ACTIONS:-}" == true ]] || { printf '%s\n' 'This preparation is restricted to ephemeral GitHub Actions runners' >&2; exit 1; }
[[ -f /sys/fs/cgroup/cgroup.controllers ]] || { printf '%s\n' 'cgroup v2 is required' >&2; exit 1; }
runner_uid="$(id -u)"
manager_unit="user@${runner_uid}.service"
export XDG_RUNTIME_DIR="/run/user/${runner_uid}"
export DBUS_SESSION_BUS_ADDRESS="unix:path=${XDG_RUNTIME_DIR}/bus"

snapshot() {
  printf '\n%s\n' "$1"
  systemctl show user.slice "user-${runner_uid}.slice" "${manager_unit}" \
    -p Id -p LoadState -p ActiveState -p Delegate -p DelegateControllers -p DisableControllers -p ControlGroup
  local group
  group="$(systemctl show "${manager_unit}" -p ControlGroup --value)"
  node --input-type=module - "${group}" <<'NODE'
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
let group = process.argv[2] || '/';
if (!group.startsWith('/') || group.split('/').includes('..')) throw new Error('Invalid manager cgroup');
for (;;) {
  const values = { group };
  for (const name of ['cgroup.controllers','cgroup.subtree_control','cpu.max','memory.max','memory.high','pids.max']) {
    const file = join('/sys/fs/cgroup',group,name);
    values[name] = existsSync(file) ? readFileSync(file,'utf8').trim() : 'absent';
  }
  console.log(JSON.stringify(values));
  if (group === '/') break;
  group = dirname(group);
}
NODE
}

diagnose_failure() {
  local status=$?
  trap - ERR
  systemctl show "${manager_unit}" -p Result -p ExecMainCode -p ExecMainStatus -p StatusErrno -p ActiveState -p SubState || true
  sudo systemctl status --no-pager -l "${manager_unit}" || true
  sudo journalctl --no-pager -b -u "${manager_unit}" -n 100 || true
  local failed_pid
  failed_pid="$(systemctl show "${manager_unit}" -p ExecMainPID --value)"
  if [[ "${failed_pid}" =~ ^[1-9][0-9]*$ ]]; then sudo journalctl --no-pager -b "_PID=${failed_pid}" || true; fi
  snapshot "Failed preparation" || true
  exit "${status}"
}
trap diagnose_failure ERR

systemctl --version
cat /etc/os-release
systemctl cat "${manager_unit}"
snapshot 'Before user service delegation'
caller_group="$(awk -F: '$1 == "0" {print $3}' /proc/self/cgroup)"
manager_group="$(systemctl show "${manager_unit}" -p ControlGroup --value)"
printf 'Preparation caller cgroup: %s\n' "${caller_group}"
if [[ -n "${manager_group}" && ( "${caller_group}" == "${manager_group}" || "${caller_group}" == "${manager_group}/"* ) ]]; then
  printf '%s\n' 'Refusing to reconfigure the CI user manager containing this job' >&2
  exit 1
fi
dropin="/run/systemd/system/${manager_unit}.d"
sudo mkdir -p "${dropin}"
printf '[Service]\nDelegate=cpu memory pids\n' | sudo tee "${dropin}/90-bb-maintenance.conf" >/dev/null
sudo systemctl daemon-reload
sudo systemctl set-property --runtime "${manager_unit}" CPUAccounting=yes MemoryAccounting=yes TasksAccounting=yes
snapshot 'After activating resource accounting through PID1'
systemctl --user daemon-reexec
systemctl cat "${manager_unit}"
for attempt in {1..50}; do
  if systemctl --user show --property=ControlGroup --value -- -.slice >/dev/null; then break; fi
  sleep 0.1
done
systemctl --user show --property=ControlGroup --value -- -.slice
snapshot 'After CI user service runtime drop-in and user daemon reexec'
group="$(systemctl show "${manager_unit}" -p ControlGroup --value)"
for controller in cpu memory pids; do
  grep -qw "${controller}" "/sys/fs/cgroup${group}/cgroup.controllers" || { printf 'Missing delegated controller: %s\n' "${controller}" >&2; exit 1; }
done
printf 'XDG_RUNTIME_DIR=%s\nDBUS_SESSION_BUS_ADDRESS=%s\n' "${XDG_RUNTIME_DIR}" "${DBUS_SESSION_BUS_ADDRESS}" >> "${GITHUB_ENV}"
