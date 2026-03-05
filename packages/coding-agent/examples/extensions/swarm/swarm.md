# Swarm Extension - Multi-Agent Coordination

A hierarchical multi-agent coordination system for pi.dev that allows multiple agents to work together with shared state, notifications, and concurrent LLM calls.

## Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Human User                                   │
└─────────────────────────────────┬───────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Coordinator Agent                                 │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ • Interacts with user                                        │    │
│  │ • Delegates tasks to workers                                │    │
│  │ • Synthesizes results                                       │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────┬───────────────────────────────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              ▼                   ▼                   ▼
   ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
   │   Worker Agent   │  │   Worker Agent   │  │   Worker Agent   │
   │      (A)        │  │      (B)        │  │      (C)        │
   └──────────────────┘  └──────────────────┘  └──────────────────┘
```

## Architecture

### Components

1. **Coordinator** - Main agent that interacts with the user, delegates tasks
2. **Workers** - Specialized agents that execute subtasks
3. **Events (events.ts)** - In-memory pub/sub for wakeup signals
4. **Shared State (shared-state.ts)** - File-based notifications + scratchpads
5. **Registry (registry.ts)** - Discovers available agents from filesystem

### Communication Flow

```
                    ┌─────────────────┐
                    │   Coordinator   │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
      ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
      │ notify()    │  │ notify()    │  │ notify()    │
      │ + wakeup    │  │ + wakeup    │  │ + wakeup    │
      └──────┬──────┘  └──────┬──────┘  └──────┬──────┘
             │                │                │
             ▼                ▼                ▼
    ┌────────────────┐  ┌────────────────┐  ┌────────────────┐
    │ .pi/team/      │  │ .pi/team/     │  │ .pi/team/     │
    │ notifications/ │  │ notifications/│  │ notifications/│
    │ worker-a.jsonl │  │ worker-b.jsonl│  │ worker-c.jsonl│
    └───────┬────────┘  └───────┬────────┘  └───────┬────────┘
            │                  │                  │
            ▼                  ▼                  ▼
     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
     │ Worker A   │     │ Worker B   │     │ Worker C   │
     │ (LLM call) │     │ (LLM call) │     │ (LLM call) │
     └──────┬──────┘     └──────┬──────┘     └──────┬──────┘
            │                  │                  │
            ▼                  ▼                  ▼
      ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
      │ write       │    │ write       │    │ write       │
      │ scratchpad │    │ scratchpad  │    │ scratchpad  │
      └──────┬──────┘    └──────┬──────┘    └──────┬──────┘
             │                 │                 │
             └─────────────────┼─────────────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │ read_agent_state()  │
                    │ + synthesize result │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │    Response to      │
                    │    Human User       │
                    └─────────────────────┘
```

## Execution Modes

### Single Mode (Default)

```
User ─────► Coordinator (LLM) ─────► Workers (handlers only)
                │                           │
                │  notify()                 │
                └───────────────────────────┘
```

- Coordinator calls LLM
- Workers are passive handlers that respond to notifications
- No parallel LLM calls from workers

### Session-per-Agent Mode

```
User ─────► Coordinator (LLM)
                │
                │  spawn workers
                ▼
        ┌─────────────────────────┐
        │   Workers (async loops) │
        │   ┌─────┐ ┌─────┐       │
        │   │ W1  │ │ W2  │ ...   │
        │   └──┬──┘ └──┬──┘       │
        │      │      │          │
        │      ▼      ▼          │
        │   ┌─────────────┐      │
        │   │ Parallel    │      │
        │   │ LLM calls   │      │
        │   └─────────────┘      │
        └─────────────────────────┘
                │
                │  Results via scratchpad
                ▼
        Coordinator synthesizes
