import { useEffect, useState } from "react";
import { collectPluginAppRegistrations } from "@get-bb/plugin-sdk/internal/plugin-app-collector";
import { COARSE_POINTER_PROVIDER_TAB_SIZE_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import {
  removePluginSlotRegistrations,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { ProviderIcon } from "./ProviderIcon";

export default { title: "plugin/Provider Icon" };

const pluginId = "story-provider-icon-hitbox";
const maskLogo =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M4 4h16v16H4z'/%3E%3C/svg%3E";
const providers = Array.from({ length: 7 }, (_, index) => ({
  id: `${pluginId}-${index}`,
  label: index < 4 ? `Mask ${index + 1}` : `SVG ${index + 1}`,
  logoUrl: maskLogo,
}));

function SvgMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="currentColor" />
    </svg>
  );
}

function NestedSvgMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="4" fill="currentColor" />
      <svg x="2" y="2" width="20" height="20" viewBox="0 0 300 300">
        <circle cx="150" cy="150" r="100" fill="var(--background)" />
      </svg>
    </svg>
  );
}

export function IntrinsicSvgHitTargets() {
  const [selected, setSelected] = useState(providers[0].id);
  useEffect(() => {
    setPluginSlotRegistrations(
      pluginId,
      collectPluginAppRegistrations({
        __bbPluginApp: true,
        setup(app) {
          for (const provider of providers.slice(4)) {
            app.slots.experimental_providerIcon({
              providerKind: "agent",
              providerId: provider.id,
              icon: provider === providers[5] ? NestedSvgMark : SvgMark,
            });
          }
        },
      }),
    );
    return () => removePluginSlotRegistrations(pluginId);
  }, []);

  return (
    <div className="p-4">
      <div
        className="flex w-full max-w-80 items-center gap-0.5 border-b border-border"
        data-provider-hitbox-story
      >
        {providers.map((provider) => (
          <button
            key={provider.id}
            type="button"
            title={provider.label}
            aria-pressed={selected === provider.id}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setSelected(provider.id)}
            className={`flex shrink-0 items-center justify-center border-b-2 ${COARSE_POINTER_PROVIDER_TAB_SIZE_CLASS} ${selected === provider.id ? "border-foreground" : "border-transparent"}`}
          >
            <ProviderIcon
              providerKind="agent"
              provider={provider}
              className="size-4 max-md:pointer-coarse:size-5"
            />
          </button>
        ))}
      </div>
      <output aria-label="Selected provider" className="text-sm">
        {providers.find((provider) => provider.id === selected)?.label}
      </output>
    </div>
  );
}
