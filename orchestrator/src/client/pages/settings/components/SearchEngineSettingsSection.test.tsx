import type { UpdateSettingsInput } from "@shared/settings-schema.js";
import { fireEvent, render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";
import { Accordion } from "@/components/ui/accordion";
import { SearchEngineSettingsSection } from "./SearchEngineSettingsSection";

const defaultValues = {
  metaSearchEnabled: { effective: true, default: true },
  metaSearchTimeoutMs: { effective: 60000, default: 60000 },
  searchAutoIngestEnabled: { effective: false, default: false },
  searchAutoIngestMinRelevance: { effective: 70, default: 70 },
  mcpEnabled: { effective: false, default: false },
  serpApiKey: { effective: "", default: "" },
};

function TestWrapper({
  initialValues = {},
  isLoading = false,
  isSaving = false,
}: {
  initialValues?: Partial<UpdateSettingsInput>;
  isLoading?: boolean;
  isSaving?: boolean;
}) {
  const methods = useForm<UpdateSettingsInput>({
    defaultValues: {
      metaSearchEnabled: null,
      searchAutoIngestEnabled: null,
      mcpEnabled: null,
      serpApiKey: "",
      ...initialValues,
    },
  });

  return (
    <FormProvider {...methods}>
      <Accordion type="single" defaultValue="search-engine" collapsible>
        <SearchEngineSettingsSection
          values={defaultValues}
          isLoading={isLoading}
          isSaving={isSaving}
          mode="accordion"
        />
      </Accordion>
    </FormProvider>
  );
}

describe("SearchEngineSettingsSection", () => {
  it("renders all toggles with correct initial default states", () => {
    render(<TestWrapper />);

    const metaSwitch = screen.getByLabelText(/Free Internet-Wide Meta-Search/i);
    const autoIngestSwitch = screen.getByLabelText(
      /Auto-Save Search Results to Tracked Jobs/i,
    );
    const mcpSwitch = screen.getByLabelText(
      /Model Context Protocol \(MCP\) Server/i,
    );

    // Meta search defaults to true
    expect(metaSwitch).toHaveAttribute("data-state", "checked");
    // Auto ingest defaults to false
    expect(autoIngestSwitch).toHaveAttribute("data-state", "unchecked");
    // MCP defaults to false
    expect(mcpSwitch).toHaveAttribute("data-state", "unchecked");
  });

  it("toggles switch states on click", async () => {
    render(<TestWrapper />);

    const mcpSwitch = screen.getByLabelText(
      /Model Context Protocol \(MCP\) Server/i,
    );
    expect(mcpSwitch).toHaveAttribute("data-state", "unchecked");

    fireEvent.click(mcpSwitch);
    expect(mcpSwitch).toHaveAttribute("data-state", "checked");

    const autoIngestSwitch = screen.getByLabelText(
      /Auto-Save Search Results to Tracked Jobs/i,
    );
    expect(autoIngestSwitch).toHaveAttribute("data-state", "unchecked");

    fireEvent.click(autoIngestSwitch);
    expect(autoIngestSwitch).toHaveAttribute("data-state", "checked");
  });

  it("disables toggles when saving or loading", () => {
    render(<TestWrapper isSaving={true} />);

    const metaSwitch = screen.getByLabelText(/Free Internet-Wide Meta-Search/i);
    const autoIngestSwitch = screen.getByLabelText(
      /Auto-Save Search Results to Tracked Jobs/i,
    );
    const mcpSwitch = screen.getByLabelText(
      /Model Context Protocol \(MCP\) Server/i,
    );

    expect(metaSwitch).toBeDisabled();
    expect(autoIngestSwitch).toBeDisabled();
    expect(mcpSwitch).toBeDisabled();
  });
});
