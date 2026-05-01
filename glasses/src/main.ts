import "./style.css";
import { EvenHubAppController, type ControllerSnapshot } from "./app-controller.js";
import { BridgeClient } from "./bridge.js";
import { DisplayController } from "./display.js";
import {
  connectEvenBridge,
  isAbnormalExitEvent,
  isClickEvent,
  isDoubleClickEvent,
  isForegroundEnterEvent,
  isForegroundExitEvent
} from "./even.js";

const statusBadge = requireElement<HTMLSpanElement>("#status-badge");
const statusDetail = requireElement<HTMLParagraphElement>("#status-detail");
const transportMode = requireElement<HTMLParagraphElement>("#transport-mode");
const installId = requireElement<HTMLParagraphElement>("#install-id");
const accessExpiry = requireElement<HTMLParagraphElement>("#access-expiry");
const pairForm = requireElement<HTMLFormElement>("#pair-form");
const relayUrlInput = requireElement<HTMLInputElement>("#relay-url");
const relayUrlError = requireElement<HTMLElement>("#relay-url-error");
const legacyBridgeTokenInput = requireElement<HTMLInputElement>("#legacy-bridge-token");
const pairingCodeInput = requireElement<HTMLInputElement>("#pairing-code");
const pairingCodeError = requireElement<HTMLElement>("#pairing-code-error");
const deviceDisplayNameInput = requireElement<HTMLInputElement>("#device-display-name");
const deviceDisplayNameError = requireElement<HTMLElement>("#device-display-name-error");
const pairSubmit = requireElement<HTMLButtonElement>("#pair-submit");
const repairSubmit = requireElement<HTMLButtonElement>("#repair-submit");
const promptDraft = requireElement<HTMLTextAreaElement>("#prompt-draft");
const sendPromptButton = requireElement<HTMLButtonElement>("#send-prompt");
const refreshSessionButton = requireElement<HTMLButtonElement>("#refresh-session");
const reconnectSessionButton = requireElement<HTMLButtonElement>("#reconnect-session");
const pendingIndicator = requireElement<HTMLSpanElement>("#pending-indicator");
const replyLog = requireElement<HTMLPreElement>("#reply-log");
const lastError = requireElement<HTMLParagraphElement>("#last-error");

let hudRenderer: ((text: string) => void) | null = null;

void boot();

async function boot(): Promise<void> {
  renderBootOnly("Waiting for Even bridge...");

  try {
    const evenBridge = await connectEvenBridge();
    const display = new DisplayController(evenBridge);
    await display.create("OpenClaw G2\nStarting...");
    hudRenderer = createHudRenderer(display);

    const controller = new EvenHubAppController(evenBridge, new BridgeClient());
    controller.subscribe((snapshot) => {
      renderSnapshot(snapshot);
      hudRenderer?.(snapshot.hudText);
    });

    wireUi(controller);
    evenBridge.onEvenHubEvent((event) => {
      if (isClickEvent(event)) {
        void controller.sendPrompt();
      } else if (isDoubleClickEvent(event)) {
        controller.cancelOrReturnIdle();
      } else if (isForegroundEnterEvent(event)) {
        void controller.handleForegroundEnter();
      } else if (isForegroundExitEvent(event)) {
        controller.handleForegroundExit();
      } else if (isAbnormalExitEvent(event)) {
        controller.handleAbnormalExit();
      }
    });

    await controller.boot();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown startup error";
    renderBootOnly(message);
    hudRenderer?.(`OpenClaw error.\n${message}`);
  }
}

