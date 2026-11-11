// lib/webAlert.ts
// react-native-web's Alert.alert is a silent NO-OP, so on the web build every confirm in the app
// (light / extinguish a beacon, lock in a time, remove a friend, ...) did nothing at all. This swaps
// in a browser-dialog version once, at startup (index.web.js), so all 100+ call sites just work:
//   0-1 buttons -> window.alert, then that button's onPress
//   2+ buttons  -> window.confirm: OK runs the first non-cancel button, Cancel runs the cancel one
// Native never loads this file.
import { Alert, type AlertButton } from "react-native";

export function installWebAlert() {
  (Alert as any).alert = (title: string, message?: string, buttons?: AlertButton[]) => {
    const text = [title, message].filter(Boolean).join("\n\n");
    const list = buttons ?? [];
    if (list.length <= 1) {
      window.alert(text);
      list[0]?.onPress?.();
      return;
    }
    const cancel = list.find((b) => b.style === "cancel");
    const action = list.find((b) => b !== cancel) ?? list[list.length - 1];
    if (window.confirm(text)) action?.onPress?.();
    else cancel?.onPress?.();
  };
}
