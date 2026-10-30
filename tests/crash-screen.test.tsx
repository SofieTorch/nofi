import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CrashScreen } from "../src/ui/CrashScreen";

function BrokenScreen(): never {
  throw new Error("Element type is invalid");
}

beforeEach(() => {
  // React logs caught render errors; keep the test output readable.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("When part of the app crashes", () => {
  it("shows what went wrong instead of a blank window", () => {
    render(
      <CrashScreen>
        <BrokenScreen />
      </CrashScreen>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Element type is invalid");
  });

  it("keeps the window draggable, since the top bar may be gone", () => {
    const { container } = render(
      <CrashScreen>
        <BrokenScreen />
      </CrashScreen>,
    );

    expect(container.querySelector("[data-tauri-drag-region]")).toBeInTheDocument();
  });

  it("shows the app normally when nothing crashes", () => {
    render(
      <CrashScreen>
        <p>All good</p>
      </CrashScreen>,
    );

    expect(screen.getByText("All good")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
