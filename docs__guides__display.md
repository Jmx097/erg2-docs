# Display & UI System | Documentation

Source: https://hub.evenrealities.com/docs/guides/display

Canvas
â
Each eye displays a
576 x 288 pixel
canvas. Coordinate origin is at the top-left corner. X increases rightward, Y increases downward.
All colors are rendered as
4-bit greyscale
â 16 levels of green. White pixels appear as bright green; black pixels are off (transparent).
Containers
â
The UI is built from
containers
â rectangular regions positioned with absolute pixel coordinates. There is no CSS, no flexbox, no DOM.
Rules:
Maximum
4 image containers
and
8 other containers
per page (mixed types allowed)
Exactly
one
container must have
isEventCapture: 1
â this container receives all input events
Containers can overlap; later containers draw on top
No z-index control beyond declaration order
Shared Properties
â
Property
Type
Range
Notes
xPosition
number
0â576
Left edge (px)
yPosition
number
0â288
Top edge (px)
width
number
0â576
Container width (px)
height
number
0â288
Container height (px)
containerID
number
â
Unique per page
containerName
string
max 16 chars
Unique per page
isEventCapture
number
0 or 1
Exactly one must be
1
Border Properties
â
Available on text and list containers only:
Property
Type
Range
Notes
borderWidth
number
0â5
0 = no border
borderColor
number
0â15 / 0â16
Greyscale level
borderRadius
number
0â10
Rounded corners (note: typo preserved from SDK protobuf)
paddingLength
number
0â32
Uniform padding on all sides
There is no background color or fill color property. The only visual decoration is the border.
Text Containers
â
The primary container type. Renders plain text, left-aligned, top-aligned. No text alignment options, no font size control, no bold/italic.
typescript
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
Your text here
'
,
isEventCapture
:
1
,
}
)
Content Limits
â
Method
Max Characters
createStartUpPageContainer
1,000
textContainerUpgrade
2,000
rebuildPageContainer
1,000
Behavior
â
Text wraps at container width
If content overflows and the container has
isEventCapture: 1
, the firmware handles internal scrolling
\n
works for line breaks
Unicode characters are supported (within the firmware's font set)
~400â500 characters fill a full-screen text container
To "center" text, manually pad with spaces
In-Place Updates
â
Use
textContainerUpgrade
â faster than a full page rebuild and flicker-free on hardware:
typescript
await
bridge.
textContainerUpgrade
(containerID
,
containerName
,
newContent
,
contentOffset
,
contentLength)
List Containers
â
Native scrollable lists. The firmware handles scroll highlighting natively.
Maximum
20 items
per list
Maximum
64 characters
per item
No custom styling per item, no item height control, no separator lines
Cannot be updated in-place â must rebuild the entire page
Image Containers
â
Display greyscale images on the glasses.
Width: 20â200 px, Height: 20â100 px
4-bit greyscale
Accepts
number[]
,
Uint8Array
,
ArrayBuffer
, or base64
Cannot send during
createStartUpPageContainer
â create a placeholder container, then update via
updateImageRawData
No concurrent image sends
Image-based app pattern:
Use a full-screen text container (content:
' '
) with
isEventCapture: 1
behind the image container. The text container receives events; the image container draws on top.
Font & Unicode Support
â
The glasses use a single LVGL font baked into firmware. No font selection, no font size control, not monospaced. Characters outside the font are silently skipped.
Useful Characters for Building UIs
â
Use Case
Characters
Progress bars
â
â
ââââââââ
Navigation
â²â³â¶â·â¼â½ââ
Selection
ââ
â â¡
ââ
Borders
â­â®â¯â°
ââ
box drawing set
Card suits
â â£â¥â¦
Full supported glyph tables are available in the
community G2 notes
.
