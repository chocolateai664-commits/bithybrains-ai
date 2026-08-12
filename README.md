# Cognitive Core

BITHY BRAINS — AI INTELLIGENCE & MEMORY ENGINE



Build Bithy Brains, the backend intelligence platform that powers Bithy, an AI agent that can operate across multiple applications and services.



CRITICAL ARCHITECTURE DISTINCTION



Bithy Brains is not Bithy’s frontend/avatar.



Bithy Brains is the intelligence infrastructure behind Bithy.



- Bithy = user-facing AI agent

- Bithy Brains = memory, reasoning, context, retrieval, tools, orchestration and AI-model infrastructure

- OptiNeural = an external/connected AI platform that Bithy may interact with

- Do NOT make OptiNeural the brain of Bithy.

- Do NOT make Bithy the brain of OptiNeural.



Bithy Brains must remain modular so Bithy can connect to multiple applications in the future.



---



1. CORE OBJECTIVE



Build Bithy Brains as an intelligent middleware/orchestration layer.



Its job is to receive a request from Bithy, understand the user's context, retrieve relevant memory/knowledge, determine which tools or AI models are required, execute the necessary operations, and return a structured response.



Core pipeline:



Bithy

  ↓

Bithy Brains API

  ↓

Request Understanding

  ↓

Context Manager

  ↓

Memory Retrieval

  ↓

Knowledge Retrieval

  ↓

Reasoning / Planning

  ↓

Tool Selection

  ↓

AI Model Router

  ↓

Tool/API Execution

  ↓

Response Generation

  ↓

Memory Update

  ↓

Bithy



---



2. BRAIN API



Create a secure API that Bithy's frontend can consume.



Primary endpoint:



POST /api/bithy/chat



Request:



{

  message: string;

  conversationId?: string;

  userId: string;

  application?: string;

  page?: string;

  context?: Record<string, unknown>;

}



Response:



{

  message: string;

  conversationId: string;

  reasoning?: {

    intent: string;

    toolsUsed: string[];

  };

  sources?: Array<{

    id: string;

    title: string;

    relevance: number;

  }>;

  actions?: Array<{

    type: string;

    payload: Record<string, unknown>;

  }>;

}



Do not expose internal chain-of-thought or private reasoning to the frontend.



The "reasoning" object should contain only safe metadata such as detected intent and tools used.



---



3. MEMORY SYSTEM



Build a long-term memory system using Supabase PostgreSQL + pgvector.



Bithy should be capable of remembering useful information across conversations.



Create memory categories:



User Memory



Examples:



- preferences

- recurring workflows

- communication preferences

- frequently used tools

- relevant project information



Conversation Memory



Store:



- conversation ID

- messages

- timestamps

- summaries

- important decisions



Project Memory



Store information associated with a particular application/project.



Knowledge Memory



Store information retrieved from uploaded documents and connected knowledge sources.



Do not blindly save every conversation.



Implement a memory policy that determines whether information is:



- temporary

- conversational

- useful long-term

- sensitive

- irrelevant



Only appropriate information should become long-term memory.



---



4. VECTOR MEMORY



Use Supabase "pgvector".



Create an embeddings pipeline:



Information

   ↓

Chunking

   ↓

Embedding Generation

   ↓

Vector Storage

   ↓

Similarity Search

   ↓

Relevant Memory



Create a vector search service that can retrieve relevant memories based on the user's current request.



Use metadata filtering such as:



user_id

project_id

application

memory_type

created_at



Never allow one user's private memories to appear in another user's retrieval results.



---



5. RAG KNOWLEDGE SYSTEM



Build a Retrieval-Augmented Generation system.



Bithy Brains should be able to ingest:



- PDF

- DOCX

- TXT

- Markdown

- CSV

- application documentation



Pipeline:



Document

 ↓

Extract Text

 ↓

Clean

 ↓

Chunk

 ↓

Generate Embeddings

 ↓

Store in pgvector

 ↓

Retrieve Relevant Chunks

 ↓

Provide Context to AI Model



Every retrieved source should contain metadata.



Example:



{

  documentId: string;

  title: string;

  chunkId: string;

  content: string;

  similarity: number;

}



Bithy should be able to provide source references when appropriate.



---



6. CONTEXT ENGINE



Create a context manager.



Bithy Brains should understand:



- who the user is

- what they are currently doing

- which application they are using

- which page they are on

- what conversation they are having

- relevant previous interactions

- relevant project knowledge



Example:



