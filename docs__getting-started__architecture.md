# Architecture | Documentation

Source: https://hub.evenrealities.com/docs/getting-started/architecture

Even Hub apps are
web apps
built with standard web technologies and the Even Hub SDK. You develop them locally, and when ready for distribution, you package and submit them to the
Even Hub platform
, where users can download and run them.
Connection Model
â
ââââââââââââââââââââ    HTTPS     ââââââââââââââââââââââ   Bluetooth    âââââââââââââââââ
â  Even Hub Cloud  â ââââââââââââº â  Phone             â ââââââââââââââº â  G2 Glasses   â
â  (distribution   â              â  (Even Realities   â                â  (display +   â
â   & hosting)     â              â   App + WebView)   â                â   input)      â
ââââââââââââââââââââ              ââââââââââââââââââââââ                âââââââââââââââââ
The phone
runs the Even Realities App, which opens your app in a WebView and handles all communication with the glasses over Bluetooth. Your app logic executes here.
The glasses
render UI containers and send back input events (presses, scrolls, swipes). Aside from native scroll processing, app logic does not run on the glasses.
Testing Your App
â
There are several ways to get your app running on hardware during development:
QR sideloading
â run a local dev server and generate a QR code via the CLI. Scan it with the Even Realities App to load your app directly with hot reload.
Private builds
â package your app via the CLI (
evenhub pack
) and upload it to the developer portal for testing on your own devices.
Simulator
â preview layouts and test logic entirely on your computer, no hardware needed.
PWA as an Alternative
â
If you prefer to keep your app private or distribute it outside of Even Hub, you can build a
Progressive Web App (PWA)
and route users directly to your hosted web app. This approach gives you full control over distribution and hosting, though it does not go through Even Hub's packaging and review process.
The SDK Bridge
â
The SDK injects a JavaScript bridge (
EvenAppBridge
) into the WebView. Your frontend calls this bridge to control the glasses display and receive input events.
Web â Glasses:
Your JS calls
bridge.callEvenApp(method, params)
â WebView bridge â Even Realities App â Bluetooth â glasses.
Glasses â Web:
Input events travel Bluetooth â Even Realities App â
window._listenEvenAppMessage(...)
â your callback.
App Structure
â
A typical Even Hub app is a standard web project with an
app.json
manifest for packaging:
my-app/
âââ src/
â   âââ main.ts              # App entry point
â   âââ components/          # Your UI components
âââ public/
â   âââ assets/              # Static assets (icons, images)
âââ index.html               # HTML entry
âââ package.json
âââ vite.config.ts           # Build config (Vite recommended)
âââ tsconfig.json            # TypeScript config (optional)
âââ app.json                 # Even Hub manifest (required for packaging)
The SDK (
@evenrealities/even_hub_sdk
) is the only Even-specific dependency. Everything else is standard web tooling.
