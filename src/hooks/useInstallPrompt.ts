import { useState, useEffect, useCallback } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// Store the deferred prompt globally so it survives component unmounts/remounts
let globalDeferredPrompt: BeforeInstallPromptEvent | null = null;
let globalIsInstalled = false;

// Set up global listener once (runs at module load time)
if (typeof window !== "undefined") {
  if (window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone) {
    globalIsInstalled = true;
  } else {
    window.addEventListener("beforeinstallprompt", (e: Event) => {
      e.preventDefault();
      globalDeferredPrompt = e as BeforeInstallPromptEvent;
    });
    window.addEventListener("appinstalled", () => {
      globalIsInstalled = true;
      globalDeferredPrompt = null;
    });
  }
}

export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(globalDeferredPrompt);
  const [isInstalled, setIsInstalled] = useState(globalIsInstalled);

  useEffect(() => {
    // Sync from global on mount (covers case where event fired before this component mounted)
    if (globalDeferredPrompt && !deferredPrompt) {
      setDeferredPrompt(globalDeferredPrompt);
    }
    if (globalIsInstalled && !isInstalled) {
      setIsInstalled(true);
    }

    const handlePrompt = (e: Event) => {
      e.preventDefault();
      globalDeferredPrompt = e as BeforeInstallPromptEvent;
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleInstalled = () => {
      globalIsInstalled = true;
      globalDeferredPrompt = null;
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handlePrompt);
    window.addEventListener("appinstalled", handleInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handlePrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    const prompt = deferredPrompt || globalDeferredPrompt;
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === "accepted") {
      globalIsInstalled = true;
      setIsInstalled(true);
    }
    globalDeferredPrompt = null;
    setDeferredPrompt(null);
  }, [deferredPrompt]);

  return { canInstall: !!(deferredPrompt || globalDeferredPrompt) && !isInstalled, isInstalled, promptInstall };
}
