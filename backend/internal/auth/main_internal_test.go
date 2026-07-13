package auth

import (
	"os"
	"testing"
)

func TestMain(m *testing.M) {
	SetHashingParamsForTests(1, 1024, 1)
	os.Exit(m.Run())
}
