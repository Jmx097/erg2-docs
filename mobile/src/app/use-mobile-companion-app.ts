import { useEffect, useMemo, useRef, useState } from "react";
import NetInfo from "@react-native-community/netinfo";
import type { RelayServerMessage } from "@openclaw/protocol";
import type { MobileCompanionSnapshot } from "../mobile-companion";
import { MobileCompanionController } from "../mobile-companion";
import { MobileAuthClient } from "../auth-client";
import { loadMobileAppConfig } from "../config";
import { NoopBleBridge } from "../ble";
import { ExpoSecureStorageAdapter } from "../adapters/expo-secure-storage";
import { createNativeWebSocketFactory } from "../adapters/native-websocket";
import { DEVICE_REGISTRATION_STORAGE_KEY, DeviceRegistrationStore } from "../secure-storage";
import {
  isRevokedMessage,
  isTokenExpiringMessage,
  RelayWebSocketSession,
  type SessionState
} from "../websocket-session";
import { validatePairingForm, type PairingFormErrors, type PairingFormInput } from "../validation";

type AppScreen = "pair" | "connecting" | "connected" | "repair";

interface UiState {
  screen: AppScreen;
  busy: boolean;
  statusDetail: string;
  connectionState: string;
  lastReply: string;
  lastEventId?: string;
  lastError?: string;
  notice?: string;
  repairMessage?: string;
  promptDraft: string;
  form: PairingFormInput;
  formErrors: PairingFormErrors;
}

const DEFAULT_PROMPT = "Reply with one sentence confirming the mobile relay connection is healthy.";

