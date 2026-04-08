# Simulator | Documentation

Source: https://hub.evenrealities.com/docs/reference/simulator

The simulator (
v0.6.2
) lets you preview UI layouts and test logic without physical hardware. It is a supplement to â not a replacement for â hardware testing.
Installation
â
bash
npm
install
-g
@evenrealities/evenhub-simulator
npm:
@evenrealities/evenhub-simulator
â cross-platform (macOS, Linux, Windows)
Usage
â
bash
evenhub-simulator
[OPTIONS] [targetUrl]
Options
â
Option
Description
-c
,
--config <path>
Path to config file (use
--print-config-path
to see the default)
-g
,
--glow
Enable glow effect on glasses display
--no-glow
Disable glow effect (overrides config)
-b
,
--bounce <type>
Bounce animation type:
default
or
spring
--list-audio-input-devices
List available audio input devices
--aid <device>
Choose a specific audio input device
--no-aid
Use default audio device (overrides config)
--print-config-path
Print the default config file path and exit
--completions <shell>
Generate shell completions:
bash
,
elvish
,
fish
,
powershell
,
zsh
-V
,
--version
Print version
-h
,
--help
Print help
Default Config File Paths
â
Platform
Location
Linux
$XDG_CONFIG_HOME
or
$HOME/.config
macOS
$HOME/Library/Application Support
Windows
{FOLDERID_RoamingAppData}
(e.g.,
C:\Users\<user>\AppData\Roaming
)
Audio
â
The simulator emits
audioEvents
with the following specification:
Sample rate: 16,000 Hz
Format: signed 16-bit little-endian PCM
100ms of data per event (3,200 bytes / 1,600 samples)
Screenshot (v0.5.0+)
â
The simulator supports exporting the glasses display as an RGBA PNG file. Upon clicking the screenshot button, it exports to your current working directory with a timestamp-based filename. The file path is logged to both the simulator stdout and the glasses web inspector console.
The screenshot is not affected by the glow flag â that is a visual post-processing effect only.
Caveats
â
Display rendering
may not perfectly match hardware (font rendering, greyscale levels). Sufficient for layout validation and logic testing.
List scrolling
behavior (focused-item positioning) can differ from real glasses.
Image processing
is faster and does not enforce hardware size limits.
Events:
Status events are not emitted (user/device profiles are hardcoded). Supported inputs: Up, Down, Click, Double Click.
Error handling
may differ from hardware under abnormal conditions.
Always validate on actual hardware before deployment. If you find discrepancies that affect logic, please file a bug report in the
Discord
.
