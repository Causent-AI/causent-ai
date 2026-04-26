@AGENTS.md
# Causent — AI Decision Intelligence Platform

## Project
Causent helps product and business leaders make better decisions through 
AI-powered analysis and structured decision workflows.

## Stack
- Framework: Next.js 14+ (App Router, TypeScript)
- Styling: Tailwind CSS
- Auth + DB: Supabase (PostgreSQL)
- Hosting: Vercel
- AI: Anthropic API (Claude) via LangGraph agents
- Charts: Recharts / Tremor
- Tables: TanStack Table

## Architecture
- /src/app — App Router pages and layouts
- /src/components — Reusable UI components
- /src/lib — Supabase client, utilities, helpers
- /src/agents — LangGraph agent definitions
- /src/types — Shared TypeScript types

## Conventions
- Use Server Components by default; add 'use client' only when needed
- All Supabase queries go through /src/lib/supabase.ts
- Prefer named exports over default exports for components
- Keep components small and composable
- No logic in page files — delegate to components and lib functions

## gstack
Use /browse skill from gstack for all web browsing.
Available skills: /office-hours, /plan-ceo-review, /plan-eng-review, 
/plan-design-review, /design-consultation, /review, /ship, /qa, /cso, 
/retro, /investigate