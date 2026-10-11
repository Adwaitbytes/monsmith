// Code generated — DO NOT EDIT.
import type { Address } from 'viem'
import { addContractMock, type ContractMock, type EvmMock } from '@chainlink/cre-sdk/test'

import { MonsmithAttestationsABI } from './MonsmithAttestations'

export type MonsmithAttestationsMock = {
  agentId?: () => bigint
  attestationCount?: () => bigint
  identityRegistry?: () => `0x${string}`
  isAttested?: (sourceHash: `0x${string}`) => boolean
  ofDeployment?: (chainId: bigint, target: `0x${string}`) => readonly [`0x${string}`, { score: number; critical: number; high: number; medium: number; low: number; timestamp: bigint; reportHash: `0x${string}`; reportURI: string }]
  ofSource?: (sourceHash: `0x${string}`) => { score: number; critical: number; high: number; medium: number; low: number; timestamp: bigint; reportHash: `0x${string}`; reportURI: string }
} & Pick<ContractMock<typeof MonsmithAttestationsABI>, 'writeReport'>

export function newMonsmithAttestationsMock(address: Address, evmMock: EvmMock): MonsmithAttestationsMock {
  return addContractMock(evmMock, { address, abi: MonsmithAttestationsABI }) as MonsmithAttestationsMock
}

