package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/service"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func createMika(t *testing.T, body any) *httptest.ResponseRecorder {
	t.Helper()
	req := withChatTestWorkspaceCtx(t, newRequest("POST", "/api/agents/mika", body))
	w := httptest.NewRecorder()
	testHandler.CreateMikaAgent(w, req)
	return w
}

func decodeAgent(t *testing.T, w *httptest.ResponseRecorder) AgentResponse {
	t.Helper()
	var resp AgentResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode agent response: %v (body %s)", err, w.Body.String())
	}
	return resp
}

func cleanupMika(t *testing.T) {
	t.Helper()
	t.Cleanup(func() {
		testPool.Exec(context.Background(),
			`DELETE FROM agent WHERE workspace_id = $1 AND system_key = $2`,
			testWorkspaceID, service.MikaSystemKey)
	})
}

// TestCreateMikaAgent_ServerOwnsTheDefinition is the point of moving creation
// server-side: the caller sends only a runtime and a language, and everything
// that makes Mika Mika is decided here.
func TestCreateMikaAgent_ServerOwnsTheDefinition(t *testing.T) {
	cleanupMika(t)

	w := createMika(t, map[string]any{
		"runtime_id": handlerTestRuntimeID(t),
		"language":   "en",
	})
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	resp := decodeAgent(t, w)

	if resp.SystemKey != service.MikaSystemKey {
		t.Fatalf("system_key = %q, want %q", resp.SystemKey, service.MikaSystemKey)
	}
	if resp.Name != mikaAgentName {
		t.Fatalf("name = %q, want %q", resp.Name, mikaAgentName)
	}
	if resp.PermissionMode != mikaAgentPermissionMode {
		t.Fatalf("permission_mode = %q, want %q", resp.PermissionMode, mikaAgentPermissionMode)
	}
	// The workspace half starts empty — the product half is never written to
	// the row, which is what keeps a release from overwriting workspace notes.
	if resp.Instructions != "" {
		t.Fatalf("instructions must start empty, got %q", resp.Instructions)
	}
	if !strings.Contains(resp.SystemInstructions, "You are Mika") {
		t.Fatalf("system_instructions should carry the product prompt, got %q", resp.SystemInstructions)
	}

	// kind stays 'user' so Mika keeps appearing in agent lists and assignment
	// surfaces, and survives runtime teardown.
	var kind string
	if err := testPool.QueryRow(context.Background(),
		`SELECT kind FROM agent WHERE id = $1`, resp.ID).Scan(&kind); err != nil {
		t.Fatalf("load agent kind: %v", err)
	}
	if kind != "user" {
		t.Fatalf("kind = %q, want \"user\" — 'system' hides the row and deletes it with its runtime", kind)
	}
}

func TestCreateMikaAgent_IsIdempotentPerWorkspace(t *testing.T) {
	cleanupMika(t)
	runtimeID := handlerTestRuntimeID(t)

	first := createMika(t, map[string]any{"runtime_id": runtimeID, "language": "en"})
	if first.Code != http.StatusCreated {
		t.Fatalf("first call: expected 201, got %d: %s", first.Code, first.Body.String())
	}
	second := createMika(t, map[string]any{"runtime_id": runtimeID, "language": "zh"})
	if second.Code != http.StatusOK {
		t.Fatalf("second call: expected 200, got %d: %s", second.Code, second.Body.String())
	}
	if a, b := decodeAgent(t, first).ID, decodeAgent(t, second).ID; a != b {
		t.Fatalf("expected the same agent back, got %s then %s", a, b)
	}

	var count int
	if err := testPool.QueryRow(context.Background(),
		`SELECT count(*) FROM agent WHERE workspace_id = $1 AND system_key = $2`,
		testWorkspaceID, service.MikaSystemKey).Scan(&count); err != nil {
		t.Fatalf("count mika agents: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected exactly 1 Mika in the workspace, got %d", count)
	}
}

func TestCreateMikaAgent_RejectsUnsupportedLanguage(t *testing.T) {
	cleanupMika(t)
	w := createMika(t, map[string]any{"runtime_id": handlerTestRuntimeID(t), "language": "fr"})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

// TestComposeMikaInstructions covers the layering contract: the product half
// always leads, workspace notes are labelled with their provenance, and an
// empty second layer adds nothing.
func TestComposeMikaInstructions(t *testing.T) {
	system := service.MikaSystemInstructions()

	if got := service.ComposeMikaInstructions(""); got != system {
		t.Fatal("an empty workspace layer must compose to exactly the system layer")
	}
	if got := service.ComposeMikaInstructions("   \n  "); got != system {
		t.Fatal("a blank workspace layer must compose to exactly the system layer")
	}

	composed := service.ComposeMikaInstructions("Our main repo is acme/platform.")
	if !strings.HasPrefix(composed, system) {
		t.Fatal("the system layer must lead the composed prompt")
	}
	if !strings.Contains(composed, "Added by this workspace's admins") {
		t.Fatal("workspace notes must be labelled with their provenance")
	}
	if !strings.Contains(composed, "Our main repo is acme/platform.") {
		t.Fatal("composed prompt must carry the workspace notes")
	}
}

// TestSystemInstructionsFor_OnlySystemAgents guards the blast radius: an
// ordinary agent's payload must be byte-identical to before this feature.
func TestSystemInstructionsFor_OnlySystemAgents(t *testing.T) {
	mika := db.Agent{SystemKey: pgtype.Text{String: service.MikaSystemKey, Valid: true}}
	if systemInstructionsFor(mika) == "" {
		t.Fatal("Mika should expose the product prompt")
	}
	for _, ordinary := range []db.Agent{
		{},
		{SystemKey: pgtype.Text{String: "", Valid: true}},
		{SystemKey: pgtype.Text{String: "agent_builder:abc", Valid: true}},
	} {
		if got := systemInstructionsFor(ordinary); got != "" {
			t.Fatalf("non-Mika agent must expose no system instructions, got %q", got)
		}
	}
}
