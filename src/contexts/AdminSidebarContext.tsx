import React, { createContext, useContext, useState } from "react";

interface AdminSidebarContextType {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  toggle: () => void;
}

const AdminSidebarContext = createContext<AdminSidebarContextType>({
  collapsed: false,
  setCollapsed: () => {},
  toggle: () => {},
});

export function useAdminSidebar() {
  return useContext(AdminSidebarContext);
}

export function AdminSidebarProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <AdminSidebarContext.Provider value={{ collapsed, setCollapsed, toggle: () => setCollapsed((c) => !c) }}>
      {children}
    </AdminSidebarContext.Provider>
  );
}
