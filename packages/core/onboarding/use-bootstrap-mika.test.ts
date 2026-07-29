import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent, ChatSession, CreateAgentRequest } from "../types";

const mocks = vi.hoisted(() => ({
  listAgents: vi.fn(),
  createAgent: vi.fn(),
  updateAgent: vi.fn(),
  listChatSessions: vi.fn(),
  createChatSession: vi.fn(),
  startMikaOnboarding: vi.fn(),
}));

vi.mock("../api", () => ({ api: mocks }));

import { bootstrapMika } from "./use-bootstrap-mika";

const request: CreateAgentRequest = {
  name: "Mika",
  description: "Default workspace agent",
  instructions: "Work directly first.",
  runtime_id: "runtime-1",
  visibility: "workspace",
  permission_mode: "public_to",
  invocation_targets: [{ target_type: "workspace" }],
  max_concurrent_tasks: 3,
  template: "mika",
};

const agent = {
  id: "agent-1",
  workspace_id: "ws-1",
  runtime_id: "runtime-1",
  name: "Mika",
  description: "Old starter-team description",
  instructions: "Old starter-team instructions",
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.startMikaOnboarding.mockResolvedValue({
    started: true,
    task_id: "task-1",
    created_at: "2026-01-01T00:00:00Z",
  });
});

describe("bootstrapMika", () => {
  it("creates only Mika, one chat session, and a hidden server kickoff", async () => {
    mocks.listAgents.mockResolvedValue([]);
    mocks.createAgent.mockResolvedValue(agent);
    mocks.listChatSessions.mockResolvedValue([]);
    mocks.createChatSession.mockResolvedValue(session);

    const result = await bootstrapMika("ws-1", {
      agent: request,
      onboarding: {
        title: "Getting started with Mika",
        language: "en",
      },
    });

    expect(mocks.createAgent).toHaveBeenCalledOnce();
    expect(mocks.createAgent).toHaveBeenCalledWith(request);
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

  it("repairs an abandoned Mika setup and reuses its active onboarding chat", async () => {
    mocks.listAgents.mockResolvedValue([agent]);
    mocks.updateAgent.mockResolvedValue(agent);
    mocks.listChatSessions.mockResolvedValue([session]);
    mocks.startMikaOnboarding.mockResolvedValue({ started: false });

    await bootstrapMika("ws-1", {
      agent: request,
      onboarding: {
        title: "Getting started with Mika",
        language: "en",
      },
    });

    expect(mocks.createAgent).not.toHaveBeenCalled();
    expect(mocks.updateAgent).toHaveBeenCalledWith(
      "agent-1",
      expect.objectContaining({
        name: "Mika",
        runtime_id: "runtime-1",
        instructions: "Work directly first.",
      }),
    );
    expect(mocks.createChatSession).not.toHaveBeenCalled();
    expect(mocks.startMikaOnboarding).toHaveBeenCalledOnce();
  });
});
