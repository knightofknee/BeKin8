// providers/NetworkProvider.tsx
import React, { createContext, useContext } from "react";
import { useNetworkState } from "expo-network";

type NetworkCtx = {
  online: boolean;
};

const NetworkContext = createContext<NetworkCtx>({ online: true });

export const NetworkProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const state = useNetworkState();

  // Treat as offline only when we have an explicit negative signal.
  // Undefined values (briefly true on first render or on web) are treated as online
  // to avoid a false "offline" flash at app start.
  const online =
    state?.isInternetReachable === false || state?.isConnected === false ? false : true;

  return (
    <NetworkContext.Provider value={{ online }}>{children}</NetworkContext.Provider>
  );
};

export const useOnline = () => useContext(NetworkContext).online;
