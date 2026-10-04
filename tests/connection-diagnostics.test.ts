import { describe, expect, it } from "vitest";
import { diagnoseConnectionError } from "../src/main/connection-diagnostics";

describe("connection diagnostics", () => {
  it("classifies actionable DNS, TLS and authentication failures", () => {
    expect(
      diagnoseConnectionError("getaddrinfo ENOTFOUND cluster.example").kind,
    ).toBe("network");
    expect(
      diagnoseConnectionError("unable to verify the first certificate").kind,
    ).toBe("tls");
    expect(diagnoseConnectionError("Authentication failed.").kind).toBe(
      "authentication",
    );
  });

  it.each([
    "Retryable writes are not supported. Please disable retryable writes by specifying retrywrites=false in the connection string.",
    "This MongoDB deployment does not support retryable writes. Please add retryWrites=false to your connection string.",
  ])(
    "explains how to resolve an unsupported retryable write: %s",
    (message) => {
      const diagnostic = diagnoseConnectionError(message);
      expect(diagnostic.kind).toBe("compatibility");
      expect(diagnostic.advice).toMatch(/disable retryable writes/i);
      expect(diagnostic.advice).toMatch(/reconnect/i);
    },
  );

  it("does not misclassify transient write timeouts as unsupported retryable writes", () => {
    expect(
      diagnoseConnectionError(
        "Retryable write timed out waiting for the primary",
      ).kind,
    ).toBe("timeout");
  });
});
