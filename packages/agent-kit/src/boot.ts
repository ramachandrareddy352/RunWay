// Boot (BUILD_PLAN T3.2): ShadeClient.create → register → session key.
// ShadeClient works in a TEE (real attestation) and in Shade local mode (whitelisted account, mock
// measurements; `requires_tee = false`). It only knows testnet and mainnet; the sandbox demo uses a
// key-backed signer instead (scripts/lib).
import type { Network } from "@runway/config";
import type { AgentSigner } from "./chain.js";

export interface ShadeBoot {
  signer: AgentSigner;
  registered: () => Promise<boolean>;
}

export async function bootShade(o: {
  network: Exclude<Network, "sandbox">;
  agentContractId: string;
  sponsor?: { accountId: string; privateKey: string };
  derivationPath?: string;
  minBalanceNear?: number;
}): Promise<ShadeBoot> {
  const { ShadeClient } = await import("@neardefi/shade-agent-js");
  const client = await ShadeClient.create({
    networkId: o.network,
    agentContractId: o.agentContractId,
    sponsor: o.sponsor,
    numKeys: 1,
    derivationPath: o.derivationPath,
  });
  if (o.sponsor && (await client.balance()) < (o.minBalanceNear ?? 0.2)) await client.fund(0.5);
  await client.register();
  const signer: AgentSigner = {
    accountId: () => client.accountId(),
    call: async <T>(
      method: string,
      args: Record<string, unknown>,
      opts?: { gas?: bigint; deposit?: bigint },
    ) => (await client.call({ methodName: method, args, gas: opts?.gas, deposit: opts?.deposit })) as T,
  };
  const registered = async () => {
    const a = (await client.view({ methodName: "get_agent", args: { account_id: client.accountId() } })) as {
      valid?: boolean;
    } | null;
    return a?.valid === true;
  };
  return { signer, registered };
}
