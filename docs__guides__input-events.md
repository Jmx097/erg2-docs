# Input & Events | Documentation

Source: https://hub.evenrealities.com/docs/guides/input-events

Input Sources
â
The G2 glasses, optional R1 ring, and IMU sensors each provide distinct input:
Source
Gestures / Data
Notes
G2 touchpads
(temple)
Press, double press, swipe up, swipe down
Primary input on the glasses frame
R1 touchpads
(ring)
Press, double press, swipe up, swipe down
Same gesture set as G2, but events are distinguishable by source
IMU
(accelerometer / gyroscope)
Head orientation, motion data
Available for motion-aware apps â see
IMU API
G2 and R1 touchpad events share the same event types but can now be distinguished by their input source, allowing apps to assign different behaviors to glasses vs. ring input.
Event Types
â
Event
Value
Description
CLICK_EVENT
0
Single press (G2 or R1)
SCROLL_TOP_EVENT
1
Swipe up / scroll reaches top boundary
SCROLL_BOTTOM_EVENT
2
Swipe down / scroll reaches bottom boundary
DOUBLE_CLICK_EVENT
3
Double press (G2 or R1)
FOREGROUND_ENTER_EVENT
4
App comes to foreground
FOREGROUND_EXIT_EVENT
5
App goes to background
ABNORMAL_EXIT_EVENT
6
Unexpected disconnect
Handling Events
â
typescript
bridge.
onEvenHubEvent
(
event
=>
{
const
textEvent
=
event
.
textEvent
if
(textEvent)
{
const
eventType
=
textEvent
.
eventType
switch
(eventType)
{
case
OsEventTypeList
.
CLICK_EVENT
:
case
undefined
:
// SDK normalizes 0 to undefined in some cases
// Handle press
break
case
OsEventTypeList
.
DOUBLE_CLICK_EVENT
:
// Handle double press
break
case
OsEventTypeList
.
SCROLL_TOP_EVENT
:
// Handle swipe up / scroll up
break
case
OsEventTypeList
.
SCROLL_BOTTOM_EVENT
:
// Handle swipe down / scroll down
break
}
}
}
)
Event Routing
â
Event delivery depends on which container has
isEventCapture: 1
:
Capture container type
Events arrive as
Text container
event.textEvent
List container
event.listEvent
Only
one
container per page can capture events. Design your interaction model around a single active input target.
Lifecycle Events
â
Your app receives lifecycle events when its visibility changes:
FOREGROUND_ENTER_EVENT
â the user has opened or returned to your app. Use this to resume updates or refresh data.
FOREGROUND_EXIT_EVENT
â your app has moved to the background. Pause any timers or ongoing work.
ABNORMAL_EXIT_EVENT
â the Bluetooth connection was lost unexpectedly.
