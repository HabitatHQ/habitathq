import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { NotificationsProvider, useNotificationsInstance } from "../context.js";
import { createMockInstance } from "./helpers.js";

function TestConsumer(): ReactNode {
  const instance = useNotificationsInstance();
  return <div data-testid="instance">{typeof instance.notify}</div>;
}

function ThrowingConsumer(): ReactNode {
  useNotificationsInstance();
  return null;
}

describe("NotificationsProvider / useNotificationsInstance", () => {
  it("renders children", () => {
    const inst = createMockInstance();
    render(
      <NotificationsProvider instance={inst}>
        <div data-testid="child">Hello</div>
      </NotificationsProvider>,
    );
    expect(screen.getByTestId("child")).toBeTruthy();
  });

  it("useNotificationsInstance() returns instance inside provider", () => {
    const inst = createMockInstance();
    render(
      <NotificationsProvider instance={inst}>
        <TestConsumer />
      </NotificationsProvider>,
    );
    expect(screen.getByTestId("instance").textContent).toBe("function");
  });

  it("useNotificationsInstance() throws outside provider", () => {
    // Suppress React error boundary console noise
    const originalError = console.error;
    console.error = () => {};
    expect(() => render(<ThrowingConsumer />)).toThrow(
      "useNotifications must be used inside a <NotificationsProvider>.",
    );
    console.error = originalError;
  });

  it("nested providers: inner provider overrides outer", () => {
    const outer = createMockInstance();
    const inner = createMockInstance();
    let capturedInstance: unknown = null;

    function Capture(): ReactNode {
      capturedInstance = useNotificationsInstance();
      return null;
    }

    render(
      <NotificationsProvider instance={outer}>
        <NotificationsProvider instance={inner}>
          <Capture />
        </NotificationsProvider>
      </NotificationsProvider>,
    );

    expect(capturedInstance).toBe(inner);
  });
});
