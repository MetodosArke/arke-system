import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function uint8ArraysEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

const IS_SUPPORTED = typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

export function usePushNotifications() {
  const { user, isAuthenticated } = useAuth();
  const [pushStatus, setPushStatus] = useState<"idle" | "granted" | "denied" | "unsupported">("idle");
  const [vapidPublicKey, setVapidPublicKey] = useState<string | null>(null);
  const registeredRef = useRef(false);

  const isSupported = IS_SUPPORTED;

  const syncPermission = useCallback(() => {
    if (!isSupported) return;
    const perm = Notification.permission;
    if (perm === "granted") setPushStatus("granted");
    else if (perm === "denied") setPushStatus("denied");
    else setPushStatus("idle");
  }, [isSupported]);

  const getVapidPublicKey = useCallback(async () => {
    if (vapidPublicKey) return vapidPublicKey;
    const { data, error } = await supabase.functions.invoke("vapid-public-key");
    if (error) throw error;
    if (!data || typeof data.publicKey !== "string") {
      throw new Error("VAPID public key unavailable");
    }
    setVapidPublicKey(data.publicKey);
    return data.publicKey;
  }, [vapidPublicKey]);

  const registerSubscription = useCallback(async (userId: string) => {
    try {
      const publicKey = await getVapidPublicKey();
      const expectedServerKey = urlBase64ToUint8Array(publicKey);
      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      let subscription = await registration.pushManager.getSubscription();

      const currentServerKey = subscription?.options.applicationServerKey
        ? new Uint8Array(subscription.options.applicationServerKey)
        : null;

      if (subscription && (!currentServerKey || !uint8ArraysEqual(currentServerKey, expectedServerKey))) {
        await subscription.unsubscribe();
        subscription = null;
      }

      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: expectedServerKey,
        });
      }

      const subJson = subscription.toJSON();
      if (!subJson.endpoint || !subJson.keys) return;

      await supabase.from("push_subscriptions").upsert(
        {
          user_id: userId,
          endpoint: subJson.endpoint,
          p256dh: subJson.keys.p256dh!,
          auth: subJson.keys.auth!,
        },
        { onConflict: "user_id,endpoint" }
      );
      console.log("Push subscription registered successfully");
    } catch (err) {
      console.error("Push registration failed:", err);
    }
  }, [getVapidPublicKey]);

  // Check permission on mount
  useEffect(() => {
    if (!isSupported) {
      setPushStatus("unsupported");
      return;
    }
    syncPermission();
  }, [isSupported, syncPermission]);

  // Poll permission status every 2s to detect external changes quickly
  useEffect(() => {
    if (!isSupported) return;
    const interval = setInterval(syncPermission, 2000);
    return () => clearInterval(interval);
  }, [isSupported, syncPermission]);

  // Listen to visibility changes to sync immediately when user returns to app
  useEffect(() => {
    if (!isSupported) return;
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        syncPermission();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [isSupported, syncPermission]);

  // If already granted + authenticated, silently register subscription (once)
  useEffect(() => {
    if (!isAuthenticated || !user || pushStatus !== "granted" || !isSupported) return;
    if (registeredRef.current) return;

    const isInIframe = (() => {
      try { return window.self !== window.top; } catch { return true; }
    })();
    const isPreviewHost =
      window.location.hostname.includes("id-preview--") ||
      false;
    if (isPreviewHost || isInIframe) return;

    registeredRef.current = true;
    registerSubscription(user.id);
  }, [isAuthenticated, user, pushStatus, isSupported, registerSubscription]);

  // Called from user gesture (button click) — triggers native browser permission popup
  const requestPushPermission = useCallback(async () => {
    if (!isSupported || !user) return false;
    try {
      const permission = await Notification.requestPermission();
      setPushStatus(permission === "granted" ? "granted" : permission === "denied" ? "denied" : "idle");
      if (permission === "granted") {
        await registerSubscription(user.id);
        return true;
      }
      return false;
    } catch (err) {
      console.error("Permission request failed:", err);
      return false;
    }
  }, [isSupported, registerSubscription, user]);

  return { pushStatus, requestPushPermission, isSupported };
}