```

- Each worker runs an async loop
- Workers call LLM concurrently when notified
- Better for CPU-bound parallel tasks

## File Structure

```
.pi/
├── agents/                    # Agent definitions
│   ├── researcher/
│   │   ├── agent.json
│   │   └── system.prompt
│   └── coder/
│       ├── agent.json
│       └── system.prompt
│
└── team/                      # Swarm runtime state
    ├── notifications/         # JSONL message queues
    │   ├── coordinator.jsonl
    │   ├── worker-a.jsonl
    │   └── worker-b.jsonl
    │
    └── context/              # Agent scratchpads (markdown)
        ├── coordinator.md
        ├── worker-a.md
        └── worker-b.md
```

## Available Tools

### swarm_start

Spawn worker agents for parallel task execution.

```typescript
{
  agents: ["researcher", "coder"],    // Agent names to spawn
  task: "Build a web app",            // Initial task
  mode: "session-per-agent",          // "single" | "session-per-agent"
  agentScope: "user"                  // "user" | "project" | "both"
}
```

### notify

Send a notification to another agent.

```typescript
{
  target: "worker-a",                 // Agent ID or "all"
  message: "Research authentication libs"
}
```

### read_agent_state

Read another agent's scratchpad and pending notifications.

```typescript
{
  agentId: "worker-a"
}
```

### update_state

Update your own scratchpad.

```typescript
{
  summary: "Delegated research to worker-a"
}
```

### swarm_status

Show status of all active agents.

```typescript
{}
```

## Commands

### /swarm <task>

Start a swarm session with a task.

```
/swarm Build a todo app with React
```

## Usage Example

```typescript
// 1. Start swarm session
/swarm Build a todo app with React

// 2. In the coordinator's turn, spawn workers
// Tool: swarm_start
{
  agents: ["coder", "researcher"],
  task: "Build a todo app with React",
  mode: "session-per-agent"
}

// 3. Delegate to workers
// Tool: notify
{
  target: "researcher",
  message: "Find best React state management libs for 2024"
}

// Tool: notify  
{
  target: "coder",
  message: "Create a React todo app with the libs researcher recommends"
}

// 4. Check worker progress
// Tool: read_agent_state
{ agentId: "researcher" }

// Tool: read_agent_state
{ agentId: "coder" }

// 5. Get overall status
// Tool: swarm_status
{}
```

## Events Flow Detail

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Notification Lifecycle                          │
└─────────────────────────────────────────────────────────────────────┘

1. APPEND                    2. WAKEUP                   3. PROCESS
   Coordinator                   Events                     Worker
   writes to .jsonl         ──►  signals worker       ──►  reads notifications
                                   (in-memory)                from .jsonl

   ┌─────────────────┐          ┌─────────┐           ┌─────────────┐
   │ coordinator.json│          │ emit    │           │ Parse JSONL │
   │ → worker-a:     │   ──►    │ wakeup  │    ──►    │ call LLM()  │
   │   "do task X"   │          │ "w-a"   │           │ → results   │
   └─────────────────┘          └─────────┘           └─────────────┘
                                                                   │
4. WRITE SCRATCHPAD                      5. NOTIFY BACK           │
   Worker writes results                  Worker ──► Coordinator   │
   to context/worker-a.md                 via notification        
                                           │
   ┌─────────────────┐                    ▼
   │ context/        │            ┌─────────────────┐
   │ worker-a.md     │            │ coordinator.json│
   │ "Task X done:   │            │ ← worker-a:     │
   │  results..."    │            │   "Task X done" │
   └─────────────────┘            └─────────────────┘
```

## Testing

Run the test suite:

```bash
cd packages/coding-agent
npx vitest --run test/swarm.test.ts
```

### Test Coverage

- **Phase 1**: I/O and State Unit Tests (JSONL, scratchpad, events)
- **Phase 2**: Concurrency Tests (100 concurrent writes, race conditions)
- **Phase 3**: Mock Agent Integration (notification flow, scratchpad sharing)

## Implementation Details

- **No subprocess spawning** - Uses `@mariozechner/pi-ai` `complete()` directly
- **Hybrid notifications** - File-based (durable) + in-memory events (fast)
- **Async state machines** - Workers use async/await loops, not subprocesses
- **Hierarchical pattern** - Coordinator → Workers with clear responsibilities
