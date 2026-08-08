import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Bithy Brains — AI Intelligence & Memory Engine" },
      {
        name: "description",
        content:
          "The backend intelligence platform behind Bithy: persistent memory, RAG knowledge, tool execution, permissions and multi-model routing.",
      },
      { property: "og:title", content: "Bithy Brains — AI Intelligence & Memory Engine" },
      {
        property: "og:description",
        content:
          "Persistent memory, RAG knowledge, governed tool execution and multi-model routing for the Bithy agent.",
      },
    ],
  }),
  component: Landing,
});

const LAYERS = [
  { code: "01", name: "Brain API", body: "One authenticated endpoint every Bithy client talks to." },
  { code: "02", name: "Memory Engine", body: "Vector memory with dedupe, decay and importance scoring." },
  { code: "03", name: "Knowledge / RAG", body: "Chunked documents, embeddings and grounded citations." },
  { code: "04", name: "Context Engine", body: "Assembles only what the current request actually needs." },
  { code: "05", name: "Tool System", body: "Registered, validated tools — never arbitrary model code." },
  { code: "06", name: "Permissions", body: "User → application → tool → action, checked every call." },
  { code: "07", name: "Model Router", body: "Intent-aware routing with automatic provider fallback." },
  { code: "08", name: "Personality", body: "Tone and style tuned without touching the reasoning." },
];

function Landing() {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSignedIn(Boolean(data.session)));
    const { data } = supabase.auth.onAuthStateChange((_e, session) => setSignedIn(Boolean(session)));
    return () => data.subscription.unsubscribe();
  }, []);

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <div className="grid-backdrop pointer-events-none absolute inset-0" aria-hidden="true" />
      <div
        className="pointer-events-none absolute -top-40 left-1/2 h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl"
        aria-hidden="true"
      />

      <div className="relative mx-auto max-w-5xl px-5 pb-24 pt-10 sm:px-8">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-signal shadow-[0_0_12px_var(--signal)]" />
            <span className="font-mono text-sm font-semibold tracking-[0.2em] text-foreground">
              BITHY&nbsp;BRAINS
            </span>
          </div>
          <Button asChild size="sm" variant="secondary">
            <Link to={signedIn ? "/console" : "/auth"}>{signedIn ? "Open console" : "Sign in"}</Link>
          </Button>
        </header>

        <section className="mt-20 max-w-3xl">
          <p className="label-mono">Intelligence layer · v1</p>
          <h1 className="mt-4 text-4xl font-semibold leading-[1.05] tracking-tight text-foreground sm:text-6xl">
            The brain behind Bithy.
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Bithy Brains is the backend intelligence engine: it remembers, retrieves, reasons,
            decides which tools to run, enforces permissions and routes to the right model — then
            hands a clean answer back to whichever application asked.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link to={signedIn ? "/console" : "/auth"}>
                {signedIn ? "Open control center" : "Get started"}
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href="#api">View the API</a>
            </Button>
          </div>
        </section>

        <section className="mt-24 grid gap-3 sm:grid-cols-2">
          {LAYERS.map((layer) => (
            <article key={layer.code} className="panel p-5 transition-colors hover:border-primary/50">
              <p className="label-mono">{layer.code}</p>
              <h2 className="mt-2 text-lg font-semibold text-foreground">{layer.name}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{layer.body}</p>
            </article>
          ))}
        </section>

        <section id="api" className="mt-24">
          <p className="label-mono">Contract</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
            One endpoint, any application
          </h2>
          <pre className="panel mt-5 overflow-x-auto p-5 font-mono text-xs leading-relaxed text-muted-foreground">
{`POST /api/public/bithy/chat
Authorization: Bearer <user access token>

{
  "message": "what did we decide about pricing?",
  "conversationId": "optional-uuid",
  "application": "operation-blue",
  "page": "/dashboard"
}

→ { "message", "conversationId", "sources", "actions",
    "reasoning": { "intent", "toolsUsed" } }`}
          </pre>
        </section>

        <footer className="mt-24 border-t border-border pt-6">
          <p className="font-mono text-xs text-muted-foreground">
            Bithy Brains · intelligence, memory and governance for the Bithy agent
          </p>
        </footer>
      </div>
    </div>
  );
}
