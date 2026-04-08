# UI/UX Design Guidelines | Documentation

Source: https://hub.evenrealities.com/docs/guides/design-guidelines

Even Realities publishes official software design guidelines covering layout principles, component patterns, interaction models, and visual standards for the glasses display and companion app screens.
View the Design Guidelines in Figma â
Display Constraints
â
When designing for the G2 display, keep in mind:
576 x 288 px
â this is a very small canvas. Every pixel matters.
4-bit greyscale
â design in shades of grey; the hardware renders them as shades of green.
No background fill
â you can only use borders and text/image content for visual structure.
Max 4 image containers, 8 other containers
â plan your layout within this constraint.
One event-capturing container
â design your interaction model around a single active input target.
Designing Icons
â
When creating icons for the glasses display, follow these principles:
Design at native resolution
â work at the actual pixel size (e.g., 24x24). Avoid designing large and scaling down.
Keep it simple
â Aim for immediately recognizable silhouettes with minimal internal detail.
Test on hardware
â the green-tinted greyscale rendering on the glasses differs from your monitor. Always verify icon legibility on the actual display or simulator with glow enabled.
Common UI Patterns
â
Pattern
How
Fake buttons
Prefix text with
>
as a cursor indicator
Selection highlight
Toggle
borderWidth
on individual text containers
Multi-row layout
Stack multiple text containers vertically (e.g., 3 containers at 96px height)
Progress bars
Use Unicode block characters:
â
and
â
Page flipping
Pre-paginate text at ~400â500 character boundaries, rebuild on scroll events
