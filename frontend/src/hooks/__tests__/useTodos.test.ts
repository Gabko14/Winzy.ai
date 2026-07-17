import { act, waitFor } from "@testing-library/react-native";
import {
  classifyTodoForToday,
  weekdayShortLabel,
  useTodosToday,
} from "../useTodos";
import type { Todo } from "../../api/todos";
import { renderHookWithQueryClient } from "../../test/renderWithQueryClient";

jest.mock("../../api/todos", () => ({
  fetchTodos: jest.fn(),
  createTodo: jest.fn(),
  completeTodo: jest.fn(),
  uncompleteTodo: jest.fn(),
}));

const { fetchTodos, createTodo, completeTodo, uncompleteTodo } =
  jest.requireMock("../../api/todos");

function makeTodo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: "t1",
    title: "Buy milk",
    dueDate: null,
    position: 0,
    completedAt: null,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

const RealDate = global.Date;

function mockToday(isoDate: string) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const fixed = new RealDate(y, m - 1, d, 12, 0, 0);
  const MockDate = function (this: Date, ...args: unknown[]) {
    if (args.length === 0) return new RealDate(fixed.getTime());
    // @ts-expect-error -- constructor spread
    return new RealDate(...args);
  } as unknown as DateConstructor;
  MockDate.now = () => fixed.getTime();
  MockDate.UTC = RealDate.UTC.bind(RealDate);
  MockDate.parse = RealDate.parse.bind(RealDate);
  Object.defineProperty(MockDate, "prototype", {
    value: RealDate.prototype,
    writable: false,
  });
  global.Date = MockDate;
}

beforeEach(() => {
  jest.clearAllMocks();
  global.Date = RealDate;
});

afterEach(() => {
  global.Date = RealDate;
});

describe("classifyTodoForToday", () => {
  const today = "2026-07-17";

  it("returns undated for null dueDate", () => {
    expect(classifyTodoForToday(makeTodo({ dueDate: null }), today)).toBe("undated");
  });

  it("returns due_today for today's date", () => {
    expect(classifyTodoForToday(makeTodo({ dueDate: today }), today)).toBe("due_today");
  });

  it("returns overdue for past dueDate", () => {
    expect(classifyTodoForToday(makeTodo({ dueDate: "2026-07-10" }), today)).toBe("overdue");
  });

  it("returns null for future dueDate", () => {
    expect(classifyTodoForToday(makeTodo({ dueDate: "2026-07-20" }), today)).toBeNull();
  });

  it("returns null for completed todos", () => {
    expect(
      classifyTodoForToday(
        makeTodo({ dueDate: today, completedAt: "2026-07-17T12:00:00Z" }),
        today,
      ),
    ).toBeNull();
  });
});

describe("weekdayShortLabel", () => {
  it("returns a non-empty weekday label for a civil date", () => {
    expect(weekdayShortLabel("2026-07-13").length).toBeGreaterThan(0);
  });
});

describe("useTodosToday", () => {
  it("filters Today-relevant open todos and hides the section when empty", async () => {
    mockToday("2026-07-17");
    fetchTodos.mockResolvedValue([
      makeTodo({ id: "over", title: "Over", dueDate: "2026-07-10", position: 0 }),
      makeTodo({ id: "today", title: "Today", dueDate: "2026-07-17", position: 1 }),
      makeTodo({ id: "undated", title: "Someday", dueDate: null, position: 2 }),
      makeTodo({ id: "future", title: "Later", dueDate: "2026-07-20", position: 3 }),
    ]);

    const { result } = renderHookWithQueryClient(() => useTodosToday());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.visible).toBe(true);
    expect(result.current.items.map((i) => i.todo.id)).toEqual(["over", "today", "undated"]);
    expect(result.current.items[0].bucket).toBe("overdue");
  });

  it("quickAdd creates an undated todo", async () => {
    mockToday("2026-07-17");
    fetchTodos.mockResolvedValue([]);
    createTodo.mockImplementation(async (req: { title: string }) => {
      const todo = makeTodo({ id: "new", title: req.title, dueDate: null });
      fetchTodos.mockResolvedValue([todo]);
      return todo;
    });

    const { result } = renderHookWithQueryClient(() => useTodosToday());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.visible).toBe(false);

    await act(async () => {
      await result.current.quickAdd("Ship");
    });

    expect(createTodo).toHaveBeenCalledWith({ title: "Ship" });
    await waitFor(() => {
      expect(result.current.visible).toBe(true);
      expect(result.current.items.some((i) => i.todo.title === "Ship")).toBe(true);
    });
  });

  it("quickAdd empty string is a no-op", async () => {
    mockToday("2026-07-17");
    fetchTodos.mockResolvedValue([]);

    const { result } = renderHookWithQueryClient(() => useTodosToday());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.quickAdd("   ");
    });

    expect(createTodo).not.toHaveBeenCalled();
  });

  it("toggleComplete marks the row as exiting", async () => {
    mockToday("2026-07-17");
    const open = makeTodo({ id: "t1", title: "Do it", dueDate: null });
    fetchTodos.mockResolvedValue([open]);
    // Keep the mutation pending so linger timer does not race the assertion.
    let resolveComplete: (value: Todo) => void = () => {};
    completeTodo.mockImplementation(
      () =>
        new Promise<Todo>((resolve) => {
          resolveComplete = resolve;
        }),
    );

    const { result } = renderHookWithQueryClient(() => useTodosToday());

    await waitFor(() => {
      expect(result.current.items).toHaveLength(1);
    });

    let togglePromise: Promise<void>;
    await act(async () => {
      togglePromise = result.current.toggleComplete("t1");
    });

    await waitFor(() => {
      expect(result.current.items[0]?.exiting).toBe(true);
    });

    await act(async () => {
      resolveComplete({ ...open, completedAt: "2026-07-17T12:00:00Z" });
      await togglePromise;
    });
  });

  it("uncomplete during exit restores the row", async () => {
    mockToday("2026-07-17");
    const open = makeTodo({ id: "t1", title: "Do it", dueDate: null });
    fetchTodos.mockResolvedValue([open]);
    completeTodo.mockResolvedValue({
      ...open,
      completedAt: "2026-07-17T12:00:00Z",
    });
    uncompleteTodo.mockResolvedValue(open);

    const { result } = renderHookWithQueryClient(() => useTodosToday());

    await waitFor(() => {
      expect(result.current.items).toHaveLength(1);
    });

    await act(async () => {
      await result.current.toggleComplete("t1");
    });
    expect(result.current.items[0].exiting).toBe(true);

    await act(async () => {
      await result.current.toggleComplete("t1");
    });

    expect(uncompleteTodo).toHaveBeenCalledWith("t1");
    expect(result.current.items[0].exiting).toBe(false);
    expect(result.current.items[0].todo.completedAt).toBeNull();
  });
});