export function useMobileCompanionApp() {
  const config = useMemo(() => loadMobileAppConfig(), []);
  const relaySessionRef = useRef(new RelayWebSocketSession({ websocketFactory: createNativeWebSocketFactory() }));
  const controllerRef = useRef(
    new MobileCompanionController(
      new DeviceRegistrationStore(new ExpoSecureStorageAdapter(), DEVICE_REGISTRATION_STORAGE_KEY),
      new MobileAuthClient(),
      relaySessionRef.current,
      new NoopBleBridge()
    )
  );
  const promptCounterRef = useRef(0);

  const [controllerSnapshot, setControllerSnapshot] = useState<MobileCompanionSnapshot>(controllerRef.current.getSnapshot());
  const [uiState, setUiState] = useState<UiState>({
    screen: "connecting",
    busy: true,
    statusDetail: "Checking for a stored device session...",
    connectionState: "idle",
    lastReply: "",
    promptDraft: DEFAULT_PROMPT,
    form: {
      relayBaseUrl: config.defaultRelayBaseUrl,
      pairingSessionId: "",
      pairingCode: "",
      deviceDisplayName: config.defaultDeviceDisplayName
    },
    formErrors: {}
  });

  useEffect(() => {
    let cancelled = false;

    const boot = async () => {
      try {
        const restored = await controllerRef.current.restore();
        if (cancelled) {
          return;
        }

        setControllerSnapshot(controllerRef.current.getSnapshot());

        if (!restored) {
          setUiState((current) => ({
            ...current,
            busy: false,
            screen: "pair",
            statusDetail: "Pair this device with a relay URL and short pairing code.",
            connectionState: "idle"
          }));
          return;
        }

        setUiState((current) => ({
          ...current,
          busy: true,
          screen: "connecting",
          statusDetail: "Restoring the saved session and opening the relay socket..."
        }));

        await controllerRef.current.connect();
        if (cancelled) {
          return;
        }

        setControllerSnapshot(controllerRef.current.getSnapshot());
        setUiState((current) => ({
          ...current,
          busy: false,
          screen: "connected",
          statusDetail: "Connected and ready to talk to OpenClaw.",
          connectionState: relaySessionRef.current.getState().status
        }));
      } catch (error) {
        if (cancelled) {
          return;
        }

        const repaired = await controllerRef.current.repairFromError(error);
        setControllerSnapshot(repaired);
        setUiState((current) => ({
          ...current,
          busy: false,
          screen: repaired.registration ? "repair" : "pair",
          statusDetail: repaired.registration
            ? "The saved session needs attention before it can reconnect."
            : "No usable session was found. Pair this device to continue.",
          repairMessage: repaired.repairMessage,
          lastError: error instanceof Error ? error.message : "Unknown startup error"
        }));
      }
    };

    void boot();

    return () => {
      cancelled = true;
    };
  }, [config.defaultDeviceDisplayName, config.defaultRelayBaseUrl]);

  useEffect(() => {
    return relaySessionRef.current.subscribeState((state: SessionState) => {
      setUiState((current) => ({
        ...current,
        connectionState: state.status,
        lastEventId: state.lastEventId,
        screen: current.screen === "pair" || current.screen === "repair"
          ? current.screen
          : state.status === "connected"
            ? "connected"
            : "connecting"
      }));
    });
  }, []);

  useEffect(() => {
    return relaySessionRef.current.subscribeMessage((message: RelayServerMessage) => {
      if (message.type === "reply.delta") {
        setUiState((current) => ({
          ...current,
          notice: `Receiving reply for ${message.prompt_id}...`,
          lastEventId: message.event_id
        }));
        return;
      }

      if (message.type === "reply.final") {
        setUiState((current) => ({
          ...current,
          busy: false,
          screen: "connected",
          statusDetail: `Received final reply ${message.request_id}.`,
          lastReply: message.text,
          lastEventId: message.event_id,
          notice: undefined
        }));
        return;
      }

      if (isTokenExpiringMessage(message)) {
        setUiState((current) => ({
          ...current,
          notice: `Access token expires at ${message.expires_at}. The app will refresh it before reconnecting.`
        }));
        return;
      }

      if (isRevokedMessage(message)) {
        setUiState((current) => ({
          ...current,
          busy: false,
          screen: "repair",
          repairMessage: `This device was revoked: ${message.reason}. Re-pair to continue.`,
          lastError: `Revoked: ${message.reason}`
        }));
        return;
      }

      if (message.type === "error") {
        setUiState((current) => ({
          ...current,
          busy: false,
          lastError: message.message,
          notice: message.retryable ? "The relay marked this error retryable." : undefined,
          screen: message.retryable ? current.screen : "repair"
        }));
        return;
      }

      if (message.type === "ready") {
        setUiState((current) => ({
          ...current,
          busy: false,
          screen: "connected",
          statusDetail: `Relay ready on connection ${message.connection_id}.`,
          connectionState: "connected",
          lastError: undefined
        }));
      }
    });
  }, []);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      if (!state.isConnected) {
        setUiState((current) => ({
          ...current,
          notice: "Network offline. Waiting to reconnect."
        }));
        return;
      }

      void controllerRef.current
        .reconnectAfterNetworkRecovery()
        .then((delayMs) => {
          if (delayMs === null) {
            return;
          }

          setUiState((current) => ({
            ...current,
            notice: `Network recovered. Reconnecting in ${delayMs} ms.`,
            screen: current.screen === "pair" ? "pair" : "connecting"
          }));
        })
        .catch((error) => {
          setUiState((current) => ({
            ...current,
            lastError: error instanceof Error ? error.message : "Failed to reconnect after network recovery"
          }));
        });
    });

    return unsubscribe;
  }, []);

  const submitPairing = async () => {
    const validation = validatePairingForm(uiState.form);
    if (!validation.ok) {
      setUiState((current) => ({
        ...current,
        formErrors: validation.errors,
        lastError: "Fix the highlighted pairing fields and try again."
      }));
      return;
    }

    setUiState((current) => ({
      ...current,
      busy: true,
      screen: "connecting",
      statusDetail: "Redeeming the pairing code and registering this mobile device...",
      formErrors: {},
      lastError: undefined
    }));

    try {
      await controllerRef.current.pair({
        relayBaseUrl: validation.value.relayBaseUrl,
        pairingSessionId: validation.value.pairingSessionId,
        pairingCode: validation.value.pairingCode,
        deviceDisplayName: validation.value.deviceDisplayName,
        platform: config.platform,
        appVersion: config.appVersion
      });
      await controllerRef.current.connect();
      setControllerSnapshot(controllerRef.current.getSnapshot());
      setUiState((current) => ({
        ...current,
        busy: false,
        screen: "connected",
        statusDetail: "Paired and connected to OpenClaw.",
        connectionState: relaySessionRef.current.getState().status,
        form: {
          ...current.form,
          pairingCode: ""
        }
      }));
    } catch (error) {
      const repaired = await controllerRef.current.repairFromError(error);
      setControllerSnapshot(repaired);
      setUiState((current) => ({
        ...current,
        busy: false,
        screen: repaired.registration ? "repair" : "pair",
        repairMessage: repaired.repairMessage,
        statusDetail: repaired.registration
          ? "The device paired but needs repair to continue."
          : "Pairing failed. Check the relay URL and short code.",
        lastError: error instanceof Error ? error.message : "Pairing failed"
      }));
    }
  };

  const reconnect = async () => {
    setUiState((current) => ({
      ...current,
      busy: true,
      screen: "connecting",
      statusDetail: "Refreshing the session and reconnecting to the relay...",
      lastError: undefined
    }));

    try {
      await controllerRef.current.connect();
      setControllerSnapshot(controllerRef.current.getSnapshot());
      setUiState((current) => ({
        ...current,
        busy: false,
        screen: "connected",
        statusDetail: "Reconnected to OpenClaw.",
        connectionState: relaySessionRef.current.getState().status
      }));
    } catch (error) {
      const repaired = await controllerRef.current.repairFromError(error);
      setControllerSnapshot(repaired);
      setUiState((current) => ({
        ...current,
        busy: false,
        screen: repaired.registration ? "repair" : "pair",
        repairMessage: repaired.repairMessage,
        lastError: error instanceof Error ? error.message : "Reconnect failed"
      }));
    }
  };

  const refreshSession = async () => {
    setUiState((current) => ({
      ...current,
      busy: true,
      statusDetail: "Refreshing the device session..."
    }));

    try {
      await controllerRef.current.ensureFreshSession();
      setControllerSnapshot(controllerRef.current.getSnapshot());
      setUiState((current) => ({
        ...current,
        busy: false,
        notice: "Session refreshed.",
        statusDetail: current.screen === "connected" ? "Connected and ready to talk to OpenClaw." : current.statusDetail
      }));
    } catch (error) {
      const repaired = await controllerRef.current.repairFromError(error);
      setControllerSnapshot(repaired);
      setUiState((current) => ({
        ...current,
        busy: false,
        screen: repaired.registration ? "repair" : "pair",
        repairMessage: repaired.repairMessage,
        lastError: error instanceof Error ? error.message : "Refresh failed"
      }));
    }
  };

  const sendPrompt = async () => {
    const promptText = uiState.promptDraft.trim();
    if (!promptText) {
      setUiState((current) => ({
        ...current,
        lastError: "Enter a prompt first."
      }));
      return;
    }

    const promptId = createPromptId(++promptCounterRef.current);
    setUiState((current) => ({
      ...current,
      busy: true,
      statusDetail: `Sending ${promptId} to OpenClaw...`,
      lastError: undefined,
      notice: "Waiting for relay response..."
    }));

    try {
      await controllerRef.current.sendPrompt(promptId, promptText);
    } catch (error) {
      const repaired = await controllerRef.current.repairFromError(error);
      setControllerSnapshot(repaired);
      setUiState((current) => ({
        ...current,
        busy: false,
        screen: repaired.registration ? "repair" : "pair",
        repairMessage: repaired.repairMessage,
        lastError: error instanceof Error ? error.message : "Prompt failed"
      }));
    }
  };

  const repair = async () => {
    setUiState((current) => ({
      ...current,
      busy: true,
      statusDetail: "Clearing local credentials..."
    }));

    await controllerRef.current.clearRegistration();
    setControllerSnapshot(controllerRef.current.getSnapshot());
    setUiState((current) => ({
      ...current,
      busy: false,
      screen: "pair",
      repairMessage: undefined,
      lastReply: "",
      lastError: undefined,
      statusDetail: "Stored registration cleared. Pair this device again.",
      connectionState: "idle"
    }));
  };

  return {
    ...uiState,
    registration: controllerSnapshot.registration,
    setField(field: keyof PairingFormInput, value: string) {
      setUiState((current) => ({
        ...current,
        form: {
          ...current.form,
          [field]: value
        },
        formErrors: {
          ...current.formErrors,
          [field]: undefined
        }
      }));
    },
    setPromptDraft(value: string) {
      setUiState((current) => ({
        ...current,
        promptDraft: value
      }));
    },
    submitPairing,
    reconnect,
    refreshSession,
    sendPrompt,
    repair
  };
}

function createPromptId(counter: number): string {
  return `prm_mobile_${Date.now().toString(36)}_${counter.toString(36)}`;
}
