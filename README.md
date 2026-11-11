# Omacharge Limit

Battery charge limit switch for the Omarchy bar. Two modes:

- **🌿 Battery saver** — stops charging at 80% (default, battery-friendly)
- **⚡ Full charge** — charges to 100%, reverts to 80% on unplug

## Screenshots

| Saver (default) | Full charge (one-shot) |
|---|---|
| ![Saver](screenshots/panel-saver.png) | ![Full](screenshots/panel-full.png) |

## Install

```bash
omarchy plugin add https://github.com/rubar/omacharge-limit.git --enable
```

Then run the one-time helper setup (needs sudo):

```bash
~/.config/omarchy/plugins/rubar.charge-limit/tools/install-helper.sh
```

This installs `/usr/local/bin/charge-limit-apply` (root-owned) and a strict passwordless sudo rule scoped to that binary. Re-run it after every plugin update so the installed helper matches the plugin version.

## Usage

- **Left-click** the bar pill → open panel with mode selection
- **Right-click** the bar pill → instant toggle
- **Unplug charger** → auto-reverts to 80%

## How it works

Reads `/sys/class/power_supply/BAT0/charge_control_end_threshold` (polling every 15s, 3s with the panel open) and watches `UPower.onBattery` for the auto-revert.

Mode changes are one `sudo -n charge-limit-apply saver|full` call. The helper writes the end threshold in a single EC transaction (dropping a conflicting start threshold first when needed) and deliberately does **not** read back afterwards: the EC churns for a moment after a write and polls of a busy EC stall the kernel — and on ThinkPads, EC-sourced input. The widget waits ~3s (settle window) before its confirming refresh. Manual/debug use:

```bash
sudo charge-limit-apply check   # read-only: prints the current thresholds
sudo charge-limit-apply saver   # stop charging at 80%
sudo charge-limit-apply full    # stop charging at 100%
```

## Requirements

- Omarchy Linux (Hyprland + Quickshell shell)
- A battery with `charge_control_end_threshold` support (most modern laptops)

## Remove

```bash
omarchy plugin remove rubar.omacharge-limit
sudo rm /usr/local/bin/charge-limit-apply
sudo rm /etc/sudoers.d/charge-limit
```

## License

MIT
