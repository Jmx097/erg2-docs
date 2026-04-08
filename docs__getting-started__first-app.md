# Your First App | Documentation

Source: https://hub.evenrealities.com/docs/getting-started/first-app

Initialize the SDK
â
typescript
import
{
waitForEvenAppBridge
,
EvenAppBridge
}
from
'
@evenrealities/even_hub_sdk
'
// Recommended: async wait â resolves when the bridge is ready
const
bridge
=
await
waitForEvenAppBridge
()
// Alternative: synchronous singleton â only after bridge is initialized
const
bridge
=
EvenAppBridge.
getInstance
()
Create a Page
â
Display a simple text screen on the glasses:
typescript
import
{
waitForEvenAppBridge
,
TextContainerProperty
}
from
'
@evenrealities/even_hub_sdk
'
const
bridge
=
await
waitForEvenAppBridge
()
const
textContainer
=
new
TextContainerProperty
(
{
xPosition
:
0
,
yPosition
:
0
,
width
:
576
,
height
:
288
,
borderWidth
:
0
,
borderColor
:
5
,
paddingLength
:
4
,
containerID
:
1
,
containerName
:
'
main
'
,
content
:
'
Hello from G2!
'
,
isEventCapture
:
1
,
}
)
const
result
=
await
bridge.
createStartUpPageContainer
(
1
, [
textContainer
]
)
// result: 0 = success, 1 = invalid, 2 = oversize, 3 = out of memory
Run It
â
With the Simulator
â
bash
evenhub-simulator
http://localhost:5173
No hardware needed â the simulator renders the glasses display on your screen.
On Real Hardware
â
Generate a QR code pointing to your local dev server:
bash
evenhub
qr
--url
"
http://192.168.1.100:5173
"
Scan it with the
Even Realities App
on your phone. Your app loads on the glasses with hot reload support.
Next Steps
â
Learn about the
Display & UI System
â containers, text, images, and fonts
Understand
Input & Events
â handling presses, swipes, and gestures
Read the
Design Guidelines
for the 576x288 canvas
