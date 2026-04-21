export interface BleDeviceMessage {
  type: string;
  payload: string;
}

export interface BleConnectionState {
  connected: boolean;
  deviceId?: string;
}

export interface BleBridge {
  connect(deviceId: string): Promise<void>;
  disconnect(): Promise<void>;
  send(message: BleDeviceMessage): Promise<void>;
  onMessage(listener: (message: BleDeviceMessage) => void): () => void;
  onStateChange(listener: (state: BleConnectionState) => void): () => void;
}

export class NoopBleBridge implements BleBridge {
  async connect(_deviceId: string): Promise<void> {
    return;
  }

  async disconnect(): Promise<void> {
    return;
  }

  async send(_message: BleDeviceMessage): Promise<void> {
    return;
  }

  onMessage(_listener: (message: BleDeviceMessage) => void): () => void {
    return () => undefined;
  }

  onStateChange(_listener: (state: BleConnectionState) => void): () => void {
    return () => undefined;
  }
}
