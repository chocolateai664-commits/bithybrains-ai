
CREATE EXTENSION IF NOT EXISTS vector;

-- roles
CREATE TYPE public.app_role AS ENUM ('admin','user');

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile" ON public.profiles FOR ALL TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email))
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user') ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- applications registry
CREATE TABLE public.applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  capabilities text[] NOT NULL DEFAULT '{}',
  tools text[] NOT NULL DEFAULT '{}',
  api_endpoint text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.applications TO authenticated;
GRANT ALL ON public.applications TO service_role;
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read applications" ON public.applications FOR SELECT TO authenticated USING (true);
CREATE POLICY "admins manage applications" ON public.applications FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER applications_updated BEFORE UPDATE ON public.applications FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.applications (slug, name, description, capabilities, tools, status) VALUES
('operation-blue','Operation Blue','Connected operations application.', ARRAY['dashboard','tasks','analytics'], ARRAY['getApplicationData','getDashboardStats','createTask'], 'active'),
('optineural','OptiNeural','External AI platform connected to Bithy Brains.', ARRAY['metrics','analysis'], ARRAY['getApplicationData','analyzeData'], 'active');

-- conversations
CREATE TABLE public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text,
  application text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO authenticated;
GRANT ALL ON public.conversations TO service_role;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own conversations" ON public.conversations FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX conversations_user_idx ON public.conversations(user_id, updated_at DESC);
CREATE TRIGGER conversations_updated BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL,
  content text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own messages" ON public.messages FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX messages_conversation_idx ON public.messages(conversation_id, created_at);

CREATE TABLE public.conversation_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  summary text NOT NULL,
  message_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversation_summaries TO authenticated;
GRANT ALL ON public.conversation_summaries TO service_role;
ALTER TABLE public.conversation_summaries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own summaries" ON public.conversation_summaries FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX conversation_summaries_conv_idx ON public.conversation_summaries(conversation_id);

-- memories
CREATE TABLE public.memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content text NOT NULL,
  memory_type text NOT NULL DEFAULT 'user',
  application text,
  project_id text,
  importance real NOT NULL DEFAULT 0.5,
  confidence real NOT NULL DEFAULT 0.5,
  source text NOT NULL DEFAULT 'conversation',
  embedding vector(3072),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.memories TO authenticated;
GRANT ALL ON public.memories TO service_role;
ALTER TABLE public.memories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own memories" ON public.memories FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX memories_user_idx ON public.memories(user_id, created_at DESC);
CREATE INDEX memories_type_idx ON public.memories(user_id, memory_type);
CREATE INDEX memories_embedding_idx ON public.memories USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops);
CREATE TRIGGER memories_updated BEFORE UPDATE ON public.memories FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- documents
CREATE TABLE public.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  file_type text,
  application text,
  status text NOT NULL DEFAULT 'pending',
  chunk_count integer NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.documents TO authenticated;
GRANT ALL ON public.documents TO service_role;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own documents" ON public.documents FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX documents_user_idx ON public.documents(user_id, created_at DESC);
CREATE TRIGGER documents_updated BEFORE UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.document_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  content text NOT NULL,
  application text,
  embedding vector(3072),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_chunks TO authenticated;
GRANT ALL ON public.document_chunks TO service_role;
ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own chunks" ON public.document_chunks FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX document_chunks_doc_idx ON public.document_chunks(document_id, chunk_index);
CREATE INDEX document_chunks_embedding_idx ON public.document_chunks USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops);

-- tools
CREATE TABLE public.tools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  permissions text[] NOT NULL DEFAULT '{}',
  destructive boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.tools TO authenticated;
GRANT ALL ON public.tools TO service_role;
ALTER TABLE public.tools ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read tools" ON public.tools FOR SELECT TO authenticated USING (true);
CREATE POLICY "admins manage tools" ON public.tools FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

INSERT INTO public.tools (slug, name, description, permissions, destructive) VALUES
('searchMemory','Search Memory','Semantic search across the user''s long-term memories.', ARRAY['memory:read'], false),
('searchKnowledge','Search Knowledge','Semantic search across ingested documents.', ARRAY['knowledge:read'], false),
('summarizeDocument','Summarize Document','Summarize an ingested document.', ARRAY['knowledge:read'], false),
('getApplicationData','Get Application Data','Fetch data from a connected application.', ARRAY['application:read'], false),
('getDashboardStats','Get Dashboard Stats','Fetch aggregate stats for a connected application.', ARRAY['application:read'], false),
('analyzeData','Analyze Data','Run analysis over retrieved metrics.', ARRAY['application:read'], false),
('createTask','Create Task','Create a task in a connected application.', ARRAY['application:write'], false),
('updateTask','Update Task','Update a task in a connected application.', ARRAY['application:write'], false),
('sendNotification','Send Notification','Send a notification on the user''s behalf.', ARRAY['notification:write'], true);

