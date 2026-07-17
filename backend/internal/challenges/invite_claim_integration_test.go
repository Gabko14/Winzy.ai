//go:build integration

package challenges_test

import (
	"context"
	"errors"
	"sync"
	"testing"
)

func TestClaimInvite_HappyPath_MaterializesAll(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	creator := registerUser(t, stack.authService, "claim-c1@example.com", "claimc1")
	claimer := registerUser(t, stack.authService, "claim-a1@example.com", "claima1")
	creatorAuth := bearerFor(t, stack.tokens, creator.User.ID)
	claimerAuth := bearerFor(t, stack.tokens, claimer.User.ID)

	_, created := doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges/invites", headers: creatorAuth, body: validInviteBody(),
	})
	token := created["token"].(string)

	status, body := doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges/invites/" + token + "/claim", headers: claimerAuth,
	})
	if status != 200 {
		t.Fatalf("claim status=%d body=%v", status, body)
	}
	if body["status"] != "active" {
		t.Fatalf("challenge status=%v", body["status"])
	}
	if body["creatorId"] != creator.User.ID || body["recipientId"] != claimer.User.ID {
		t.Fatalf("parties creator=%v recipient=%v", body["creatorId"], body["recipientId"])
	}
	habitID, _ := body["habitId"].(string)
	if habitID == "" {
		t.Fatal("missing habitId")
	}

	friends, err := stack.socialService.AreFriends(context.Background(), creator.User.ID, claimer.User.ID)
	if err != nil || !friends {
		t.Fatalf("AreFriends=%v err=%v want true", friends, err)
	}

	habits, err := stack.habitsService.ListHabits(context.Background(), claimer.User.ID)
	if err != nil {
		t.Fatalf("ListHabits: %v", err)
	}
	foundHabit := false
	for _, h := range habits {
		if h.ID == habitID && h.Name == "Morning run" {
			foundHabit = true
			break
		}
	}
	if !foundHabit {
		t.Fatalf("claimer habits=%v missing proposed habit", habits)
	}

	status, view := doRequest(t, stack.srv, testRequest{
		method: "GET", path: "/challenges/invites/" + token,
	})
	if status != 200 || view["status"] != "claimed" {
		t.Fatalf("public view status=%d body=%v", status, view)
	}
}

func TestClaimInvite_EdgeCase_DoubleClaimRace(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	creator := registerUser(t, stack.authService, "claim-c2@example.com", "claimc2")
	a := registerUser(t, stack.authService, "claim-a2a@example.com", "claima2a")
	b := registerUser(t, stack.authService, "claim-a2b@example.com", "claima2b")
	creatorAuth := bearerFor(t, stack.tokens, creator.User.ID)

	_, created := doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges/invites", headers: creatorAuth, body: validInviteBody(),
	})
	token := created["token"].(string)

	var (
		wg       sync.WaitGroup
		statuses = make([]int, 2)
		bodies   = make([]map[string]any, 2)
	)
	claimers := []string{a.User.ID, b.User.ID}
	wg.Add(2)
	for i := 0; i < 2; i++ {
		i := i
		go func() {
			defer wg.Done()
			st, body := doRequest(t, stack.srv, testRequest{
				method:  "POST",
				path:    "/challenges/invites/" + token + "/claim",
				headers: bearerFor(t, stack.tokens, claimers[i]),
			})
			statuses[i] = st
			bodies[i] = body
		}()
	}
	wg.Wait()

	var oks, conflicts int
	for i, st := range statuses {
		switch st {
		case 200:
			oks++
		case 409:
			conflicts++
			if bodies[i]["error"] != "This invite was already accepted" &&
				bodies[i]["error"] != "This invite is no longer active" {
				// Second may see claimed after first commits.
				if bodies[i]["error"] == nil {
					t.Fatalf("409 body=%v", bodies[i])
				}
			}
		default:
			t.Fatalf("unexpected status[%d]=%d body=%v", i, st, bodies[i])
		}
	}
	if oks != 1 || conflicts != 1 {
		t.Fatalf("statuses=%v want exactly one 200 and one 409", statuses)
	}
}

