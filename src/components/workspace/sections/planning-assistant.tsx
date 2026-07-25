"use client";

import { useMemo, useState, type FormEvent } from "react";
import type { WorkspaceData } from "@/lib/data/types";
import type { WorkspaceActions } from "@/components/workspace/workspace-shell";

type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  suggestedTask?: string;
};

function replyFor(prompt: string, workspace: WorkspaceData) {
  const lower = prompt.toLowerCase();
  const openTasks = (workspace.records.tasks ?? []).filter(
    (task) => task.status !== "done",
  );
  const destination = workspace.plan.destination_label || "your destination";
  if (lower.includes("next") || lower.includes("today")) {
    const next = openTasks[0];
    if (next) {
      return {
        text: `The clearest next action is “${String(next.title)}.” It is already in your roadmap, so I would finish or reschedule that before adding more.`,
      };
    }
    return {
      text: "Your roadmap has no open action. Add one concrete task that can be finished in a single sitting.",
      suggestedTask: "Choose the next concrete move action",
    };
  }
  if (lower.includes("budget") || lower.includes("cost")) {
    const total = (workspace.records.budget ?? []).reduce(
      (sum, item) => sum + Number(item.estimated_cents ?? 0),
      0,
    );
    return {
      text:
        total > 0
          ? `Your user-entered move estimates currently total ${new Intl.NumberFormat(
              "en-US",
              { style: "currency", currency: "USD", maximumFractionDigits: 0 },
            ).format(total / 100)}. Review items without actual costs and keep estimates separate from paid amounts.`
          : "No costs are tracked yet. Start with moving service, deposits, travel, fuel, utility setup, storage, and first-week essentials.",
      suggestedTask: total > 0 ? undefined : "Draft the first move budget",
    };
  }
  if (lower.includes("route") || lower.includes("drive")) {
    return {
      text:
        (workspace.records.routes?.length ?? 0) > 0
          ? "A sourced route snapshot is saved. Recheck official alerts, restrictions, closures, weather, vehicle height, and the rental agreement close to departure."
          : "Start in Route Command with the exact vehicle height, width, length, weight, trailer, fuel range, and departure time. Move Atlas will not call an unverified route safe.",
      suggestedTask:
        (workspace.records.routes?.length ?? 0) > 0
          ? "Reverify route restrictions before departure"
          : "Enter the moving vehicle profile",
    };
  }
  if (lower.includes("area") || lower.includes("where")) {
    return {
      text: `Compare a short list around ${destination}. Official measures should keep their geography and reference year; your personal daily-life rating should stay separate.`,
      suggestedTask:
        (workspace.records.areas?.length ?? 0) > 0
          ? undefined
          : `Shortlist three areas around ${destination}`,
    };
  }
  if (lower.includes("pack") || lower.includes("box")) {
    const boxes = workspace.records.boxes?.length ?? 0;
    return {
      text:
        boxes > 0
          ? `You have ${boxes} boxes tracked. Mark the next room, label first-open boxes, and keep fragile contents easy to identify.`
          : "Start with one room and number every box. Track destination room, contents, fragile status, and first-open priority.",
      suggestedTask: boxes > 0 ? undefined : "Pack and label the first room",
    };
  }
  return {
    text: `I’m the local Planning assistant, so I work only from the move context visible here. I can help prioritize tasks, budget categories, area comparisons, packing, and route preparation—but I will not invent live restrictions, weather, prices, reported crime, or property facts.`,
  };
}

export function PlanningAssistantPanel({
  workspace,
  actions,
}: {
  workspace: WorkspaceData;
  actions: WorkspaceActions;
}) {
  const greeting = useMemo<Message>(
    () => ({
      id: "greeting",
      role: "assistant",
      text: `I’m your Planning assistant for ${workspace.plan.name}. I use saved move context and deterministic rules; no server-side model is currently connected or implied.`,
    }),
    [workspace.plan.name],
  );
  const [messages, setMessages] = useState<Message[]>([greeting]);
  const [input, setInput] = useState("");

  function send(event: FormEvent) {
    event.preventDefault();
    const prompt = input.trim();
    if (!prompt) return;
    const reply = replyFor(prompt, workspace);
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user", text: prompt },
      { id: crypto.randomUUID(), role: "assistant", ...reply },
    ]);
    setInput("");
  }

  async function turnIntoTask(message: Message) {
    if (!message.suggestedTask) return;
    const saved = await actions.addRecord("tasks", {
      title: message.suggestedTask,
      category: "Planning",
      timing_label: "Assistant suggestion",
      due_date: null,
      status: "open",
      source: "assistant",
    });
    if (saved) {
      setMessages((current) =>
        current.map((item) =>
          item.id === message.id ? { ...item, suggestedTask: undefined } : item,
        ),
      );
    }
  }

  return (
    <div className="assistant-layout">
      <section className="assistant-chat panel">
        <div className="assistant-status">
          <span className="brand-mark small">M</span>
          <div>
            <strong>Planning assistant</strong>
            <small>Local rules · move context · no live-fact invention</small>
          </div>
          <span className="status-chip neutral">Not generative AI</span>
        </div>
        <div className="message-list" aria-live="polite">
          {messages.map((message) => (
            <article className={message.role} key={message.id}>
              <span>{message.role === "assistant" ? "Atlas" : "You"}</span>
              <p>{message.text}</p>
              {message.suggestedTask ? (
                <button
                  className="button secondary compact"
                  disabled={actions.busy}
                  onClick={() => turnIntoTask(message)}
                  type="button"
                >
                  + Add “{message.suggestedTask}” to roadmap
                </button>
              ) : null}
            </article>
          ))}
        </div>
        <form className="assistant-input" onSubmit={send}>
          <label>
            <span className="sr-only">Ask the planning assistant</span>
            <textarea
              maxLength={1_000}
              onChange={(event) => setInput(event.target.value)}
              placeholder="What should I do next?"
              rows={2}
              value={input}
            />
          </label>
          <button className="button primary" disabled={!input.trim()}>
            Send
          </button>
        </form>
      </section>
      <aside className="assistant-prompts panel">
        <span className="eyebrow">Useful prompts</span>
        <h3>Ask from the context you have</h3>
        {[
          "What should I do next?",
          "What is missing from my budget?",
          "How should I prepare the route?",
          "Help me compare areas",
          "Where should I start packing?",
        ].map((prompt) => (
          <button
            key={prompt}
            onClick={() => setInput(prompt)}
            type="button"
          >
            {prompt} <span>→</span>
          </button>
        ))}
        <p className="data-note">
          Assistant messages in this browser session are not retained. Saved roadmap
          tasks are persisted to your account.
        </p>
      </aside>
    </div>
  );
}
