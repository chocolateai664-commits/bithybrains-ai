import type { BithyTool } from "@/lib/brains/types";
import { CONTAINERTRACK } from "./containertrack/config";
import { validateContainerNumberTool } from "./containertrack/tools/validateContainerNumber";
import { identifyCarrierTool } from "./containertrack/tools/identifyCarrier";
import { trackContainerTool } from "./containertrack/tools/trackContainer";
import { searchContainerWebTool } from "./containertrack/tools/searchContainerWeb";
import { getCarrierInformationTool } from "./containertrack/tools/getCarrierInformation";
import { generateTrackingReportTool } from "./containertrack/tools/generateTrackingReport";

/**
 * Application layer.
 *
 * Applications register their own tools here; Bithy Brains stays
 * application-agnostic and simply merges what each application declares into
 * the shared tool registry, where the existing permission, rate-limit and
 * audit paths apply unchanged.
 */

export interface ApplicationModule {
  slug: string;
  name: string;
  capabilities: readonly string[];
  tools: BithyTool[];
}

export const APPLICATIONS: ApplicationModule[] = [
  {
    slug: CONTAINERTRACK.slug,
    name: CONTAINERTRACK.name,
    capabilities: CONTAINERTRACK.capabilities,
    tools: [
      validateContainerNumberTool,
      identifyCarrierTool,
      trackContainerTool,
      searchContainerWebTool,
      getCarrierInformationTool,
      generateTrackingReportTool,
    ],
  },
];

/** Every tool contributed by registered applications. */
export function applicationTools(): BithyTool[] {
  return APPLICATIONS.flatMap((app) => app.tools);
}

/** Tool ids an application is allowed to expose to a model. */
export function toolsForApplication(slug: string): BithyTool[] {
  return APPLICATIONS.find((app) => app.slug === slug)?.tools ?? [];
}
