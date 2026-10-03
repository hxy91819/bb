import { useState } from "react";
import { ModelPickerStoryQueryProvider } from "../../../.ladle/model-picker-query-provider";
import { getProviderIconInfo } from "@/lib/provider-icon";
import { ModelReasoningPicker } from "./ModelReasoningPicker";
import codexLogo from "../../../../../plugins/provider-codex/icons/codex.svg?url";
import claudeLogo from "../../../../../plugins/provider-claude-code/icons/claude-code.svg?url";
import piLogo from "../../../../../plugins/provider-pi/icons/pi.svg?url";
import cursorLogo from "../../../../../plugins/provider-acp/icons/cursor.svg?url";

export default { title: "pickers/Model Provider Tabs" };

const providers = [
  ["codex", "Codex", codexLogo],
  ["claude-code", "Claude Code", claudeLogo],
  ["pi", "Pi", piLogo],
  ["cursor", "Cursor", cursorLogo],
  ["agent-5", "Agent 5", codexLogo],
  ["agent-6", "Agent 6", claudeLogo],
  ["agent-7", "Agent 7", piLogo],
].map(([value, label, logoUrl]) => ({
  value,
  label,
  icon: getProviderIconInfo("agent", value, {
    logoUrl,
  }).icon,
}));

function MobilePicker({
  modelCount,
  providerCount = 7,
}: {
  modelCount: number;
  providerCount?: number;
}) {
  const [provider, setProvider] = useState("codex");
  const [model, setModel] = useState("model-0");
  const options = [
    ...providers,
    ...Array.from({ length: providerCount - providers.length }, (_, index) => ({
      value: `agent-${index + 8}`,
      label: `Agent ${index + 8}`,
      icon: providers[index % providers.length].icon,
    })),
  ];
  return (
    <ModelPickerStoryQueryProvider>
      <div className="flex w-full justify-center p-4" data-app-composer>
        <ModelReasoningPicker
          providerOptions={options}
          selectedProviderId={provider}
          onSelectedProviderChange={setProvider}
          hasMultipleProviders
          modelValue={model}
          modelOptions={Array.from({ length: modelCount }, (_, index) => ({
            value: `model-${index}`,
            label: `Model ${index + 1}`,
          }))}
          onModelChange={setModel}
          reasoningValue="medium"
          reasoningOptions={[{ value: "medium", label: "Medium" }]}
          onReasoningChange={() => {}}
          fastModeEnabled={false}
          onFastModeChange={() => {}}
          showFastModeToggle={false}
          handoff={{
            sourceProviderId: "codex",
            active: true,
            onStart: () => {},
            onExit: () => {},
            onSelect: (selection) => setModel(selection.model),
          }}
        />
      </div>
      <output aria-label="Selected model">{model}</output>
    </ModelPickerStoryQueryProvider>
  );
}

export function ShortHandoff() {
  return <MobilePicker modelCount={4} />;
}

export function LongHandoff() {
  return <MobilePicker modelCount={80} />;
}

export function ManyProviders() {
  return <MobilePicker modelCount={80} providerCount={24} />;
}