func TestClaimInvite_EdgeCase_PendingFriendRequestUpgrade(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	creator := registerUser(t, stack.authService, "claim-c3@example.com", "claimc3")
	claimer := registerUser(t, stack.authService, "claim-a3@example.com", "claima3")
	creatorAuth := bearerFor(t, stack.tokens, creator.User.ID)
	claimerAuth := bearerFor(t, stack.tokens, claimer.User.ID)

	if _, err := stack.socialService.SendFriendRequest(context.Background(), creator.User.ID, claimer.User.ID); err != nil {
		t.Fatalf("SendFriendRequest: %v", err)
	}

	_, created := doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges/invites", headers: creatorAuth, body: validInviteBody(),
	})
	token := created["token"].(string)

	status, body := doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges/invites/" + token + "/claim", headers: claimerAuth,
	})
	if status != 200 {
		t.Fatalf("claim status=%d body=%v", status, body)
	}
	friends, err := stack.socialService.AreFriends(context.Background(), creator.User.ID, claimer.User.ID)
	if err != nil || !friends {
		t.Fatalf("AreFriends=%v err=%v after pending upgrade", friends, err)
	}
}

func TestClaimInvite_EdgeCase_AlreadyFriends(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	creator := registerUser(t, stack.authService, "claim-c4@example.com", "claimc4")
	claimer := registerUser(t, stack.authService, "claim-a4@example.com", "claima4")
	makeFriends(t, stack, creator.User.ID, claimer.User.ID)
	creatorAuth := bearerFor(t, stack.tokens, creator.User.ID)
	claimerAuth := bearerFor(t, stack.tokens, claimer.User.ID)

	_, created := doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges/invites", headers: creatorAuth, body: validInviteBody(),
	})
	token := created["token"].(string)

	status, body := doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges/invites/" + token + "/claim", headers: claimerAuth,
	})
	if status != 200 {
		t.Fatalf("claim status=%d body=%v", status, body)
	}
}

func TestClaimInvite_ErrorCase_SelfClaim400(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	creator := registerUser(t, stack.authService, "claim-c5@example.com", "claimc5")
	auth := bearerFor(t, stack.tokens, creator.User.ID)

	_, created := doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges/invites", headers: auth, body: validInviteBody(),
	})
	token := created["token"].(string)

	status, body := doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges/invites/" + token + "/claim", headers: auth,
	})
	if status != 400 || body["error"] != "You cannot accept your own challenge" {
		t.Fatalf("status=%d body=%v", status, body)
	}
}

func TestClaimInvite_ErrorCase_SelfOnDeadInviteGets409(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	creator := registerUser(t, stack.authService, "claim-c5b@example.com", "claimc5b")
	other := registerUser(t, stack.authService, "claim-a5b@example.com", "claima5b")
	auth := bearerFor(t, stack.tokens, creator.User.ID)
	otherAuth := bearerFor(t, stack.tokens, other.User.ID)

	// Self on claimed → 409 already accepted (not self-claim 400).
	_, created := doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges/invites", headers: auth, body: validInviteBody(),
	})
	claimedToken := created["token"].(string)
	status, _ := doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges/invites/" + claimedToken + "/claim", headers: otherAuth,
	})
	if status != 200 {
		t.Fatalf("other claim status=%d", status)
	}
	status, body := doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges/invites/" + claimedToken + "/claim", headers: auth,
	})
	if status != 409 || body["error"] != "This invite was already accepted" {
		t.Fatalf("self on claimed status=%d body=%v", status, body)
	}

	// Self on revoked → 409 no longer active.
	_, created = doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges/invites", headers: auth, body: validInviteBody(),
	})
	revokedID, revokedToken := created["id"].(string), created["token"].(string)
	doRequest(t, stack.srv, testRequest{
		method: "DELETE", path: "/challenges/invites/" + revokedID, headers: auth,
	})
	status, body = doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges/invites/" + revokedToken + "/claim", headers: auth,
	})
	if status != 409 || body["error"] != "This invite is no longer active" {
		t.Fatalf("self on revoked status=%d body=%v", status, body)
	}

	// Self on expired → 409 no longer active.
	_, created = doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges/invites", headers: auth, body: validInviteBody(),
	})
	expiredToken := created["token"].(string)
	_, err := stack.pool.Exec(context.Background(), `
		UPDATE challenge_invites SET expires_at = now() - interval '1 minute' WHERE token = $1`, expiredToken)
	if err != nil {
		t.Fatalf("expire: %v", err)
	}
	status, body = doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges/invites/" + expiredToken + "/claim", headers: auth,
	})
	if status != 409 || body["error"] != "This invite is no longer active" {
		t.Fatalf("self on expired status=%d body=%v", status, body)
	}
}

