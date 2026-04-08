# Page Lifecycle | Documentation

Source: https://hub.evenrealities.com/docs/guides/page-lifecycle

Methods
â
Method
Purpose
Notes
createStartUpPageContainer
Create the initial page
Called exactly once at startup. Returns result code.
rebuildPageContainer
Replace the entire page
Full redraw â all state is lost, brief flicker on hardware.
textContainerUpgrade
Update text in-place
Faster, flicker-free on hardware. Requires matching
containerID
+
containerName
.
updateImageRawData
Update an image container
No concurrent sends allowed.
shutDownPageContainer
Exit the app
Pass
0
for immediate exit,
1
for exit confirmation dialog.
callEvenApp
Generic method call
Escape hatch â all typed methods are wrappers around this.
Result Codes
â
For
createStartUpPageContainer
:
Code
Meaning
0
Success
1
Invalid parameters
2
Oversize
3
Out of memory
rebuildPageContainer
,
textContainerUpgrade
, and
shutDownPageContainer
return
boolean
.
updateImageRawData
returns a status string:
success
,
imageException
,
imageSizeInvalid
,
imageToGray4Failed
, or
sendFailed
.
Best Practices
â
Use
textContainerUpgrade
for frequent text updates (counters, status, live data) â it avoids the flicker of a full rebuild.
Use
rebuildPageContainer
when changing the container layout (adding/removing containers, switching between text and list).
Always match
containerID
and
containerName
exactly when using
textContainerUpgrade
.
Do not call
updateImageRawData
concurrently â wait for one to complete before sending the next.