function wireUi(controller: EvenHubAppController): void {
  pairForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void controller.submitPairing();
  });

  relayUrlInput.addEventListener("input", () => {
    controller.setPairingField("relayBaseUrl", relayUrlInput.value);
  });
  pairingCodeInput.addEventListener("input", () => {
    controller.setPairingField("pairingCode", pairingCodeInput.value);
  });
  legacyBridgeTokenInput.addEventListener("input", () => {
    controller.setLegacyBridgeToken(legacyBridgeTokenInput.value);
  });
  deviceDisplayNameInput.addEventListener("input", () => {
    controller.setPairingField("deviceDisplayName", deviceDisplayNameInput.value);
  });
  promptDraft.addEventListener("input", () => {
    controller.setPromptDraft(promptDraft.value);
  });
  sendPromptButton.addEventListener("click", () => {
    void controller.sendPrompt();
  });
  refreshSessionButton.addEventListener("click", () => {
    void controller.refreshCurrentSession();
  });
  reconnectSessionButton.addEventListener("click", () => {
    void controller.reconnect();
  });
  repairSubmit.addEventListener("click", () => {
    void controller.repair();
  });
}

function renderSnapshot(snapshot: ControllerSnapshot): void {
  document.body.dataset.status = snapshot.status;
  statusBadge.textContent = snapshot.status.replace(/_/g, " ");
  statusDetail.textContent = snapshot.statusDetail;
  transportMode.textContent = snapshot.transportMode.replace(/_/g, " ") || "none";
  installId.textContent = snapshot.installId;
  accessExpiry.textContent = snapshot.accessTokenExpiresAt
    ? new Date(snapshot.accessTokenExpiresAt).toLocaleString()
    : "Not issued yet";

  setInputValue(relayUrlInput, snapshot.relayBaseUrl);
  setInputValue(legacyBridgeTokenInput, snapshot.legacyBridgeToken);
  setInputValue(pairingCodeInput, snapshot.pairingCode);
  setInputValue(deviceDisplayNameInput, snapshot.deviceDisplayName);
  setInputValue(promptDraft, snapshot.promptDraft);

  setError(relayUrlError, snapshot.pairingErrors.relayBaseUrl);
  setError(pairingCodeError, snapshot.pairingErrors.pairingCode);
  setError(deviceDisplayNameError, snapshot.pairingErrors.deviceDisplayName);

  pairSubmit.disabled = snapshot.status === "pairing";
  pairSubmit.textContent = snapshot.status === "pairing" ? "Pairing..." : "Pair Device";

  const sessionAvailable =
    snapshot.status !== "unpaired" || snapshot.transportMode === "legacy_v0" || Boolean(snapshot.storedRegistration);
  sendPromptButton.disabled = !sessionAvailable || snapshot.status === "pairing";
  refreshSessionButton.disabled =
    !snapshot.storedRegistration || snapshot.status === "pairing" || snapshot.transportMode !== "paired_v1";
  reconnectSessionButton.disabled =
    (!snapshot.storedRegistration && snapshot.transportMode !== "legacy_v0") || snapshot.status === "pairing";
  repairSubmit.disabled = snapshot.status === "pairing";

  sendPromptButton.textContent = snapshot.status === "request_in_progress" ? "Sending..." : "Send Prompt";
  pendingIndicator.hidden = !snapshot.pendingPromptId;
  replyLog.textContent = snapshot.lastReply || "No reply yet.";

  if (snapshot.lastError) {
    lastError.hidden = false;
    lastError.textContent = snapshot.lastError;
  } else {
    lastError.hidden = true;
    lastError.textContent = "";
  }
}

function renderBootOnly(message: string): void {
  document.body.dataset.status = "booting";
  statusBadge.textContent = "booting";
  statusDetail.textContent = message;
  transportMode.textContent = "none";
  installId.textContent = "Loading...";
  accessExpiry.textContent = "Not issued yet";
  replyLog.textContent = "No reply yet.";
  lastError.hidden = true;
}

function setError(target: HTMLElement, message: string | undefined): void {
  target.hidden = !message;
  target.textContent = message || "";
}

function createHudRenderer(display: DisplayController): (text: string) => void {
  let pending = Promise.resolve();

  return (text: string) => {
    pending = pending.then(() => display.render(text)).catch(() => undefined);
  };
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element;
}

function setInputValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  if (element.value !== value) {
    element.value = value;
  }
}
