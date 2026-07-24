import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/u/$username/share")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/u/$username", params: { username: params.username }, replace: true });
  },
  component: () => null,
});