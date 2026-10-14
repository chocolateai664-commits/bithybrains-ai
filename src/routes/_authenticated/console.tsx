import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import {
  deleteKnowledge,
  deleteMemory,
  getBrainOverview,
  getKnowledgeMetrics,
  reindexKnowledge,
  updateMemory,
  uploadKnowledgeFile,
  ingestKnowledge,
  listAuditEvents,
  listDocuments,
  listMemories,
  sendBrainMessage,
} from "@/lib/brains.functions";


export const Route = createFileRoute("/_authenticated/console")({
  head: () => ({
    meta: [
      { title: "Control center · Bithy Brains" },
      { name: "description", content: "Monitor memory, knowledge, tools, permissions and model routing for Bithy." },
      { property: "og:title", content: "Control center · Bithy Brains" },
      { property: "og:description", content: "Monitor Bithy's memory, knowledge, tools and model routing." },
    ],
  }),
  component: Console,
});

function Console() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const overviewFn = useServerFn(getBrainOverview);
  const overview = useQuery({ queryKey: ["brain-overview"], queryFn: () => overviewFn({}) });

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="relative min-h-screen bg-background">
      <div className="grid-backdrop pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="relative mx-auto max-w-6xl px-4 py-8 sm:px-8">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="label-mono">Control center</p>
            <h1 className="text-2xl font-semibold tracking-tight">Bithy Brains</h1>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" asChild>
              <Link to="/containertrack">ContainerTrack</Link>
            </Button>
            <Button variant="outline" size="sm" onClick={signOut}>
              Sign out
            </Button>
          </div>
        </header>

        <Tabs defaultValue="overview" className="mt-8">
          <TabsList className="flex w-full flex-wrap justify-start">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="memory">Memory</TabsTrigger>
            <TabsTrigger value="knowledge">Knowledge</TabsTrigger>
            <TabsTrigger value="registry">Registry</TabsTrigger>
            <TabsTrigger value="audit">Audit</TabsTrigger>
            <TabsTrigger value="playground">Playground</TabsTrigger>
          </TabsList>


          <TabsContent value="overview" className="mt-6 space-y-4">
            {overview.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading telemetry…</p>
            ) : overview.data ? (
              <>
                <div className="grid gap-3 sm:grid-cols-4">
                  {Object.entries(overview.data.health).map(([key, value]) => (
                    <div key={key} className="panel p-4">
                      <p className="label-mono">{key}</p>
                      <p className="mt-1 text-sm font-medium capitalize text-foreground">{value}</p>
                    </div>
                  ))}
                </div>
                <div className="grid gap-3 sm:grid-cols-4">
                  <Stat label="Requests / 7d" value={overview.data.usage.requests} />
                  <Stat label="Avg latency" value={`${overview.data.usage.avgLatencyMs} ms`} />
                  <Stat label="Tokens" value={overview.data.usage.tokens} />
                  <Stat label="Est. cost" value={`$${overview.data.usage.cost}`} />
                  <Stat label="Memories" value={overview.data.knowledge.memories} />
                  <Stat label="Documents" value={overview.data.knowledge.documents} />
                  <Stat label="Embeddings" value={overview.data.knowledge.embeddings} />
                  <Stat label="Conversations" value={overview.data.knowledge.conversations} />
                </div>
              </>
            ) : (
              <p className="text-sm text-destructive">Telemetry unavailable.</p>
            )}
          </TabsContent>

          <TabsContent value="memory" className="mt-6">
            <MemoryPanel />
          </TabsContent>

          <TabsContent value="knowledge" className="mt-6">
            <KnowledgePanel />
          </TabsContent>

          <TabsContent value="registry" className="mt-6 space-y-6">
            <Registry
              title="Applications"
              rows={(overview.data?.applications ?? []).map((a) => ({
                id: a.id,
                primary: a.name,
                secondary: a.slug,
                badge: a.status,
              }))}
            />
            <Registry
              title="Tools"
              rows={(overview.data?.tools ?? []).map((t) => ({
                id: t.id,
                primary: t.name,
                secondary: `${t.runs} runs · ${t.failures} failed · ${t.avgMs} ms avg`,
                badge: t.status,
              }))}
            />
            <Registry
              title="Models"
              rows={(overview.data?.models ?? []).map((m) => ({
                id: m.id,
                primary: m.model_id,
                secondary: `${m.provider} · ${m.cost_tier}`,
                badge: m.status,
              }))}
            />
          </TabsContent>

          <TabsContent value="audit" className="mt-6">
            <AuditPanel />
          </TabsContent>

          <TabsContent value="playground" className="mt-6">
            <Playground />
          </TabsContent>

        </Tabs>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="panel p-4">
      <p className="label-mono">{label}</p>
      <p className="mt-1 font-mono text-xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

