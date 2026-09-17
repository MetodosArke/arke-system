import { usePushNotifications } from "@/hooks/usePushNotifications";
import { createContext, useContext } from "react";

type PushContextType = ReturnType<typeof usePushNotifications>;

const PushContext = createContext<PushContextType>({
  pushStatus: "idle",
  requestPushPermission: async () => false,
  isSupported: false,
});

export const usePushContext = () => useContext(PushContext);

export function PushNotificationManager({ children }: { children?: React.ReactNode }) {
  const push = usePushNotifications();
  return <PushContext.Provider value={push}>{children}</PushContext.Provider>;
}
