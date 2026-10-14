<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->
- Knowledge ingestion/retrieval lives in src/lib/brains/knowledge.ts (pure: extraction, chunking, ranking, citation validation) and rag.server.ts (DB/embeddings); chat retrieval uses the hybrid RPC match_document_chunks_hybrid and evidence is cited as [S#] markers validated server-side — why: one pipeline, testable without a database, no fabricated citations.