func TestClaimInvite_ErrorCase_ExpiredRevokedClaimed409(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	creator := registerUser(t, stack.authService, "claim-c6@example.com", "claimc6")
	claimer := registerUser(t, stack.authService, "claim-a6@example.com", "claima6")
	creatorAuth := bearerFor(t, stack.tokens, creator.User.ID)
	claimerAuth := bearerFor(t, stack.tokens, claimer.User.ID)

	// Expired
	_, created := doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges/invites", headers: creatorAuth, body: validInviteBody(),
	})
	expiredToken := created["token"].(string)
	_, err := stack.pool.Exec(context.Background(), `
		UPDATE challenge_invites SET expires_at = now() - interval '1 minute' WHERE token = $1`, expiredToken)
	if err != nil {
		t.Fatalf("expire: %v", err)
	}
	status, body := doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges/invites/" + expiredToken + "/claim", headers: claimerAuth,
	})
	if status != 409 || body["error"] != "This invite is no longer active" {
		t.Fatalf("expired status=%d body=%v", status, body)
	}

	// Revoked
	_, created = doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges/invites", headers: creatorAuth, body: validInviteBody(),
	})
	revokedID, revokedToken := created["id"].(string), created["token"].(string)
	doRequest(t, stack.srv, testRequest{
		method: "DELETE", path: "/challenges/invites/" + revokedID, headers: creatorAuth,
	})
	status, body = doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges/invites/" + revokedToken + "/claim", headers: claimerAuth,
	})
	if status != 409 || body["error"] != "This invite is no longer active" {
		t.Fatalf("revoked status=%d body=%v", status, body)
	}

	// Already claimed
	_, created = doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges/invites", headers: creatorAuth, body: validInviteBody(),
	})
	claimedToken := created["token"].(string)
	status, _ = doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges/invites/" + claimedToken + "/claim", headers: claimerAuth,
	})
	if status != 200 {
		t.Fatalf("first claim status=%d", status)
	}
	other := registerUser(t, stack.authService, "claim-a6b@example.com", "claima6b")
	status, body = doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges/invites/" + claimedToken + "/claim",
		headers: bearerFor(t, stack.tokens, other.User.ID),
	})
	if status != 409 || body["error"] != "This invite was already accepted" {
		t.Fatalf("second claim status=%d body=%v", status, body)
	}
}

func TestClaimInvite_ErrorCase_Unauthenticated401(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	status, _ := doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges/invites/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/claim",
	})
	if status != 401 {
		t.Fatalf("status=%d want 401", status)
	}
}

func TestClaimInvite_ErrorCase_CreatorDeleted404(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	creator := registerUser(t, stack.authService, "claim-c7@example.com", "claimc7")
	claimer := registerUser(t, stack.authService, "claim-a7@example.com", "claima7")
	creatorAuth := bearerFor(t, stack.tokens, creator.User.ID)
	claimerAuth := bearerFor(t, stack.tokens, claimer.User.ID)

	_, created := doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges/invites", headers: creatorAuth, body: validInviteBody(),
	})
	token := created["token"].(string)

	if err := stack.authService.DeleteAccount(context.Background(), creator.User.ID); err != nil {
		t.Fatalf("DeleteAccount: %v", err)
	}

	status, _ := doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges/invites/" + token + "/claim", headers: claimerAuth,
	})
	if status != 404 {
		t.Fatalf("claim after creator delete status=%d want 404", status)
	}
}

