import { beforeAll, describe, it } from "vitest";
import { replayDeliveryTrace } from "../model/delivery-replay.js";
import { generateDeliveryTraces } from "../model/quint.js";
import { buildRustPackage } from "../setup/process.js";

const CAMPAIGN_TIMEOUT_MS = 300_000;

describe("bounded Quint delivery/checkpoint traces against Atrium", () => {
  beforeAll(() => {
    buildRustPackage("atrium");
  }, 120_000);

  it(
    "replays the deterministic recovery trace and bounded generated campaign",
    async () => {
      const traces = await generateDeliveryTraces();
      for (const trace of traces) await replayDeliveryTrace(trace);
    },
    CAMPAIGN_TIMEOUT_MS,
  );
});
