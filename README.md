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

Mode changes are one `sudo -n charge-limit-apply saver|full` call. The helper does the whole pairing with root: it reads the EC's fresh state, writes `charge_control_{start,end}_threshold` in an order that keeps `start < end` at every step (the kernel rejects a write that would break that invariant), skips values that already match, then verifies the settled result and retries a few times before failing. Manual/debug use:

```bash
sudo charge-limit-apply check   # read-only: prints the current thresholds
sudo charge-limit-apply saver   # 80/75
sudo charge-limit-apply full    # 100/99
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
