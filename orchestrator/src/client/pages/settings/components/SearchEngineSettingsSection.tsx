/**
 * Search Engine & MCP Settings Section (ADR-008).
 *
 * Controls internet-wide search crawling, auto-ingesting to tracked applications,
 * free meta-search fallback, and MCP agent integration.
 */

import { Controller, useFormContext } from "react-hook-form";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SettingsSectionFrame } from "./SettingsSectionFrame";

interface SearchEngineSettingsSectionProps {
  mode?: "accordion" | "panel";
}

export const SearchEngineSettingsSection: React.FC<
  SearchEngineSettingsSectionProps
> = ({ mode = "accordion" }) => {
  const { control, register } = useFormContext();

  return (
    <SettingsSectionFrame
      value="search-engine"
      mode={mode}
      title={
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold">
            Search Engine & MCP Integration
          </span>
          <Badge
            variant="outline"
            className="text-xs text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-950 dark:text-blue-200"
          >
            Unlimited Crawl
          </Badge>
        </div>
      }
    >
      <div className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Configure the internet-wide job search engine, automatic tracking of
          high-relevance search results into your applications pipeline, and AI
          agent CLI connectivity via the Model Context Protocol (MCP).
        </p>

        {/* Free Meta Search */}
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div className="space-y-0.5">
            <Label htmlFor="metaSearchEnabled" className="text-sm font-medium">
              Free Internet-Wide Meta-Search
            </Label>
            <p className="text-xs text-muted-foreground">
              Automatically crawls DuckDuckGo, public ATS platforms (Greenhouse,
              Lever, Ashby, Workday), and open job APIs when registered
              extractors have gaps.
            </p>
          </div>
          <Controller
            control={control}
            name="metaSearchEnabled"
            render={({ field }) => (
              <Switch
                id="metaSearchEnabled"
                checked={Boolean(field.value)}
                onCheckedChange={field.onChange}
              />
            )}
          />
        </div>

        {/* Auto Ingest to Tracked Jobs */}
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div className="space-y-0.5">
            <Label
              htmlFor="searchAutoIngestEnabled"
              className="text-sm font-medium"
            >
              Auto-Save Search Results to Tracked Jobs
            </Label>
            <p className="text-xs text-muted-foreground">
              Automatically insert highly-matched search results into the
              Tracked Applications tab as "discovered" jobs with deduplication.
            </p>
          </div>
          <Controller
            control={control}
            name="searchAutoIngestEnabled"
            render={({ field }) => (
              <Switch
                id="searchAutoIngestEnabled"
                checked={Boolean(field.value)}
                onCheckedChange={field.onChange}
              />
            )}
          />
        </div>

        {/* MCP Server */}
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div className="space-y-0.5">
            <Label htmlFor="mcpEnabled" className="text-sm font-medium">
              Model Context Protocol (MCP) Server
            </Label>
            <p className="text-xs text-muted-foreground">
              Enable the MCP server endpoint (<code>/mcp/sse</code> and{" "}
              <code>npm run mcp</code>) for external AI agent CLIs like Claude
              Code, Cursor, and Codex.
            </p>
          </div>
          <Controller
            control={control}
            name="mcpEnabled"
            render={({ field }) => (
              <Switch
                id="mcpEnabled"
                checked={Boolean(field.value)}
                onCheckedChange={field.onChange}
              />
            )}
          />
        </div>

        {/* SerpAPI Optional Key */}
        <div className="space-y-2">
          <Label htmlFor="serpApiKey">
            SerpAPI Key{" "}
            <span className="text-xs font-normal text-muted-foreground">
              (Optional — free search works out-of-the-box without this)
            </span>
          </Label>
          <Input
            id="serpApiKey"
            type="password"
            placeholder="Optional Google Jobs SerpAPI token"
            {...register("serpApiKey")}
          />
          <p className="text-xs text-muted-foreground">
            If provided, queries SerpAPI Google Jobs in addition to free
            DuckDuckGo & public aggregators.
          </p>
        </div>
      </div>
    </SettingsSectionFrame>
  );
};
