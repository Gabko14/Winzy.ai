import {
  createWitnessLink,
  listWitnessLinks,
  updateWitnessLink,
  revokeWitnessLink,
  rotateWitnessLink,
  fetchWitnessView,
} from "../witnessLinks";

// Mock the client module
const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPut = jest.fn();
const mockDelete = jest.fn();
const mockApiRequest = jest.fn();

jest.mock("../client", () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    put: (...args: unknown[]) => mockPut(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe("witnessLinks API", () => {
  // --- Happy paths ---

  describe("createWitnessLink", () => {
    it("sends POST to /social/witness-links with label and habitIds", async () => {
      const response = {
        id: "link-1",
        token: "abc123",
        label: "Maya",
        habitIds: ["h1", "h2"],
        createdAt: "2026-03-20T00:00:00Z",
      };
      mockPost.mockResolvedValue(response);

      const result = await createWitnessLink({ label: "Maya", habitIds: ["h1", "h2"] });

      expect(mockPost).toHaveBeenCalledWith("/social/witness-links", {
        label: "Maya",
        habitIds: ["h1", "h2"],
      });
      expect(result).toEqual(response);
    });

    it("sends POST without optional fields", async () => {
      mockPost.mockResolvedValue({ id: "link-2", token: "xyz", label: null, habitIds: [], createdAt: "2026-03-20T00:00:00Z" });

      await createWitnessLink({});

      expect(mockPost).toHaveBeenCalledWith("/social/witness-links", {});
    });
  });

  describe("listWitnessLinks", () => {
    it("sends GET to /social/witness-links", async () => {
      const response = {
        items: [
          { id: "link-1", token: "abc", label: "Maya", habitIds: ["h1"], createdAt: "2026-03-20T00:00:00Z" },
        ],
      };
      mockGet.mockResolvedValue(response);

      const result = await listWitnessLinks();

      expect(mockGet).toHaveBeenCalledWith("/social/witness-links");
      expect(result.items).toHaveLength(1);
    });

    it("returns empty items array when no links exist", async () => {
      mockGet.mockResolvedValue({ items: [] });

      const result = await listWitnessLinks();

      expect(result.items).toHaveLength(0);
    });
  });

  describe("updateWitnessLink", () => {
    it("sends PUT with updated label and habitIds", async () => {
      const updated = { id: "link-1", token: "abc", label: "Coach Sam", habitIds: ["h3"], createdAt: "2026-03-20T00:00:00Z" };
      mockPut.mockResolvedValue(updated);

      const result = await updateWitnessLink("link-1", { label: "Coach Sam", habitIds: ["h3"] });

      expect(mockPut).toHaveBeenCalledWith("/social/witness-links/link-1", {
        label: "Coach Sam",
        habitIds: ["h3"],
      });
      expect(result.label).toBe("Coach Sam");
    });
  });

  describe("revokeWitnessLink", () => {
    it("sends DELETE to /social/witness-links/{id}", async () => {
      mockDelete.mockResolvedValue(undefined);

      await revokeWitnessLink("link-1");

      expect(mockDelete).toHaveBeenCalledWith("/social/witness-links/link-1");
    });
  });

  describe("rotateWitnessLink", () => {
    it("sends POST to /social/witness-links/{id}/rotate", async () => {
      const rotated = { id: "link-1", token: "new-token", label: "Maya", habitIds: ["h1"], createdAt: "2026-03-20T00:00:00Z" };
      mockPost.mockResolvedValue(rotated);

      const result = await rotateWitnessLink("link-1");

      expect(mockPost).toHaveBeenCalledWith("/social/witness-links/link-1/rotate");
      expect(result.token).toBe("new-token");
    });
  });

  describe("fetchWitnessView", () => {
    it("fetches anonymous witness view with noAuth", async () => {
      const response = {
        ownerUsername: "alice",
        ownerDisplayName: "Alice",
        habits: [
          { id: "h1", name: "Meditate", icon: null, color: null, consistency: 75, flameLevel: "strong" },
        ],
        habitsUnavailable: false,
      };
      mockApiRequest.mockResolvedValue(response);

      const result = await fetchWitnessView("abc123token");

      expect(mockApiRequest).toHaveBeenCalledWith(
        "/social/witness/abc123token",
        expect.objectContaining({ noAuth: true }),
      );
      expect(result.habits).toHaveLength(1);
      expect(result.ownerUsername).toBe("alice");
    });

    it("encodes special characters in token", async () => {
      mockApiRequest.mockResolvedValue({
        ownerUsername: null,
        ownerDisplayName: null,
        habits: [],
        habitsUnavailable: false,
      });

      await fetchWitnessView("abc+def/ghi");

      expect(mockApiRequest).toHaveBeenCalledWith(
        "/social/witness/abc%2Bdef%2Fghi",
        expect.any(Object),
      );
    });
  });

  // --- Error conditions ---

  describe("error handling", () => {
    it("propagates API errors from createWitnessLink", async () => {
      mockPost.mockRejectedValue({ status: 400, code: "validation", message: "Label too long" });

      await expect(createWitnessLink({ label: "x".repeat(200) })).rejects.toEqual(
        expect.objectContaining({ code: "validation" }),
      );
    });

    it("propagates not_found from revokeWitnessLink", async () => {
      mockDelete.mockRejectedValue({ status: 404, code: "not_found", message: "Not found" });

      await expect(revokeWitnessLink("nonexistent")).rejects.toEqual(
        expect.objectContaining({ code: "not_found" }),
      );
    });

    it("propagates not_found from fetchWitnessView for revoked token", async () => {
      mockApiRequest.mockRejectedValue({ status: 404, code: "not_found", message: "Not available" });

      await expect(fetchWitnessView("revoked-token")).rejects.toEqual(
        expect.objectContaining({ code: "not_found" }),
      );
    });

    it("propagates network errors", async () => {
      mockGet.mockRejectedValue({ status: 0, code: "network", message: "Network error" });

      await expect(listWitnessLinks()).rejects.toEqual(
        expect.objectContaining({ code: "network" }),
      );
    });
  });
});
