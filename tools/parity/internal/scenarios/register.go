// Package scenarios holds every scripted API scenario the parity harness
// runs. Each file groups scenarios for one API area (auth, habits,
// completions, ...); every scenario registers itself via registerAll in
// its file's init(). All() returns the full inventory in registration
// order, which is also the order the runner executes and reports them in.
package scenarios

import "winzy.ai/parity/internal/runner"

var all []runner.Scenario

func registerAll(scenarios ...runner.Scenario) {
	all = append(all, scenarios...)
}

// All returns every registered scenario, in the order their source files
// were compiled (auth, habits, completions, stats, promises, public flame,
// friends, visibility, witness links, challenges, notifications, activity,
// export, error shapes).
func All() []runner.Scenario {
	return all
}