function Registry({
  title,
  rows,
}: {
  title: string;
  rows: { id: string; primary: string; secondary: string; badge: string }[];
}) {
  return (
    <section>
      <p className="label-mono">{title}</p>
      <div className="mt-2 space-y-2">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing registered yet.</p>
        ) : (
          rows.map((row) => (
            <div key={row.id} className="panel flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{row.primary}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">{row.secondary}</p>
              </div>
              <Badge variant="secondary">{row.badge}</Badge>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

const RANGES = [
  { id: "1h", label: "Last hour", ms: 3600_000 },
  { id: "24h", label: "Last 24h", ms: 24 * 3600_000 },
  { id: "7d", label: "Last 7 days", ms: 7 * 24 * 3600_000 },
  { id: "all", label: "All time", ms: 0 },
] as const;

function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "";
  const headers = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const cell = (value: unknown) => {
    const text = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => cell(r[h])).join(","))].join("\n");
}

function AuditPanel() {
  const [search, setSearch] = useState("");
  const [requestId, setRequestId] = useState("");
  const [range, setRange] = useState<(typeof RANGES)[number]["id"]>("24h");
  const [query, setQuery] = useState<{ search?: string; requestId?: string; from?: string }>({});
  const eventsFn = useServerFn(listAuditEvents);
  const events = useQuery({
    queryKey: ["audit-events", query],
    queryFn: () => eventsFn({ data: { limit: 200, ...query } }),
  });

  const when = (iso: string) => new Date(iso).toLocaleString();

  const applyFilters = (nextRange = range) => {
    const ms = RANGES.find((r) => r.id === nextRange)?.ms ?? 0;
    const trimmedId = requestId.trim();
    setQuery({
      ...(search.trim() ? { search: search.trim() } : {}),
      ...(trimmedId ? { requestId: trimmedId } : {}),
      ...(ms ? { from: new Date(Date.now() - ms).toISOString() } : {}),
    });
  };

  const exportCsv = () => {
    const data = events.data;
    if (!data) return;
    const rows = [
      ...data.auditLogs.map((r) => ({ kind: "audit", created_at: r.created_at, request_id: r.request_id, name: r.action, detail: r.resource, extra: r.metadata })),
      ...data.toolExecutions.map((r) => ({ kind: "tool", created_at: r.created_at, request_id: r.request_id, name: r.tool_slug, detail: r.success ? "ok" : r.error, extra: { duration_ms: r.duration_ms, application: r.application } })),
      ...data.aiRequests.map((r) => ({ kind: "model", created_at: r.created_at, request_id: r.request_id, name: r.model_id, detail: r.success ? "ok" : r.error, extra: { intent: r.intent, provider: r.provider, tools_used: r.tools_used } })),
    ].sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (rows.length === 0) {
      toast.error("Nothing to export for these filters.");
      return;
    }
    const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `bithy-audit-${new Date().toISOString().slice(0, 19)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search action, tool or model"
          className="max-w-xs"
        />
        <Input
          value={requestId}
          onChange={(e) => setRequestId(e.target.value)}
          placeholder="Correlation / request ID"
          className="max-w-xs font-mono text-xs"
        />
        <div className="flex flex-wrap gap-1">
          {RANGES.map((r) => (
            <Button
              key={r.id}
              size="sm"
              variant={range === r.id ? "default" : "outline"}
              onClick={() => {
                setRange(r.id);
                applyFilters(r.id);
              }}
            >
              {r.label}
            </Button>
          ))}
        </div>
        <Button size="sm" onClick={() => applyFilters()}>
          Filter
        </Button>
        <Button size="sm" variant="ghost" onClick={() => events.refetch()}>
          Refresh
        </Button>
        <Button size="sm" variant="outline" onClick={exportCsv}>
          Export CSV
        </Button>
        {events.data ? (
          <Badge variant="outline">{events.data.scope === "all" ? "admin · all users" : "your activity only"}</Badge>
        ) : null}
      </div>


      <section className="space-y-2">
        <h3 className="label-mono">Audit log</h3>
        {events.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading events…</p>
        ) : (events.data?.auditLogs ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No audit events recorded yet.</p>
        ) : (
          (events.data?.auditLogs ?? []).map((row) => (
            <div key={row.id} className="panel p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-sm text-foreground">{row.action}</span>
                <span className="label-mono">{when(row.created_at)}</span>
              </div>
              <p className="label-mono mt-1 break-all">
                {row.request_id ? `req ${row.request_id} · ` : ""}
                {row.resource ? `${row.resource} · ` : ""}
                {JSON.stringify(row.metadata)}
              </p>
            </div>
          ))
        )}
      </section>

      <section className="space-y-2">
        <h3 className="label-mono">Tool executions</h3>
        {(events.data?.toolExecutions ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No tool executions recorded.</p>
        ) : (
          (events.data?.toolExecutions ?? []).map((row) => (
            <div key={row.id} className="panel flex flex-wrap items-center justify-between gap-2 p-4">
              <span className="font-mono text-sm text-foreground">{row.tool_slug}</span>
              <span className="label-mono">
                {row.success ? "ok" : `failed: ${row.error ?? "unknown"}`} · {row.duration_ms} ms ·{" "}
                {row.request_id ? `req ${row.request_id.slice(0, 8)} · ` : ""}
                {when(row.created_at)}
              </span>
            </div>
          ))
        )}
      </section>

      <section className="space-y-2">
        <h3 className="label-mono">Model requests</h3>
        {(events.data?.aiRequests ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No model requests recorded.</p>
        ) : (
          (events.data?.aiRequests ?? []).map((row) => (
            <div key={row.id} className="panel flex flex-wrap items-center justify-between gap-2 p-4">
              <span className="font-mono text-sm text-foreground">
                {row.model_id} <span className="text-muted-foreground">· {row.intent ?? "unclassified"}</span>
              </span>
              <span className="label-mono">
                {row.success ? "ok" : `failed: ${row.error ?? "unknown"}`}
                {row.tools_used.length ? ` · ${row.tools_used.join(", ")}` : ""} ·{" "}
                {row.request_id ? `req ${row.request_id.slice(0, 8)} · ` : ""}
                {when(row.created_at)}
              </span>
            </div>
          ))
        )}
      </section>
    </div>
  );
}


function MemoryPanel() {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listMemories);
  const removeFn = useServerFn(deleteMemory);
  const updateFn = useServerFn(updateMemory);
  const memories = useQuery({ queryKey: ["memories"], queryFn: () => listFn({}) });
  const [editing, setEditing] = useState<{ id: string; content: string } | null>(null);

  return (
    <div className="space-y-2">
      {(memories.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">No memories stored yet.</p>
      ) : (
        (memories.data ?? []).map((memory) => (
          <div key={memory.id} className="panel flex items-start justify-between gap-3 p-4">
            <div className="min-w-0">
              {editing?.id === memory.id ? (
                <Textarea
                  value={editing.content}
                  rows={2}
                  onChange={(e) => setEditing({ id: memory.id, content: e.target.value })}
                />
              ) : (
                <p className="text-sm text-foreground">{memory.content}</p>
              )}
              <p className="label-mono mt-1">
                {memory.memory_type} · importance {memory.importance} · {memory.source}
              </p>
            </div>
            <div className="flex shrink-0 gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                if (editing?.id !== memory.id) return setEditing({ id: memory.id, content: memory.content });
                try {
                  await updateFn({ data: editing });
                  setEditing(null);
                  queryClient.invalidateQueries({ queryKey: ["memories"] });
                  toast.success("Memory corrected");
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Update failed");
                }
              }}
            >
              {editing?.id === memory.id ? "Save" : "Edit"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                await removeFn({ data: { id: memory.id } });
                queryClient.invalidateQueries({ queryKey: ["memories"] });
                toast.success("Memory forgotten");
              }}
            >
              Forget
            </Button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function KnowledgePanel() {
  const queryClient = useQueryClient();
  const docsFn = useServerFn(listDocuments);
  const ingestFn = useServerFn(ingestKnowledge);
  const uploadFn = useServerFn(uploadKnowledgeFile);
  const reindexFn = useServerFn(reindexKnowledge);
  const deleteFn = useServerFn(deleteKnowledge);
  const metricsFn = useServerFn(getKnowledgeMetrics);
  const documents = useQuery({
    queryKey: ["documents"],
    queryFn: () => docsFn({}),
    refetchInterval: (q) => ((q.state.data ?? []).some((d) => d.status === "processing") ? 3000 : false),
  });
  const metrics = useQuery({ queryKey: ["knowledge-metrics"], queryFn: () => metricsFn({}) });
  const [uploading, setUploading] = useState(false);
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["documents"] });
    queryClient.invalidateQueries({ queryKey: ["knowledge-metrics"] });
  };
  const onFile = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) { toast.error("File exceeds the 10 MB limit"); return; }
    setUploading(true);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      const result = await uploadFn({ data: { filename: file.name, base64: btoa(bin) } });
      toast.success(result.duplicate ? "Already indexed — duplicate skipped" : `Indexed ${result.chunks} chunks`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(false);
      refresh();
    }
  };
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="space-y-6">
      {metrics.data ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ["Retrievals", String(metrics.data.retrievals)],
            ["Evidence hit rate", `${Math.round(metrics.data.hitRate * 100)}%`],
            ["Citation coverage", `${Math.round(metrics.data.citationCoverage * 100)}%`],
            ["Avg retrieval", `${metrics.data.avgLatencyMs} ms`],
            ["Invalid citations removed", String(metrics.data.invalidCitations)],
            ["Failed documents", String(metrics.data.failedDocuments)],
            ["Model errors", String(metrics.data.modelErrors)],
          ].map(([k, v]) => (
            <div key={k} className="panel p-3">
              <p className="label-mono">{k}</p>
              <p className="mt-1 text-lg font-medium">{v}</p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="panel space-y-3 p-4">
        <p className="label-mono">Upload document · PDF, DOCX, TXT, MD, CSV · max 10 MB</p>
        <Input
          type="file"
          accept=".pdf,.docx,.txt,.md,.markdown,.csv"
          disabled={uploading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
            e.target.value = "";
          }}
        />
        {uploading ? <p className="text-sm text-muted-foreground">Extracting, chunking and embedding…</p> : null}
      </div>

      <form
        className="panel space-y-3 p-4"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          try {
            await ingestFn({ data: { title, text } });
            setTitle("");
            setText("");
            queryClient.invalidateQueries({ queryKey: ["documents"] });
            toast.success("Document ingested and embedded");
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Ingestion failed");
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="label-mono">Ingest knowledge</p>
        <Input placeholder="Document title" value={title} onChange={(e) => setTitle(e.target.value)} required />
        <Textarea
          placeholder="Paste text to chunk, embed and index…"
          value={text}
          rows={6}
          onChange={(e) => setText(e.target.value)}
          required
        />
        <Button type="submit" disabled={busy}>
          {busy ? "Embedding…" : "Ingest"}
        </Button>
      </form>

      <div className="space-y-2">
        {(documents.data ?? []).map((doc) => (
          <div key={doc.id} className="panel flex items-center justify-between gap-3 p-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{doc.title}</p>
              <p className="label-mono mt-0.5">
                {doc.file_type ?? "text"} · {doc.chunk_count} chunks
                {doc.page_count ? ` · ${doc.page_count} pages` : ""}
                {doc.source_filename ? ` · ${doc.source_filename}` : ""}
              </p>
              {doc.error ? <p className="mt-1 text-xs text-destructive">{doc.error}</p> : null}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Badge variant={doc.status === "failed" ? "destructive" : "secondary"}>{doc.status}</Badge>
              <Button
                size="sm"
                variant="ghost"
                disabled={doc.status === "processing"}
                onClick={async () => {
                  try {
                    await reindexFn({ data: { id: doc.id } });
                    toast.success("Re-indexed");
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : "Re-index failed");
                  }
                  refresh();
                }}
              >
                {doc.status === "failed" ? "Retry" : "Re-index"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  if (!confirm(`Delete "${doc.title}" and all its chunks?`)) return;
                  await deleteFn({ data: { id: doc.id } });
                  toast.success("Document deleted");
                  refresh();
                }}
              >
                Delete
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Playground() {
  const sendFn = useServerFn(sendBrainMessage);
  const [message, setMessage] = useState("");
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [log, setLog] = useState<
    {
      role: string;
      content: string;
      meta?: string;
      sources?: { label?: string; title: string; page?: number | null; section?: string | null; cited?: boolean }[];
    }[]
  >([]);
  const [busy, setBusy] = useState(false);

  return (
    <div className="space-y-4">
      <div className="panel min-h-48 space-y-3 p-4">
        {log.length === 0 ? (
          <p className="text-sm text-muted-foreground">Send a request through the full brain pipeline.</p>
        ) : (
          log.map((entry, index) => (
            <div key={index}>
              <p className="label-mono">{entry.role}</p>
              <p className="whitespace-pre-wrap text-sm text-foreground">{entry.content}</p>
              {entry.sources && entry.sources.length > 0 ? (
                <ul className="mt-2 space-y-0.5">
                  {entry.sources.map((src) => (
                    <li key={src.label ?? src.title} className="label-mono">
                      [{src.label}] {src.title}
                      {src.page != null ? ` · p. ${src.page}` : ""}
                      {src.section ? ` · ${src.section}` : ""}
                      {src.cited ? " · cited" : " · retrieved, not cited"}
                    </li>
                  ))}
                </ul>
              ) : null}
              {entry.meta ? <p className="label-mono mt-1">{entry.meta}</p> : null}
            </div>
          ))
        )}
      </div>
      <form
        className="flex gap-2"
        onSubmit={async (event) => {
          event.preventDefault();
          const outgoing = message.trim();
          if (!outgoing) return;
          setLog((prev) => [...prev, { role: "you", content: outgoing }]);
          setMessage("");
          setBusy(true);
          try {
            const response = await sendFn({
              data: conversationId ? { message: outgoing, conversationId } : { message: outgoing },
            });
            setConversationId(response.conversationId);
            setLog((prev) => [
              ...prev,
              {
                role: "bithy",
                content: response.message,
                sources: response.sources ?? [],
                meta: `intent: ${response.reasoning?.intent ?? "n/a"} · tools: ${
                  response.reasoning?.toolsUsed.join(", ") || "none"
                }`,
              },
            ]);
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Request failed");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Input placeholder="Ask Bithy…" value={message} onChange={(e) => setMessage(e.target.value)} />
        <Button type="submit" disabled={busy}>
          {busy ? "Thinking…" : "Send"}
        </Button>
      </form>
    </div>
  );
}
