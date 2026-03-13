import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchFriends,
  fetchFriendRequests,
  acceptFriendRequest as apiAcceptRequest,
  declineFriendRequest as apiDeclineRequest,
  removeFriend as apiRemoveFriend,
  type Friend,
  type IncomingRequest,
  type OutgoingRequest,
} from "../api/social";
import type { ApiError } from "../api/types";

type FriendsState = {
  friends: Friend[];
  totalFriends: number;
  incoming: IncomingRequest[];
  outgoing: OutgoingRequest[];
  loading: boolean;
  requestsLoading: boolean;
  error: ApiError | null;
  requestsError: ApiError | null;
};

export function useFriends() {
  const [state, setState] = useState<FriendsState>({
    friends: [],
    totalFriends: 0,
    incoming: [],
    outgoing: [],
    loading: true,
    requestsLoading: true,
    error: null,
    requestsError: null,
  });

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadFriends = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetchFriends(1, 100);
      if (!mountedRef.current) return;
      setState((s) => ({
        ...s,
        friends: data.items,
        totalFriends: data.total,
        loading: false,
        error: null,
      }));
    } catch (err) {
      if (!mountedRef.current) return;
      setState((s) => ({ ...s, loading: false, error: err as ApiError }));
    }
  }, []);

  const loadRequests = useCallback(async () => {
    setState((s) => ({ ...s, requestsLoading: true, requestsError: null }));
    try {
      const data = await fetchFriendRequests();
      if (!mountedRef.current) return;
      setState((s) => ({
        ...s,
        incoming: data.incoming,
        outgoing: data.outgoing,
        requestsLoading: false,
        requestsError: null,
      }));
    } catch (err) {
      if (!mountedRef.current) return;
      setState((s) => ({ ...s, requestsLoading: false, requestsError: err as ApiError }));
    }
  }, []);

  const refresh = useCallback(async () => {
    await Promise.all([loadFriends(), loadRequests()]);
  }, [loadFriends, loadRequests]);

  useEffect(() => {
    loadFriends();
    loadRequests();
  }, [loadFriends, loadRequests]);

  const acceptRequest = useCallback(async (requestId: string): Promise<boolean> => {
    try {
      await apiAcceptRequest(requestId);
      if (!mountedRef.current) return true;
      // Remove from incoming, refresh friends list
      setState((s) => ({
        ...s,
        incoming: s.incoming.filter((r) => r.id !== requestId),
      }));
      await loadFriends();
      return true;
    } catch {
      return false;
    }
  }, [loadFriends]);

  const declineRequest = useCallback(async (requestId: string): Promise<boolean> => {
    try {
      await apiDeclineRequest(requestId);
      if (!mountedRef.current) return true;
      setState((s) => ({
        ...s,
        incoming: s.incoming.filter((r) => r.id !== requestId),
      }));
      return true;
    } catch {
      return false;
    }
  }, []);

  const cancelRequest = useCallback(async (requestId: string): Promise<boolean> => {
    // Outgoing requests: the requestId is the friendship ID.
    // Declining from the sender side is the same as remove.
    try {
      await apiDeclineRequest(requestId);
      if (!mountedRef.current) return true;
      setState((s) => ({
        ...s,
        outgoing: s.outgoing.filter((r) => r.id !== requestId),
      }));
      return true;
    } catch {
      return false;
    }
  }, []);

  const removeFriend = useCallback(async (friendId: string): Promise<boolean> => {
    try {
      await apiRemoveFriend(friendId);
      if (!mountedRef.current) return true;
      setState((s) => ({
        ...s,
        friends: s.friends.filter((f) => f.friendId !== friendId),
        totalFriends: s.totalFriends - 1,
      }));
      return true;
    } catch {
      return false;
    }
  }, []);

  return {
    friends: state.friends,
    totalFriends: state.totalFriends,
    incoming: state.incoming,
    outgoing: state.outgoing,
    loading: state.loading,
    requestsLoading: state.requestsLoading,
    error: state.error,
    requestsError: state.requestsError,
    refresh,
    acceptRequest,
    declineRequest,
    cancelRequest,
    removeFriend,
  };
}
