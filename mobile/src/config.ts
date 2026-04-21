import Constants from "expo-constants";

interface ExpoExtraConfig {
  defaultRelayBaseUrl?: string;
  defaultDeviceDisplayName?: string;
}

export interface MobileAppConfig {
  appVersion: string;
  platform: "ios" | "android";
  defaultRelayBaseUrl: string;
  defaultDeviceDisplayName: string;
}

export function loadMobileAppConfig(): MobileAppConfig {
  const expoExtra = (Constants.expoConfig?.extra ?? {}) as ExpoExtraConfig;

  return {
    appVersion: Constants.expoConfig?.version ?? "0.1.0",
    platform: Constants.platform?.ios ? "ios" : "android",
    defaultRelayBaseUrl: process.env.EXPO_PUBLIC_DEFAULT_RELAY_BASE_URL?.trim() || expoExtra.defaultRelayBaseUrl || "",
    defaultDeviceDisplayName:
      process.env.EXPO_PUBLIC_DEFAULT_DEVICE_DISPLAY_NAME?.trim() || expoExtra.defaultDeviceDisplayName || "OpenClaw Mobile"
  };
}
