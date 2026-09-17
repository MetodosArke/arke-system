import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { WifiOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function NetworkStatusBanner() {
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine
  );
  const [retrying, setRetrying] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      void queryClient.refetchQueries({ type: "active" });
    };
    const goOffline = () => setOnline(false);

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [queryClient]);

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await queryClient.refetchQueries({ type: "active" });
      setOnline(navigator.onLine);
    } finally {
      setRetrying(false);
    }
  };

  if (online) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-3 bg-destructive px-4 py-2 text-sm text-destructive-foreground shadow-lg">
      <WifiOff className="h-4 w-4 shrink-0" />
      <span>Sem conexão. Verifique sua internet.</span>
      <Button
        size="sm"
        variant="secondary"
        className="h-7 px-2"
        onClick={handleRetry}
        disabled={retrying}
      >
        <RefreshCw className={`mr-1 h-3 w-3 ${retrying ? "animate-spin" : ""}`} />
        Tentar novamente
      </Button>
    </div>
  );
}
