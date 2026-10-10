// providers/ThemeProvider.tsx
// App theme. The user picks System (follow the phone's light/dark setting, live), Light, or Dark.
// Stored per device. Anyone who chose Light or Dark before System existed keeps that choice; with
// nothing stored, the app follows the system.
import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { lightColors, darkColors, type ThemeColors } from "../components/ui/colors";

const STORAGE_KEY = "@bekin_theme";

type ThemeMode = "light" | "dark";
export type ThemePref = "system" | ThemeMode;

type ThemeCtx = {
  /** What's on screen right now. */
  theme: ThemeMode;
  /** What the user picked (System follows the phone). */
  pref: ThemePref;
  setPref: (p: ThemePref) => void;
  /** Flip to the opposite of what's showing (sets an explicit Light/Dark). */
  toggleTheme: () => void;
  colors: ThemeColors;
  isDark: boolean;
};

const ThemeContext = createContext<ThemeCtx>({
  theme: "light",
  pref: "system",
  setPref: () => {},
  toggleTheme: () => {},
  colors: lightColors,
  isDark: false,
});

export const ThemeProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  // Live system scheme: re-renders when the phone switches light/dark (iOS "automatic"
  // interface style + Android uiMode config change are both set up for this).
  const system = useColorScheme() === "dark" ? "dark" : "light";
  const [pref, setPrefState] = useState<ThemePref>("system");

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((val) => {
        if (val === "dark" || val === "light" || val === "system") setPrefState(val);
      })
      .catch(() => {});
  }, []);

  const setPref = useCallback((p: ThemePref) => {
    setPrefState(p);
    AsyncStorage.setItem(STORAGE_KEY, p).catch(() => {});
  }, []);

  const theme: ThemeMode = pref === "system" ? system : pref;

  const toggleTheme = useCallback(() => {
    setPref(theme === "light" ? "dark" : "light");
  }, [theme, setPref]);

  const value = useMemo(
    () => ({
      theme,
      pref,
      setPref,
      toggleTheme,
      colors: theme === "dark" ? darkColors : lightColors,
      isDark: theme === "dark",
    }),
    [theme, pref, setPref, toggleTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => useContext(ThemeContext);
