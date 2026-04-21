export type RepairAction = "reconnect" | "refresh_session" | "re_pair";

export interface RepairState {
  message: string;
  recommendedAction: RepairAction;
}

export function deriveRepairState(errorCode: string | undefined): RepairState {
  switch (errorCode) {
    case "device_revoked":
    case "device_inactive":
    case "refresh_reuse_detected":
      return {
        message: "This device must be re-paired before it can reconnect.",
        recommendedAction: "re_pair"
      };
    case "access_invalid":
    case "auth_expired":
      return {
        message: "The session expired and should be refreshed before reconnecting.",
        recommendedAction: "refresh_session"
      };
    default:
      return {
        message: "The connection dropped and should be retried with backoff.",
        recommendedAction: "reconnect"
      };
  }
}
