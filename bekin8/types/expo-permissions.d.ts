// SDK 55 type regression: expo-notifications' `NotificationPermissionsStatus` extends
// `PermissionResponse` imported from expo-modules-core, but expo-modules-core 55 no longer ships
// that type — so `status` / `granted` / `canAskAgain` / `expires` fail to resolve (they DO exist at
// runtime; the app builds and runs). Restore the standard permission fields on the interface so our
// notification code type-checks without changes. Remove if a future expo-notifications patch fixes
// the upstream import.
import 'expo-notifications';

declare module 'expo-notifications/build/NotificationPermissions.types' {
  interface NotificationPermissionsStatus {
    status: string;
    granted: boolean;
    canAskAgain: boolean;
    expires: 'never' | number;
  }
}
