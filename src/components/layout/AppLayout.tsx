import { useState, createContext, useContext, useCallback } from "react";
import { Outlet } from "react-router-dom";
import { AppSidebarDesktop } from "./AppSidebar";
import { AppHeader } from "./AppHeader";
import { cn } from "@/lib/utils";

interface AppSidebarContextType {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
}

const AppSidebarContext = createContext<AppSidebarContextType>({ collapsed: false, setCollapsed: () => {} });
export function useAppSidebar() {
  return useContext(AppSidebarContext);
}

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <AppSidebarContext.Provider value={{ collapsed, setCollapsed }}>
      <div className="flex min-h-screen bg-background overflow-x-hidden">
        <AppSidebarDesktop />
        <div
          className={cn(
            "flex flex-1 flex-col min-w-0 transition-all duration-300",
            collapsed ? "md:ml-16" : "md:ml-64"
          )}
        >
          <AppHeader />
          <main className="flex-1 p-3 sm:p-4 md:p-6 min-w-0 overflow-x-hidden">
            <Outlet />
          </main>
        </div>
      </div>
    </AppSidebarContext.Provider>
  );
}
