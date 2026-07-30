package service

import (
	_ "embed"
	"strings"
)

// MikaSystemKey marks the workspace's built-in Chief of Staff agent. It is the
// agent's identity for every server-side decision — never its display name,
// which owners are free to change.
//
// The row stays kind='user': kind='system' means "invisible execution carrier"
// in this schema (hidden from agent lists and assignment surfaces, and hard
// deleted when its runtime goes away), and Mika needs the opposite of all
// three.
const MikaSystemKey = "mika"

//go:embed builtin_agents/mika/INSTRUCTIONS.md
var mikaSystemInstructions string

// mikaWorkspaceNotesHeading introduces the workspace's own additions inside the
// composed prompt. The notes arrive as free text written by workspace admins,
// so they are labelled with their provenance rather than concatenated bare —
// the model needs to know who wrote them to apply the precedence rule that the
// system instructions state.
const mikaWorkspaceNotesHeading = "Added by this workspace's admins — team context and preferences:"

// MikaSystemInstructions returns the product-owned half of Mika's prompt,
// embedded at compile time.
//
// This is the whole point of the system-agent model: the text ships with the
// server binary rather than being copied into agent.instructions at creation,
// so editing this file and deploying updates every existing workspace on its
// next task. Nothing is written to any agent row, so a workspace's own notes
// can never be overwritten by a release.
func MikaSystemInstructions() string {
	return strings.TrimRight(mikaSystemInstructions, "\n")
}

// ComposeMikaInstructions layers the workspace's notes under the product-owned
// system instructions. workspaceNotes is agent.instructions — the only half a
// workspace can write.
func ComposeMikaInstructions(workspaceNotes string) string {
	system := MikaSystemInstructions()
	notes := strings.TrimSpace(workspaceNotes)
	if notes == "" {
		return system
	}
	return system + "\n\n" + mikaWorkspaceNotesHeading + "\n\n" + notes
}
