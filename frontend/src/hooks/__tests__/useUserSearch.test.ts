import { renderHook, act, waitFor } from "@testing-library/react-native";
import { useUserSearch } from "../useUserSearch";

jest.mock("../../api/social", () => ({
  searchUsers: jest.fn(),
}));

const { searchUsers } = jest.requireMock("../../api/social");

const mockResults = [
  { id: "u1", username: "alice", displayName: "Alice", avatarUrl: null },
  { id: "u2", username: "alicia", displayName: "Alicia", avatarUrl: null },
];

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("useUserSearch", () => {
  // --- Happy path ---

  it("returns search results after debounce delay", async () => {
    searchUsers.mockResolvedValue(mockResults);

    const { result } = renderHook(() => useUserSearch());

    // Set query
    act(() => {
      result.current.setQuery("ali");
    });

    // Loading should be true immediately (query >= 2 chars)
    expect(result.current.loading).toBe(true);

    // Advance past debounce
    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(searchUsers).toHaveBeenCalledWith("ali");
    expect(result.current.results).toEqual(mockResults);
    expect(result.current.error).toBeNull();
  });

  it("clear resets query and results", async () => {
    searchUsers.mockResolvedValue(mockResults);

    const { result } = renderHook(() => useUserSearch());

    act(() => {
      result.current.setQuery("ali");
    });

    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(result.current.results).toEqual(mockResults);
    });

    act(() => {
      result.current.clear();
    });

    expect(result.current.query).toBe("");
    expect(result.current.results).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  // --- Edge cases ---

  it("does not search when query is under 2 characters", async () => {
    const { result } = renderHook(() => useUserSearch());

    act(() => {
      result.current.setQuery("a");
    });

    // Should immediately clear, not set loading
    expect(result.current.results).toEqual([]);
    expect(result.current.loading).toBe(false);

    // Even after debounce, no API call
    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    expect(searchUsers).not.toHaveBeenCalled();
  });

  it("clears results when query goes from valid to too short", async () => {
    searchUsers.mockResolvedValue(mockResults);

    const { result } = renderHook(() => useUserSearch());

    // First, get results
    act(() => {
      result.current.setQuery("ali");
    });

    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(result.current.results).toEqual(mockResults);
    });

    // Now type a short query
    act(() => {
      result.current.setQuery("a");
    });

    expect(result.current.results).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it("trims whitespace before checking length", async () => {
    const { result } = renderHook(() => useUserSearch());

    act(() => {
      result.current.setQuery("  a  ");
    });

    // Trimmed "a" is 1 char — should not search
    expect(result.current.loading).toBe(false);

    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    expect(searchUsers).not.toHaveBeenCalled();
  });

  it("only fires the last query during rapid typing", async () => {
    searchUsers.mockResolvedValue(mockResults);

    const { result } = renderHook(() => useUserSearch());

    // Type quickly
    act(() => {
      result.current.setQuery("al");
    });
    act(() => {
      result.current.setQuery("ali");
    });
    act(() => {
      result.current.setQuery("alic");
    });

    // Advance past debounce — only "alic" should fire
    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(searchUsers).toHaveBeenCalledTimes(1);
    expect(searchUsers).toHaveBeenCalledWith("alic");
  });

  it("accepts custom debounceMs", async () => {
    searchUsers.mockResolvedValue(mockResults);

    const { result } = renderHook(() => useUserSearch(500));

    act(() => {
      result.current.setQuery("ali");
    });

    // At 300ms, should not have fired yet
    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    expect(searchUsers).not.toHaveBeenCalled();

    // At 500ms, should fire
    await act(async () => {
      jest.advanceTimersByTime(200);
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(searchUsers).toHaveBeenCalledWith("ali");
  });

  it("discards stale responses using sequence guard", async () => {
    // First search resolves slowly
    const slowResults = [{ id: "u1", username: "old", displayName: null, avatarUrl: null }];
    const fastResults = [{ id: "u2", username: "new", displayName: null, avatarUrl: null }];

    let resolveFirst!: (value: unknown) => void;
    searchUsers
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockResolvedValueOnce(fastResults);

    const { result } = renderHook(() => useUserSearch(0));

    // First query
    act(() => {
      result.current.setQuery("ol");
    });

    await act(async () => {
      jest.advanceTimersByTime(0);
    });

    // Second query before first resolves (seq increments)
    act(() => {
      result.current.setQuery("ne");
    });

    await act(async () => {
      jest.advanceTimersByTime(0);
    });

    // Second resolves first
    await waitFor(() => {
      expect(result.current.results).toEqual(fastResults);
    });

    // First resolves late — should be ignored due to stale seq
    await act(async () => {
      resolveFirst(slowResults);
    });

    // Results should still be from the second query
    expect(result.current.results).toEqual(fastResults);
  });

  // --- Error conditions ---

  it("sets error on API failure", async () => {
    const apiError = { status: 500, code: "server_error", message: "Search failed" };
    searchUsers.mockRejectedValue(apiError);

    const { result } = renderHook(() => useUserSearch());

    act(() => {
      result.current.setQuery("ali");
    });

    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toEqual(apiError);
    expect(result.current.results).toEqual([]);
  });

  it("clears previous error on new successful search", async () => {
    const apiError = { status: 500, code: "server_error", message: "Search failed" };
    searchUsers.mockRejectedValueOnce(apiError).mockResolvedValueOnce(mockResults);

    const { result } = renderHook(() => useUserSearch());

    // First search fails
    act(() => {
      result.current.setQuery("ali");
    });

    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(result.current.error).toEqual(apiError);
    });

    // Second search succeeds
    act(() => {
      result.current.setQuery("alic");
    });

    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    expect(result.current.results).toEqual(mockResults);
  });
});
