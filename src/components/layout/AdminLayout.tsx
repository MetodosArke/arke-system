import { Outlet } from "react-router-dom";
import { AdminSidebarDesktop } from "./AdminSidebar";
import { AppHeader } from "./AppHeader";
import { AdminSidebarProvider, useAdminSidebar } from "@/contexts/AdminSidebarContext";
import { cn } from "@/lib/utils";

function AdminLayoutInner() {
  const { collapsed } = useAdminSidebar();

  return (
    <div className="flex min-h-screen bg-background overflow-x-hidden">
      <AdminSidebarDesktop />
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
  );
}

export function AdminLayout() {
  return (
    <AdminSidebarProvider>
      <AdminLayoutInner />
    </AdminSidebarProvider>
  );
}
