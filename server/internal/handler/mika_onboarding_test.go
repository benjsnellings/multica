package handler

import (
	"strings"
	"testing"

	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

func TestBuildMikaOnboardingKickoffSelectsSkillWithKnownContext(t *testing.T) {
	prompt := buildMikaOnboardingKickoff(
		"Simplified Chinese",
		"Venus",
		questionnaireAnswers{
			Role:    "engineer",
			UseCase: stringOrSlice{"ship_code", "plan_research"},
		},
	)

	for _, want := range []string{
		"product-authored kickoff",
		"multica-onboarding skill",
		"opening stage",
		"Simplified Chinese",
		`Workspace name: "Venus"`,
		`Role: "engineer"`,
		"ship_code",
		"plan_research",
	} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("kickoff missing %q:\n%s", want, prompt)
		}
	}
}

func TestNormalizeMessageKindPreservesOnboardingKickoff(t *testing.T) {
	if got := normalizeMessageKind(protocol.ChatMessageKindOnboardingKickoff); got != protocol.ChatMessageKindOnboardingKickoff {
		t.Fatalf("normalizeMessageKind() = %q, want %q", got, protocol.ChatMessageKindOnboardingKickoff)
	}
}

func TestVisibleChatMessagesHidesOnboardingKickoff(t *testing.T) {
	messages := []db.ChatMessage{
		{
			Content:     "internal kickoff",
			MessageKind: protocol.ChatMessageKindOnboardingKickoff,
		},
		{
			Content:     "Hi, I'm Mika.",
			MessageKind: protocol.ChatMessageKindMessage,
		},
	}

	visible := visibleChatMessages(messages)
	if len(visible) != 1 || visible[0].Content != "Hi, I'm Mika." {
		t.Fatalf("visibleChatMessages() = %#v, want only Mika's visible reply", visible)
	}
}
