# Packaging & Deployment | Documentation

Source: https://hub.evenrealities.com/docs/reference/packaging

The
app.json
Manifest
â
Every Even Hub app requires an
app.json
manifest. Generate a starter file with:
bash
evenhub
init
This creates the following template:
json
{
"
package_id
"
:
"
com.example.g2demo
"
,
"
edition
"
:
"
202601
"
,
"
name
"
:
"
G2 Demo
"
,
"
version
"
:
"
0.1.0
"
,
"
min_app_version
"
:
"
2.0.0
"
,
"
min_sdk_version
"
:
"
0.0.7
"
,
"
entrypoint
"
:
"
index.html
"
,
"
permissions
"
:
[
{
"
name
"
:
"
network
"
,
"
desc
"
:
"
This app needs to access the network in order to ...
"
,
"
whitelist
"
:
[
"
https://example.com
"
]
}
],
"
supported_languages
"
:
[
"
en
"
]
}
Field Reference
â
Field
Type
Required
Rules
package_id
string
Yes
Reverse-domain format (e.g.,
com.yourname.appname
). Each segment must start with a
lowercase letter
and contain only
lowercase letters or numbers
. Minimum two segments. No hyphens.
edition
string
Yes
Must be
"202601"
(current edition).
name
string
Yes
20 characters or fewer.
version
string
Yes
Semver format:
x.y.z
(e.g.,
"1.0.0"
).
min_app_version
string
Yes
Minimum Even Realities App version required (e.g.,
"2.0.0"
).
min_sdk_version
string
Yes
Minimum SDK version required (e.g.,
"0.0.7"
).
entrypoint
string
Yes
Path to your HTML entry file relative to the build folder (e.g.,
"index.html"
).
permissions
array
Yes
Array of permission objects (see below). Can be empty
[]
.
supported_languages
array
Yes
Array of language codes. Valid values:
en
,
de
,
fr
,
es
,
it
,
zh
,
ja
,
ko
.
Permissions Format
â
Permissions are an
array of objects
, not a key-value map. Each object must have:
Key
Type
Required
Notes
name
string
Yes
One of:
network
,
location
,
g2-microphone
,
phone-microphone
,
album
,
camera
desc
string
Yes
Human-readable reason,
1â300 characters
.
whitelist
string[]
network
only
List of allowed domains. Optional, defaults to
[]
.
Example with multiple permissions:
json
"
permissions
"
: [
{
"
name
"
:
"
network
"
,
"
desc
"
:
"
Fetches weather data from the API.
"
,
"
whitelist
"
:
[
"
https://api.weather.com
"
]
},
{
"
name
"
:
"
g2-microphone
"
,
"
desc
"
:
"
Enables voice commands for hands-free control.
"
},
{
"
name
"
:
"
location
"
,
"
desc
"
:
"
Shows nearby points of interest on the display.
"
}
]
:::caution[Common mistake] The permissions field must be an
array of objects
â not a key-value map. This format is incorrect and will fail validation:
json
"
permissions
"
: {
"
network
"
:
[
"
example.com
"
] }
:::
Building and Packing
â
Step 1: Build your web app
â
bash
npm
run
build
This produces your output directory (typically
dist/
or
build/
).
Step 2: Pack into
.ehpk
â
bash
evenhub
pack
app.json
dist
-o
myapp.ehpk
Argument
Description
app.json
Path to your manifest file
dist
Path to your
built
output folder
-o myapp.ehpk
Output filename (defaults to
out.ehpk
)
--no-ignore
Include hidden files (dotfiles) â excluded by default
-c
,
--check
Check if your
package_id
is available on Even Hub
TIP
The
entrypoint
in your
app.json
must point to a file that
exists inside the build folder
. If your manifest says
"entrypoint": "index.html"
but the build folder doesn't contain
index.html
, packing will fail with:
Entrypoint file not found: dist/index.html
Troubleshooting
evenhub pack
â
When packing fails, the CLI prints specific validation errors. Here are the most common ones and how to fix them:
Invalid package id
â
package_id: must be a valid package name (e.g., com.example.app).
Each segment must start with a lowercase letter and contain only
lowercase letters or numbers. Two or more segments are required.
Fix:
Use lowercase reverse-domain format with at least two segments. No hyphens, no uppercase, no leading numbers in any segment.
Invalid
Valid
My-App
com.myname.myapp
com.my-app.v2
com.myapp.v2
myapp
com.example.myapp
com.2fast.app
com.twofast.app
name: must be 20 characters or fewer
â
Fix:
Shorten your app name. Use the
tagline
or
description
fields for longer text.
version: must be in x.y.z format
â
Fix:
Use three-part semver:
"1.0.0"
, not
"1.0"
or
"v1.0.0"
.
min_app_version / min_sdk_version: expected string, received undefined
â
Fix:
Both fields are
required
. Add them to your
app.json
:
json
"
min_app_version
"
:
"
2.0.0
"
,
"
min_sdk_version
"
:
"
0.0.7
"
permissions: each permission must be an object with "name" ...
â
Fix:
Permissions must be an array of objects with
name
and
desc
keys. See the
Permissions Format
section above.
supported_languages: invalid language
â
Fix:
Use lowercase ISO codes from the supported set:
en
,
de
,
fr
,
es
,
it
,
zh
,
ja
,
ko
.
Entrypoint file not found
â
Fix:
Make sure the file referenced by
entrypoint
exists inside your build folder. If your Vite output goes to
dist/
and your entrypoint is
index.html
, check that
dist/index.html
exists.
Project folder not found
â
Fix:
The second argument to
evenhub pack
must be a
path to an existing directory
containing your built files. Run your build step first (
npm run build
).
Distribution
â
Once submitted, your app becomes available on
Even Hub
. Users can:
Download
your app from the Even Hub page
Launch
it from the glasses menu or through the Even Realities App on their phone
