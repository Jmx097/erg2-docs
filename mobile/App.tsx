import { StatusBar } from "expo-status-bar";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { useMobileCompanionApp } from "./src/app/use-mobile-companion-app";

export default function App() {
  const app = useMobileCompanionApp();

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.keyboardShell}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.hero}>
            <Text style={styles.eyebrow}>ERG2 Mobile</Text>
            <Text style={styles.title}>OpenClaw companion</Text>
            <Text style={styles.subtitle}>{app.statusDetail}</Text>
          </View>

          {app.screen === "pair" ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Pair this device</Text>
              <LabeledField
                label="Relay URL"
                value={app.form.relayBaseUrl}
                onChangeText={(value) => app.setField("relayBaseUrl", value)}
                placeholder="https://api.example.com"
                autoCapitalize="none"
              />
              <LabeledField
                label="Pairing session ID"
                value={app.form.pairingSessionId}
                onChangeText={(value) => app.setField("pairingSessionId", value)}
                placeholder="Optional operator session id"
                autoCapitalize="none"
              />
              <LabeledField
                label="Pairing code"
                value={app.form.pairingCode}
                onChangeText={(value) => app.setField("pairingCode", value)}
                placeholder="ABCD-1234"
                autoCapitalize="characters"
              />
              <LabeledField
                label="Device name"
                value={app.form.deviceDisplayName}
                onChangeText={(value) => app.setField("deviceDisplayName", value)}
                placeholder="Jon's iPhone"
              />
              <Text style={styles.hint}>
                Pair with a short code issued by the operator flow. The app keeps only the long-lived registration in
                secure storage.
              </Text>
              {app.lastError ? <Text style={styles.errorText}>{app.lastError}</Text> : null}
              <PrimaryButton
                label={app.busy ? "Pairing..." : "Pair device"}
                disabled={app.busy}
                onPress={app.submitPairing}
              />
            </View>
          ) : null}

          {app.screen === "connecting" ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Connecting</Text>
              <View style={styles.connectingRow}>
                <ActivityIndicator color="#143042" />
                <Text style={styles.connectingText}>{app.statusDetail}</Text>
              </View>
              <Text style={styles.hint}>The app restores the saved session, refreshes if needed, then opens a relay websocket.</Text>
            </View>
          ) : null}

          {app.screen === "connected" ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Connected</Text>
              <MetricRow label="Connection" value={app.connectionState} />
              <MetricRow label="Device" value={app.registration?.deviceDisplayName || "Unknown"} />
              <MetricRow label="Relay" value={app.registration?.relayBaseUrl || "Unknown"} />
              <MetricRow label="Conversation" value={app.registration?.defaultConversationId || "default"} />
              <MetricRow label="Last event" value={app.lastEventId || "Waiting"} />
              {app.notice ? <Text style={styles.noticeText}>{app.notice}</Text> : null}
              {app.lastError ? <Text style={styles.errorText}>{app.lastError}</Text> : null}
              <LabeledField
                label="Prompt"
                value={app.promptDraft}
                onChangeText={app.setPromptDraft}
                placeholder="Ask OpenClaw something concise"
                multiline
              />
              <View style={styles.buttonRow}>
                <SecondaryButton label="Reconnect" onPress={app.reconnect} disabled={app.busy} />
                <SecondaryButton label="Refresh session" onPress={app.refreshSession} disabled={app.busy} />
              </View>
              <PrimaryButton label={app.busy ? "Sending..." : "Send prompt"} disabled={app.busy} onPress={app.sendPrompt} />
              {app.lastReply ? (
                <View style={styles.replyBox}>
                  <Text style={styles.replyLabel}>Latest reply</Text>
                  <Text style={styles.replyText}>{app.lastReply}</Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {app.screen === "repair" ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Repair required</Text>
              <Text style={styles.repairText}>{app.repairMessage || "This device needs attention before it can reconnect."}</Text>
              {app.lastError ? <Text style={styles.errorText}>{app.lastError}</Text> : null}
              <View style={styles.buttonRow}>
                <SecondaryButton label="Reconnect" onPress={app.reconnect} disabled={app.busy} />
                <SecondaryButton label="Refresh session" onPress={app.refreshSession} disabled={app.busy} />
              </View>
              <PrimaryButton label="Re-pair device" onPress={app.repair} disabled={app.busy} />
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function LabeledField(props: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  multiline?: boolean;
}) {
  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.fieldLabel}>{props.label}</Text>
      <TextInput
        style={[styles.input, props.multiline ? styles.inputMultiline : null]}
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor="#6d7f89"
        autoCapitalize={props.autoCapitalize}
        multiline={props.multiline}
      />
    </View>
  );
}

function MetricRow(props: { label: string; value: string }) {
  return (
    <View style={styles.metricRow}>
      <Text style={styles.metricLabel}>{props.label}</Text>
      <Text style={styles.metricValue}>{props.value}</Text>
    </View>
  );
}

function PrimaryButton(props: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={props.onPress} disabled={props.disabled} style={[styles.primaryButton, props.disabled ? styles.buttonDisabled : null]}>
      <Text style={styles.primaryButtonText}>{props.label}</Text>
    </Pressable>
  );
}

