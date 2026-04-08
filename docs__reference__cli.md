# CLI | Documentation

Source: https://hub.evenrealities.com/docs/reference/cli

The CLI (
v0.1.10
) handles authentication, QR sideloading, and app packaging.
Installation
â
bash
npm
install
-D
@evenrealities/evenhub-cli
Or install globally:
bash
npm
install
-g
@evenrealities/evenhub-cli
npm:
@evenrealities/evenhub-cli
Commands
â
evenhub login
â
Authenticate with your Even Hub developer account.
bash
evenhub
login
evenhub
login
-e
your@email.com
Option
Description
-e
,
--email <email>
Your account email
evenhub init
â
Generate a starter
app.json
manifest in the current or specified directory.
bash
evenhub
init
evenhub
init
-d
./my-project
evenhub
init
-o
./config/app.json
Option
Description
-d
,
--directory <dir>
Directory to create the file in (default:
./
)
-o
,
--output <path>
Output file path (overrides
--directory
)
evenhub qr
â
Generate a QR code for sideloading your app during development.
bash
# Simplest usage â provide the full URL
evenhub
qr
--url
"
http://192.168.1.100:5173
"
# Or build the URL from parts
evenhub
qr
-i
192.168.1.100
-p
5173
--path
/my-app
# Output to a file instead of terminal
evenhub
qr
--url
"
http://192.168.1.100:5173
"
-e
Option
Description
-u
,
--url <url>
Full URL (ignores other URL options)
-i
,
--ip <ip>
IP address or hostname
-p
,
--port <port>
Port number
--path <path>
URL path
--https
Use HTTPS instead of HTTP
--http
Use HTTP (default)
-e
,
--external
Open QR in external program instead of terminal
-s
,
--scale <n>
Scale factor for file output (default: 4)
--clear
Clear cached scheme, IP, port, and path
Scan the QR code with the
Even Realities App
on your phone. Your app loads on the glasses with hot reload support.
evenhub pack
â
Package your built app into an
.ehpk
file for distribution.
bash
evenhub
pack
app.json
dist
-o
myapp.ehpk
Argument / Option
Description
<json>
Path to your
app.json
manifest
<project>
Path to your built output folder (
dist
,
build
, etc.)
-o
,
--output <file>
Output filename (default:
out.ehpk
)
--no-ignore
Include hidden files (dotfiles)
-c
,
--check
Check if the
package_id
is available on Even Hub
See
Packaging & Deployment
for the full
app.json
schema, validation rules, and troubleshooting guide.
Shell Completions
â
Generate completions for your shell:
bash
evenhub
--completion-bash
# Bash
evenhub
--completion-zsh
# Zsh
evenhub
--completion-fish
# Fish