{

  user: {...},

  application: "operation-blue",

  page: "/dashboard",

  project: "OptiNeural",

  conversationId: "...",

  currentTask: "...",

  relevantMemories: [...],

  relevantDocuments: [...]

}



Context should be assembled dynamically rather than sending the entire database or conversation history to the AI model.



---



7. APPLICATION-AWARE ARCHITECTURE



Bithy must be able to operate across multiple applications.



Create an application registry.



Example:



interface ConnectedApplication {

  id: string;

  name: string;

  description: string;

  capabilities: string[];

  tools: string[];

  apiEndpoint?: string;

  status: "active" | "inactive";

}



Examples:



Operation Blue

OptiNeural

Future applications



Do not hard-code Bithy specifically to OptiNeural.



The architecture must allow additional applications to be connected later.



---



8. TOOL SYSTEM



Build a secure tool registry.



Each tool should have:



interface BithyTool {

  id: string;

  name: string;

  description: string;

  parameters: Record<string, unknown>;

  permissions: string[];

  execute: Function;

}



Potential tools:



- searchKnowledge

- searchMemory

- summarizeDocument

- getApplicationData

- getDashboardStats

- createTask

- updateTask

- searchWeb

- analyzeData

- sendNotification



Tools should only execute when authorized.



Do not allow the AI model to execute arbitrary code.



---



9. PERMISSION SYSTEM



Implement strict permission control.



Every tool request should be checked against:



User

 ↓

Application

 ↓

Tool

 ↓

Permission

 ↓

Action



Separate:



- read permissions

- write permissions

- administrative permissions



Require explicit confirmation for potentially destructive actions.



Examples:



- deleting data

- sending messages

- modifying account settings

- making external transactions



---



10. AI MODEL ROUTER



Create an AI provider abstraction.



Bithy Brains should support multiple AI providers.



Potential providers:



- Google Gemini

- OpenAI

- Anthropic

- other compatible providers



Architecture:



Bithy Request

      ↓

Model Router

      ↓

Capability Analysis

      ↓

Provider Selection

      ↓

AI Model



The router should eventually consider:



- task type

- model capability

- latency

- cost

- context size

- availability

- reliability



Never expose provider API keys to the frontend.



Store secrets securely in backend environment variables.



---



11. INTENT CLASSIFICATION



Before generating a response, classify the user's request.



Possible intents:



question

conversation

knowledge_search

memory_search

data_analysis

application_action

document_analysis

task_creation

technical_help

general_assistance



The intent classifier should determine whether Bithy needs:



- memory

- RAG

- an application tool

- an external API

- an AI model

- simple conversational response



Avoid unnecessary model calls.



---



12. PLANNING & TOOL ORCHESTRATION



Create a lightweight agent orchestration layer.



Example:



User:

"Show me my recent OptiNeural performance."



Bithy Brains:



1. Identify application = OptiNeural

2. Identify intent = data_analysis

3. Verify user permission

4. Call OptiNeural data tool

5. Retrieve relevant metrics

6. Analyze results

7. Generate response

8. Return structured result to Bithy



Do not expose hidden chain-of-thought.



Store only safe execution metadata:



intent

tools_used

execution_time

success/failure

sources



---



13. CONVERSATION ENGINE



Create conversation management.



Database tables should include:



users

conversations

messages

conversation_summaries

memories

documents

document_chunks

embeddings

applications

tools

tool_executions

ai_models

ai_requests

ai_responses

usage_metrics



Long conversations should be summarized rather than sending unlimited history to the model.



Use:



Recent messages

+

Conversation summary

+

Relevant long-term memories

+

Relevant knowledge



---



14. MEMORY QUALITY CONTROL



Implement memory deduplication.



Before saving a new long-term memory:



1. Search existing memories.

2. Determine whether the information already exists.

3. Update existing memory if necessary.

4. Create a new memory only when appropriate.



Each memory should have:



{

  id: string;

  userId: string;

  content: string;

  type: string;

  importance: number;

  confidence: number;

  source: string;

  createdAt: string;

  updatedAt: string;

}



Allow users to view and delete their stored memories.



---



15. BITHY PERSONALITY LAYER



Keep personality separate from intelligence.



Create a configurable personality layer controlling:



- tone

- communication style

- response length

- formality

- language

- assistant identity



Do not hard-code personality instructions throughout the application.



This allows Bithy's personality to change without modifying the underlying intelligence engine.



---



16. OBSERVABILITY



Create an internal monitoring system.



Track:



- request count

- successful requests

- failed requests

- model latency

- tool latency

- token usage

- estimated cost

