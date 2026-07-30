import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent, ChatSession } from "../types";

const mocks = vi.hoisted(() => ({
  createMikaAgent: vi.fn(),
  createAgent: vi.fn(),
  updateAgent: vi.fn(),
  listChatSessions: vi.fn(),
  createChatSession: vi.fn(),
  startMikaOnboarding: vi.fn(),
}));

vi.mock("../api", () => ({ api: mocks }));

import { bootstrapMika } from "./use-bootstrap-mika";

const agent = {
  id: "agent-1",
  workspace_id: "ws-1",
  runtime_id: "runtime-1",
  name: "Mika",
  description: "Your workspace Chief of Staff.",
  instructions: "",
  system_key: "mika",
  avatar_url: null,
  visibility: "workspace",
  permission_mode: "public_to",
  invocation_targets: [{ target_type: "workspace" }],
  max_concurrent_tasks: 3,
  archived_at: null,
} as Agent;

const session = {
  id: "session-1",
  workspace_id: "ws-1",
  agent_id: "agent-1",
  title: "Getting started with Mika",
  status: "active",
} as ChatSession;

const input = {
  runtimeId: "runtime-1",
  title: "Getting started with Mika",
  language: "en",
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createMikaAgent.mockResolvedValue(agent);
  mocks.startMikaOnboarding.mockResolvedValue({
    started: true,
    task_id: "task-1",
    created_at: "2026-01-01T00:00:00Z",
  });
});

describe("bootstrapMika", () => {
  it("asks the server for Mika, then opens one session and one hidden kickoff", async () => {
    mocks.listChatSessions.mockResolvedValue([]);
    mocks.createChatSession.mockResolvedValue(session);

    const result = await bootstrapMika(input);

    // Only a runtime and a language cross the wire: name, description, avatar,
    // permissions and the system prompt are the server's to decide.
    expect(mocks.createMikaAgent).toHaveBeenCalledOnce();
    expect(mocks.createMikaAgent).toHaveBeenCalledWith({
      runtime_id: "runtime-1",
      language: "en",
    });
    expect(mocks.createChatSession).toHaveBeenCalledWith({
      agent_id: "agent-1",
      title: "Getting started with Mika",
    });
    expect(mocks.startMikaOnboarding).toHaveBeenCalledWith("session-1", {
      language: "en",
    });
    expect(result.agent).toBe(agent);
    expect(result.chatSession).toBe(session);
  });

  it("never builds an agent payload of its own", async () => {
    mocks.listChatSessions.mockResolvedValue([]);
    mocks.createChatSession.mockResolvedValue(session);

    await bootstrapMika(input);

    // The generic create/update endpoints cannot set system_key, so routing
    // Mika through them would produce an agent the claim path ignores.
    expect(mocks.createAgent).not.toHaveBeenCalled();
    expect(mocks.updateAgent).not.toHaveBeenCalled();
  });

  it("reuses the existing session and lets the server no-op the kickoff", async () => {
    mocks.listChatSessions.mockResolvedValue([session]);
    mocks.startMikaOnboarding.mockResolvedValue({ started: false });

    await bootstrapMika(input);

    expect(mocks.createChatSession).not.toHaveBeenCalled();
    expect(mocks.startMikaOnboarding).toHaveBeenCalledOnce();
  });
});
