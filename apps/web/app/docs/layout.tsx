import type { ReactNode } from "react";
import { DocsNav, DocsPager } from "../../components/DocsNav";
import { Container } from "../../components/ui";

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <Container className="py-10">
      <div className="grid gap-10 lg:grid-cols-[240px_1fr]">
        <aside className="lg:sticky lg:top-24 lg:h-fit">
          <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-[0.18em] text-sand-600">Docs</p>
          <DocsNav />
        </aside>
        <article className="min-w-0 animate-fade-up">
          {children}
          <DocsPager />
        </article>
      </div>
    </Container>
  );
}
