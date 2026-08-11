import { createAppSettings } from "@shared/testing/factories.js";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AutomaticRunTab } from "./AutomaticRunTab";

const { getDetectedCountryKeyMock } = vi.hoisted(() => ({
  getDetectedCountryKeyMock: vi.fn((): string | null => null),
}));

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@/lib/user-location", () => ({
  getDetectedCountryKey: getDetectedCountryKeyMock,
}));

describe("AutomaticRunTab", () => {
  beforeEach(() => {
    getDetectedCountryKeyMock.mockReset();
    getDetectedCountryKeyMock.mockReturnValue(null);
  });

  it("uses detected country when location settings are still defaults", () => {
    getDetectedCountryKeyMock.mockReturnValueOnce("united states");

    render(
      <AutomaticRunTab
        open
        settings={createAppSettings()}
        enabledSources={["linkedin", "dice", "instahyre"]}
        pipelineSources={["linkedin"]}
        onToggleSource={vi.fn()}
        onSetPipelineSources={vi.fn()}
        isPipelineRunning={false}
        onSaveAndRun={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(
      screen.getByRole("combobox", { name: "United States" }),
    ).toBeInTheDocument();
  });

  it("loads persisted country from settings", () => {
    render(
      <AutomaticRunTab
        open
        settings={createAppSettings({
          searchTerms: {
            value: ["backend engineer"],
            default: ["backend engineer"],
            override: null,
          },
          jobspyCountryIndeed: {
            value: "us",
            default: "united states",
            override: "us",
          },
          searchCities: { value: "", default: "", override: null },
        })}
        enabledSources={["linkedin", "dice", "instahyre"]}
        pipelineSources={["linkedin"]}
        onToggleSource={vi.fn()}
        onSetPipelineSources={vi.fn()}
        isPipelineRunning={false}
        onSaveAndRun={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(
      screen.getByRole("combobox", { name: "United States" }),
    ).toBeInTheDocument();
  });

  it("maps legacy usa/ca country to United States in the picker", () => {
    render(
      <AutomaticRunTab
        open
        settings={createAppSettings({
          searchTerms: {
            value: ["backend engineer"],
            default: ["backend engineer"],
            override: null,
          },
          jobspyCountryIndeed: {
            value: "usa/ca",
            default: "united states",
            override: "usa/ca",
          },
          searchCities: { value: "", default: "", override: null },
        })}
        enabledSources={["linkedin"]}
        pipelineSources={["linkedin"]}
        onToggleSource={vi.fn()}
        onSetPipelineSources={vi.fn()}
        isPipelineRunning={false}
        onSaveAndRun={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(
      screen.getByRole("combobox", { name: "United States" }),
    ).toBeInTheDocument();
  });

  it("disables and prunes country-restricted sources for mismatched country", async () => {
    const onSetPipelineSources = vi.fn();

    render(
      <AutomaticRunTab
        open
        settings={createAppSettings({
          searchTerms: {
            value: ["backend engineer"],
            default: ["backend engineer"],
            override: null,
          },
          jobspyCountryIndeed: {
            value: "united states",
            default: "united states",
            override: "united states",
          },
          searchCities: { value: "", default: "", override: null },
        })}
        enabledSources={["linkedin", "eluta", "instahyre"]}
        pipelineSources={["linkedin", "eluta", "instahyre"]}
        onToggleSource={vi.fn()}
        onSetPipelineSources={onSetPipelineSources}
        isPipelineRunning={false}
        onSaveAndRun={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    await waitFor(() => {
      expect(onSetPipelineSources).toHaveBeenCalledWith(["linkedin"]);
    });

    expect(screen.getByRole("button", { name: "Eluta" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Instahyre" })).toBeDisabled();
  });

  it("shows disabled source guidance copy for country-restricted source", async () => {
    render(
      <AutomaticRunTab
        open
        settings={createAppSettings({
          searchTerms: {
            value: ["backend engineer"],
            default: ["backend engineer"],
            override: null,
          },
          jobspyCountryIndeed: {
            value: "united states",
            default: "united states",
            override: "united states",
          },
          searchCities: { value: "", default: "", override: null },
        })}
        enabledSources={["linkedin", "eluta"]}
        pipelineSources={["linkedin"]}
        onToggleSource={vi.fn()}
        onSetPipelineSources={vi.fn()}
        isPipelineRunning={false}
        onSaveAndRun={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(
      screen.getByTitle("Eluta is not available for the selected country."),
    ).toBeInTheDocument();
  });

  it("disables glassdoor for supported countries until city is provided", async () => {
    const onSetPipelineSources = vi.fn();

    render(
      <AutomaticRunTab
        open
        settings={createAppSettings({
          searchTerms: {
            value: ["backend engineer"],
            default: ["backend engineer"],
            override: null,
          },
          jobspyCountryIndeed: {
            value: "canada",
            default: "canada",
            override: "canada",
          },
          searchCities: {
            value: "Canada",
            default: "Canada",
            override: "Canada",
          },
        })}
        enabledSources={["linkedin", "glassdoor"]}
        pipelineSources={["linkedin", "glassdoor"]}
        onToggleSource={vi.fn()}
        onSetPipelineSources={onSetPipelineSources}
        isPipelineRunning={false}
        onSaveAndRun={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    await waitFor(() => {
      expect(onSetPipelineSources).toHaveBeenCalledWith(["linkedin"]);
    });

    const glassdoorButton = screen.getByRole("button", { name: "Glassdoor" });
    expect(glassdoorButton).toBeDisabled();
    expect(glassdoorButton.getAttribute("title")).toContain(
      "Add at least one city in Advanced settings to enable Glassdoor.",
    );
  });

  it("does not show legacy country-only city defaults as selected cities", () => {
    render(
      <AutomaticRunTab
        open
        settings={createAppSettings({
          jobspyCountryIndeed: {
            value: "united states",
            default: "united states",
            override: "united states",
          },
          searchCities: {
            value: "USA",
            default: "USA",
            override: "USA",
          },
        })}
        enabledSources={["linkedin"]}
        pipelineSources={["linkedin"]}
        onToggleSource={vi.fn()}
        onSetPipelineSources={vi.fn()}
        isPipelineRunning={false}
        onSaveAndRun={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Advanced settings" }));
    fireEvent.focus(screen.getByLabelText("Cities"));

    expect(
      screen.queryByRole("button", { name: /Remove city/i }),
    ).not.toBeInTheDocument();
  });

  it("does not remove existing search terms when Backspace is pressed on an empty input", () => {
    render(
      <AutomaticRunTab
        open
        settings={createAppSettings({
          searchTerms: {
            value: ["backend engineer", "frontend engineer"],
            default: ["backend engineer", "frontend engineer"],
            override: null,
          },
          jobspyCountryIndeed: {
            value: "united states",
            default: "united states",
            override: "united states",
          },
          searchCities: { value: "", default: "", override: null },
        })}
        enabledSources={["linkedin"]}
        pipelineSources={["linkedin"]}
        onToggleSource={vi.fn()}
        onSetPipelineSources={vi.fn()}
        isPipelineRunning={false}
        onSaveAndRun={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const input = screen.getByPlaceholderText("Type and press Enter");
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "Backspace" });

    expect(
      screen.getByRole("button", { name: "Remove backend engineer" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove frontend engineer" }),
    ).toBeInTheDocument();
  });

  it("loads multiple saved cities and keeps glassdoor enabled", () => {
    render(
      <AutomaticRunTab
        open
        settings={createAppSettings({
          searchTerms: {
            value: ["backend engineer"],
            default: ["backend engineer"],
            override: null,
          },
          jobspyCountryIndeed: {
            value: "canada",
            default: "canada",
            override: "canada",
          },
          searchCities: {
            value: "Toronto|Vancouver",
            default: "Toronto|Vancouver",
            override: "Toronto|Vancouver",
          },
        })}
        enabledSources={["linkedin", "glassdoor"]}
        pipelineSources={["linkedin", "glassdoor"]}
        onToggleSource={vi.fn()}
        onSetPipelineSources={vi.fn()}
        isPipelineRunning={false}
        onSaveAndRun={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Advanced settings" }));
    fireEvent.focus(screen.getByLabelText("Cities"));

    expect(
      screen.getByRole("button", { name: "Remove city Toronto" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove city Vancouver" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Glassdoor" })).toBeEnabled();
  });

  it("loads saved workplace types from settings", () => {
    render(
      <AutomaticRunTab
        open
        settings={createAppSettings({
          workplaceTypes: {
            value: ["remote", "onsite"],
            default: ["remote", "hybrid", "onsite"],
            override: ["remote", "onsite"],
          },
        })}
        enabledSources={["linkedin"]}
        pipelineSources={["linkedin"]}
        onToggleSource={vi.fn()}
        onSetPipelineSources={vi.fn()}
        isPipelineRunning={false}
        onSaveAndRun={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Advanced settings" }));

    expect(screen.getByLabelText("Remote")).toBeChecked();
    expect(screen.getByLabelText("Onsite")).toBeChecked();
    expect(screen.getByLabelText("Hybrid")).not.toBeChecked();
  });

  it("requires at least one workplace type", async () => {
    render(
      <AutomaticRunTab
        open
        settings={createAppSettings()}
        enabledSources={["linkedin"]}
        pipelineSources={["linkedin"]}
        onToggleSource={vi.fn()}
        onSetPipelineSources={vi.fn()}
        isPipelineRunning={false}
        onSaveAndRun={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Advanced settings" }));
    fireEvent.click(screen.getByLabelText("Remote"));
    fireEvent.click(screen.getByLabelText("Hybrid"));
    fireEvent.click(screen.getByLabelText("Onsite"));

    expect(
      screen.getByText("Select at least one workplace type."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Start run now" }),
    ).toBeDisabled();
  });

  it("shows JobSpy guidance when non-remote workplace types are selected", () => {
    render(
      <AutomaticRunTab
        open
        settings={createAppSettings({
          workplaceTypes: {
            value: ["remote", "hybrid"],
            default: ["remote", "hybrid", "onsite"],
            override: ["remote", "hybrid"],
          },
        })}
        enabledSources={["linkedin"]}
        pipelineSources={["linkedin"]}
        onToggleSource={vi.fn()}
        onSetPipelineSources={vi.fn()}
        isPipelineRunning={false}
        onSaveAndRun={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Advanced settings" }));

    expect(
      screen.getByText(
        /Indeed, LinkedIn, and Glassdoor only support strict remote filtering\./i,
      ),
    ).toBeInTheDocument();
  });

  it("submits workplace types in onSaveAndRun values", async () => {
    const onSaveAndRun = vi.fn().mockResolvedValue(undefined);

    render(
      <AutomaticRunTab
        open
        settings={createAppSettings()}
        enabledSources={["linkedin"]}
        pipelineSources={["linkedin"]}
        onToggleSource={vi.fn()}
        onSetPipelineSources={vi.fn()}
        isPipelineRunning={false}
        onSaveAndRun={onSaveAndRun}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Advanced settings" }));
    fireEvent.click(screen.getByLabelText("Hybrid"));
    fireEvent.click(screen.getByLabelText("Onsite"));
    fireEvent.click(screen.getByRole("button", { name: "Start run now" }));

    await waitFor(() => {
      expect(onSaveAndRun).toHaveBeenCalledWith(
        expect.objectContaining({
          workplaceTypes: ["remote"],
        }),
      );
    });
  });
});
