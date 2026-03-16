import * as Haptics from 'expo-haptics';

/** Light tap — navigation, dismiss, menu open */
export const tap = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

/** Medium press — submit, confirm, send */
export const press = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

/** Success buzz — positive outcomes (accepted, created) */
export const success = () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

/** Warning buzz — destructive actions (delete, block, report) */
export const warning = () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);

/** Selection tick — toggles, checkboxes, chip picks */
export const selection = () => Haptics.selectionAsync();
