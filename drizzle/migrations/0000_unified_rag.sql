ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS content_hash text,
  ADD COLUMN IF NOT EXISTS source_filename text,
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS byte_size integer,
  ADD COLUMN IF NOT EXISTS page_count integer,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS documents_user_hash_uidx ON public.documents(user_id, content_hash) WHERE content_hash IS NOT NULL;

ALTER TABLE public.document_chunks
  ADD COLUMN IF NOT EXISTS page_number integer,
  ADD COLUMN IF NOT EXISTS section text,
  ADD COLUMN IF NOT EXISTS tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(content,''))) STORED;
CREATE INDEX IF NOT EXISTS document_chunks_tsv_idx ON public.document_chunks USING gin(tsv);

ALTER TABLE public.ai_requests
  ADD COLUMN IF NOT EXISTS rag_candidates integer,
  ADD COLUMN IF NOT EXISTS rag_selected integer,
  ADD COLUMN IF NOT EXISTS citations_valid integer,
  ADD COLUMN IF NOT EXISTS citations_invalid integer;

-- Hybrid retrieval. SECURITY INVOKER: RLS applies, and the caller may only
-- search their own rows (match_user_id must equal auth.uid() for client roles).
CREATE OR REPLACE FUNCTION public.match_document_chunks_hybrid(
  query_embedding vector(3072),
  query_text text,
  match_user_id uuid,
  match_count int DEFAULT 8,
  filter_application text DEFAULT NULL
) RETURNS TABLE (id uuid, document_id uuid, title text, content text, page_number int, section text,
                 source_url text, similarity float, keyword_rank float)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH q AS (SELECT websearch_to_tsquery('simple', coalesce(query_text,'')) AS tq),
  vec AS (
    SELECT c.id FROM public.document_chunks c JOIN public.documents d ON d.id = c.document_id
    WHERE c.user_id = match_user_id AND d.user_id = match_user_id AND d.status = 'ready'
      AND (auth.uid() IS NULL OR auth.uid() = match_user_id)
      AND c.embedding IS NOT NULL
      AND (filter_application IS NULL OR c.application IS NULL OR c.application = filter_application)
    ORDER BY c.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)
    LIMIT least(greatest(match_count,1),20) * 2
  ),
  kw AS (
    SELECT c.id FROM public.document_chunks c JOIN public.documents d ON d.id = c.document_id, q
    WHERE c.user_id = match_user_id AND d.user_id = match_user_id AND d.status = 'ready'
      AND (auth.uid() IS NULL OR auth.uid() = match_user_id)
      AND (filter_application IS NULL OR c.application IS NULL OR c.application = filter_application)
      AND c.tsv @@ q.tq
    ORDER BY ts_rank(c.tsv, q.tq) DESC
    LIMIT least(greatest(match_count,1),20)
  )
  SELECT c.id, c.document_id, d.title, c.content, c.page_number, c.section, d.source_url,
         CASE WHEN c.embedding IS NULL THEN 0 ELSE 1 - (c.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)) END,
         ts_rank(c.tsv, q.tq)::float
  FROM public.document_chunks c JOIN public.documents d ON d.id = c.document_id, q
  WHERE c.id IN (SELECT id FROM vec UNION SELECT id FROM kw);
$$;
REVOKE ALL ON FUNCTION public.match_document_chunks_hybrid(vector, text, uuid, int, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.match_document_chunks_hybrid(vector, text, uuid, int, text) TO authenticated, service_role;