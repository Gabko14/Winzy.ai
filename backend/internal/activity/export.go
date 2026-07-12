package activity

import (
	"context"
	"encoding/json"
	"time"

	"github.com/Gabko14/winzy/backend/internal/export"
)

type feedEntryExport struct {
	ID        string          `json:"id"`
	EventType string          `json:"eventType"`
	Data      json.RawMessage `json:"data"`
	CreatedAt time.Time       `json:"createdAt"`
}

type activityExportData struct {
	FeedEntries []feedEntryExport `json:"feedEntries"`
}

// exportSection matches the old GET /activity/internal/export/{userId}
// response data payload (Program.cs). Soft-deleted rows are omitted —
// C#'s EF global query filter. Empty → export.ErrNoData (old 404).
func (s *Service) exportSection(ctx context.Context, userID string) (any, error) {
	has, err := hasAnyActiveEntry(ctx, s.pool, userID)
	if err != nil {
		return nil, err
	}
	if !has {
		return nil, export.ErrNoData
	}

	entries, err := listEntriesForExport(ctx, s.pool, userID)
	if err != nil {
		return nil, err
	}

	out := make([]feedEntryExport, len(entries))
	for i, e := range entries {
		data := e.Data
		if data == nil {
			data = json.RawMessage("null")
		}
		out[i] = feedEntryExport{
			ID: e.ID, EventType: e.EventType, Data: data, CreatedAt: e.CreatedAt,
		}
	}
	return activityExportData{FeedEntries: out}, nil
}
