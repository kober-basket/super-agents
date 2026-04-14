import type * as acp from "@agentclientprotocol/sdk";

export function chooseAutoPermissionResponse(options: acp.PermissionOption[]) {
  const selectedOption =
    options.find((option) => option.kind === "allow_always") ??
    options.find((option) => option.kind === "allow_once") ??
    options.find((option) => option.kind === "reject_once") ??
    options.find((option) => option.kind === "reject_always") ??
    null;

  return {
    selectedOption,
    response: selectedOption
      ? {
          outcome: {
            outcome: "selected" as const,
            optionId: selectedOption.optionId,
          },
        }
      : {
          outcome: {
            outcome: "cancelled" as const,
          },
        },
  };
}
