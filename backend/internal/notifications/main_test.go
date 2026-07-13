//go:build integration

package notifications_test

import (
	"os"
	"testing"

	"github.com/Gabko14/winzy/backend/internal/auth"
)

func TestMain(m *testing.M) {
	auth.SetHashingParamsForTests(1, 1024, 1)
	os.Exit(m.Run())
}
