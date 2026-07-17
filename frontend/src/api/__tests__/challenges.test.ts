import { createChallengeInvite, listChallengeInvites, revokeChallengeInvite } from "../challenges";
import { api } from "../client";

jest.mock("../client", () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  },
}));

const mockedApi = api as jest.Mocked<typeof api>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("challenge invite API", () => {
  it("POSTs createChallengeInvite", async () => {
    mockedApi.post.mockResolvedValue({ id: "1", token: "t", url: "https://winzy.ai/ci/t" });
    const body = {
      habitName: "Run",
      frequency: "daily" as const,
      milestoneType: "consistencyTarget" as const,
      targetValue: 60,
      periodDays: 30,
      rewardDescription: "Coffee",
    };
    await createChallengeInvite(body);
    expect(mockedApi.post).toHaveBeenCalledWith("/challenges/invites", body);
  });

  it("GETs listChallengeInvites", async () => {
    mockedApi.get.mockResolvedValue({ items: [] });
    await listChallengeInvites();
    expect(mockedApi.get).toHaveBeenCalledWith("/challenges/invites");
  });

  it("DELETEs revokeChallengeInvite", async () => {
    mockedApi.delete.mockResolvedValue(undefined);
    await revokeChallengeInvite("inv-1");
    expect(mockedApi.delete).toHaveBeenCalledWith("/challenges/invites/inv-1");
  });
});
