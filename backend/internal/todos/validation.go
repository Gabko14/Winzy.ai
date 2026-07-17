package todos

import (
	"strings"
	"time"
	"unicode/utf8"
)

const maxTitleRunes = 256

type fieldError struct {
	message string
}

func (e *fieldError) Error() string { return e.message }

func newFieldError(message string) error {
	return &fieldError{message: message}
}

func validateTitle(title string) (string, error) {
	trimmed := strings.TrimSpace(title)
	if trimmed == "" {
		return "", newFieldError("Title is required")
	}
	if utf8.RuneCountInString(trimmed) > maxTitleRunes {
		return "", newFieldError("Title must not exceed 256 characters")
	}
	return trimmed, nil
}

func validateDueDate(raw *string) (*time.Time, error) {
	if raw == nil {
		return nil, nil
	}
	t, ok := parseISODate(*raw)
	if !ok {
		return nil, newFieldError("Due date must be a valid date (YYYY-MM-DD)")
	}
	return &t, nil
}
