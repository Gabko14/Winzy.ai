package auth

// SetHashingParamsForTests retunes the package-level Argon2 parameters used by
// HashPassword and VerifyPassword. It exists for test processes only and MUST
// be called exactly once, from TestMain, BEFORE any test runs (it mutates a
// package var: calling it per-test is a data race once t.Parallel arrives in
// winzy.ai-utzz/zfa3, and -race will rightly fail it).
func SetHashingParamsForTests(parallelism uint8, memoryKiB, iterations uint32) {
	hashingParams = argon2Params{
		parallelism: parallelism,
		memoryKiB:   memoryKiB,
		iterations:  iterations,
	}
}
