import {
  resolveNotificationDestination,
  consumeNotifSearchParam,
  destinationToNotifQuery,
  normalizeNotifKey,
} from "../notificationRouting";

describe("normalizeNotifKey", () => {
  it("strips leading slash and query/hash", () => {
    expect(normalizeNotifKey("/friends?x=1#h")).toBe("friends");
  });

  it("parses absolute urls", () => {
    expect(normalizeNotifKey("https://example.com/challenges")).toBe("challenges");
  });
});

describe("resolveNotificationDestination", () => {
  it("maps /friends to Friends tab", () => {
    expect(resolveNotificationDestination("/friends")).toEqual({
      kind: "tab",
      tab: "friends",
    });
  });

  it("maps /challenges to challenges overlay", () => {
    expect(resolveNotificationDestination("/challenges")).toEqual({
      kind: "overlay",
      overlay: "challenges",
    });
  });

  it("maps feed keys to Feed tab", () => {
    expect(resolveNotificationDestination("feed")).toEqual({ kind: "tab", tab: "feed" });
    expect(resolveNotificationDestination("/activity")).toEqual({ kind: "tab", tab: "feed" });
  });

  it("maps today / profile shortcut keys", () => {
    expect(resolveNotificationDestination("today")).toEqual({ kind: "tab", tab: "today" });
    expect(resolveNotificationDestination("/profile")).toEqual({
      kind: "tab",
      tab: "profile",
    });
    expect(resolveNotificationDestination("flame")).toEqual({ kind: "tab", tab: "profile" });
  });

  it("falls back to Feed for unknown or missing targets", () => {
    expect(resolveNotificationDestination(undefined)).toEqual({ kind: "tab", tab: "feed" });
    expect(resolveNotificationDestination(null)).toEqual({ kind: "tab", tab: "feed" });
    expect(resolveNotificationDestination("/")).toEqual({ kind: "tab", tab: "feed" });
    expect(resolveNotificationDestination("/nope")).toEqual({ kind: "tab", tab: "feed" });
  });

  it("round-trips query values", () => {
    const friends = resolveNotificationDestination("/friends");
    expect(resolveNotificationDestination(destinationToNotifQuery(friends))).toEqual(friends);
    const challenges = resolveNotificationDestination("/challenges");
    expect(resolveNotificationDestination(destinationToNotifQuery(challenges))).toEqual(
      challenges,
    );
  });
});

describe("consumeNotifSearchParam", () => {
  it("returns null when notif is absent", () => {
    expect(consumeNotifSearchParam("")).toBeNull();
    expect(consumeNotifSearchParam("?foo=1")).toBeNull();
  });

  it("consumes notif and cleans the URL via replaceState", () => {
    const replaced: string[] = [];
    const dest = consumeNotifSearchParam(
      "?notif=friends&x=1",
      (url) => replaced.push(url),
      "/",
      "",
    );
    expect(dest).toEqual({ kind: "tab", tab: "friends" });
    expect(replaced).toEqual(["/?x=1"]);
  });

  it("cleans to bare path when notif was the only param", () => {
    const replaced: string[] = [];
    const dest = consumeNotifSearchParam(
      "?notif=challenges",
      (url) => replaced.push(url),
      "/",
      "",
    );
    expect(dest).toEqual({ kind: "overlay", overlay: "challenges" });
    expect(replaced).toEqual(["/"]);
  });

  it("consumes today/profile shortcut params", () => {
    expect(consumeNotifSearchParam("?notif=today")).toEqual({ kind: "tab", tab: "today" });
    expect(consumeNotifSearchParam("?notif=profile")).toEqual({
      kind: "tab",
      tab: "profile",
    });
  });

  it("unknown notif values fall back to feed without crashing", () => {
    const dest = consumeNotifSearchParam("?notif=legacy-thing");
    expect(dest).toEqual({ kind: "tab", tab: "feed" });
  });
});