- memory retrieval time

- RAG retrieval time

- errors



Create an admin dashboard for monitoring the system.



Never expose sensitive prompts, private memories, or API keys in logs.



---



17. SECURITY



Security is a primary requirement.



Implement:



- Supabase Auth

- Row Level Security

- server-side API calls

- secure environment variables

- input validation

- rate limiting

- permission checks

- audit logging

- secure error handling



Never expose:



SUPABASE_SERVICE_ROLE_KEY

AI_PROVIDER_API_KEYS

DATABASE_PASSWORDS



to the client.



Never trust user-provided "userId" values without authenticating the request.



Use the authenticated Supabase user identity.



---



18. ADMIN DASHBOARD



Create a private admin interface showing:



System Health



- API status

- database status

- vector search status

- AI provider status



Usage



- requests

- tokens

- costs

- active users



Memory



- memory count

- embeddings count

- documents

- retrieval performance



Tools



- available tools

- execution count

- failed executions



AI Models



- provider

- model

- status

- latency

- usage



---



19. API-FIRST DESIGN



Bithy Brains should be usable independently of its frontend.



Create clean service modules:



services/

 ├── ai/

 ├── memory/

 ├── embeddings/

 ├── rag/

 ├── context/

 ├── tools/

 ├── applications/

 ├── conversations/

 ├── permissions/

 └── analytics/



The Bithy frontend should communicate with Bithy Brains through APIs.



This allows:



Bithy Web

Bithy Mobile

Bithy Desktop

Other Applications



to all use the same Bithy Brains infrastructure.



---



20. DATABASE DESIGN



Use Supabase PostgreSQL.



Create appropriate indexes for:



- user IDs

- project IDs

- conversation IDs

- timestamps

- vector embeddings

- application IDs



Use pgvector for semantic memory and knowledge retrieval.



Apply Row Level Security to all user-owned tables.



---



21. PERFORMANCE



Optimize the brain for low latency.



Use:



- streaming responses where supported

- caching for safe/reusable data

- efficient vector search

- database indexes

- conversation summarization

- asynchronous document processing

- background embedding generation



Do not cache private user responses across users.



Cache only data that is safe to cache.



---



22. ERROR HANDLING



If an AI provider fails:



Provider failure

 ↓

Retry if appropriate

 ↓

Fallback model

 ↓

Return graceful response



If a tool fails:



Tool failure

 ↓

Do not fabricate result

 ↓

Explain that the operation could not be completed



Bithy must never invent successful tool execution.



---



23. DEVELOPMENT MODE



During development, mock external AI providers where necessary.



Keep mock implementations separate:



services/mock/



Production services must be replaceable without rewriting the application.



Use clear TypeScript interfaces between:



- AI providers

- memory

- tools

- applications

- database

- frontend



---



24. UI FOR BITHY BRAINS



Bithy Brains is primarily infrastructure, but create a clean developer/admin dashboard.



The dashboard should show:



- Brain status

- AI providers

- memory

- knowledge base

- connected applications

- tools

- conversations

- usage

- logs

- settings



This should feel like an AI infrastructure control center, not a chatbot.



---



25. FINAL ARCHITECTURE



The final architecture should be:



                         ┌───────────────┐

                         │     BITHY     │

                         │   AI Agent    │

                         └───────┬───────┘

                                 │

                                 ▼

                       ┌──────────────────┐

                       │   BITHY BRAINS   │

                       │                  │

                       │ Context Engine   │

                       │ Memory Engine    │

                       │ RAG Engine       │

                       │ Intent Engine    │

                       │ Tool Engine      │

                       │ Model Router     │

                       │ Permission Layer │

                       └────────┬─────────┘

                                │

             ┌──────────────────┼──────────────────┐

             ▼                  ▼                  ▼

       ┌───────────┐      ┌────────────┐     ┌────────────┐

       │ Supabase  │      │ AI Models  │     │ Applications│

       │ pgvector  │      │ Gemini etc.│     │ OptiNeural │

       └───────────┘      └────────────┘     └────────────┘



The most important principle is:



Bithy Brains should be an independent, modular AI infrastructure layer.



Bithy consumes it.



OptiNeural can connect to it.



Other applications can connect to it.



Neither Bithy nor OptiNeural should be hard-coded as the underlying brain itself.



Build the system incrementally, inspect the existing project before making changes, preserve working functionality, and prioritize a clean production-ready architecture over unnecessary visual features.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://bithybrains-ai.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/0410989b-95b8-4d58-8784-b36a58e31032).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
