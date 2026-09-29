import { describe, expect, it } from "vitest";
import { leaderAnnouncementRequiresConnection } from "./db-owner.js";

const LEADER = "leader-worker";
const EPOCH = "leader-epoch";

describe("leaderAnnouncementRequiresConnection", () => {
  it("reconnects when a timed-out proxy receives the incumbent's same-epoch announcement", () => {
    expect(
      leaderAnnouncementRequiresConnection(EPOCH, LEADER, false, {
        type: "leader",
        epoch: EPOCH,
        leader: LEADER,
      }),
    ).toBe(true);
  });

  it("does not rebuild a healthy proxy for a duplicate announcement", () => {
    expect(
      leaderAnnouncementRequiresConnection(EPOCH, LEADER, true, {
        type: "leader",
        epoch: EPOCH,
        leader: LEADER,
      }),
    ).toBe(false);
  });

  it("reconnects when either the leader or leadership term changes", () => {
    expect(
      leaderAnnouncementRequiresConnection(EPOCH, LEADER, true, {
        type: "leader",
        epoch: "next-epoch",
        leader: LEADER,
      }),
    ).toBe(true);
    expect(
      leaderAnnouncementRequiresConnection(EPOCH, LEADER, true, {
        type: "leader",
        epoch: EPOCH,
        leader: "replacement-worker",
      }),
    ).toBe(true);
  });
});
