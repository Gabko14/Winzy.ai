//go:build integration

package dbtest

import (
	"fmt"
	"os"
	"testing"
	"time"
)

// TestMeasureConnectParallelOverhead reports average ConnectParallel cost.
// Gated behind DBTEST_MEASURE=1 so normal suites stay fast.
func TestMeasureConnectParallelOverhead(t *testing.T) {
	if os.Getenv("DBTEST_MEASURE") != "1" {
		t.Skip("set DBTEST_MEASURE=1 to run ConnectParallel overhead measurement")
	}

	if os.Getenv("TEST_DATABASE_URL") == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}

	const n = 50

	// Warm template + first clone.
	t.Run("warm", func(t *testing.T) {
		_ = ConnectParallel(t)
	})

	total := time.Duration(0)
	for i := 0; i < n; i++ {
		start := time.Now()
		t.Run(fmt.Sprintf("clone_%d", i), func(t *testing.T) {
			_ = ConnectParallel(t)
		})
		total += time.Since(start)
	}

	t.Logf("ConnectParallel n=%d total=%s avg=%s", n, total, total/n)
}