function SecondaryButton(props: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={props.onPress} disabled={props.disabled} style={[styles.secondaryButton, props.disabled ? styles.buttonDisabled : null]}>
      <Text style={styles.secondaryButtonText}>{props.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#eef2ea"
  },
  keyboardShell: {
    flex: 1
  },
  scrollContent: {
    padding: 20,
    gap: 18
  },
  hero: {
    paddingTop: 8,
    gap: 6
  },
  eyebrow: {
    color: "#315449",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1.2
  },
  title: {
    color: "#102632",
    fontSize: 30,
    fontWeight: "800"
  },
  subtitle: {
    color: "#365060",
    fontSize: 15,
    lineHeight: 22
  },
  card: {
    backgroundColor: "#f9fbf7",
    borderRadius: 24,
    padding: 18,
    gap: 14,
    borderWidth: 1,
    borderColor: "#d5ddd5"
  },
  cardTitle: {
    color: "#102632",
    fontSize: 20,
    fontWeight: "800"
  },
  fieldBlock: {
    gap: 8
  },
  fieldLabel: {
    color: "#315449",
    fontSize: 13,
    fontWeight: "700"
  },
  input: {
    minHeight: 52,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#c5d0cd",
    color: "#102632",
    fontSize: 15
  },
  inputMultiline: {
    minHeight: 110,
    textAlignVertical: "top"
  },
  hint: {
    color: "#53707c",
    fontSize: 13,
    lineHeight: 19
  },
  errorText: {
    color: "#b2292e",
    fontSize: 14,
    lineHeight: 20
  },
  noticeText: {
    color: "#245a6d",
    fontSize: 14,
    lineHeight: 20
  },
  repairText: {
    color: "#2e4652",
    fontSize: 15,
    lineHeight: 22
  },
  connectingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12
  },
  connectingText: {
    color: "#143042",
    fontSize: 15
  },
  metricRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 16
  },
  metricLabel: {
    color: "#53707c",
    fontSize: 13,
    fontWeight: "700"
  },
  metricValue: {
    flex: 1,
    textAlign: "right",
    color: "#102632",
    fontSize: 13
  },
  buttonRow: {
    flexDirection: "row",
    gap: 10
  },
  primaryButton: {
    minHeight: 52,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#16495d"
  },
  primaryButtonText: {
    color: "#f5fbff",
    fontSize: 15,
    fontWeight: "800"
  },
  secondaryButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#dbe7e5"
  },
  secondaryButtonText: {
    color: "#18313e",
    fontSize: 14,
    fontWeight: "700"
  },
  buttonDisabled: {
    opacity: 0.55
  },
  replyBox: {
    gap: 8,
    padding: 14,
    borderRadius: 18,
    backgroundColor: "#e4ece8"
  },
  replyLabel: {
    color: "#315449",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.9
  },
  replyText: {
    color: "#102632",
    fontSize: 15,
    lineHeight: 22
  }
});