func TestClaimInvite_ErrorCase_RollbackLeavesNothing(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	creator := registerUser(t, stack.authService, "claim-c8@example.com", "claimc8")
	claimer := registerUser(t, stack.authService, "claim-a8@example.com", "claima8")
	creatorAuth := bearerFor(t, stack.tokens, creator.User.ID)

	_, created := doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges/invites", headers: creatorAuth, body: validInviteBody(),
	})
	token := created["token"].(string)

	injected := errors.New("injected claim failure")
	stack.challengesService.SetClaimInterrupt(func() error { return injected })

	_, err := stack.challengesService.ClaimInvite(context.Background(), claimer.User.ID, token)
	if !errors.Is(err, injected) {
		t.Fatalf("ClaimInvite err=%v want injected", err)
	}
	stack.challengesService.SetClaimInterrupt(nil)

	friends, err := stack.socialService.AreFriends(context.Background(), creator.User.ID, claimer.User.ID)
	if err != nil {
		t.Fatalf("AreFriends: %v", err)
	}
	if friends {
		t.Fatal("friendship persisted after rollback")
	}

	habits, err := stack.habitsService.ListHabits(context.Background(), claimer.User.ID)
	if err != nil {
		t.Fatalf("ListHabits: %v", err)
	}
	if len(habits) != 0 {
		t.Fatalf("habits=%v want none after rollback", habits)
	}

	status, view := doRequest(t, stack.srv, testRequest{
		method: "GET", path: "/challenges/invites/" + token,
	})
	if status != 200 || view["status"] != "pending" {
		t.Fatalf("invite status=%d body=%v want pending", status, view)
	}

	var challengeCount int
	err = stack.pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM challenges WHERE creator_id = $1::uuid OR recipient_id = $2::uuid`,
		creator.User.ID, claimer.User.ID).Scan(&challengeCount)
	if err != nil {
		t.Fatalf("count challenges: %v", err)
	}
	if challengeCount != 0 {
		t.Fatalf("challenges=%d want 0 after rollback", challengeCount)
	}
}

func TestClaimInvite_HappyPath_TwoInvitesSamePairBothSucceed(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	creator := registerUser(t, stack.authService, "claim-c9@example.com", "claimc9")
	claimer := registerUser(t, stack.authService, "claim-a9@example.com", "claima9")
	creatorAuth := bearerFor(t, stack.tokens, creator.User.ID)
	claimerAuth := bearerFor(t, stack.tokens, claimer.User.ID)

	_, a := doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges/invites", headers: creatorAuth, body: validInviteBody(),
	})
	_, b := doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges/invites", headers: creatorAuth, body: validInviteBody(),
	})
	tokenA, tokenB := a["token"].(string), b["token"].(string)

	var wg sync.WaitGroup
	statuses := make([]int, 2)
	wg.Add(2)
	go func() {
		defer wg.Done()
		st, _ := doRequest(t, stack.srv, testRequest{
			method: "POST", path: "/challenges/invites/" + tokenA + "/claim", headers: claimerAuth,
		})
		statuses[0] = st
	}()
	go func() {
		defer wg.Done()
		st, _ := doRequest(t, stack.srv, testRequest{
			method: "POST", path: "/challenges/invites/" + tokenB + "/claim", headers: claimerAuth,
		})
		statuses[1] = st
	}()
	wg.Wait()

	if statuses[0] != 200 || statuses[1] != 200 {
		t.Fatalf("statuses=%v want both 200 (two invites, same pair)", statuses)
	}
	friends, err := stack.socialService.AreFriends(context.Background(), creator.User.ID, claimer.User.ID)
	if err != nil || !friends {
		t.Fatalf("AreFriends=%v err=%v", friends, err)
	}
}

func TestClaimInvite_HappyPath_OppositeInvitesNoDeadlock(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	a := registerUser(t, stack.authService, "claim-opp-a@example.com", "claimoppa")
	b := registerUser(t, stack.authService, "claim-opp-b@example.com", "claimoppb")
	aAuth := bearerFor(t, stack.tokens, a.User.ID)
	bAuth := bearerFor(t, stack.tokens, b.User.ID)

	_, invA := doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges/invites", headers: aAuth, body: validInviteBody(),
	})
	_, invB := doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges/invites", headers: bAuth, body: validInviteBody(),
	})
	tokenA, tokenB := invA["token"].(string), invB["token"].(string)

	// A claims B's invite while B claims A's — EnsureFriendship must take
	// row locks in canonical UUID order or Postgres deadlocks (40P01).
	var wg sync.WaitGroup
	statuses := make([]int, 2)
	wg.Add(2)
	go func() {
		defer wg.Done()
		st, _ := doRequest(t, stack.srv, testRequest{
			method: "POST", path: "/challenges/invites/" + tokenB + "/claim", headers: aAuth,
		})
		statuses[0] = st
	}()
	go func() {
		defer wg.Done()
		st, _ := doRequest(t, stack.srv, testRequest{
			method: "POST", path: "/challenges/invites/" + tokenA + "/claim", headers: bAuth,
		})
		statuses[1] = st
	}()
	wg.Wait()

	if statuses[0] != 200 || statuses[1] != 200 {
		t.Fatalf("statuses=%v want both 200 (opposite-direction claims must not deadlock)", statuses)
	}
}

func TestEnsureFriendship_EdgeCase_RepairsAsymmetricAcceptedPending(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	a := registerUser(t, stack.authService, "claim-asym-a@example.com", "claimasyma")
	b := registerUser(t, stack.authService, "claim-asym-b@example.com", "claimasymb")

	// A→B Accepted, B→A Pending (asymmetric / corrupted pair).
	_, err := stack.pool.Exec(context.Background(), `
		INSERT INTO friendships (user_id, friend_id, status) VALUES
			($1::uuid, $2::uuid, 'Accepted'),
			($2::uuid, $1::uuid, 'Pending')`,
		a.User.ID, b.User.ID)
	if err != nil {
		t.Fatalf("seed asymmetric: %v", err)
	}

	if err := stack.socialService.EnsureFriendship(context.Background(), a.User.ID, b.User.ID); err != nil {
		t.Fatalf("EnsureFriendship: %v", err)
	}

	fwd, err := stack.socialService.AreFriends(context.Background(), a.User.ID, b.User.ID)
	if err != nil || !fwd {
		t.Fatalf("forward AreFriends=%v err=%v", fwd, err)
	}
	rev, err := stack.socialService.AreFriends(context.Background(), b.User.ID, a.User.ID)
	if err != nil || !rev {
		t.Fatalf("reverse AreFriends=%v err=%v", rev, err)
	}

	var pending int
	err = stack.pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM friendships
		WHERE ((user_id = $1::uuid AND friend_id = $2::uuid) OR (user_id = $2::uuid AND friend_id = $1::uuid))
			AND status = 'Pending'`,
		a.User.ID, b.User.ID).Scan(&pending)
	if err != nil {
		t.Fatalf("count pending: %v", err)
	}
	if pending != 0 {
		t.Fatalf("pending rows=%d want 0 after upsert repair", pending)
	}
}

