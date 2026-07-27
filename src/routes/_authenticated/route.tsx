import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  // Auth gate temporarily disabled to allow layout review without login.
  // Re-enable by restoring the getUser() check below.
  component: () => <Outlet />,
});