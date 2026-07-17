import { api } from "./client";
import type { components } from "./generated/schema";

type Schemas = components["schemas"];

export type Todo = Schemas["Todo"];
export type CreateTodoRequest = Schemas["CreateTodoRequest"];
export type UpdateTodoRequest = Schemas["UpdateTodoRequest"];
export type OrderTodosRequest = Schemas["OrderTodosRequest"];
export type TodoListStatus = "open" | "completed" | "all";

export function fetchTodos(status: TodoListStatus = "open"): Promise<Todo[]> {
  const q = status === "open" ? "" : `?status=${encodeURIComponent(status)}`;
  return api.get<Todo[]>(`/todos${q}`);
}

export function createTodo(request: CreateTodoRequest): Promise<Todo> {
  return api.post<Todo>("/todos", request);
}

export function updateTodo(id: string, request: UpdateTodoRequest): Promise<Todo> {
  return api.put<Todo>(`/todos/${id}`, request);
}

export function deleteTodo(id: string): Promise<void> {
  return api.delete<void>(`/todos/${id}`);
}

export function completeTodo(id: string): Promise<Todo> {
  return api.post<Todo>(`/todos/${id}/complete`);
}

export function uncompleteTodo(id: string): Promise<Todo> {
  return api.delete<Todo>(`/todos/${id}/complete`);
}

export function orderTodos(request: OrderTodosRequest): Promise<void> {
  return api.put<void>("/todos/order", request);
}
