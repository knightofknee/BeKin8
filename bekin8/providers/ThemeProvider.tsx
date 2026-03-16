// providers/ThemeProvider.tsx
import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { lightColors, darkColors, type ThemeColors } from "../components/ui/colors";

const STORAGE_KEY = "@bekin_theme";

type ThemeMode = "light" | "dark";

type ThemeCtx = {
  theme: ThemeMode;
  toggleTheme: () => void;
  colors: ThemeColors;
  isDark: boolean;
};

const ThemeContext = createContext<ThemeCtx>({
  theme: "light",
  toggleTheme: () => {},
  colors: lightColors,
  isDark: false,
});

export const ThemeProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [theme, setTheme] = useState<ThemeMode>("light");

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((val) => {
      if (val === "dark") setTheme("dark");
    }).catch(() => {});
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "light" ? "dark" : "light";
      AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
      return next;
    });
  }, []);

  const value = useMemo(() => ({
    theme,
    toggleTheme,
    colors: theme === "dark" ? darkColors : lightColors,
    isDark: theme === "dark",
  }), [theme, toggleTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => useContext(ThemeContext);
