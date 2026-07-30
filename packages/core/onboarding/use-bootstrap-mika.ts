import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { chatKeys } from "../chat/queries";
import type { Agent, ChatPendingTask, ChatSession } from "../types";
import { workspaceKeys } from "../workspace/queries";

export type MikaOnboardingLanguage = "en" | "zh" | "ko" | "ja";

export interface BootstrapMikaInput {
  runtimeId: string;
  /** Localized title for the opening conversation. */
  title: string;
  language: MikaOnboardingLanguage;
  /** Set when the member has onboarded in another workspace before, so Mika
   *  opens with one line instead of re-explaining the product. */
  returning?: boolean;
}

export interface BootstrapMikaResult {
  agent: Agent;
  chatSession: ChatSession;
}

/**
 * Creates or reuses the workspace's Mika and starts its opening conversation.
 *
 * Every step is idempotent server-side, so a retry, a double-submit, or two
 * clients racing the same workspace converge on one agent, one session, and
 * one opening turn. Nothing about Mika's configuration is decided here — the
 * server owns it, which is why this can no longer drift from the product
 * definition the way a client-built payload could.
 */
export async function bootstrapMika(
  input: BootstrapMikaInput,
): Promise<
  BootstrapMikaResult & {
    kickoff: Awaited<ReturnType<typeof api.startMikaOnboarding>>;
  }
> {
  const agent = await api.createMikaAgent({
    runtime_id: input.runtimeId,
    language: input.language,
  });

  const sessions = await api.listChatSessions({ status: "all" });
  const existingSession = sessions.find(
    (session) =>
      session.status === "active" &&
      session.agent_id === agent.id &&
      session.title === input.title,
  );
  const chatSession =
    existingSession ??
    (await api.createChatSession({
      agent_id: agent.id,
      title: input.title,
    }));

  const kickoff = await api.startMikaOnboarding(chatSession.id, {
    language: input.language,
    returning: input.returning ?? false,
  });

  return { agent, chatSession, kickoff };
}

export function useBootstrapMika(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: BootstrapMikaInput) => bootstrapMika(input),
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
