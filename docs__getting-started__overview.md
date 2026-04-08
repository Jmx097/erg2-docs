# Overview | Documentation

Source: https://hub.evenrealities.com/docs/getting-started/overview

The Even Realities G2 are smart glasses with dual micro-LED displays (one per lens), a four-microphone array, touchpads on the temples, and optional R1 ring for additional input. They pair with your phone via Bluetooth 5.2.
Key Hardware Specs
â
Spec
Value
Display
576 x 288 pixels per eye
Color depth
4-bit greyscale (16 shades of green)
Connectivity
Bluetooth 5.2
Audio input
4-mic array (single audio stream, 16kHz PCM)
G2 touchpads
Press, double press, swipe up, swipe down
R1 touchpads
Press, double press, swipe up, swipe down (optional accessory)
Camera / Speaker
None
The glasses are privacy-focused by design â no camera, no speaker. App logic runs on the phone; the glasses handle display rendering and native scroll processing.
What You Can Build
â
The Even Hub platform currently supports
plugins
â background-layer apps that run alongside the core glasses experience. The platform is actively expanding to include:
Dashboard widgets
â glanceable cards on the glasses home screen
Dashboard layouts
â custom arrangements of widgets and information
AI skills and integrations
â intelligent features that extend the glasses' capabilities
Plugins are
web apps
built with standard web technologies (HTML, CSS, JavaScript/TypeScript) and the Even Hub SDK. You develop with any framework you prefer â Vite, React, vanilla JS â and the SDK provides the bridge between your web code and the glasses hardware.
Development Workflow
â
1. Write code      â  Standard web app (Vite + SDK)
2. Preview locally â  evenhub-simulator http://localhost:5173
3. Test on device  â  Sideload via QR, or upload a private build to the dev portal
4. Package         â  evenhub pack app.json dist -o myapp.ehpk
5. Submit          â  Upload .ehpk to Even Hub for distribution
Quick Reference
â
Resource
Link
SDK
npm: @evenrealities/even_hub_sdk
Simulator
npm: @evenrealities/evenhub-simulator
CLI
npm: @evenrealities/evenhub-cli
Design Guidelines
Figma: Software Design Guidelines
Community Notes
GitHub: even-g2-notes
Community Toolkit
GitHub: even-toolkit
Discord
discord.gg/Y4jHMCU4sv
