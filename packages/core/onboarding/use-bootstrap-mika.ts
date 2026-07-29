import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { chatKeys } from "../chat/queries";
import type {
  Agent,
  ChatPendingTask,
  ChatSession,
  CreateAgentRequest,
} from "../types";
import { workspaceKeys } from "../workspace/queries";

export type MikaOnboardingLanguage = "en" | "zh" | "ko" | "ja";

export interface BootstrapMikaInput {
  agent: CreateAgentRequest;
  onboarding: {
    title: string;
    language: MikaOnboardingLanguage;
  };
}

export interface BootstrapMikaResult {
  agent: Agent;
  chatSession: ChatSession;
}

function mikaUpdateFromRequest(request: CreateAgentRequest) {
  return {
    name: request.name,
    description: request.description,
    instructions: request.instructions,
    avatar_url: request.avatar_url,
    runtime_id: request.runtime_id,
    visibility: request.visibility,
    permission_mode: request.permission_mode,
    invocation_targets: request.invocation_targets,
    max_concurrent_tasks: request.max_concurrent_tasks,
  };
}

function mikaMatchesRequest(
  agent: Agent,
  request: CreateAgentRequest,
): boolean {
  const requiresWorkspaceInvocation =
    request.invocation_targets?.some(
      (target) => target.target_type === "workspace",
    ) ?? false;
  const hasWorkspaceInvocation = (agent.invocation_targets ?? []).some(
    (target) => target.target_type === "workspace",
  );

  return (
    agent.runtime_id === request.runtime_id &&
    agent.description === (request.description ?? "") &&
    agent.instructions === (request.instructions ?? "") &&
    agent.avatar_url === (request.avatar_url ?? null) &&
    agent.visibility === (request.visibility ?? "private") &&
    agent.permission_mode === (request.permission_mode ?? "private") &&
    (!requiresWorkspaceInvocation || hasWorkspaceInvocation) &&
    agent.max_concurrent_tasks === (request.max_concurrent_tasks ?? 6)
  );
}

/**
 * Creates or repairs the one Mika used as the workspace's onboarding entry.
 *
 * Agent names are the only stable identity exposed by the ordinary agent API,
 * so an abandoned prior attempt is reused by exact name and brought back to
 * the current product-managed configuration. The opening session is likewise
 * reused by Mika + localized title. The server owns the final idempotency
 * boundary for the hidden kickoff and will enqueue at most one opening turn.
 */
export async function bootstrapMika(
  workspaceId: string,
  input: BootstrapMikaInput,
): Promise<
  BootstrapMikaResult & {
    kickoff: Awaited<ReturnType<typeof api.startMikaOnboarding>>;
  }
> {
  const existingAgents = await api.listAgents({
    workspace_id: workspaceId,
  });
  const existingMika = existingAgents.find(
    (agent) => !agent.archived_at && agent.name === input.agent.name,
  );

  const agent = existingMika
    ? mikaMatchesRequest(existingMika, input.agent)
      ? existingMika
      : await api.updateAgent(
          existingMika.id,
          mikaUpdateFromRequest(input.agent),
        )
    : await api.createAgent(input.agent);

  const sessions = await api.listChatSessions({ status: "all" });
  const existingSession = sessions.find(
    (session) =>
      session.status === "active" &&
      session.agent_id === agent.id &&
      session.title === input.onboarding.title,
  );
  const chatSession =
    existingSession ??
    (await api.createChatSession({
      agent_id: agent.id,
      title: input.onboarding.title,
    }));

  const kickoff = await api.startMikaOnboarding(chatSession.id, {
    language: input.onboarding.language,
  });

  return { agent, chatSession, kickoff };
}

export function useBootstrapMika(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: BootstrapMikaInput) =>
      bootstrapMika(workspaceId, input),
    onSuccess: ({ chatSession, kickoff }) => {
      if (kickoff.started && kickoff.task_id) {
        queryClient.setQueryData<ChatPendingTask>(
          chatKeys.pendingTask(chatSession.id),
          {
            task_id: kickoff.task_id,
            status: "queued",
            created_at: kickoff.created_at,
          },
        );
      }
      return Promise.all([
        queryClient.invalidateQueries({
          queryKey: workspaceKeys.agents(workspaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: chatKeys.sessions(workspaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: chatKeys.pendingTask(chatSession.id),
        }),
      ]);
    },
  });
}
