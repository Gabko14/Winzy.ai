package normalize

import "testing"

func TestMaskCivilDates_StableOrdinals(t *testing.T) {
	a := map[string]any{"localDate": "2026-07-09", "endDate": "2026-08-08"}
	b := map[string]any{"localDate": "2026-07-12", "endDate": "2026-08-11"}
	ma := MaskCivilDates(a).(map[string]any)
	mb := MaskCivilDates(b).(map[string]any)
	// Keys visited in sorted order → endDate before localDate.
	if ma["endDate"] != "{{date:1}}" || mb["endDate"] != "{{date:1}}" {
		t.Fatalf("endDate ordinals: a=%v b=%v", ma["endDate"], mb["endDate"])
	}
	if ma["localDate"] != "{{date:2}}" || mb["localDate"] != "{{date:2}}" {
		t.Fatalf("localDate ordinals: a=%v b=%v", ma["localDate"], mb["localDate"])
	}
	if diffs := Diff("$", ma, mb); len(diffs) != 0 {
		t.Fatalf("expected equal after mask, got %v", diffs)
	}
}

func TestJWTRegex_DoesNotMaskEventTypes(t *testing.T) {
	raw := []byte(`{"eventType":"friend.request.accepted","accessToken":"aaaaaaaaaa.bbbbbbbbbb.cccccccccc"}`)
	got, err := Canonicalize(raw, nil)
	if err != nil {
		t.Fatal(err)
	}
	m := got.(map[string]any)
	if m["eventType"] != "friend.request.accepted" {
		t.Fatalf("eventType over-masked: %v", m["eventType"])
	}
	if m["accessToken"] != "{{token}}" {
		t.Fatalf("real JWT should still mask, got %v", m["accessToken"])
	}
}

func TestStableSortFeedItems_TiedCreatedAt(t *testing.T) {
	golden := map[string]any{
		"items": []any{
			map[string]any{"createdAt": "{{timestamp}}", "eventType": "friend.request.accepted", "actorId": "b", "id": "{{uuid:2}}"},
			map[string]any{"createdAt": "{{timestamp}}", "eventType": "friend.request.accepted", "actorId": "a", "id": "{{uuid:3}}"},
		},
	}
	actual := map[string]any{
		"items": []any{
			map[string]any{"createdAt": "{{timestamp}}", "eventType": "friend.request.accepted", "actorId": "a", "id": "{{uuid:9}}"},
			map[string]any{"createdAt": "{{timestamp}}", "eventType": "friend.request.accepted", "actorId": "b", "id": "{{uuid:8}}"},
		},
	}
	sg := StableSortFeedItems(golden)
	sa := StableSortFeedItems(actual)
	if diffs := Diff("$", sg, sa); len(diffs) != 0 {
		t.Fatalf("expected equal after stable sort + id relabel, got %v", diffs)
	}
	items := sg.(map[string]any)["items"].([]any)
	if items[0].(map[string]any)["actorId"] != "a" {
		t.Fatalf("expected actorId a first after sort, got %#v", items[0])
	}
	if items[0].(map[string]any)["id"] != "{{feed-item:1}}" {
		t.Fatalf("expected positional feed-item id, got %#v", items[0].(map[string]any)["id"])
	}
}
