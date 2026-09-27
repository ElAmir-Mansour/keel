import { ProjectShell } from "@/components/projects/project-shell";

// Server layout: resolves the route param once and hands it to the client
// shell, which owns the header, tab nav and the not-found state.
export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProjectShell id={id}>{children}</ProjectShell>;
}
