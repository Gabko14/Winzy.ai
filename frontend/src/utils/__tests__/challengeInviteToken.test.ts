import {
  clearPendingChallengeInviteToken,
  getPendingChallengeInviteToken,
  setPendingChallengeInviteToken,
} from "../challengeInviteToken";

describe("challengeInviteToken", () => {
  beforeEach(() => {
    clearPendingChallengeInviteToken();
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.clear();
    }
  });

  it("stores and reads from memory + sessionStorage", () => {
    setPendingChallengeInviteToken("tok-abc");
    expect(getPendingChallengeInviteToken()).toBe("tok-abc");
    if (typeof sessionStorage !== "undefined") {
      expect(sessionStorage.getItem("winzy.challengeInviteToken")).toBe("tok-abc");
    }
  });

  it("clears both stores", () => {
    setPendingChallengeInviteToken("tok-abc");
    clearPendingChallengeInviteToken();
    expect(getPendingChallengeInviteToken()).toBeNull();
  });

  it("rehydrates memory from sessionStorage", () => {
    if (typeof sessionStorage === "undefined") return;
    sessionStorage.setItem("winzy.challengeInviteToken", "from-session");
    clearPendingChallengeInviteToken();
    // clear wiped memory; put session back to simulate reload
    sessionStorage.setItem("winzy.challengeInviteToken", "from-session");
    expect(getPendingChallengeInviteToken()).toBe("from-session");
  });
});