CREATE TABLE public.tool_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tool_slug text NOT NULL,
  conversation_id uuid,
  application text,
  success boolean NOT NULL DEFAULT true,
  duration_ms integer NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.tool_executions TO authenticated;
GRANT ALL ON public.tool_executions TO service_role;
ALTER TABLE public.tool_executions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own tool executions" ON public.tool_executions FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "insert own tool executions" ON public.tool_executions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE INDEX tool_executions_idx ON public.tool_executions(created_at DESC);

-- ai models + requests
CREATE TABLE public.ai_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  model_id text NOT NULL UNIQUE,
  label text NOT NULL,
  task_types text[] NOT NULL DEFAULT '{}',
  context_size integer,
  cost_tier text NOT NULL DEFAULT 'standard',
  status text NOT NULL DEFAULT 'active',
  priority integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ai_models TO authenticated;
GRANT ALL ON public.ai_models TO service_role;
ALTER TABLE public.ai_models ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read ai models" ON public.ai_models FOR SELECT TO authenticated USING (true);
CREATE POLICY "admins manage ai models" ON public.ai_models FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

INSERT INTO public.ai_models (provider, model_id, label, task_types, cost_tier, priority) VALUES
('openai','openai/gpt-5.6-sol','GPT-5.6 Sol', ARRAY['reasoning','conversation','data_analysis','technical_help'], 'premium', 10),
('google','google/gemini-3.5-flash','Gemini 3.5 Flash', ARRAY['conversation','classification','summarization'], 'standard', 20),
('google','google/gemini-embedding-2','Gemini Embedding 2', ARRAY['embedding'], 'standard', 30);

CREATE TABLE public.ai_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid,
  model_id text NOT NULL,
  provider text NOT NULL,
  intent text,
  tools_used text[] NOT NULL DEFAULT '{}',
  latency_ms integer NOT NULL DEFAULT 0,
  memory_ms integer NOT NULL DEFAULT 0,
  rag_ms integer NOT NULL DEFAULT 0,
  prompt_tokens integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  estimated_cost numeric NOT NULL DEFAULT 0,
  success boolean NOT NULL DEFAULT true,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.ai_requests TO authenticated;
GRANT ALL ON public.ai_requests TO service_role;
ALTER TABLE public.ai_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own ai requests" ON public.ai_requests FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "insert own ai requests" ON public.ai_requests FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE INDEX ai_requests_created_idx ON public.ai_requests(created_at DESC);

-- personality
CREATE TABLE public.personality_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tone text NOT NULL DEFAULT 'warm-professional',
  style text NOT NULL DEFAULT 'concise',
  response_length text NOT NULL DEFAULT 'medium',
  formality text NOT NULL DEFAULT 'neutral',
  language text NOT NULL DEFAULT 'en',
  assistant_name text NOT NULL DEFAULT 'Bithy',
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.personality_settings TO authenticated;
GRANT ALL ON public.personality_settings TO service_role;
ALTER TABLE public.personality_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own personality" ON public.personality_settings FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER personality_updated BEFORE UPDATE ON public.personality_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- audit log
CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  resource text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read audit" ON public.audit_logs FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE INDEX audit_logs_created_idx ON public.audit_logs(created_at DESC);

-- vector search functions
CREATE OR REPLACE FUNCTION public.match_memories(
  query_embedding vector(3072),
  match_user_id uuid,
  match_count int DEFAULT 5,
  filter_application text DEFAULT NULL,
  filter_type text DEFAULT NULL
) RETURNS TABLE (id uuid, content text, memory_type text, importance real, similarity float)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT m.id, m.content, m.memory_type, m.importance,
         1 - (m.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)) AS similarity
  FROM public.memories m
  WHERE m.user_id = match_user_id
    AND m.embedding IS NOT NULL
    AND (filter_application IS NULL OR m.application = filter_application)
    AND (filter_type IS NULL OR m.memory_type = filter_type)
  ORDER BY m.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)
  LIMIT match_count;
$$;

CREATE OR REPLACE FUNCTION public.match_document_chunks(
  query_embedding vector(3072),
  match_user_id uuid,
  match_count int DEFAULT 5,
  filter_application text DEFAULT NULL
) RETURNS TABLE (id uuid, document_id uuid, title text, content text, similarity float)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT c.id, c.document_id, d.title, c.content,
         1 - (c.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)) AS similarity
  FROM public.document_chunks c
  JOIN public.documents d ON d.id = c.document_id
  WHERE c.user_id = match_user_id
    AND c.embedding IS NOT NULL
    AND (filter_application IS NULL OR c.application = filter_application)
  ORDER BY c.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)
  LIMIT match_count;
$$;