func TestRevokeInvite_EdgeCase_ClaimedRowUntouched(t *testing.T) {
	t.Parallel()
	stack := newTestStack(t)
	creator := registerUser(t, stack.authService, "claim-c10@example.com", "claimc10")
	claimer := registerUser(t, stack.authService, "claim-a10@example.com", "claima10")
	creatorAuth := bearerFor(t, stack.tokens, creator.User.ID)
	claimerAuth := bearerFor(t, stack.tokens, claimer.User.ID)

	_, created := doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges/invites", headers: creatorAuth, body: validInviteBody(),
	})
	id, token := created["id"].(string), created["token"].(string)

	status, _ := doRequest(t, stack.srv, testRequest{
		method: "POST", path: "/challenges/invites/" + token + "/claim", headers: claimerAuth,
	})
	if status != 200 {
		t.Fatalf("claim status=%d", status)
	}

	status, _ = doRequest(t, stack.srv, testRequest{
		method: "DELETE", path: "/challenges/invites/" + id, headers: creatorAuth,
	})
	if status != 204 {
		t.Fatalf("revoke claimed status=%d want 204 no-op", status)
	}

	var dbStatus string
	err := stack.pool.QueryRow(context.Background(), `
		SELECT status FROM challenge_invites WHERE id = $1::uuid`, id).Scan(&dbStatus)
	if err != nil {
		t.Fatalf("status query: %v", err)
	}
	if dbStatus != "claimed" {
		t.Fatalf("status=%q want claimed (revoke must not flip claimed→revoked)", dbStatus)
	}
}
