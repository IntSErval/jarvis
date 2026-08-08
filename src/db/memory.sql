-- Supabase memories table + match function for Jarvis's semantic memory
-- substrate (PRD 5.3). Run this once in the Supabase SQL editor before using
-- the pgvector memory store. Requires the pgvector extension.
--
-- The 1536 dimension must match the embedder/provider in use (e.g. OpenAI
-- text-embedding-3-small). Change it in both the column and the function
-- signature below if you swap embedders.

create extension if not exists vector;

create table if not exists public.memories (
  id         bigint generated always as identity primary key,
  content    text        not null,
  embedding  vector(1536) not null,
  metadata   jsonb       not null default '{}',
  created_at timestamptz not null default now()
);

-- ivfflat index for approximate nearest-neighbor cosine search. Needs rows
-- present to train well; fine to create up front for a small table.
create index if not exists memories_embedding_idx
  on public.memories using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- RPC used by pgvectorMemory.recall(). Returns top match_count memories by
-- cosine similarity (1 - cosine distance), most similar first.
create or replace function public.match_memories(
  query_embedding vector(1536),
  match_count int
)
returns table (content text, metadata jsonb, similarity float)
language sql stable
as $$
  select
    content,
    metadata,
    1 - (embedding <=> query_embedding) as similarity
  from public.memories
  order by embedding <=> query_embedding
  limit match_count;
$$;

-- The worker uses the service_role key (bypasses RLS), matching audit_log.
-- RLS stays enabled so the anon/public key can't read memories directly.
alter table public.memories enable row level security;
