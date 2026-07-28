import { describe, it, expect } from "vitest";
import { moneyUsd, pricePerMillion } from "./utils";

describe("money formatting", () => {
  it("moneyUsd uses 2 decimals for amounts >= 1", () => {
    expect(moneyUsd(2.5)).toBe("$2.50");
    expect(moneyUsd(1)).toBe("$1.00");
  });

  it("moneyUsd uses 4 decimals for amounts < 1", () => {
    expect(moneyUsd(0.5)).toBe("$0.5000");
    expect(moneyUsd(0.0012)).toBe("$0.0012");
  });

  it("pricePerMillion formats per-million pricing with 2 decimals", () => {
    expect(pricePerMillion(5)).toBe("$5.00/M");
    expect(pricePerMillion(0.3)).toBe("$0.30/M");
  });
});
